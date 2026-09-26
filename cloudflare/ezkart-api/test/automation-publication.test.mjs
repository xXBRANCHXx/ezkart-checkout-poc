import test from 'node:test';
import assert from 'node:assert/strict';
import {automationFixture as fixture,automationKey as key,automationBase} from './marketing-automation-fixture.mjs';
import {scanAutomationEvents} from '../src/automation-processing.js';
import {publishAutomationBatch,skipAutomationEnrollments} from '../src/automation-publication.js';
import {dispatchCampaignEmails} from '../src/campaign-email-delivery.js';
import {grantCampaignConsent,unsubscribeFixtureOrder} from './campaign-unsubscribe-fixture.mjs';
import {emailFixtureEvent, emailFixtureCallback} from './email-fixture.mjs';
import {recordEmailWebhook} from '../src/commerce-email-delivery.js';
const ok=result=>{assert.equal(result.status,200,JSON.stringify(result));return result;};
async function rule(f,values={}){const saved=ok(await f.save({values:{...f.automationValues,...values}}));return ok(await f.action(saved.automation,'activate')).automation;}
async function enrolled(f,values={}){const automation=await rule(f,values),buyer=await f.addBuyer(1);if((values.trigger||'paid')!=='welcome')ok(await f.paid(buyer.order));assert.equal((await scanAutomationEvents(f.env)).enrolled,1);return {automation,buyer};}

test('automation publication atomically freezes its selected recipients, message, jobs and outcomes and uses the campaign sender',async t=>{
  const f=await fixture(t);const {automation}=await enrolled(f);const result=await publishAutomationBatch(f.env);
  assert.equal(result.published,1,JSON.stringify(result));assert.equal(result.replayed,false);
  const run=await f.db.prepare('SELECT * FROM commerce_automation_runs').first();assert.equal(run.state,'ready');assert.equal(run.automation_id,automation.id);
  const path='/v1/commerce/marketing/campaigns/'+run.campaign_id,copy=ok(await f.merchant(path)).campaign;
  assert.equal(copy.automation.id,automation.id);assert.equal(copy.automation.revision,automation.revision);
  const publication=ok(await f.merchant(path+'/publication')).publication;assert.equal(publication.canReschedule,false);assert.equal(publication.automation.id,automation.id);
  const edit=await f.merchant('/v1/commerce/marketing/campaigns',{id:copy.id,revision:copy.revision,requestKey:key(),values:{...copy.values,subject:'Cannot alter frozen automation'}},{method:'POST'});
  assert.equal(edit.status,409,JSON.stringify(edit));assert.equal(edit.code,'automation_generated_campaign');
  const schedule=await f.merchant(path+'/publication-action',{kind:'reschedule',revision:0,requestKey:key(),scheduledAt:new Date(Date.now()+3600000).toISOString()},{method:'POST'});
  assert.equal(schedule.status,409,JSON.stringify(schedule));assert.equal(schedule.code,'automation_generated_campaign');
  assert.equal(await f.count('commerce_automation_outcomes'),1);assert.equal(await f.count('commerce_campaign_candidates'),1);assert.equal((await f.jobs()).length,1);
  assert.equal((await publishAutomationBatch(f.env)).published,0);assert.equal((await skipAutomationEnrollments(f.env)).skipped,0);
  const sent=await dispatchCampaignEmails(f.env,2,f.fetcher);assert.equal(sent.processed,1,JSON.stringify({sent,jobs:await f.jobs()}));assert.equal(sent.failed,0);
  assert.equal(f.control.calls.length,1);assert.deepEqual(f.control.calls[0].message.to,['buyer1@example.test']);assert.equal(f.control.calls[0].message.subject,'[Sandbox] '+f.automationValues.subject);
  assert.equal(await f.count('commerce_unsubscribe_tokens'),1);assert.equal(await f.count('commerce_campaign_email_starts'),1);
});

test('failed and concurrent publication batches recover one complete run after a lost acknowledgement',async t=>{
  const f=await fixture(t);await enrolled(f);
  const broken={...f.env,DB:{prepare:sql=>f.db.prepare(sql),batch:statements=>f.db.batch([...statements,f.db.prepare("SELECT json('fixture invalid JSON')")])}};
  await assert.rejects(publishAutomationBatch(broken),/malformed JSON/);
  for(const table of ['commerce_automation_runs','commerce_automation_outcomes','commerce_campaign_publications','commerce_campaign_candidates','commerce_campaign_seals'])assert.equal(await f.count(table),0,table);
  assert.equal((await f.jobs()).length,0);assert.equal(await f.count('commerce_campaigns'),1,'the fixture manual draft is preserved');
  let lost=true;const uncertain={...f.env,DB:{prepare:sql=>f.db.prepare(sql),batch:async statements=>{const result=await f.db.batch(statements);if(lost){lost=false;throw Error('Fixture lost committed publication response');}return result;}}};
  const results=await Promise.all([publishAutomationBatch(uncertain),publishAutomationBatch(f.env)]);
  assert(results.some(r=>r.published===1));assert(results.every(r=>r.published===1||r.changed||r.published===0));
  assert.equal(await f.count('commerce_automation_runs'),1);assert.equal(await f.count('commerce_automation_outcomes'),1);assert.equal((await f.jobs()).length,1);
  const run=await f.db.prepare('SELECT * FROM commerce_automation_runs').first();assert.equal(run.state,'ready');
  for(const table of ['commerce_automation_runs','commerce_automation_outcomes']){
    await assert.rejects(f.db.prepare('DELETE FROM '+table).run(),/automation_(run|outcome)_immutable/);
    await assert.rejects(f.db.prepare('INSERT OR REPLACE INTO '+table+' SELECT * FROM '+table+' LIMIT 1').run(),/automation_(run|outcome)_immutable/);
  }
  await assert.rejects(f.db.prepare("UPDATE commerce_automation_runs SET state='building'").run(),/automation_run_immutable/);
});

test('only one event per contact is published inside a repeat interval and welcome does not repeat after permission is granted again',async t=>{
  for(const trigger of ['paid','welcome'])await t.test(trigger,async t=>{
    const f=await fixture(t),{buyer}=await enrolled(f,{trigger});
    if(trigger==='paid')ok(await f.paid(await unsubscribeFixtureOrder(f,buyer.buyer)));
    else {await f.decline(buyer.grant);await grantCampaignConsent(f,{buyer:buyer.buyer,revision:2});}
    await scanAutomationEvents(f.env);assert.equal((await publishAutomationBatch(f.env)).published,1);
    if(trigger==='welcome'){
      // The first permission revision was withdrawn. Publish the new revision,
      // then a third grant still cannot schedule another welcome for this rule.
      await f.decline(buyer.grant,3);await grantCampaignConsent(f,{buyer:buyer.buyer,revision:4});await scanAutomationEvents(f.env);
    }
    assert.equal((await publishAutomationBatch(f.env)).published,0);assert((await skipAutomationEnrollments(f.env)).skipped>=1);
    const rows=(await f.db.prepare('SELECT state,reason FROM commerce_automation_outcomes ORDER BY enrollment_id').all()).results;
    assert.equal(rows.filter(r=>r.state==='published').length,1);assert(rows.some(r=>r.reason==='frequency'));
    assert.equal((await f.jobs()).length,1);assert.equal(f.control.calls.length,0);
  });
});

test('delays stay waiting, newer purchases supersede inactivity messages, and paid expired checkouts are stopped',async t=>{
  for(const trigger of ['paid','winback','expired'])await t.test(trigger,async t=>{
    const f=await fixture(t);await rule(f,{trigger,delayMinutes:trigger==='winback'?1440:30});const buyer=await f.addBuyer(1);
    ok(trigger==='expired'?await f.event(buyer.order,'payment.expired',{verified:true}):await f.paid(buyer.order));await scanAutomationEvents(f.env);
    assert.equal((await publishAutomationBatch(f.env)).published,0);assert.equal((await skipAutomationEnrollments(f.env)).skipped,0);
    if(trigger==='paid')return;
    ok(await f.paid(trigger==='expired'?buyer.order:await unsubscribeFixtureOrder(f,buyer.buyer)));
    assert.equal((await skipAutomationEnrollments(f.env)).skipped,1);
    assert.equal((await f.db.prepare('SELECT reason FROM commerce_automation_outcomes').first()).reason,trigger==='winback'?'superseded':'order_changed');
    assert.equal((await f.jobs()).length,0);
  });
});

test('a pause or withdrawal during publication rolls back every generated record',async t=>{
  for(const condition of ['pause','withdrawal'])await t.test(condition,async t=>{
    const f=await fixture(t),{automation,buyer}=await enrolled(f);let changed=false;
    const env={...f.env,DB:{prepare:sql=>f.db.prepare(sql),batch:async statements=>{if(!changed){changed=true;if(condition==='pause')ok(await f.action(automation,'pause'));else await f.decline(buyer.grant);}return f.db.batch(statements);}}};
    assert.equal((await publishAutomationBatch(env)).changed,true);
    for(const table of ['commerce_automation_runs','commerce_automation_outcomes','commerce_campaign_publications','commerce_campaign_candidates'])assert.equal(await f.count(table),0,table);
    assert.equal((await f.jobs()).length,0);assert.equal((await skipAutomationEnrollments(f.env)).skipped,1);
  });
});

test('automation eligibility is checked at the last network start and preserves precise immutable stop reasons',async t=>{
  for(const condition of ['pause','withdrawal','late_payment','audience'])await t.test(condition,async t=>{
    const f=await fixture(t),trigger=condition==='late_payment'?'expired':'paid';
    const automation=await rule(f,{trigger,audience:{...f.automationValues.audience,...(condition==='audience'?{maxOrders:'1'}:{})}}),buyer=await f.addBuyer(1);
    ok(trigger==='expired'?await f.event(buyer.order,'payment.expired',{verified:true}):await f.paid(buyer.order));await scanAutomationEvents(f.env);assert.equal((await publishAutomationBatch(f.env)).published,1);
    let changed=false;const db=new Proxy(f.db,{get(target,property){if(property==='prepare')return sql=>{const statement=target.prepare(sql);if(!sql.includes('INSERT INTO commerce_campaign_email_starts'))return statement;return {bind(...args){return {async run(){
      if(!changed){changed=true;if(condition==='pause')ok(await f.action(automation,'pause'));else if(condition==='withdrawal')await f.decline(buyer.grant);else if(condition==='late_payment')ok(await f.paid(buyer.order));else await unsubscribeFixtureOrder(f,buyer.buyer);}
      return statement.bind(...args).run();}};}};};const value=Reflect.get(target,property);return typeof value==='function'?value.bind(target):value;}});
    const sent=await dispatchCampaignEmails({...f.env,DB:db},2,f.fetcher);assert.equal(sent.processed,1,JSON.stringify({sent,jobs:await f.jobs()}));assert.equal(sent.failed,0);
    assert.equal(f.control.calls.length,0);assert.equal(await f.count('commerce_campaign_email_requests'),1);assert.equal(await f.count('commerce_campaign_email_starts'),0);
    const stop=await f.db.prepare('SELECT * FROM commerce_automation_stops').first();assert.equal(stop.reason,{pause:'paused',withdrawal:'preference_off',late_payment:'order_changed',audience:'audience_changed'}[condition]);
    const skip=await f.db.prepare('SELECT * FROM commerce_campaign_email_skips').first();assert.equal(skip.uncertain,0);
    await assert.rejects(f.db.prepare('DELETE FROM commerce_automation_stops').run(),/automation_stop_immutable/);
    await assert.rejects(f.db.prepare('INSERT OR REPLACE INTO commerce_automation_stops SELECT * FROM commerce_automation_stops').run(),/automation_stop_immutable/);
  });
});

test('pausing after an unknown provider submission preserves uncertainty and later signed delivery evidence',async t=>{
  const f=await fixture(t),{automation}=await enrolled(f);await publishAutomationBatch(f.env);f.control.outcomes.push('lost');
  assert.equal((await dispatchCampaignEmails(f.env,2,f.fetcher)).failed,1);assert.equal(f.control.calls.length,1);
  ok(await f.action(automation,'pause'));await f.ready();assert.equal((await dispatchCampaignEmails(f.env,2,f.fetcher)).failed,1);
  assert.equal(f.control.calls.length,1);assert.equal((await f.db.prepare('SELECT uncertain FROM commerce_campaign_email_skips').first()).uncertain,1);
  assert.equal((await f.db.prepare('SELECT reason FROM commerce_automation_stops').first()).reason,'paused');
  const call=f.control.calls[0];await recordEmailWebhook(emailFixtureCallback(emailFixtureEvent(call.message,call.id,'email.delivered')),f.env,'test_mail');
  const status=await f.db.prepare('SELECT * FROM commerce_campaign_delivery_status').first();assert.equal(status.delivery_state,'delivered');assert.equal(status.needs_review,1);
  const detail=ok(await f.merchant(automationBase+'/'+automation.id));assert.equal(detail.summary.delivered,1);assert.equal(detail.summary.needsReview,1);assert.equal(detail.summary.skipped,0);
  const activity=ok(await f.merchant(automationBase+'/'+automation.id+'/activity'));assert.equal(activity.items[0].state,'delivered');assert.equal(activity.items[0].reason,'paused');assert.equal(activity.items[0].needsReview,true);
  assert.equal((await f.jobs())[0].state,'dead');assert.equal(await f.count('commerce_campaign_email_starts'),1);
});

test('automation processing holds prevent new publications while the campaign send hold and rule pause govern already published work',async t=>{
  const f=await fixture(t);await enrolled(f);const held={...f.env,COMMERCE_MARKETING_AUTOMATIONS:'off'};
  assert.deepEqual(await publishAutomationBatch(held),{held:true,published:0});assert.deepEqual(await skipAutomationEnrollments(held),{held:true,skipped:0});assert.equal((await f.jobs()).length,0);
  await publishAutomationBatch(f.env);
  assert.equal((await dispatchCampaignEmails({...held,COMMERCE_CAMPAIGN_SEND:'off'},2,f.fetcher)).held,true);assert.equal(f.control.calls.length,0);
  assert.equal((await dispatchCampaignEmails(held,2,f.fetcher)).processed,1);assert.equal(f.control.calls.length,1);
});

test('two actual automation messages including fresh eligibility checks fit the D1 invocation query budget',async t=>{
  const f=await fixture(t);await rule(f,{trigger:'welcome'});await f.addBuyer(1);await f.addBuyer(2);await scanAutomationEvents(f.env);assert.equal((await publishAutomationBatch(f.env)).published,2);
  let queries=0;
  const wrap=statement=>new Proxy(statement,{get(target,property){if(property==='bind')return(...args)=>wrap(target.bind(...args));if(['first','all','run','raw'].includes(property))return(...args)=>{queries++;return target[property](...args);};const value=Reflect.get(target,property);return typeof value==='function'?value.bind(target):value;}});
  const db=new Proxy(f.db,{get(target,property){if(property==='prepare')return sql=>wrap(target.prepare(sql));if(property==='batch')return statements=>{queries+=statements.length;return target.batch(statements);};const value=Reflect.get(target,property);return typeof value==='function'?value.bind(target):value;}});
  const result=await dispatchCampaignEmails({...f.env,DB:db},2,f.fetcher);assert.equal(result.processed,2,JSON.stringify({result,jobs:await f.jobs()}));assert.equal(result.failed,0);assert.equal(f.control.calls.length,2);assert(queries<=50,'D1 queries: '+queries);
});
