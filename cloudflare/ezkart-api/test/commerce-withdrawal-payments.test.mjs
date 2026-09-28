import test from 'node:test';
import assert from 'node:assert/strict';
import {setupWithdrawalInquiryFixture,withdrawalPath,owner} from './withdrawal-inquiry-fixture.mjs';
import {key} from './earnings-fixture.mjs';
import {applyCommerceSchema} from './commerce-schema.mjs';
import {setupCommerceFixture} from './commerce-fixture.mjs';

const count=async(f,table)=>(await f.db.prepare('SELECT COUNT(*) AS n FROM '+table).first()).n;
const wire=value=>JSON.stringify(value).replace(/\u2028/g,'\\u2028').replace(/\u2029/g,'\\u2029');

test('main rejects every payment-grant and evidence operation even if its dispatch flag is enabled',async t=>{
  const f=await setupCommerceFixture(t,{bindings:{APP_ENVIRONMENT:'production',COMMERCE_WITHDRAWAL_PAYMENT:'enabled'}});
  for(const action of ['start','receipt','read','diagnostic']){
    const r=await f.call(withdrawalPath+'/wd_'+'f'.repeat(40)+'/payment/'+action,{environment:'production'});
    assert.equal(r.status,503,r.error);
  }
  assert.equal(await count(f,'commerce_withdrawal_payment_grants'),0);assert.equal(await count(f,'commerce_withdrawal_payment_receipts'),0);
});
async function fixture(t,options={}){
  const f=await setupWithdrawalInquiryFixture(t,{...options,bindings:{COMMERCE_WITHDRAWAL_PAYMENT:'enabled',...options.bindings}});
  const prepare=async(name='Bank Confirmed Owner')=>{
    const w=await f.reserve(),g=await f.start(w),e=f.evidence(g);
    e.responseBody=JSON.stringify({...JSON.parse(e.responseBody),beneficiaryAccountName:name});
    const r=await f.receipt(w,e),c=await f.confirm(w,r.inquiryDigest);assert.equal(c.status,200,c.error);
    return {w,g,e,r,c};
  };
  const start=(p,extra={})=>f.call(withdrawalPath+'/'+p.w.id+'/payment/start',{...f.scope(),confirmationId:p.c.confirmation.id,
    credentialFingerprint:'a'.repeat(64),clientId:'MCH-FIXTURE-SNAP',...extra});
  const recover=p=>f.call(withdrawalPath+'/'+p.w.id+'/payment/read',{environment:f.environment});
  const evidence=g=>{
    const b=g.binding,i=JSON.parse(g.originalInquiry.responseBody),at=new Date().toISOString();
    const request={...JSON.parse(g.originalInquiry.requestBody),referenceNo:i.referenceNo,beneficiaryAccountName:i.beneficiaryAccountName};
    return {environment:f.environment,credentialFingerprint:b.credentialFingerprint,operation:'transfer-payment',externalId:b.paymentExternalId,
      requestedAt:at,observedAt:at,requestBody:wire(request),responseBody:JSON.stringify({...request,responseCode:'2000000',
        referenceNo:'PAY-'+b.partnerReferenceNo.slice(-40),referenceNumber:'BANK-'+b.partnerReferenceNo.slice(-40),transactionDate:at})};
  };
  const receipt=(p,e)=>f.call(withdrawalPath+'/'+p.w.id+'/payment/receipt',{environment:f.environment,evidence:e});
  return {...f,prepare,startPayment:start,recoverPayment:recover,paymentEvidence:evidence,paymentReceipt:receipt};
}

test('one original payment grant fences cancellation and confirmation without claiming delivery or releasing money',async t=>{
  const f=await fixture(t),p=await f.prepare(),before=await f.summary(),g=await f.startPayment(p);
  assert.equal(g.status,200,g.error);assert.equal(g.mayPay,true);assert.equal(g.inquiryDigest,p.r.inquiryDigest);
  assert.equal(g.binding.beneficiaryAccountNumber,'001234567890');assert.deepEqual(g.originalInquiry,p.e);
  assert.equal((await f.startPayment(p)).mayPay,false);assert.equal((await f.cancel(p.w)).status,409);
  assert.equal((await f.confirm(p.w,p.r.inquiryDigest)).status,409);
  let detail=await f.readWithdrawal(p.w);assert.equal(detail.withdrawal.canCancel,false);assert.equal(detail.withdrawal.payment.state,'review');
  const e=f.paymentEvidence(g),r=await f.paymentReceipt(p,e);assert.equal(r.status,200,r.error);assert.equal(r.payoutConfirmed,false);
  const recovery=await f.recoverPayment(p);assert.equal(recovery.mayPay,false);assert.equal(recovery.payoutConfirmed,false);
  assert.deepEqual(recovery.originalPayment,e);assert.equal(recovery.inquiryDigest,p.r.inquiryDigest);assert.equal(recovery.confirmationId,p.c.confirmation.id);
  assert.equal((await f.paymentReceipt(p,e)).replayed,true);assert.equal((await f.startPayment(p)).mayPay,false);
  detail=await f.readWithdrawal(p.w);assert.equal(detail.withdrawal.payment.state,'response_recorded');assert.equal(detail.withdrawal.payoutConfirmed,false);
  assert.deepEqual(await f.summary(),before);assert.equal((await f.earnings()).reservedWithdrawals,'250000');
});

test('concurrent payment attempts get exactly one send authority and a cancellation race cannot win twice',async t=>{
  const f=await fixture(t),p=await f.prepare(),results=await Promise.all(Array.from({length:4},()=>f.startPayment(p)));
  assert(results.every(r=>r.status===200),JSON.stringify(results));assert.equal(results.filter(r=>r.mayPay).length,1);
  const q=await f.prepare(),race=await Promise.all([f.startPayment(q),f.cancel(q.w)]);
  assert.equal(race.filter(r=>r.status===200).length,1,JSON.stringify(race));assert.equal(race.filter(r=>r.status===409).length,1);
  const grants=await count(f,'commerce_withdrawal_payment_grants'),cancellations=await count(f,'commerce_withdrawal_cancellations');assert.equal(grants+cancellations,2);
  const r=await f.prepare();assert.equal((await f.cancel(r.w)).status,200);assert.equal((await f.startPayment(r)).status,409);
  assert.equal((await f.summary()).balanced,true);
});

test('a new payment rechecks the latest confirmation, proof and funds while an existing grant never regains send authority',async t=>{
  const f=await fixture(t),p=await f.prepare(),newer=await f.confirm(p.w,p.r.inquiryDigest);
  assert.equal((await f.startPayment(p)).status,409);p.c=newer;
  assert.equal((await f.startPayment(p,{actor:{...owner(),proofExpiresAt:new Date(Date.now()-1).toISOString()}})).status,401);
  const refund=await f.refund(f.p);assert.equal((await f.startPayment(p)).status,409);await f.refundAction(refund.id,'decline');
  const g=await f.startPayment(p);assert.equal(g.status,200,g.error);
  await f.refund(f.p);assert.equal((await f.startPayment(p)).mayPay,false);assert.equal((await f.cancel(p.w)).status,409);
  assert.equal((await f.paymentReceipt(p,f.paymentEvidence(g))).status,200);assert.equal((await f.earnings()).availableEarnings,'0');
});

test('an expired bank confirmation cannot be replaced by a fresh caller proof or replayed confirmation key',async t=>{
  const f=await fixture(t),p=await f.prepare(),requestKey=key(),actor={...owner(),proofExpiresAt:new Date(Date.now()+1000).toISOString()};
  p.c=await f.confirm(p.w,p.r.inquiryDigest,{requestKey,actor});assert.equal(p.c.status,200,p.c.error);
  await new Promise(resolve=>setTimeout(resolve,1100));
  assert.equal((await f.startPayment(p)).status,409);
  assert.equal((await f.confirm(p.w,p.r.inquiryDigest,{requestKey})).confirmation.proofExpiresAt,actor.proofExpiresAt);
  assert.equal((await f.startPayment(p)).status,409);p.c=await f.confirm(p.w,p.r.inquiryDigest);
  assert.equal((await f.startPayment(p)).mayPay,true);
});

test('payment receipts reject changed destination, amount, beneficiary, credentials, identities and malformed original bytes',async t=>{
  const f=await fixture(t),p=await f.prepare('Owner Ω\u2028\u2029'),g=await f.startPayment(p);assert.equal(g.status,200,g.error);
  const e=f.paymentEvidence(g),body=JSON.parse(e.responseBody);
  for(const change of [{fromAccount:'2010000002'},{fromAccount:2010000001.5},{beneficiaryAccountNumber:'1234567890'},
    {beneficiaryBankCode:'BNINIDJA'},{beneficiaryAccountName:'Other'},{partnerReferenceNo:'other'},{type:'DOKU_WALLET'},
    {channel:'ONLINE'},{amount:{value:'249999.00',currency:'IDR'}},{amount:{value:250000,currency:'IDR'}},
    {amount:{value:'250000.00',currency:'USD'}},{referenceNo:''},{referenceNumber:''},{responseCode:'4000000'},
    {transactionDate:'2026-02-30T00:00:00Z'},{transactionDate:new Date(Date.now()+700000).toISOString()}])
    assert([409,422].includes((await f.paymentReceipt(p,{...e,responseBody:JSON.stringify({...body,...change})})).status),JSON.stringify(change));
  for(const change of [{externalId:g.binding.inquiryExternalId},{operation:'transfer-inquiry'},{credentialFingerprint:'b'.repeat(64)},
    {requestBody:e.requestBody+' '},{observedAt:new Date(Date.now()+700000).toISOString()},{requestedAt:new Date(Date.now()-700000).toISOString()},
    {requestedAt:new Date(Date.now()+10000).toISOString()},{responseBody:e.responseBody.replace('"IDR"','"IDR","currency":"IDR"')}])
    assert([409,422].includes((await f.paymentReceipt(p,{...e,...change})).status));
  assert.equal(await count(f,'commerce_withdrawal_payment_receipts'),0);
  const accepted={...e,responseBody:JSON.stringify({...body,fromAccount:2010000001})};assert.equal((await f.paymentReceipt(p,accepted)).status,200);
  assert.equal((await f.paymentReceipt(p,{...accepted,responseBody:JSON.stringify(JSON.parse(accepted.responseBody),null,2)})).status,409);
});

test('provider payment references cannot be reused across withdrawals and private recovery exposes no merchant transport secrets',async t=>{
  const f=await fixture(t),p=await f.prepare(),g=await f.startPayment(p),e=f.paymentEvidence(g);assert.equal((await f.paymentReceipt(p,e)).status,200);
  const q=await f.prepare(),h=await f.startPayment(q),other=f.paymentEvidence(h),r=JSON.parse(other.responseBody);r.referenceNo=JSON.parse(e.responseBody).referenceNo;
  assert.equal((await f.paymentReceipt(q,{...other,responseBody:JSON.stringify(r)})).status,409);
  const history=await f.call(withdrawalPath+'/list',f.scope());assert.equal(history.status,200,history.error);
  assert(!/requestBody|responseBody|originalPayment|originalInquiry|credentialFingerprint|2010000001|001234567890|BANK-|PAY-/.test(JSON.stringify(history)));
  assert.equal((await f.readWithdrawal(q.w)).withdrawal.payment.state,'review');
});

test('timeouts and provider error diagnostics retain the original payment grant and never unlock cancellation or retry',async t=>{
  const f=await fixture(t),p=await f.prepare(),g=await f.startPayment(p),target=withdrawalPath+'/'+p.w.id+'/payment/diagnostic';
  const input={environment:f.environment,stage:'provider_payment',reason:'transport',providerStatus:0};
  assert.equal((await f.call(target,input)).status,200);assert.equal((await f.call(target,{...input,reason:'http',providerStatus:409})).status,200);
  const r=await f.recoverPayment(p);assert.equal(r.diagnostic.reason,'transport');assert.equal(r.originalPayment,null);assert.equal(r.mayPay,false);
  assert.equal((await f.cancel(p.w)).status,409);assert.equal((await f.startPayment(p)).mayPay,false);
  assert.equal((await f.call(target,{...input,reason:'raw response data!'})).status,422);
  assert.equal((await f.paymentReceipt(p,f.paymentEvidence(g))).status,200);
  for(const table of ['commerce_withdrawal_payment_grants','commerce_withdrawal_payment_receipts','commerce_withdrawal_payment_diagnostics']){
    await assert.rejects(f.db.prepare('DELETE FROM '+table).run(),/withdrawal_payment_immutable/);
    await assert.rejects(f.db.prepare('INSERT OR REPLACE INTO '+table+' SELECT * FROM '+table).run(),/withdrawal_payment_immutable/);
    await assert.rejects(f.db.prepare('UPDATE '+table+' SET withdrawal_id=withdrawal_id').run(),/withdrawal_payment_immutable/);
  }
});

test('payment grant and receipt rollback preserve the original reservation and do not create phantom send authority',async t=>{
  const f=await fixture(t),p=await f.prepare(),before=await f.summary();
  const block=table=>f.db.prepare('CREATE TRIGGER fixture_payment_failure AFTER INSERT ON '+table+" BEGIN SELECT RAISE(ABORT,'fixture_payment_failure'); END").run();
  const unblock=()=>f.db.prepare('DROP TRIGGER fixture_payment_failure').run();
  await block('commerce_withdrawal_payment_grants');assert.equal((await f.startPayment(p)).status,500);assert.equal(await count(f,'commerce_withdrawal_payment_grants'),0);
  assert.equal((await f.readWithdrawal(p.w)).withdrawal.canCancel,true);await unblock();const g=await f.startPayment(p);assert.equal(g.mayPay,true);
  await block('commerce_withdrawal_payment_receipts');const e=f.paymentEvidence(g);assert.equal((await f.paymentReceipt(p,e)).status,500);
  assert.equal((await f.startPayment(p)).mayPay,false);assert.equal((await f.cancel(p.w)).status,409);
  await unblock();assert.equal((await f.paymentReceipt(p,e)).status,200);assert.deepEqual(await f.summary(),before);
});

test('payment grant routing is independently held, signed-service only and scoped to the confirmed original owner and environment',async t=>{
  const f=await fixture(t,{bindings:{COMMERCE_WITHDRAWAL_PAYMENT:'held'}}),p=await f.prepare();assert.equal((await f.startPayment(p)).status,503);
  assert.equal((await f.merchant(withdrawalPath+'/'+p.w.id+'/payment/start',{}, {method:'POST'})).status,401);
  assert.equal((await f.startPayment(p,{environment:'production'})).status,403);assert.equal(await count(f,'commerce_withdrawal_payment_grants'),0);
  const active=await fixture(t),q=await active.prepare();
  for(const extra of [{credentialFingerprint:'b'.repeat(64)},{clientId:'MCH-OTHER'},{seller:'seller_bob'},{confirmationId:'wdconf_'+'f'.repeat(40)}])
    assert([403,404,409].includes((await active.startPayment(q,extra)).status));
  assert.equal((await active.startPayment(q,{amount:'250000'})).status,422);
  await active.db.prepare("UPDATE seller_memberships SET role='viewer' WHERE seller_id='seller_alice'").run();assert.equal((await active.startPayment(q)).status,403);
});

test('the populated 0056 upgrade keeps original bank confirmation, reservation and journals intact',async t=>{
  const f=await setupWithdrawalInquiryFixture(t,{through:56,bindings:{APP_ENVIRONMENT:'beta',COMMERCE_WITHDRAWAL_PAYMENT:'enabled'}});
  const id='wd_'+key()+key().slice(0,8),scope={environment:'production',seller:'seller_alice',actor:owner()};
  const wallet=await f.db.prepare("SELECT id FROM commerce_wallet_enrollments WHERE seller_id='seller_alice'").first();
  await f.db.prepare("INSERT INTO commerce_withdrawals(id,seller_id,commerce_environment,request_key,owner_auth_id,proof_expires_at,enrollment_id,amount,bank_code,bank_account,channel,partner_reference,funds_json,created_at) SELECT ?,'seller_alice','production',?,'alice',?,?,250000,'CENAIDJA','001234567890','BI_FAST',?,source_json,strftime('%Y-%m-%dT%H:%M:%fZ','now') FROM commerce_withdrawal_funds WHERE seller_id='seller_alice' AND commerce_environment='production'")
    .bind(id,key(),scope.actor.proofExpiresAt,wallet.id,'EZK-PAYOUT-P-'+id.slice(3)).run();
  const w={id},g=await f.start(w),r=await f.receipt(w,f.evidence(g)),c=await f.confirm(w,r.inquiryDigest);assert.equal(c.status,200,c.error);
  const tables=['commerce_withdrawals','commerce_withdrawal_inquiry_grants','commerce_withdrawal_inquiry_receipts','commerce_withdrawal_confirmations','commerce_financial_journals','commerce_financial_entries'];
  const before=await Promise.all(tables.map(table=>f.db.prepare('SELECT * FROM '+table).all()));await applyCommerceSchema(f.db,56);
  for(let i=0;i<tables.length;i++)assert.deepEqual((await f.db.prepare('SELECT * FROM '+tables[i]).all()).results,before[i].results);
  assert.deepEqual((await f.db.prepare('PRAGMA foreign_key_check').all()).results,[]);
  const payment=await f.call(withdrawalPath+'/'+id+'/payment/start',{...scope,confirmationId:c.confirmation.id,credentialFingerprint:'a'.repeat(64),clientId:'MCH-FIXTURE-SNAP'});
  assert.equal(payment.status,200,payment.error);assert.equal(payment.binding.environment,'production');assert.equal(payment.mayPay,true);
  assert.equal((await f.earnings()).reservedWithdrawals,'250000');assert.equal((await f.summary()).balanced,true);
});

test('database payment guards independently bind the owner, latest confirmation, funds, original request and response',async t=>{
  const f=await fixture(t),p=await f.prepare(),g=await f.startPayment(p),q=await f.prepare();
  const original=await f.db.prepare('SELECT * FROM commerce_withdrawal_payment_grants WHERE withdrawal_id=?').bind(p.w.id).first();
  const funds=await f.db.prepare("SELECT source_json FROM commerce_withdrawal_funds WHERE seller_id='seller_alice' AND commerce_environment='sandbox'").first();
  const bank=JSON.parse(q.e.responseBody),request={...JSON.parse(q.e.requestBody),referenceNo:bank.referenceNo,beneficiaryAccountName:bank.beneficiaryAccountName};
  const row={...original,withdrawal_id:q.w.id,confirmation_id:q.c.confirmation.id,payment_external_id:q.g.binding.paymentExternalId,
    inquiry_digest:q.r.inquiryDigest,request_body:wire(request),funds_json:funds.source_json};
  const insert=(table,record,at='created_at')=>{
    const value={...record};delete value[at];
    return f.db.prepare('INSERT INTO '+table+'('+Object.keys(value).join(',')+','+at+') VALUES('+Object.keys(value).map(()=>'?').join(',')+",strftime('%Y-%m-%dT%H:%M:%fZ','now'))").bind(...Object.values(value)).run();
  };
  for(const change of [{owner_auth_id:'bob'},{commerce_environment:'production'},{credential_fingerprint:'b'.repeat(64)},
    {client_id:'MCH-OTHER'},{payment_external_id:'8'.repeat(32)},{inquiry_digest:'b'.repeat(64)},
    {request_body:wire({...request,beneficiaryAccountName:'Other'})},{request_body:wire({...request,amount:{value:'250001.00',currency:'IDR'}})}])
    await assert.rejects(insert('commerce_withdrawal_payment_grants',{...row,...change}),/withdrawal_payment_(source|platform_required)/);
  await assert.rejects(insert('commerce_withdrawal_payment_grants',{...row,confirmation_id:'wdconf_'+'f'.repeat(40)}),/withdrawal_payment_confirmation/);
  await assert.rejects(insert('commerce_withdrawal_payment_grants',{...row,funds_json:'{}'}),/withdrawal_funds_unavailable/);
  for(const proof_expires_at of [new Date(Date.now()-1000).toISOString(),new Date(Date.now()+700000).toISOString()])
    await assert.rejects(insert('commerce_withdrawal_payment_grants',{...row,proof_expires_at}),/withdrawal_proof_expired/);
  const refund=await f.refund(f.p);await assert.rejects(insert('commerce_withdrawal_payment_grants',row),/withdrawal_funds_unavailable/);await f.refundAction(refund.id,'decline');
  await f.db.prepare("UPDATE seller_memberships SET role='viewer' WHERE seller_id='seller_alice'").run();
  await assert.rejects(insert('commerce_withdrawal_payment_grants',row),/withdrawal_owner_changed/);
  await f.db.prepare("UPDATE seller_memberships SET role='owner' WHERE seller_id='seller_alice'").run();
  assert.equal((await f.startPayment(q)).mayPay,true);
  const cancel={withdrawal_id:p.w.id,request_key:key(),owner_auth_id:'alice',proof_expires_at:owner().proofExpiresAt};
  await assert.rejects(insert('commerce_withdrawal_cancellations',cancel),/withdrawal_payment_started/);
  const e=f.paymentEvidence(g),response=JSON.parse(e.responseBody),receipt={withdrawal_id:p.w.id,commerce_environment:f.environment,
    credential_fingerprint:g.binding.credentialFingerprint,provider_reference:response.referenceNo,bank_reference:response.referenceNumber,
    payment_digest:'a'.repeat(64),evidence_json:JSON.stringify(e),requested_at:e.requestedAt,observed_at:e.observedAt,processed_at:response.transactionDate};
  for(const change of [{provider_reference:'other'},{bank_reference:'other'},{credential_fingerprint:'b'.repeat(64)},
    {evidence_json:JSON.stringify({...e,externalId:g.binding.inquiryExternalId})},
    {evidence_json:JSON.stringify({...e,responseBody:JSON.stringify({...response,beneficiaryAccountName:'Other'})})},
    {evidence_json:JSON.stringify({...e,responseBody:JSON.stringify({...response,amount:{value:250000,currency:'IDR'}})})},
    {evidence_json:JSON.stringify({...e,responseBody:e.responseBody.replace('"IDR"','"IDR","currency":"IDR"')})},
    {observed_at:new Date(Date.now()+700000).toISOString()},{processed_at:new Date(Date.now()+700000).toISOString()}])
    await assert.rejects(insert('commerce_withdrawal_payment_receipts',{...receipt,...change},'recorded_at'),/withdrawal_payment_receipt_mismatch/);
  assert.equal(await count(f,'commerce_withdrawal_payment_receipts'),0);assert.equal((await f.paymentReceipt(p,e)).status,200);
});


test('beta bank changes fence unsent dispatch while original started payment recovery survives incomplete onboarding',async t=>{
 const f=await fixture(t,{bindings:{APP_ENVIRONMENT:'beta'}}),sent=await f.prepare(),unsent=await f.prepare(),g=await f.startPayment(sent);
 assert.equal(g.status,200,g.error);assert.equal(g.mayPay,true);
 const bank=await f.call('/internal/commerce/onboarding',{...f.scope(),action:'bank',revision:1,requestKey:key(),bank:{code:'CENAIDJA',accountNumber:'009999999999',channel:'BI_FAST'}});assert.equal(bank.status,200,bank.error);
 const denied=await f.startPayment(unsent);assert.equal(denied.status,409,denied.error);assert.match(denied.error,/saved bank changed/);
 assert.equal((await f.readWithdrawal(unsent.w)).withdrawal.bank.accountNumber,'001234567890');
 await f.db.prepare("UPDATE app_users SET email='changed@example.test' WHERE auth_user_id='alice'").run();
 assert.equal((await f.call('/internal/commerce/onboarding',{...f.scope(),action:'read'})).onboarding.ready,false);
 assert.equal((await f.startPayment(sent)).mayPay,false);assert.equal((await f.paymentReceipt(sent,f.paymentEvidence(g))).status,200);
 const recovered=await f.recoverPayment(sent);assert.equal(recovered.status,200,recovered.error);assert.equal(recovered.binding.beneficiaryAccountNumber,'001234567890');assert.equal(recovered.mayPay,false);
 assert.equal((await f.cancel(unsent.w)).status,200);assert.equal(await count(f,'commerce_withdrawal_payment_grants'),1);
});
