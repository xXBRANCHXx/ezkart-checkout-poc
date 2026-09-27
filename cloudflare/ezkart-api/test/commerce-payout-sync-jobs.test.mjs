import test from 'node:test';
import assert from 'node:assert/strict';
import {randomBytes} from 'node:crypto';
import {setupPayoutFixture} from './payout-fixture.mjs';
import {applyCommerceSchema} from './commerce-schema.mjs';
import {schedulePayoutSync,payoutSyncHousekeeping,finishPayoutSync} from '../src/commerce-payout-sync-jobs.js';

const base='/internal/commerce/finance/payout-sync/',key=()=>randomBytes(16).toString('hex');
async function fixture(t,options={}){
  const f=await setupPayoutFixture(t,{...options,bindings:{COMMERCE_WITHDRAWAL_SYNC:'enabled',...options.bindings}});
  const call=(action,input={})=>f.call(base+action,{environment:f.environment,...input});
  const request=(requestKey=key(),withdrawalId=f.w.id)=>call('request',{requestKey,withdrawalId});
  const claim=(extra={})=>call('claim',{workerId:'fixture_worker',storageId:'fixture_receipts',claimKey:key(),...extra});
  const lease=job=>({id:job.id,workerId:'fixture_worker',storageId:'fixture_receipts',leaseToken:job.leaseToken});
  const summary=(extra={})=>({state:'incomplete',reason:'read_budget',providerCalls:2,coveredWithdrawals:[],coveredOrders:[],reviewReasons:[],planTruncated:false,sharedHistoryReview:{settlements:0,payouts:0},...extra});
  const finish=(job,result=summary(),extra={})=>call('finish',{...lease(job),result,...extra});
  const due=()=>f.db.prepare("UPDATE commerce_payout_sync_jobs SET available_at='2000-01-01T00:00:00.000Z' WHERE state='retry'").run();
  return {...f,queue:call,request,claim,lease,summary,finish,due};
}

test('concurrent schedules and claims create one run per original platform; expiry resumes that run on its original storage',async t=>{
  const f=await fixture(t),scheduled=await Promise.all([f.queue('schedule'),f.queue('schedule')]);
  assert(scheduled.every(x=>x.status===200),JSON.stringify(scheduled));assert.equal(scheduled.reduce((n,x)=>n+x.queued,0),1);
  const input={workerId:'fixture_worker',storageId:'fixture_receipts',claimKey:key()};
  const claimed=await Promise.all([f.queue('claim',input),f.claim({workerId:'competitor'})]);assert(claimed.every(x=>x.status===200),JSON.stringify(claimed));
  const current=claimed.find(x=>x.job);assert(current);assert.equal(claimed.filter(x=>x.job).length,1);
  // Use the winner's identity for the rest of this lease.
  const actor=claimed[0].job?'fixture_worker':'competitor',j=current.job,lease={...f.lease(j),workerId:actor};
  const original=await f.db.prepare('SELECT * FROM commerce_payout_sync_jobs WHERE id=?').bind(j.id).first();
  assert.equal(original.attempts,1);assert.equal(j.maxPages,40);
  assert.equal((await f.queue('heartbeat',lease)).status,200);
  assert.equal((await f.queue('heartbeat',{...lease,storageId:'foreign_receipts'})).status,409);
  await f.db.prepare("UPDATE commerce_payout_sync_jobs SET lease_until='2000-01-01T00:00:00.000Z' WHERE id=?").bind(j.id).run();
  const foreign=await f.claim({storageId:'foreign_receipts'});assert.equal(foreign.status,200);assert.equal(foreign.job,null);
  const recovered=await f.claim();assert.equal(recovered.status,200,recovered.error);assert.equal(recovered.job.id,j.id);assert.equal(recovered.job.attempts,2);assert.equal(recovered.job.failures,1);
  assert.equal((await f.queue('heartbeat',lease)).status,409);
  const attempts=(await f.db.prepare('SELECT * FROM commerce_payout_sync_attempts ORDER BY attempt').all()).results;
  assert.equal(attempts[0].outcome,'expired');assert.equal(attempts[1].outcome,null);
  await assert.rejects(f.db.prepare("UPDATE commerce_payout_sync_jobs SET storage_id='foreign_receipts' WHERE id=?").bind(j.id).run(),/original_immutable/);
  assert.equal((await f.db.prepare('SELECT withdrawal_id FROM commerce_payout_sync_jobs WHERE id=?').bind(j.id).first()).withdrawal_id,f.w.id);
});

test('claim and completion acknowledgements replay exactly; incomplete work preserves its run and failures stop after eight attempts',async t=>{
  const f=await fixture(t),requestKey=key(),created=await f.request(requestKey);assert.equal(created.status,200,created.error);
  assert.equal((await f.request(requestKey)).job.id,created.job.id);
  const input={workerId:'fixture_worker',storageId:'fixture_receipts',claimKey:key()},first=await f.queue('claim',input),same=await f.queue('claim',input);
  assert.equal(first.status,200,first.error);assert.equal(same.job.leaseToken,first.job.leaseToken);assert.equal(same.job.attempts,1);assert.equal(same.replayed,true);
  assert.equal((await f.queue('claim',{...input,storageId:'different'})).status,409);
  const falseSuccess=await f.finish(first.job,f.summary({state:'synchronized',reason:'reconciled',coveredWithdrawals:[f.w.id],coveredOrders:[f.p.order.id]}));assert.equal(falseSuccess.status,409);
  const saved=await f.finish(first.job);assert.equal(saved.status,200,saved.error);assert.equal(saved.job.state,'retry');assert.equal(saved.job.failures,0);
  assert.equal((await f.finish(first.job)).replayed,true);assert.equal((await f.finish(first.job,f.summary({providerCalls:3}))).status,409);
  assert.equal((await f.claim()).job,null);
  let latest;
  for(let n=1;n<=8;n++){
    await f.due();const claim=await f.claim();assert.equal(claim.status,200,claim.error);assert.equal(claim.job.id,created.job.id);
    latest=await f.finish(claim.job,f.summary({state:'error',reason:'sync_failed',providerCalls:null}));assert.equal(latest.status,200,latest.error);assert.equal(latest.job.failures,n);
  }
  assert.equal(latest.job.state,'review');assert.equal((await f.queue('schedule')).queued,0);
  assert.equal((await f.queue('list')).items[0].attempts,9);
  await assert.rejects(f.db.prepare("UPDATE commerce_payout_sync_attempts SET outcome='completed' WHERE job_id=? AND attempt=1").bind(created.job.id).run(),/attempt_immutable/);
  const again=await f.request();assert.equal(again.status,200,again.error);assert.notEqual(again.job.id,created.job.id);assert.equal(again.job.state,'queued');
});

test('completion requires current reconciled sources and later status changes schedule fresh observation without payment authority',async t=>{
  const f=await fixture(t);await f.request();const claimed=await f.claim(),cap=await f.payoutStatus(),pair=await f.collectPayout();
  assert.equal((await f.reconcilePayout(pair,cap)).status,200);await f.refreshEarnings(pair);
  const result=f.summary({state:'synchronized',reason:'reconciled',providerCalls:9,coveredWithdrawals:[f.w.id],coveredOrders:[f.p.order.id]});
  const done=await f.finish(claimed.job,result);assert.equal(done.status,200,done.error);assert.equal(done.job.state,'completed');assert.equal(done.mayPay,false);
  assert.equal((await f.queue('schedule')).queued,0);
  await f.payoutStatus();assert.equal((await f.queue('schedule')).queued,1);
  const list=await f.queue('list',{limit:1});assert.equal(list.items.length,1);assert(list.nextBefore);assert.equal('leaseToken' in list.items[0],false);
  const next=await f.queue('list',{limit:1,before:list.nextBefore});assert.equal(next.items[0].id,claimed.job.id);assert.equal(next.nextBefore,null);
  assert.equal((await f.db.prepare("SELECT COUNT(*) AS n FROM commerce_financial_journals WHERE kind='payout'").first()).n,1);
});

test('provider-pending observations get a delayed new run; permanent fee problems stay visible for review',async t=>{
  const f=await fixture(t);await f.request();const c=await f.claim();
  const wait=await f.finish(c.job,f.summary({state:'review',reason:'reconciliation_required',reviewReasons:['provider_pending']}));
  assert.equal(wait.status,200,wait.error);assert.equal(wait.job.state,'review');assert(Date.parse(wait.job.availableAt)>Date.now());assert(Date.parse(wait.job.availableAt)<Date.now()+310000);
  assert.equal((await f.queue('schedule')).queued,0);
  await f.db.prepare("UPDATE commerce_payout_sync_jobs SET available_at='2000-01-01T00:00:00.000Z' WHERE id=?").bind(c.job.id).run();
  assert.equal((await f.queue('schedule')).queued,1);const fresh=await f.claim();assert.notEqual(fresh.job.id,c.job.id);
  const blocked=await f.finish(fresh.job,f.summary({state:'review',reason:'reconciliation_required',reviewReasons:['seller_fee_unfunded']}));assert.equal(blocked.status,200);assert.match(blocked.job.availableAt,/^9999/);
  assert.equal((await f.queue('schedule')).queued,0);
});

test('evidence arriving between completion validation and its write keeps the original attempt open',async t=>{
  const f=await fixture(t);await f.request();const claimed=await f.claim(),cap=await f.payoutStatus(),pair=await f.collectPayout();
  assert.equal((await f.reconcilePayout(pair,cap)).status,200);await f.refreshEarnings(pair);
  const result=f.summary({state:'synchronized',reason:'reconciled',providerCalls:9,coveredWithdrawals:[f.w.id],coveredOrders:[f.p.order.id]});
  let changedCap;
  const racingDB={prepare:sql=>f.db.prepare(sql),batch:async statements=>{changedCap=await f.payoutStatus();return f.db.batch(statements);}};
  await assert.rejects(finishPayoutSync({APP_ENVIRONMENT:'test',DB:racingDB,COMMERCE_WITHDRAWAL_SYNC:'enabled'},
    {environment:f.environment,...f.lease(claimed.job),result}),error=>error instanceof Response&&error.status===409);
  assert(changedCap>cap);
  const job=await f.db.prepare('SELECT state,completion_hash FROM commerce_payout_sync_jobs WHERE id=?').bind(claimed.job.id).first();
  assert.deepEqual(job,{state:'running',completion_hash:null});
  const attempt=await f.db.prepare('SELECT finished_at,outcome FROM commerce_payout_sync_attempts WHERE job_id=?').bind(claimed.job.id).first();
  assert.deepEqual(attempt,{finished_at:null,outcome:null});
  const updated=await f.collectPayout();assert.equal((await f.reconcilePayout(updated,changedCap)).status,200);await f.refreshEarnings(updated);
  const done=await f.finish(claimed.job,result);assert.equal(done.status,200,done.error);assert.equal(done.job.state,'completed');
  assert.equal((await f.db.prepare("SELECT COUNT(*) AS n FROM commerce_financial_journals WHERE kind='payout'").first()).n,1);
});

test('queue routes are held, private and workbench-only, and the 0060 upgrade preserves financial records',async t=>{
  const f=await fixture(t,{through:60,bindings:{APP_ENVIRONMENT:'beta'}});
  const tables=['commerce_withdrawals','commerce_withdrawal_payment_grants','commerce_financial_journals','commerce_financial_entries'];
  const before=await Promise.all(tables.map(x=>f.db.prepare('SELECT * FROM '+x).all()));await applyCommerceSchema(f.db,60);
  for(const [i,name] of tables.entries())assert.deepEqual((await f.db.prepare('SELECT * FROM '+name).all()).results,before[i].results);
  const held=await schedulePayoutSync({DB:f.db,APP_ENVIRONMENT:'beta'},{environment:'production'});assert.equal(held.held,true);assert.equal(held.queued,0);
  assert.deepEqual(await payoutSyncHousekeeping({APP_ENVIRONMENT:'production',COMMERCE_WITHDRAWAL_SYNC:'enabled'}),{held:true,queued:0,providerCalls:0});
  await assert.rejects(schedulePayoutSync({DB:f.db,APP_ENVIRONMENT:'production',COMMERCE_WITHDRAWAL_SYNC:'enabled'},{environment:'production'}),x=>x instanceof Response&&x.status===503);
  assert.equal((await f.queue('request',{withdrawalId:f.w.id,requestKey:key(),amount:250000})).status,422);
  assert.equal((await f.queue('constructor')).status,404);assert.equal((await f.queue('toString')).status,404);
  assert.equal((await f.mf.dispatchFetch('https://api.fixture.test'+base+'list',{method:'POST',body:'{"environment":"production"}'})).status,401);
  assert.equal((await f.call(base+'list?extra=1',{environment:'production'})).status,404);
  const list=await f.queue('list');assert.deepEqual(list.items,[]);assert.equal(list.outsideWindow,0);
});
