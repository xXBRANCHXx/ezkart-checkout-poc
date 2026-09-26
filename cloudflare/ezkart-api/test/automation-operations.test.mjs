import test from 'node:test';
import assert from 'node:assert/strict';
import {automationFixture as fixture,automationKey as key,automationBase} from './marketing-automation-fixture.mjs';
import {scanAutomationEvents} from '../src/automation-processing.js';
import {publishAutomationBatch} from '../src/automation-publication.js';
import {processMarketingAutomations} from '../src/automation-dispatch.js';
import {grantCampaignConsent,unsubscribeFixtureOrder} from './campaign-unsubscribe-fixture.mjs';
import worker from '../src/index.js';
import {campaignDeliveryFixture} from './campaign-delivery-fixture.mjs';
import {applyCommerceSchema} from './commerce-schema.mjs';
import {dispatchCampaignEmails} from '../src/campaign-email-delivery.js';
import {recordEmailWebhook} from '../src/commerce-email-delivery.js';
import {emailFixtureEvent,emailFixtureCallback} from './email-fixture.mjs';
import {lookupCampaignEmail} from '../src/email-investigation.js';
const ok=result=>{assert.equal(result.status,200,JSON.stringify(result));return result;};
async function rule(f,seller='alice'){
  const saved=ok(await f.save({}, {seller}));return ok(await f.action(saved.automation,'activate',key(),{seller})).automation;
}
async function bobBuyer(f){
  const buyer={id:'bob-customer',email:'bob-customer@example.test'},order=await unsubscribeFixtureOrder(f,buyer,{sellerId:'seller_bob',items:[{productId:'private',quantity:1,expectedPrice:20000,expectedWeightGrams:100}]});
  await grantCampaignConsent(f,{buyer,sellerId:'seller_bob',name:'bob'});ok(await f.paid(order));return {buyer,order};
}

test('a damaged source keeps its frontier and records a bounded retry while another store continues',async t=>{
  const f=await fixture(t),alice=await rule(f),bob=await rule(f,'bob'),buyer=await f.addBuyer(1);ok(await f.paid(buyer.order));await bobBuyer(f);
  await f.db.prepare('DROP TRIGGER commerce_marketing_event_update').run();await f.db.prepare("UPDATE commerce_marketing_events SET source_key='fixture-damaged' WHERE seller_id='seller_alice' AND kind='payment'").run();
  await assert.rejects(scanAutomationEvents(f.env),e=>e.status===503&&e.headers.get('x-ezkart-error-code')==='automation_source_invalid');
  const issue=await f.db.prepare('SELECT * FROM commerce_automation_processing_status').first();assert.equal(issue.automation_id,alice.id);assert.equal(issue.code,'source_invalid');assert.equal(Date.parse(issue.retry_after)-Date.parse(issue.created_at),300000);
  const next=await scanAutomationEvents(f.env);assert.equal(next.enrolled,1);assert.equal((await f.db.prepare('SELECT automation_id FROM commerce_automation_enrollments').first()).automation_id,bob.id);
  assert.equal((await f.db.prepare('SELECT scanned_through FROM commerce_automation_scan_state WHERE id=?').bind(alice.id).first()).scanned_through,0);
  assert.equal((await scanAutomationEvents(f.env)).scanned,0);assert.equal(await f.count('commerce_automation_processing_issues'),1);
  const detail=ok(await f.merchant(automationBase+'/'+alice.id));assert.equal(detail.processingIssues[0].code,'source_invalid');assert.equal(detail.lastCheckedAt,null);assert.equal(detail.summary.enrolled,0);
  for(const command of ['DELETE FROM commerce_automation_processing_issues','INSERT OR REPLACE INTO commerce_automation_processing_issues SELECT * FROM commerce_automation_processing_issues'])await assert.rejects(f.db.prepare(command).run(),/automation_processing_issue_immutable/);
});

test('a store at the real campaign publication limit does not block another store or consume its waiting enrollment',async t=>{
  const f=await fixture(t);const alice=await rule(f),bob=await rule(f,'bob'),buyer=await f.addBuyer(1);
  for(let n=0;n<10;n++){
    const saved=ok(await f.merchant('/v1/commerce/marketing/campaigns',{id:null,revision:0,requestKey:key(),values:{...f.values,name:'Quota fixture '+n}},{method:'POST'}));
    ok(await f.merchant('/v1/commerce/marketing/campaigns/'+saved.campaign.id+'/publish',{revision:1,requestKey:key(),scheduledAt:null},{method:'POST'}));
  }
  ok(await f.paid(buyer.order));await bobBuyer(f);await scanAutomationEvents(f.env);await scanAutomationEvents(f.env);
  const limited=await publishAutomationBatch(f.env);assert.equal(limited.limited,true);assert.equal(limited.published,0);assert.equal(await f.count('commerce_automation_runs'),0);
  const next=await publishAutomationBatch(f.env);assert.equal(next.published,1);assert.equal((await f.db.prepare('SELECT automation_id FROM commerce_automation_runs').first()).automation_id,bob.id);
  const waiting=await f.db.prepare('SELECT COUNT(*) AS n FROM commerce_automation_enrollments e WHERE automation_id=? AND NOT EXISTS(SELECT 1 FROM commerce_automation_outcomes o WHERE o.enrollment_id=e.id)').bind(alice.id).first();assert.equal(waiting.n,1);
  assert.equal((await f.db.prepare('SELECT code FROM commerce_automation_processing_status').first()).code,'rate_limited');assert.equal((await publishAutomationBatch(f.env)).published,0);
});

test('automation publications page at twenty-five distinct contacts and processing stays inside the invocation query budget',async t=>{
  const f=await fixture(t),automation=await rule(f);
  for(let n=1;n<=26;n++){const buyer=await f.addBuyer(n);ok(await f.paid(buyer.order));}
  await scanAutomationEvents(f.env);await scanAutomationEvents(f.env);
  let queries=0;const db=new Proxy(f.db,{get(target,property){if(property==='prepare')return sql=>{queries++;return target.prepare(sql);};const value=Reflect.get(target,property);return typeof value==='function'?value.bind(target):value;}});
  assert.equal((await processMarketingAutomations({...f.env,DB:db})).published,25);assert(queries<=50,'prepared statements: '+queries);
  assert.equal((await publishAutomationBatch(f.env)).published,1);assert.equal((await publishAutomationBatch(f.env)).published,0);
  assert.equal(await f.count('commerce_automation_outcomes'),26);assert.equal((await f.jobs()).length,26);assert.equal(await f.count('commerce_automation_runs'),2);assert.equal(f.control.calls.length,0);
  const path=automationBase+'/'+automation.id,first=ok(await f.merchant(path+'/activity'));assert.equal(first.items.length,25);assert(first.nextCursor);
  const second=ok(await f.merchant(path+'/activity?cursor='+first.nextCursor));assert.equal(second.items.length,1);assert.equal(second.nextCursor,null);
  assert.equal(new Set([...first.items,...second.items].map(i=>i.id)).size,26);assert(first.items.every(i=>i.state==='queued'&&i.campaignId&&i.ruleRevision===2));
  assert.equal((await f.merchant(path+'/activity?status=waiting&cursor='+first.nextCursor)).status,422);assert.equal((await f.merchant(path+'/activity?status=forged')).status,422);
  assert.equal((await f.merchant(path+'/activity',undefined,{seller:'bob'})).status,404);assert.equal((await f.merchant(path,undefined,{seller:'bob'})).status,404);
  assert.equal((await f.merchant(path+'/activity?environment=production')).status,422);
  const detail=ok(await f.merchant(path));assert.equal(detail.summary.enrolled,26);assert.equal(detail.summary.published,26);assert.equal(detail.summary.submitted,0);assert(detail.lastCheckedAt);
});

test('the signed processor rejects wrong scope, runs the real pipeline, and its own cron remains held without database access',async t=>{
  const f=await fixture(t);await rule(f);const buyer=await f.addBuyer(1);ok(await f.paid(buyer.order));
  const path='/internal/commerce/automations/process';
  assert.equal((await f.call(path,{environment:'production'})).status,422);assert.equal((await f.call(path,{environment:'sandbox',limit:100})).status,422);assert.equal((await f.call(path+'?x=1',{environment:'sandbox'})).status,422);
  assert.equal((await f.mf.dispatchFetch('https://api.fixture.test'+path,{method:'POST',headers:{'content-type':'application/json'},body:'{"environment":"sandbox"}'})).status,401);
  const processed=ok(await f.call(path,{environment:'sandbox'}));assert.equal(processed.enrolled,1);assert.equal(processed.published,1);assert.equal(processed.needsReview,0);assert.equal(f.control.calls.length,0);
  const tasks=[],env={...f.env,COMMERCE_MARKETING_AUTOMATIONS:'off',DB:new Proxy({},{get(){throw Error('Held processor accessed the database');}})};
  await worker.scheduled({cron:'*/4 * * * *'},env,{waitUntil:promise=>tasks.push(promise)});assert.equal(tasks.length,1);assert.equal((await tasks[0]).held,true);
  assert.equal((await f.jobs()).length,1);assert.equal(f.control.calls.length,0);
});

test('the shared marketing cron publishes and sends in separate bounded invocations without changing the send cadence',async t=>{
  const f=await fixture(t);await rule(f);const buyer=await f.addBuyer(1);ok(await f.paid(buyer.order));
  t.mock.method(globalThis,'fetch',(url,options)=>f.fetcher(url,options));
  let queries=0;
  const wrap=statement=>new Proxy(statement,{get(target,property){
    if(property==='bind')return(...args)=>wrap(target.bind(...args));
    if(['first','all','run','raw'].includes(property))return(...args)=>{queries++;return target[property](...args);};
    const value=Reflect.get(target,property);return typeof value==='function'?value.bind(target):value;
  }});
  const db=new Proxy(f.db,{get(target,property){
    if(property==='prepare')return sql=>wrap(target.prepare(sql));
    if(property==='batch')return statements=>{queries+=statements.length;return target.batch(statements);};
    const value=Reflect.get(target,property);return typeof value==='function'?value.bind(target):value;
  }});
  const tick=async minute=>{
    queries=0;const tasks=[];
    await worker.scheduled({cron:'0-59/3,1-59/3 * * * *',scheduledTime:Date.UTC(2026,8,27,12,minute)},{...f.env,DB:db},{waitUntil:task=>tasks.push(task)});
    assert.equal(tasks.length,1);const result=await tasks[0];assert(queries<=50,'D1 queries: '+queries);return result;
  };
  assert.equal((await tick(0)).processed,0);assert.equal(await f.count('commerce_automation_enrollments'),0);
  assert.equal((await tick(1)).published,1);assert.equal(f.control.calls.length,0);assert.equal((await f.jobs()).length,1);
  assert.equal((await tick(3)).processed,1);assert.equal(f.control.calls.length,1);
  assert.equal((await tick(4)).published,0);assert.equal(f.control.calls.length,1);assert.equal(await f.count('commerce_automation_runs'),1);
});

test('both marketing cron phases honor their holds and invalid scheduled times do not fall through to maintenance',async()=>{
  const env={APP_ENVIRONMENT:'test',DB:new Proxy({},{get(){throw Error('Held or invalid schedule accessed the database');}})};
  for(const minute of [0,1,57,58]){
    const tasks=[];await worker.scheduled({cron:'0-59/3,1-59/3 * * * *',scheduledTime:Date.UTC(2026,8,27,12,minute)},env,{waitUntil:task=>tasks.push(task)});
    assert.equal(tasks.length,1);assert.equal((await tasks[0]).held,true);
  }
  for(const scheduledTime of [undefined,NaN,Date.UTC(2026,8,27,12,2)])await assert.rejects(
    worker.scheduled({cron:'0-59/3,1-59/3 * * * *',scheduledTime},env,{waitUntil(){throw Error('Invalid schedule created work');}}),/Marketing schedule time is invalid/);
});

test('automation migration preserves mixed campaign evidence and point reads never scan unrelated recipients or orders',async t=>{
  const f=await campaignDeliveryFixture(t,{through:40,bindings:{COMMERCE_EMAIL_RECONCILE:'enabled',RESEND_READ_API_KEY:'re_fixture_campaign_reader'}});
  for(let n=1;n<=6;n++)await f.addBuyer(n);ok(await f.publish());f.control.outcomes.push(...Array(6).fill('lost'));
  for(let n=0;n<3;n++)await dispatchCampaignEmails(f.env,2,f.fetcher);assert.equal(f.control.calls.length,6);
  for(const [i,kind] of [[0,'delivered'],[2,'bounced'],[3,'failed'],[4,'delayed']]){
    const c=f.control.calls[i];await recordEmailWebhook(emailFixtureCallback(emailFixtureEvent(c.message,c.id,'email.'+kind)),f.env,'test_mail');
  }
  for(const [i,kind] of [[1,'delivered'],[2,'delivered'],[3,'complained'],[4,'suppressed']]){
    const c=f.control.calls[i],x=await f.db.prepare('SELECT id FROM commerce_campaign_email_requests WHERE request_json=?').bind(c.body).first();
    f.control.read=data=>Response.json({...data,last_event:kind});
    const result=await lookupCampaignEmail(f.env,{environment:'sandbox',requestId:x.id,providerId:c.id,lookupKey:key(),operator:'fixture_operator'},f.fetcher);assert.equal(result.receipt.outcome,'matched');
  }
  const before=(await f.db.prepare('SELECT * FROM commerce_campaign_delivery_status ORDER BY candidate_id').all()).results;
  assert.deepEqual(before.map(r=>r.delivery_state).sort(),['bounced','complained','delivered','delivered','suppressed','uncertain'].sort());
  const sources=(await f.db.prepare('SELECT * FROM commerce_campaign_delivery_sources ORDER BY candidate_id').all()).results;
  const tables=(await f.db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '_cf_%' ORDER BY name").all()).results.map(r=>r.name),records=new Map();
  for(const name of tables)records.set(name,(await f.db.prepare('SELECT * FROM "'+name+'" ORDER BY rowid').all()).results);
  await applyCommerceSchema(f.db,40,41);
  assert.deepEqual((await f.db.prepare('SELECT * FROM commerce_campaign_delivery_status ORDER BY candidate_id').all()).results,before);
  const afterSources=(await f.db.prepare('SELECT * FROM commerce_campaign_delivery_sources ORDER BY candidate_id').all()).results;
  assert.deepEqual(afterSources.map(({automation_id,enrollment_id,...r})=>r),sources);assert(afterSources.every(r=>r.automation_id===null));
  for(const name of tables)assert.deepEqual((await f.db.prepare('SELECT * FROM "'+name+'" ORDER BY rowid').all()).results,records.get(name),name);
  assert.equal(await f.count('commerce_marketing_events'),0);assert.deepEqual((await f.db.prepare('PRAGMA foreign_key_check').all()).results,[]);
  for(const [sql,args] of [
    ['SELECT * FROM commerce_automation_delivery_sources WHERE candidate_id=? AND publication_id=?',[1,sources[0].publication_id]],
    ['SELECT * FROM commerce_automation_activity WHERE automation_id=? AND id<? ORDER BY id DESC LIMIT 26',['auto_'+'a'.repeat(32),50]],
    ['SELECT * FROM commerce_automation_audience WHERE enrollment_id=?',[1]]
  ]){
    const plan=(await f.db.prepare('EXPLAIN QUERY PLAN '+sql).bind(...args).all()).results.map(r=>r.detail);
    assert(!plan.some(line=>/SCAN (?:e|c|b|l|r|o|commerce_campaign_email_events|commerce_campaign_email_provider_bindings)(?:\s|$)/.test(line)),JSON.stringify(plan));
    assert(plan.some(line=>line.includes('idx_commerce_orders_customer_history')&&line.includes('customer_id=?')),JSON.stringify(plan));
  }
});
