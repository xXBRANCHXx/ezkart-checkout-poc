import test from 'node:test';
import assert from 'node:assert/strict';
import {randomBytes} from 'node:crypto';
import {setupCommerceFixture,fixtureShipping} from './commerce-fixture.mjs';
import {digitalFixtureFile} from './digital-commerce-fixture.mjs';
import {digitalPartBytes} from '../src/digital-files.js';
import {digitalDownloadProof} from '../src/commerce-digital.js';
import {saveBuyerReview} from '../src/commerce-reviews.js';

const buyer='digital-review-buyer',key=()=>randomBytes(16).toString('hex');
const png='data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a8x8AAAAASUVORK5CYII=';
async function fixture(t,bytes=Buffer.from('The purchased original edition')){
  const f=await setupCommerceFixture(t),file=await digitalFixtureFile(f,{bytes});
  const create=async(items=[file.item],shipping={kind:'none',amount:0,skipped:false})=>{
    const result=await f.create(f.input({items,shipping,customer:{name:'Private buyer',email:'private@example.test',phone:'081234567890',authUserId:buyer}}));assert.equal(result.status,200,result.error);return result.order;
  };
  const call=(path,body,actor=buyer)=>f.merchant(path,body,{seller:actor,method:body===undefined?'GET':'POST'});
  const path=o=>'/v1/customer/orders/'+o.id+'/reviews';
  const view=o=>call(path(o));
  const publish=(order,item,extra={})=>call(path(order),{kind:'publish',orderItemId:item.id,requestKey:key(),revision:0,rating:1,title:'After using it',body:'A specific, honest review.',publicName:'Reader',photos:[],...extra});
  const grant=async(order,item)=>{const prefix='/v1/customer/orders/'+order.id+'/downloads/'+item.id+'/grants',created=await call(prefix,{requestKey:key()});assert.equal(created.status,200,created.error);return prefix+'/'+created.grant.id;};
  const part=async(prefix,number)=>{const response=await f.mf.dispatchFetch('https://api.fixture.test'+prefix+'/parts/'+number,{headers:{authorization:'Bearer '+await f.merchantToken(buyer)}});assert.equal(response.status,200);const bytes=new Uint8Array(await response.arrayBuffer());return {proof:await digitalDownloadProof(prefix.split('/').at(-1),number,response.headers.get('x-ezkart-file-challenge'),bytes)};};
  const complete=async(order,item)=>{const prefix=await grant(order,item);const manifest=await call(prefix);for(let n=1;n<=manifest.file.manifest.length;n++){const proof=await part(prefix,n),r=await call(prefix+'/parts/'+n+'/receipt',proof);assert.equal(r.status,200,r.error);}return prefix;};
  const publicReviews=async()=>{const r=await f.mf.dispatchFetch('https://api.fixture.test/v1/public/reviews?product=guide');return r.json();};
  return {...f,file,createOrder:create,callBuyer:call,path,view,publish,grant,part,complete,publicReviews};
}

test('digital reviews require verified primary payment and every original file part, not access or native download',async t=>{
  const f=await fixture(t,randomBytes(digitalPartBytes+7)),order=await f.createOrder(),item=order.items[0];
  const mediaPath='/v1/customer/orders/'+order.id+'/review-media',photoInput={orderItemId:item.id,requestKey:key(),dataUrl:png};
  assert.equal((await f.view(order)).items[0].canPublish,false);assert.equal((await f.publish(order,item)).status,409);
  assert.equal((await f.paid(order)).status,200);const prefix=await f.grant(order,item);
  const native=await f.mf.dispatchFetch('https://api.fixture.test'+prefix+'/file',{headers:{authorization:'Bearer '+await f.merchantToken(buyer)}});assert.deepEqual(Buffer.from(await native.arrayBuffer()),f.file.bytes);
  assert.equal((await f.view(order)).items[0].canPublish,false);const proof=await f.part(prefix,1);assert.equal((await f.callBuyer(prefix+'/parts/1/receipt',proof)).status,200);
  assert.equal((await f.callBuyer(mediaPath,photoInput)).status,409,'Partial delivery does not authorize review media');
  assert.equal((await f.publish(order,item)).status,409);const second=await f.part(prefix,2);assert.equal((await f.callBuyer(prefix+'/parts/2/receipt',second)).status,200);
  assert.equal((await f.view(order)).items[0].canPublish,true);
  const photo=await f.callBuyer(mediaPath,photoInput);assert.equal(photo.status,200,photo.error);
  const saved=await f.publish(order,item,{photos:[photo.photo.id]});assert.equal(saved.status,200,saved.error);assert.equal(saved.review.verifiedPurchase,true);assert.equal(saved.review.rating,1);
  const publicView=await f.publicReviews();assert.equal(publicView.items.length,1);assert.equal(publicView.summary.average,1);assert(!JSON.stringify(publicView).match(/Private buyer|private@example|digital-review-buyer|dfile_|dgrant_|Panduan/));
  const publicPhoto=await f.mf.dispatchFetch('https://api.fixture.test/v1/public/reviews/'+saved.review.id+'/media/'+photo.photo.id);assert.equal(publicPhoto.status,200);assert.equal(publicPhoto.headers.get('content-type'),'image/png');assert((await publicPhoto.arrayBuffer()).byteLength<f.file.bytes.length);
});

test('each digital line needs its own original delivery and cannot borrow another file or physical shipment',async t=>{
  const f=await fixture(t),other=await digitalFixtureFile(f,{id:'workbook',sku:'WORKBOOK',bytes:Buffer.from('A different original file')});
  const order=await f.createOrder([f.file.item,other.item,{productId:'tea',quantity:1,expectedPrice:20000,expectedWeightGrams:100}],fixtureShipping);
  assert.equal((await f.paid(order)).status,200);const first=order.items.find(i=>i.productId==='guide'),second=order.items.find(i=>i.productId==='workbook'),physical=order.items.find(i=>i.productId==='tea');
  await f.complete(order,first);const items=(await f.view(order)).items;
  assert.equal(items.find(i=>i.orderItemId===first.id).canPublish,true);assert.equal(items.find(i=>i.orderItemId===second.id).canPublish,false);assert.equal(items.find(i=>i.orderItemId===physical.id).canPublish,false);
  const saved=await f.publish(order,first);assert.equal(saved.status,200,saved.error);assert.equal((await f.publish(order,second)).status,409);
  await assert.rejects(f.db.prepare(`INSERT INTO commerce_review_changes(review_id,seller_id,commerce_environment,product_id,customer_id,order_item_id,owner_auth_user_id,
    actor_kind,actor_auth_user_id,kind,request_key,request_hash,expected_revision,revision,data_json,created_at)
    SELECT 'review_forged_other',seller_id,commerce_environment,?,customer_id,?,owner_auth_user_id,actor_kind,actor_auth_user_id,kind,?,request_hash,0,1,data_json,created_at
    FROM commerce_review_changes WHERE review_id=?`).bind(other.id,second.id,key(),saved.review.id).run(),/review_purchase_required/);
  assert.equal((await f.db.prepare('SELECT COUNT(*) AS n FROM commerce_review_changes').first()).n,1);
  assert.equal((await f.callBuyer(f.path(order),undefined,'same-email-other-user')).status,404);assert.equal((await f.callBuyer(f.path(order),undefined,'alice')).status,404);
});

test('completed digital purchase reviews survive replacement and later refund, retain low ratings, and recover exact edits',async t=>{
  const f=await fixture(t),order=await f.createOrder(),item=order.items[0];await f.paid(order);await f.complete(order,item);
  const financeBefore=(await f.db.prepare('SELECT * FROM commerce_financial_entries ORDER BY journal_sequence,line_number').all()).results;
  await digitalFixtureFile(f,{replace:true,bytes:Buffer.from('Unrelated new edition')});
  await f.db.prepare("UPDATE products SET status='archived' WHERE id='guide'").run();await f.db.prepare("UPDATE orders SET checkout_state='refunded' WHERE id=?").bind(order.id).run();
  assert.equal((await f.view(order)).items[0].canPublish,true,'A refund after real delivery does not erase the buyer experience');
  const requestKey=key(),first=await f.publish(order,item,{requestKey});assert.equal(first.status,200,first.error);assert.equal((await f.publish(order,item,{requestKey})).review.id,first.review.id);
  const edited=await f.publish(order,item,{revision:1,rating:2,body:'Edited after more use.'});assert.equal(edited.status,200,edited.error);
  const withdraw=await f.callBuyer(f.path(order),{kind:'withdraw',orderItemId:item.id,requestKey:key(),revision:2});assert.equal(withdraw.status,200,withdraw.error);assert.equal(withdraw.review.state,'withdrawn');
  assert.deepEqual((await f.db.prepare('SELECT * FROM commerce_financial_entries ORDER BY journal_sequence,line_number').all()).results,financeBefore);
});

test('the review transaction rejects eligibility revoked after its preflight without writing a review',async t=>{
  const f=await fixture(t),order=await f.createOrder(),item=order.items[0];await f.paid(order);await f.complete(order,item);let changed=false;
  const DB=new Proxy(f.db,{get(target,name){if(name==='prepare')return sql=>{const statement=target.prepare(sql);if(!sql.startsWith('INSERT INTO commerce_review_changes'))return statement;return {bind(...args){const bound=statement.bind(...args);return {async run(){changed=true;await f.db.prepare("UPDATE orders SET checkout_state='failed' WHERE id=?").bind(order.id).run();return bound.run();}};}};};return typeof target[name]==='function'?target[name].bind(target):target[name];}});
  await assert.rejects(saveBuyerReview({DB,APP_ENVIRONMENT:'test',COMMERCE_STORAGE:'d1'},{id:buyer},order.id,{kind:'publish',orderItemId:item.id,requestKey:key(),revision:0,rating:5,title:'Race',body:'',publicName:'Reader',photos:[]}),error=>error instanceof Response&&error.status===409);
  assert.equal(changed,true);assert.equal((await f.db.prepare('SELECT COUNT(*) AS n FROM commerce_review_changes').first()).n,0);
});
