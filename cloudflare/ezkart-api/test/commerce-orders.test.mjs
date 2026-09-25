import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomBytes} from 'node:crypto';
import {expireCommerceOrders} from '../src/commerce-orders.js';
import {setupCommerceFixture as setup, customer, digest} from './commerce-fixture.mjs';


async function editorFixture(f, id = 'tea') {
  const imageUploadIds = [];
  for (let n = 1; n <= 3; n++) {
    const mediaId = `media_${id}_${n}`;
    imageUploadIds.push(mediaId);
    await f.db.prepare("INSERT INTO media_uploads(id,seller_id,r2_key,mime_type,size_bytes,created_by_auth_user_id,created_at) VALUES (?,'seller_alice',?,'image/png',1,'alice','now')").bind(mediaId, mediaId).run();
  }
  const product = (await f.merchant('/v1/catalog')).products.find(product => product.id === id);
  return {...product, imageUploadIds};
}

async function latePaidOrder(f, items, shipping = {amount:0,skipped:true}) {
  const created=await f.create(f.input({items,shipping}));assert.equal(created.status,200,created.error);
  assert.equal((await f.event(created.order,'payment.expired',{verified:true})).status,200);
  const paid=await f.paid(created.order);assert.equal(paid.status,200,paid.error);assert.equal(paid.order.fulfillmentState,'stock_review');return paid.order;
}
async function stockReviewInput(f, order) {
  const review=await f.merchant('/v1/inventory/reviews/'+order.id);assert.equal(review.status,200,review.error);
  return {requestKey:randomBytes(16).toString('hex'),revision:review.order.revision,confirmed:true,note:'Physical stock checked in aisle A',
    items:review.items.map(item=>({orderItemId:item.orderItemId,productRevision:item.current?.revision||1}))};
}

// Delivery here is a local state fixture. It is not evidence of a provider delivery.
async function returnFixture(f,overrides={}) {
  const created=await f.create(f.input(overrides));assert.equal(created.status,200,created.error);
  const paid=await f.paid(created.order);assert.equal(paid.status,200,paid.error);
  await f.db.prepare("UPDATE orders SET fulfillment_state='delivered' WHERE id=?").bind(created.order.id).run();
  return paid.order;
}
async function returnRequest(f,order,quantity=2,extra={}) {
  const view=await f.merchant('/v1/returns/orders/'+order.id);assert.equal(view.status,200,view.error);
  return {requestKey:randomBytes(16).toString('hex'),orderRevision:view.order.revision,reason:'damaged',note:'The package arrived with damaged goods.',
    items:view.items.map(item=>({orderItemId:item.orderItemId,quantity})),...extra};
}
async function openReturn(f,order,quantity=2) {
  const result=await f.merchant('/v1/returns/orders/'+order.id,await returnRequest(f,order,quantity),{method:'POST'});assert.equal(result.status,200,result.error);return result;
}
async function actReturn(f,id,kind,extra={}) {
  const detail=await f.merchant('/v1/returns/'+id);assert.equal(detail.status,200,detail.error);
  const body={requestKey:randomBytes(16).toString('hex'),revision:detail.revision,orderRevision:detail.order.revision,kind,message:'Return to the store with the order reference.',...extra};
  return {body,result:await f.merchant('/v1/returns/'+id,body,{method:'POST'})};
}

test('return ownership binds verified guests once and preserves checkout identity and original snapshots',async t=>{
  const f=await setup(t),order=await returnFixture(f),path='/v1/customer/orders/'+order.id+'/returns';
  assert.equal((await f.merchant(path,undefined,{seller:'buyer',email:customer.email})).status,404,'A JWT alone cannot claim a guest by email');
  const claim=(id,email='orders@example.test',environment='sandbox')=>f.call('/internal/commerce/orders/'+order.id+'/claim',{environment,customer:{id,email}});
  assert.equal((await claim('buyer','wrong@example.test')).status,404);
  assert.equal((await claim('buyer','orders@example.test','production')).status,403);
  const race=await Promise.all([claim('buyer'),claim('other')]);assert.deepEqual(race.map(r=>r.status).sort(),[200,404]);
  const winner=race[0].status===200?'buyer':'other';assert.equal((await claim(winner)).status,200);
  const own=await f.merchant(path,undefined,{seller:winner});assert.equal(own.status,200,own.error);assert.equal(own.canCreate,true);
  await assert.rejects(f.db.prepare('UPDATE commerce_order_owners SET auth_user_id=? WHERE order_id=?').bind('hijack',order.id).run(),/immutable_owner/);
  await assert.rejects(f.db.prepare("UPDATE orders SET customer_snapshot_json='{}' WHERE id=?").bind(order.id).run(),/immutable_customer_snapshot/);
  const identified=await returnFixture(f,{customer:{...customer,authUserId:'buyer'}}),identityPath='/v1/customer/orders/'+identified.id+'/returns';
  assert.equal((await f.merchant(identityPath,undefined,{seller:'buyer'})).status,200);
  assert.equal((await f.call('/internal/commerce/orders/'+identified.id+'/claim',{environment:'sandbox',customer:{id:'other',email:customer.email}})).status,404);
  assert.equal((await f.merchant(identityPath,undefined,{seller:'other'})).status,404);
});

test('returns require paid consumed delivered units, enforce seller and viewer access, and release declined or withdrawn requests',async t=>{
  const f=await setup(t),created=await f.create(f.input()),order=created.order,request=await returnRequest(f,order);
  const path='/v1/returns/orders/'+order.id;
  assert.equal((await f.merchant(path,request,{method:'POST'})).status,409);
  await f.paid(order);assert.equal((await f.merchant(path)).canCreate,false);
  await f.db.prepare("UPDATE orders SET fulfillment_state='delivered' WHERE id=?").bind(order.id).run();
  let opened=await openReturn(f,order);assert.equal(opened.state,'requested');
  assert.equal((await f.merchant('/v1/returns/'+opened.id,undefined,{seller:'bob'})).status,404);
  assert.equal((await f.merchant('/v1/returns',undefined,{seller:'bob'})).items.length,0);
  await f.db.prepare("UPDATE seller_memberships SET role='viewer' WHERE auth_user_id='alice'").run();
  assert.equal((await f.merchant('/v1/returns/'+opened.id)).canApprove,false);
  assert.equal((await actReturn(f,opened.id,'approve')).result.status,403);
  await f.db.prepare("UPDATE seller_memberships SET role='owner' WHERE auth_user_id='alice'").run();
  assert.equal((await actReturn(f,opened.id,'decline')).result.status,200);
  assert.equal((await f.merchant(path)).items[0].availableToReturn,2);
  opened=await openReturn(f,order);assert.equal((await actReturn(f,opened.id,'withdraw')).result.status,200);
  assert.equal((await f.merchant(path)).items[0].availableToReturn,2);
  const late=await latePaidOrder(f,[{productId:'mug',quantity:2,expectedPrice:20000}]);
  await f.db.prepare("UPDATE orders SET fulfillment_state='delivered' WHERE id=?").bind(late.id).run();
  assert.equal((await f.merchant('/v1/returns/orders/'+late.id)).canCreate,false,'Unrecovered late payments did not consume inventory');
});

test('return requests are retryable, quantity bounded across concurrent cases, and paginated',async t=>{
  const f=await setup(t),order=await returnFixture(f),path='/v1/returns/orders/'+order.id,input=await returnRequest(f,order);
  const post=body=>f.merchant(path,body,{method:'POST'});
  const results=await Promise.all([post(input),post(input)]);assert.deepEqual(results.map(r=>r.status),[200,200]);assert.equal(results[0].id,results[1].id);
  assert.equal((await post({...input,note:'Changed request'})).status,409);
  assert.equal((await post({...input,requestKey:randomBytes(16).toString('hex')})).status,409);
  assert.equal((await f.db.prepare('SELECT COUNT(*) AS n FROM commerce_returns').first()).n,1);
  await actReturn(f,results[0].id,'decline');
  const input2=await returnRequest(f,order,1),input3={...input2,requestKey:randomBytes(16).toString('hex')};
  const race=await Promise.all([post(input2),post(input3)]);assert.deepEqual(race.map(r=>r.status).sort(),[200,409]);
  const more=await openReturn(f,order,1);assert.equal(more.status,200);
  const page1=await f.merchant('/v1/returns?state=all&limit=2'),page2=await f.merchant('/v1/returns?state=all&limit=2&cursor='+encodeURIComponent(page1.nextCursor));
  assert.equal(page1.items.length,2);assert.equal(page2.items.length,1);assert.equal(new Set([...page1.items,...page2.items].map(r=>r.id)).size,3);
  assert.equal((await f.merchant('/v1/returns?state=unknown')).status,422);
});

test('return inspections separate received and sellable units, restore stock once, and keep money and customer-private notes unchanged',async t=>{
  const f=await setup(t),order=await returnFixture(f,{customer:{...customer,authUserId:'buyer'},items:[{productId:'tea',quantity:3,expectedPrice:20000}]}),opened=await openReturn(f,order,3);
  const customerPath='/v1/customer/orders/'+order.id+'/returns/'+opened.id;
  assert.equal((await f.merchant(customerPath,{}, {seller:'buyer',method:'POST'})).status,403);
  assert.equal((await actReturn(f,opened.id,'approve')).result.status,200);
  let detail=await f.merchant('/v1/returns/'+opened.id),item=detail.items[0];
  const first=await actReturn(f,opened.id,'inspect',{confirmed:true,privateNote:'Warehouse A private bin 9',items:[{orderItemId:item.orderItemId,received:2,restocked:1,productRevision:item.current.revision}]});
  assert.equal(first.result.status,200,first.result.error);assert.equal(first.result.receipt.state,'receiving');assert.equal(await f.stock(),8);
  const replay=await f.merchant('/v1/returns/'+opened.id,first.body,{method:'POST'});assert.deepEqual(replay.receipt,first.result.receipt);assert.equal(await f.stock(),8);
  assert.equal((await f.merchant('/v1/returns/'+opened.id,{...first.body,privateNote:'different'},{method:'POST'})).status,409);
  detail=await f.merchant('/v1/returns/'+opened.id);assert.equal(detail.items[0].remaining,1);assert.equal(detail.items[0].restocked,1);
  const publicView=await f.merchant(customerPath,undefined,{seller:'buyer'});assert.equal(publicView.status,200);
  assert(!JSON.stringify(publicView).includes('private bin'));assert.equal(publicView.items[0].current,undefined);assert.equal(publicView.actions.at(-1).receipt,undefined);
  const second=await actReturn(f,opened.id,'inspect',{confirmed:true,privateNote:'Last unit is damaged and kept out of stock',items:[{orderItemId:item.orderItemId,received:1,restocked:0}]});
  assert.equal(second.result.status,200,second.result.error);assert.equal(second.result.receipt.state,'inspected');assert.equal(await f.stock(),8);
  const fresh=(await f.call('/internal/commerce/orders/'+order.id+'?seller=seller_alice&environment=sandbox')).order;assert.equal(fresh.state,'paid');assert.equal(fresh.fulfillmentState,'delivered');
  const movements=await f.db.prepare("SELECT * FROM inventory_movements WHERE reason='return_restock'").all();assert.equal(movements.results.length,1);assert.equal(movements.results[0].quantity_after-movements.results[0].quantity_before,1);
  const jobs=await f.call('/internal/commerce/jobs/claim',{environment:'sandbox',workerId:'return_notifications',kinds:['notification.return_updated']});assert.equal(jobs.status,200,jobs.error);assert.equal(jobs.jobs.length,4);
  await assert.rejects(f.db.prepare("UPDATE commerce_return_inspections SET restocked_quantity=2").run(),/return_immutable/);
  await assert.rejects(f.db.prepare("DELETE FROM commerce_return_actions").run(),/return_immutable/);
});

test('closing partial returns releases only unreceived units, and a completed inspection cannot receive extra lines',async t=>{
  const f=await setup(t),order=await returnFixture(f,{items:[{productId:'tea',quantity:3,expectedPrice:20000},{productId:'mug',quantity:3,expectedPrice:20000}]}),opened=await openReturn(f,order,3);
  await actReturn(f,opened.id,'approve');let detail=await f.merchant('/v1/returns/'+opened.id),item=detail.items.find(i=>i.productId==='tea'),other=detail.items.find(i=>i.productId==='mug');
  const first=await actReturn(f,opened.id,'inspect',{confirmed:true,privateNote:'One damaged unit arrived',items:[{orderItemId:item.orderItemId,received:1,restocked:0}]});assert.equal(first.result.status,200,first.result.error);
  await assert.rejects(f.db.prepare('INSERT INTO commerce_return_inspections VALUES (?,?,?,?,1,1)').bind(first.result.receipt.id,opened.id,'seller_alice',other.orderItemId).run(),/return_quantity_exceeded/);
  assert.equal((await actReturn(f,opened.id,'close')).result.status,200);
  const view=await f.merchant('/v1/returns/orders/'+order.id);assert.equal(view.items.find(i=>i.productId==='tea').availableToReturn,2);assert.equal(view.items.find(i=>i.productId==='mug').availableToReturn,3);
  const next=await openReturn(f,order,2);assert.equal(next.status,200);
  assert.equal((await f.merchant('/v1/returns/'+opened.id)).canInspect,false);assert.equal(await f.stock(),7);
});

test('return inspections reject stale stock and roll back all lines if any original option is unavailable',async t=>{
  const f=await setup(t),order=await returnFixture(f,{items:[{productId:'tea',quantity:2,expectedPrice:20000},{productId:'mug',quantity:2,expectedPrice:20000}]}),opened=await openReturn(f,order);
  await actReturn(f,opened.id,'approve');const detail=await f.merchant('/v1/returns/'+opened.id);
  const input={confirmed:true,privateNote:'Both units verified',items:detail.items.map(i=>({orderItemId:i.orderItemId,received:2,restocked:2,productRevision:i.current.revision}))};
  await f.db.prepare("UPDATE products SET stock_quantity=7 WHERE id='tea'").run();
  assert.equal((await actReturn(f,opened.id,'inspect',input)).result.status,409);assert.equal(await f.stock('mug'),8);
  const fresh=await f.merchant('/v1/returns/'+opened.id),tea=fresh.items.find(i=>i.productId==='tea'),mug=fresh.items.find(i=>i.productId==='mug');
  await f.db.prepare("INSERT INTO product_variants(id,seller_id,product_id,name,sku,price_amount,stock_quantity,weight_grams,sort_order,created_at,updated_at) VALUES ('new-mug','seller_alice','mug','Replacement','NEW',20000,10,100,1,'now','now')").run();
  // Exercise the database guard directly after a hypothetical stale preflight.
  await assert.rejects(f.db.batch([
    f.db.prepare("INSERT INTO commerce_return_actions VALUES ('atomic-fixture','seller_alice',?,'direct-race-key','hash',?,?,'inspect','inspected','merchant','alice','','Private inspection note','{}','now')").bind(opened.id,fresh.revision,fresh.order.revision),
    f.db.prepare("INSERT INTO commerce_return_inspections VALUES ('atomic-fixture',?,'seller_alice',?,2,2)").bind(opened.id,tea.orderItemId),
    f.db.prepare("INSERT INTO commerce_return_inspections VALUES ('atomic-fixture',?,'seller_alice',?,2,2)").bind(opened.id,mug.orderItemId),
  ]),/return_original_option_missing/);
  assert.equal(await f.stock(),7);assert.equal((await f.db.prepare("SELECT COUNT(*) AS n FROM inventory_movements WHERE reference_id='atomic-fixture'").first()).n,0);
  const saved=await actReturn(f,opened.id,'inspect',{...input,items:[{orderItemId:tea.orderItemId,received:2,restocked:2,productRevision:tea.current.revision},{orderItemId:mug.orderItemId,received:2,restocked:0}]});
  assert.equal(saved.result.status,200,saved.result.error);assert.equal(await f.stock(),9);
  assert.equal((await f.db.prepare("SELECT stock_quantity FROM product_variants WHERE id='new-mug'").first()).stock_quantity,10);
  const staleCount={requestKey:randomBytes(16).toString('hex'),kind:'count',note:'Old count',items:[{productId:'tea',variantId:'',revision:tea.current.revision,quantity:7}]};
  assert.equal((await f.merchant('/v1/inventory/adjustments',staleCount,{method:'POST'})).status,409);assert.equal(await f.stock(),9);
});

test('returns restore hidden archived options by original identity without inflating visible parent stock',async t=>{
  const f=await setup(t);
  await f.db.prepare("INSERT INTO product_variants(id,seller_id,product_id,name,sku,price_amount,stock_quantity,weight_grams,sort_order,created_at,updated_at) VALUES ('green','seller_alice','tea','Green','GREEN',20000,5,100,1,'now','now')").run();
  const order=await returnFixture(f,{items:[{productId:'tea',variantId:'green',quantity:2,expectedPrice:20000}]}),opened=await openReturn(f,order);
  await actReturn(f,opened.id,'approve');
  await f.db.prepare("UPDATE products SET status='archived' WHERE id='tea'").run();
  await f.db.prepare("UPDATE product_variants SET name='Renamed',sku='NEW',options_json='{\"hidden\":true}' WHERE id='green'").run();
  const detail=await f.merchant('/v1/returns/'+opened.id),item=detail.items[0];assert.equal(item.sku,'GREEN');assert.equal(item.current.sku,'NEW');
  const saved=await actReturn(f,opened.id,'inspect',{confirmed:true,privateNote:'Saleable after inspection',items:[{orderItemId:item.orderItemId,received:2,restocked:2,productRevision:item.current.revision}]});
  assert.equal(saved.result.status,200,saved.result.error);assert.equal(await f.stock(),0);assert.equal((await f.db.prepare("SELECT stock_quantity FROM product_variants WHERE id='green'").first()).stock_quantity,5);
});

test('customer return writes stay bound to the original buyer and case, and withdrawal releases only its request',async t=>{
  const f=await setup(t),order=await returnFixture(f,{customer:{...customer,authUserId:'buyer'}}),path='/v1/customer/orders/'+order.id+'/returns';
  const input=await returnRequest(f,order),post=(target,body,seller='buyer')=>f.merchant(target,body,{seller,method:'POST'});
  assert.equal((await post(path,input,'other')).status,404);
  const opened=await post(path,input);assert.equal(opened.status,200,opened.error);
  assert.equal((await post(path,input)).id,opened.id);
  assert.equal((await post(path,{...input,reason:'delivery_failed',requestKey:randomBytes(16).toString('hex')})).status,422);
  const result=await post(path+'/'+opened.id,{requestKey:randomBytes(16).toString('hex'),revision:opened.revision,orderRevision:opened.order.revision,kind:'withdraw',message:'I would like to keep the product.'});
  assert.equal(result.status,200,result.error);assert.equal(result.receipt.state,'withdrawn');assert.equal((await f.merchant(path,undefined,{seller:'buyer'})).items[0].availableToReturn,2);
  const other=await returnFixture(f,{customer:{...customer,authUserId:'buyer'}});
  assert.equal((await f.merchant('/v1/customer/orders/'+other.id+'/returns/'+opened.id,undefined,{seller:'buyer'})).status,404);
  const signedOnly=await f.merchant('/internal/commerce/orders/'+order.id+'/claim',{environment:'sandbox',customer:{id:'buyer',email:customer.email}},{seller:'buyer',method:'POST'});assert.equal(signedOnly.status,401);
});

test('return history is bounded and paginated for store and customer even across many partial inspections',async t=>{
  const f=await setup(t);await f.db.prepare("UPDATE products SET stock_quantity=100 WHERE id='tea'").run();
  const order=await returnFixture(f,{customer:{...customer,authUserId:'buyer'},items:[{productId:'tea',quantity:60,expectedPrice:20000}]}),opened=await openReturn(f,order,60);
  await actReturn(f,opened.id,'approve');
  for(let n=0;n<51;n++){const result=await actReturn(f,opened.id,'inspect',{confirmed:true,privateNote:'Private receipt '+n,items:[{orderItemId:opened.items[0].orderItemId,received:1,restocked:0}]});assert.equal(result.result.status,200,result.result.error);}
  const merchantPath='/v1/returns/'+opened.id,customerPath='/v1/customer/orders/'+order.id+'/returns/'+opened.id;
  for(const [target,seller] of [[merchantPath,'alice'],[customerPath,'buyer']]){
    const first=await f.merchant(target,undefined,{seller});assert.equal(first.actions.length,50);assert(first.historyCursor);
    const second=await f.merchant(target+'?before='+first.historyCursor,undefined,{seller});assert.equal(second.actions.length,2);assert.equal(second.historyCursor,null);
    assert.equal(new Set([...first.actions,...second.actions].map(action=>action.id)).size,52);assert.equal(first.items[0].received,51);
    if(seller==='buyer')assert(!JSON.stringify([first,second]).includes('Private receipt'));
  }
  assert.equal((await f.merchant(merchantPath+'?before=NaN')).status,422);assert.equal(await f.stock(),40);
});

test('stock reviews recover a late paid order once, keep released holds immutable and protect other checkouts',async t=>{
  const f=await setup(t),order=await latePaidOrder(f,[{productId:'tea',quantity:3,expectedPrice:20000},{productId:'mug',quantity:2,expectedPrice:20000}],
    {amount:10000,skipped:false,courierCode:'jne',serviceCode:'reg',origin:{address:'Origin fixture'},destination:{address:'Destination fixture'}});
  const pending=(await f.create(f.input({items:[{productId:'tea',quantity:6,expectedPrice:20000}]}))).order;
  const request=await stockReviewInput(f,order),path='/v1/inventory/reviews/'+order.id;
  const preview=await f.merchant(path);assert.equal(preview.canResolve,true);assert.equal(preview.items.find(item=>item.productId==='tea').current.available,4);
  const outcomes=await Promise.all(Array.from({length:4},()=>f.merchant(path,request,{method:'POST'})));
  assert(outcomes.every(result=>result.status===200),JSON.stringify(outcomes));assert.equal(new Set(outcomes.map(result=>result.receipt.id)).size,1);
  assert.equal(await f.stock(),7);assert.equal(await f.stock('mug'),8);
  assert.equal((await f.db.prepare("SELECT COUNT(*) AS n FROM inventory_reservations WHERE order_id=? AND state='released'").bind(order.id).first()).n,2);
  assert.equal((await f.db.prepare('SELECT COUNT(*) AS n FROM commerce_stock_resolutions').first()).n,1);
  assert.equal((await f.db.prepare('SELECT COUNT(*) AS n FROM commerce_stock_allocations').first()).n,2);
  assert.equal((await f.db.prepare("SELECT COUNT(*) AS n FROM inventory_movements WHERE reason='late_payment_allocation'").first()).n,2);
  assert.equal((await f.db.prepare("SELECT COUNT(*) AS n FROM commerce_jobs WHERE kind='notification.stock_recovered'").first()).n,1);
  const jobs=await f.call('/internal/commerce/jobs/claim',{environment:'sandbox',workerId:'stock_notifications',kinds:['notification.stock_recovered']});
  assert.equal(jobs.status,200,jobs.error);assert.equal(jobs.jobs.length,1);assert.equal(jobs.jobs[0].data.resolutionId,outcomes[0].receipt.id);
  const after=await f.merchant(path);assert.equal(after.canResolve,false);assert.equal(after.order.fulfillmentState,'awaiting_acceptance');assert.equal(after.receipt.id,outcomes[0].receipt.id);
  assert.equal((await f.merchant('/v1/inventory/reviews')).items.length,0);
  assert.equal((await f.merchant(path,{...request,note:'Changed replay content'},{method:'POST'})).status,409);
  assert.equal((await f.merchant(path,{...request,requestKey:randomBytes(16).toString('hex')},{method:'POST'})).status,409);
  assert.equal((await f.paid(order)).status,200);assert.equal(await f.stock(),7,'A later provider replay cannot allocate again');
  assert.equal((await f.paid(pending)).status,200);assert.equal(await f.stock(),1,'Another buyer retains every reserved unit');
  await assert.rejects(f.db.prepare("UPDATE commerce_stock_resolutions SET note='rewrite'").run(),/stock_review_immutable/);
  await assert.rejects(f.db.prepare('DELETE FROM commerce_stock_allocations').run(),/stock_review_immutable/);
});

test('stock reviews reject missing lines, stale versions, payment concerns and cross-seller or viewer writes',async t=>{
  const f=await setup(t),order=await latePaidOrder(f,[{productId:'tea',quantity:3,expectedPrice:20000},{productId:'mug',quantity:2,expectedPrice:20000}]);
  const path='/v1/inventory/reviews/'+order.id,request=await stockReviewInput(f,order);
  const post=body=>f.merchant(path,body,{method:'POST'});
  assert.equal((await post({...request,items:request.items.slice(1)})).status,422);
  assert.equal((await post({...request,confirmed:false})).status,422);
  assert.equal((await post({...request,note:''})).status,422);
  assert.equal((await f.merchant(path,undefined,{seller:'bob'})).status,404);
  assert.equal((await f.merchant(path,request,{seller:'bob',method:'POST'})).status,404);
  assert.equal((await f.merchant('/v1/inventory/reviews',undefined,{seller:'bob'})).items.length,0);
  await f.db.prepare("UPDATE products SET stock_quantity=11 WHERE id='tea'").run();
  assert.equal((await post(request)).status,409);assert.equal(await f.stock('mug'),10);
  let current=await stockReviewInput(f,order);
  await f.db.prepare("UPDATE seller_memberships SET role='viewer' WHERE auth_user_id='alice'").run();
  assert.equal((await post(current)).status,403);assert.equal((await f.merchant(path)).canResolve,false);
  await f.db.prepare("UPDATE seller_memberships SET role='owner' WHERE auth_user_id='alice'").run();
  assert.equal((await f.paid(order,{reference:'second-real-capture'})).status,200);
  current=await stockReviewInput(f,order);assert.equal((await post(current)).status,409);
  assert.match((await f.merchant(path)).reason,/payment review/);
  assert.equal((await f.db.prepare('SELECT COUNT(*) AS n FROM commerce_stock_resolutions').first()).n,0);
  assert.equal((await f.db.prepare('SELECT COUNT(*) AS n FROM commerce_stock_allocations').first()).n,0);
});

test('racing stock reviews cannot consume the same last units and insufficient lines roll back the entire order',async t=>{
  const f=await setup(t),items=[{productId:'tea',quantity:6,expectedPrice:20000},{productId:'mug',quantity:2,expectedPrice:20000}];
  const orders=[await latePaidOrder(f,items),await latePaidOrder(f,items)];
  const page1=await f.merchant('/v1/inventory/reviews?limit=1');assert.equal(page1.items.length,1);assert(page1.nextCursor);
  const page2=await f.merchant('/v1/inventory/reviews?limit=1&cursor='+encodeURIComponent(page1.nextCursor));assert.equal(page2.items.length,1);assert.notEqual(page1.items[0].id,page2.items[0].id);
  const inputs=await Promise.all(orders.map(order=>stockReviewInput(f,order)));
  const results=await Promise.all(orders.map((order,index)=>f.merchant('/v1/inventory/reviews/'+order.id,inputs[index],{method:'POST'})));
  assert.deepEqual(results.map(result=>result.status).sort(),[200,409]);assert.equal(await f.stock(),4);assert.equal(await f.stock('mug'),8);
  assert.equal((await f.db.prepare('SELECT COUNT(*) AS n FROM commerce_stock_allocations').first()).n,2);
  assert.equal((await f.merchant('/v1/inventory/reviews')).items.length,1);
  // Directly exercise the database stock guard after a stale preflight. Even
  // an earlier sufficient line and its audit movement roll back together.
  const loser=orders[results.findIndex(result=>result.status===409)],fresh=await f.merchant('/v1/inventory/reviews/'+loser.id);
  const mug=fresh.items.find(item=>item.productId==='mug'),tea=fresh.items.find(item=>item.productId==='tea');
  await assert.rejects(f.db.batch([
    f.db.prepare("INSERT INTO commerce_stock_resolutions(id,seller_id,order_id,request_key,request_hash,order_revision,actor_auth_user_id,note,receipt_json,created_at) VALUES ('invalid-allocation','seller_alice',?,'direct-guard-fixture','hash',?,'alice','Direct race guard fixture','{}','now')").bind(loser.id,fresh.order.revision),
    ...[mug,tea].map(item=>f.db.prepare("INSERT INTO commerce_stock_allocations VALUES ('invalid-allocation','seller_alice',?,?,?,?)").bind(item.orderItemId,item.productId,item.variantId,item.quantity)),
  ]),/commerce_insufficient_stock/);
  assert.equal(await f.stock('mug'),8);assert.equal((await f.db.prepare("SELECT COUNT(*) AS n FROM inventory_movements WHERE reference_id='invalid-allocation'").first()).n,0);
  assert.equal((await f.db.prepare("SELECT COUNT(*) AS n FROM commerce_stock_resolutions WHERE id='invalid-allocation'").first()).n,0);
});

test('stock reviews keep original option identity across catalog changes and never silently substitute another SKU',async t=>{
  const f=await setup(t);
  await f.db.prepare("INSERT INTO product_variants(id,seller_id,product_id,name,sku,price_amount,stock_quantity,weight_grams,sort_order,created_at,updated_at) VALUES ('green','seller_alice','tea','Green tea','GREEN',20000,5,100,1,'now','now')").run();
  const order=await latePaidOrder(f,[{productId:'tea',variantId:'green',quantity:3,expectedPrice:20000}]),path='/v1/inventory/reviews/'+order.id;
  await f.db.prepare("UPDATE products SET status='archived' WHERE id='tea'").run();
  await f.db.prepare("UPDATE product_variants SET name='Renamed green',sku='NEW-GREEN',price_amount=25000,options_json='{\"hidden\":true}' WHERE id='green'").run();
  const review=await f.merchant(path);assert.equal(review.canResolve,true);assert.equal(review.items[0].sku,'GREEN');assert.equal(review.items[0].current.sku,'NEW-GREEN');
  const result=await f.merchant(path,await stockReviewInput(f,order),{method:'POST'});assert.equal(result.status,200,result.error);
  assert.equal((await f.db.prepare("SELECT stock_quantity FROM product_variants WHERE id='green'").first()).stock_quantity,2);assert.equal(await f.stock(),0,'The hidden option is not added to the visible parent total');
  const missing=await latePaidOrder(f,[{productId:'mug',quantity:2,expectedPrice:20000}]);
  await f.db.prepare("INSERT INTO product_variants(id,seller_id,product_id,name,sku,price_amount,stock_quantity,weight_grams,sort_order,created_at,updated_at) VALUES ('new-mug','seller_alice','mug','New option','NEW-MUG',20000,10,100,1,'now','now')").run();
  const missingPath='/v1/inventory/reviews/'+missing.id,missingReview=await f.merchant(missingPath);assert.equal(missingReview.canResolve,false);assert.equal(missingReview.items[0].current,null);
  assert.equal((await f.merchant(missingPath,await stockReviewInput(f,missing),{method:'POST'})).status,409);
  assert.equal((await f.db.prepare("SELECT stock_quantity FROM product_variants WHERE id='new-mug'").first()).stock_quantity,10);
});

test('merchant saves reject missing and stale revisions and cannot overwrite stock sold during editing', async t => {
  const f = await setup(t), original = await editorFixture(f);
  assert.equal((await f.merchant('/v1/products/tea', {...original, revision: null})).status, 409);
  const order = (await f.create(f.input())).order;
  assert.equal((await f.paid(order)).status, 200);
  const rejected = await f.merchant('/v1/products/tea', {...original, name: 'Old draft'});
  assert.equal(rejected.status, 409); assert.equal(rejected.code, 'catalog_revision_conflict');
  assert.equal(await f.stock(), 8);
  const latest = (await f.merchant('/v1/catalog')).products.find(product => product.id === 'tea');
  assert(latest.revision > original.revision);
  const outcomes = await Promise.all(['Editor one', 'Editor two'].map(name => f.merchant('/v1/products/tea', {...latest, imageUploadIds: original.imageUploadIds, name})));
  assert.deepEqual(outcomes.map(result => result.status).sort(), [200, 409]);
  assert.equal((await f.db.prepare("SELECT COUNT(*) AS n FROM seller_events WHERE event_type='product.updated'").first()).n, 1, 'A conflicting save leaves no partial audit or product changes');
  assert.equal(await f.stock(), 8);
  await assert.rejects(f.db.batch([
    f.db.prepare("INSERT INTO seller_events(id,seller_id,event_type,entity_type,entity_id,payload_json,created_at) VALUES ('stale','seller_alice','product.updated','product','tea',?,'now')").bind(JSON.stringify({expectedRevision: original.revision})),
    f.db.prepare("UPDATE products SET stock_quantity=999 WHERE id='tea'"),
  ]), /catalog_revision_conflict/, 'The database guards races after the preflight read');
  assert.equal(await f.stock(), 8);
  assert.equal((await f.merchant('/v1/products/tea', undefined, {method: 'DELETE'})).status, 409, 'Order history is archived rather than deleted');
  assert.equal((await f.merchant('/v1/products/tea/status', {status: 'archived'}, {method: 'PATCH'})).status, 200);
});

test('editing, reordering and swapping variant SKUs preserves holds and rolls back invalid changes', async t => {
  const f = await setup(t), original = await editorFixture(f);
  const variants = ['green', 'black'].map(id => ({id, name: id, sku: id.toUpperCase(), price: 20000, stock: 4, weightGrams: 100, options: [{option: 'Tea', value: id}]}));
  let result = await f.merchant('/v1/products/tea', {...original, variants});
  assert.equal(result.status, 200, result.error);
  let editable = {...result.product, imageUploadIds: original.imageUploadIds};
  const initial = await f.db.prepare("SELECT id,created_at,sort_order FROM product_variants WHERE product_id='tea' ORDER BY id").all();
  const order = (await f.create(f.input({items: [{productId: 'tea', variantId: 'green', quantity: 3, expectedPrice: 20000}]}))).order;
  assert(order);
  const reordered = [{...variants[1], sku: 'GREEN'}, {...variants[0], sku: 'BLACK'}];
  result = await f.merchant('/v1/products/tea', {...editable, name: 'Freshly renamed tea', variants: reordered});
  assert.equal(result.status, 200, result.error);
  assert.deepEqual(result.product.variants.map(variant => variant.id), ['black', 'green']);
  assert.deepEqual((await f.db.prepare("SELECT id,created_at,sort_order FROM product_variants WHERE product_id='tea' ORDER BY id").all()).results, initial.results);
  assert.equal((await f.db.prepare("SELECT state FROM inventory_reservations WHERE order_id=?").bind(order.id).first()).state, 'reserved');
  const publicProduct = await f.mf.dispatchFetch('https://api.fixture.test/v1/storefront/products?ids=tea');
  assert.equal((await publicProduct.json()).products[0].variantId, 'black', 'Default checkout follows merchant display order');
  editable = {...result.product, imageUploadIds: original.imageUploadIds};
  for (const changes of [
    {variants: [reordered[0]]},
    {variants: reordered.map(variant => ({...variant, stock: 1}))},
    {type: 'digital'},
  ]) {
    const invalid = await f.merchant('/v1/products/tea', {...editable, name: 'Should roll back', ...changes});
    assert.equal(invalid.status, 409, invalid.error);
    const after = (await f.merchant('/v1/catalog')).products.find(product => product.id === 'tea');
    assert.equal(after.name, editable.name); assert.equal(after.revision, editable.revision);
    assert.deepEqual(after.variants, editable.variants);
  }
  assert.equal((await f.paid(order)).status, 200);
  assert.equal((await f.db.prepare("SELECT stock_quantity FROM product_variants WHERE id='green'").first()).stock_quantity, 1);
  assert.equal((await f.merchant('/v1/products/tea', editable)).status, 409, 'Variant sales invalidate parent editor revisions');
  const current = (await f.merchant('/v1/catalog')).products.find(product => product.id === 'tea');
  result = await f.merchant('/v1/products/tea', {...current, imageUploadIds: original.imageUploadIds, variants: [current.variants[1], {id: 'white', name: 'white', sku: 'WHITE', price: 20000, stock: 2, weightGrams: 100}]});
  assert.equal(result.status, 200, result.error);
  assert.deepEqual(result.product.variants.map(variant => variant.id), ['green', 'white'], 'Removed unreserved slots can be reused without changing retained identities');
});

test('catalog writes enforce membership, variant ownership and whole quantities', async t => {
  const f = await setup(t), original = await editorFixture(f);
  const foreign = {id: 'foreign', name: 'foreign', sku: 'FOREIGN', price: 20000, stock: 2, weightGrams: 100};
  await f.db.prepare("INSERT INTO product_variants(id,seller_id,product_id,name,sku,price_amount,stock_quantity,weight_grams,sort_order,created_at,updated_at) VALUES ('foreign','seller_bob','private','foreign','FOREIGN',20000,2,100,1,'now','now')").run();
  assert.equal((await f.merchant('/v1/products/tea', original, {seller: 'bob'})).status, 404);
  assert.equal((await f.merchant('/v1/products/tea', {...original, variants: [foreign]})).status, 409);
  for (const changes of [{stock: -1}, {stock: 1.5}, {stock: 'Infinity'}, {price: 2.5}, {weightGrams: 0}, {variants: [{...foreign, id: 'new', stock: 2.5}]}]) {
    assert.equal((await f.merchant('/v1/products/tea', {...original, ...changes})).status, 400);
  }
  assert.equal((await f.merchant('/v1/products/tea', {...original, variants: [{...foreign, id: 'new'}, {...foreign, id: 'new', sku: 'NEW'}]})).status, 400);
  await f.db.prepare("UPDATE seller_memberships SET role='viewer' WHERE auth_user_id='alice'").run();
  for (const [path, input, method] of [
    ['/v1/products/tea', original, 'PUT'], ['/v1/products/tea', undefined, 'DELETE'],
    ['/v1/products/tea/status', {status: 'archived'}, 'PATCH'], ['/v1/products/tea/duplicate', {}, 'POST'],
    ['/v1/drafts/draft-one', {snapshot: {}}, 'PUT'], ['/v1/drafts/draft-one', undefined, 'DELETE'],
    ['/v1/media', {dataUrl: 'data:image/png;base64,eA=='}, 'POST'],
  ]) assert.equal((await f.merchant(path, input, {method})).status, 403, path);
  assert.equal((await f.merchant('/v1/catalog')).status, 200);
  assert.equal(await f.stock(), 10);
});

test('commerce service authenticates body, target, time and deployment before accessing private orders', async t => {
  const f = await setup(t);
  const path = '/internal/commerce/orders', body = JSON.stringify(f.input());
  for (const extra of [{'x-ezkart-signature': '0'.repeat(64)}, {'x-ezkart-environment': 'production'}, {'x-ezkart-timestamp': '1000000000'}, {'x-ezkart-request-id': 'bad'}]) {
    assert.equal((await f.call(path, f.input(), extra)).status, 401);
  }
  assert.equal((await f.mf.dispatchFetch('https://api.fixture.test' + path, {method: 'POST', body, headers: f.headers(path, 'POST', body + ' ')})).status, 401);
  assert.equal((await f.mf.dispatchFetch('https://api.fixture.test' + path + '?tampered=1', {method: 'POST', body, headers: f.headers(path, 'POST', body)})).status, 401);
  assert.equal((await f.create(f.input({environment: 'production'}))).status, 403);
  assert.equal((await f.call(path, {large: 'x'.repeat(65000)})).status, 413);
  const request = f.input();
  const created = await f.create(request);
  assert.equal(created.status, 200, created.error);
  assert.equal((await f.call(`/internal/commerce/orders/${created.order.id}?seller=seller_bob&environment=sandbox`)).status, 404);
  assert.equal((await f.create(f.input({items: [{productId: 'private', quantity: 1, expectedPrice: 20000}]}))).status, 409);
  assert.equal((await f.create(f.input({items: [{productId: 'tea', quantity: 1, expectedPrice: 1}]}))).status, 409);
  assert.equal((await f.create(f.input({items: [{productId: 'tea', quantity: 1.5, expectedPrice: 20000}]}))).status, 422);
});

test('checkout recovery keeps the original intent and provider request even after stock, price and customer changes',async t=>{
  const f=await setup(t),input=f.input(),created=await f.create(input);assert.equal(created.status,200,created.error);const order=created.order;
  const recover=extra=>f.call('/internal/commerce/checkouts/resume',{environment:'sandbox',checkoutKey:input.checkoutKey,intentHash:input.checkout.intentHash,...extra});
  assert.equal((await recover()).order.id,order.id);assert(order.paymentRequestId);
  await f.db.prepare("UPDATE products SET price_amount=30000 WHERE id='tea'").run();
  const resumed=await recover();assert.equal(resumed.order.total,40000);assert.equal(resumed.order.paymentRequestId,order.paymentRequestId);assert.equal(resumed.order.items[0].price,20000);
  assert.equal((await recover({intentHash:digest('changed customer')})).status,409);
  assert.equal((await recover({environment:'production'})).status,403);
  assert.equal((await recover({checkoutKey:randomBytes(16).toString('hex')})).order,null);
  assert.equal((await f.create({...input,sellerId:'seller_bob',items:[{productId:'private',quantity:2,expectedPrice:20000}]})).status,409);
  const scoped=await f.call('/internal/commerce/orders/'+order.id+'?environment=sandbox');assert.equal(scoped.order.id,order.id);
  assert.equal((await f.call('/internal/commerce/orders/'+order.id+'?environment=sandbox&seller=seller_bob')).status,404);
  assert.equal((await f.db.prepare("SELECT COUNT(*) AS n FROM commerce_jobs WHERE kind='payment.create'").first()).n,1);
});

test('payment instructions are durable and immutable and a notification can safely arrive before the create response',async t=>{
  const f=await setup(t),order=(await f.create(f.input())).order;
  assert.equal((await f.event(order,'payment.created',{})).status,409);
  assert.equal((await f.paid(order,{originalRequestId:'wrong-provider-request'})).status,409);assert.equal(await f.stock(),10);
  const paid=await f.paid(order);assert.equal(paid.status,200,paid.error);assert.equal(await f.stock(),8);
  assert.equal((await f.event(order,'payment.created',f.session(order,{accountNumber:'770000000000'}))).status,409);
  let result=await f.event(order,'payment.created',f.session(order));assert.equal(result.status,200,result.error);assert.equal(result.order.state,'paid');assert.equal(result.order.payment.accountNumber,'770011223344');
  result=await f.event(order,'payment.created',f.session(order));assert.equal(result.status,200,result.error);assert.equal(await f.stock(),8);
  assert.equal((await f.db.prepare('SELECT COUNT(*) AS n FROM commerce_payment_sessions').first()).n,1);
  const revision=result.order.revision;
  assert.equal((await f.event(order,'payment.created',f.session(order,{expiresAt:new Date(Date.parse(order.expiresAt)+60000).toISOString()}))).status,409);
  assert.equal((await f.call('/internal/commerce/orders/'+order.id+'?environment=sandbox')).order.revision,revision);
  await assert.rejects(f.db.prepare("UPDATE commerce_payment_accounts SET account_number='770000000000'").run(),/immutable_payment/);
  await assert.rejects(f.db.prepare('DELETE FROM commerce_payment_sessions').run(),/immutable_payment/);
});

test('racing mismatched account responses cannot attach another account or partially consume inventory',async t=>{
  const f=await setup(t),order=(await f.create(f.input())).order;
  const results=await Promise.all([f.event(order,'payment.created',f.session(order)),f.paid(order,{accountNumber:'880011223344'})]);
  assert.deepEqual(results.map(r=>r.status).sort(),[200,409]);
  const winner=(await f.call('/internal/commerce/orders/'+order.id+'?environment=sandbox')).order;
  const account=await f.db.prepare('SELECT account_number FROM commerce_payment_accounts WHERE order_id=?').bind(order.id).first();
  if(winner.state==='paid'){assert.equal(account.account_number,'880011223344');assert.equal(winner.payment,null);assert.equal(await f.stock(),8);}
  else{assert.equal(account.account_number,'770011223344');assert.equal(winner.payment.accountNumber,'770011223344');assert.equal(await f.stock(),10);}
  assert.equal((await f.db.prepare("SELECT COUNT(*) AS n FROM commerce_order_events WHERE event_type!='checkout.created'").first()).n,1);
});

test('hosted payment URLs and expired instructions are checked without reopening released inventory',async t=>{
  const f=await setup(t),request=f.input();request.checkout.paymentFlow='hosted';const order=(await f.create(request)).order;
  const input=f.session(order,{paymentUrl:'https://sandbox.doku.com/checkout-link-v2/provider-fixture'});
  for(const url of ['javascript:alert(1)','https://sandbox.doku.com.evil.test/checkout-link-v2/a','https://user@sandbox.doku.com/checkout-link-v2/a','https://jokul.doku.com/checkout-link-v2/a','https://sandbox.doku.com:8443/checkout-link-v2/a'])assert.equal((await f.event(order,'payment.created',{...input,paymentUrl:url})).status,422);
  assert.equal((await f.event(order,'payment.created',{...input,providerRequestId:'wrong'})).status,409);
  assert.equal((await f.event(order,'payment.create_failed')).status,409,'An uncertain network failure cannot release stock');
  assert.equal((await f.event(order,'payment.expired',{verified:true})).order.state,'expired');
  const created=await f.event(order,'payment.created',input);assert.equal(created.status,200,created.error);assert.equal(created.order.state,'expired');assert.equal(created.order.payment.paymentUrl,input.paymentUrl);
  const holds=await f.db.prepare('SELECT state FROM inventory_reservations WHERE order_id=?').bind(order.id).all();assert(holds.results.every(h=>h.state==='released'));
  const paid=await f.paid(order);assert.equal(paid.order.fulfillmentState,'stock_review');assert.equal(await f.stock(),10);
});

test('checkout dispatch claims one requested order, skips expired creation and acknowledges a verified callback before instructions arrive',async t=>{
  const f=await setup(t),one=(await f.create(f.input())).order,two=(await f.create(f.input())).order;
  const claim=(id,mode='execute')=>f.call('/internal/commerce/jobs/claim',{environment:'sandbox',workerId:'checkout_dispatch',kinds:['payment.create'],orderId:id,limit:1,mode});
  const job=(await claim(two.id)).jobs[0];assert.equal(job.orderId,two.id);assert.equal(job.data.providerRequestId,two.paymentRequestId);
  assert.equal((await claim(two.id)).jobs.length,0);
  await f.db.prepare("UPDATE orders SET expires_at='2026-01-01T00:00:00.000Z' WHERE id=?").bind(one.id).run();assert.equal((await claim(one.id)).jobs.length,0);
  await f.paid(two);
  const finish=await f.call('/internal/commerce/jobs/'+job.id+'/finish',{environment:'sandbox',workerId:'checkout_dispatch',leaseToken:job.leaseToken,outcome:'succeeded',result:{confirmedBy:'verified_payment'}});
  assert.equal(finish.status,200,finish.error);assert.equal((await f.call('/internal/commerce/orders/'+two.id+'?environment=sandbox')).order.paymentJobState,'succeeded');
});

test('atomic reservations prevent overselling and roll back every line and customer on failure', async t => {
  const f = await setup(t);
  await f.db.prepare("UPDATE products SET stock_quantity = 3 WHERE id = 'tea'").run();
  const attempts = await Promise.all(Array.from({length: 8}, () => f.create(f.input())));
  assert.equal(attempts.filter(result => result.status === 200).length, 1, JSON.stringify(attempts));
  assert.equal(attempts.filter(result => result.status === 409).length, 7);
  assert.equal(await f.stock(), 3, 'Reservations hold on-hand stock rather than reporting it as sold');
  assert.equal((await f.db.prepare("SELECT SUM(quantity) AS n FROM inventory_reservations WHERE state = 'reserved'").first()).n, 2);
  const multi = f.input({customer: {...customer, email: 'rollback@example.test'}, items: [
    {productId: 'mug', quantity: 2, expectedPrice: 20000}, {productId: 'tea', quantity: 3, expectedPrice: 20000},
  ]});
  assert.equal((await f.create(multi)).status, 409);
  assert.equal((await f.db.prepare("SELECT COUNT(*) AS n FROM inventory_reservations WHERE product_id='mug'").first()).n, 0);
  assert.equal((await f.db.prepare("SELECT COUNT(*) AS n FROM customers WHERE email='rollback@example.test'").first()).n, 0);
  assert.equal((await f.db.prepare('SELECT COUNT(*) AS n FROM orders').first()).n, 1);
  await assert.rejects(f.db.prepare("UPDATE products SET stock_quantity = 1 WHERE id = 'tea'").run(), /commerce_reserved_stock/);
  await assert.rejects(f.db.prepare('DELETE FROM inventory_reservations').run(), /commerce_immutable_reservation/);
});

test('checkout retries and concurrent callbacks consume stock exactly once and retain fee snapshots', async t => {
  const f = await setup(t), request = f.input();
  const attempts = await Promise.all(Array.from({length: 5}, () => f.create(request)));
  assert(attempts.every(result => result.status === 200), JSON.stringify(attempts));
  assert.equal(new Set(attempts.map(result => result.order.id)).size, 1);
  const order = attempts[0].order;
  assert.equal(order.total, 40000);
  assert.equal(order.snapshot.fees.commissionAmount, 2000);
  assert.equal((await f.create({...request, items: [{productId: 'tea', quantity: 3, expectedPrice: 20000}]})).status, 409);
  assert.equal((await f.paid(order, {amount: 1})).status, 409);
  assert.equal((await f.paid(order, {currency: 'USD'})).status, 409);
  assert.equal((await f.paid(order, {verified: false})).status, 409);
  const eventKey = 'one-callback';
  const paid = await Promise.all(Array.from({length: 5}, () => f.paid(order, {}, eventKey)));
  assert(paid.every(result => result.status === 200), JSON.stringify(paid));
  assert.equal(await f.stock(), 8);
  assert.equal((await f.db.prepare('SELECT COUNT(*) AS n FROM commerce_payment_captures').first()).n, 1);
  assert.equal(paid[0].order.state, 'paid');
  assert.equal(paid[0].order.fulfillmentState, 'not_required');
  assert.equal((await f.paid(order, {amount: 1}, eventKey)).status, 409);
  await f.db.prepare("UPDATE sellers SET plan='advanced' WHERE id='seller_alice'").run();
  const late = await f.event(order, 'payment.expired', {verified: true});
  assert.equal(late.order.state, 'paid'); assert.equal(late.order.snapshot.fees.commissionBasisPoints, 500);
  assert.equal(await f.stock(), 8);
  const other = (await f.create(f.input())).order;
  assert.equal(other.snapshot.fees.commissionBasisPoints, 600);
  assert.equal((await f.paid(other, {reference: 'payment-' + order.id})).status, 409);
  const overpaid = await f.paid(order, {reference: 'second-real-payment'});
  assert.equal(overpaid.status, 200, overpaid.error);
  assert.equal(overpaid.order.paymentReview, true, 'A second real charge must be recorded for refund/reconciliation');
  assert.equal(await f.stock(), 8, 'An overpayment does not consume more inventory');
  assert.equal((await f.db.prepare("SELECT COUNT(*) AS n FROM commerce_payment_captures WHERE capture_kind='duplicate_payment'").first()).n, 1);
  await assert.rejects(f.db.prepare("UPDATE orders SET total_amount=1, subtotal_amount=1 WHERE id=?").bind(order.id).run(), /commerce_immutable_order/);
  await assert.rejects(f.db.prepare('DELETE FROM commerce_order_events').run(), /commerce_immutable_event/);
});

test('expiry releases holds while late success records payment with a stock-review hold', async t => {
  const f = await setup(t);
  await f.db.prepare("UPDATE products SET stock_quantity=2 WHERE id='tea'").run();
  const order = (await f.create(f.input())).order;
  assert.equal((await f.event(order, 'payment.expired')).status, 409, 'A timer may not expire a still-valid payment');
  assert.equal((await f.event(order, 'payment.created',f.session(order))).order.state, 'pending');
  assert.equal((await f.event(order, 'payment.failed', {reason: 'bank attempt failed'})).order.state, 'pending');
  const expired = await f.event(order, 'payment.expired', {verified: true});
  assert.equal(expired.order.state, 'expired');
  const next = await f.create(f.input()); assert.equal(next.status, 200);
  assert.equal((await f.paid(next.order)).order.fulfillmentState, 'not_required');
  assert.equal(await f.stock(), 0);
  const late = await f.paid(order);
  assert.equal(late.order.state, 'paid'); assert.equal(late.order.fulfillmentState, 'stock_review');
  assert.equal(await f.stock(), 0, 'Late payment cannot consume another buyer’s stock');
  assert.equal((await f.db.prepare('SELECT COUNT(*) AS n FROM commerce_payment_captures').first()).n, 2);
});

test('variants reserve independently; cancellation and failed creation release exactly once', async t => {
  const f = await setup(t);
  for (const [id, hidden, index] of [['green', false, 1], ['black', false, 2], ['secret', true, 3]]) {
    await f.db.prepare("INSERT INTO product_variants(id,seller_id,product_id,name,options_json,sku,price_amount,stock_quantity,weight_grams,sort_order,created_at,updated_at) VALUES (?,'seller_alice','tea',?,?,?,25000,2,100,?,'now','now')")
      .bind(id, id, JSON.stringify({hidden, values: []}), 'SKU-' + id, index).run();
  }
  const variant = id => f.input({items: [{productId: 'tea', variantId: id, quantity: 2, expectedPrice: 25000}]});
  assert.equal((await f.create(f.input())).status, 409, 'Variant products require an explicit choice');
  assert.equal((await f.create(variant('secret'))).status, 409);
  const green = (await f.create(variant('green'))).order;
  const black = (await f.create(variant('black'))).order;
  await assert.rejects(f.db.prepare("DELETE FROM product_variants WHERE id='green'").run(), /commerce_reserved_stock/);
  await assert.rejects(f.db.prepare("UPDATE product_variants SET stock_quantity=1 WHERE id='green'").run(), /commerce_reserved_stock/);
  assert.equal((await f.event(green, 'checkout.cancelled')).order.state, 'cancelled');
  assert.equal((await f.event(green, 'checkout.cancelled')).order.state, 'cancelled');
  assert.equal((await f.event(black, 'payment.create_failed',{noEffectConfirmed:true})).order.state, 'failed');
  const reopened = await f.create(variant('green')); assert.equal(reopened.status, 200);
  await f.paid(reopened.order);
  assert.equal((await f.db.prepare("SELECT stock_quantity FROM product_variants WHERE id='green'").first()).stock_quantity, 0);
  assert.equal((await f.db.prepare("SELECT stock_quantity FROM product_variants WHERE id='black'").first()).stock_quantity, 2);
});

test('available storefront stock reflects reservations and the scheduled expiry pass releases them', async t => {
  const f = await setup(t);
  const order = (await f.create(f.input())).order;
  const available = async () => (await (await f.mf.dispatchFetch('https://api.fixture.test/v1/storefront/products?ids=tea')).json()).products;
  assert.equal((await available())[0].stock, 8);
  await f.db.prepare("UPDATE orders SET expires_at = '2026-01-01T00:00:00.000Z' WHERE id=?").bind(order.id).run();
  const env = {DB: f.db, APP_ENVIRONMENT: 'test', COMMERCE_STORAGE: 'd1'};
  assert.equal((await expireCommerceOrders(env)).expired, 1);
  assert.equal((await expireCommerceOrders(env)).expired, 0);
  assert.equal((await available())[0].stock, 10);
  const jobs = (await f.db.prepare('SELECT kind, state FROM commerce_jobs WHERE order_id=?').bind(order.id).all()).results;
  assert.deepEqual(jobs.map(row => [row.kind, row.state]).sort(), [['notification.order_state', 'queued'], ['payment.create', 'dead']]);
});

test('transactional jobs have exclusive leases, immutable retry keys and durable completion receipts', async t => {
  const f = await setup(t);
  const order = (await f.create(f.input())).order;
  const claim = workerId => f.call('/internal/commerce/jobs/claim', {environment: 'sandbox', workerId, kinds: ['payment.create']});
  const attempts = await Promise.all(['worker_one', 'worker_two', 'worker_three'].map(claim));
  assert(attempts.every(result => result.status === 200), JSON.stringify(attempts));
  assert.equal(attempts.reduce((count, result) => count + result.jobs.length, 0), 1);
  const index = attempts.findIndex(result => result.jobs.length), job = attempts[index].jobs[0];
  const workerId = ['worker_one', 'worker_two', 'worker_three'][index];
  const finish = (extra = {}) => f.call(`/internal/commerce/jobs/${job.id}/finish`, {environment: 'sandbox', workerId,
    leaseToken: job.leaseToken, outcome: 'succeeded', result: {reference: 'created-provider-session'}, ...extra});
  assert.equal((await finish({workerId: 'intruder'})).status, 409);
  assert.equal((await finish()).status, 409, 'Provider results must reach the order before acknowledging the job');
  await f.event(order, 'payment.created', f.session(order));
  const completions = await Promise.all([finish(), finish(), finish()]);
  assert(completions.every(result => result.status === 200), JSON.stringify(completions));
  assert.equal((await finish({result: {reference: 'different'}})).status, 409);
  assert.equal((await claim('worker_four')).jobs.length, 0);
  const audit = (await f.db.prepare('SELECT * FROM commerce_job_attempts WHERE job_id=?').bind(job.id).all()).results;
  assert.equal(audit.length, 1); assert.equal(audit[0].outcome, 'succeeded'); assert(audit[0].finished_at);
  await assert.rejects(f.db.prepare('UPDATE commerce_jobs SET payload_json=? WHERE id=?').bind('{"providerRequestId":"changed"}', job.id).run(), /commerce_immutable_job/);
});

test('lost provider responses require reconciliation; failed retries back off and stop at their limit', async t => {
  const f = await setup(t);
  const order = (await f.create(f.input())).order;
  const claim = (mode = 'execute') => f.call('/internal/commerce/jobs/claim', {environment: 'sandbox', workerId: 'payments_worker', kinds: ['payment.create'], mode});
  const job = (await claim()).jobs[0];
  const finish = (held, outcome, result = {}) => f.call(`/internal/commerce/jobs/${held.id}/finish`, {
    environment: 'sandbox', workerId: 'payments_worker', leaseToken: held.leaseToken, outcome, result,
  });
  assert.equal((await finish(job, 'retry')).status, 409);
  await f.db.prepare("UPDATE commerce_jobs SET lease_until='2026-01-01T00:00:00.000Z', maximum_attempts=2 WHERE id=?").bind(job.id).run();
  assert.equal((await claim()).jobs.length, 0, 'A crashed provider call cannot be executed again blindly');
  assert.equal((await finish(job, 'succeeded')).status, 409, 'Old lease cannot complete after recovery');
  const reconcile = (await claim('reconcile')).jobs[0];
  assert.equal(reconcile.data.providerRequestId, job.data.providerRequestId);
  assert.equal(reconcile.mode, 'reconcile');
  assert.equal((await finish(reconcile, 'retry', {noEffectConfirmed: true})).job.state, 'dead');
  assert.equal((await claim()).jobs.length, 0);
  const rows = (await f.db.prepare('SELECT outcome FROM commerce_job_attempts WHERE job_id=? ORDER BY attempt').bind(job.id).all()).results;
  assert.deepEqual(rows.map(row => row.outcome), ['uncertain', 'dead']);
  const second = (await f.create(f.input())).order;
  const retryJob = (await claim()).jobs[0];
  assert.equal(retryJob.orderId, second.id);
  const retry = await finish(retryJob, 'retry', {noEffectConfirmed: true});
  assert.equal(retry.job.state, 'retry');
  const row = await f.db.prepare('SELECT available_at FROM commerce_jobs WHERE id=?').bind(retryJob.id).first();
  assert(Date.parse(row.available_at) > Date.now() + 13000);
  assert.equal((await claim()).jobs.length, 0);
  assert.equal((await f.call(`/internal/commerce/orders/${order.id}?seller=seller_alice&environment=sandbox`)).order.state, 'creating');
});

test('inventory lists every physical option once, separates reservations, and scopes history and paging to the seller', async t => {
  const f = await setup(t), original = await editorFixture(f);
  const variant = (id, stock, hidden = false) => ({id,name:id,sku:id.toUpperCase(),price:20000,stock,weightGrams:100,hidden});
  assert.equal((await f.merchant('/v1/products/tea', {...original,variants:[variant('green',8),variant('black',2,true)]})).status,200);
  assert.equal((await f.create(f.input({items:[{productId:'tea',variantId:'green',quantity:3,expectedPrice:20000}]}))).status,200);
  await f.db.prepare("INSERT INTO products(id,seller_id,type,status,title,price_amount,created_at,updated_at) VALUES ('download','seller_alice','digital','active','Download',20000,'now','now')").run();
  const first = await f.merchant('/v1/inventory?limit=2');
  assert.equal(first.status,200,first.error);assert.equal(first.summary.skuCount,3);assert.equal(first.summary.onHand,20);assert.equal(first.summary.reserved,3);assert.equal(first.summary.available,17);
  assert.equal(first.items.length,2);assert(first.nextCursor);
  const second=await f.merchant('/v1/inventory?limit=2&cursor='+encodeURIComponent(first.nextCursor));
  assert.equal(second.items.length,1);assert.equal(second.nextCursor,null);
  assert.equal(new Set([...first.items,...second.items].map(item=>item.key)).size,3);
  const green=(await f.merchant('/v1/inventory?q=GREEN')).items[0];assert.equal(green.available,5);assert.equal(green.reserved,3);
  const black=(await f.merchant('/v1/inventory?q=black')).items[0];assert.equal(black.hidden,true);assert.equal(black.onHand,2);
  assert.equal((await f.merchant('/v1/inventory?level=zero')).items.length,0);
  assert.equal((await f.merchant('/v1/inventory?status=wrong')).status,422);
  assert.equal((await f.merchant('/v1/inventory',undefined,{seller:'bob'})).summary.skuCount,1);
  assert.equal((await f.merchant('/v1/inventory/history?product=tea',undefined,{seller:'bob'})).items.length,0);
  const history=await f.merchant('/v1/inventory/history?product=tea&variant=green');
  assert.equal(history.items.length,1);assert.equal(history.items[0].after,8);assert.equal(history.items[0].reason,'catalog_edit');
});

test('inventory adjustments are atomic, idempotent under concurrent retries, reservation-safe and auditable', async t => {
  const f=await setup(t);
  const input=(items,kind='received',note='Warehouse receipt\nDelivery A')=>({requestKey:randomBytes(16).toString('hex'),kind,note,items});
  const item=(productId,quantity,revision=1)=>({productId,variantId:'',quantity,revision});
  const adjust=body=>f.merchant('/v1/inventory/adjustments',body,{method:'POST'});
  const request=input([item('tea',5)]);
  const attempts=await Promise.all(Array.from({length:5},()=>adjust(request)));
  assert(attempts.every(result=>result.status===200),JSON.stringify(attempts));assert.equal(new Set(attempts.map(result=>result.receipt.id)).size,1);assert.equal(await f.stock(),15);
  assert.equal((await adjust({...request,items:[item('tea',6)]})).status,409);
  const history=await f.merchant('/v1/inventory/history?product=tea');assert.equal(history.items.length,1);assert.equal(history.items[0].delta,5);
  const order=(await f.create(f.input({items:[{productId:'tea',quantity:12,expectedPrice:20000}]}))).order;assert(order);
  let revision=(await f.merchant('/v1/inventory?q=SKU-tea')).items[0].revision;
  const failed=await adjust(input([item('mug',20),item('tea',11,revision)],'count','Cycle count'));
  assert.equal(failed.status,409);assert.equal(failed.code,'inventory_reserved');assert.equal(await f.stock('mug'),10);assert.equal(await f.stock(),15);
  assert.equal((await f.db.prepare('SELECT COUNT(*) AS n FROM inventory_adjustments').first()).n,1);
  assert.equal((await f.merchant('/v1/inventory/history?product=mug')).items.length,0);
  assert.equal((await adjust(input([item('tea',1)],'received'))).code,'inventory_conflict');
  assert.equal((await adjust(input([item('private',3)]))).status,404);
  assert.equal((await adjust(input([item('tea',1,revision)],'damaged',''))).status,422);
  assert.equal((await adjust(input([item('tea',1.5,revision)]))).status,422);
  assert.equal((await adjust(null)).status,400);
  assert.equal((await adjust(input([null]))).status,422);
  const alert=await adjust(input([item('tea',3,revision)],'alert','Reorder at three available units'));assert.equal(alert.status,200,alert.error);assert.equal(await f.stock(),15);
  assert.equal((await f.merchant('/v1/inventory?q=SKU-tea&level=low')).items[0].reorderPoint,3);
  assert.equal((await f.paid(order)).status,200);assert.equal(await f.stock(),3);
  assert.equal((await f.paid(order)).status,200);
  const sales=(await f.merchant('/v1/inventory/history?product=tea')).items.filter(item=>item.reason==='payment');assert.equal(sales.length,1);assert.equal(sales[0].before,15);assert.equal(sales[0].after,3);
  await assert.rejects(f.db.prepare('DELETE FROM inventory_movements').run(),/inventory_immutable_history/);
  await assert.rejects(f.db.prepare("UPDATE inventory_adjustments SET note='changed'").run(),/inventory_immutable_history/);
});

test('inventory count drafts survive reloads, recover lost responses and prevent cross-tab or read-only writes', async t => {
  const f=await setup(t),payload={requestKey:randomBytes(16).toString('hex'),kind:'count',note:'Count aisle A',items:[{productId:'tea',variantId:'',revision:1,quantity:7,label:'T'.repeat(283),beforeQuantity:10,beforeAlert:15}]};
  assert.equal((await f.merchant('/v1/inventory/draft')).draft,null);
  const saved=await f.merchant('/v1/inventory/draft',{revision:0,payload});assert.equal(saved.status,200,saved.error);assert.equal(saved.draft.revision,1);
  assert.equal((await f.merchant('/v1/inventory/draft',{revision:0,payload})).draft.revision,1,'A lost save response can be retried');
  assert.deepEqual((await f.merchant('/v1/inventory/draft')).draft.payload,saved.draft.payload);
  assert.equal((await f.merchant('/v1/inventory/draft',undefined,{seller:'bob'})).draft,null);
  const edits=await Promise.all([8,9].map(quantity=>f.merchant('/v1/inventory/draft',{revision:1,payload:{...payload,items:[{...payload.items[0],quantity}]}})));
  assert.deepEqual(edits.map(result=>result.status).sort(),[200,409]);
  const current=(await f.merchant('/v1/inventory/draft')).draft;
  assert.equal((await f.merchant('/v1/inventory/adjustments',{...payload,draftRevision:1},{method:'POST'})).code,'inventory_draft_conflict');assert.equal(await f.stock(),10);
  assert.equal((await f.merchant('/v1/inventory/draft',{revision:1},{method:'DELETE'})).status,409);
  await f.db.prepare("UPDATE seller_memberships SET role='viewer' WHERE auth_user_id='alice'").run();
  assert.equal((await f.merchant('/v1/inventory')).canEdit,false);
  assert.equal((await f.merchant('/v1/inventory/draft',{revision:2,payload})).status,403);
  assert.equal((await f.merchant('/v1/inventory/draft',{revision:2},{method:'DELETE'})).status,403);
  assert.equal((await f.merchant('/v1/inventory/adjustments',payload,{method:'POST'})).status,403);
  await f.db.prepare("UPDATE seller_memberships SET role='owner' WHERE auth_user_id='alice'").run();
  const result=await f.merchant('/v1/inventory/adjustments',{...current.payload,draftRevision:current.revision},{method:'POST'});assert.equal(result.status,200,result.error);assert.equal(await f.stock(),current.payload.items[0].quantity);
  const cleared=(await f.merchant('/v1/inventory/draft')).draft;
  assert.equal(cleared.payload,null);assert.equal(cleared.revision,current.revision+1);
  assert.deepEqual((await f.merchant('/v1/inventory/adjustments',{...current.payload,draftRevision:current.revision},{method:'POST'})).receipt,result.receipt);
  const next={...payload,requestKey:randomBytes(16).toString('hex'),items:[]};
  const nextDraft=await f.merchant('/v1/inventory/draft',{revision:cleared.revision,payload:next});assert.equal(nextDraft.status,200,nextDraft.error);
  assert.equal((await f.merchant('/v1/inventory/draft',{revision:1,payload})).status,409,'An old tab cannot overwrite a new count after the previous draft was cleared');
  assert.equal((await f.merchant('/v1/inventory/draft',{revision:1},{method:'DELETE'})).status,409);
  const discarded=await f.merchant('/v1/inventory/draft',{revision:nextDraft.draft.revision},{method:'DELETE'});
  assert.equal(discarded.draft.payload,null);assert.equal(discarded.draft.revision,nextDraft.draft.revision+1);
});

test('a full 100-option count commits together and reconciles hidden stock without double-counting product totals', async t => {
  const f=await setup(t);
  const statements=Array.from({length:100},(_,n)=>f.db.prepare("INSERT INTO product_variants(id,seller_id,product_id,name,options_json,sku,price_amount,stock_quantity,weight_grams,sort_order,created_at,updated_at) VALUES (?,'seller_alice','tea',?,?,?,20000,1,100,?,'now','now')")
    .bind('mass-'+n,'Option '+n,JSON.stringify({hidden:n%10===0}),'MASS-'+String(n).padStart(3,'0'),n+1));
  await f.db.batch(statements);
  const first=await f.merchant('/v1/inventory?q=MASS-&limit=100');assert.equal(first.items.length,100);assert.equal(first.summary.onHand,100);
  const result=await f.merchant('/v1/inventory/adjustments',{requestKey:randomBytes(16).toString('hex'),kind:'count',note:'Full option count',items:first.items.map(item=>({productId:item.productId,variantId:item.variantId,revision:item.revision,quantity:2}))},{method:'POST'});
  assert.equal(result.status,200,result.error);assert.equal(result.receipt.items.length,100);assert.equal(await f.stock(),180,'Product display total includes the 90 visible options only');
  const counted=await f.merchant('/v1/inventory?q=MASS-&limit=100');assert.equal(counted.summary.onHand,200,'Warehouse count includes all 100 options without the aggregate product row');
  const history=await f.merchant('/v1/inventory/history?product=tea&limit=60');assert.equal(history.items.length,60);assert(history.nextCursor);
  const next=await f.merchant('/v1/inventory/history?product=tea&limit=60&cursor='+history.nextCursor);assert.equal(next.items.length,40);assert.equal(next.nextCursor,null);
  assert.equal(new Set([...history.items,...next.items].map(item=>item.id)).size,100);
});
