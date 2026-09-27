import assert from 'node:assert/strict';
import {setupCollectionFixture} from './provider-collection-fixture.mjs';
import {prepareFixtureRoute} from './payment-routing-fixture.mjs';

export const settlementPath='/internal/commerce/finance/settlement';
const workerId='settlement_fixture',fingerprint='a'.repeat(64),clientId='MCH-FIXTURE-SNAP';
export async function setupSettlementFixture(t,options={}){
  const f=await setupCollectionFixture(t,{...options,bindings:{COMMERCE_PLATFORM_WALLET_SELLER:'seller_bob',...options.bindings}}),environment=f.environment;
  let charge=0;
  async function payment(input={}){
    const made=await f.create(f.checkoutInput({checkout:{intentHash:'f'.repeat(64),paymentFlow:'snap_bca',shop:'alice-shop'},...input}));assert.equal(made.status,200,made.error);
    const o=made.order,claimed=await f.call('/internal/commerce/jobs/claim',{environment,workerId,kinds:['payment.create'],orderId:o.id,limit:1,leaseSeconds:120});assert.equal(claimed.jobs.length,1);
    const job=claimed.jobs[0];await prepareFixtureRoute(f,o,job,{environment,workerId,fingerprint,clientId});
    const bound=await f.call('/internal/commerce/snap-payments/'+o.id+'/bind',{environment,workerId,leaseToken:job.leaseToken,credentialFingerprint:fingerprint,clientId,partnerServiceId:'   19008',customerPrefix:'0'});assert.equal(bound.status,200,bound.error);
    const b=bound.binding,account='1900800000'+String(++charge).padStart(6,'0'),at=new Date().toISOString().replace(/\.\d{3}Z$/,'Z');
    const body={partnerServiceId:b.partnerServiceId,customerNo:account.slice(5),virtualAccountNo:'   '+account,virtualAccountName:b.name,
      trxId:o.id,paidAmount:{value:String(b.amount)+'.00',currency:'IDR'},paymentRequestId:'PJP-'+charge,trxDateTime:at,additionalInfo:{channel:'VIRTUAL_ACCOUNT_BCA'}};
    const receipt={environment,credentialFingerprint:fingerprint,operation:'bca-notification',externalId:'123456'+charge,sentAt:at,observedAt:at,requestBody:null,body:JSON.stringify(body)};
    const paid=await f.call('/internal/commerce/snap-payments/'+o.id+'/receipt',receipt);assert.equal(paid.status,200,paid.error);
    assert.equal((await f.call('/internal/commerce/jobs/'+job.id+'/finish',{environment,workerId,leaseToken:job.leaseToken,outcome:'succeeded',result:{recorded:true}})).status,200);
    const route=(await f.call('/internal/commerce/snap-payments/'+o.id+'?environment='+environment)).payment.route;
    return {order:paid.order,route,receipt};
  }
  function legs(p,{fee=2500,status='SUCCESS',reference='group-'+p.order.id,pendingOutflows=true}={}){
    const o=p.order,flat=p.route.binding.platformAmount,net=o.total-fee-flat,at=new Date(Date.now()-1).toISOString();
    const row=(type,mutation,amount)=>({referenceNo:reference,partnerReferenceNo:o.id,transactionType:type,mutationType:mutation,amount:String(amount),currency:'IDR',status,dateTime:at,channel:'VIRTUAL_ACCOUNT_BCA'});
    return {sellerCash:[row('SPLIT_TRANSACTION','CREDIT',Math.max(0,net))],sellerPending:[row('PAYMENT','CREDIT',o.total),row('SETTLEMENT_FEE','DEBIT',fee),
      ...(pendingOutflows?[row('SPLIT_TRANSACTION','DEBIT',Math.max(0,net)),row('SPLIT_TRANSACTION','DEBIT',flat)]:[])],
      platformCash:[row('SPLIT_TRANSACTION','CREDIT',flat)],platformPending:[]};
  }
  async function collect(p,items,options={}){
    const from=options.from||new Date(Date.parse(p.order.createdAt)-60000).toISOString(),to=options.to||new Date().toISOString();
    const collections=[];
    for(const [seller,number,rows] of [['seller_alice','1',[items.sellerCash,items.sellerPending]],['seller_bob','2',[items.platformCash,items.platformPending]]]){
      const stamp=()=>({seller,requestedAt:new Date().toISOString(),observedAt:new Date().toISOString()});
      const ids=[await f.balance('0',stamp())];
      for(const [index,entries] of rows.entries()){
        const pages=[];for(let i=0;i<entries.length;i+=20)pages.push(entries.slice(i,i+20));
        if(!entries.length||entries.length%20===0)pages.push([]);
        for(const [page,values] of pages.slice(0,options.maxPages||40).entries())ids.push(await f.history(values,{accountNo:(index===0?'201':'203')+'000000'+number,fromDateTime:from,toDateTime:to,pageNumber:String(page)},stamp()));
      }
      ids.push(await f.balance('0',stamp()));
      const sealed=await f.call('/internal/commerce/finance/provider-collections',{seller,environment,observationIds:ids});assert.equal(sealed.status,200,sealed.error);collections.push(sealed.collection);
    }
    return {sellerCollectionId:collections[0].id,platformCollectionId:collections[1].id,collections,from,to};
  }
  const reconcile=(p,pair,extra={})=>f.call(settlementPath+'/reconcile',{seller:'seller_alice',environment,orderId:p.order.id,
    sellerCollectionId:pair.sellerCollectionId,platformCollectionId:pair.platformCollectionId,...extra});
  const read=p=>f.call(settlementPath+'?seller=seller_alice&environment='+environment+'&orderId='+p.order.id);
  const summary=()=>f.call('/internal/commerce/finance/summary?seller=seller_alice&environment='+environment);
  const journals=()=>f.call('/internal/commerce/finance/journals?seller=seller_alice&environment='+environment);
  return {...f,payment,legs,collect,reconcile,read,summary,journals};
}
