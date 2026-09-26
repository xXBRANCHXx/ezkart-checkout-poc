import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {campaignDeliveryFixture} from './campaign-delivery-fixture.mjs';
import {publicationKey as key,publicationBase} from './campaign-publication-fixture.mjs';
import {lookupCampaignEmail,resolveCampaignEmail,campaignEmailInvestigations,lookupEmail} from '../src/email-investigation.js';
import {dispatchCampaignEmails} from '../src/campaign-email-delivery.js';
import {dispatchEmails,recordEmailWebhook} from '../src/commerce-email-delivery.js';
import {emailFixtureEvent,emailFixtureCallback} from './email-fixture.mjs';
import {applyCommerceSchema} from './commerce-schema.mjs';

const base='/internal/commerce/campaigns',tables=['commerce_campaign_email_lookups','commerce_campaign_email_lookup_results','commerce_campaign_email_lookup_bindings','commerce_campaign_email_resolutions'];
async function fixture(t,options={}){
  const f=await campaignDeliveryFixture(t,{...options,bindings:{COMMERCE_EMAIL_RECONCILE:'enabled',RESEND_READ_API_KEY:'re_fixture_campaign_reader',...options.bindings}});
  const job=x=>f.db.prepare('SELECT * FROM commerce_jobs WHERE id=?').bind(x.job_id).first();
  const input=x=>({environment:'sandbox',requestId:x.id,providerId:f.control.calls.find(c=>c.body===x.request_json).id,lookupKey:key(),operator:'fixture_operator'});
  const resolveInput=async(x,lookupKey)=>({environment:'sandbox',requestId:x.id,lookupKey,operator:'fixture_operator',resolutionKey:key(),expectedUpdatedAt:(await job(x)).updated_at});
  const lookup=input=>f.call(base+'/lookup',input),resolve=input=>f.call(base+'/resolve',input);
  const start=async({lost=true}={})=>{
    const result=await f.publish();assert.equal(result.status,200,JSON.stringify(result));if(lost)f.control.outcomes.push('lost');
    await f.drain();return f.db.prepare('SELECT * FROM commerce_campaign_email_requests ORDER BY rowid LIMIT 1').first();
  };
  const record=(call,id=call.id,type='email.delivered')=>recordEmailWebhook(emailFixtureCallback(emailFixtureEvent(call.message,id,type)),f.env,'test_mail');
  return {...f,job,input,resolveInput,lookup,resolve,start,record};
}

test('campaign investigations recover an uncertain submission after withdrawal or cancellation without resending or changing consent',async t=>{
  for(const action of ['withdraw','cancel'])await t.test(action,async t=>{
    const f=await fixture(t),buyer=await f.addBuyer(1),x=await f.start();assert.equal((await f.job(x)).state,'uncertain');
    if(action==='withdraw')await f.decline(buyer.grant);else assert.equal((await f.action('cancel')).status,200);
    await f.ready();assert.equal((await f.drain()).failed,1);assert.equal((await f.job(x)).state,'dead');
    const preserved=['commerce_campaign_email_requests','commerce_campaign_email_starts','commerce_campaign_email_skips','commerce_job_attempts','commerce_unsubscribe_tokens','commerce_customer_consents','commerce_campaign_publication_actions'];
    const before=await Promise.all(preserved.map(name=>f.db.prepare('SELECT * FROM '+name+' ORDER BY rowid').all()));
    const intent=f.input(x),held={...f.env,COMMERCE_EMAIL_SEND:'off',COMMERCE_CAMPAIGN_SEND:'off',SUPABASE_SERVICE_ROLE_KEY:''};
    const found=await lookupCampaignEmail(held,intent,f.fetcher);assert.equal(found.receipt.outcome,'matched');assert.equal(found.receipt.kind,'delivered');
    const resolve=await f.resolveInput(x,intent.lookupKey),done=await f.resolve(resolve);assert.equal(done.status,200,JSON.stringify(done));
    assert.equal((await f.resolve(resolve)).replayed,true);assert.equal((await f.lookup(intent)).replayed,true);assert.equal(f.control.reads.length,1);
    assert.equal((await f.job(x)).state,'succeeded');assert.equal((await f.drain()).processed,0);assert.equal(f.control.calls.length,1);assert.equal(f.control.lookups.length,1);
    for(let i=0;i<preserved.length;i++)assert.deepEqual((await f.db.prepare('SELECT * FROM '+preserved[i]+' ORDER BY rowid').all()).results,before[i].results,preserved[i]);
    const recipient=(await f.merchant(f.path+'/recipients')).items[0].delivery;assert.equal(recipient.state,'delivered');assert.equal(recipient.needsReview,false);assert.equal(recipient.deliveredAt,null);assert(recipient.checkedAt&&recipient.resolvedAt);
    const summary=(await f.merchant(f.path+'/publication')).publication.deliverySummary;assert.equal(summary.delivered,1);assert.equal(summary.submitted,1);assert.equal(summary.needsReview,0);
    assert.equal((await f.resolve({...resolve,resolutionKey:key()})).status,409);
  });
});

test('campaign-purpose identity is mandatory in provider lookup evidence and cannot be forged directly in D1',async t=>{
  const f=await fixture(t);await f.addBuyer(1);const x=await f.start(),intent=f.input(x);
  for(const tags of [m=>m.tags.filter(t=>t.name!=='ezkart_purpose'),m=>m.tags.map(t=>t.name==='ezkart_purpose'?{...t,value:'order'}:t),m=>[...m.tags.slice(0,3),m.tags[0]]]){
    f.control.read=data=>Response.json({...data,tags:tags(data)});const result=await f.lookup({...intent,lookupKey:key()});assert.equal(result.receipt?.outcome,'mismatch',JSON.stringify(result));
    assert.equal(await f.count('commerce_campaign_email_lookup_bindings'),0);assert.equal((await f.job(x)).state,'uncertain');
  }
  assert.equal((await f.lookup({...intent,lookupKey:key()})).status,429);assert.equal(f.control.reads.length,3);
});

test('missing or unreadable provider evidence preserves campaign uncertainty and never creates another send',async t=>{
  const f=await fixture(t);await f.addBuyer(1);const x=await f.start();
  for(const [response,outcome] of [[()=>Response.json({message:'missing'},{status:404}),'not_found'],[()=>Response.json({message:'temporarily unavailable'},{status:503}),'unavailable'],[()=>Response.json({message:'denied'},{status:403}),'rejected']]){
    f.control.read=response;const input=f.input(x),r=await f.lookup(input);assert.equal(r.receipt?.outcome,outcome,JSON.stringify(r));assert.equal((await f.resolve(await f.resolveInput(x,input.lookupKey))).status,409);
    assert.equal((await f.job(x)).state,'uncertain');assert.equal(await f.count('commerce_campaign_email_lookup_bindings'),0);
    assert.equal((await f.lookup(input)).replayed,true);
  }
  assert.equal(f.control.calls.length,1);assert.equal(f.control.reads.length,3);
});

test('campaign service routes enforce scope, strict signed bodies, connection identity and held reconciliation',async t=>{
  const f=await fixture(t);await f.addBuyer(1);const x=await f.start(),intent=f.input(x),path=base+'/lookup';
  const unauth=await f.mf.dispatchFetch('https://fixture.test'+path,{method:'POST',body:JSON.stringify(intent)});assert.equal(unauth.status,401);
  for(const raw of ['{"environment":"sandbox","environment":"sandbox"}',JSON.stringify({...intent,padding:'x'.repeat(3000)}),new Uint8Array([255])]){
    const r=await f.mf.dispatchFetch('https://fixture.test'+path,{method:'POST',body:raw,headers:f.headers(path,'POST',raw)});assert.equal(r.status,raw.length>3000?413:422);
  }
  for(const change of [{environment:'production'},{requestId:'email_'+'a'.repeat(32)},{operator:'invalid operator'},{providerId:'https://evil.test'},{unexpected:'x'}])assert((await f.lookup({...intent,...change})).status>=400);
  assert.equal((await f.call('/internal/commerce/email/lookup',intent)).status,422);
  assert.equal((await f.call(base+'/lookup?environment=sandbox',intent)).status,422);
  assert.equal((await f.call(base+'/investigations?environment=sandbox&environment=sandbox')).status,422);
  for(const bindings of [{RESEND_API_KEY:'re_fixture_different_connection'},{COMMERCE_EMAIL_PROFILE:'other_profile'}])await assert.rejects(lookupCampaignEmail({...f.env,...bindings},intent,f.fetcher),e=>e.status===409);
  for(const bindings of [{COMMERCE_EMAIL_RECONCILE:'off'},{COMMERCE_STORAGE:'legacy'}])await assert.rejects(lookupCampaignEmail({...f.env,...bindings},intent,f.fetcher),e=>e.status===503);
  assert.equal(f.control.reads.length,0);
  const result=await f.lookup(intent);assert.equal(result.receipt.outcome,'matched');assert.equal((await f.lookup({...intent,operator:'other_operator'})).status,409);
  assert.equal((await lookupCampaignEmail({...f.env,COMMERCE_EMAIL_RECONCILE:'off',RESEND_API_KEY:'re_fixture_different_connection'},intent,f.fetcher)).replayed,true);
  assert.equal((await f.lookup({...intent,lookupKey:key(),providerId:randomUUID()})).status,409);
});

test('concurrent campaign lookups and lost resolution acknowledgements recover one immutable outcome',async t=>{
  const f=await fixture(t);await f.addBuyer(1);const x=await f.start(),intent=f.input(x);
  const both=await Promise.all([f.lookup(intent),f.lookup(intent)]);assert(both.every(r=>r.status===200&&r.receipt.outcome==='matched'),JSON.stringify(both));assert.equal(await f.count('commerce_campaign_email_lookup_results'),1);
  let lost=false;const db=new Proxy(f.db,{get(target,p){if(p==='prepare')return sql=>{const s=target.prepare(sql);if(!sql.includes('INSERT INTO commerce_campaign_email_resolutions'))return s;
    return {bind(...args){return {async run(){const r=await s.bind(...args).run();if(!lost){lost=true;throw Error('Fixture lost committed resolution acknowledgement');}return r;}};}};};const v=Reflect.get(target,p);return typeof v==='function'?v.bind(target):v;}});
  const intent2=await f.resolveInput(x,intent.lookupKey),r=await resolveCampaignEmail({...f.env,DB:db},intent2);assert.equal(r.replayed,true);assert.equal(await f.count('commerce_campaign_email_resolutions'),1);
  assert.equal((await f.job(x)).state,'succeeded');assert.equal(f.control.calls.length,1);
  for(const table of tables){const row=await f.db.prepare('SELECT * FROM '+table+' LIMIT 1').first(),column=Object.keys(row)[0];
    await assert.rejects(f.db.prepare('UPDATE '+table+' SET '+column+'='+column).run(),/email_immutable/);
    await assert.rejects(f.db.prepare('DELETE FROM '+table).run(),/email_immutable/);
    await assert.rejects(f.db.prepare('INSERT OR REPLACE INTO '+table+' SELECT * FROM '+table+' LIMIT 1').run(),/email_immutable|email_resolution_invalid/);
  }
});

test('an unfinished campaign lookup retains its reader connection and exact intent after database failure',async t=>{
  const f=await fixture(t);await f.addBuyer(1);const x=await f.start(),intent=f.input(x);
  const db=new Proxy(f.db,{get(target,p){if(p==='prepare')return sql=>{const s=target.prepare(sql);if(!sql.includes('INSERT INTO commerce_campaign_email_lookup_results'))return s;return {bind(){return {async run(){throw Error('Fixture result write failed');}};}};};const v=Reflect.get(target,p);return typeof v==='function'?v.bind(target):v;}});
  await assert.rejects(lookupCampaignEmail({...f.env,DB:db},intent,f.fetcher),/Fixture result write failed/);assert.equal(await f.count('commerce_campaign_email_lookups'),1);assert.equal(await f.count('commerce_campaign_email_lookup_results'),0);
  await assert.rejects(lookupCampaignEmail({...f.env,RESEND_READ_API_KEY:'re_fixture_changed_reader'},intent,f.fetcher),e=>e.status===409);assert.equal(f.control.reads.length,1);
  assert.equal((await f.lookup(intent)).receipt.outcome,'matched');assert.equal(f.control.reads.length,2);assert.equal(f.control.calls.length,1);
});

test('callback identity races keep the first campaign binding and record conflicting lookup evidence',async t=>{
  const f=await fixture(t);await f.addBuyer(1);const x=await f.start(),intent=f.input(x),other=randomUUID();
  f.control.readHook=()=>f.record(f.control.calls[0],other);
  const r=await f.lookup(intent);assert.equal(r.receipt?.outcome,'conflict',JSON.stringify(r));assert.equal((await f.resolve(await f.resolveInput(x,intent.lookupKey))).status,409);
  assert.equal((await f.db.prepare('SELECT provider_id FROM commerce_campaign_email_verified_bindings WHERE request_id=?').bind(x.id).first()).provider_id,other);
  assert((await f.db.prepare('SELECT raw_body FROM commerce_campaign_email_lookup_results').first()).raw_body.includes(intent.providerId));
});

test('verified campaign lookup evidence prevents another submission before or during an automatic retry',async t=>{
  for(const timing of ['before_claim','before_start'])await t.test(timing,async t=>{
    const f=await fixture(t);await f.addBuyer(1);const x=await f.start(),input=f.input(x);await f.ready();
    const lookup=async()=>{assert.equal((await lookupCampaignEmail(f.env,input,f.fetcher)).receipt.outcome,'matched');};
    if(timing==='before_claim')await lookup();else f.control.identityHook=lookup;
    const result=await dispatchCampaignEmails(f.env,2,f.fetcher);assert.equal(result.processed,1,JSON.stringify(result));assert.equal((await f.job(x)).state,'succeeded');
    assert.equal(f.control.calls.length,1);assert.equal(await f.count('commerce_campaign_email_starts'),1);assert.equal(await f.count('commerce_campaign_email_resolutions'),0);
    assert.equal((await f.merchant(f.path+'/recipients')).items[0].delivery.needsReview,false);
  });
});

test('verified campaign and transactional lookups cannot share provider IDs, including a cross-purpose callback race',async t=>{
  for(const first of ['campaign','transactional','race'])await t.test(first,async t=>{
    const f=await fixture(t);await f.addBuyer(1);const x=await f.start(),input=f.input(x);
    if(first==='campaign')assert.equal((await f.lookup(input)).receipt.outcome,'matched');
    await f.makeNotification();f.control.forcedId=input.providerId;
    const send=()=>dispatchEmails(f.env,2,f.fetcher);
    if(first==='race'){
      f.control.readHook=send;const result=await f.lookup(input);assert.equal(result.receipt.outcome,'conflict');
    }else{
      f.control.outcomes.push('lost');await send();const n=await f.db.prepare('SELECT * FROM commerce_email_requests').first();
      const transaction={...input,requestId:n.id,lookupKey:key()};
      if(first==='campaign')await assert.rejects(lookupEmail(f.env,transaction,f.fetcher),e=>e.status===409);
      else{
        f.control.read=()=>{const c=f.control.calls.at(-1);return Response.json({object:'email',id:c.id,...c.message,created_at:c.createdAt,last_event:'delivered'});};
        assert.equal((await lookupEmail(f.env,transaction,f.fetcher)).receipt.outcome,'matched');assert.equal((await f.lookup(input)).status,409);
        await assert.rejects(f.record(f.control.calls[0]),e=>e.status===409);
      }
    }
    const bound=await f.db.prepare('SELECT request_id FROM commerce_all_email_bindings WHERE provider_id=?').bind(input.providerId).all();assert.equal(bound.results.length,1);
    assert.equal(bound.results[0].request_id.startsWith('campmail_'),first==='campaign');
  });
});

test('lookup bounce evidence suppresses both email purposes and preserves delivered evidence and real callback times',async t=>{
  const f=await fixture(t);await f.addBuyer(1);const x=await f.start({lost:false}),input=f.input(x);
  assert.equal((await f.lookup(input)).receipt.kind,'delivered');assert.equal((await f.merchant(f.path+'/recipients')).items[0].delivery.deliveredAt,null);
  await f.record(f.control.calls[0]);assert((await f.merchant(f.path+'/recipients')).items[0].delivery.deliveredAt);
  f.control.read=data=>Response.json({...data,last_event:'bounced'});assert.equal((await f.lookup({...input,lookupKey:key()})).receipt.kind,'bounced');
  f.control.read=data=>Response.json({...data,last_event:'delivery_delayed'});await f.lookup({...input,lookupKey:key()});
  const summary=(await f.merchant(f.path+'/publication')).publication.deliverySummary;assert.equal(summary.bounced,1);assert.equal(summary.delivered,1);
  assert.equal((await f.merchant(f.path+'/recipients')).items[0].delivery.state,'bounced');
  const draft=await f.merchant(publicationBase,{id:null,revision:0,requestKey:key(),values:f.values},{method:'POST'});assert.equal(draft.status,200);
  assert.equal((await f.merchant(publicationBase+'/'+draft.campaign.id+'/publish',f.intent(),{method:'POST'})).status,200);await f.drain();assert.equal(f.control.calls.length,1);
  await f.makeNotification();f.control.users.alice={id:'alice',email:'buyer1@example.test',email_confirmed_at:'2026-09-01T00:00:00Z'};await dispatchEmails(f.env,2,f.fetcher);assert.equal(f.control.calls.length,1);
  assert.equal((await f.db.prepare('SELECT reason FROM commerce_campaign_email_skips').first()).reason,'suppressed');assert.equal((await f.db.prepare('SELECT reason FROM commerce_email_skips').first()).reason,'suppressed');
});

test('stale, active, unknown and conflicting campaign jobs cannot be cleared by a resolution',async t=>{
  const f=await fixture(t);await f.addBuyer(1);const x=await f.start(),lookup=f.input(x);await f.lookup(lookup);const resolve=await f.resolveInput(x,lookup.lookupKey);
  assert.equal((await f.resolve({...resolve,expectedUpdatedAt:'2000-01-01T00:00:00.000Z'})).status,409);
  for(const [state,result] of [['running',{}],['dead',{}],['dead',{errorCode:'email_evidence_conflict'}]]){
    await f.db.prepare('UPDATE commerce_jobs SET state=?,result_json=? WHERE id=?').bind(state,JSON.stringify(result),x.job_id).run();assert.equal((await f.resolve(resolve)).status,409);
  }
  await f.db.prepare("UPDATE commerce_jobs SET state='uncertain',result_json='{}' WHERE id=?").bind(x.job_id).run();const job=await f.job(x);
  await assert.rejects(f.db.prepare('INSERT INTO commerce_campaign_email_resolutions VALUES(?,?,?,?,?,?,?,?,?)').bind(key(),x.id,lookup.lookupKey,'fixture_operator',job.state,job.result_json,job.last_error,job.updated_at,new Date(Date.now()+6*60000).toISOString()).run(),/email_resolution_invalid/);
  assert.equal(await f.count('commerce_campaign_email_resolutions'),0);
});

test('campaign lookup result guards reject altered recipients and purpose tags and later callbacks must keep its identity',async t=>{
  const f=await fixture(t);await f.addBuyer(1);const x=await f.start(),input=f.input(x);await f.lookup(input);
  const r=await f.db.prepare('SELECT * FROM commerce_campaign_email_lookup_results').first(),second=key();
  await f.db.prepare('INSERT INTO commerce_campaign_email_lookups SELECT ?,request_id,provider_id,credential_hash,reader_hash,operator_id,created_at FROM commerce_campaign_email_lookups WHERE lookup_key=?').bind(second,input.lookupKey).run();
  const original=JSON.parse(r.raw_body);
  for(const data of [{...original,to:['someone@example.test']},{...original,tags:original.tags.filter(t=>t.name!=='ezkart_purpose')},{...original,tags:original.tags.map(t=>t.name==='ezkart_purpose'?{...t,value:'notification'}:t)}]){
    await assert.rejects(f.db.prepare('INSERT INTO commerce_campaign_email_lookup_results VALUES(?,?,?,?,?,?,?,?)').bind(second,'matched',200,JSON.stringify(data),r.body_hash,r.kind,r.provider_created_at,r.observed_at).run(),/email_lookup_invalid/);
  }
  await assert.rejects(f.record(f.control.calls[0],randomUUID()),e=>e.status===409);await f.record(f.control.calls[0]);
  assert.equal((await f.db.prepare('SELECT COUNT(*) AS n FROM commerce_campaign_email_verified_bindings WHERE request_id=?').bind(x.id).first()).n,1);
});

test('campaign operator paging is purpose-bound and private, while both purposes share the global lookup limit',async t=>{
  const f=await fixture(t,{bindings:{COMMERCE_EMAIL_TEST_RECIPIENTS:JSON.stringify(Array.from({length:20},(_,i)=>'buyer'+(i+1)+'@example.test'))}});
  for(let i=1;i<=20;i++)await f.addBuyer(i);assert.equal((await f.publish()).status,200);for(let i=0;i<10;i++)await f.drain();
  const another=async()=>{
    const draft=await f.merchant(publicationBase,{id:null,revision:0,requestKey:key(),values:{...f.values,audience:{...f.values.audience,q:'buyer1@example.test'}}},{method:'POST'});
    assert.equal((await f.merchant(publicationBase+'/'+draft.campaign.id+'/publish',f.intent(),{method:'POST'})).status,200);await f.drain();
  };
  await another();
  const url=base+'/investigations?environment=sandbox&state=all',first=await f.call(url);assert.equal(first.items.length,20);assert(first.nextCursor);
  await another();
  const last=await f.call(url+'&cursor='+first.nextCursor);assert.equal(last.items.length,1);assert.equal(last.nextCursor,null);assert.equal(new Set([...first.items,...last.items].map(r=>r.id)).size,21);
  assert.equal((await f.call(base+'/investigations?environment=sandbox&cursor='+first.nextCursor)).status,422);
  await assert.rejects(campaignEmailInvestigations(f.env,new URL('https://fixture.test/?environment=sandbox&cursor=bad')),e=>e.status===422);
  const x=await f.db.prepare('SELECT * FROM commerce_campaign_email_requests ORDER BY rowid LIMIT 1').first(),input=f.input(x);await f.lookup(input);
  for(let i=0;i<21;i++)await f.db.prepare('INSERT INTO commerce_campaign_email_lookups SELECT ?,request_id,provider_id,credential_hash,reader_hash,operator_id,? FROM commerce_campaign_email_lookups WHERE lookup_key=?').bind(key(),new Date(Date.now()-120000+i).toISOString(),input.lookupKey).run();
  const detailPath=base+'/investigations/'+x.id+'?environment=sandbox',detail=await f.call(detailPath);assert.equal(detail.lookups.length,20);assert(detail.nextCursor);
  const more=await f.call(detailPath+'&cursor='+detail.nextCursor);assert.equal(more.lookups.length,2);assert.equal(more.nextCursor,null);
  assert.equal((await f.call(base+'/investigations/'+first.items[0].id+'?environment=sandbox&cursor='+detail.nextCursor)).status,422);
  for(const value of [first,last,detail,more]){const raw=JSON.stringify(value);assert(!raw.includes('@example.test'));assert(!raw.includes('unsubscribe.php'));assert(!raw.includes('re_fixture'));assert(!raw.includes('<html'));}
  const requests=(await f.db.prepare('SELECT * FROM commerce_campaign_email_requests ORDER BY rowid LIMIT 21').all()).results;
  for(const request of requests.slice(0,20)){
    const current=(await f.db.prepare("SELECT COUNT(*) AS n FROM commerce_campaign_email_lookups WHERE request_id=? AND created_at>=strftime('%Y-%m-%dT%H:%M:%fZ','now','-1 minute')").bind(request.id).first()).n;
    for(let i=current;i<3;i++)await f.db.prepare('INSERT INTO commerce_campaign_email_lookups SELECT ?,?,?,?,reader_hash,operator_id,? FROM commerce_campaign_email_lookups WHERE lookup_key=?')
      .bind(key(),request.id,f.input(request).providerId,request.credential_hash,new Date().toISOString(),input.lookupKey).run();
  }
  assert.equal((await f.lookup(f.input(requests.at(-1)))).status,429);assert.equal((await f.lookup(input)).replayed,true);
  await f.makeNotification();await dispatchEmails({...f.env,COMMERCE_EMAIL_TEST_RECIPIENTS:'["alice@example.test"]'},2,f.fetcher);
  const notification=await f.db.prepare('SELECT * FROM commerce_email_requests').first();assert(notification);
  await assert.rejects(lookupEmail(f.env,{...input,requestId:notification.id,providerId:f.control.calls.at(-1).id,lookupKey:key()},f.fetcher),e=>e.status===429);
});

test('migration 0037 preserves populated campaign and transactional evidence and adds recovery without rewriting old records',async t=>{
  const f=await fixture(t,{through:36}),oldView=(await f.db.prepare("SELECT sql FROM sqlite_master WHERE name='commerce_campaign_delivery_status'").first()).sql;
  // Current readers need the new fields while seeding the old immutable tables.
  await f.db.prepare('DROP VIEW commerce_campaign_delivery_status').run();
  await f.db.prepare(oldView.replace(' AS delivered_at\n',' AS delivered_at,EXISTS(SELECT 1 FROM commerce_campaign_email_events e WHERE e.request_id=x.id AND e.kind=\'delivered\') AS delivered_confirmed,NULL AS checked_at,NULL AS resolved_at\n')).run();
  await f.db.prepare('CREATE VIEW commerce_campaign_email_verified_bindings AS SELECT request_id,commerce_environment,profile_id,provider_id,created_at FROM commerce_campaign_email_provider_bindings').run();
  await f.addBuyer(1);const x=await f.start({lost:false});await f.record(f.control.calls[0]);await f.makeNotification();await dispatchEmails(f.env,2,f.fetcher);
  const n=await f.db.prepare('SELECT * FROM commerce_email_requests').first(),nc=f.control.calls.at(-1);
  assert.equal((await lookupEmail(f.env,{environment:'sandbox',requestId:n.id,providerId:nc.id,lookupKey:key(),operator:'fixture_operator'},f.fetcher)).receipt.outcome,'matched');
  await f.db.prepare('DROP VIEW commerce_campaign_email_verified_bindings').run();await f.db.prepare('DROP VIEW commerce_campaign_delivery_status').run();await f.db.prepare(oldView).run();
  const names=(await f.db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' AND name NOT GLOB '_*' ORDER BY name").all()).results.map(r=>r.name);
  const before=await Promise.all(names.map(n=>f.db.prepare('SELECT * FROM "'+n+'" ORDER BY rowid').all()));await applyCommerceSchema(f.db,36,37);
  for(let i=0;i<names.length;i++)assert.deepEqual((await f.db.prepare('SELECT * FROM "'+names[i]+'" ORDER BY rowid').all()).results,before[i].results,names[i]);
  assert.equal((await f.db.prepare('PRAGMA foreign_key_check').all()).results.length,0);for(const name of tables)assert.equal(await f.count(name),0);
  assert.equal((await f.lookup(f.input(x))).receipt.outcome,'matched');const recipient=(await f.merchant(f.path+'/recipients')).items[0].delivery;assert.equal(recipient.state,'delivered');assert(recipient.deliveredAt&&recipient.checkedAt);
});
