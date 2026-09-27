import test from 'node:test';
import assert from 'node:assert/strict';
import {setupWithdrawalInquiryFixture,withdrawalPath,seedLegacyPaymentGrant} from './withdrawal-inquiry-fixture.mjs';
import {setupCommerceFixture} from './commerce-fixture.mjs';
import {applyCommerceSchema} from './commerce-schema.mjs';

const table='commerce_withdrawal_status_observations';
async function fixture(t,options={}){
  const f=await setupWithdrawalInquiryFixture(t,{...options,bindings:{COMMERCE_WITHDRAWAL_PAYMENT:'enabled',...options.bindings}});
  const w=await f.reserve(),i=await f.start(w),bank=await f.receipt(w,f.evidence(i)),c=await f.confirm(w,bank.inquiryDigest);
  const start=()=>f.call(withdrawalPath+'/'+w.id+'/payment/start',{...f.scope(),confirmationId:c.confirmation.id,
    credentialFingerprint:'a'.repeat(64),clientId:'MCH-FIXTURE-SNAP'});
  const g=options.through<59?await seedLegacyPaymentGrant(f,w,c.confirmation):await start();assert.equal(g.status,200,g.error);
  const base=Date.now()-90000;let number=100;
  const at=seconds=>new Date(base+seconds*1000).toISOString();
  const evidence=(code='03',sent=0,observed=1,extra={})=>({environment:f.environment,credentialFingerprint:'a'.repeat(64),operation:'transactions-status',
    externalId:String(number++).padStart(32,'0'),requestedAt:at(sent),observedAt:at(observed),
    requestBody:JSON.stringify({partnerReferenceNo:g.binding.partnerReferenceNo}),responseBody:JSON.stringify({responseCode:'2000000',
      partnerReferenceNo:g.binding.partnerReferenceNo,transactionType:'PAYOUT',latestTransactionStatus:code,latestTransactionDesc:'',
      amount:{value:'250000.00',currency:'IDR'},transactionDate:at(0),...extra})});
  const path=withdrawalPath+'/'+w.id+'/payment/status';
  const save=e=>f.call(path+'/receipt',{environment:f.environment,evidence:e});
  const history=(extra={})=>f.call(path+'/history',{environment:f.environment,...extra});
  const status=async()=>{const r=await f.readWithdrawal(w);assert.equal(r.status,200,r.error);return r.withdrawal.payment.status;};
  return {...f,w,g,startPayment:start,evidence,save,history,status,at,path};
}

test('an older observation arriving last cannot undo a newer outcome; exact concurrent recovery never changes money or permits another payment',async t=>{
  const f=await fixture(t),before=await f.summary(),old=f.evidence(),newer=f.evidence('00',2,3);
  assert.equal((await f.save(newer)).status,200);assert.equal((await f.save(old)).status,200);
  const retries=await Promise.all([f.save(newer),f.save(newer)]);assert(retries.every(r=>r.replayed&&r.recorded&&!r.payoutConfirmed&&!r.mayPay));
  const result=await f.status();assert.equal(result.state,'reported_success');assert.equal(result.observations,2);assert.equal(result.reconciliationRequired,true);
  assert.equal(result.checkedAt,newer.observedAt.replace(/(\.\d{3})Z$/,'$1000Z'));
  assert.deepEqual(await f.summary(),before);assert.equal((await f.earnings()).reservedWithdrawals,'250000');
  assert.equal((await f.startPayment()).mayPay,false);assert.equal((await f.cancel(f.w)).status,409);
  const detail=await f.readWithdrawal(f.w);assert.equal(detail.withdrawal.canCancel,false);assert.equal(detail.withdrawal.payoutConfirmed,false);
  const list=await f.call(withdrawalPath+'/list',f.scope());assert.deepEqual(list.items[0].payment.status,result);
  assert(!/responseBody|requestBody|credentialFingerprint|statusDigest/.test(JSON.stringify(list)));
});

test('overlapping contradictory reads require review until a definitely later consistent observation supersedes them',async t=>{
  const f=await fixture(t);assert.equal((await f.save(f.evidence('03',0,4))).status,200);assert.equal((await f.save(f.evidence('00',2,3))).status,200);
  assert.equal((await f.status()).reason,'overlapping_results');
  assert.equal((await f.status()).checkedAt,f.at(4).replace(/(\.\d{3})Z$/,'$1000Z'));
  assert.equal((await f.save(f.evidence('00',5,6))).status,200);assert.equal((await f.status()).state,'reported_success');
  // A terminal-to-pending regression cannot be cleared by a later success.
  assert.equal((await f.save(f.evidence('03',7,8))).status,200);assert.equal((await f.status()).reason,'terminal_regression');
  assert.equal((await f.save(f.evidence('00',9,10))).status,200);assert.equal((await f.status()).reason,'terminal_regression');
});

test('success versus failure remains an unresolved terminal conflict regardless of arrival order',async t=>{
  const f=await fixture(t);assert.equal((await f.save(f.evidence('06',2,3))).status,200);assert.equal((await f.status()).state,'reported_failed');
  assert.equal((await f.save(f.evidence('00',0,1))).status,200);assert.equal((await f.status()).reason,'conflicting_terminal_results');
  assert.equal((await f.cancel(f.w)).status,409);assert.equal((await f.earnings()).reservedWithdrawals,'250000');
});

test('foreign transaction types and reversal/refund context are preserved for review without treating them as bank payouts',async t=>{
  const f=await fixture(t);
  for(const [code,extra] of [['00',{transactionType:'PURCHASE'}],['04',{}],['05',{}],['00',{refundHistory:[{refundNo:'provider-context'}]}],['00',{latestTransactionDesc:'void'}]]){
    const e=f.evidence(code,0,1,extra),r=await f.save(e);assert.equal(r.status,200,r.error);assert.equal((await f.status()).reason,'unsupported_outcome');
    assert.equal(r.payoutConfirmed,false);
  }
  assert.equal((await f.earnings()).reservedWithdrawals,'250000');
});

test('status evidence must match the original dispatch, amount, credentials and exact request, with unambiguous JSON and observation times',async t=>{
  const f=await fixture(t),e=f.evidence(),body=JSON.parse(e.responseBody);
  for(const changes of [{partnerReferenceNo:'foreign'},{amount:{value:'250001.00',currency:'IDR'}},{amount:{value:250000,currency:'IDR'}},
    {amount:{value:'250000.00',currency:'USD'}},{transactionType:''},{latestTransactionStatus:'99'},{responseCode:'4040000'},
    {latestTransactionDesc:null},{refundHistory:null},{transactionDate:'2026-02-30T00:00:00Z'},{transactionDate:f.at(500)}])
    assert([409,422].includes((await f.save({...e,responseBody:JSON.stringify({...body,...changes})})).status),JSON.stringify(changes));
  for(const changes of [{operation:'transfer-payment'},{externalId:f.g.binding.paymentExternalId},{externalId:f.g.binding.inquiryExternalId},
    {credentialFingerprint:'b'.repeat(64)},{requestBody:e.requestBody+' '},{extra:'untrusted'},
    {requestedAt:f.at(5)},{observedAt:f.at(500)},{requestedAt:f.at(-500)},
    {responseBody:e.responseBody.replace('"IDR"','"IDR","currency":"IDR"')}])
    assert([409,422].includes((await f.save({...e,...changes})).status),JSON.stringify(changes));
  assert.equal((await f.history()).items.length,0);
  assert.equal((await f.save(e)).status,200);
  assert.equal((await f.save({...e,responseBody:JSON.stringify({...body,latestTransactionStatus:'00'})})).status,409);
  const history=await f.history();assert.deepEqual(history.items[0].evidence,e);assert.equal(history.items.length,1);
});

test('stable private history retains original evidence, bounds pages and does not expose future arrivals in the original cohort',async t=>{
  const f=await fixture(t);for(let n=0;n<3;n++)assert.equal((await f.save(f.evidence('03',n*2,n*2+1))).status,200);
  const first=await f.history({limit:2});assert.equal(first.items.length,2);assert(first.nextBefore);
  await f.save(f.evidence('00',10,11));
  const second=await f.history({limit:2,before:first.nextBefore,cap:first.cap});assert.equal(second.items.length,1);assert.equal(second.nextBefore,null);
  assert.equal(new Set([...first.items,...second.items].map(r=>r.id)).size,3);
  for(const change of [{before:0},{cap:-1},{limit:51},{limit:1.5},{unknown:true}])assert.equal((await f.history(change)).status,422);
  assert.equal((await f.call(f.path+'/receipt',{environment:'production',evidence:f.evidence()})).status,403);
  assert.equal((await f.call(f.path+'/history?extra=1',{environment:f.environment})).status,404);
});

test('immutable SQL guards bind normalized observations to the original provider bytes and roll back failed storage',async t=>{
  const f=await fixture(t),e=f.evidence();assert.equal((await f.save(e)).status,200);
  const row=await f.db.prepare('SELECT * FROM '+table).first();
  await assert.rejects(f.db.prepare('UPDATE '+table+" SET status_code='00'").run(),/withdrawal_status_immutable/);
  await assert.rejects(f.db.prepare('DELETE FROM '+table).run(),/withdrawal_status_immutable/);
  const second=f.evidence(),record={...row,id:'wdstatus_'+'b'.repeat(40),external_id:second.externalId,evidence_json:JSON.stringify(second)};
  delete record.sequence;delete record.recorded_at;
  const insert=change=>{const values={...record,...change};return f.db.prepare('INSERT INTO '+table+'('+Object.keys(values).join(',')+",recorded_at) VALUES("+Object.keys(values).map(()=>'?').join(',')+",strftime('%Y-%m-%dT%H:%M:%fZ','now'))").bind(...Object.values(values)).run();};
  for(const change of [{withdrawal_id:'wd_'+'f'.repeat(40)},{status_code:'00'},{credential_fingerprint:'f'.repeat(64)},{provider_day:'2000-01-01'},
    {client_id:'OTHER'},{transaction_type:'PURCHASE'},{refund_count:1},{requested_at:f.at(-500)},{description:'fabricated'},
    {evidence_json:JSON.stringify({...second,responseBody:second.responseBody.replace('"250000.00"','"249999.00"')})}])
    await assert.rejects(insert(change),/withdrawal_status_source/);
  await f.db.prepare("CREATE TRIGGER fixture_status_fail AFTER INSERT ON "+table+" BEGIN SELECT RAISE(ABORT,'fixture_fail'); END").run();
  assert.equal((await f.save(second)).status,500);assert.equal((await f.history()).items.length,1);
  await f.db.prepare('DROP TRIGGER fixture_status_fail').run();assert.equal((await f.save(second)).status,200);
});

test('a populated beta migration preserves original grants, journals and reservations',async t=>{
  const f=await fixture(t,{through:57,bindings:{APP_ENVIRONMENT:'beta'}});
  const tables=['commerce_withdrawals','commerce_withdrawal_payment_grants','commerce_withdrawal_confirmations','commerce_financial_journals','commerce_financial_entries'];
  const before=await Promise.all(tables.map(name=>f.db.prepare('SELECT * FROM '+name).all()));await applyCommerceSchema(f.db,57,58);
  for(let i=0;i<tables.length;i++)assert.deepEqual((await f.db.prepare('SELECT * FROM '+tables[i]).all()).results,before[i].results);
  assert.deepEqual((await f.db.prepare('PRAGMA foreign_key_check').all()).results,[]);
  assert.equal((await f.save(f.evidence())).status,200);assert.equal((await f.earnings()).reservedWithdrawals,'250000');
});

test('main rejects status operations; missing original grants and unauthorized callers cannot create observations',async t=>{
  const f=await setupCommerceFixture(t,{bindings:{APP_ENVIRONMENT:'production'}}),path=withdrawalPath+'/wd_'+'f'.repeat(40)+'/payment/status';
  for(const action of ['receipt','history'])assert.equal((await f.call(path+'/'+action,{environment:'production'})).status,503);
  const request=await f.mf.dispatchFetch('https://api.fixture.test'+path+'/history',{method:'POST',headers:{'Content-Type':'application/json'},body:'{"environment":"production"}'});
  assert.equal(request.status,401);
  const other=await setupCommerceFixture(t);for(const action of ['receipt','history'])assert.equal((await other.call(path+'/'+action,{environment:'sandbox'})).status,404);
});
