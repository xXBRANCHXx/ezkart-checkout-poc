import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {campaignDeliveryFixture as fixture} from './campaign-delivery-fixture.mjs';
import {publicationKey,publicationBase} from './campaign-publication-fixture.mjs';
import {grantCampaignConsent} from './campaign-unsubscribe-fixture.mjs';
import {dispatchCampaignEmails,deliverCampaignEmailJob} from '../src/campaign-email-delivery.js';
import {dispatchEmails,recordEmailWebhook} from '../src/commerce-email-delivery.js';
import {claimCommerceJobs,finishCommerceJob} from '../src/commerce-jobs.js';
import {emailFixtureEvent as callbackBody,emailFixtureCallback as callback} from './email-fixture.mjs';
import worker from '../src/index.js';
import {applyCommerceSchema} from './commerce-schema.mjs';
const published=async f=>{const result=await f.publish();assert.equal(result.status,200,result.error);return result;};
const record=(f,call,type='email.delivered',extra={})=>recordEmailWebhook(callback(callbackBody(call.message,call.id,type,extra)),f.env,'test_mail');
test('campaign Worker dispatch binds the frozen copy, verified recipient and unsubscribe token to one immutable request',async t=>{
  const f=await fixture(t);await f.addBuyer(1);await published(f);
  const edit=await f.merchant(publicationBase,{id:f.id,revision:1,requestKey:publicationKey(),values:{...f.values,subject:'Later copy',archived:true}},{method:'POST'});assert.equal(edit.status,200,edit.error);
  await f.db.prepare("UPDATE sellers SET name='New name' WHERE id='seller_alice'").run();
  const result=await f.drain();assert.equal(result.processed,1,JSON.stringify({result,jobs:await f.jobs(),lookups:f.control.lookups}));assert.equal(result.failed,0);
  const x=await f.db.prepare('SELECT * FROM commerce_campaign_email_requests').first(),call=f.control.calls[0];
  assert.equal(x.request_json,call.body);assert.equal(x.idempotency_key,call.key);assert.equal(Date.parse(x.retry_until)-Date.parse(x.created_at),23*3600000);
  assert.equal(call.message.subject,'[Sandbox] '+f.values.subject);assert(!call.body.includes('New name'));assert.deepEqual(call.message.to,['buyer1@example.test']);
  const token=await f.db.prepare('SELECT * FROM commerce_unsubscribe_tokens').first();assert.equal(token.reference,x.id);assert.equal(token.token_hash,x.unsubscribe_hash);assert.equal(token.consent_revision,1);
  assert.equal(await f.count('commerce_campaign_email_starts'),1);assert.equal(await f.count('commerce_campaign_email_provider_bindings'),1);assert.equal(await f.count('commerce_email_requests'),0);
  const data=callbackBody(call.message,call.id),id='msg_'+publicationKey();
  for(let i=0;i<2;i++){const res=await f.postCallback(callback(data,{id}));assert.equal(res.status,200);assert.equal((await res.json()).duplicate,Boolean(i));}
  assert.equal((await f.postCallback(callback({...data,type:'email.bounced'},{id}))).status,409);
  assert.equal((await f.postCallback(callback({...data,data:{...data.data,to:['other@example.test']}}))).status,409);
  assert.equal((await f.postCallback(callback({...data,data:{...data.data,email_id:randomUUID()}}))).status,409);
  assert.equal((await f.postCallback(callback({...data,data:{...data.data,tags:{...data.data.tags,ezkart_purpose:'order'}}}))).status,422);
  assert.equal((await f.postCallback(callback(data,{signature:'v1,'+Buffer.alloc(32).toString('base64')}))).status,401);
  const recipients=await f.merchant(f.path+'/recipients');assert.equal(recipients.items[0].delivery.state,'delivered');assert.equal(recipients.items[0].delivery.needsReview,false);
  const view=await f.merchant(f.path+'/publication');assert.equal(view.publication.deliverySummary.submitted,1);assert.equal(view.publication.deliverySummary.delivered,1);assert(!JSON.stringify(view).includes('unsubscribe.php'));
  const link=new URL(call.message.headers['List-Unsubscribe'].slice(1,-1)),publicPath='/v1/public/campaign-unsubscribe'+link.search;
  const opened=await f.mf.dispatchFetch('https://api.fixture.test'+publicPath);assert.equal(opened.status,200);assert.equal((await opened.json()).unsubscribed,false);
  const stopped=await f.mf.dispatchFetch('https://api.fixture.test'+publicPath,{method:'POST',headers:{'content-type':'application/x-www-form-urlencoded'},body:'List-Unsubscribe=One-Click'});assert.equal(stopped.status,200);assert.equal((await stopped.json()).unsubscribed,true);
  for(const table of ['commerce_campaign_email_requests','commerce_campaign_email_starts','commerce_campaign_email_events','commerce_campaign_email_provider_bindings']){
    await assert.rejects(f.db.prepare('DELETE FROM '+table).run(),/campaign_email_immutable/);
    await assert.rejects(f.db.prepare('INSERT OR REPLACE INTO '+table+' SELECT * FROM '+table+' LIMIT 1').run(),/campaign_email_immutable/);
  }
  assert.equal((await f.drain()).processed,0);assert.equal(f.control.calls.length,1);
});

test('lost acknowledgements reuse the exact message, token and key; a fresh identity lookup is mandatory',async t=>{
  const f=await fixture(t);await f.addBuyer(1);await published(f);f.control.outcomes.push('lost');
  assert.equal((await dispatchCampaignEmails(f.env,2,f.fetcher)).failed,1);assert.equal((await f.jobs())[0].state,'uncertain');
  await f.ready();assert.equal((await dispatchCampaignEmails(f.env,2,f.fetcher)).processed,1);
  assert.equal(f.control.calls.length,2);assert.equal(f.control.providerIds.size,1);assert.equal(f.control.calls[0].body,f.control.calls[1].body);assert.equal(f.control.calls[0].key,f.control.calls[1].key);
  assert.deepEqual(f.control.lookups,['campaign-buyer-1','campaign-buyer-1']);assert.equal(await f.count('commerce_unsubscribe_tokens'),1);assert.equal(await f.count('commerce_campaign_email_requests'),1);assert.equal(await f.count('commerce_campaign_email_starts'),2);
});

test('early signed callbacks and lost database acknowledgements recover without a second provider submission',async t=>{
  for(const failure of ['provider_response','database_response'])await t.test(failure,async t=>{
    const f=await fixture(t);await f.addBuyer(1);await published(f);let db=f.db;
    if(failure==='provider_response'){f.control.outcomes.push('lost');f.control.sendHook=async(message,id)=>recordEmailWebhook(callback(callbackBody(message,id)),f.env,'test_mail');}
    else {let dropped=false;db=new Proxy(f.db,{get(target,property){if(property==='prepare')return sql=>{const statement=target.prepare(sql);if(!sql.includes('INSERT INTO commerce_campaign_email_events'))return statement;return {bind(...args){return {async run(){const value=await statement.bind(...args).run();if(!dropped){dropped=true;throw Error('Fixture lost acknowledgement after commit');}return value;}};}};};const value=Reflect.get(target,property);return typeof value==='function'?value.bind(target):value;}});}
    const result=await dispatchCampaignEmails({...f.env,DB:db},2,f.fetcher);assert.equal(result.processed,1,JSON.stringify(result));assert.equal(f.control.calls.length,1);assert.equal((await f.jobs())[0].state,'succeeded');assert.equal(await f.count('commerce_campaign_email_events'),1);
  });
});

test('current permission, publisher access, verified identity and TEST allowlist stop first submissions',async t=>{
  for(const condition of ['preference','regrant','role','identity','address','allowlist','lookup_race','store'])await t.test(condition,async t=>{
    const f=await fixture(t),one=await f.addBuyer(1);await published(f);let env=f.env;
    if(['preference','regrant'].includes(condition))await f.decline(one.grant);
    if(condition==='regrant')await grantCampaignConsent(f,{buyer:one.buyer,revision:2});
    if(condition==='role')await f.db.prepare("UPDATE seller_memberships SET role='viewer' WHERE auth_user_id='alice'").run();
    if(condition==='identity')f.control.users[one.buyer.id]={...one.buyer,email_confirmed_at:null,user_metadata:{email_verified:true}};
    if(condition==='address')f.control.users[one.buyer.id]={...one.buyer,email:'changed@example.test',email_confirmed_at:'2026-09-01T00:00:00Z'};
    if(condition==='allowlist')env={...env,COMMERCE_EMAIL_TEST_RECIPIENTS:'["alice@example.test"]'};
    if(condition==='lookup_race')f.control.identityHook=async()=>{await f.decline(one.grant);};
    if(condition==='store')await f.db.prepare("UPDATE sellers SET status='suspended' WHERE id='seller_alice'").run();
    const result=await dispatchCampaignEmails(env,2,f.fetcher);assert.equal(result.processed,1,JSON.stringify({result,jobs:await f.jobs()}));assert.equal(f.control.calls.length,0);
    const saved=await f.db.prepare('SELECT * FROM commerce_campaign_email_skips').first();assert.equal(saved.uncertain,0);
    assert.equal(saved.reason,{preference:'preference_off',regrant:'consent_changed',role:'access_removed',identity:'identity_invalid',address:'address_changed',allowlist:'test_recipient',lookup_race:'preference_off',store:'store_closed'}[condition]);
    assert.equal(await f.count('commerce_unsubscribe_tokens'),0);assert.equal(await f.count('commerce_campaign_email_requests'),0);assert.equal(await f.count('commerce_campaign_email_starts'),0);
    await assert.rejects(f.db.prepare('DELETE FROM commerce_campaign_email_skips').run(),/campaign_email_immutable/);
  });
});

test('a change at the last start receipt prevents sending after the message has been prepared',async t=>{
  const f=await fixture(t),one=await f.addBuyer(1);await published(f);let changed=false;
  const db=new Proxy(f.db,{get(target,property){if(property==='prepare')return sql=>{const statement=target.prepare(sql);if(!sql.includes('INSERT INTO commerce_campaign_email_starts'))return statement;return {bind(...args){return {async run(){if(!changed){changed=true;await f.decline(one.grant);}return statement.bind(...args).run();}};}};};const value=Reflect.get(target,property);return typeof value==='function'?value.bind(target):value;}});
  const result=await dispatchCampaignEmails({...f.env,DB:db},2,f.fetcher);assert.equal(result.processed,1,JSON.stringify(result));assert.equal(f.control.calls.length,0);
  assert.equal(await f.count('commerce_unsubscribe_tokens'),1);assert.equal(await f.count('commerce_campaign_email_requests'),1);assert.equal(await f.count('commerce_campaign_email_starts'),0);
  assert.equal((await f.db.prepare('SELECT reason FROM commerce_campaign_email_skips').first()).reason,'preference_off');
});

test('permission or credential changes after an unknown submission preserve uncertainty and accept later delivery evidence',async t=>{
  for(const condition of ['preference','cancelled','provider','address'])await t.test(condition,async t=>{
    const f=await fixture(t),one=await f.addBuyer(1);await published(f);f.control.outcomes.push('lost');await dispatchCampaignEmails(f.env,2,f.fetcher);await f.ready();let env=f.env;
    if(condition==='preference')await f.decline(one.grant);
    if(condition==='cancelled')assert.equal((await f.action('cancel')).status,200);
    if(condition==='provider')env={...env,RESEND_API_KEY:'re_rotated_fixture_only'};
    if(condition==='address')f.control.users[one.buyer.id]={...one.buyer,email:'new@example.test',email_confirmed_at:'2026-09-01T00:00:00Z'};
    assert.equal((await dispatchCampaignEmails(env,2,f.fetcher)).failed,1);assert.equal(f.control.calls.length,1);assert.equal((await f.jobs())[0].state,'dead');
    const skipped=await f.db.prepare('SELECT * FROM commerce_campaign_email_skips').first();assert.equal(skipped.uncertain,1);
    assert.equal(skipped.reason,{preference:'preference_off',cancelled:'cancelled',provider:'provider_changed',address:'address_changed'}[condition]);
    assert.equal((await f.merchant(f.path+'/recipients')).items[0].delivery.state,'uncertain');
    await record(f,f.control.calls[0]);const recipient=(await f.merchant(f.path+'/recipients')).items[0];assert.equal(recipient.delivery.state,'delivered');assert.equal(recipient.delivery.needsReview,true);
    assert.equal((await f.jobs())[0].state,'dead');assert.equal(await f.count('commerce_campaign_email_starts'),1);
  });
});

test('the original retry deadline ends replay before provider deduplication expires',async t=>{
  const f=await fixture(t);await f.addBuyer(1);await published(f);f.control.outcomes.push('lost');await dispatchCampaignEmails(f.env,2,f.fetcher);await f.ready();
  const saved=await f.db.prepare('SELECT * FROM commerce_campaign_email_requests').first();t.mock.timers.enable({apis:['Date'],now:Date.parse(saved.retry_until)+1});
  try{assert.equal((await dispatchCampaignEmails(f.env,2,f.fetcher)).failed,1);assert.equal(f.control.calls.length,1);assert.equal((await f.jobs())[0].state,'dead');
    const skip=await f.db.prepare('SELECT * FROM commerce_campaign_email_skips').first();assert.equal(skip.reason,'retry_window_expired');assert.equal(skip.uncertain,1);
  }finally{t.mock.timers.reset();}
});

test('bounces and complaints suppress the same address across campaign and transactional email in both directions',async t=>{
  for(const first of ['campaign','transactional'])await t.test(first,async t=>{
    const f=await fixture(t);f.control.users.alice={id:'alice',email:'buyer1@example.test',email_confirmed_at:'2026-09-01T00:00:00Z'};
    await f.addBuyer(1);await published(f);await f.makeNotification();
    const send=first==='campaign'?dispatchCampaignEmails:dispatchEmails,other=first==='campaign'?dispatchEmails:dispatchCampaignEmails;
    assert.equal((await send(f.env,2,f.fetcher)).processed,1);await record(f,f.control.calls[0],'email.complained');
    assert.equal((await other(f.env,2,f.fetcher)).processed,1);assert.equal(f.control.calls.length,1);
    const table=first==='campaign'?'commerce_email_skips':'commerce_campaign_email_skips';assert.equal((await f.db.prepare('SELECT reason FROM '+table).first()).reason,'suppressed');
  });
});

test('a provider message ID cannot be bound to different purposes; conflict evidence stays visible',async t=>{
  for(const first of ['campaign','transactional'])await t.test(first,async t=>{
  const f=await fixture(t);await f.addBuyer(1);await published(f);await f.makeNotification();
  const send=first==='campaign'?dispatchCampaignEmails:dispatchEmails,other=first==='campaign'?dispatchEmails:dispatchCampaignEmails;
  const prefix=first==='campaign'?'commerce_email':'commerce_campaign_email',kind=first==='campaign'?'notification.send':'campaign.send';
  assert.equal((await send(f.env,2,f.fetcher)).processed,1);f.control.forcedId=f.control.calls[0].id;
  assert.equal((await other(f.env,2,f.fetcher)).failed,1);assert.equal((await f.db.prepare('SELECT state FROM commerce_jobs WHERE kind=?').bind(kind).first()).state,'dead');
  assert.equal(await f.count(prefix+'_provider_bindings'),0);assert.equal(await f.count(prefix+'_events'),0);
  await assert.rejects(record(f,f.control.calls[1]),e=>e.status===409);assert.equal(await f.count('commerce_all_email_bindings'),1);
  });
});

test('callback order never reverses delivery and a later complaint remains actionable',async t=>{
  const f=await fixture(t);await f.addBuyer(1);await published(f);await dispatchCampaignEmails(f.env,2,f.fetcher);const call=f.control.calls[0];
  await record(f,call);await record(f,call,'email.delivery_delayed');await record(f,call,'email.sent');
  assert.equal((await f.merchant(f.path+'/recipients')).items[0].delivery.state,'delivered');
  await record(f,call,'email.complained');assert.equal((await f.merchant(f.path+'/recipients')).items[0].delivery.state,'complained');
  const summary=(await f.merchant(f.path+'/publication')).publication.deliverySummary;assert.equal(summary.delivered,1);assert.equal(summary.complained,1);
});

test('holds, future schedules, expired leases and forged completion cannot cause campaign sends',async t=>{
  const f=await fixture(t);await f.addBuyer(1);const result=await f.publish({...f.intent(),scheduledAt:new Date(Date.now()+3600000).toISOString()});assert.equal(result.status,200,result.error);
  assert.equal((await f.drain()).processed,0);for(const settings of [{COMMERCE_CAMPAIGN_SEND:'off'},{COMMERCE_EMAIL_SEND:'off'},{COMMERCE_STORAGE:'legacy'}])assert.deepEqual(await dispatchCampaignEmails({...f.env,...settings},2,f.fetcher),{processed:0,failed:0,held:true});
  assert.equal((await f.call('/internal/commerce/campaigns/drain',{environment:'production'})).status,422);assert.equal((await f.call('/internal/commerce/campaigns/drain',{environment:'sandbox',limit:3})).status,422);
  await f.ready();const job=(await claimCommerceJobs(f.env,{environment:'sandbox',workerId:'expired_campaign',kinds:['campaign.send'],limit:1,leaseSeconds:120}))[0];
  await assert.rejects(finishCommerceJob(f.env,job.id,{environment:'sandbox',workerId:'expired_campaign',leaseToken:job.leaseToken,outcome:'succeeded'}),e=>e.status===409);
  await assert.rejects(f.db.prepare("UPDATE commerce_jobs SET state='succeeded' WHERE id=?").bind(job.id).run(),/campaign_delivery_receipt_required/);
  await f.db.prepare("UPDATE commerce_jobs SET lease_until='2000-01-01T00:00:00.000Z' WHERE id=?").bind(job.id).run();await assert.rejects(deliverCampaignEmailJob(f.env,job,'expired_campaign',f.fetcher));
  assert.equal(f.control.calls.length,0);assert.equal(await f.count('commerce_unsubscribe_tokens'),0);
});

test('two campaign messages fit the D1 invocation budget and have a separate held cron',async t=>{
  const f=await fixture(t);await f.addBuyer(1);await f.addBuyer(2);await published(f);let queries=0;
  const wrap=statement=>new Proxy(statement,{get(target,property){if(property==='bind')return(...args)=>wrap(target.bind(...args));if(['first','all','run','raw'].includes(property))return(...args)=>{queries++;return target[property](...args);};const value=Reflect.get(target,property);return typeof value==='function'?value.bind(target):value;}});
  const db=new Proxy(f.db,{get(target,property){if(property==='prepare')return sql=>wrap(target.prepare(sql));if(property==='batch')return statements=>{queries+=statements.length;return target.batch(statements);};const value=Reflect.get(target,property);return typeof value==='function'?value.bind(target):value;}});
  const result=await dispatchCampaignEmails({...f.env,DB:db},2,f.fetcher);assert.equal(result.processed,2,JSON.stringify({result,jobs:await f.jobs()}));assert(queries<=50,'D1 queries: '+queries);
  const tasks=[];await worker.scheduled({cron:'*/3 * * * *'},{...f.env,COMMERCE_CAMPAIGN_SEND:'off'},{waitUntil:promise=>tasks.push(promise)});assert.equal(tasks.length,1);await Promise.all(tasks);assert.equal(f.control.calls.length,2);
});

test('migration preserves existing transactional receipts, consent and orders, including their suppression evidence',async t=>{
  const f=await fixture(t,{through:35});await f.addBuyer(1);await f.makeNotification();
  f.control.users.alice={id:'alice',email:'buyer1@example.test',email_confirmed_at:'2026-09-01T00:00:00Z'};
  await f.db.prepare("CREATE VIEW commerce_email_suppressions AS SELECT x.commerce_environment,x.email_hash FROM commerce_email_requests x JOIN commerce_email_delivery_evidence e ON e.request_id=x.id WHERE e.kind IN ('bounced','complained','suppressed')").run();
  assert.equal((await dispatchEmails(f.env,2,f.fetcher)).processed,1);await record(f,f.control.calls[0],'email.bounced');await f.db.prepare('DROP VIEW commerce_email_suppressions').run();
  const tables=['commerce_email_requests','commerce_email_starts','commerce_email_events','commerce_email_provider_bindings','commerce_customer_consents','commerce_campaigns','orders'];
  const before=await Promise.all(tables.map(name=>f.db.prepare('SELECT * FROM '+name+' ORDER BY rowid').all()));await applyCommerceSchema(f.db,35,36);
  for(let i=0;i<tables.length;i++)assert.deepEqual((await f.db.prepare('SELECT * FROM '+tables[i]+' ORDER BY rowid').all()).results,before[i].results);
  assert.equal((await f.db.prepare('PRAGMA foreign_key_check').all()).results.length,0);await published(f);assert.equal((await dispatchCampaignEmails(f.env,2,f.fetcher)).processed,1);assert.equal(f.control.calls.length,1);
  assert.equal((await f.db.prepare('SELECT reason FROM commerce_campaign_email_skips').first()).reason,'suppressed');
});

test('lost preparation acknowledgements retain one token/message, while a failed batch rolls both back',async t=>{
  for(const failure of ['committed','rollback'])await t.test(failure,async t=>{
    const f=await fixture(t);await f.addBuyer(1);await published(f);let intercepted=false;
    const db=new Proxy(f.db,{get(target,property){if(property==='batch')return async statements=>{
      if(!intercepted&&statements.length===2){intercepted=true;
        if(failure==='rollback')return target.batch([...statements,target.prepare('INSERT INTO commerce_unsubscribe_tokens SELECT * FROM commerce_unsubscribe_tokens LIMIT 1')]);
        await target.batch(statements);throw Error('Fixture lost preparation acknowledgement after commit');
      }return target.batch(statements);
    };const value=Reflect.get(target,property);return typeof value==='function'?value.bind(target):value;}});
    assert.equal((await dispatchCampaignEmails({...f.env,DB:db},2,f.fetcher)).failed,1);assert.equal(f.control.calls.length,0);
    assert.equal(await f.count('commerce_unsubscribe_tokens'),failure==='committed'?1:0);assert.equal(await f.count('commerce_campaign_email_requests'),failure==='committed'?1:0);
    await f.ready();assert.equal((await dispatchCampaignEmails(f.env,2,f.fetcher)).processed,1);assert.equal(await f.count('commerce_unsubscribe_tokens'),1);assert.equal(await f.count('commerce_campaign_email_requests'),1);assert.equal(f.control.calls.length,1);
  });
});

test('cancellation during a batch preserves the submitted message and skips the next claimed recipient',async t=>{
  const f=await fixture(t);await f.addBuyer(1);await f.addBuyer(2);await published(f);
  f.control.sendHook=async()=>{const action=await f.action('cancel');assert.equal(action.status,200,action.error);};
  assert.equal((await dispatchCampaignEmails(f.env,2,f.fetcher)).processed,2);assert.equal(f.control.calls.length,1);
  const publication=(await f.merchant(f.path+'/publication')).publication;assert.equal(publication.cancelled,true);assert.equal(publication.summary.cancelled,1);assert.equal(publication.deliverySummary.submitted,1);
  const statuses=(await f.merchant(f.path+'/recipients')).items.map(i=>i.delivery.state).sort();assert.deepEqual(statuses,['cancelled','submitted']);
  assert.equal(await f.count('commerce_unsubscribe_tokens'),1);assert.equal(await f.count('commerce_campaign_email_starts'),1);
});

test('rate limits reuse the original key, permanent rejections stay visible and exhausted leases stop automatically',async t=>{
  for(const condition of ['rate','rejected','exhausted'])await t.test(condition,async t=>{
    const f=await fixture(t);await f.addBuyer(1);await published(f);
    if(condition==='exhausted')await f.db.prepare("UPDATE commerce_jobs SET maximum_attempts=1 WHERE kind='campaign.send'").run();
    f.control.outcomes.push(condition==='exhausted'?'lost':condition);assert.equal((await dispatchCampaignEmails(f.env,2,f.fetcher)).failed,1);assert.equal(await f.count('commerce_campaign_email_provider_bindings'),0);
    assert.equal((await f.jobs())[0].state,condition==='rate'?'uncertain':'dead');await f.ready();
    if(condition==='rate'){assert.equal((await dispatchCampaignEmails(f.env,2,f.fetcher)).processed,1);assert.equal(f.control.calls[0].key,f.control.calls[1].key);assert.equal(f.control.calls[0].body,f.control.calls[1].body);}
    else{assert.equal((await dispatchCampaignEmails(f.env,2,f.fetcher)).processed,0);assert.equal(f.control.calls.length,1);assert.equal((await f.merchant(f.path+'/recipients')).items[0].delivery.needsReview,true);}
  });
});
