import test from 'node:test';
import assert from 'node:assert/strict';
import {automationFixture,automationKey as key} from './marketing-automation-fixture.mjs';
import {grantCampaignConsent,unsubscribeFixtureOrder} from './campaign-unsubscribe-fixture.mjs';
import {scanAutomationEvents} from '../src/automation-processing.js';
const ok=result=>{assert.equal(result.status,200,JSON.stringify(result));return result;};
const enrollments=async f=>(await f.db.prepare('SELECT * FROM commerce_automation_enrollments ORDER BY id').all()).results;
async function rule(f,values={}){const saved=ok(await f.save({values:{...f.automationValues,...values}}));return ok(await f.action(saved.automation,'activate')).automation;}

test('automation scans capture every matching event and pin source permission, rule version, customer filters and delay',async t=>{
  const f=await automationFixture(t);await f.addBuyer(1);const welcome=await rule(f,{trigger:'welcome',delayMinutes:15}),paid=await rule(f,{trigger:'paid'});
  const buyer=await f.addBuyer(2),unconsented=await f.addBuyer(3,{consent:false});ok(await f.paid(buyer.order));ok(await f.paid(unconsented.order));
  const runs=[await scanAutomationEvents(f.env),await scanAutomationEvents(f.env)];assert.equal(runs.reduce((sum,r)=>sum+r.scanned,0),6);assert.equal(runs.reduce((sum,r)=>sum+r.enrolled,0),2);
  const enrolled=await enrollments(f);assert.equal(enrolled.length,2);assert(enrolled.every(r=>r.auth_user_id===buyer.buyer.id&&r.consent_revision===1&&r.rule_revision===2));
  const first=enrolled.find(r=>r.automation_id===welcome.id),event=(await f.events()).find(e=>e.sequence===first.event_sequence);assert.equal(Date.parse(first.due_at)-Date.parse(event.occurred_at),15*60000);
  assert.equal(enrolled.find(r=>r.automation_id===paid.id).order_id,buyer.order.id);assert.deepEqual(await scanAutomationEvents(f.env),{held:false,scanned:0,enrolled:0});
  await grantCampaignConsent(f,{buyer:unconsented.buyer});await scanAutomationEvents(f.env);await scanAutomationEvents(f.env);
  const later=await enrollments(f);assert.equal(later.length,3);assert.equal(later.filter(r=>r.automation_id===paid.id).length,1,'a later grant does not authorize an older paid event');
  assert.equal(await f.count('commerce_campaign_publications'),0);assert.equal(f.control.calls.length,0);
});

test('automation scan and enrollments roll back together and recover after a lost batch acknowledgement',async t=>{
  const f=await automationFixture(t);await rule(f,{trigger:'welcome'});await f.addBuyer(1);
  const broken={...f.env,DB:{prepare:sql=>f.db.prepare(sql),batch:statements=>f.db.batch([...statements,f.db.prepare("SELECT json('fixture invalid JSON')")])}};
  await assert.rejects(scanAutomationEvents(broken),/malformed JSON/);assert.equal(await f.count('commerce_automation_scans'),0);assert.equal((await enrollments(f)).length,0);
  let lost=true;const uncertain={...f.env,DB:{prepare:sql=>f.db.prepare(sql),batch:async statements=>{const result=await f.db.batch(statements);if(lost){lost=false;throw Error('Fixture lost committed scan response');}return result;}}};
  const recovered=await scanAutomationEvents(uncertain);assert.equal(recovered.replayed,true);assert.equal(recovered.enrolled,1);assert.equal((await enrollments(f)).length,1);
  assert.equal((await scanAutomationEvents(f.env)).scanned,0);assert.equal(await f.count('commerce_automation_scans'),1);
});

test('concurrent automation scans, rule changes and consent races leave one durable result or preserve the frontier',async t=>{
  const f=await automationFixture(t),a=await rule(f,{trigger:'welcome'}),buyer=await f.addBuyer(1);
  const results=await Promise.all([scanAutomationEvents(f.env),scanAutomationEvents(f.env)]);assert(results.every(r=>r.enrolled===1||r.changed||r.scanned===0));assert.equal((await enrollments(f)).length,1);assert.equal(await f.count('commerce_automation_scans'),1);
  await f.addBuyer(2);let changed=false;const racing={...f.env,DB:{prepare:sql=>f.db.prepare(sql),batch:async statements=>{if(!changed){changed=true;ok(await f.action(a,'pause'));}return f.db.batch(statements);}}};
  const interrupted=await scanAutomationEvents(racing);assert.equal(interrupted.changed,true);assert.equal(await f.count('commerce_automation_scans'),1);assert.equal((await enrollments(f)).length,1);
  const current=(await f.db.prepare('SELECT * FROM commerce_automations WHERE id=?').bind(a.id).first());await f.action({...a,revision:current.revision},'activate');assert.equal((await scanAutomationEvents(f.env)).scanned,0,'resume excludes activity while paused');
  await f.decline(buyer.grant);await grantCampaignConsent(f,{buyer:buyer.buyer,revision:2});let withdrawn=false;
  const withdrawal={...f.env,DB:{prepare:sql=>f.db.prepare(sql),batch:async statements=>{if(!withdrawn){withdrawn=true;await f.decline(buyer.grant,3);}return f.db.batch(statements);}}};
  const skipped=await scanAutomationEvents(withdrawal);assert.equal(skipped.enrolled,0);assert.equal((await enrollments(f)).length,1);
});

test('automation matching uses customer filters and current source ownership without exposing guests or other stores',async t=>{
  const f=await automationFixture(t),a=await rule(f,{trigger:'paid',audience:{...f.automationValues.audience,minOrders:'2'}});
  const buyer=await f.addBuyer(1);ok(await f.paid(buyer.order));assert.equal((await scanAutomationEvents(f.env)).enrolled,0);
  const second=await unsubscribeFixtureOrder(f,buyer.buyer);ok(await f.paid(second));assert.equal((await scanAutomationEvents(f.env)).enrolled,1);
  const guest=ok(await f.create(f.input())).order;ok(await f.paid(guest));assert.equal((await scanAutomationEvents(f.env)).enrolled,0);
  await f.db.prepare("UPDATE seller_memberships SET role='viewer' WHERE auth_user_id='alice'").run();const third=await unsubscribeFixtureOrder(f,buyer.buyer);ok(await f.paid(third));assert.equal((await scanAutomationEvents(f.env)).scanned,0);
  assert.equal((await enrollments(f)).length,1);assert.equal((await enrollments(f))[0].automation_id,a.id);
  assert.deepEqual(await scanAutomationEvents({...f.env,COMMERCE_MARKETING_AUTOMATIONS:'off'}),{held:true,scanned:0,enrolled:0});
});

test('automation scans page beyond fifty facts without missing events and refuse altered scans or enrollments',async t=>{
  const f=await automationFixture(t),buyer=await f.addBuyer(1),a=await rule(f,{trigger:'paid'});
  const orders=[buyer.order];for(let n=0;n<50;n++)orders.push(await unsubscribeFixtureOrder(f,buyer.buyer,{items:[{productId:'campaign-tea',quantity:1,expectedPrice:20000,expectedWeightGrams:100}]}));
  for(const order of orders)ok(await f.paid(order));
  const first=await scanAutomationEvents(f.env),last=await scanAutomationEvents(f.env);assert.equal(first.scanned,50);assert.equal(first.enrolled,50);assert.equal(last.scanned,1);assert.equal(last.enrolled,1);
  assert.equal((await scanAutomationEvents(f.env)).scanned,0);const rows=await enrollments(f);assert.equal(new Set(rows.map(r=>r.event_sequence)).size,51);
  for(const table of ['commerce_automation_scans','commerce_automation_enrollments']){
    await assert.rejects(f.db.prepare('DELETE FROM '+table).run(),/automation_(scan|enrollment)_immutable/);
    await assert.rejects(f.db.prepare('INSERT OR REPLACE INTO '+table+' SELECT * FROM '+table+' LIMIT 1').run(),/automation_(scan|enrollment)_immutable/);
  }
  await assert.rejects(f.db.prepare(`UPDATE commerce_automation_enrollments SET due_at='2099-01-01T00:00:00.000Z' WHERE id=?`).bind(rows[0].id).run(),/automation_enrollment_immutable/);
  const state=await f.db.prepare('SELECT * FROM commerce_automation_scan_state WHERE id=?').bind(a.id).first();assert.equal(state.scanned_through,(await f.events()).at(-1).sequence);
});

test('expiry facts require an actual expired transition, including an already expired provider session, and never repeat for late callbacks',async t=>{
  const f=await automationFixture(t),buyer=await f.addBuyer(1);await rule(f,{trigger:'expired'});
  ok(await f.paid(buyer.order));ok(await f.event(buyer.order,'payment.expired',{verified:true}));assert.equal((await f.events()).filter(e=>e.kind==='expiry').length,0);
  const expired=await unsubscribeFixtureOrder(f,buyer.buyer);ok(await f.event(expired,'payment.expired',{verified:true}));ok(await f.event(expired,'payment.expired',{verified:true}));assert.equal((await f.events()).filter(e=>e.kind==='expiry').length,1);
  const old=await unsubscribeFixtureOrder(f,buyer.buyer);ok(await f.event(old,'payment.created',f.session(old,{expiresAt:old.createdAt})));assert.equal((await f.events()).filter(e=>e.kind==='expiry').length,2);
  const scan=await scanAutomationEvents(f.env);assert.equal(scan.enrolled,2);assert.equal(f.control.calls.length,0);
});

test('damaged automation source evidence prevents cursor advancement and requires review',async t=>{
  const f=await automationFixture(t),a=await rule(f),buyer=await f.addBuyer(1);ok(await f.paid(buyer.order));
  // Simulate external database damage, bypassing only the event's immutable guard.
  await f.db.prepare('DROP TRIGGER commerce_marketing_event_update').run();await f.db.prepare("UPDATE commerce_marketing_events SET source_key='damaged-receipt' WHERE kind='payment'").run();
  await assert.rejects(scanAutomationEvents(f.env),e=>e.status===503);assert.equal(await f.count('commerce_automation_scans'),0);assert.equal((await enrollments(f)).length,0);
  assert.equal((await f.db.prepare('SELECT scanned_through FROM commerce_automation_scan_state WHERE id=?').bind(a.id).first()).scanned_through,0);
});

test('checkouts arriving during a scan share its atomic customer frontier without starving enrollment',async t=>{
  const f=await automationFixture(t);await rule(f,{trigger:'paid',audience:{...f.automationValues.audience,minOrders:'2'}});const buyer=await f.addBuyer(1);ok(await f.paid(buyer.order));
  let inserted=false;const concurrent={...f.env,DB:{prepare:sql=>f.db.prepare(sql),batch:async statements=>{if(!inserted){inserted=true;await unsubscribeFixtureOrder(f,buyer.buyer);}return f.db.batch(statements);}}};
  const saved=await scanAutomationEvents(concurrent);assert.equal(saved.scanned,2);assert.equal(saved.enrolled,1);assert.equal((await enrollments(f)).length,1);
  const scan=await f.db.prepare('SELECT order_cap FROM commerce_automation_scans WHERE id=?').bind(saved.scanId).first();assert.equal(scan.order_cap,(await f.db.prepare("SELECT MAX(rowid) AS n FROM orders WHERE seller_id='seller_alice'").first()).n);
});
