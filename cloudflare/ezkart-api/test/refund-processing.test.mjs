import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {setupRefundProcessingFixture,refundProcessingKey as key,refundProcessingClaims as claims} from './refund-processing-fixture.mjs';
import {saveRefundBank,changeRefundProcessing} from '../src/commerce-refund-processing.js';
import {setupCommerceFixture} from './commerce-fixture.mjs';
import {applyCommerceSchema} from './commerce-schema.mjs';

test('a settled approved refund has one original DOKU packet, private buyer bank details and a distinct submission record',async t=>{
  const f=await setupRefundProcessingFixture(t),before=(await f.db.prepare('SELECT * FROM commerce_financial_entries').all()).results;
  const b=await f.bank();assert.equal(b.status,200,b.error);assert.equal(b.refund.processing.bank.accountEnding,'8900');assert(!JSON.stringify(b).includes(f.bankBody.accountNumber));
  assert.equal((await f.bank()).status,200);assert.equal((await f.db.prepare('SELECT COUNT(*) n FROM commerce_refund_bank_details').first()).n,1);
  const merchant=await f.view('alice');assert.equal(merchant.processing.bank,null);assert.equal(merchant.processing.bankProvided,true);assert(!JSON.stringify(merchant).includes('Fixture Buyer'));
  const draft=await f.prepare();assert.equal(draft.status,200,draft.error);assert.equal(draft.refund.processing.state,'prepared');assert.equal(draft.refund.paymentConfirmed,false);
  const download=await f.merchant(f.support+'/packet',undefined,{seller:'bob',claims:claims()});assert.equal(download.status,200,download.error);
  assert(download.packet.content.includes('Invoice number: '+f.p.order.id));assert(download.packet.content.includes('Refund amount: IDR 10000'));
  assert(download.packet.content.includes('Account number: '+f.bankBody.accountNumber));assert.equal(download.packet.sha256,createHash('sha256').update(download.packet.content).digest('hex'));
  assert.equal((await f.bank({previousId:b.refund.processing.bank.id,accountNumber:'111111111111'})).status,409);
  const input={kind:'record_provider_submission',requestKey:key(),providerRequestId:draft.refund.processing.request.id,channel:'support_ticket',reference:'DOKU-FIXTURE-001',submittedAt:new Date().toISOString(),confirmed:true};
  const sent=await f.processing(input);assert.equal(sent.status,200,sent.error);assert.equal(sent.refund.processing.state,'submitted');assert.equal(sent.refund.processing.paymentConfirmed,false);
  assert.equal((await f.processing(input)).status,200);assert.equal((await f.processing({...input,requestKey:key()})).status,409);
  assert.equal((await f.db.prepare('SELECT COUNT(*) n FROM commerce_refund_provider_submissions').first()).n,1);
  assert.deepEqual((await f.db.prepare('SELECT * FROM commerce_financial_entries').all()).results,before);
  assert.equal((await f.db.prepare('SELECT checkout_state FROM orders WHERE id=?').bind(f.p.order.id).first()).checkout_state,'paid');
  const buyer=await f.view();assert(!JSON.stringify(buyer).includes('DOKU-FIXTURE-001'));assert(!JSON.stringify(buyer).includes('credentialFingerprint'));
  assert.deepEqual((await f.merchant(f.support+'/packet',undefined,{seller:'bob',claims:claims()})).packet,download.packet);
  const queue=await f.merchant('/v1/support/refunds?state=processing',undefined,{seller:'bob',claims:claims()});assert.equal(queue.status,200,queue.error);assert.equal(queue.refunds[0].id,f.refund.id);
  for(const table of ['commerce_refund_bank_details','commerce_refund_provider_requests','commerce_refund_provider_submissions']){
    await assert.rejects(f.db.prepare('DELETE FROM '+table).run(),/immutable/);await assert.rejects(f.db.prepare('INSERT OR REPLACE INTO '+table+' SELECT * FROM '+table).run(),/immutable/);
  }
});

test('preparation needs current settlement, current evidence, latest buyer bank details and fresh separately granted review access',async t=>{
  const f=await setupRefundProcessingFixture(t,{settled:false});assert.equal((await f.bank()).status,200);
  assert.equal((await f.prepare()).status,409);await f.settle(f.p);const body=await f.prepareBody();
  assert.equal((await f.processing(body,601)).status,401);await f.permission('viewer');assert.equal((await f.processing(body)).status,403);await f.permission();
  assert.equal((await f.merchant(f.url+'/bank',f.bankBody,{seller:'alice',method:'POST'})).status,404);
  assert.equal((await f.merchant(f.support+'/processing',body,{seller:'alice',claims:claims(),method:'POST'})).status,403);
  const corrected=await f.bank({previousId:body.bankId,accountNumber:'999999999999'});assert.equal(corrected.status,200,corrected.error);assert.equal((await f.processing(body)).status,409);
  const next=await f.prepareBody();assert.equal((await f.processing({...next,evidenceVersion:2})).status,409);
  assert.equal((await f.processing(next)).status,200);
  assert.equal((await f.merchant(f.support+'/packet',undefined,{seller:'bob',claims:claims(601)})).status,401);
  await f.permission('viewer');assert.equal((await f.merchant(f.support+'/packet',undefined,{seller:'bob',claims:claims()})).status,403);
  await f.permission('revoked');assert.equal((await f.merchant(f.support,undefined,{seller:'bob',claims:claims()})).status,403);
});

test('bank changes and provider preparation serialize; stale evidence and operator proof cannot enter through direct database writes',async t=>{
  const f=await setupRefundProcessingFixture(t);await f.bank();const original=await f.prepareBody();
  const result=await Promise.all([f.processing(original),f.bank({previousId:original.bankId,accountNumber:'333333333333'})]);
  assert.deepEqual(result.map(x=>x.status).sort(),[200,409],JSON.stringify(result));
  if(result[0].status!==200)assert.equal((await f.prepare()).status,200);
  const request=await f.db.prepare('SELECT * FROM commerce_refund_provider_requests').first(),bank=await f.db.prepare('SELECT * FROM commerce_refund_current_bank').first();assert.equal(request.bank_id,bank.id);
  const submission=changes=>{const row={id:'rsubmit_'+key(),provider_request_id:request.id,actor_auth_user_id:'bob',proof_expires_at:Math.floor(Date.now()/1000)+600,request_key:key(),request_hash:key(),channel:'email',reference:'original-message-id',submitted_at:new Date().toISOString(),recorded_at:new Date().toISOString(),...changes};return f.db.prepare('INSERT INTO commerce_refund_provider_submissions('+Object.keys(row).join(',')+') VALUES('+Object.keys(row).map(()=>'?').join(',')+')').bind(...Object.values(row)).run();};
  await assert.rejects(submission({proof_expires_at:0}),/proof_expired/);await assert.rejects(submission({submitted_at:'2000-01-01T00:00:00.000Z'}),/date_invalid/);
  await f.permission('revoked');await assert.rejects(submission({}),/actor_forbidden/);
});

test('lost committed bank and provider preparation replies recover their original records without changing financial history',async t=>{
  const f=await setupRefundProcessingFixture(t);const proxy=prefix=>new Proxy(f.db,{get(target,prop){if(prop==='prepare')return sql=>{const stmt=target.prepare(sql);if(!sql.startsWith(prefix))return stmt;return {bind(...args){return {async run(){await stmt.bind(...args).run();throw Error('Lost committed acknowledgement');}};}};};const v=Reflect.get(target,prop);return typeof v==='function'?v.bind(target):v;}});
  const env={DB:proxy('INSERT INTO commerce_refund_bank_details('),APP_ENVIRONMENT:'test',COMMERCE_STORAGE:'d1'};
  const saved=await saveRefundBank(env,{kind:'buyer',id:f.buyer},f.refund.id,f.bankBody,f.p.order.id);assert.equal(saved.processing.bank.accountEnding,'8900');
  const body=await f.prepareBody(),actor={kind:'support',id:'bob',aal:'aal2',proofExpiresAt:Math.floor(Date.now()/1000)+600};
  const prepared=await changeRefundProcessing({...env,DB:proxy('INSERT INTO commerce_refund_provider_requests(')},actor,f.refund.id,body);assert.equal(prepared.processing.state,'prepared');
  assert.equal((await f.processing(body)).status,200);assert.equal((await f.processing({...body,evidenceVersion:1})).status,409);
  assert.equal((await f.db.prepare('SELECT COUNT(*) n FROM commerce_refund_provider_requests').first()).n,1);
});

test('later appeals preserve a prepared refund allocation and cannot turn an external request into released earnings',async t=>{
  const f=await setupRefundProcessingFixture(t);await f.deliver(f.p);await f.catchUp();await f.bank();assert.equal((await f.prepare()).status,200);
  const r=await f.view();const opened=await f.merchant(f.url+'/dispute',{requestKey:key(),kind:'review_open',revision:0,refundRevision:r.revision,orderRevision:r.orderRevision,evidenceVersion:0,message:'The bank destination needs a provider review.'},{seller:f.buyer,method:'POST'});assert.equal(opened.status,200,opened.error);
  const d=(await f.view('bob')).dispute;assert.equal(d.canDecide,false);assert.equal(d.canAsk,true);
  const body={requestKey:key(),kind:'review_decline',revision:d.revision,refundRevision:r.revision,orderRevision:r.orderRevision,evidenceVersion:0,message:'Do not release this allocated refund.'};
  assert.equal((await f.merchant(f.support+'/dispute',body,{seller:'bob',claims:claims(),method:'POST'})).status,409);
  assert.equal((await f.earnings()).availableEarnings,'0');assert.equal((await f.view()).state,'approved');
});

test('0065 preserves populated original refunds and accounting while adding no bank or provider records',async t=>{
  const f=await setupCommerceFixture(t,{through:64}),made=await f.create(f.input()),paid=await f.paid(made.order);assert.equal(paid.status,200);
  const tables=['orders','commerce_payment_captures','commerce_refunds','commerce_financial_entries','commerce_earnings_assessments','commerce_earnings_inputs'],before={};
  for(const table of tables)before[table]=(await f.db.prepare('SELECT * FROM '+table).all()).results;
  await applyCommerceSchema(f.db,64,65);for(const table of tables)assert.deepEqual((await f.db.prepare('SELECT * FROM '+table).all()).results,before[table],table);
  for(const table of ['commerce_refund_bank_details','commerce_refund_provider_requests','commerce_refund_provider_submissions'])assert.equal((await f.db.prepare('SELECT COUNT(*) n FROM '+table).first()).n,0);
  assert.deepEqual((await f.db.prepare('PRAGMA foreign_key_check').all()).results,[]);
});
