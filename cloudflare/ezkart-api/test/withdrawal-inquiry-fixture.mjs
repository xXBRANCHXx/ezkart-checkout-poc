import assert from 'node:assert/strict';
import {setupEarningsFixture,key} from './earnings-fixture.mjs';

export const withdrawalPath='/internal/commerce/finance/withdrawals';
export const owner=()=>({id:'alice',email:'alice@example.test',proofExpiresAt:new Date(Date.now()+550000).toISOString()});
// Seed the exact pre-0059 grant shape for populated migration tests. Production
// code must always use its current validated insertion path.
export async function seedLegacyPaymentGrant(f,w,confirmation){
  const original=await f.recover(w),response=JSON.parse(original.originalEvidence.responseBody),scope=f.scope();
  const requestBody=JSON.stringify({...JSON.parse(original.originalEvidence.requestBody),referenceNo:response.referenceNo,beneficiaryAccountName:response.beneficiaryAccountName})
    .replace(/\u2028/g,'\\u2028').replace(/\u2029/g,'\\u2029');
  const binding=await f.db.prepare('SELECT client_id FROM commerce_withdrawal_inquiry_grants WHERE withdrawal_id=?').bind(w.id).first();
  await f.db.prepare(`INSERT INTO commerce_withdrawal_payment_grants(withdrawal_id,commerce_environment,confirmation_id,owner_auth_id,
    proof_expires_at,credential_fingerprint,client_id,payment_external_id,inquiry_digest,request_body,funds_json,created_at)
    SELECT ?,?,?,?,?,?,?,?,?,?,f.source_json,strftime('%Y-%m-%dT%H:%M:%fZ','now') FROM commerce_withdrawal_funds f WHERE f.seller_id=? AND f.commerce_environment=?`)
    .bind(w.id,f.environment,confirmation.id,scope.actor.id,scope.actor.proofExpiresAt,original.binding.credentialFingerprint,binding.client_id,
      original.binding.paymentExternalId,original.inquiryDigest,requestBody,scope.seller,f.environment).run();
  return {status:200,binding:original.binding,originalInquiry:original.originalEvidence,inquiryDigest:original.inquiryDigest,confirmationId:confirmation.id};
}
export async function setupWithdrawalInquiryFixture(t,options={}){
  const f=await setupEarningsFixture(t,{...options,bindings:{COMMERCE_WITHDRAWAL_INQUIRY:'enabled',...options.bindings}});
  const scope=()=>({environment:f.environment,seller:'seller_alice',actor:owner()});
  await f.product('bank-inquiry',10,'seller_alice',400000);
  const p=await f.payment({items:[{productId:'bank-inquiry',quantity:2,expectedPrice:400000,expectedWeightGrams:100}]});await f.settle(p);await f.deliver(p);
  const reserve=async(extra={})=>{const r=await f.call(withdrawalPath,{...scope(),requestKey:key(),amount:'250000',...(f.environment==='production'?{bankRevision:1}:{bank:{code:'CENAIDJA',accountNumber:'001234567890',channel:'BI_FAST'}}),...extra});assert.equal(r.status,200,r.error);return r.withdrawal;};
  const start=(w,extra={})=>f.call(withdrawalPath+'/'+w.id+'/inquiry/start',{...scope(),credentialFingerprint:'a'.repeat(64),clientId:'MCH-FIXTURE-SNAP',...extra});
  function evidence(g,change={}){
    const b=g.binding,at=new Date().toISOString().replace(/\.\d{3}Z$/,'Z');
    const request={partnerReferenceNo:b.partnerReferenceNo,type:'BANK_ACCOUNT',channel:b.channel,amount:{value:b.amount+'.00',currency:'IDR'},
      fromAccount:b.fromAccount,beneficiaryBankCode:b.beneficiaryBankCode,beneficiaryAccountNumber:b.beneficiaryAccountNumber};
    return {environment:f.environment,credentialFingerprint:b.credentialFingerprint,operation:'transfer-inquiry',externalId:b.inquiryExternalId,
      requestedAt:at,observedAt:at,requestBody:JSON.stringify(request),responseBody:JSON.stringify({responseCode:'2000000',referenceNo:'INQ-'+b.partnerReferenceNo.slice(-40),...request,beneficiaryAccountName:'Bank Confirmed Owner'}),...change};
  }
  const receipt=(w,e)=>f.call(withdrawalPath+'/'+w.id+'/inquiry/receipt',{environment:f.environment,evidence:e});
  const read=w=>f.call(withdrawalPath+'/'+w.id+'/read',scope());
  const recover=w=>f.call(withdrawalPath+'/'+w.id+'/inquiry/read',{environment:f.environment});
  const confirm=(w,inquiryDigest,extra={})=>f.call(withdrawalPath+'/'+w.id+'/confirm',{...scope(),requestKey:key(),inquiryDigest,...extra});
  const cancel=w=>f.call(withdrawalPath+'/'+w.id+'/cancel',{...scope(),requestKey:key()});
  return {...f,p,scope,reserve,start,evidence,receipt,readWithdrawal:read,recover,confirm,cancel};
}
