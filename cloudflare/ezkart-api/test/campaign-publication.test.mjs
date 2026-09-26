import test from 'node:test';
import assert from 'node:assert/strict';
import {campaignPublicationFixture,publicationKey,publicationBase,publicationActor} from './campaign-publication-fixture.mjs';
import {publishCampaign,changePublication,readPublication,publicationRecipients} from '../src/campaign-publication.js';
import {grantCampaignConsent} from './campaign-unsubscribe-fixture.mjs';
import {applyCommerceSchema} from './commerce-schema.mjs';
const count=async(f,table)=>(await f.db.prepare('SELECT COUNT(*) AS n FROM '+table).first()).n;
const future=(hours=1)=>new Date(Date.now()+hours*3600000).toISOString();
const read=f=>f.merchant(f.path+'/publication');
const decline=async(f,grant)=>{
  const input={...grant.input,revision:1,allow:false,requestKey:publicationKey(),statement:`I withdraw permission for promotional emails from alice at ${grant.input.email}. Order and delivery updates are unaffected.`};
  const result=await f.call('/internal/commerce/customer-consents',input);assert.equal(result.status,200,result.error);
};
test('publication freezes one authorized campaign and consent audience atomically, survives concurrent retries and never sends email',async t=>{
  const f=await campaignPublicationFixture(t),one=await f.addBuyer(1),two=await f.addBuyer(2),withdrawn=await f.addBuyer(3);await f.addBuyer(4,{consent:false});await decline(f,withdrawn.grant);
  const input=f.intent(),results=await Promise.all([f.publish(input),f.publish(input)]);assert.deepEqual(results.map(r=>r.status),[200,200],JSON.stringify(results));
  assert.equal(await count(f,'commerce_campaign_publications'),1);assert.equal(await count(f,'commerce_campaign_seals'),1);assert.equal(await count(f,'commerce_campaign_candidates'),2);
  const p=results[0].publication;assert.equal(p.candidateCount,2);assert.equal(p.revision,0);assert.equal(p.cancelled,false);assert.equal(p.storeName,'alice');assert.equal(p.summary.queued,2);
  const recipients=await f.merchant(f.path+'/recipients');assert.deepEqual(recipients.items.map(r=>r.email).sort(),[one.buyer.email,two.buyer.email]);assert(recipients.items.every(r=>r.state==='queued'&&r.consentRevision===1));
  const jobs=await f.db.prepare("SELECT * FROM commerce_jobs WHERE kind='campaign.send'").all();assert.equal(jobs.results.length,2);assert(jobs.results.every(j=>j.available_at===p.scheduledAt&&j.order_id===null&&j.attempts===0));
  await f.merchant(publicationBase,{id:f.id,revision:1,requestKey:publicationKey(),values:{...f.values,subject:'A later edit',archived:true}},{method:'POST'});
  await f.db.prepare("UPDATE sellers SET name='Renamed store' WHERE id='seller_alice'").run();await decline(f,one.grant);
  const replay=await f.publish(input);assert.equal(replay.status,200,replay.error);assert.equal(replay.receipt.replayed,true);assert.equal(replay.publication.campaignRevision,1);assert.equal(replay.publication.values.subject,f.values.subject);assert.equal(replay.publication.storeName,'alice');assert.equal(replay.publication.candidateCount,2);
  assert.equal((await f.publish({...input,revision:2})).code,'campaign_publication_reference');assert.equal((await f.publish(f.intent())).code,'campaign_already_published');
  assert.equal(await count(f,'commerce_unsubscribe_tokens'),0);assert.equal(await count(f,'commerce_email_requests'),0);
  const claim=await f.call('/internal/commerce/jobs/claim',{environment:'sandbox',workerId:'fixture_worker',kinds:['campaign.send']});assert.equal(claim.status,422);
  await assert.rejects(f.db.prepare("UPDATE commerce_jobs SET state='succeeded' WHERE kind='campaign.send'").run(),/campaign_delivery_receipt_required/);
  await assert.rejects(f.db.prepare("DELETE FROM commerce_jobs WHERE kind='campaign.send'").run(),/campaign_job_immutable/);
});

test('empty or incomplete audiences roll back publication and jobs; a valid original intent can later publish after review',async t=>{
  const f=await campaignPublicationFixture(t),input=f.intent();let result=await f.publish(input);assert.equal(result.status,422,JSON.stringify(result));assert.equal(result.code,'campaign_audience_empty');
  for(const table of ['commerce_campaign_publications','commerce_campaign_candidates','commerce_campaign_seals'])assert.equal(await count(f,table),0);
  await f.addBuyer(1,{consent:false});result=await f.publish(input);assert.equal(result.status,422);
  await grantCampaignConsent(f,{buyer:{id:'campaign-buyer-1',email:'buyer1@example.test'}});result=await f.publish(input);assert.equal(result.status,200,result.error);assert.equal(result.publication.candidateCount,1);
  const other=await f.merchant(publicationBase,{id:null,revision:0,requestKey:publicationKey(),values:{...f.values,subject:''}},{method:'POST'});assert.equal(other.status,200);
  const denied=await f.merchant(publicationBase+'/'+other.campaign.id+'/publish',f.intent(),{method:'POST'});assert.equal(denied.status,422);assert.equal(await count(f,'commerce_campaign_publications'),1);
});

test('rescheduling moves every unstarted job atomically, conflicts preserve the winning revision and cancellation is final and replayable while held',async t=>{
  const f=await campaignPublicationFixture(t);await f.addBuyer(1);await f.addBuyer(2);const input={...f.intent(),scheduledAt:future(1)},published=await f.publish(input);assert.equal(published.status,200,published.error);
  const changes=await Promise.all([f.action('reschedule',0,future(2)),f.action('reschedule',0,future(3))]);assert.deepEqual(changes.map(r=>r.status).sort(),[200,409]);
  const winner=changes.find(r=>r.status===200).publication;assert.equal(winner.revision,1);assert((await f.db.prepare("SELECT available_at FROM commerce_jobs WHERE kind='campaign.send'").all()).results.every(j=>j.available_at===winner.scheduledAt));
  const cancel={kind:'cancel',revision:1,scheduledAt:null,requestKey:publicationKey()},held={...f.env,COMMERCE_STORAGE:'legacy',COMMERCE_EMAIL_SEND:'off',COMMERCE_CAMPAIGN_SEND:'off'};
  const saved=await changePublication(held,publicationActor,f.id,cancel);assert.equal(saved.publication.cancelled,true);assert.equal(saved.publication.scheduledAt,winner.scheduledAt);assert.equal(saved.publication.summary.cancelled,2);assert.equal(saved.publication.summary.attention,0);
  assert.equal((await changePublication(held,publicationActor,f.id,cancel)).receipt.replayed,true);assert.equal((await f.action('reschedule',2,future(4))).status,409);
  const replay=await publishCampaign(held,publicationActor,f.id,input);assert.equal(replay.receipt.replayed,true);assert.equal(replay.publication.cancelled,true);
  const history=await f.merchant(f.path+'/publication-history');assert.deepEqual(history.items.map(r=>r.kind),['cancel','reschedule','publish']);assert.equal(history.items[2].scheduledAt,published.publication.scheduledAt);
});

test('current membership, role, store and environment scope protect publication, receipts, candidates and changes',async t=>{
  const f=await campaignPublicationFixture(t);await f.addBuyer(1);const input=f.intent();assert.equal((await f.publish(input)).status,200);
  for(const suffix of ['/publication','/recipients','/publication-history'])assert.equal((await f.merchant(f.path+suffix,undefined,{seller:'bob'})).status,404);
  assert.equal((await f.merchant(f.path+'/publication-action',{kind:'cancel',revision:0,scheduledAt:null,requestKey:publicationKey()},{method:'POST',seller:'bob'})).status,404);
  await assert.rejects(readPublication({...f.env,APP_ENVIRONMENT:'production'},publicationActor,f.id,new URL('https://fixture.test/')),e=>e.status===404);
  await assert.rejects(publishCampaign({...f.env,APP_ENVIRONMENT:'production'},publicationActor,f.id,input),e=>e.status===409);
  await f.db.prepare("UPDATE seller_memberships SET role='viewer' WHERE auth_user_id='alice'").run();assert.equal((await f.publish(input)).status,200);assert.equal((await f.action('cancel')).status,403);assert.equal((await read(f)).status,200);
  await f.db.prepare("DELETE FROM seller_memberships WHERE auth_user_id='alice'").run();assert.equal((await f.publish(input)).status,403);assert.equal((await read(f)).status,403);
});

test('publication rejects stale revisions, malformed/duplicate input, foreign scope, oversized streams and absent provider activation',async t=>{
  const f=await campaignPublicationFixture(t);await f.addBuyer(1);
  for(const patch of [{revision:0},{revision:1.5},{requestKey:'bad'},{scheduledAt:'2026-02-30T00:00:00.000Z'},{scheduledAt:future(-1)},{scheduledAt:future(24*367)},{recipients:['outside@example.test']},{environment:'production'}])assert.equal((await f.publish({...f.intent(),...patch})).status,422,JSON.stringify(patch));
  assert.equal((await f.publish({...f.intent(),revision:2})).code,'campaign_publication_changed');
  for(const binding of [{COMMERCE_CAMPAIGN_SEND:'off'},{COMMERCE_STORAGE:'legacy'},{COMMERCE_EMAIL_SEND:'off'}])await assert.rejects(publishCampaign({...f.env,...binding},publicationActor,f.id,f.intent()),e=>e.status===503);
  const headers={authorization:'Bearer '+await f.merchantToken(),'content-type':'application/json'};
  for(const body of ['{"revision":1,"revision":1}',new Uint8Array([123,255,125])])assert.equal((await f.mf.dispatchFetch('https://api.fixture.test'+f.path+'/publish',{method:'POST',headers,body})).status,400);
  const body=new ReadableStream({start(c){c.enqueue(new TextEncoder().encode('x'.repeat(3001)));c.close();}});assert.equal((await f.mf.dispatchFetch('https://api.fixture.test'+f.path+'/publish',{method:'POST',headers,body,duplex:'half'})).status,413);
  assert.equal((await f.merchant(f.path+'/publish')).status,405);assert.equal((await f.merchant(f.path+'/publication',{}, {method:'POST'})).status,405);assert.equal(await count(f,'commerce_campaign_publications'),0);
});

test('sealed audience and schedule evidence cannot be changed, replaced, extended or completed without delivery evidence',async t=>{
  const f=await campaignPublicationFixture(t);await f.addBuyer(1);assert.equal((await f.publish()).status,200);
  for(const table of ['commerce_campaign_publications','commerce_campaign_candidates','commerce_campaign_seals']){
    const row=await f.db.prepare('SELECT * FROM '+table+' LIMIT 1').first(),columns=Object.keys(row),marks=columns.map(()=>'?').join(',');
    await assert.rejects(f.db.prepare(`INSERT OR REPLACE INTO ${table}(${columns.join(',')}) VALUES(${marks})`).bind(...Object.values(row)).run(),/immutable/);
    await assert.rejects(f.db.prepare('DELETE FROM '+table).run(),/immutable/);await assert.rejects(f.db.prepare('UPDATE '+table+' SET created_at=created_at').run(),/immutable/);
  }
  const candidate=await f.db.prepare('SELECT * FROM commerce_campaign_candidates').first();delete candidate.id;candidate.customer_id='other_customer';candidate.email='other@example.test';candidate.auth_user_id='other_buyer';
  await assert.rejects(f.db.prepare(`INSERT INTO commerce_campaign_candidates(${Object.keys(candidate).join(',')}) VALUES(${Object.keys(candidate).map(()=>'?').join(',')})`).bind(...Object.values(candidate)).run(),/audience_sealed/);
  await assert.rejects(f.db.prepare("UPDATE commerce_jobs SET state='succeeded' WHERE kind='campaign.send'").run(),/campaign_delivery_receipt_required/);
  assert.equal((await f.action('reschedule',0,future())).status,200);const action=await f.db.prepare('SELECT * FROM commerce_campaign_publication_actions').first();action.expected_revision=1;action.revision=2;
  await assert.rejects(f.db.prepare(`INSERT OR REPLACE INTO commerce_campaign_publication_actions(${Object.keys(action).join(',')}) VALUES(${Object.keys(action).map(()=>'?').join(',')})`).bind(...Object.values(action)).run(),/immutable/);
});

test('a processing recipient blocks rescheduling and cancellation never rewrites an already-started job as a confirmed no-send',async t=>{
  const f=await campaignPublicationFixture(t);await f.addBuyer(1);await f.addBuyer(2);await f.publish();
  const first=await f.db.prepare("SELECT id FROM commerce_jobs WHERE kind='campaign.send' ORDER BY id LIMIT 1").first();
  await f.db.prepare("UPDATE commerce_jobs SET state='running',attempts=1,lease_token='fixture_lease',lease_owner='fixture_worker',lease_until=?,lease_mode='execute' WHERE id=?").bind(future(),first.id).run();
  assert.equal((await f.action('reschedule',0,future(2))).code,'campaign_processing_started');
  const cancelled=await f.action('cancel');assert.equal(cancelled.status,200,cancelled.error);assert.equal(cancelled.publication.summary.cancelled,1);assert.equal(cancelled.publication.summary.processing,1);
  const current=await f.db.prepare('SELECT state,result_json FROM commerce_jobs WHERE id=?').bind(first.id).first();assert.equal(current.state,'running');assert.equal(current.result_json,null);
});

test('recipient pages retain the sealed audience across new orders, grants and withdrawals, and cannot cross publications or merchants',async t=>{
  const f=await campaignPublicationFixture(t);for(let n=0;n<27;n++)await f.addBuyer(n);
  assert.equal((await f.publish()).status,200);const page=await f.merchant(f.path+'/recipients');assert.equal(page.items.length,25);assert.equal(page.total,27);assert(page.nextCursor);
  await f.addBuyer(28);const tail=await f.merchant(f.path+'/recipients?cursor='+page.nextCursor);assert.equal(tail.items.length,2);assert.equal(tail.nextCursor,null);assert.equal(new Set([...page.items,...tail.items].map(r=>r.id)).size,27);
  const other=await f.merchant(publicationBase,{id:null,revision:0,requestKey:publicationKey(),values:f.values},{method:'POST'});assert.equal((await f.merchant(publicationBase+'/'+other.campaign.id+'/publish',f.intent(),{method:'POST'})).status,200);
  assert.equal((await f.merchant(publicationBase+'/'+other.campaign.id+'/recipients?cursor='+page.nextCursor)).status,422);
  await assert.rejects(publicationRecipients(f.env,{id:'bob',sellerId:'seller_bob'},f.id,new URL('https://fixture.test/?cursor='+page.nextCursor)),e=>e.status===404);
});

test('migration preserves populated drafts, ownership and consent before new publication tables are used',async t=>{
  const f=await campaignPublicationFixture(t,{through:34});await f.addBuyer(1);
  const tables=['commerce_campaigns','commerce_campaign_changes','commerce_customer_consents','commerce_customer_consent_changes','orders'];
  const before=await Promise.all(tables.map(name=>f.db.prepare('SELECT * FROM '+name+' ORDER BY rowid').all()));await applyCommerceSchema(f.db,34,35);
  for(let n=0;n<tables.length;n++)assert.deepEqual((await f.db.prepare('SELECT * FROM '+tables[n]+' ORDER BY rowid').all()).results,before[n].results);
  assert.equal((await f.publish()).status,200);assert.equal((await f.db.prepare('PRAGMA foreign_key_check').all()).results.length,0);
});

test('membership and consent changes between preflight and the atomic write cannot publish an unauthorized audience',async t=>{
  const f=await campaignPublicationFixture(t),buyer=await f.addBuyer(1),input=f.intent();
  const during=operation=>({...f.env,DB:{prepare:sql=>f.db.prepare(sql),batch:async statements=>{await operation();return f.db.batch(statements);}}});
  await assert.rejects(publishCampaign(during(()=>f.db.prepare("UPDATE seller_memberships SET role='viewer' WHERE auth_user_id='alice'").run()),publicationActor,f.id,input),e=>e.status===403);
  assert.equal(await count(f,'commerce_campaign_publications'),0);await f.db.prepare("UPDATE seller_memberships SET role='owner' WHERE auth_user_id='alice'").run();
  await assert.rejects(publishCampaign(during(()=>decline(f,buyer.grant)),publicationActor,f.id,input),e=>e.status===422);
  for(const table of ['commerce_campaign_publications','commerce_campaign_candidates','commerce_campaign_seals'])assert.equal(await count(f,table),0);
});

test('publication applies the saved customer filters and publication limits still permit recovery of the original request',async t=>{
  const f=await campaignPublicationFixture(t);await f.addBuyer(1);await f.addBuyer(2);await f.addBuyer(3,{consent:false});
  const values={...f.values,audience:{...f.values.audience,q:'buyer1@example.test'}};
  const changed=await f.merchant(publicationBase,{id:f.id,revision:1,requestKey:publicationKey(),values},{method:'POST'});assert.equal(changed.status,200);
  const input={...f.intent(),revision:2};assert.equal((await f.publish(input)).publication.candidateCount,1);assert.equal((await f.merchant(f.path+'/recipients')).items[0].email,'buyer1@example.test');
  let latest;
  for(let n=0;n<10;n++){
    const made=await f.merchant(publicationBase,{id:null,revision:0,requestKey:publicationKey(),values:f.values},{method:'POST'});assert.equal(made.status,200);
    latest=await f.merchant(publicationBase+'/'+made.campaign.id+'/publish',f.intent(),{method:'POST'});assert.equal(latest.status,n===9?429:200,JSON.stringify(latest));
  }
  assert.equal(await count(f,'commerce_campaign_publications'),10);const replay=await f.publish(input);assert.equal(replay.status,200);assert.equal(replay.receipt.replayed,true);
});

test('publication history retains its revision boundary when newer schedule changes arrive between pages',async t=>{
  const f=await campaignPublicationFixture(t);await f.addBuyer(1);const first=await f.publish();assert.equal(first.status,200);const id=first.publication.id;
  for(let n=0;n<22;n++)await f.db.prepare(`INSERT INTO commerce_campaign_publication_actions(publication_id,actor_id,request_key,request_hash,expected_revision,revision,kind,scheduled_at,created_at)
    VALUES(?,'alice',?,?,?,?,'reschedule',?,?)`).bind(id,publicationKey(),'a'.repeat(64),n,n+1,future(n+1),new Date(Date.now()-120000+n).toISOString()).run();
  const page=await f.merchant(f.path+'/publication-history');assert.equal(page.items.length,20);assert.equal(page.items[0].revision,22);assert(page.nextCursor);
  const action=await f.action('reschedule',22,future(30));assert.equal(action.status,200,action.error);
  const tail=await f.merchant(f.path+'/publication-history?cursor='+page.nextCursor);assert.deepEqual(tail.items.map(r=>r.revision),[2,1,0]);assert.equal(tail.nextCursor,null);
  assert.equal((await f.merchant(f.path+'/publication-history')).items[0].revision,23);
});
