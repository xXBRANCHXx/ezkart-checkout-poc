import assert from 'node:assert/strict';
import {randomBytes} from 'node:crypto';
import {setupEarningsFixture} from './earnings-fixture.mjs';
export const refundProcessingKey=()=>randomBytes(16).toString('hex');
export const refundProcessingClaims=(age=0)=>({aal:'aal2',amr:[{method:'totp',timestamp:Math.floor(Date.now()/1000)-age}]});
export async function setupRefundProcessingFixture(t,{setup=setupEarningsFixture,settled=true,...options}={}){
  const f=await setup(t,options),p=await f.payment(),refund=await f.refund(p,10000);await f.refundAction(refund.id,'approve');
  if(settled)await f.settle(p);
  const buyer='earnings-buyer',url='/v1/customer/orders/'+p.order.id+'/refunds/'+refund.id,support='/v1/support/refunds/'+refund.id,store='/v1/commerce/refunds/'+refund.id;
  const permission=(role='reviewer')=>f.call('/internal/commerce/support/access',{environment:f.environment,authUserId:'bob',role,requestKey:refundProcessingKey(),operator:'Fixture operator',reason:'Verify original refund processing.'});assert.equal((await permission()).status,200);
  const view=async(actor=buyer)=>{const r=await f.merchant(actor==='bob'?support:actor===buyer?url:store,undefined,{seller:actor,claims:refundProcessingClaims()});assert.equal(r.status,200,r.error);return r.refund;};
  const bankBody={previousId:null,bankName:'Bank Central Asia',accountName:'Fixture Buyer',accountNumber:'012345678900',confirmed:true};
  const bank=(changes={})=>f.merchant(url+'/bank',{...bankBody,...changes},{seller:buyer,method:'POST'});
  const prepareBody=async()=>{const r=await view('bob');return {kind:'prepare_provider_request',requestKey:refundProcessingKey(),bankId:r.processing.bank.id,refundRevision:r.revision,orderRevision:r.orderRevision,evidenceVersion:r.evidenceVersion};};
  const processing=(body,age=0)=>f.merchant(support+'/processing',body,{seller:'bob',claims:refundProcessingClaims(age),method:'POST'});
  const prepare=async()=>processing(await prepareBody());
  return {...f,p,refund,buyer,url,support,store,permission,view,bankBody,bank,prepareBody,processing,prepare};
}
