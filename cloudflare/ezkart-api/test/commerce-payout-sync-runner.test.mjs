import test from 'node:test';
import assert from 'node:assert/strict';
import {randomBytes} from 'node:crypto';
import {setupCommerceFixture} from './commerce-fixture.mjs';
import {setupPayoutFixture} from './payout-fixture.mjs';
import {applyCommerceSchema} from './commerce-schema.mjs';
import {startPayoutSyncRunner} from '../src/commerce-payout-sync-runner.js';
import {main as inspect} from '../../../tools/commerce/operations-report.mjs';

const base='/internal/commerce/finance/payout-sync/runner/',key=()=>randomBytes(16).toString('hex');
async function fixture(t,options={}){
  const f=await setupCommerceFixture(t,options),environment=options.bindings?.APP_ENVIRONMENT==='beta'?'production':'sandbox';
  const call=(name,input={})=>f.call(base+name,{environment,...input});
  const identity=(storageId='fixture_receipts')=>({storageId,runId:key()});
  const result=(state='held')=>({state,reason:{held:'held',idle:'nothing_due',failed:'dispatch_failed'}[state],queued:0,processed:0,providerCalls:0});
  return {...f,environment,callRunner:call,identity,result};
}
const report=(f,at=new Date().toISOString())=>inspect(['--deployment='+(f.environment==='production'?'beta':'test'),'--fail-on-warning'],async sql=>{
  const r=await f.db.prepare(sql).all();assert.equal(r.meta.rows_written,0);return r.results;
},at);

test('a held beta runner records liveness without enabling provider reads or creating work',async t=>{
  const f=await fixture(t,{bindings:{APP_ENVIRONMENT:'beta'}}),i=f.identity();
  assert.equal((await f.callRunner('status')).runner,null);
  const started=await f.callRunner('start',i);assert.equal(started.status,200,started.error);assert.equal(started.owned,true);assert.equal(started.mayPay,false);
  assert.equal((await f.callRunner('pulse',i)).status,200);
  const done=await f.callRunner('finish',{...i,result:f.result()});assert.equal(done.status,200,done.error);assert.equal(done.runner.state,'held');
  const status=await f.callRunner('status');assert.equal(status.held,true);assert.equal(status.runner.runs,1);
  assert.equal((await f.call('/internal/commerce/finance/payout-sync/claim',{environment:f.environment})).status,503);
  assert.equal((await f.db.prepare('SELECT COUNT(*) n FROM commerce_payout_sync_jobs').first()).n,0);
  assert.equal((await f.db.prepare('SELECT COUNT(*) n FROM commerce_financial_journals').first()).n,0);
  const seen=await report(f);assert(seen.warnings.includes('payout_runner_held'));assert(!JSON.stringify(seen).includes(i.runId));assert(!JSON.stringify(seen).includes(i.storageId));
});

test('concurrent starts share one lease, exact acknowledgements replay, and original receipt storage is immutable',async t=>{
  const f=await fixture(t),ids=[f.identity(),f.identity()];
  const started=await Promise.all(ids.map(x=>f.callRunner('start',x)));assert(started.every(x=>x.status===200),JSON.stringify(started));
  assert.equal(started.filter(x=>x.owned).length,1);const winner=ids[started.findIndex(x=>x.owned)];
  const repeat=await f.callRunner('start',winner);assert.equal(repeat.replayed,true);assert.equal(repeat.runner.runs,1);
  assert.equal((await f.callRunner('start',f.identity('another_storage'))).status,409);
  const body={...winner,result:f.result('failed')};const finishes=await Promise.all([f.callRunner('finish',body),f.callRunner('finish',body)]);
  assert(finishes.every(x=>x.status===200),JSON.stringify(finishes));assert.equal((await f.callRunner('status')).runner.failedRuns,1);
  assert.equal((await f.callRunner('finish',{...winner,result:f.result()})).status,409);
  await assert.rejects(f.db.prepare("UPDATE commerce_payout_sync_runner SET storage_id='another_storage'").run(),/storage_immutable/);
  await assert.rejects(f.db.prepare('DELETE FROM commerce_payout_sync_runner').run(),/keep_history/);
});

test('interrupted and stale runners are visible; a saved completion recovers after expiry only while its original run remains current',async t=>{
  const f=await fixture(t),first=f.identity();await f.callRunner('start',first);
  const future=new Date(Date.now()+16*60000).toISOString(),before=(await f.db.prepare('SELECT * FROM commerce_payout_sync_runner').all()).results;
  const stale=await report(f,future);assert(stale.warnings.includes('payout_runner_overdue'));assert(stale.warnings.includes('payout_runner_interrupted'));
  assert.deepEqual((await f.db.prepare('SELECT * FROM commerce_payout_sync_runner').all()).results,before);
  await f.db.prepare("UPDATE commerce_payout_sync_runner SET lease_until='2000-01-01T00:00:00.000Z'").run();
  assert.equal((await f.callRunner('pulse',first)).status,409);
  assert.equal((await f.callRunner('finish',{...first,result:f.result('idle')})).status,200);
  const second=f.identity();await f.callRunner('start',second);
  await f.db.prepare("UPDATE commerce_payout_sync_runner SET lease_until='2000-01-01T00:00:00.000Z'").run();
  const third=f.identity(),recovered=await f.callRunner('start',third);assert.equal(recovered.owned,true);assert.equal(recovered.runner.interruptedRuns,1);
  assert.equal((await f.callRunner('finish',{...second,result:f.result('idle')})).status,409);
  assert.equal((await f.callRunner('pulse',second)).status,409);
  assert.equal((await f.callRunner('finish',{...third,result:f.result('idle')})).status,200);
  const current=await report(f);assert(!current.warnings.includes('payout_runner_overdue'));assert.equal(current.payoutRunner.runs,3);assert.equal(current.payoutRunner.interruptedRuns,1);
});

test('runner routes reject unsigned, main, foreign-environment, inconsistent and unrecognized parameters',async t=>{
  const f=await fixture(t),i=f.identity();
  assert.equal((await f.mf.dispatchFetch('https://api.fixture.test'+base+'status',{method:'POST',body:'{"environment":"sandbox"}'})).status,401);
  assert.equal((await f.call(base+'status',{environment:'production'})).status,403);
  assert.equal((await f.callRunner('start',{...i,amount:250000})).status,422);
  assert.equal((await f.call(base+'status?retry=1',{environment:f.environment})).status,404);
  await assert.rejects(startPayoutSyncRunner({APP_ENVIRONMENT:'production',DB:f.db},{environment:'production',...i}),e=>e instanceof Response&&e.status===503);
  await f.callRunner('start',i);
  assert.equal((await f.callRunner('finish',{...i,result:{...f.result(),state:'completed'}})).status,422);
  assert.equal((await f.callRunner('finish',{...i,result:{...f.result(),providerCalls:1}})).status,422);
  assert.equal((await f.callRunner('finish',{...i,result:{...f.result(),private:'not-allowed'}})).status,422);
  assert.equal((await f.callRunner('status')).runner.state,'running');
});

test('0062 preserves original payout records and reports overdue, expired and current-review work without changing it',async t=>{
  const f=await setupPayoutFixture(t,{through:61,bindings:{COMMERCE_WITHDRAWAL_SYNC:'enabled'}});
  const tables=['commerce_withdrawals','commerce_withdrawal_payment_grants','commerce_financial_journals','commerce_financial_entries','commerce_payout_sync_jobs'];
  const before=await Promise.all(tables.map(x=>f.db.prepare('SELECT * FROM '+x).all()));await applyCommerceSchema(f.db,61);
  for(const [n,name] of tables.entries())assert.deepEqual((await f.db.prepare('SELECT * FROM '+name).all()).results,before[n].results);
  const queue=(action,input={})=>f.call('/internal/commerce/finance/payout-sync/'+action,{environment:f.environment,...input});
  const requested=await queue('request',{withdrawalId:f.w.id,requestKey:key()});assert.equal(requested.status,200,requested.error);
  const at=new Date(Date.now()+16*60000).toISOString();let r=await report(f,at);
  assert.equal(r.payoutSync.overdue,1);assert.equal(r.payoutSync.unreconciledPayouts,1);assert(r.warnings.includes('payout_sync_overdue'));
  const claimed=await queue('claim',{workerId:'fixture_worker',storageId:'fixture_receipts',claimKey:key()});assert.equal(claimed.status,200);
  r=await report(f,at);assert.equal(r.payoutSync.expiredLeases,1);assert(r.warnings.includes('payout_sync_leases_expired'));
  const review=await queue('finish',{id:claimed.job.id,workerId:'fixture_worker',storageId:'fixture_receipts',leaseToken:claimed.job.leaseToken,
    result:{state:'review',reason:'reconciliation_required',providerCalls:0,coveredWithdrawals:[],coveredOrders:[],reviewReasons:['seller_fee_unfunded'],planTruncated:false,sharedHistoryReview:{settlements:0,payouts:0}}});
  assert.equal(review.status,200,review.error);r=await report(f);assert.equal(r.payoutSync.reviewGroups,1);
  assert.equal((await queue('request',{withdrawalId:f.w.id,requestKey:key()})).status,200);
  const untouched=(await f.db.prepare('SELECT * FROM commerce_payout_sync_jobs ORDER BY id').all()).results;r=await report(f);
  assert.equal(r.payoutSync.jobs,2);assert.equal(r.payoutSync.reviewGroups,0);assert.equal(r.payoutSync.active,1);
  assert.deepEqual((await f.db.prepare('SELECT * FROM commerce_payout_sync_jobs ORDER BY id').all()).results,untouched);
});
