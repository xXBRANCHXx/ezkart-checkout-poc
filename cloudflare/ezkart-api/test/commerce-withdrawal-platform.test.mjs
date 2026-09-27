import test from 'node:test';
import assert from 'node:assert/strict';
import {setupWithdrawalInquiryFixture,withdrawalPath,seedLegacyPaymentGrant} from './withdrawal-inquiry-fixture.mjs';
import {startWithdrawalPayment,withdrawalPaymentRecovery} from '../src/commerce-withdrawal-payments.js';
import {applyCommerceSchema} from './commerce-schema.mjs';

async function fixture(t,options={}){
  const f=await setupWithdrawalInquiryFixture(t,{...options,bindings:{COMMERCE_WITHDRAWAL_PAYMENT:'enabled',...options.bindings}});
  const prepare=async()=>{const w=await f.reserve(),g=await f.start(w),r=await f.receipt(w,f.evidence(g)),c=await f.confirm(w,r.inquiryDigest);
    assert.equal(c.status,200,c.error);return {w,g,r,c};};
  const input=p=>({...f.scope(),confirmationId:p.c.confirmation.id,credentialFingerprint:'a'.repeat(64),clientId:'MCH-FIXTURE-SNAP'});
  return {...f,prepare,input};
}
const rejected=status=>e=>e instanceof Response&&e.status===status;

test('payment grants freeze the confirmed platform identity and retain it after configuration changes without claiming fee funding',async t=>{
  const f=await fixture(t),p=await f.prepare(),env=await f.mf.getBindings(),before=await f.summary();
  const g=await startWithdrawalPayment(env,p.w.id,f.input(p));assert.equal(g.mayPay,true);
  assert.deepEqual(g.feeAccount,{enrollmentId:f.enrollments.bob,seller:'seller_bob',profileId:'SAC-bob',cashAccount:'2010000002',
    parentProfileId:'BRN-fixture',feePayer:'ezkart',sellerWithdrawalFee:'0',providerFundingVerified:false});
  for(const configured of ['',undefined,'seller_alice','seller_other']){
    const changed={...env,COMMERCE_PLATFORM_WALLET_SELLER:configured};
    assert.equal((await startWithdrawalPayment(changed,p.w.id,f.input(p))).mayPay,false);
    assert.deepEqual((await withdrawalPaymentRecovery(changed,p.w.id,{environment:f.environment})).feeAccount,g.feeAccount);
  }
  assert.deepEqual(await f.summary(),before);assert.equal((await f.earnings()).reservedWithdrawals,'250000');
  const detail=await f.readWithdrawal(p.w);assert(!/2010000002|SAC-bob|platform_enrollment/.test(JSON.stringify(detail)));
  await assert.rejects(f.db.prepare('UPDATE commerce_withdrawal_payment_grants SET platform_enrollment_id=NULL WHERE withdrawal_id=?').bind(p.w.id).run(),/withdrawal_payment_immutable/);
});

test('missing, self-selected, inactive and mismatched platform accounts cannot acquire payment authority',async t=>{
  const f=await fixture(t),p=await f.prepare(),env=await f.mf.getBindings();
  for(const account of ['',undefined,'seller_alice'])await assert.rejects(startWithdrawalPayment({...env,COMMERCE_PLATFORM_WALLET_SELLER:account},p.w.id,f.input(p)),rejected(503));
  await assert.rejects(startWithdrawalPayment({...env,COMMERCE_PLATFORM_WALLET_SELLER:'seller_unknown'},p.w.id,f.input(p)),rejected(409));
  await assert.rejects(startWithdrawalPayment(env,p.w.id,{...f.input(p),platformEnrollmentId:f.enrollments.bob}),rejected(422));
  await f.db.prepare("UPDATE sellers SET status='suspended' WHERE id='seller_bob'").run();
  await assert.rejects(startWithdrawalPayment(env,p.w.id,f.input(p)),rejected(409));
  assert.equal((await f.db.prepare('SELECT COUNT(*) AS n FROM commerce_withdrawal_payment_grants').first()).n,0);
  await f.db.prepare("UPDATE sellers SET status='active' WHERE id='seller_bob'").run();
  const original=await startWithdrawalPayment(env,p.w.id,f.input(p)),q=await f.prepare();
  const saved=await f.db.prepare('SELECT * FROM commerce_withdrawal_payment_grants WHERE withdrawal_id=?').bind(p.w.id).first();
  const receipt=await f.recover(q.w),response=JSON.parse(receipt.originalEvidence.responseBody);
  const request={...JSON.parse(receipt.originalEvidence.requestBody),referenceNo:response.referenceNo,beneficiaryAccountName:response.beneficiaryAccountName};
  const funds=await f.db.prepare("SELECT source_json FROM commerce_withdrawal_funds WHERE seller_id='seller_alice' AND commerce_environment='sandbox'").first();
  const record={...saved,withdrawal_id:q.w.id,confirmation_id:q.c.confirmation.id,payment_external_id:q.g.binding.paymentExternalId,inquiry_digest:q.r.inquiryDigest,request_body:JSON.stringify(request),funds_json:funds.source_json};
  delete record.created_at;
  const insert=change=>{const row={...record,...change};return f.db.prepare('INSERT INTO commerce_withdrawal_payment_grants('+Object.keys(row).join(',')+",created_at) VALUES("+Object.keys(row).map(()=>'?').join(',')+",strftime('%Y-%m-%dT%H:%M:%fZ','now'))").bind(...Object.values(row)).run();};
  for(const change of [{platform_enrollment_id:null},{platform_enrollment_id:f.enrollments.alice},{platform_enrollment_id:'unknown'},
    {client_id:'MCH-FOREIGN'},{credential_fingerprint:'b'.repeat(64)},{commerce_environment:'production'}])
    await assert.rejects(insert(change),/withdrawal_payment_platform_required/);
  assert.equal(original.feeAccount.sellerWithdrawalFee,'0');assert.equal((await startWithdrawalPayment(env,q.w.id,f.input(q))).mayPay,true);
});

test('a populated 0058 upgrade preserves legacy grants without inventing a platform account or renewing send authority',async t=>{
  const f=await fixture(t,{through:58}),p=await f.prepare();await seedLegacyPaymentGrant(f,p.w,p.c.confirmation);
  const before=(await f.db.prepare('SELECT * FROM commerce_withdrawal_payment_grants').all()).results;
  const money=(await f.db.prepare('SELECT * FROM commerce_financial_journals').all()).results;
  await applyCommerceSchema(f.db,58);
  const after=(await f.db.prepare('SELECT * FROM commerce_withdrawal_payment_grants').all()).results;
  assert.deepEqual(after,before.map(row=>({...row,platform_enrollment_id:null})));
  assert.deepEqual((await f.db.prepare('SELECT * FROM commerce_financial_journals').all()).results,money);
  const env=await f.mf.getBindings();assert.equal((await startWithdrawalPayment(env,p.w.id,f.input(p))).mayPay,false);
  const recovered=await withdrawalPaymentRecovery(env,p.w.id,{environment:f.environment});assert.equal(recovered.feeAccount,null);assert.equal(recovered.payoutConfirmed,false);
  assert.equal((await f.cancel(p.w)).status,409);assert.deepEqual((await f.db.prepare('PRAGMA foreign_key_check').all()).results,[]);
  const next=await f.prepare();assert.equal((await startWithdrawalPayment(env,next.w.id,f.input(next))).feeAccount.enrollmentId,f.enrollments.bob);
});
