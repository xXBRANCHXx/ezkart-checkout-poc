import assert from 'node:assert/strict';
import {setupEarningsFixture,key} from './earnings-fixture.mjs';

export const withdrawalPath='/internal/commerce/finance/withdrawals';
export const owner=()=>({id:'alice',email:'alice@example.test',proofExpiresAt:new Date(Date.now()+550000).toISOString()});
export async function setupWithdrawalInquiryFixture(t,options={}){
  const f=await setupEarningsFixture(t,{...options,bindings:{COMMERCE_WITHDRAWAL_INQUIRY:'enabled',...options.bindings}});
  const scope=()=>({environment:f.environment,seller:'seller_alice',actor:owner()});
  await f.product('bank-inquiry',10,'seller_alice',400000);
  const p=await f.payment({items:[{productId:'bank-inquiry',quantity:2,expectedPrice:400000,expectedWeightGrams:100}]});await f.settle(p);await f.deliver(p);
  const reserve=async(extra={})=>{const r=await f.call(withdrawalPath,{...scope(),requestKey:key(),amount:'250000',bank:{code:'CENAIDJA',accountNumber:'001234567890',channel:'BI_FAST'},...extra});assert.equal(r.status,200,r.error);return r.withdrawal;};
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
