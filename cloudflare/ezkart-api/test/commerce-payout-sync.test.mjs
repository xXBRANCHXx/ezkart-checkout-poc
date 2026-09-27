import test from 'node:test';
import assert from 'node:assert/strict';
import {setupPayoutFixture} from './payout-fixture.mjs';
import {setupWithdrawalInquiryFixture,seedLegacyPaymentGrant,withdrawalPath} from './withdrawal-inquiry-fixture.mjs';
import {payoutSyncScope} from '../src/commerce-payout-sync.js';
import {applyCommerceSchema} from './commerce-schema.mjs';

test('sync scope freezes original accounts independently of current platform configuration and exposes shared history work',async t=>{
  const f=await setupPayoutFixture(t),input={environment:f.environment},path=f.path+'/payout/sync-scope';
  const scope=await f.call(path,input);assert.equal(scope.status,200,scope.error);
  assert.equal(scope.original.sellerAccount.seller,'seller_alice');assert.equal(scope.original.platformAccount.seller,'seller_bob');
  assert.equal(scope.original.sellerAccount.pendingAccount,'2030000001');assert.equal(scope.original.platformAccount.cashAccount,'2010000002');
  assert.deepEqual(scope.plan.settlements,[{seller:'seller_alice',orderId:f.p.order.id}]);assert.equal(scope.plan.truncated,false);
  assert(Date.parse(scope.plan.from)<=Date.parse(scope.original.grantedAt)-300000);assert.equal(scope.mayPay,false);assert.equal(scope.providerCalls,0);
  const changed=await payoutSyncScope({DB:f.db,APP_ENVIRONMENT:'test',COMMERCE_PLATFORM_WALLET_SELLER:'different_seller'},f.w.id,input);
  assert.deepEqual(changed.original,scope.original);
  const cap=await f.payoutStatus(),pair=await f.collectPayout();
  assert.equal((await f.call(path,input)).sharedHistoryReview.settlements,1);
  assert.equal((await f.reconcilePayout(pair,cap)).status,200);await f.refreshEarnings(pair);
  assert.deepEqual((await f.call(path,input)).sharedHistoryReview,{settlements:0,payouts:0});
  await f.payoutStatus();assert.equal((await f.call(path,input)).sharedHistoryReview.payouts,1);
  assert.equal((await f.call(path,{...input,seller:'seller_bob'})).status,422);
  assert.equal((await f.call(path+'?retry=1',input)).status,404);
  const unsigned=await f.mf.dispatchFetch('https://api.fixture.test'+path,{method:'POST',body:JSON.stringify(input)});assert.equal(unsigned.status,401);
  await assert.rejects(payoutSyncScope({DB:f.db,APP_ENVIRONMENT:'production'},f.w.id,{environment:'production'}),error=>error instanceof Response&&error.status===503);
});

test('legacy unassigned grants cannot invent a platform account for synchronization',async t=>{
  const f=await setupWithdrawalInquiryFixture(t,{through:58}),w=await f.reserve(),i=await f.start(w),r=await f.receipt(w,f.evidence(i)),c=await f.confirm(w,r.inquiryDigest);
  await seedLegacyPaymentGrant(f,w,c.confirmation);
  await applyCommerceSchema(f.db,58);
  const result=await f.call(withdrawalPath+'/'+w.id+'/payout/sync-scope',{environment:f.environment});assert.equal(result.status,409);
  assert.equal((await f.db.prepare('SELECT platform_enrollment_id FROM commerce_withdrawal_payment_grants WHERE withdrawal_id=?').bind(w.id).first()).platform_enrollment_id,null);
});
