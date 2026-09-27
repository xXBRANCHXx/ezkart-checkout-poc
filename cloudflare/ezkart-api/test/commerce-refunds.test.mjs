import test from 'node:test';
import assert from 'node:assert/strict';
import {randomBytes} from 'node:crypto';
import {setupCommerceFixture,fixtureShipping} from './commerce-fixture.mjs';
import {digitalFixtureFile} from './digital-commerce-fixture.mjs';
import {createRefund,changeRefund} from '../src/commerce-refunds.js';

const buyer='refund-buyer',key=()=>randomBytes(16).toString('hex');
async function fixture(t){
  const f=await setupCommerceFixture(t),file=await digitalFixtureFile(f);
  const create=async()=>{const c=await f.create(f.input({items:[{productId:'tea',quantity:2,expectedPrice:20000,expectedWeightGrams:100},file.item],shipping:fixtureShipping,customer:{name:'Buyer',email:'buyer@example.test',phone:'081234567890',authUserId:buyer}}));assert.equal(c.status,200,c.error);const paid=await f.paid(c.order);assert.equal(paid.status,200,paid.error);return paid.order;};
  const order=await create(),path='/v1/customer/orders/'+order.id+'/refunds',merchant='/v1/commerce/refunds';
  const call=(url,input,actor=buyer)=>f.merchant(url,input,{seller:actor,method:input===undefined?'GET':'POST'});
  const request=(extra={})=>({requestKey:key(),orderRevision:order.revision,reason:'file_problem',note:'The purchased file has a problem.',items:[{orderItemId:order.items.find(i=>i.productType==='digital').id,amount:1000}],shippingAmount:0,...extra});
  const save=async(input=request())=>{const r=await call(path,input);assert.equal(r.status,200,r.error);return r.refund;};
  const action=(r,kind,extra={})=>({requestKey:key(),revision:r.revision,orderRevision:r.orderRevision,kind,message:'The requested decision is confirmed.',...extra});
  const count=async table=>(await f.db.prepare('SELECT COUNT(*) AS n FROM '+table).first()).n;
  return {...f,order,file,path,merchant,callBuyer:call,request,save,action,count,createOrder:create};
}

test('refund requests allocate original digital, physical and shipping amounts without changing payment, stock, downloads or accounting',async t=>{
  const f=await fixture(t),before=(await f.db.prepare('SELECT * FROM commerce_financial_entries ORDER BY journal_sequence,line_number').all()).results;
  const overview=await f.callBuyer(f.path);assert.equal(overview.canCreate,true);assert.equal(overview.shipping.availableAmount,18000);
  const physical=f.order.items.find(i=>i.productType==='physical'),digital=f.order.items.find(i=>i.productType==='digital');
  const r=await f.save(f.request({items:[{orderItemId:physical.id,amount:5000},{orderItemId:digital.id,amount:1000}],shippingAmount:3000}));
  assert.equal(r.amount,9000);assert.equal(r.state,'requested');assert.equal(r.paymentConfirmed,false);
  const approved=await f.callBuyer(f.merchant+'/'+r.id,f.action(r,'approve'),'alice');assert.equal(approved.status,200,approved.error);assert.equal(approved.refund.state,'approved');assert.equal(approved.refund.paymentConfirmed,false);
  const after=await f.callBuyer(f.path);assert.equal(after.shipping.availableAmount,15000);assert.equal(after.items.find(i=>i.orderItemId===physical.id).availableAmount,35000);
  const downloads=await f.callBuyer('/v1/customer/orders/'+f.order.id+'/downloads');assert.equal(downloads.items[0].canDownload,true);
  assert.equal((await f.db.prepare('SELECT checkout_state FROM orders WHERE id=?').bind(f.order.id).first()).checkout_state,'paid');assert.equal(await f.stock(),8);
  assert.deepEqual((await f.db.prepare('SELECT * FROM commerce_financial_entries ORDER BY journal_sequence,line_number').all()).results,before);
});

test('concurrent refund claims cannot over-allocate an item or shipping and exact retries retain their original identity',async t=>{
  const f=await fixture(t),physical=f.order.items.find(i=>i.productType==='physical');
  const inputs=[f.request({items:[{orderItemId:physical.id,amount:30000}]}),f.request({items:[{orderItemId:physical.id,amount:30000}]})];
  const results=await Promise.all(inputs.map(input=>f.callBuyer(f.path,input)));assert.deepEqual(results.map(r=>r.status).sort(),[200,409]);
  const winner=results.findIndex(r=>r.status===200),r=results[winner].refund;assert.equal((await f.callBuyer(f.path,inputs[winner])).refund.id,r.id);
  assert.equal((await f.callBuyer(f.path,{...inputs[winner],note:'Different explanation.'})).status,409);assert.equal(await f.count('commerce_refunds'),1);
  const shipping=await Promise.all([1,2].map(()=>f.callBuyer(f.path,f.request({items:[],shippingAmount:12000}))));assert.deepEqual(shipping.map(r=>r.status).sort(),[200,409]);
  assert.equal((await f.callBuyer(f.path,f.request({items:[{orderItemId:physical.id,amount:10001}]}))).status,409);
  const exact=f.request({items:[{orderItemId:physical.id,amount:1000}]}),same=await Promise.all([1,2].map(()=>f.callBuyer(f.path,exact)));assert(same.every(x=>x.status===200));assert.equal(same[0].refund.id,same[1].refund.id);
  const decision=await Promise.all([f.callBuyer(f.path+'/'+r.id,f.action(r,'withdraw')),f.callBuyer(f.merchant+'/'+r.id,f.action(r,'approve'),'alice')]);assert.deepEqual(decision.map(x=>x.status).sort(),[200,409]);
});

test('decline and withdrawal restore capacity while stale actions and old retries cannot undo a saved decision',async t=>{
  const f=await fixture(t),input=f.request(),r=await f.save(input),withdraw=f.action(r,'withdraw');
  const saved=await f.callBuyer(f.path+'/'+r.id,withdraw);assert.equal(saved.status,200);assert.equal(saved.refund.state,'withdrawn');
  assert.equal((await f.callBuyer(f.path+'/'+r.id,withdraw)).refund.state,'withdrawn');assert.equal((await f.callBuyer(f.path,input)).refund.state,'withdrawn');
  assert.equal((await f.callBuyer(f.merchant+'/'+r.id,f.action(r,'approve'),'alice')).status,409);
  const second=await f.save(),decline=f.action(second,'decline'),decided=await f.callBuyer(f.merchant+'/'+second.id,decline,'alice');assert.equal(decided.status,200);assert.equal(decided.refund.state,'declined');
  assert.equal((await f.callBuyer(f.merchant+'/'+second.id,decline,'alice')).refund.history.length,1);
  const overview=await f.callBuyer(f.path);assert(overview.items.every(i=>i.reservedAmount===0));assert.equal(await f.count('commerce_refund_actions'),2);
});

test('refund ownership and live membership cannot be replaced by an email, seller role or submitted financial fields',async t=>{
  const f=await fixture(t),r=await f.save();
  for(const actor of ['bob','same-email-other-buyer'])assert.equal((await f.callBuyer(f.path,undefined,actor)).status,404);
  assert.equal((await f.callBuyer(f.merchant+'/'+r.id,undefined,'bob')).status,404);
  assert.equal((await f.callBuyer(f.path+'/'+r.id,f.action(r,'approve'))).status,403);
  for(const patch of [{amount:1},{state:'approved'},{currency:'USD'},{ownerAuthUserId:'bob'},{captureId:'forged'}])assert.equal((await f.callBuyer(f.path,f.request(patch))).status,422);
  await f.db.prepare("UPDATE seller_memberships SET role='viewer' WHERE auth_user_id='alice'").run();
  assert.equal((await f.callBuyer(f.merchant+'/'+r.id,f.action(r,'approve'),'alice')).status,403);
  assert.equal((await f.callBuyer(f.merchant+'/'+r.id,undefined,'alice')).refund.canApprove,false);
  await f.db.prepare("UPDATE orders SET payment_review=1 WHERE id=?").bind(f.order.id).run();
  assert.equal((await f.callBuyer(f.path,f.request())).status,409);assert.equal((await f.callBuyer(f.path+'/'+r.id,f.action(r,'withdraw'))).status,200);
});

test('refund allocations, decisions and their original evidence reject direct edits, deletes and replacement writes',async t=>{
  const f=await fixture(t),r=await f.save();await f.callBuyer(f.merchant+'/'+r.id,f.action(r,'approve'),'alice');
  for(const sql of ["UPDATE commerce_refunds SET state='withdrawn'","DELETE FROM commerce_refunds","UPDATE commerce_refund_items SET amount=1","DELETE FROM commerce_refund_items","UPDATE commerce_refund_actions SET message='Changed decision'","DELETE FROM commerce_refund_actions",
    'INSERT OR REPLACE INTO commerce_refunds SELECT * FROM commerce_refunds','INSERT OR REPLACE INTO commerce_refund_items SELECT * FROM commerce_refund_items','INSERT OR REPLACE INTO commerce_refund_actions SELECT * FROM commerce_refund_actions'])await assert.rejects(f.db.prepare(sql).run(),/refund_immutable/);
  assert.equal(await f.count('commerce_refunds'),1);assert.equal(await f.count('commerce_refund_actions'),1);
  assert.equal((await f.callBuyer(f.path+'/'+r.id)).refund.state,'approved');
});

test('database guards recheck payment and membership after refund preflight and roll back a failed item projection',async t=>{
  const f=await fixture(t);let intercepted=false;
  const DB=new Proxy(f.db,{get(target,name){if(name==='prepare')return sql=>{const s=target.prepare(sql);if(!sql.startsWith('INSERT INTO commerce_refunds'))return s;return {bind(...args){const bound=s.bind(...args);return {async run(){intercepted=true;await f.db.prepare('UPDATE orders SET payment_review=1 WHERE id=?').bind(f.order.id).run();return bound.run();}};}};};return typeof target[name]==='function'?target[name].bind(target):target[name];}});
  await assert.rejects(createRefund({DB,APP_ENVIRONMENT:'test',COMMERCE_STORAGE:'d1'},{kind:'buyer',id:buyer},f.order.id,f.request()),e=>e instanceof Response&&e.status===409);assert(intercepted);assert.equal(await f.count('commerce_refunds'),0);
  await f.db.prepare('UPDATE orders SET payment_review=0 WHERE id=?').bind(f.order.id).run();
  await f.db.prepare("CREATE TRIGGER fail_refund_projection BEFORE INSERT ON commerce_refund_items BEGIN SELECT RAISE(ABORT,'test_failure'); END").run();
  assert.equal((await f.callBuyer(f.path,f.request())).status,500);assert.equal(await f.count('commerce_refunds'),0);assert.equal(await f.count('commerce_refund_items'),0);
  await f.db.prepare('DROP TRIGGER fail_refund_projection').run();const r=await f.save();
  const revoked=new Proxy(f.db,{get(target,name){if(name==='prepare')return sql=>{const s=target.prepare(sql);if(!sql.startsWith('INSERT INTO commerce_refund_actions'))return s;return {bind(...args){const bound=s.bind(...args);return {async run(){await f.db.prepare("UPDATE seller_memberships SET role='viewer' WHERE auth_user_id='alice'").run();return bound.run();}};}};};return typeof target[name]==='function'?target[name].bind(target):target[name];}});
  await assert.rejects(changeRefund({DB:revoked,APP_ENVIRONMENT:'test',COMMERCE_STORAGE:'d1'},{kind:'merchant',id:'alice',sellerId:'seller_alice'},r.id,f.action(r,'approve')),e=>e instanceof Response&&e.status===403);
  assert.equal(await f.count('commerce_refund_actions'),0);
});

test('refund queues page a fixed store cohort, scope their cursors and bound repeated requests',async t=>{
  const f=await fixture(t),second=await f.createOrder(),secondPath='/v1/customer/orders/'+second.id+'/refunds';
  for(let n=0;n<27;n++){
    const order=n<20?f.order:second,path=n<20?f.path:secondPath;
    const r=await f.callBuyer(path,f.request({orderRevision:order.revision,items:[{orderItemId:order.items[0].id,amount:1}]}));assert.equal(r.status,200,r.error);
  }
  assert.equal((await f.callBuyer(f.path,f.request())).status,429);
  const first=await f.callBuyer(f.merchant,undefined,'alice');assert.equal(first.refunds.length,25);assert(first.nextCursor);
  assert.equal((await f.callBuyer(secondPath,f.request({orderRevision:second.revision,items:[{orderItemId:second.items[0].id,amount:1}]}))).status,200);
  const tail=await f.callBuyer(f.merchant+'?cursor='+first.nextCursor,undefined,'alice');assert.equal(tail.refunds.length,2);assert.equal(tail.nextCursor,null);
  assert.equal(new Set([...first.refunds,...tail.refunds].map(r=>r.id)).size,27);
  assert.equal((await f.callBuyer(f.merchant+'?state=approved&cursor='+first.nextCursor,undefined,'alice')).status,422);
  assert.equal((await f.callBuyer(f.merchant+'?cursor='+first.nextCursor,undefined,'bob')).status,422);
  assert.equal((await f.callBuyer(secondPath)).refunds.length,8);
});

test('refund inputs reject ambiguous JSON, duplicate items, foreign allocations and unsupported payment states',async t=>{
  const f=await fixture(t),input=f.request();
  for(const patch of [{items:[input.items[0],input.items[0]]},{items:[{...input.items[0],amount:1.5}]},{items:[],shippingAmount:0},{shippingAmount:-1},{note:'x'}])assert.equal((await f.callBuyer(f.path,f.request(patch))).status,422);
  const second=await f.createOrder();assert.equal((await f.callBuyer(f.path,f.request({items:[{orderItemId:second.items[0].id,amount:1}]}))).status,409);
  const duplicate=JSON.stringify(input).replace('"shippingAmount":0','"shippingAmount":0,"shippingAmount":1');
  const response=await f.mf.dispatchFetch('https://api.fixture.test'+f.path,{method:'POST',headers:{authorization:'Bearer '+await f.merchantToken(buyer),'content-type':'application/json'},body:duplicate});assert.equal(response.status,400);
  for(const suffix of ['?state=all&state=open','?environment=production','/invalid'])assert.equal((await f.callBuyer(f.path+suffix)).status,suffix==='/invalid'?400:422);
  await f.db.prepare("UPDATE orders SET checkout_state='partially_refunded' WHERE id=?").bind(f.order.id).run();assert.equal((await f.callBuyer(f.path,f.request())).status,409);
});
