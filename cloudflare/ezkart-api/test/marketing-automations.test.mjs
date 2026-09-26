import test from 'node:test';
import assert from 'node:assert/strict';
import {automationFixture,automationBase as base,automationKey as key} from './marketing-automation-fixture.mjs';
import {grantCampaignConsent,unsubscribeFixtureOrder} from './campaign-unsubscribe-fixture.mjs';
import {saveAutomation,changeAutomation} from '../src/marketing-automations.js';
import {applyCommerceSchema} from './commerce-schema.mjs';
import {applyCommerceEvent} from '../src/commerce-orders.js';
import {customerConsents} from '../src/commerce-customer-consents.js';
const actor={id:'alice',sellerId:'seller_alice'};
const ok=result=>{assert.equal(result.status,200,JSON.stringify(result));return result;};

test('automation source events preserve actual grants, primary captures and expiry receipts without duplicate payment or consent facts',async t=>{
  const f=await automationFixture(t),a=await f.addBuyer(1);assert.equal((await f.events()).length,1);
  assert.equal(ok(await f.call('/internal/commerce/customer-consents',a.grant.input)).receipt.replayed,true);assert.equal((await f.events()).length,1);
  await grantCampaignConsent(f,{buyer:a.buyer,revision:1});assert.equal((await f.events()).length,1,'saving an already granted preference is not a new grant');
  await f.decline(a.grant,2);await grantCampaignConsent(f,{buyer:a.buyer,revision:3});assert.equal((await f.events()).length,2);
  const paidKey=key();ok(await f.paid(a.order,{},paidKey));ok(await f.paid(a.order,{},paidKey));ok(await f.paid(a.order,{reference:'additional-'+a.order.id}));
  const facts=await f.events();assert.equal(facts.length,3);assert.equal(facts[2].kind,'payment');assert.equal(facts[2].consent_revision,4);assert.equal(facts[2].auth_user_id,a.buyer.id);
  const b=await f.addBuyer(2,{consent:false});const expirationKey=key();ok(await f.event(b.order,'payment.expired',{verified:true},expirationKey));ok(await f.event(b.order,'payment.expired',{verified:true},expirationKey));
  const last=(await f.events()).at(-1);assert.equal(last.kind,'expiry');assert.equal(last.consent_revision,null);assert.equal(last.order_id,b.order.id);
  const original=await f.events();await assert.rejects(f.db.prepare('UPDATE commerce_marketing_events SET email=? WHERE sequence=?').bind('wrong@example.test',last.sequence).run(),/marketing_event_immutable/);
  await assert.rejects(f.db.prepare('DELETE FROM commerce_marketing_events WHERE sequence=?').bind(last.sequence).run(),/marketing_event_immutable/);
  await assert.rejects(f.db.prepare('INSERT OR REPLACE INTO commerce_marketing_events SELECT * FROM commerce_marketing_events WHERE sequence=?').bind(last.sequence).run(),/marketing_event_immutable/);
  await assert.rejects(f.db.prepare(`INSERT INTO commerce_marketing_events(seller_id,commerce_environment,kind,source_key,order_id,auth_user_id,email,consent_revision,occurred_at)
    VALUES('seller_bob','sandbox','payment','fabricated',?,?,?,1,?)`).bind(b.order.id,a.buyer.id,a.buyer.email,new Date().toISOString()).run(),/marketing_event_source/);
  assert.deepEqual(await f.events(),original);assert.equal(f.control.calls.length,0);
});

test('automation lifecycle pins prospective activation, retains exact receipts and requires pause before edits',async t=>{
  const f=await automationFixture(t),a=await f.addBuyer(1),request={id:null,revision:0,requestKey:key(),values:f.automationValues};
  const saved=ok(await f.save(request));assert.equal(saved.automation.state,'paused');assert.deepEqual(ok(await f.save(request)).automation,saved.automation);
  const activationKey=key(),activated=ok(await f.action(saved.automation,'activate',activationKey));assert.equal(activated.automation.state,'active');
  assert.equal((await f.db.prepare('SELECT event_after FROM commerce_automations WHERE id=?').bind(saved.automation.id).first()).event_after,(await f.events()).at(-1).sequence);
  assert.equal((await f.save({id:saved.automation.id,revision:activated.automation.revision,values:{...f.automationValues,name:'Changed'}})).status,409);
  ok(await f.paid(a.order));const paused=ok(await f.action(activated.automation,'pause'));
  const replay=ok(await f.action(saved.automation,'activate',activationKey));assert.equal(replay.receipt.replayed,true);assert.equal(replay.receipt.state,'active');assert.equal(replay.automation.state,'paused');
  assert.equal((await f.action(paused.automation,'pause',activationKey)).status,409,'one reference cannot change intent');
  const edited=ok(await f.save({id:paused.automation.id,revision:paused.automation.revision,values:{...f.automationValues,name:'Revised follow-up'}}));
  const resumed=ok(await f.action(edited.automation,'activate'));assert.equal((await f.db.prepare('SELECT event_after FROM commerce_automations WHERE id=?').bind(saved.automation.id).first()).event_after,(await f.events()).at(-1).sequence);
  const again=ok(await f.action(resumed.automation,'pause')),archived=ok(await f.action(again.automation,'archive'));assert.equal(archived.automation.state,'archived');
  assert.equal((await f.action(archived.automation,'activate')).status,409);assert.equal(ok(await f.action(archived.automation,'restore')).automation.state,'paused');
  const history=ok(await f.merchant(base+'/'+saved.automation.id+'/history'));assert.equal(history.items.length,8);assert(history.items.every(v=>v.actor==='you'));
  assert.equal(await f.count('commerce_campaign_publications'),0);assert.equal(f.control.calls.length,0);
});

test('automation uncertain saves, concurrent revisions and role races never overwrite a newer rule',async t=>{
  const f=await automationFixture(t),input={id:null,revision:0,requestKey:key(),values:f.automationValues};let dropped=false;
  const env={...f.env,DB:{prepare:sql=>{const p=f.db.prepare(sql);return {bind:(...values)=>{const s=p.bind(...values);return new Proxy(s,{get:(target,property)=>property==='run'&&sql.includes('INSERT INTO commerce_automation_changes')?async()=>{const result=await target.run();if(!dropped){dropped=true;throw Error('Fixture lost save acknowledgement');}return result;}:typeof target[property]==='function'?target[property].bind(target):target[property]});}};}}};
  const saved=await saveAutomation(env,actor,input);assert(saved.receipt.replayed);assert.equal(await f.count('commerce_automations'),1);
  const edits=await Promise.all(['First','Second'].map(name=>f.save({id:saved.automation.id,revision:1,values:{...f.automationValues,name}})));assert.deepEqual(edits.map(v=>v.status).sort(),[200,409]);
  await f.db.prepare("UPDATE seller_memberships SET role='viewer' WHERE auth_user_id='alice'").run();assert.equal(ok(await f.save(input)).receipt.replayed,true);assert.equal((await f.save()).status,403);
  const latest=ok(await f.merchant(base+'/'+saved.automation.id)).automation;assert.equal((await f.action(latest,'activate')).status,403);
  await f.db.prepare("DELETE FROM seller_memberships WHERE auth_user_id='alice'").run();assert.equal((await f.save(input)).status,403);assert.equal((await f.merchant(base+'/'+saved.automation.id)).status,403);
  assert.equal((await f.db.prepare("SELECT COUNT(*) AS n FROM seller_memberships WHERE auth_user_id='alice'").first()).n,0);
});

test('automation routing and validation isolate accounts, stores, environments, actions and exact copy',async t=>{
  const f=await automationFixture(t),saved=ok(await f.save()),id=saved.automation.id;
  assert.equal((await f.merchant(base+'/'+id,undefined,{seller:'bob'})).status,404);assert.equal((await f.merchant(base+'/'+id+'/history',undefined,{seller:'bob'})).status,404);
  for(const values of [{extra:true},{trigger:'unsupported'},{delayMinutes:-1},{delayMinutes:1.1},{trigger:'winback',delayMinutes:1439},{cooldownDays:0},{subject:'unsafe\nsubject'},{audience:{admin:true}},{name:''}])assert.equal((await f.save({values:{...f.automationValues,...values}})).status,422);
  for(const query of ['?environment=production','?state=all&state=active','?cursor=','?state=unknown'])assert.equal((await f.merchant(base+query)).status,422);
  for(const route of [base+'/'+id,base+'/'+id+'/history'])assert.equal((await f.merchant(route,{}, {method:'POST'})).status,405);
  assert.equal((await f.merchant(base+'/'+id+'/action')).status,405);assert.equal((await f.merchant(base+'?state=all',{}, {method:'POST'})).status,405);
  const response=await f.mf.dispatchFetch('https://api.fixture.test'+base,{headers:{authorization:'Bearer '+await f.merchantToken(),'X-Ezkart-Marketing-Store':'seller_bob'}});assert.equal(response.status,409);
  await assert.rejects(changeAutomation({...f.env,APP_ENVIRONMENT:'production'},actor,id,{revision:1,kind:'activate',requestKey:key()}),e=>e.status===404);
  for(const table of ['commerce_automations','commerce_automation_changes'])await assert.rejects(f.db.prepare('DELETE FROM '+table).run(),/automation_(receipt_required|immutable)/);
});

test('automation holds prevent activation while preserving paused edits, explicit pause and original action recovery',async t=>{
  const f=await automationFixture(t),saved=ok(await f.save()),held={...f.env,COMMERCE_MARKETING_AUTOMATIONS:'off'};
  await assert.rejects(changeAutomation(held,actor,saved.automation.id,{revision:1,kind:'activate',requestKey:key()}),e=>e.status===503);
  const blank=ok(await f.save({values:{...f.automationValues,subject:''}}));assert.equal((await f.action(blank.automation,'activate')).status,422);
  const active=ok(await f.action(saved.automation,'activate')),paused=await changeAutomation(held,actor,active.automation.id,{revision:active.automation.revision,kind:'pause',requestKey:key()});assert.equal(paused.automation.state,'paused');
  assert.equal(f.control.calls.length,0);assert.equal(await f.count('commerce_campaign_publications'),0);
});

test('automation source migration preserves existing history without historical event enrollment',async t=>{
  const f=await automationFixture(t,{through:40}),a=await f.addBuyer(1);ok(await f.paid(a.order));const before=(await f.db.prepare('SELECT * FROM orders ORDER BY id').all()).results;
  await applyCommerceSchema(f.db,40,41);assert.equal((await f.events()).length,0);assert.deepEqual((await f.db.prepare('SELECT * FROM orders ORDER BY id').all()).results,before);
  ok(await f.paid(a.order,{reference:'additional-after-migration'}));assert.equal((await f.events()).length,0);
  const next=await unsubscribeFixtureOrder(f,a.buyer);ok(await f.paid(next));assert.equal((await f.events()).length,1);assert.equal((await f.events())[0].order_id,next.id);
  assert.deepEqual((await f.db.prepare('PRAGMA foreign_key_check').all()).results,[]);
});

test('marketing source facts roll back with failed payment and consent transactions',async t=>{
  const f=await automationFixture(t),buyer=await f.addBuyer(1),facts=await f.events(),labels=new WeakMap();
  const prepare=sql=>{const statement=f.db.prepare(sql),proxy=new Proxy(statement,{get:(target,property)=>property==='bind'? (...values)=>{const bound=target.bind(...values);labels.set(bound,sql);return bound;}:typeof target[property]==='function'?target[property].bind(target):target[property]});labels.set(proxy,sql);return proxy;};
  const broken={...f.env,DB:{prepare,batch:statements=>f.db.batch(statements.some(s=>labels.get(s)?.includes('INSERT INTO commerce_order_events'))?[...statements,f.db.prepare("SELECT json('fixture rollback')")]:statements)}};
  await assert.rejects(applyCommerceEvent(broken,buyer.order.id,{environment:'sandbox',sellerId:'seller_alice',eventKey:key(),type:'payment.succeeded',data:{provider:'doku',verified:true,amount:buyer.order.total,currency:'IDR',reference:'rollback-payment',originalRequestId:buyer.order.paymentRequestId,channel:'VIRTUAL_ACCOUNT_BCA',accountNumber:'770011223344'}}),/malformed JSON/);
  assert.deepEqual(await f.events(),facts);assert.equal(await f.count('commerce_payment_captures'),0);assert.equal(await f.count('commerce_financial_journals'),0);
  assert.equal((await f.db.prepare('SELECT checkout_state FROM orders WHERE id=?').bind(buyer.order.id).first()).checkout_state,'creating');
  ok(await f.paid(buyer.order));assert.equal((await f.events()).length,facts.length+1);
  await f.decline(buyer.grant);const before=await f.events(),input={...buyer.grant.input,revision:2,requestKey:key()};
  const consentEnv={...f.env,DB:{prepare:sql=>{const statement=f.db.prepare(sql);return {bind:(...values)=>{const bound=statement.bind(...values);return new Proxy(bound,{get:(target,property)=>property==='run'&&sql.includes('INSERT INTO commerce_customer_consent_changes')?()=>f.db.batch([bound,f.db.prepare("SELECT json('fixture rollback')")]):typeof target[property]==='function'?target[property].bind(target):target[property]});}};}}};
  await assert.rejects(customerConsents(consentEnv,input),/malformed JSON/);assert.deepEqual(await f.events(),before);
  assert.deepEqual(await f.db.prepare('SELECT revision,allowed FROM commerce_customer_consents WHERE auth_user_id=?').bind(buyer.buyer.id).first(),{revision:2,allowed:0});
  ok(await f.call('/internal/commerce/customer-consents',input));assert.equal((await f.events()).length,before.length+1);
});

test('ordinary automation rate limits never block an emergency pause',async t=>{
  const f=await automationFixture(t),saved=ok(await f.save()),active=ok(await f.action(saved.automation,'activate'));
  for(let i=0;i<28;i++)ok(await f.save({values:{...f.automationValues,name:'Rate fixture '+i}}));
  assert.equal((await f.save()).status,429);const paused=ok(await f.action(active.automation,'pause'));assert.equal(paused.automation.state,'paused');
});

test('a pause receipt on an already paused rule prevents an older delayed activation from starting it',async t=>{
  const f=await automationFixture(t),saved=ok(await f.save()),activationKey=key();
  const paused=ok(await f.action(saved.automation,'pause'));assert.equal(paused.automation.state,'paused');assert.equal(paused.automation.revision,2);
  const late=await f.action(saved.automation,'activate',activationKey);assert.equal(late.status,409);assert.equal(late.code,'automation_revision_conflict');
  const recovered=ok(await f.action(saved.automation,'pause',paused.receipt.requestKey));assert.equal(recovered.receipt.replayed,true);assert.equal(recovered.automation.state,'paused');
});
