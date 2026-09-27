import assert from 'node:assert/strict';
import {setupWithdrawalInquiryFixture,withdrawalPath} from './withdrawal-inquiry-fixture.mjs';
let statusExternalId=400000;

export async function setupPayoutFixture(t,options={}){
  const f=await setupWithdrawalInquiryFixture(t,{...options,bindings:{COMMERCE_WITHDRAWAL_PAYMENT:'enabled',...options.bindings}});
  const w=await f.reserve(),i=await f.start(w),bank=await f.receipt(w,f.evidence(i)),c=await f.confirm(w,bank.inquiryDigest);
  const paymentInput={...f.scope(),confirmationId:c.confirmation.id,credentialFingerprint:'a'.repeat(64),clientId:'MCH-FIXTURE-SNAP'};
  const g=await f.call(withdrawalPath+'/'+w.id+'/payment/start',paymentInput);assert.equal(g.status,200,g.error);
  return {...f,...payoutFixture(f,w,g),paymentInput};
}

// Also used by the protected PHP/browser workflow, with its original grant.
export function payoutFixture(f,w,g){
  const reference='payout-'+w.id,at=new Date().toISOString(),orderLegs=f.legs(f.p);
  const path=withdrawalPath+'/'+w.id;
  const row=(type,amount,status='SUCCESS',ref=reference)=>({referenceNo:ref,partnerReferenceNo:g.binding.partnerReferenceNo,
    transactionType:type,mutationType:'DEBIT',amount:String(amount),currency:'IDR',status,dateTime:at,channel:g.binding.channel});
  const evidence=(code='00',extra={})=>{
    const now=new Date().toISOString();
    return {environment:f.environment,credentialFingerprint:g.binding.credentialFingerprint,operation:'transactions-status',
      externalId:String(statusExternalId++).padStart(32,'0'),requestedAt:now,observedAt:now,
      requestBody:JSON.stringify({partnerReferenceNo:g.binding.partnerReferenceNo}),responseBody:JSON.stringify({responseCode:'2000000',
        partnerReferenceNo:g.binding.partnerReferenceNo,transactionType:'PAYOUT',latestTransactionStatus:code,
        amount:{value:w.amount+'.00',currency:'IDR'},transactionDate:at,...extra})};
  };
  const status=async(code='00',extra={})=>{
    const r=await f.call(path+'/payment/status/receipt',{environment:f.environment,evidence:evidence(code,extra)});assert.equal(r.status,200,r.error);
    const h=await f.call(path+'/payment/status/history',{environment:f.environment});return h.cap;
  };
  const collect=async({payouts=[row('PAYOUT',w.amount)],fees=[row('PAYOUT_CHARGE',2500)],feePocket='platformCash',other={},window={}}={})=>{
    const items=structuredClone(orderLegs);items.sellerCash.push(...payouts);items[feePocket].push(...fees);
    for(const [key,values] of Object.entries(other))items[key].push(...values);
    for(const values of Object.values(items))values.sort((a,b)=>b.dateTime.localeCompare(a.dateTime));
    return f.collect(f.p,items,{from:new Date(Date.parse(f.p.order.createdAt)-360000).toISOString(),...window});
  };
  const input=(pair,cap)=>({environment:f.environment,sellerCollectionId:pair.sellerCollectionId,platformCollectionId:pair.platformCollectionId,statusCap:cap});
  const reconcile=(pair,cap,extra={})=>f.call(path+'/payout/reconcile',{...input(pair,cap),...extra});
  const read=()=>f.call(path+'/payout/read',{environment:f.environment});
  const refreshEarnings=async pair=>{const s=await f.reconcile(f.p,pair);assert.equal(s.status,200,s.error);assert.equal(s.settlementVerified,true);await f.catchUp();};
  return {w,g,path,reference,row,statusEvidence:evidence,payoutStatus:status,collectPayout:collect,payoutInput:input,reconcilePayout:reconcile,readPayout:read,refreshEarnings};
}
