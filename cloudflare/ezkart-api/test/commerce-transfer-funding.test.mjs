import {setupPayoutFixture} from './payout-fixture.mjs';
import test from 'node:test';import assert from 'node:assert/strict';
import {setupWithdrawalInquiryFixture} from './withdrawal-inquiry-fixture.mjs';
import {startWithdrawalPayment,withdrawalPaymentRecovery} from '../src/commerce-withdrawal-payments.js';
import {fixtureTransferContract} from './transfer-funding-fixture.mjs';
async function ready(t){const f=await setupWithdrawalInquiryFixture(t,{bindings:{COMMERCE_WITHDRAWAL_PAYMENT:'enabled'}}),w=await f.reserve(),g=await f.start(w),r=await f.receipt(w,f.evidence(g)),c=await f.confirm(w,r.inquiryDigest),env=await f.mf.getBindings();
 return {...f,w,env,input:{...f.scope(),confirmationId:c.confirmation.id,credentialFingerprint:'a'.repeat(64),clientId:'MCH-FIXTURE-SNAP'}};}
const denied=e=>e instanceof Response&&[409,503].includes(e.status);
test('fee contract and budget are bound atomically to the original one-send grant and survive removed configuration',async t=>{
 const f=await ready(t),sent=await Promise.all([startWithdrawalPayment(f.env,f.w.id,f.input),startWithdrawalPayment(f.env,f.w.id,f.input)]);
 assert.equal(sent.filter(x=>x.mayPay).length,1);const grant=sent.find(x=>x.mayPay);assert.equal(grant.feeAccount.feeLimit,'500');assert.equal(grant.feeAccount.budgetReserved,true);assert.equal(grant.feeAccount.providerFundingVerified,true);
 assert.equal((await f.db.prepare('SELECT COUNT(*) n FROM commerce_transfer_fee_reservations').first()).n,1);
 const original=await withdrawalPaymentRecovery({...f.env,COMMERCE_TRANSFER_FEE_CONTRACT:'',COMMERCE_PLATFORM_WALLET_SELLER:''},f.w.id,{environment:f.environment});assert.deepEqual(original.feeAccount,grant.feeAccount);assert.equal(original.mayPay,false);
 assert.equal((await startWithdrawalPayment({...f.env,COMMERCE_TRANSFER_FEE_CONTRACT:''},f.w.id,f.input)).mayPay,false);
 for(const table of ['commerce_transfer_fee_reservations','commerce_transfer_fee_contracts'])await assert.rejects(f.db.prepare('DELETE FROM '+table).run(),/immutable/);
 assert.equal((await f.db.prepare('SELECT reserved_transfer_fees FROM commerce_treasury_funds WHERE platform_enrollment_id=?').bind(f.enrollments.bob).first()).reserved_transfer_fees,500);
});
test('missing fee facts, seller-charged mode, excessive ceiling, unavailable or superseded company cash fail before authority',async t=>{
 const f=await ready(t);
 for(const contract of ['',fixtureTransferContract({chargedCashAccount:'2010000001'}),fixtureTransferContract({sellerFeeBilling:'seller_cash'}),fixtureTransferContract({channels:{BI_FAST:'40001'}}),fixtureTransferContract({validUntil:'2020-02-01T00:00:00.000Z'})])
  await assert.rejects(startWithdrawalPayment({...f.env,COMMERCE_TRANSFER_FEE_CONTRACT:contract},f.w.id,f.input),denied);
 await f.balance('1000000',{seller:'seller_bob',requestedAt:new Date().toISOString(),observedAt:new Date().toISOString()});
 await assert.rejects(startWithdrawalPayment(f.env,f.w.id,f.input),denied);
 const pair=await f.collect(f.p,f.legs(f.p),{balance:'0'});await f.reconcile(f.p,pair);await f.catchUp();
 await assert.rejects(startWithdrawalPayment(f.env,f.w.id,f.input),denied);
 assert.equal((await f.db.prepare('SELECT COUNT(*) n FROM commerce_withdrawal_payment_grants').first()).n,0);assert.equal((await f.db.prepare('SELECT COUNT(*) n FROM commerce_transfer_fee_reservations').first()).n,0);
});
test('fee reservation failure rolls back the send grant and contract; the original retry can fund once',async t=>{
 const f=await ready(t);await f.db.prepare("CREATE TRIGGER fixture_fee_failure BEFORE INSERT ON commerce_transfer_fee_reservations BEGIN SELECT RAISE(ABORT,'fixture_fee_failure'); END;").run();
 await assert.rejects(startWithdrawalPayment(f.env,f.w.id,f.input),/fixture_fee_failure/);
 for(const table of ['commerce_withdrawal_payment_grants','commerce_transfer_fee_reservations','commerce_transfer_fee_contracts'])assert.equal((await f.db.prepare('SELECT COUNT(*) n FROM '+table).first()).n,0);
 await f.db.prepare('DROP TRIGGER fixture_fee_failure').run();assert.equal((await startWithdrawalPayment(f.env,f.w.id,f.input)).mayPay,true);
});

test('concurrent distinct payouts cannot spend the same company fee budget',async t=>{
 const f=await ready(t),w=await f.reserve(),g=await f.start(w),r=await f.receipt(w,f.evidence(g)),c=await f.confirm(w,r.inquiryDigest);
 const env={...f.env,COMMERCE_TRANSFER_FEE_CONTRACT:fixtureTransferContract({channels:{BI_FAST:'30000'}})};
 const results=await Promise.allSettled([startWithdrawalPayment(env,f.w.id,f.input),startWithdrawalPayment(env,w.id,{...f.input,confirmationId:c.confirmation.id})]);
 assert.equal(results.filter(r=>r.status==='fulfilled'&&r.value.mayPay).length,1);const rejected=results.find(r=>r.status==='rejected');assert(rejected.reason instanceof Response);assert.equal(rejected.reason.status,409);
 assert.equal((await f.db.prepare('SELECT COUNT(*) n FROM commerce_withdrawal_payment_grants').first()).n,1);
 assert.equal((await f.db.prepare('SELECT SUM(fee_limit) n FROM commerce_transfer_fee_reservations').first()).n,30000);
});

test('actual seller fee releases only its original ceiling; newer evidence reholds it without restoring booked cash',async t=>{
 const f=await setupPayoutFixture(t),cap=await f.payoutStatus(),pair=await f.collectPayout({fees:[f.row('PAYOUT_CHARGE',300)]});
 const paid=await f.reconcilePayout(pair,cap);assert.equal(paid.status,200,paid.error);assert.equal(paid.outcome.reconciled,true);
 let fee=await f.db.prepare('SELECT * FROM commerce_transfer_fee_positions WHERE transfer_id=?').bind(f.w.id).first();assert.equal(fee.fee_limit,500);assert.equal(fee.reserved_fee,0);
 const n=(await f.db.prepare('SELECT COUNT(*) n FROM commerce_transfer_fee_releases').first()).n;
 await f.balance('1000000',{seller:'seller_bob',requestedAt:new Date().toISOString(),observedAt:new Date().toISOString()});
 fee=await f.db.prepare('SELECT * FROM commerce_transfer_fee_positions WHERE transfer_id=?').bind(f.w.id).first();assert.equal(fee.reserved_fee,500);
 assert.equal((await f.db.prepare('SELECT fee_amount FROM commerce_payout_positions WHERE withdrawal_id=?').bind(f.w.id).first()).fee_amount,300);
 assert.equal((await f.db.prepare('SELECT COUNT(*) n FROM commerce_transfer_fee_releases').first()).n,n);
});
