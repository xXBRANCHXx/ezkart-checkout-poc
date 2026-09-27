import assert from 'node:assert/strict';
import {randomBytes} from 'node:crypto';
import {setupSettlementFixture} from './settlement-fixture.mjs';
import {fixtureShipping} from './commerce-fixture.mjs';

export const earningsPath='/internal/commerce/finance/earnings';
export const key=()=>randomBytes(16).toString('hex');
export async function setupEarningsFixture(t,options={}){
  const f=await setupSettlementFixture(t,options),environment=f.environment;
  const payment=(input={})=>f.payment({shipping:fixtureShipping,customer:{name:'Earnings Buyer',email:'earnings@example.test',phone:'081234567890',authUserId:'earnings-buyer'},...input});
  const position=p=>f.call(earningsPath+'?seller=seller_alice&environment='+environment+'&orderId='+p.order.id);
  const earnings=()=>f.call(earningsPath+'/summary?seller=seller_alice&environment='+environment);
  const catchUp=(extra={})=>f.call(earningsPath+'/reconcile',{environment,seller:'seller_alice',...extra});
  const settle=async(p,changes={},options={})=>{const pair=await f.collect(p,f.legs(p,changes),options),r=await f.reconcile(p,pair);assert.equal(r.status,200,r.error);return {pair,result:r};};
  const pickup=async p=>{
    let id;
    for(const kind of ['accept','pickup']){const d=await f.merchant('/v1/fulfillment/'+p.order.id),r=await f.merchant('/v1/fulfillment/'+p.order.id,{requestKey:key(),revision:d.order.revision,kind},{method:'POST'});assert.equal(r.status,200,r.error);id=r.receipt.shipmentId||id;}
    assert.equal((await f.call('/internal/commerce/shipments/'+id+'/account',{environment,accountHash:'a'.repeat(64)})).status,200);
    const detail=await f.call('/internal/commerce/shipments/'+id+'?environment='+environment);
    return {id,reference:detail.shipment.reference,providerId:'fixture_'+id};
  };
  const bind=(shipment,data={kind:'status',status:'delivered',updatedAt:new Date().toISOString()})=>f.call('/internal/commerce/shipments/'+shipment.id+'/bind',{environment,verified:true,...shipment,data});
  const deliver=async p=>{const shipment=await pickup(p);const r=await bind(shipment);assert.equal(r.status,200,r.error);return shipment;};
  const refund=async(p,amount=1000)=>{
    const path='/v1/commerce/refunds/orders/'+p.order.id,d=await f.merchant(path);assert.equal(d.status,200,d.error);
    const r=await f.merchant(path,{requestKey:key(),orderRevision:d.order.revision,reason:'damaged',note:'Inspect the original purchase.',items:[{orderItemId:p.order.items[0].id,amount}],shippingAmount:0},{method:'POST'});
    assert.equal(r.status,200,r.error);return r.refund;
  };
  const refundAction=async(id,kind)=>{
    const path='/v1/commerce/refunds/'+id,d=await f.merchant(path);assert.equal(d.status,200,d.error);
    const r=await f.merchant(path,{requestKey:key(),revision:d.refund.revision,orderRevision:d.refund.orderRevision,kind,message:'The request was reviewed.'},{method:'POST'});assert.equal(r.status,200,r.error);return r.refund;
  };
  return {...f,payment,position,earnings,catchUp,settle,pickup,bind,deliver,refund,refundAction};
}
