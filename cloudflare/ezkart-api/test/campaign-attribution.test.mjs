import test from 'node:test';
import assert from 'node:assert/strict';
import {campaignDeliveryFixture} from './campaign-delivery-fixture.mjs';
import {prepareAttributionCampaign} from './campaign-attribution-fixture.mjs';
import {campaignLink,campaignVisitHash,cleanupCampaignVisits} from '../src/campaign-attribution.js';
import {dispatchCampaignEmails} from '../src/campaign-email-delivery.js';
import {createCommerceOrder,commerceHash} from '../src/commerce-orders.js';
import {publicationKey} from './campaign-publication-fixture.mjs';
import {applyCommerceSchema} from './commerce-schema.mjs';
import {claimCommerceJobs,finishCommerceJob} from '../src/commerce-jobs.js';
import {campaignEmailConfiguration,emailCredentialHash} from '../src/email-provider.js';
import {prepareCampaignUnsubscribe} from '../src/campaign-unsubscribe.js';
import {campaignEmailPayload} from '../src/campaign-email-template.js';
const request=(f,method='GET',suffix='')=>new Request('https://api.fixture.test'+f.path+suffix,{method});
async function fixture(t,{send=true,...options}={}){
  const f=await campaignDeliveryFixture(t,options),campaign=await prepareAttributionCampaign(f),result={...f,campaignPath:f.path,...campaign};
  if(send){const sent=await f.drain();assert.equal(sent.processed,1,JSON.stringify({sent,jobs:await f.jobs()}));assert.equal(sent.failed,0);}
  return result;
}
const open=f=>campaignLink(f.env,request(f));
const publicCall=(f,method='GET',suffix='')=>f.mf.dispatchFetch(request(f,method,suffix).url,{method});
const intent=(f,visit,overrides={})=>f.input({...overrides,checkout:{...f.input().checkout,campaignVisit:visit}});
const attribution=(f,id)=>f.db.prepare('SELECT * FROM commerce_campaign_order_attributions WHERE order_id=?').bind(id).first();

test('only a started frozen message activates a campaign link; HEAD is read-only and GET records no recipient identity',async t=>{
  const f=await fixture(t,{send:false});
  assert.equal((await publicCall(f)).status,404);assert.equal(await f.count('commerce_campaign_visits'),0);
  assert.equal((await f.drain()).processed,1);
  const message=f.control.calls[0].message,link='https://test.ezkart.id/cart/campaign.php?c='+f.link.code;
  assert(message.text.includes(link));assert(message.html.includes('href="'+link+'"'));assert(!link.includes('buyer'));
  const head=await publicCall(f,'HEAD');assert.equal(head.status,200);assert.equal(await head.text(),'');assert.equal(head.headers.get('x-ezkart-campaign-store'),'seller_alice');assert.equal(head.headers.get('x-ezkart-campaign-environment'),'sandbox');assert.equal(await f.count('commerce_campaign_visits'),0);
  const response=await publicCall(f);assert.equal(response.status,200);assert.equal(response.headers.get('referrer-policy'),'no-referrer');assert.match(response.headers.get('cache-control'),/no-store/);assert.equal(response.headers.get('set-cookie'),null);
  const view=await response.json();assert.deepEqual(Object.keys(view).sort(),['environment','expiresAt','ok','storeId','visit']);assert.match(view.visit,/^[a-f0-9]{64}$/);
  const saved=await f.db.prepare('SELECT * FROM commerce_campaign_visits').first();assert.equal(saved.token_hash,await campaignVisitHash(view.visit,'sandbox'));assert(!JSON.stringify(saved).includes(view.visit));assert(!JSON.stringify(saved).includes('buyer'));assert.equal(Date.parse(saved.expires_at)-Date.parse(saved.created_at),7*86400000);
  assert.equal((await f.db.prepare('SELECT recorded,limited FROM commerce_campaign_visit_buckets').first()).recorded,1);
  const next=await open(f);assert.notEqual(next.visit,view.visit);assert.equal(await f.count('commerce_campaign_visits'),2);
  for(const suffix of ['&store=seller_bob','&c='+f.link.code,'&next=https://example.test'])assert.equal((await publicCall(f,'GET',suffix)).status,404);
  const post=await publicCall(f,'POST');assert.equal(post.status,405);assert.equal(post.headers.get('allow'),'GET, HEAD');assert.equal(await f.count('commerce_campaign_visits'),2);
});

test('prepared but unsent messages cannot create visits, and lost submissions preserve the published link',async t=>{
  const f=await fixture(t,{send:false});let changed=false;
  const db=new Proxy(f.db,{get(target,key){if(key==='prepare')return sql=>{const statement=target.prepare(sql);if(!sql.includes('INSERT INTO commerce_campaign_email_starts'))return statement;return {bind(...args){return {async run(){if(!changed){changed=true;await f.decline(f.buyer.grant);}return statement.bind(...args).run();}};}};};const value=Reflect.get(target,key);return typeof value==='function'?value.bind(target):value;}});
  assert.equal((await dispatchCampaignEmails({...f.env,DB:db},2,f.fetcher)).processed,1);assert.equal(await f.count('commerce_campaign_link_messages'),1);assert.equal(await f.count('commerce_campaign_email_starts'),0);assert.equal((await publicCall(f)).status,404);
  const other=await fixture(t,{send:false});other.control.outcomes.push('lost');assert.equal((await dispatchCampaignEmails(other.env,2,other.fetcher)).failed,1);
  assert.match((await open(other)).visit,/^[a-f0-9]{64}$/);await other.ready();assert.equal((await dispatchCampaignEmails(other.env,2,other.fetcher)).processed,1);assert.equal(other.control.calls[0].body,other.control.calls[1].body);assert.equal(await other.count('commerce_campaign_link_messages'),1);
});

test('the original order transaction freezes one anonymous source and retries cannot retag it',async t=>{
  const f=await fixture(t),visit=(await open(f)).visit,input=intent(f,visit);
  const [a,b]=await Promise.all([f.create(input),f.create(input)]);assert.equal(a.status,200,a.error);assert.equal(b.status,200,b.error);assert.equal(a.order.id,b.order.id);
  const source=await attribution(f,a.order.id);assert.equal(source.publication_id,f.publication.id);assert.equal(source.visit_hash,await campaignVisitHash(visit,'sandbox'));
  assert.equal(a.order.snapshot.checkout.campaignVisitHash,source.visit_hash);assert(!JSON.stringify(a.order).includes(visit));assert.equal(await f.count('commerce_campaign_order_attributions'),1);
  assert.equal((await f.paid(a.order)).status,200);assert.equal((await f.paid(a.order)).status,200);assert.equal(await f.count('commerce_payment_captures'),1);assert.deepEqual(await attribution(f,a.order.id),source);
  const changed=intent(f,(await open(f)).visit,{checkoutKey:input.checkoutKey});assert.equal((await f.create(changed)).status,409);
  const plain={...input,checkout:{...input.checkout}};delete plain.checkout.campaignVisit;assert.equal((await f.create(plain)).status,409);
  await f.db.prepare("UPDATE products SET price_amount=90000 WHERE id='tea'").run();assert.equal((await f.create(input)).order.id,a.order.id);
  for(const table of ['commerce_campaign_links','commerce_campaign_link_messages','commerce_campaign_order_attributions']){
    await assert.rejects(f.db.prepare('DELETE FROM '+table).run(),/immutable/);await assert.rejects(f.db.prepare('INSERT OR REPLACE INTO '+table+' SELECT * FROM '+table+' LIMIT 1').run(),/immutable/);
  }
  await assert.rejects(f.db.prepare("UPDATE commerce_campaign_order_attributions SET publication_id='cpub_"+'0'.repeat(32)+"'").run(),/immutable/);
});

test('forged, wrong-store, expired and wrong-environment references never create attribution or prevent ordinary checkout',async t=>{
  const f=await fixture(t),visit=(await open(f)).visit;
  const wrongStore=await f.create(intent(f,visit,{sellerId:'seller_bob',items:[{productId:'private',quantity:1,expectedPrice:20000,expectedWeightGrams:100}]}));assert.equal(wrongStore.status,200,wrongStore.error);assert.equal(await attribution(f,wrongStore.order.id),null);
  const unknown=await f.create(intent(f,'0'.repeat(64)));assert.equal(unknown.status,200,unknown.error);assert.equal(await attribution(f,unknown.order.id),null);
  await assert.rejects(campaignLink({...f.env,APP_ENVIRONMENT:'production'},request(f)),e=>e.status===404);
  for(const invalid of ['',null,[],visit.toUpperCase(),'x'.repeat(64)])assert.equal((await f.create(intent(f,invalid))).status,422);
  const priorInput=intent(f,visit,{items:[{productId:'mug',quantity:1,expectedPrice:20000,expectedWeightGrams:100}]}),prior=await f.create(priorInput);assert.equal(prior.status,200,prior.error);
  const hash=await campaignVisitHash(visit,'sandbox'),expiry=(await f.db.prepare('SELECT expires_at FROM commerce_campaign_visits WHERE token_hash=?').bind(hash).first()).expires_at;
  t.mock.timers.enable({apis:['Date'],now:Date.parse(expiry)+1});
  try{const late=await createCommerceOrder(f.env,intent(f,visit));assert.equal(await attribution(f,late.id),null);assert.equal((await createCommerceOrder(f.env,priorInput)).id,prior.order.id);}
  finally{t.mock.timers.reset();}
});

test('a failure after initial order insertion rolls back the attribution with inventory and the order',async t=>{
  const f=await fixture(t),visit=(await open(f)).visit,before=await f.count('orders');
  await f.db.prepare("CREATE TRIGGER fixture_order_failure BEFORE INSERT ON order_items WHEN NEW.product_id='tea' BEGIN SELECT RAISE(ABORT,'fixture_rollback'); END").run();
  const input=intent(f,visit),failed=await f.create(input);assert(failed.status>=400,JSON.stringify(failed));assert.equal(await f.count('orders'),before);assert.equal(await f.count('commerce_campaign_order_attributions'),0);
  await f.db.prepare('DROP TRIGGER fixture_order_failure').run();const success=await f.create(input);assert.equal(success.status,200,success.error);assert.equal((await attribution(f,success.order.id)).publication_id,f.publication.id);
});

test('lost visit database acknowledgements recover the same reference and count once',async t=>{
  const f=await fixture(t);let dropped=false;
  const db=new Proxy(f.db,{get(target,key){if(key==='prepare')return sql=>{const statement=target.prepare(sql);if(!sql.includes('INSERT INTO commerce_campaign_visits('))return statement;return {bind(...args){return {async run(){const result=await statement.bind(...args).run();if(!dropped){dropped=true;throw Error('Fixture lost acknowledgement');}return result;}};}};};const value=Reflect.get(target,key);return typeof value==='function'?value.bind(target):value;}});
  const visit=await campaignLink({...f.env,DB:db},request(f));assert.match(visit.visit,/^[a-f0-9]{64}$/);assert.equal(await f.count('commerce_campaign_visits'),1);assert.equal((await f.db.prepare('SELECT recorded FROM commerce_campaign_visit_buckets').first()).recorded,1);
});

test('measurement limits preserve store access and record limited coverage separately',async t=>{
  const f=await fixture(t);await open(f);
  const guard=await f.db.prepare("SELECT sql FROM sqlite_master WHERE name='commerce_campaign_visit_bucket_update'").first();
  await f.db.prepare('DROP TRIGGER commerce_campaign_visit_bucket_update').run();await f.db.prepare('UPDATE commerce_campaign_visit_buckets SET recorded=10000').run();await f.db.prepare(guard.sql).run();
  const limited=await open(f);assert.deepEqual(limited,{storeId:'seller_alice',environment:'sandbox',visit:null,expiresAt:null});assert.equal(await f.count('commerce_campaign_visits'),1);
  assert.deepEqual(await f.db.prepare('SELECT recorded,limited FROM commerce_campaign_visit_buckets').first(),{recorded:10000,limited:1});
  await assert.rejects(f.db.prepare('UPDATE commerce_campaign_visit_buckets SET recorded=0').run(),/immutable/);await assert.rejects(f.db.prepare('DELETE FROM commerce_campaign_visit_buckets').run(),/immutable/);
});

test('the daily store measurement cap includes other hours while a new UTC day remains available',async t=>{
  const f=await fixture(t);await open(f);
  const row=await f.db.prepare('SELECT * FROM commerce_campaign_visit_buckets').first(),guards=(await f.db.prepare("SELECT name,sql FROM sqlite_master WHERE name IN ('commerce_campaign_visit_bucket_insert','commerce_campaign_visit_bucket_update')").all()).results;
  for(const g of guards)await f.db.prepare('DROP TRIGGER '+g.name).run();
  const other=row.bucket.slice(0,11)+(row.bucket.slice(11,13)==='00'?'01':'00')+':00:00.000Z';
  await f.db.prepare('INSERT INTO commerce_campaign_visit_buckets(publication_id,seller_id,commerce_environment,bucket,recorded,limited,updated_at) VALUES(?,?,?,?,99999,0,?)').bind(row.publication_id,row.seller_id,row.commerce_environment,other,other).run();
  for(const g of guards)await f.db.prepare(g.sql).run();
  assert.equal((await open(f)).visit,null);assert.equal(await f.count('commerce_campaign_visits'),1);
  t.mock.timers.enable({apis:['Date'],now:Date.parse(row.bucket.slice(0,10)+'T00:00:00.000Z')+86400000});
  try{assert.match((await open(f)).visit,/^[a-f0-9]{64}$/);assert.equal(await f.count('commerce_campaign_visits'),2);}finally{t.mock.timers.reset();}
});

test('two new tracked campaign messages fit the D1 invocation query budget',async t=>{
  const f=await campaignDeliveryFixture(t);await prepareAttributionCampaign(f,{publish:false});await f.addBuyer(2);assert.equal((await f.publish({...f.intent(),revision:2})).status,200);let queries=0;
  const DB=new Proxy(f.db,{get(target,key){if(key==='prepare')return sql=>{queries++;return target.prepare(sql);};const value=Reflect.get(target,key);return typeof value==='function'?value.bind(target):value;}});
  const result=await dispatchCampaignEmails({...f.env,DB},2,f.fetcher);assert.equal(result.processed,2,JSON.stringify(result));assert.equal(result.failed,0);assert(queries<=50,'D1 queries: '+queries);assert.equal(await f.count('commerce_campaign_link_messages'),2);
  assert.equal(f.control.calls[0].message.text.match(/campaign\.php\?c=[a-f0-9]+/)[0],f.control.calls[1].message.text.match(/campaign\.php\?c=[a-f0-9]+/)[0]);
});

test('received links survive withdrawal, cancellation and commerce/send holds but respect store closure',async t=>{
  const f=await fixture(t);await f.decline(f.buyer.grant);assert.equal((await f.action('cancel')).status,200);
  const held={...f.env,COMMERCE_STORAGE:'off',COMMERCE_CAMPAIGN_SEND:'off',COMMERCE_EMAIL_SEND:'off'};assert.match((await campaignLink(held,request(f))).visit,/^[a-f0-9]{64}$/);
  await f.db.prepare("UPDATE sellers SET settings_json=json_set(settings_json,'$.storefront.enabled',0) WHERE id='seller_alice'").run();await assert.rejects(open(f),e=>e.status===404);
  await f.db.prepare("UPDATE sellers SET settings_json=json_set(settings_json,'$.storefront.enabled',1),status='suspended' WHERE id='seller_alice'").run();await assert.rejects(open(f),e=>e.status===404);
});

test('expired visit cleanup keeps immutable order attribution and historical measurement',async t=>{
  const f=await fixture(t),visit=(await open(f)).visit,input=intent(f,visit),order=await f.create(input);assert.equal(order.status,200,order.error);
  await assert.rejects(f.db.prepare('DELETE FROM commerce_campaign_visits').run(),/retained/);await assert.rejects(f.db.prepare("UPDATE commerce_campaign_visits SET expires_at='2000-01-01T00:00:00.000Z'").run(),/immutable/);
  const guard=await f.db.prepare("SELECT sql FROM sqlite_master WHERE name='commerce_campaign_visit_update'").first();await f.db.prepare('DROP TRIGGER commerce_campaign_visit_update').run();
  await f.db.prepare("UPDATE commerce_campaign_visits SET created_at='2000-01-01T00:00:00.000Z',expires_at='2000-01-08T00:00:00.000Z'").run();await f.db.prepare(guard.sql).run();
  await cleanupCampaignVisits(f.env);assert.equal(await f.count('commerce_campaign_visits'),0);assert.equal(await f.count('commerce_campaign_order_attributions'),1);assert.equal((await f.db.prepare('SELECT recorded FROM commerce_campaign_visit_buckets').first()).recorded,1);
  assert.equal((await f.create(input)).order.id,order.order.id);const fresh=await f.create({...input,checkoutKey:publicationKey()});assert.equal(fresh.status,200,fresh.error);assert.equal(await attribution(f,fresh.order.id),null);
});

test('populated migration preserves legacy message bytes and only newly prepared mail activates the shared link',async t=>{
  const f=await campaignDeliveryFixture(t,{through:38});await prepareAttributionCampaign(f,{publish:false});await f.addBuyer(2);
  const published=await f.publish({...f.intent(),revision:2});assert.equal(published.status,200,published.error);
  const workerId='fixture_legacy_mail',configuration=campaignEmailConfiguration(f.env),[job]=await claimCommerceJobs(f.env,{environment:'sandbox',workerId,kinds:['campaign.send'],limit:1,leaseSeconds:120});
  const row=await f.db.prepare('SELECT * FROM commerce_campaign_delivery_sources WHERE candidate_id=?').bind(job.data.candidateId).first(),id='campmail_'+(await commerceHash({candidate:row.candidate_id,publication:row.publication_id,environment:'sandbox'})).slice(0,32);
  const link=await prepareCampaignUnsubscribe(f.env,{sellerId:row.seller_id,authUserId:row.auth_user_id,email:row.email,reference:id,consentRevision:row.consent_revision});
  const payload=campaignEmailPayload(configuration,{sellerId:row.seller_id,storeName:row.store_name,shopEnabled:true,values:JSON.parse(row.data_json)},row.email,id,link.url),now=new Date().toISOString();
  // Recreate the actual pre-0039 outbox contract, including its original plain
  // shop CTA. The same guards and send-start receipt apply to this old message.
  await f.db.batch([link.statement,f.db.prepare(`INSERT INTO commerce_campaign_email_requests(id,job_id,candidate_id,seller_id,commerce_environment,profile_id,credential_hash,source_lease_token,
    sender_email,recipient_email,email_hash,confirmed_at,verified_at,unsubscribe_hash,idempotency_key,request_json,request_hash,template_version,created_at,retry_until)
    VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,'campaign-v1',?,?)`).bind(id,job.id,row.candidate_id,job.sellerId,'sandbox',configuration.profile,await emailCredentialHash(f.env,configuration),job.leaseToken,
    configuration.sender,row.email,await commerceHash({environment:'sandbox',email:row.email}),'2026-09-01T00:00:00.000Z',now,link.tokenHash,'ezkart_campaign/sandbox/'+id,payload,await commerceHash(payload),now,new Date(Date.parse(now)+23*3600000).toISOString())]);
  await f.db.prepare('INSERT INTO commerce_campaign_email_starts(attempt_id,request_id,lease_token,verified_at,created_at) VALUES(?,?,?,?,?)').bind(job.id+':'+job.attempts,id,job.leaseToken,now,now).run();
  await finishCommerceJob(f.env,job.id,{environment:'sandbox',workerId,leaseToken:job.leaseToken,outcome:'uncertain',error:'Fixture lost old submission acknowledgement'});
  const tables=(await f.db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' AND substr(name,1,4)!='_cf_' ORDER BY name").all()).results.map(r=>r.name),before=await Promise.all(tables.map(table=>f.db.prepare('SELECT * FROM '+table+' ORDER BY rowid').all()));
  await applyCommerceSchema(f.db,38,39);for(let n=0;n<tables.length;n++)assert.deepEqual((await f.db.prepare('SELECT * FROM '+tables[n]+' ORDER BY rowid').all()).results,before[n].results,tables[n]);
  assert.equal(await f.count('commerce_campaign_links'),1);assert.equal(await f.count('commerce_campaign_link_messages'),0);assert.equal(await f.count('commerce_campaign_visit_sources'),0);
  await f.ready();assert.equal((await f.drain(2)).processed,2);assert.equal(await f.count('commerce_campaign_link_messages'),1);assert.equal(await f.count('commerce_campaign_visit_sources'),1);
  assert(f.control.calls.some(call=>call.body===payload));assert(f.control.calls.some(call=>call.message.text.includes('/cart/campaign.php?c=')));
  assert.equal((await f.db.prepare('SELECT request_json FROM commerce_campaign_email_requests WHERE id=?').bind(id).first()).request_json,payload);assert.equal((await f.db.prepare('PRAGMA foreign_key_check').all()).results.length,0);
  await applyCommerceSchema(f.db,39,40);const performance=await f.merchant('/v1/commerce/marketing/performance');assert.equal(performance.status,200,JSON.stringify(performance));assert.equal(performance.totals.trackedCampaigns,1);assert.equal(performance.totals.untrackedCampaigns,1);assert.equal(performance.totals.visits,0);
});
