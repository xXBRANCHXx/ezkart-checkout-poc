import test from 'node:test';
import assert from 'node:assert/strict';
import {setupPayoutFixture,payoutFixture} from './payout-fixture.mjs';
import {withdrawalPath} from './withdrawal-inquiry-fixture.mjs';
import {applyCommerceSchema} from './commerce-schema.mjs';
import {setupCommerceFixture} from './commerce-fixture.mjs';

const journals=async f=>(await f.db.prepare("SELECT * FROM commerce_financial_journals WHERE kind IN ('payout','payout_release','payout_correction') ORDER BY sequence").all()).results;
const lines=j=>Object.fromEntries(JSON.parse(j.lines_json).map(l=>[l.account,l.amount]));

test('matched payout and platform fee post once, close the reservation and permanently deduct the transferred principal',async t=>{
  const f=await setupPayoutFixture(t),cap=await f.payoutStatus(),pair=await f.collectPayout();
  const replies=await Promise.all([f.reconcilePayout(pair,cap),f.reconcilePayout(pair,cap)]);
  for(const r of replies){assert.equal(r.status,200,r.error);assert.equal(r.recorded.state,'completed');assert.equal(r.outcome.payoutConfirmed,true);assert.equal(r.providerCalls,0);assert.equal(r.mayPay,false);}
  assert.equal(replies.filter(r=>!r.replayed).length,1);
  const saved=await journals(f);assert.equal(saved.length,1);
  assert.equal(saved[0].occurred_at,replies[0].recorded.providerAt);assert.equal(JSON.parse(saved[0].source_json).timeBasis,'provider_debit');
  assert.deepEqual(lines(saved[0]),{seller_withdrawal_reserved:250000,provider_cash_seller:-250000,platform_withdrawal_fee:2500,provider_cash_platform:-2500});
  await f.refreshEarnings(pair);
  const earnings=await f.earnings();assert.equal(earnings.availableEarnings,'506250');assert.equal(earnings.reservedWithdrawals,'0');assert.equal(earnings.completedWithdrawals,'250000');
  const detail=await f.readWithdrawal(f.w);assert.equal(detail.withdrawal.state,'completed');assert.equal(detail.withdrawal.payoutConfirmed,true);
  const list=await f.call(withdrawalPath+'/list',f.scope());assert.deepEqual(list.items[0].payment.outcome,detail.withdrawal.payment.outcome);
  assert(!/2010000002|SAC-bob|credentialFingerprint|providerReference|sourceCurrent/.test(JSON.stringify(list)));
  const original=await f.db.prepare('SELECT request_key FROM commerce_withdrawals WHERE id=?').bind(f.w.id).first();
  const replay=await f.call(withdrawalPath,{...f.scope(),requestKey:original.request_key,amount:'250000',bank:{code:'CENAIDJA',accountNumber:'001234567890',channel:'BI_FAST'}});
  assert.equal(replay.withdrawal.state,'completed');assert.equal(replay.withdrawal.payoutConfirmed,true);
  assert.equal((await f.cancel(f.w)).status,409);assert.equal((await f.call(f.path+'/payment/start',f.paymentInput)).mayPay,false);
  const next=await f.reserve({amount:'500000'});assert.equal(next.state,'reserved');assert.equal((await f.earnings()).availableEarnings,'6250');
  assert.equal((await f.summary()).balanced,true);
});

test('unknown, duplicate, foreign, unsupported and seller-funded fee records remain unresolved without money entries',async t=>{
  const f=await setupPayoutFixture(t),cap=await f.payoutStatus();
  const cases=[
    [{fees:[]},'incomplete_or_duplicate_legs'],
    [{fees:[f.row('PAYOUT_CHARGE',2500),f.row('PAYOUT_CHARGE',2500)]},'incomplete_or_duplicate_legs'],
    [{feePocket:'sellerCash'},'seller_fee_unfunded'],
    [{fees:[f.row('PAYOUT_CHARGE',2500,'PENDING')]},'fee_outcome_unresolved'],
    [{fees:[f.row('PAYOUT_CHARGE',2500,'FAILED')]},'fee_outcome_unresolved'],
    [{payouts:[f.row('PAYOUT',249999)]},'payout_details_mismatch'],
    [{payouts:[{...f.row('PAYOUT',250000),channel:'ONLINE'}]},'payout_details_mismatch'],
    [{fees:[{...f.row('PAYOUT_CHARGE',2500),partnerReferenceNo:'foreign'}]},'provider_reference_mismatch'],
    [{other:{sellerCash:[f.row('ADJUSTMENT_CREDIT',1)]}},'unsupported_provider_rows'],
    [{payouts:[f.row('PAYOUT',250000),f.row('PAYOUT',250000,'SUCCESS','other-group')]},'payout_group_ambiguous'],
  ];
  for(const [options,reason] of cases){const pair=await f.collectPayout(options),r=await f.reconcilePayout(pair,cap);
    assert.equal(r.status,200,r.error);assert.equal(r.recorded.state,'unresolved');assert.equal(r.recorded.reason,reason);assert.equal(r.outcome.payoutConfirmed,false);}
  assert.equal((await journals(f)).length,0);assert.equal((await f.earnings()).reservedWithdrawals,'250000');assert.equal((await f.earnings()).availableEarnings,'0');
  // A distinct fee reference is usable only when it explicitly names this exact
  // original transfer, and both references then belong permanently to it.
  const pair=await f.collectPayout({fees:[f.row('PAYOUT_CHARGE',0,'SUCCESS','explicit-fee')],feePocket:'sellerCash'}),r=await f.reconcilePayout(pair,cap);
  assert.equal(r.recorded.state,'completed');assert.equal(r.recorded.feeAmount,'0');assert.equal(JSON.parse((await journals(f))[0].lines_json).length,2);
  assert.equal((await f.db.prepare('SELECT COUNT(*) AS n FROM commerce_payout_reference_bindings').first()).n,2);
});

test('corrections append only the actual platform fee delta; newer history and status hold availability without restoring paid money',async t=>{
  const f=await setupPayoutFixture(t),cap=await f.payoutStatus(),first=await f.collectPayout();await f.reconcilePayout(first,cap);await f.refreshEarnings(first);
  const initial=(await journals(f))[0],pair=await f.collectPayout({fees:[f.row('PAYOUT_CHARGE',1000)]});
  assert.equal((await f.readPayout()).outcome.state,'review');assert.equal((await f.earnings()).availableEarnings,'0');
  assert.equal((await f.earnings()).completedWithdrawals,'250000');assert.equal((await f.earnings()).reservedWithdrawals,'0');
  const r=await f.reconcilePayout(pair,cap);assert.equal(r.recorded.state,'completed');await f.refreshEarnings(pair);
  const saved=await journals(f);assert.equal(saved.length,2);assert.deepEqual(saved[0],initial);
  assert.deepEqual(lines(saved[1]),{platform_withdrawal_fee:-1500,provider_cash_platform:1500});
  assert.equal((await f.earnings()).availableEarnings,'506250');
  const retry=await f.reconcilePayout(first,cap);assert.equal(retry.replayed,true);assert.equal(retry.recorded.sourceCurrent,false);assert.equal(retry.assessment.id,r.recorded.id);
  const newer=await f.payoutStatus();assert.equal((await f.readPayout()).outcome.state,'review');
  const refreshed=await f.collectPayout({fees:[f.row('PAYOUT_CHARGE',1000)]});assert.equal((await f.reconcilePayout(refreshed,cap)).status,409);
  assert.equal((await f.reconcilePayout(refreshed,newer)).recorded.state,'completed');assert.equal((await journals(f)).length,2);
  const failed=await f.payoutStatus('06'),conflict=await f.collectPayout();assert.equal((await f.reconcilePayout(conflict,failed)).recorded.reason,'conflicting_terminal_results');
  assert.equal((await journals(f)).length,2);assert.equal((await f.earnings()).completedWithdrawals,'250000');assert.equal((await f.earnings()).availableEarnings,'0');
});

test('failed status alone never releases principal; explicit voided payout and fee records release it without granting another send',async t=>{
  const f=await setupPayoutFixture(t),cap=await f.payoutStatus('06');
  for(const status of ['SUCCESS','PENDING','FAILED']){const pair=await f.collectPayout({payouts:[f.row('PAYOUT',250000,status)]});
    assert.equal((await f.reconcilePayout(pair,cap)).recorded.state,'unresolved');assert.equal((await journals(f)).length,0);}
  const pair=await f.collectPayout({payouts:[f.row('PAYOUT',250000,'VOID')],fees:[f.row('PAYOUT_CHARGE',2500,'VOID')],feePocket:'sellerCash'});
  const r=await f.reconcilePayout(pair,cap);assert.equal(r.recorded.state,'failed');assert.equal(r.recorded.feeAmount,'0');assert.equal(r.outcome.payoutConfirmed,false);
  assert.deepEqual(lines((await journals(f))[0]),{seller_withdrawal_reserved:250000,seller_available:-250000});
  assert.equal((await journals(f))[0].occurred_at,r.recorded.observedAt);assert.equal(JSON.parse((await journals(f))[0].source_json).timeBasis,'provider_observation');
  await f.refreshEarnings(pair);assert.equal((await f.earnings()).availableEarnings,'756250');assert.equal((await f.earnings()).completedWithdrawals,'0');
  assert.equal((await f.call(f.path+'/payment/start',f.paymentInput)).mayPay,false);assert.equal((await f.cancel(f.w)).status,409);
  assert.equal((await f.readWithdrawal(f.w)).withdrawal.state,'failed');
});

test('original accounts, complete observation windows, authorization and atomic journal guards are required',async t=>{
  const f=await setupPayoutFixture(t),cap=await f.payoutStatus(),pair=await f.collectPayout();
  assert.equal((await f.reconcilePayout(pair,cap,{sellerCollectionId:pair.platformCollectionId,platformCollectionId:pair.sellerCollectionId})).status,409);
  for(const extra of [{statusCap:0},{amount:'1'},{environment:'production'},{statusCap:cap+1}])assert([403,409,422].includes((await f.reconcilePayout(pair,cap,extra)).status));
  const short=await f.collectPayout({window:{from:f.p.order.createdAt}});assert.equal((await f.reconcilePayout(short,cap)).status,409);
  const fresh=await f.collectPayout();
  await f.db.prepare("CREATE TRIGGER fixture_payout_fail AFTER INSERT ON commerce_financial_journals WHEN NEW.kind='payout' BEGIN SELECT RAISE(ABORT,'fixture_fail'); END").run();
  assert.equal((await f.reconcilePayout(fresh,cap)).status,500);
  for(const name of ['commerce_payout_assessments','commerce_payout_results','commerce_payout_reference_bindings'])assert.equal((await f.db.prepare('SELECT COUNT(*) AS n FROM '+name).first()).n,0);
  await f.db.prepare('DROP TRIGGER fixture_payout_fail').run();const r=await f.reconcilePayout(fresh,cap);assert.equal(r.recorded.state,'completed');
  for(const name of ['commerce_payout_assessments','commerce_payout_results','commerce_payout_reference_bindings']){
    await assert.rejects(f.db.prepare('DELETE FROM '+name).run(),/payout_immutable/);
  }
  await assert.rejects(f.db.prepare("UPDATE commerce_payout_results SET paid_amount=1").run(),/payout_immutable/);
  const j=(await journals(f))[0];delete j.sequence;j.id+='x';j.lines_json=JSON.stringify([{account:'seller_available',amount:1},{account:'provider_cash_seller',amount:-1}]);
  await assert.rejects(f.db.prepare('INSERT INTO commerce_financial_journals('+Object.keys(j).join(',')+') VALUES('+Object.keys(j).map(()=>'?').join(',')+')').bind(...Object.values(j)).run(),/financial_source_mismatch/);
  const unsigned=await f.mf.dispatchFetch('https://api.fixture.test'+f.path+'/payout/read',{method:'POST',body:JSON.stringify({environment:f.environment})});assert.equal(unsigned.status,401);
  assert.deepEqual((await f.db.prepare('PRAGMA foreign_key_check').all()).results,[]);
});

test('a populated beta upgrade preserves original withdrawals and journals; main rejects reconciliation',async t=>{
  const f=await setupPayoutFixture(t,{through:59,bindings:{APP_ENVIRONMENT:'beta'}});
  const tables=['commerce_withdrawals','commerce_withdrawal_payment_grants','commerce_financial_journals','commerce_financial_entries'];
  const before=await Promise.all(tables.map(name=>f.db.prepare('SELECT * FROM '+name).all()));await applyCommerceSchema(f.db,59);
  for(let n=0;n<tables.length;n++)assert.deepEqual((await f.db.prepare('SELECT * FROM '+tables[n]).all()).results,before[n].results);
  const cap=await f.payoutStatus(),pair=await f.collectPayout();assert.equal((await f.reconcilePayout(pair,cap)).recorded.state,'completed');
  const main=await setupCommerceFixture(t,{bindings:{APP_ENVIRONMENT:'production'}});
  for(const action of ['read','reconcile'])assert.equal((await main.call(f.path+'/payout/'+action,{environment:'production'})).status,503);
});

test('fee amounts remain exact at the ledger limit and larger provider observations cannot become ledger entries',async t=>{
  const f=await setupPayoutFixture(t),cap=await f.payoutStatus();
  let pair=await f.collectPayout({fees:[f.row('PAYOUT_CHARGE','9223372036854775807')]});
  assert.equal((await f.reconcilePayout(pair,cap)).recorded.reason,'fee_amount_out_of_range');assert.equal((await journals(f)).length,0);
  pair=await f.collectPayout({fees:[f.row('PAYOUT_CHARGE','9007199254740991')]});
  const r=await f.reconcilePayout(pair,cap);assert.equal(r.recorded.state,'completed');assert.equal(r.recorded.feeAmount,'9007199254740991');
  const j=(await journals(f))[0];assert.equal(lines(j).platform_withdrawal_fee,9007199254740991);
  const zero=await f.collectPayout({fees:[f.row('PAYOUT_CHARGE',0)]});assert.equal((await f.reconcilePayout(zero,cap)).recorded.state,'completed');
  assert.deepEqual(lines((await journals(f))[1]),{platform_withdrawal_fee:-9007199254740991,provider_cash_platform:9007199254740991});
});

test('fee references cannot be reused for another payout or an earlier settlement, and a conflicting payment receipt invalidates recognition',async t=>{
  const f=await setupPayoutFixture(t),w=await f.reserve(),i=await f.start(w),bank=await f.receipt(w,f.evidence(i)),c=await f.confirm(w,bank.inquiryDigest);
  const g=await f.call(withdrawalPath+'/'+w.id+'/payment/start',{...f.scope(),confirmationId:c.confirmation.id,credentialFingerprint:'a'.repeat(64),clientId:'MCH-FIXTURE-SNAP'});
  assert.equal(g.status,200,g.error);const other=payoutFixture(f,w,g);
  const cap=await f.payoutStatus(),pair=await f.collectPayout({fees:[f.row('PAYOUT_CHARGE',2500,'SUCCESS','shared-fee')]});
  assert.equal((await f.reconcilePayout(pair,cap)).recorded.state,'completed');
  const otherCap=await other.payoutStatus();
  for(const reference of ['shared-fee','group-'+f.p.order.id]){
    const next=await other.collectPayout({fees:[other.row('PAYOUT_CHARGE',2500,'SUCCESS',reference)]});
    assert.equal((await other.reconcilePayout(next,otherCap)).status,409);
  }
  const fresh=await f.collectPayout({fees:[f.row('PAYOUT_CHARGE',2500,'SUCCESS','shared-fee')]});
  assert.equal((await f.reconcilePayout(fresh,cap)).recorded.state,'completed');
  const inquiry=JSON.parse(f.g.originalInquiry.responseBody),now=new Date().toISOString();
  const request={...JSON.parse(f.g.originalInquiry.requestBody),referenceNo:inquiry.referenceNo,beneficiaryAccountName:inquiry.beneficiaryAccountName};
  const evidence={environment:f.environment,credentialFingerprint:'a'.repeat(64),operation:'transfer-payment',externalId:f.g.binding.paymentExternalId,
    requestedAt:now,observedAt:now,requestBody:JSON.stringify(request),responseBody:JSON.stringify({...request,responseCode:'2000000',referenceNo:'different-original-payment',referenceNumber:'bank-reference',transactionDate:now})};
  assert.equal((await f.call(f.path+'/payment/receipt',{environment:f.environment,evidence})).status,200);
  assert.equal((await f.readPayout()).outcome.state,'review');assert.equal((await f.earnings()).completedWithdrawals,'250000');assert.equal((await f.earnings()).availableEarnings,'0');
  assert.equal((await journals(f)).length,1);
});
