import test from 'node:test';
import assert from 'node:assert/strict';
import {randomBytes} from 'node:crypto';
import {setupCommerceFixture,fixtureShipping as shipping} from './commerce-fixture.mjs';

const key=()=>randomBytes(16).toString('hex');
async function fixture(t){
  const f=await setupCommerceFixture(t);
  const create=async overrides=>{const r=await f.create(f.input({shipping,...overrides}));assert.equal(r.status,200,r.error);return r.order;};
  const paid=async overrides=>{const order=await create(overrides);const r=await f.paid(order);assert.equal(r.status,200,r.error);return r.order;};
  const detail=(order,options)=>f.merchant('/v1/fulfillment/'+(order.id||order),undefined,options);
  const act=async(order,kind,extra={})=>{const view=await detail(order);assert.equal(view.status,200,view.error);const body={requestKey:key(),revision:view.order.revision,kind,...extra};return {body,...await f.merchant('/v1/fulfillment/'+view.order.id,body,{method:'POST'})};};
  const pickup=async()=>{const order=await paid();assert.equal((await act(order,'accept')).status,200);const r=await act(order,'pickup');assert.equal(r.status,200,r.error);return {order,shipmentId:r.receipt.shipmentId};};
  const bind=async(shipmentId,providerId='biteship_'+shipmentId,data={kind:'status',status:'confirmed'})=>{assert.equal((await f.call('/internal/commerce/shipments/'+shipmentId+'/account',{environment:'sandbox',accountHash:'a'.repeat(64)})).status,200);const r=await f.call('/internal/commerce/shipments/'+shipmentId+'?environment=sandbox');assert.equal(r.status,200,r.error);return f.call('/internal/commerce/shipments/'+shipmentId+'/bind',{environment:'sandbox',verified:true,providerId,reference:r.shipment.reference,data});};
  const webhook=(providerId,data)=>f.call('/internal/commerce/shipping-events',{environment:'sandbox',providerId,data});
  return {...f,create,paid,detail,act,pickup,bind,webhook};
}

test('fulfillment accepts only paid allocated shippable orders, scopes actors, and commits one action and pickup under racing retries',async t=>{
  const f=await fixture(t),order=await f.create();
  assert.equal((await f.act(order,'accept')).status,409);
  assert.equal((await f.detail(order,{seller:'bob'})).status,404);
  await f.event(order,'payment.succeeded',{provider:'doku',verified:true,amount:order.total,currency:'IDR',reference:'fulfill-paid',originalRequestId:order.paymentRequestId,channel:'VIRTUAL_ACCOUNT_BCA',accountNumber:'770011223344'});
  const view=await f.detail(order),body={requestKey:key(),revision:view.order.revision,kind:'accept'};
  const path='/v1/fulfillment/'+order.id,results=await Promise.all([f.merchant(path,body,{method:'POST'}),f.merchant(path,body,{method:'POST'})]);
  assert.deepEqual(results.map(r=>r.status),[200,200]);assert.deepEqual(results[0].receipt,results[1].receipt);
  const next=await f.detail(order);assert.equal(next.order.fulfillmentState,'awaiting_pickup_arrangement');assert(next.order.acceptedAt);
  assert.equal((await f.merchant(path,{...body,kind:'pickup'},{method:'POST'})).status,409);
  const picked=await f.act(order,'pickup');assert.equal(picked.status,200,picked.error);
  assert.equal((await f.act(order,'pickup')).status,409);
  assert.equal((await f.db.prepare("SELECT COUNT(*) AS n FROM commerce_jobs WHERE kind='shipment.create'").first()).n,1);
  const skipped=await f.paid({shipping:{amount:0,skipped:true}});assert.equal((await f.act(skipped,'accept')).status,409);
  const held=await f.paid();await f.db.prepare('UPDATE orders SET payment_review=1 WHERE id=?').bind(held.id).run();assert.equal((await f.act(held,'accept')).status,409);
  assert(!(await f.merchant('/v1/fulfillment')).items.some(item=>item.id===held.id));
  await f.db.prepare("UPDATE seller_memberships SET role='viewer' WHERE auth_user_id='alice'").run();
  assert.equal((await f.act(order,'refresh')).status,403);
});

test('courier inbox retains early callbacks and binding rejects cross-order provider identities without losing history',async t=>{
  const f=await fixture(t),{order,shipmentId}=await f.pickup(),provider='courier_early';
  const early=await f.webhook(provider,{kind:'status',status:'delivered',updatedAt:new Date().toISOString(),waybillId:'FIRST-WAYBILL'});
  assert.equal(early.status,200,early.error);assert.equal(early.matched,false);
  const bound=await f.bind(shipmentId,provider);assert.equal(bound.status,200,bound.error);
  assert.equal((await f.call('/internal/commerce/shipments/'+shipmentId+'/account',{environment:'sandbox',accountHash:'b'.repeat(64)})).status,409);
  await assert.rejects(f.db.prepare('UPDATE commerce_shipments SET provider_account_hash=? WHERE id=?').bind('b'.repeat(64),shipmentId).run(),/immutable_shipment/);
  const view=await f.detail(order);assert.equal(view.order.fulfillmentState,'delivered');assert.equal(view.shipments[0].tracking.waybillId,'FIRST-WAYBILL');
  assert.equal(view.history.length,2);assert.equal((await f.bind(shipmentId,'different_id')).status,409);
  const other=await f.pickup();assert.equal((await f.bind(other.shipmentId,provider)).status,409);
  assert.equal((await f.detail(other.order)).shipments[0].providerId,'');
  assert.equal(await f.stock(),6);
});

test('shipping events preserve progress through stale milestones, returns, cancellations and unsequenced waybill or price changes',async t=>{
  const f=await fixture(t),{order,shipmentId}=await f.pickup(),provider='courier_order';await f.bind(shipmentId,provider);
  const stamp=n=>new Date(Date.now()-120000+n*1000).toISOString();
  for(const data of [{kind:'status',status:'in_transit',updatedAt:stamp(10),waybillId:'WB-NEW'},
    {kind:'status',status:'confirmed',updatedAt:stamp(1),waybillId:'WB-OLD'},
    {kind:'price',price:20000,updatedAt:stamp(12)},{kind:'price',price:5,updatedAt:stamp(11)},
    {kind:'waybill',waybillId:'WB-LATEST',updatedAt:stamp(15)},{kind:'waybill',waybillId:'WB-DELAYED',updatedAt:stamp(14)}])assert.equal((await f.webhook(provider,data)).status,200);
  let view=await f.detail(order);assert.equal(view.order.fulfillmentState,'in_transit');assert.equal(view.shipments[0].actualPrice,20000);assert.equal(view.shipments[0].tracking.waybillId,'WB-LATEST');
  assert.equal(view.canCancel,false);
  await f.webhook(provider,{kind:'status',status:'delivered',updatedAt:stamp(20)});
  await f.webhook(provider,{kind:'status',status:'cancelled'});assert.equal((await f.detail(order)).order.fulfillmentState,'delivered');
  await f.webhook(provider,{kind:'status',status:'return_in_transit',updatedAt:stamp(22)});
  await f.webhook(provider,{kind:'status',status:'returned',updatedAt:stamp(23)});
  await f.webhook(provider,{kind:'status',status:'in_transit',updatedAt:stamp(24)});
  view=await f.detail(order);assert.equal(view.order.fulfillmentState,'returned');assert.equal(view.order.state,'paid');assert.equal(await f.stock(),8,'Courier returns never imply physical restock');
});

test('cancellation is a provider request rather than an instant refund or restock and rebooking uses a new linked shipment reference',async t=>{
  const f=await fixture(t),{order,shipmentId}=await f.pickup(),provider='courier_cancel';await f.bind(shipmentId,provider);
  assert.equal((await f.act(order,'cancel_pickup',{note:'Buyer requested cancellation'})).status,200);
  assert.equal((await f.detail(order)).order.fulfillmentState,'confirmed');assert.equal((await f.act(order,'cancel_pickup',{note:'Try twice'})).status,409);
  await f.webhook(provider,{kind:'status',status:'cancelled',updatedAt:new Date().toISOString()});
  assert.equal((await f.detail(order)).canPickup,true);
  const second=await f.act(order,'pickup');assert.equal(second.status,200,second.error);
  const view=await f.detail(order);assert.equal(view.shipments.length,2);assert.equal(view.shipments[0].sequence,2);assert.notEqual(view.shipments[0].reference,view.shipments[1].reference);
  await f.bind(second.receipt.shipmentId,'new_provider');
  await f.webhook(provider,{kind:'status',status:'picked',updatedAt:new Date(Date.now()+1000).toISOString()});
  assert.equal((await f.detail(order)).order.fulfillmentReview,true);
  assert.equal((await f.detail(order)).order.fulfillmentState,'confirmed');assert.equal(await f.stock(),8);
});

test('tracking refresh rejects stale revisions, corrects undated metadata through provider reads, and pages immutable event history',async t=>{
  const f=await fixture(t),{order,shipmentId}=await f.pickup(),provider='courier_refresh';await f.bind(shipmentId,provider);
  const before=await f.detail(order);await f.webhook(provider,{kind:'status',status:'in_transit'});
  const refresh=(revision,data)=>f.call('/internal/commerce/shipments/'+shipmentId+'/refresh',{environment:'sandbox',providerId:provider,revision,data});
  assert.equal((await refresh(before.order.revision,{kind:'status',status:'confirmed',waybillId:'old'})).status,409);
  assert.equal((await refresh((await f.detail(order)).order.revision,{kind:'status',status:'in_transit',waybillId:'new',price:18001})).status,200);
  for(let n=0;n<51;n++)assert.equal((await f.webhook(provider,{kind:'price',price:18002+n})).status,200);
  const first=await f.detail(order);assert.equal(first.shipments[0].tracking.waybillId,'new');assert.equal(first.shipments[0].actualPrice,18001);
  assert.equal(first.history.length,50);assert(first.historyCursor);
  const next=await f.merchant('/v1/fulfillment/'+order.id+'?before='+encodeURIComponent(first.historyCursor));
  assert(next.history.length>0);assert(!next.history.some(e=>first.history.some(a=>a.id===e.id)));
  await assert.rejects(f.db.prepare("UPDATE commerce_shipping_inbox SET payload_json='{}' WHERE id=?").bind(first.history[0].id).run(),/immutable_shipping_event/);
  assert.equal((await f.webhook(provider,{kind:'status',status:'delivered',link:'javascript:alert(1)'})).status,422);
});

test('shipment jobs require persisted courier results and enforce exclusive leases before execution',async t=>{
  const f=await fixture(t),{order,shipmentId}=await f.pickup();
  const claims=await Promise.all(['worker_a','worker_b'].map(workerId=>f.call('/internal/commerce/jobs/claim',{environment:'sandbox',workerId,kinds:['shipment.create'],limit:1})));
  assert.equal(claims[0].jobs.length+claims[1].jobs.length,1);
  const i=claims[0].jobs.length?0:1,job=claims[i].jobs[0],workerId=['worker_a','worker_b'][i];
  const finish=outcome=>f.call('/internal/commerce/jobs/'+job.id+'/finish',{environment:'sandbox',workerId,leaseToken:job.leaseToken,outcome,result:{recorded:true}});
  assert.equal((await finish('succeeded')).status,409);await f.bind(shipmentId);assert.equal((await finish('succeeded')).status,200);
  assert.equal((await f.detail(order)).jobs[0].state,'succeeded');
  assert.equal((await f.call('/internal/commerce/shipping-events',{environment:'production',providerId:'wrong_env',data:{kind:'status',status:'confirmed'}})).status,403);
});

test('large early callback backlogs drain in order and prevent a tracking read from overwriting pending events',async t=>{
  const f=await fixture(t),{order,shipmentId}=await f.pickup(),provider='courier_backlog';
  for(let n=0;n<55;n++)assert.equal((await f.webhook(provider,{kind:'price',price:19000+n,updatedAt:new Date(Date.now()-120000+n*1000).toISOString()})).status,200);
  await f.bind(shipmentId,provider);
  let view=await f.detail(order);assert.equal(view.shipments[0].state,'queued');
  assert.equal((await f.call('/internal/commerce/shipments/'+shipmentId+'/refresh',{environment:'sandbox',providerId:provider,revision:view.order.revision,data:{kind:'status',status:'confirmed',price:1}})).status,409);
  for(let n=0;n<2;n++)assert.equal((await f.call('/internal/commerce/shipping-events/drain',{environment:'sandbox'})).status,200);
  view=await f.detail(order);assert.equal(view.shipments[0].state,'confirmed');assert.equal(view.shipments[0].actualPrice,19054);
  assert.equal((await f.db.prepare('SELECT COUNT(*) AS n FROM commerce_shipping_inbox WHERE applied_at IS NULL').first()).n,0);
  const date=new Date(Date.now()-60000).toISOString();
  assert.equal((await f.call('/internal/commerce/shipments/'+shipmentId+'/refresh',{environment:'sandbox',providerId:provider,revision:view.order.revision,
    data:{kind:'status',status:'delivered',history:[{kind:'status',status:'picked',updatedAt:date,coordinate:{latitude:-6.2,longitude:106.8},note:'Real provider scan'}]}})).status,200);
  view=await f.detail(order);assert.equal(view.shipments[0].state,'delivered');assert.equal(view.shipments[0].tracking.latestLocation.updatedAt,date);assert.equal(view.shipments[0].tracking.latestLocation.status,'picked');
});

test('different action keys cannot accept twice and incomplete pickup details cannot enter checkout',async t=>{
  const f=await fixture(t),order=await f.paid();const view=await f.detail(order);
  const results=await Promise.all([1,2].map(()=>f.merchant('/v1/fulfillment/'+order.id,{kind:'accept',requestKey:key(),revision:view.order.revision},{method:'POST'})));
  assert.deepEqual(results.map(r=>r.status).sort(),[200,409]);
  const bad=await f.call('/internal/commerce/orders',f.input({shipping:{...shipping,origin:{origin_address:'No contact'}}}));
  assert.equal(bad.status,409);assert.match(bad.error,/Shipping settings/);
});

test('an interleaved callback between shipment and order reads cannot let an older shipment overwrite delivery',async t=>{
  const f=await fixture(t),{order,shipmentId}=await f.pickup(),provider='courier_interleaved';await f.bind(shipmentId,provider);
  let injected=false;
  const wrap=statement=>new Proxy(statement,{get(target,property){
    if(property==='bind')return(...args)=>wrap(target.bind(...args));
    if(property==='first')return async(...args)=>{const row=await target.first(...args);
      if(!injected&&row?.id===shipmentId){injected=true;
        assert.equal((await f.webhook(provider,{kind:'status',status:'delivered',updatedAt:new Date().toISOString()})).status,200);
        const data={kind:'status',status:'picked',updatedAt:new Date(Date.now()-1000).toISOString(),trackingId:'',waybillId:'',link:'',note:'',locationName:'',coordinate:null,proofLink:''};
        await f.db.prepare("INSERT INTO commerce_shipping_inbox(id,commerce_environment,provider_id,source,payload_json,received_at) VALUES (?,'sandbox',?,'webhook',?,?)")
          .bind('f'.repeat(64),provider,JSON.stringify(data),new Date().toISOString()).run();
      }return row;};
    const value=Reflect.get(target,property);return typeof value==='function'?value.bind(target):value;
  }});
  const db=new Proxy(f.db,{get(target,property){if(property==='prepare')return sql=>wrap(target.prepare(sql));const value=Reflect.get(target,property);return typeof value==='function'?value.bind(target):value;}});
  const {drainShippingInbox}=await import('../src/commerce-fulfillment.js');
  const result=await drainShippingInbox({DB:db,APP_ENVIRONMENT:'test',COMMERCE_STORAGE:'d1'},'sandbox',provider);
  assert(injected);assert.equal(result.applied,1);const view=await f.detail(order);assert.equal(view.order.fulfillmentState,'delivered');assert.equal(view.shipments[0].state,'delivered');
});
