import assert from 'node:assert/strict';
import {randomBytes} from 'node:crypto';
import {digitalFixtureFile} from './digital-commerce-fixture.mjs';
import {fixtureShipping} from './commerce-fixture.mjs';
import {digitalDownloadProof} from '../src/commerce-digital.js';
export const key=()=>randomBytes(16).toString('hex');
export async function refundEvidenceFixture(f,{buyer='evidence-buyer',bytes=Buffer.from('The original purchased guide'),skipped=false}={}){
  const file=await digitalFixtureFile(f,{bytes}),other=await digitalFixtureFile(f,{id:'other-guide',sku:'OTHER',bytes:Buffer.from('Another purchased guide')});
  await f.db.prepare("UPDATE products SET title='Second guide' WHERE id='other-guide'").run();
  const created=await f.create(f.input({customer:{name:'Buyer',email:'checkout@example.com',phone:'081234567890',authUserId:buyer},shipping:skipped?{amount:0,skipped:true}:fixtureShipping,
    items:[file.item,other.item,{productId:'tea',quantity:3,expectedPrice:20000,expectedWeightGrams:100},{productId:'mug',quantity:2,expectedPrice:20000,expectedWeightGrams:100}]}));assert.equal(created.status,200,created.error);
  const paid=await f.paid(created.order);assert.equal(paid.status,200,paid.error);const order=paid.order,tea=order.items.find(i=>i.productId==='tea'),mug=order.items.find(i=>i.productId==='mug'),digital=order.items.find(i=>i.productId===file.id);
  const path='/v1/customer/orders/'+order.id+'/refunds',overview=await f.merchant(path,undefined,{seller:buyer});
  const saved=await f.merchant(path,{requestKey:key(),orderRevision:overview.order.revision,reason:'not_as_described',note:'Review the original purchased items.',items:order.items.filter(i=>i.productId!=='mug').map(i=>({orderItemId:i.id,amount:1000})),shippingAmount:skipped?0:1000},{seller:buyer,method:'POST'});assert.equal(saved.status,200,saved.error);const refund=saved.refund;
  const view=async(actor=buyer)=>{const r=await f.merchant(actor===buyer?path+'/'+refund.id:'/v1/commerce/refunds/'+refund.id,undefined,{seller:actor});assert.equal(r.status,200,r.error);return r.refund;};
  const grant=async(item=digital)=>{const url='/v1/customer/orders/'+order.id+'/downloads/'+item.id+'/grants',r=await f.merchant(url,{requestKey:key()},{seller:buyer,method:'POST'});assert.equal(r.status,200,r.error);return url+'/'+r.grant.id;};
  const part=async(prefix,n)=>{const r=await f.mf.dispatchFetch('https://api.fixture.test'+prefix+'/parts/'+n,{headers:{authorization:'Bearer '+await f.merchantToken(buyer)}});assert.equal(r.status,200);
    const proof=await digitalDownloadProof(prefix.split('/').at(-1),n,r.headers.get('x-ezkart-file-challenge'),new Uint8Array(await r.arrayBuffer()));const saved=await f.merchant(prefix+'/parts/'+n+'/receipt',{proof},{seller:buyer,method:'POST'});assert.equal(saved.status,200,saved.error);};
  const deliver=async()=>{
    let shipment;
    for(const kind of ['accept','pickup']){const d=await f.merchant('/v1/fulfillment/'+order.id),r=await f.merchant('/v1/fulfillment/'+order.id,{requestKey:key(),revision:d.order.revision,kind},{method:'POST'});assert.equal(r.status,200,r.error);if(kind==='pickup')shipment=r.receipt.shipmentId;}
    assert.equal((await f.call('/internal/commerce/shipments/'+shipment+'/account',{environment:'sandbox',accountHash:'a'.repeat(64)})).status,200);
    const d=await f.call('/internal/commerce/shipments/'+shipment+'?environment=sandbox'),at=new Date().toISOString();
    assert.equal((await f.call('/internal/commerce/shipments/'+shipment+'/bind',{environment:'sandbox',verified:true,providerId:'fixture_'+shipment,reference:d.shipment.reference,data:{kind:'status',status:'delivered',updatedAt:at}})).status,200);return at;
  };
  const openReturn=async(items=[{orderItemId:tea.id,quantity:2},{orderItemId:mug.id,quantity:1}])=>{
    const url='/v1/returns/orders/'+order.id,d=await f.merchant(url),r=await f.merchant(url,{requestKey:key(),orderRevision:d.order.revision,reason:'damaged',note:'Inspect these original units.',items},{method:'POST'});assert.equal(r.status,200,r.error);return r.id;
  };
  const returnAction=async(id,kind,extra={})=>{const url='/v1/returns/'+id,d=await f.merchant(url),r=await f.merchant(url,{requestKey:key(),revision:d.revision,orderRevision:d.order.revision,kind,message:'The return was reviewed.',...extra},{method:'POST'});assert.equal(r.status,200,r.error);return r;};
  return {...f,buyer,file,other,order,tea,mug,digital,refund,path,view,grant,part,deliver,openReturn,returnAction};
}
