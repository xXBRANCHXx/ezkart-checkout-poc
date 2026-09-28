import test from 'node:test';
import assert from 'node:assert/strict';
import {setupCommerceFixture as setup} from './commerce-fixture.mjs';
import {applyCommerceSchema} from './commerce-schema.mjs';
import {campaignDeliveryFixture} from './campaign-delivery-fixture.mjs';
import {dispatchEmails,recordEmailWebhook} from '../src/commerce-email-delivery.js';
import {emailFixtureEvent,emailFixtureCallback} from './email-fixture.mjs';
import {main as inspect} from '../../../tools/commerce/operations-report.mjs';
import {setupPayoutFixture} from './payout-fixture.mjs';

const now=()=>new Date().toISOString();
const query=f=>async sql=>{
  const result=await f.db.prepare(sql).all();
  assert.equal(result.meta.rows_written,0,'Inspection cannot claim or update jobs');
  return result.results;
};
const report=(f,deployment='test',at=now())=>inspect(['--deployment='+deployment,'--fail-on-warning'],query(f),at);

test('payout monitoring respects all twelve history windows and still warns beyond their coverage',async t=>{
  const f=await setupPayoutFixture(t);
  const grant=await f.db.prepare('SELECT created_at FROM commerce_withdrawal_payment_grants WHERE withdrawal_id=?').bind(f.w.id).first();
  const created=Date.parse(grant.created_at),lastCovered=created+372*86400000-600000;
  for(const at of [created+70*86400000,lastCovered]){
    const result=await report(f,'test',new Date(at).toISOString());
    assert.equal(result.payoutSync.unreconciledPayouts,1);
    assert.equal(result.payoutSync.outsideWindow,0);
    assert(!result.warnings.includes('payout_history_outside_window'));
    assert(result.warnings.includes('payouts_need_reconciliation'));
  }
  const overdue=await report(f,'test',new Date(lastCovered+1).toISOString());
  assert.equal(overdue.payoutSync.outsideWindow,1);
  assert(overdue.warnings.includes('payout_history_outside_window'));
});
async function job(f,id,state,{environment='sandbox',available='2000-01-01T00:00:00.000Z',lease=null}={}){
  await f.db.prepare(`INSERT INTO commerce_jobs(id,seller_id,commerce_environment,job_key,kind,state,payload_json,result_json,
    available_at,lease_until,created_at,updated_at) VALUES (?,'seller_alice',?,?,'wallet.register',?,'{"private":"never-print@example.test"}',
    '{"secret":"private-provider-response"}',?,?,'2000-01-01T00:00:00.000Z','2000-01-01T00:00:00.000Z')`)
    .bind(id,environment,id,state,available,lease).run();
}

test('inspection reports uncertain, exhausted, expired and overdue work without changing attempts or leaking private data',async t=>{
  const f=await setup(t);
  const empty=await report(f);assert.deepEqual(empty.warnings,['payout_runner_not_observed']);assert.equal(empty.exitCode,2);assert.equal(empty.launchReadinessAssessed,false);
  await job(f,'original-wallet','uncertain');await job(f,'exhausted','dead');
  await job(f,'expired','running',{lease:'2000-01-01T00:01:00.000Z'});await job(f,'overdue','queued');
  await job(f,'retry','retry');await job(f,'future','queued',{available:'2099-01-01T00:00:00.000Z'});
  await job(f,'other-mode','uncertain',{environment:'production'});
  const before=(await f.db.prepare('SELECT * FROM commerce_jobs ORDER BY id').all()).results;
  const result=await report(f);
  assert.deepEqual(result.jobs,{total:6,uncertain:1,dead:1,cancelledBeforeSend:0,expiredLeases:1,overdue:2});
  assert.deepEqual(result.warnings,['jobs_uncertain','jobs_dead','job_leases_expired','jobs_overdue','payout_runner_not_observed']);assert.equal(result.exitCode,2);
  assert(!JSON.stringify(result).match(/never-print|private-provider|seller_alice|original-wallet|lease_token|request_json/));
  assert.deepEqual((await f.db.prepare('SELECT * FROM commerce_jobs ORDER BY id').all()).results,before);
  const beta=await report(f,'beta');assert.equal(beta.environment,'production');assert.equal(beta.jobs.total,1);assert.equal(beta.jobs.uncertain,1);
});

test('pre-journal captures remain visible until reconciled and balanced corruption is independently detected',async t=>{
  const f=await setup(t,{through:22});const made=await f.create(f.input());assert.equal(made.status,200);assert.equal((await f.paid(made.order)).status,200);
  await applyCommerceSchema(f.db,22,Infinity);
  let result=await report(f);assert.equal(result.accounting.captures,1);assert.equal(result.accounting.unpostedCaptures,1);
  assert(result.warnings.includes('capture_journals_missing'));assert.equal(result.settlementAssessed,false);
  const reconciled=await f.call('/internal/commerce/finance/captures/reconcile',{environment:'sandbox',limit:10});assert.equal(reconciled.status,200);
  result=await report(f);assert.equal(result.accounting.unpostedCaptures,0);assert.equal(result.accounting.inconsistentJournals,0);
  // Deliberate isolated corruption: retain the total balance and row count but
  // change two lines away from the original immutable journal specification.
  await f.db.prepare('DROP TRIGGER financial_entries_no_update').run();
  await f.db.prepare('UPDATE commerce_financial_entries SET amount=CASE line_number WHEN 0 THEN amount-1 WHEN 1 THEN amount+1 ELSE amount END').run();
  assert.equal((await f.db.prepare('SELECT SUM(amount) AS balance FROM commerce_financial_entries').first()).balance,0);
  result=await report(f);assert.equal(result.accounting.inconsistentJournals,1);assert(result.warnings.includes('financial_journals_inconsistent'));
});

test('payment, stock and shipping review flags and suspense allocations remain distinct',async t=>{
  const f=await setup(t);const made=await f.create(f.input());assert.equal(made.status,200);assert.equal((await f.paid(made.order)).status,200);
  await f.db.prepare("UPDATE orders SET payment_review=1,fulfillment_review=1,fulfillment_state='stock_review' WHERE id=?").bind(made.order.id).run();
  const result=await report(f);
  assert.deepEqual(result.orders,{total:1,paymentReview:1,stockReview:1,shippingReview:1});
  for(const code of ['orders_payment_review','orders_stock_review','orders_shipping_review'])assert(result.warnings.includes(code));
  assert.equal(result.accounting.unallocatedCaptures,0);
  // An additional verified charge is preserved in suspense by the actual writer.
  const extra=await f.paid(made.order,{reference:'another-actual-fixture-charge'});assert.equal(extra.status,200);
  const after=await report(f);assert.equal(after.accounting.unallocatedCaptures,1);assert(after.warnings.includes('capture_allocations_need_review'));
});

test('transactional and campaign monitoring follows actual delivery evidence without another send',async t=>{
  const f=await campaignDeliveryFixture(t);await f.addBuyer(1);assert.equal((await f.publish()).status,200);
  assert.equal((await f.drain()).processed,1);
  await f.makeNotification();assert.equal((await dispatchEmails(f.env,2,f.fetcher)).processed,1);
  assert.equal(f.control.calls.length,2);
  const later=new Date(Date.now()+16*60000).toISOString();
  let result=await report(f,'test',later);
  assert.equal(result.email.transactionalAttention,1);assert.equal(result.email.campaignAttention,1);
  for(const call of f.control.calls)await recordEmailWebhook(emailFixtureCallback(emailFixtureEvent(call.message,call.id)),f.env,'test_mail');
  result=await report(f,'test',later);assert.equal(result.email.transactionalAttention,0);assert.equal(result.email.campaignAttention,0);
  for(const call of f.control.calls)await recordEmailWebhook(emailFixtureCallback(emailFixtureEvent(call.message,call.id,'email.bounced')),f.env,'test_mail');
  result=await report(f,'test',later);assert.equal(result.email.transactionalAttention,1);assert.equal(result.email.campaignAttention,1);
  assert(result.warnings.includes('transactional_email_attention'));assert(result.warnings.includes('campaign_email_attention'));
  assert.equal(f.control.calls.length,2);assert(!JSON.stringify(result).includes('@example.test'));
});

test('a campaign deliberately cancelled before sending is counted without a false failure alert',async t=>{
  const f=await campaignDeliveryFixture(t);await f.addBuyer(1);assert.equal((await f.publish()).status,200);
  assert.equal((await f.action('cancel')).status,200);
  const result=await report(f);
  assert.equal(result.jobs.cancelledBeforeSend,1);assert.equal(result.jobs.dead,0);
  assert(!result.warnings.includes('jobs_dead'));assert.equal(result.email.campaignAttention,0);
  assert.equal(f.control.calls.length,0);
});

test('main, ambiguous flags, injected time, incomplete data and a changed environment cannot return a healthy report',async()=>{
  let reads=0;const unused=async()=>{reads++;return [];};
  for(const args of [[],['--deployment=main'],['--deployment=production'],['--deployment=beta','--deployment=test'],
    ['--deployment=test','--fail-on-warning','--fail-on-warning'],['--deployment=beta','--reset']])await assert.rejects(inspect(args,unused));
  await assert.rejects(inspect(['--deployment=beta'],unused,"2026-09-27T00:00:00.000Z'; DELETE FROM orders;"));assert.equal(reads,0);
  const at=now();await assert.rejects(inspect(['--deployment=beta'],unused,at),/incomplete/);
  await assert.rejects(inspect(['--deployment=beta'],async()=>[{report:JSON.stringify({environment:'sandbox',observedAt:at})}],at),/scope/);
  await assert.rejects(inspect(['--deployment=beta'],async()=>[{report:JSON.stringify({version:1,environment:'production',observedAt:at})}],at),/incomplete/);
});
