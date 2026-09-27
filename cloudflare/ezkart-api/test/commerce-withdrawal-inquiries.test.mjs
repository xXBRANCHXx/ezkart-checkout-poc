import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {setupWithdrawalInquiryFixture,withdrawalPath,owner} from './withdrawal-inquiry-fixture.mjs';
import {key,setupEarningsFixture} from './earnings-fixture.mjs';
import {applyCommerceSchema} from './commerce-schema.mjs';

const count=async(f,table)=>(await f.db.prepare('SELECT COUNT(*) AS n FROM '+table).first()).n;
test('the committed inquiry grant is single-use and its original bank receipt is confirmed without moving provider money',async t=>{
  const f=await setupWithdrawalInquiryFixture(t),w=await f.reserve(),before=await f.summary();
  const g=await f.start(w);assert.equal(g.status,200,g.error);assert.equal(g.mayInquire,true);assert.notEqual(g.binding.inquiryExternalId,g.binding.paymentExternalId);
  assert.match(g.binding.inquiryExternalId,/^[0-9]{32}$/);assert.equal(g.binding.beneficiaryAccountNumber,'001234567890');assert.equal(g.binding.fromAccount,'2010000001');
  assert.equal((await f.start(w)).mayInquire,false);assert.equal((await f.readWithdrawal(w)).withdrawal.inquiry.state,'review');
  const evidence=f.evidence(g),r=await f.receipt(w,evidence);assert.equal(r.status,200,r.error);assert.equal(r.payoutConfirmed,false);
  const digest=createHash('sha256').update('ezkart.doku.bank-inquiry.v1\n'+JSON.stringify([...Object.values(evidence),g.binding.paymentExternalId])).digest('hex');assert.equal(r.inquiryDigest,digest);
  const detail=await f.readWithdrawal(w);assert.equal(detail.withdrawal.bankVerified,true);assert.equal(detail.withdrawal.bank.beneficiaryName,'Bank Confirmed Owner');assert.equal(detail.withdrawal.bank.accountNumber,'001234567890');
  const confirmed=await f.confirm(w,digest);assert.equal(confirmed.status,200,confirmed.error);assert.equal(confirmed.payoutConfirmed,false);
  assert.equal((await f.readWithdrawal(w)).withdrawal.confirmation.id,confirmed.confirmation.id);assert.deepEqual(await f.summary(),before);
  const replay=await f.receipt(w,evidence);assert.equal(replay.status,200,replay.error);assert.equal(replay.replayed,true);
});

test('concurrent grant and receipt attempts return one dispatch authority and preserve original bytes after lost acknowledgements',async t=>{
  const f=await setupWithdrawalInquiryFixture(t),w=await f.reserve(),grants=await Promise.all(Array.from({length:4},()=>f.start(w)));
  assert(grants.every(g=>g.status===200));assert.equal(grants.filter(g=>g.mayInquire).length,1);const g=grants[0],e=f.evidence(g);
  const receipts=await Promise.all([f.receipt(w,e),f.receipt(w,e)]);assert(receipts.every(r=>r.status===200));assert.equal(await count(f,'commerce_withdrawal_inquiry_receipts'),1);
  const recovery=await f.recover(w);assert.equal(recovery.mayInquire,false);assert.deepEqual(recovery.originalEvidence,e);assert.deepEqual(recovery.binding,g.binding);
  assert.equal((await f.receipt(w,{...e,responseBody:JSON.stringify(JSON.parse(e.responseBody),null,2)})).status,409);
  assert.equal((await f.start(w,{credentialFingerprint:'b'.repeat(64)})).status,409);
  const requestKey=key(),confirmations=await Promise.all([f.confirm(w,receipts[0].inquiryDigest,{requestKey}),f.confirm(w,receipts[0].inquiryDigest,{requestKey})]);
  assert(confirmations.every(r=>r.status===200));assert.equal(await count(f,'commerce_withdrawal_confirmations'),1);
});

test('amount, destination, seller cash account, operation and reference substitutions cannot become verified bank evidence',async t=>{
  const f=await setupWithdrawalInquiryFixture(t),w=await f.reserve(),g=await f.start(w),e=f.evidence(g),r=JSON.parse(e.responseBody);
  for(const change of [{fromAccount:'2030000001'},{fromAccount:2010000001.1},{beneficiaryAccountNumber:'1234567890'},
    {beneficiaryBankCode:'BNINIDJA'},{partnerReferenceNo:'other'},{type:'DOKU_WALLET'},{channel:'ONLINE'},
    {amount:{value:'250001.00',currency:'IDR'}},{amount:{value:'250000',currency:'IDR'}},{amount:{value:'250000.00',currency:'USD'}},
    {beneficiaryAccountName:''},{beneficiaryAccountName:'bad\u0000name'},{referenceNo:''},{responseCode:'4000000'}])
    assert([409,422].includes((await f.receipt(w,{...e,responseBody:JSON.stringify({...r,...change})})).status),JSON.stringify(change));
  for(const change of [{operation:'transfer-payment'},{externalId:g.binding.paymentExternalId},{credentialFingerprint:'b'.repeat(64)},
    {requestBody:e.requestBody+' '},{environment:'production'},{responseBody:e.responseBody.replace('"responseCode":"2000000"','"responseCode":"2000000","responseCode":"2000000"')}])
    assert([409,422].includes((await f.receipt(w,{...e,...change})).status));
  assert.equal(await count(f,'commerce_withdrawal_inquiry_receipts'),0);assert.equal((await f.confirm(w,'a'.repeat(64))).status,409);
  const numeric=await f.receipt(w,{...e,responseBody:JSON.stringify({...r,fromAccount:2010000001})});assert.equal(numeric.status,200,numeric.error);
});

test('unsupported times, reused provider inquiry references and contradictory receipts remain under review',async t=>{
  const f=await setupWithdrawalInquiryFixture(t),w=await f.reserve(),g=await f.start(w),e=f.evidence(g);
  for(const extra of [{requestedAt:'2026-02-30T00:00:00Z'},{observedAt:new Date(Date.now()+400000).toISOString()},
    {requestedAt:new Date(Date.now()-400000).toISOString()}, {requestedAt:'2026-09-27T00:00:00+14:01'},
    {requestedAt:new Date(Date.now()+10000).toISOString(),observedAt:new Date().toISOString()}])assert.equal((await f.receipt(w,{...e,...extra})).status,422);
  const r=await f.receipt(w,e);assert.equal(r.status,200,r.error);
  const second=await f.reserve(),otherGrant=await f.start(second),other=f.evidence(otherGrant),body=JSON.parse(other.responseBody);body.referenceNo=JSON.parse(e.responseBody).referenceNo;
  assert.equal((await f.receipt(second,{...other,responseBody:JSON.stringify(body)})).status,409);assert.equal((await f.readWithdrawal(second)).withdrawal.bankVerified,false);
});

test('refund holds and cancellation fence new inquiries and confirmations, while a late original receipt remains auditable',async t=>{
  const f=await setupWithdrawalInquiryFixture(t),w=await f.reserve(),refund=await f.refund(f.p);
  assert.equal((await f.start(w)).status,409);await f.refundAction(refund.id,'decline');const g=await f.start(w),e=f.evidence(g);assert.equal(g.status,200,g.error);
  const held=await f.refund(f.p),r=await f.receipt(w,e);assert.equal(r.status,200,r.error);assert.equal((await f.confirm(w,r.inquiryDigest)).status,409);
  await f.refundAction(held.id,'decline');assert.equal((await f.cancel(w)).status,200);assert.equal((await f.confirm(w,r.inquiryDigest)).status,409);
  assert.equal((await f.start(w)).mayInquire,false);assert.equal((await f.receipt(w,e)).replayed,true);
  const next=await f.reserve();assert.equal((await f.cancel(next)).status,200);assert.equal((await f.start(next)).status,409);
  assert.equal((await f.summary()).balanced,true);
});

test('fresh owner authorization is required again for confirmation and cannot extend an earlier confirmation by replay',async t=>{
  const f=await setupWithdrawalInquiryFixture(t),w=await f.reserve(),g=await f.start(w),r=await f.receipt(w,f.evidence(g));
  const requestKey=key(),originalProof={...owner(),proofExpiresAt:new Date(Date.now()+300000).toISOString()};
  const confirmed=await f.confirm(w,r.inquiryDigest,{requestKey,actor:originalProof});assert.equal(confirmed.status,200,confirmed.error);
  const replay=await f.confirm(w,r.inquiryDigest,{requestKey});assert.equal(replay.replayed,true);assert.equal(replay.confirmation.proofExpiresAt,originalProof.proofExpiresAt);
  const renewed=await f.confirm(w,r.inquiryDigest);assert.equal(renewed.status,200,renewed.error);assert.notEqual(renewed.confirmation.id,confirmed.confirmation.id);
  assert.equal((await f.confirm(w,r.inquiryDigest,{actor:{...owner(),proofExpiresAt:new Date(Date.now()-1).toISOString()}})).status,401);
  assert.equal((await f.confirm(w,'f'.repeat(64),{requestKey})).status,409);
  await f.db.prepare("UPDATE seller_memberships SET role='viewer' WHERE seller_id='seller_alice'").run();assert.equal((await f.confirm(w,r.inquiryDigest)).status,403);
  assert.equal((await f.recover(w)).status,200); // Private recovery preserves facts without claiming a current owner decision.
});

test('bounded private failure diagnostics cannot authorize retry, replace a receipt or disclose the provider response to history',async t=>{
  const f=await setupWithdrawalInquiryFixture(t),w=await f.reserve(),g=await f.start(w),target=withdrawalPath+'/'+w.id+'/inquiry/diagnostic';
  const input={environment:f.environment,stage:'provider_inquiry',reason:'transport',providerStatus:0};
  assert.equal((await f.call(target,input)).status,200);assert.equal((await f.call(target,{...input,reason:'http',providerStatus:409})).status,200);
  const recovery=await f.recover(w);assert.equal(recovery.diagnostic.reason,'transport');assert.equal(recovery.mayInquire,false);assert.equal((await f.start(w)).mayInquire,false);
  assert.equal((await f.call(target,{...input,reason:'private response content!'})).status,422);
  assert.equal((await f.receipt(w,f.evidence(g))).status,200);
  const list=await f.call(withdrawalPath+'/list',f.scope());assert.equal(list.status,200,list.error);
  assert(!/originalEvidence|requestBody|responseBody|credentialFingerprint|2010000001|001234567890/.test(JSON.stringify(list)));
  for(const table of ['commerce_withdrawal_inquiry_grants','commerce_withdrawal_inquiry_receipts','commerce_withdrawal_inquiry_diagnostics']){
    await assert.rejects(f.db.prepare('DELETE FROM '+table).run(),/withdrawal_inquiry_immutable/);
    await assert.rejects(f.db.prepare('INSERT OR REPLACE INTO '+table+' SELECT * FROM '+table).run(),/withdrawal_inquiry_immutable/);
  }
});

test('bank inquiry dispatch is independently held and never callable with a merchant bearer or an alternate environment',async t=>{
  const f=await setupWithdrawalInquiryFixture(t,{bindings:{COMMERCE_WITHDRAWAL_INQUIRY:'held'}}),w=await f.reserve();assert.equal((await f.start(w)).status,503);
  const target=withdrawalPath+'/'+w.id+'/inquiry/start';assert.equal((await f.merchant(target,f.scope(),{method:'POST'})).status,401);
  assert.equal((await f.start(w,{environment:'production'})).status,403);assert.equal(await count(f,'commerce_withdrawal_inquiry_grants'),0);
});

test('database guards bind inquiry sources, original receipts and confirmations to current funds and owner proof',async t=>{
  const f=await setupWithdrawalInquiryFixture(t),w=await f.reserve(),g=await f.start(w),other=await f.reserve();
  const insert=(table,record,at='created_at')=>{
    const row={...record};delete row[at];delete row.sequence;
    return f.db.prepare('INSERT INTO '+table+'('+Object.keys(row).join(',')+','+at+') VALUES('+Object.keys(row).map(()=>'?').join(',')+",strftime('%Y-%m-%dT%H:%M:%fZ','now'))").bind(...Object.values(row)).run();
  };
  const original=await f.db.prepare('SELECT * FROM commerce_withdrawal_inquiry_grants WHERE withdrawal_id=?').bind(w.id).first();
  const b={...g.binding,partnerReferenceNo:'EZK-PAYOUT-S-'+other.id.slice(3),inquiryExternalId:'7'.repeat(31)+'1',paymentExternalId:'7'.repeat(31)+'2'};
  const wire={...JSON.parse(original.request_body),partnerReferenceNo:b.partnerReferenceNo};
  const grantRow={...original,withdrawal_id:other.id,inquiry_external_id:b.inquiryExternalId,payment_external_id:b.paymentExternalId,binding_json:JSON.stringify(b),request_body:JSON.stringify(wire)};
  for(const override of [{credential_fingerprint:'f'.repeat(64)},{owner_auth_id:'bob'},
    {binding_json:JSON.stringify({...b,amount:'250001'})},{binding_json:JSON.stringify({...b,fromAccount:'2010000002'})},
    {request_body:JSON.stringify({...wire,beneficiaryAccountNumber:'001234567891'})}])
    await assert.rejects(insert('commerce_withdrawal_inquiry_grants',{...grantRow,...override}),/withdrawal_inquiry_source_mismatch/);
  for(const proof_expires_at of [new Date(Date.now()-1000).toISOString(),new Date(Date.now()+700000).toISOString()])
    await assert.rejects(insert('commerce_withdrawal_inquiry_grants',{...grantRow,proof_expires_at}),/withdrawal_proof_expired/);
  const refund=await f.refund(f.p);await assert.rejects(insert('commerce_withdrawal_inquiry_grants',grantRow),/withdrawal_funds_unavailable/);await f.refundAction(refund.id,'decline');
  await f.cancel(other);await assert.rejects(insert('commerce_withdrawal_inquiry_grants',grantRow),/withdrawal_cancelled/);

  const e=f.evidence(g),body=JSON.parse(e.responseBody),receipt={withdrawal_id:w.id,commerce_environment:f.environment,credential_fingerprint:g.binding.credentialFingerprint,
    provider_reference:body.referenceNo,beneficiary_name:body.beneficiaryAccountName,inquiry_digest:'a'.repeat(64),evidence_json:JSON.stringify(e),
    requested_at:e.requestedAt.replace('Z','.000000Z'),observed_at:e.observedAt.replace('Z','.000000Z')};
  const receiptAttempt=change=>insert('commerce_withdrawal_inquiry_receipts',{...receipt,...change},'recorded_at');
  for(const override of [{beneficiary_name:'Unconfirmed Person'},{commerce_environment:'production'},
    {evidence_json:JSON.stringify({...e,externalId:g.binding.paymentExternalId})},
    {evidence_json:JSON.stringify({...e,responseBody:JSON.stringify({...body,beneficiaryAccountNumber:'001234567891'})})},
    {evidence_json:JSON.stringify({...e,responseBody:JSON.stringify({...body,amount:{value:250000,currency:'IDR'}})})},
    {evidence_json:JSON.stringify({...e,responseBody:e.responseBody.replace('"responseCode":"2000000"','"responseCode":"2000000","responseCode":"2000000"')})},
    {observed_at:new Date(Date.now()+700000).toISOString()}])
    await assert.rejects(receiptAttempt(override),/withdrawal_inquiry_receipt_mismatch/);
  const r=await f.receipt(w,e);assert.equal(r.status,200,r.error);
  const funds=await f.db.prepare("SELECT source_json FROM commerce_withdrawal_funds WHERE seller_id='seller_alice' AND commerce_environment='sandbox'").first();
  const confirmation={id:'wdconf_'+key()+key().slice(0,8),withdrawal_id:w.id,request_key:key(),owner_auth_id:'alice',proof_expires_at:owner().proofExpiresAt,inquiry_digest:r.inquiryDigest,funds_json:funds.source_json};
  for(const change of [{inquiry_digest:'f'.repeat(64)},{owner_auth_id:'bob'}])
    await assert.rejects(insert('commerce_withdrawal_confirmations',{...confirmation,...change}),/withdrawal_confirmation_mismatch/);
  await assert.rejects(insert('commerce_withdrawal_confirmations',{...confirmation,funds_json:'{}'}),/withdrawal_funds_unavailable/);
  await assert.rejects(insert('commerce_withdrawal_confirmations',{...confirmation,proof_expires_at:new Date(Date.now()-1000).toISOString()}),/withdrawal_proof_expired/);
  await f.db.prepare("UPDATE seller_memberships SET role='viewer' WHERE seller_id='seller_alice'").run();
  await assert.rejects(insert('commerce_withdrawal_confirmations',confirmation),/withdrawal_owner_changed/);
  await f.db.prepare("UPDATE seller_memberships SET role='owner' WHERE seller_id='seller_alice'").run();
  const c=await f.confirm(w,r.inquiryDigest);assert.equal(c.status,200,c.error);
  for(const sql of ['DELETE FROM commerce_withdrawal_confirmations',"UPDATE commerce_withdrawal_confirmations SET funds_json='{}'",'INSERT OR REPLACE INTO commerce_withdrawal_confirmations SELECT * FROM commerce_withdrawal_confirmations'])
    await assert.rejects(f.db.prepare(sql).run(),/withdrawal_confirmation_immutable/);
  assert.equal(await count(f,'commerce_withdrawal_inquiry_grants'),1);assert.equal(await count(f,'commerce_withdrawal_inquiry_receipts'),1);
  assert.equal((await f.summary()).balanced,true);
});

test('rolled back inquiry grants, receipts and confirmations recover only their original stage without adding money journals',async t=>{
  const f=await setupWithdrawalInquiryFixture(t),w=await f.reserve(),before=await f.summary();
  const block=table=>f.db.prepare('CREATE TRIGGER fixture_inquiry_failure AFTER INSERT ON '+table+" BEGIN SELECT RAISE(ABORT,'fixture_inquiry_failure'); END").run();
  const unblock=()=>f.db.prepare('DROP TRIGGER fixture_inquiry_failure').run();
  await block('commerce_withdrawal_inquiry_grants');assert.equal((await f.start(w)).status,500);assert.equal(await count(f,'commerce_withdrawal_inquiry_grants'),0);
  await unblock();const g=await f.start(w);assert.equal(g.mayInquire,true);const e=f.evidence(g);
  await block('commerce_withdrawal_inquiry_receipts');assert.equal((await f.receipt(w,e)).status,500);assert.equal((await f.start(w)).mayInquire,false);
  assert.equal((await f.recover(w)).originalEvidence,null);await unblock();const r=await f.receipt(w,e);assert.equal(r.status,200,r.error);
  const requestKey=key();await block('commerce_withdrawal_confirmations');assert.equal((await f.confirm(w,r.inquiryDigest,{requestKey})).status,500);
  assert.equal(await count(f,'commerce_withdrawal_confirmations'),0);await unblock();assert.equal((await f.confirm(w,r.inquiryDigest,{requestKey})).status,200);
  assert.deepEqual(await f.summary(),before);assert.equal((await f.recover(w)).mayInquire,false);
});

test('the populated 0055 upgrade preserves existing reservations and journals before bank verification on beta',async t=>{
  const f=await setupEarningsFixture(t,{through:55,bindings:{APP_ENVIRONMENT:'beta',COMMERCE_WITHDRAWAL_INQUIRY:'enabled'}});
  await f.product('upgrade-inquiry',10,'seller_alice',400000);const p=await f.payment({items:[{productId:'upgrade-inquiry',quantity:2,expectedPrice:400000,expectedWeightGrams:100}]});await f.settle(p);await f.deliver(p);
  const id='wd_'+key()+key().slice(0,8),scope={environment:'production',seller:'seller_alice',actor:owner()},reference='EZK-PAYOUT-P-'+id.slice(3);
  const wallet=await f.db.prepare("SELECT id FROM commerce_wallet_enrollments WHERE seller_id='seller_alice'").first();
  // Insert the original 0055 contract without invoking the newer joined read.
  await f.db.prepare("INSERT INTO commerce_withdrawals(id,seller_id,commerce_environment,request_key,owner_auth_id,proof_expires_at,enrollment_id,amount,bank_code,bank_account,channel,partner_reference,funds_json,created_at) SELECT ?,'seller_alice','production',?,'alice',?,?,250000,'CENAIDJA','001234567890','BI_FAST',?,source_json,strftime('%Y-%m-%dT%H:%M:%fZ','now') FROM commerce_withdrawal_funds WHERE seller_id='seller_alice' AND commerce_environment='production'")
    .bind(id,key(),scope.actor.proofExpiresAt,wallet.id,reference).run();
  const tables=['commerce_withdrawals','commerce_withdrawal_cancellations','commerce_financial_journals','commerce_financial_entries','commerce_earnings_assessments','commerce_wallet_provider_profiles'];
  const before=await Promise.all(tables.map(table=>f.db.prepare('SELECT * FROM '+table).all()));await applyCommerceSchema(f.db,55);
  for(let i=0;i<tables.length;i++)assert.deepEqual((await f.db.prepare('SELECT * FROM '+tables[i]).all()).results,before[i].results);
  assert.deepEqual((await f.db.prepare('PRAGMA foreign_key_check').all()).results,[]);
  const g=await f.call(withdrawalPath+'/'+id+'/inquiry/start',{...scope,credentialFingerprint:'a'.repeat(64),clientId:'MCH-FIXTURE-SNAP'});assert.equal(g.status,200,g.error);assert.equal(g.binding.environment,'production');assert.equal(g.binding.partnerReferenceNo,reference);
  assert.equal((await f.earnings()).reservedWithdrawals,'250000');assert.equal((await f.summary()).balanced,true);
});
