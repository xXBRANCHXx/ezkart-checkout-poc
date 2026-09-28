import test from 'node:test';
import assert from 'node:assert/strict';
import {setupRefundProcessingFixture,refundProcessingKey as key} from './refund-processing-fixture.mjs';
import {changeRefundProcessing} from '../src/commerce-refund-processing.js';
import {setupCommerceFixture} from './commerce-fixture.mjs';
import {applyCommerceSchema} from './commerce-schema.mjs';

const body=(r,state='started')=>({kind:'record_provider_followup',requestKey:key(),providerRequestId:r.processing.request.id,
  previousId:r.processing.followup?.id||null,state,reference:'ORIGINAL-CASE-REFERENCE',observedAt:new Date().toISOString()});
async function prepared(t){const f=await setupRefundProcessingFixture(t);await f.bank();assert.equal((await f.prepare()).status,200);return f;}

test('original handoff survives a lost acknowledgement, concurrency and uncertain/provider-reported completion without moving money',async t=>{
  const f=await prepared(t),original=await f.view('bob'),input=body(original);
  const tables=['commerce_financial_entries','commerce_refund_finalizations','commerce_digital_entitlements'];
  const before={};for(const table of tables)before[table]=(await f.db.prepare('SELECT * FROM '+table).all()).results;
  const db=new Proxy(f.db,{get(target,prop){if(prop==='prepare')return sql=>{const stmt=target.prepare(sql);if(!sql.startsWith('INSERT INTO commerce_refund_provider_followups('))return stmt;
    return {bind(...values){return {async run(){await stmt.bind(...values).run();throw Error('Lost acknowledgement after commit');}};}};};const value=Reflect.get(target,prop);return typeof value==='function'?value.bind(target):value;}});
  const env={DB:db,APP_ENVIRONMENT:'test',COMMERCE_STORAGE:'d1'},actor={kind:'support',id:'bob',aal:'aal2',proofExpiresAt:Math.floor(Date.now()/1000)+600};
  const started=await changeRefundProcessing(env,actor,f.refund.id,input);assert.equal(started.processing.followup.state,'started');assert.equal(started.processing.canStartHandoff,false);
  assert.equal((await f.processing(input)).status,200);assert.equal((await f.processing({...input,reference:'ANOTHER'})).status,409);
  assert.equal((await f.processing({...input,requestKey:key()})).status,409);
  const next=body(await f.view('bob'),'uncertain'),races=await Promise.all([f.processing(next),f.processing({...next,requestKey:key(),state:'processing'})]);
  assert.deepEqual(races.map(r=>r.status).sort(),[200,409]);
  const reported=await f.processing(body(await f.view('bob'),'returned_reported'));assert.equal(reported.status,200,reported.error);
  assert.equal(reported.refund.processing.paymentConfirmed,false);assert.equal(reported.refund.processing.followup.state,'returned_reported');
  assert.match(reported.refund.processing.stateLabel,/not verified/);
  for(const who of [f.buyer,'alice']){const r=await f.view(who);assert(!JSON.stringify(r).includes('ORIGINAL-CASE-REFERENCE'));assert.equal(r.processing.paymentConfirmed,false);}
  for(const table of tables)assert.deepEqual((await f.db.prepare('SELECT * FROM '+table).all()).results,before[table]);
  assert.equal((await f.db.prepare('SELECT COUNT(*) n FROM commerce_refund_verified_outcomes').first()).n,0);
  assert.equal((await f.db.prepare('SELECT checkout_state FROM orders WHERE id=?').bind(f.p.order.id).first()).checkout_state,'paid');
  assert.equal((await f.call('/internal/commerce/finance/refunds/finalize',{environment:f.environment,seller:'seller_alice',refundId:f.refund.id,evidenceId:'ORIGINAL-CASE-REFERENCE'})).status,409);
  for(const operation of ['DELETE FROM commerce_refund_provider_followups','UPDATE commerce_refund_provider_followups SET state=\'processing\'','INSERT OR REPLACE INTO commerce_refund_provider_followups SELECT * FROM commerce_refund_provider_followups'])await assert.rejects(f.db.prepare(operation).run(),/immutable/);
});

test('follow-ups require current review authority and monotone real observation dates; original submissions remain recoverable',async t=>{
  const f=await prepared(t),input=body(await f.view('bob'));
  assert.equal((await f.processing(input,601)).status,401);
  for(const observedAt of ['2026-02-30T00:00:00.000Z','invalid','2000-01-01T00:00:00.000Z',new Date(Date.now()+600000).toISOString()])assert.equal((await f.processing({...input,observedAt})).status,observedAt==='invalid'||observedAt.includes('02-30')?422:409);
  assert.equal((await f.processing({...input,state:'processing'})).status,409);
  await f.permission('viewer');assert.equal((await f.processing(input)).status,403);await f.permission();
  const submitted=await f.processing({kind:'record_provider_submission',requestKey:key(),providerRequestId:input.providerRequestId,channel:'email',reference:'ORIGINAL-SENT-MESSAGE',submittedAt:new Date().toISOString(),confirmed:true});assert.equal(submitted.status,200,submitted.error);
  assert.equal((await f.processing(input)).status,409);
  const update=body(await f.view('bob'),'processing');assert.equal((await f.processing(update)).status,200);
  const earlier=body(await f.view('bob'),'uncertain');earlier.observedAt=new Date(Date.parse(update.observedAt)-1).toISOString();assert.equal((await f.processing(earlier)).status,409);
});

test('0074 preserves populated refund and financial records; it never converts a support attestation into proof',async t=>{
  const f=await setupCommerceFixture(t,{through:73});const made=await f.create(f.input());assert.equal((await f.paid(made.order)).status,200);
  const tables=['commerce_refunds','commerce_refund_provider_requests','commerce_financial_entries','commerce_payment_captures','orders'],before={};
  for(const table of tables)before[table]=(await f.db.prepare('SELECT * FROM '+table).all()).results;
  await applyCommerceSchema(f.db,73,74);
  for(const table of tables)assert.deepEqual((await f.db.prepare('SELECT * FROM '+table).all()).results,before[table]);
  assert.equal((await f.db.prepare('SELECT COUNT(*) n FROM commerce_refund_provider_followups').first()).n,0);
  assert.deepEqual((await f.db.prepare('PRAGMA foreign_key_check').all()).results,[]);
});
