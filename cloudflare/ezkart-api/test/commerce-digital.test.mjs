import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomBytes} from 'node:crypto';
import {setupCommerceFixture as setup,digest,fixtureShipping,customer} from './commerce-fixture.mjs';
import {digitalPartBytes} from '../src/digital-files.js';
import {digitalFixtureFile as digital} from './digital-commerce-fixture.mjs';
import {createCommerceOrder} from '../src/commerce-orders.js';
import {buyerDigitalFile,createDigitalDownloadGrant,digitalDownloadProof,buyerDigitalPart,acknowledgeDigitalPart} from '../src/commerce-digital.js';

const buyer={id:'buyer'},key=()=>randomBytes(16).toString('hex');
const ok=result=>{assert.equal(result.status,200,result.error);return result;};
async function environment(f,extra={}){return {DB:f.db,PRIVATE_ASSETS:await f.mf.getR2Bucket('PRIVATE_ASSETS'),APP_ENVIRONMENT:'test',COMMERCE_STORAGE:'d1',...extra};}

function input(f,file,extra={}){return f.input({customer:{...customer,authUserId:buyer.id},items:[file.item],shipping:{kind:'none',amount:0,skipped:false},...extra});}
const base=order=>'/v1/customer/orders/'+order.id+'/downloads';
async function view(f,order,user='buyer'){return f.merchant(base(order),undefined,{seller:user});}
async function grant(f,order,item=order.items[0],requestKey=key(),user='buyer'){
  return f.merchant(base(order)+'/'+item.id+'/grants',{requestKey},{method:'POST',seller:user});
}
async function download(f,order,item,grantId,{seller='buyer',method='GET',headers={}}={}){
  return f.mf.dispatchFetch('https://api.fixture.test'+base(order)+'/'+item.id+'/grants/'+grantId+'/file',{
    method,headers:{authorization:'Bearer '+await f.merchantToken(seller),...headers}});
}
const count=async(f,table)=>(await f.db.prepare('SELECT COUNT(*) AS n FROM '+table).first()).n;
async function responseError(promise,status){await assert.rejects(promise,err=>err instanceof Response&&err.status===status);}

test('digital-only checkout freezes a real file, needs no shipping or stock, and grants access only after primary capture',async t=>{
  const f=await setup(t),file=await digital(f),intent=input(f,file),order=ok(await f.create(intent)).order;
  assert.equal(order.items[0].productType,'digital');assert.equal(order.items[0].fulfillment.digitalFile.id,file.version);
  assert.equal(await count(f,'inventory_reservations'),0);assert.equal(await count(f,'commerce_digital_purchases'),1);
  assert.equal((await view(f,order)).items[0].canDownload,false);assert.equal((await grant(f,order)).status,409);
  assert.equal(await count(f,'commerce_digital_entitlements'),0);
  const paid=ok(await f.paid(order)).order;assert.equal(paid.fulfillmentState,'digital_access_ready');
  assert.equal(await count(f,'commerce_digital_entitlements'),1);
  const purchases=ok(await view(f,order));assert.equal(purchases.items[0].canDownload,true);
  assert.equal(purchases.items[0].deliveryConfirmed,false);assert.equal(purchases.deliveryVerificationAvailable,true);
  assert(!JSON.stringify(purchases).includes('r2_key'));assert(!JSON.stringify(purchases).includes(file.uploadId));
  const g=ok(await grant(f,order)).grant,r=await download(f,order,order.items[0],g.id);
  assert.equal(r.status,200,await (r.status!==200?r.text():Promise.resolve('')));
  assert.deepEqual(Buffer.from(await r.arrayBuffer()),file.bytes);
  assert.equal(r.headers.get('content-type'),'application/octet-stream');assert.match(r.headers.get('content-disposition'),/caf%C3%A9/);
  assert.equal(r.headers.get('cache-control'),'private, no-store');assert.match(r.headers.get('content-security-policy'),/sandbox allow-downloads/);
  assert.equal(await count(f,'commerce_digital_download_requests'),1);
  assert.equal((await view(f,order)).items[0].deliveryConfirmed,false,'Starting/sending a response is not verified complete delivery');
  ok(await f.paid(order,{},key()));assert.equal(await count(f,'commerce_digital_entitlements'),1);
  const actions=ok(await f.merchant('/v1/fulfillment/'+order.id));assert.equal(actions.canAccept,false);assert.equal(actions.canPickup,false);
  assert.equal(actions.pickupIssue,'');
});

test('mixed orders reserve and recover only physical stock and can accept courier fulfillment',async t=>{
  const f=await setup(t),file=await digital(f),intent=input(f,file,{items:[file.item,{productId:'tea',quantity:2,expectedPrice:20000,expectedWeightGrams:100}],shipping:fixtureShipping});
  const order=ok(await f.create(intent)).order;assert.equal(await count(f,'inventory_reservations'),1);
  const paid=ok(await f.paid(order)).order;assert.equal(paid.fulfillmentState,'awaiting_acceptance');assert.equal(await f.stock(),8);
  let details=ok(await f.merchant('/v1/fulfillment/'+order.id));assert.equal(details.canAccept,true);
  ok(await f.merchant('/v1/fulfillment/'+order.id,{requestKey:key(),revision:details.order.revision,kind:'accept'},{method:'POST'}));
  details=ok(await f.merchant('/v1/fulfillment/'+order.id));assert.equal(details.canPickup,true);
  assert.equal((await view(f,order)).items.length,1);
  const late=ok(await f.create({...intent,checkoutKey:key()})).order;
  ok(await f.event(late,'checkout.cancelled'));const later=ok(await f.paid(late)).order;assert.equal(later.fulfillmentState,'stock_review');
  const review=ok(await f.merchant('/v1/inventory/reviews/'+late.id));assert.equal(review.items.length,1);assert.equal(review.items[0].productId,'tea');assert.equal(review.canResolve,true);
  ok(await f.merchant('/v1/inventory/reviews/'+late.id,{requestKey:key(),revision:review.order.revision,confirmed:true,note:'Physical units checked before allocation',
    items:review.items.map(i=>({orderItemId:i.orderItemId,productRevision:i.current.revision}))},{method:'POST'}));
  assert.equal((await f.merchant('/v1/fulfillment/'+late.id)).canAccept,true);
  assert.equal((await view(f,late)).items[0].canDownload,true);
});

test('checkout retries and paid purchases retain the original version after replacement, archival and price changes',async t=>{
  const f=await setup(t),file=await digital(f),intent=input(f,file);
  const race=await Promise.all([f.create(intent),f.create(intent)]);for(const r of race)ok(r);assert.equal(race[0].order.id,race[1].order.id);
  const order=race[0].order;assert.equal(await count(f,'commerce_digital_purchases'),1);
  const replacement=await digital(f,{replace:true,bytes:Buffer.from('A different paid edition')});
  await f.db.prepare("UPDATE products SET price_amount=45000,status='archived' WHERE id='guide'").run();
  const retry=ok(await f.create(intent)).order;assert.equal(retry.items[0].fulfillment.digitalFile.id,file.version);assert.equal(retry.subtotal,25000);
  ok(await f.paid(order));const g=ok(await grant(f,order)).grant;
  const response=await download(f,order,order.items[0],g.id);assert.deepEqual(Buffer.from(await response.arrayBuffer()),file.bytes);
  assert.notEqual((await view(f,order)).items[0].file.id,replacement.version);
  assert.equal((await f.create({...intent,checkoutKey:key()})).status,409);
  await assert.rejects(f.db.prepare("UPDATE commerce_digital_purchases SET version_id=? WHERE order_id=?").bind(replacement.version,order.id).run(),/immutable_digital_purchase/);
  await assert.rejects(f.db.prepare('DELETE FROM commerce_digital_entitlements WHERE order_item_id=?').bind(order.items[0].id).run(),/immutable_digital_entitlement/);
});

test('digital checkout rejects missing/stale file identities and rolls back catalog changes during preflight',async t=>{
  const f=await setup(t),file=await digital(f),env=await environment(f);
  for(const change of [{expectedFileVersion:undefined},{expectedFileVersion:'dfile_'+'a'.repeat(32)},{expectedPrice:1},{expectedWeightGrams:100}]){
    assert.equal((await f.create(input(f,file,{items:[{...file.item,...change}]}))).status,409);
  }
  assert.equal((await f.create(input(f,file,{shipping:{amount:0,skipped:true}}))).status,409);
  assert.equal((await f.create(input(f,file,{shipping:{kind:'none',amount:0,skipped:false,destination:{}}}))).status,422);
  assert.equal((await f.create(f.input({shipping:{kind:'none',amount:0,skipped:false}}))).status,409);
  let changed=false;
  const db={prepare:sql=>f.db.prepare(sql),batch:async statements=>{
    // Product preflight is the first two-statement batch, then order creation.
    if(statements.length>3&&!changed){changed=true;await digital(f,{replace:true,bytes:Buffer.from('Replacement racing the checkout')});}
    return f.db.batch(statements);
  }};
  await responseError(createCommerceOrder({...env,DB:db},input(f,file)),409);assert.equal(changed,true);
  assert.equal(await count(f,'orders'),0);assert.equal(await count(f,'customers'),0);assert.equal(await count(f,'commerce_jobs'),0);
  assert.equal(await count(f,'commerce_digital_purchases'),0);
});

test('guest ownership, environment and buyer-bound grants prevent cross-account file access',async t=>{
  const f=await setup(t),file=await digital(f),order=ok(await f.create(input(f,file,{customer}))).order;ok(await f.paid(order));
  assert.equal((await view(f,order)).status,404);
  assert.equal((await f.merchant(base(order),undefined,{seller:'buyer',email:customer.email})).status,404);
  ok(await f.call('/internal/commerce/orders/'+order.id+'/claim',{environment:'sandbox',customer:{id:'buyer',email:customer.email}}));
  const intent=key(),race=await Promise.all([grant(f,order,order.items[0],intent),grant(f,order,order.items[0],intent)]);
  for(const r of race)ok(r);assert.equal(race[0].grant.id,race[1].grant.id);assert.equal(await count(f,'commerce_digital_download_grants'),1);
  const g=race[0].grant;
  for(const seller of ['alice','bob','other']){assert.equal((await view(f,order,seller)).status,404);assert.equal((await download(f,order,order.items[0],g.id,{seller})).status,404);}
  const anonymous=await f.mf.dispatchFetch('https://api.fixture.test'+base(order));assert.equal(anonymous.status,401);
  const env=await environment(f,{APP_ENVIRONMENT:'production'});
  await responseError(buyerDigitalFile(env,buyer,order.id,order.items[0].id,g.id,new Request('https://fixture.test')),404);
  const otherOrder=ok(await f.create(input(f,file))).order;ok(await f.paid(otherOrder));
  assert.equal((await grant(f,otherOrder,otherOrder.items[0],intent)).status,409);
  assert.equal((await download(f,otherOrder,otherOrder.items[0],g.id)).status,404);
  assert.equal((await f.merchant(base(order)+'?token=x',undefined,{seller:'buyer'})).status,400);
  for(const path of [base(order)+'/',base(order)+'/bad/grants',base(order)+'/item_example/grants/dgrant_bad/file'])assert.equal((await f.merchant(path,undefined,{seller:'buyer'})).status,400);
  const ambiguous=await f.mf.dispatchFetch('https://api.fixture.test'+base(order)+'/'+order.items[0].id+'/grants',{method:'POST',headers:{authorization:'Bearer '+await f.merchantToken('buyer'),'content-type':'application/json'},body:'{"requestKey":"'+key()+'","requestKey":"'+key()+'"}'});
  assert.equal(ambiguous.status,400);
  const range=await download(f,order,order.items[0],g.id,{headers:{range:'bytes=3-9'}});assert.equal(range.status,206);assert.deepEqual(Buffer.from(await range.arrayBuffer()),file.bytes.subarray(3,10));
  const head=await download(f,order,order.items[0],g.id,{method:'HEAD'});assert.equal(head.status,200);assert.equal(await head.text(),'');
  for(const range of ['bytes=100000-','bytes=2-1','bytes=0-1,4-5'])assert.equal((await download(f,order,order.items[0],g.id,{headers:{range}})).status,416);
  assert.equal(await count(f,'commerce_digital_download_requests'),1,'Only the real valid range request creates a start receipt');
});

test('payment review/refunds revoke current access and a change during R2 access prevents bytes escaping',async t=>{
  const f=await setup(t),file=await digital(f),order=ok(await f.create(input(f,file))).order;ok(await f.paid(order));
  const g=ok(await grant(f,order)).grant,env=await environment(f),request=new Request('https://fixture.test');
  const revoked={...env,PRIVATE_ASSETS:{get:async(...args)=>{const object=await env.PRIVATE_ASSETS.get(...args);await f.db.prepare('UPDATE orders SET payment_review=1 WHERE id=?').bind(order.id).run();return object;}}};
  await responseError(buyerDigitalFile(revoked,buyer,order.id,order.items[0].id,g.id,request),409);
  assert.equal(await count(f,'commerce_digital_download_requests'),0);
  assert.equal((await view(f,order)).items[0].state,'payment_review');
  assert.equal((await download(f,order,order.items[0],g.id)).status,409);
  await f.db.prepare("UPDATE orders SET payment_review=0,checkout_state='partially_refunded' WHERE id=?").bind(order.id).run();
  assert.equal((await view(f,order)).items[0].state,'refund_review');assert.equal((await grant(f,order)).status,409);
  await f.db.prepare("UPDATE orders SET checkout_state='refunded' WHERE id=?").bind(order.id).run();
  assert.equal((await view(f,order)).items[0].state,'refunded');assert.equal((await download(f,order,order.items[0],g.id)).status,409);
});

test('download intent survives lost writes, expired grants cannot fetch, and rate limits preserve exact retries',async t=>{
  const f=await setup(t),file=await digital(f),order=ok(await f.create(input(f,file))).order;ok(await f.paid(order));
  const env=await environment(f),item=order.items[0],requestKey=key();let lost=true;
  const wrapped={...env,DB:{prepare(sql){const q=f.db.prepare(sql);return {bind(...args){const bound=q.bind(...args);return {...bound,first:()=>bound.first(),run:async()=>{
    const r=await bound.run();if(lost&&sql.includes('INSERT INTO commerce_digital_download_grants')){lost=false;throw Error('Lost committed reply');}return r;
  }};}};}}};
  const recovered=await createDigitalDownloadGrant(wrapped,buyer,order.id,item.id,{requestKey});
  assert.equal(lost,false);assert.equal((await grant(f,order,item,requestKey)).grant.id,recovered.grant.id);
  const old=new Date(Date.now()-2*86400000).toISOString(),expires=new Date(Date.parse(old)+86400000).toISOString(),id='dgrant_'+key();
  await f.db.prepare('INSERT INTO commerce_digital_download_grants(id,order_item_id,auth_user_id,request_key,created_at,expires_at) VALUES (?,?,?,?,?,?)')
    .bind(id,item.id,'buyer',key(),old,expires).run();
  assert.equal((await download(f,order,item,id)).status,410);
  for(let i=1;i<20;i++)ok(await grant(f,order,item));
  assert.equal((await grant(f,order,item)).status,429);ok(await grant(f,order,item,requestKey));
  assert.equal(await count(f,'commerce_digital_download_requests'),0);
});

const partPath=(order,item,g,part)=>base(order)+'/'+item.id+'/grants/'+g+'/parts/'+part;
async function getPart(f,order,item,g,part,options={}){
  return f.mf.dispatchFetch('https://api.fixture.test'+partPath(order,item,g,part),{headers:{authorization:'Bearer '+await f.merchantToken(options.seller||'buyer'),...options.headers}});
}
async function ack(f,order,item,g,part,proof,options={}){
  return f.merchant(partPath(order,item,g,part)+'/receipt',{proof},{method:'POST',seller:'buyer',...options});
}

test('only proofs of every original part create immutable complete delivery evidence, once under concurrent acknowledgements',async t=>{
  const f=await setup(t),file=await digital(f,{bytes:randomBytes(digitalPartBytes+73)}),order=ok(await f.create(input(f,file))).order;ok(await f.paid(order));
  const g=ok(await grant(f,order)).grant,item=order.items[0];
  const journals=(await f.db.prepare('SELECT * FROM commerce_financial_journals ORDER BY sequence').all()).results;
  const entries=(await f.db.prepare('SELECT * FROM commerce_financial_entries ORDER BY journal_sequence,line_number').all()).results;
  assert.equal((await ack(f,order,item,g.id,1,'a'.repeat(64))).status,409);
  const firstRace=await Promise.all([getPart(f,order,item,g.id,1),getPart(f,order,item,g.id,1)]);
  for(const r of firstRace)assert.equal(r.status,200);assert.equal(firstRace[0].headers.get('x-ezkart-file-challenge'),firstRace[1].headers.get('x-ezkart-file-challenge'));
  const firstBytes=Buffer.from(await firstRace[0].arrayBuffer());await firstRace[1].arrayBuffer();
  assert.deepEqual(firstBytes,file.bytes.subarray(0,digitalPartBytes));assert.equal(firstRace[0].headers.get('x-ezkart-file-sha256'),digest(firstBytes));
  assert.equal((await ack(f,order,item,g.id,1,digest(firstBytes))).status,409,'The published checksum is not a receipt proof');
  const proof1=await digitalDownloadProof(g.id,1,firstRace[0].headers.get('x-ezkart-file-challenge'),firstBytes);
  const first=ok(await ack(f,order,item,g.id,1,proof1));assert.equal(first.deliveryConfirmed,false);
  assert.equal(await count(f,'commerce_digital_deliveries'),0);
  const second=await getPart(f,order,item,g.id,2),secondBytes=Buffer.from(await second.arrayBuffer());assert.deepEqual(secondBytes,file.bytes.subarray(digitalPartBytes));
  const proof2=await digitalDownloadProof(g.id,2,second.headers.get('x-ezkart-file-challenge'),secondBytes);
  assert.equal((await ack(f,order,item,g.id,2,proof1)).status,409);
  assert.equal((await ack(f,order,item,g.id,2,proof2,{seller:'bob'})).status,404);
  const complete=await Promise.all([ack(f,order,item,g.id,2,proof2),ack(f,order,item,g.id,2,proof2)]);
  for(const result of complete){ok(result);assert.equal(result.deliveryConfirmed,true);assert.equal(result.deliveredAt,complete[0].deliveredAt);}
  assert.equal(await count(f,'commerce_digital_deliveries'),1);assert.equal(await count(f,'commerce_digital_part_receipts'),2);
  assert.equal((await view(f,order)).items[0].deliveryConfirmed,true);
  assert.equal((await ack(f,order,item,g.id,2,'f'.repeat(64))).status,409);
  assert(!JSON.stringify(complete).includes(proof1));assert(!JSON.stringify(complete).includes(proof2));
  await assert.rejects(f.db.prepare('DELETE FROM commerce_digital_deliveries WHERE order_item_id=?').bind(item.id).run(),/immutable_digital_delivery/);
  assert.equal((await f.call('/internal/commerce/orders/'+order.id+'?environment=sandbox')).order.fulfillmentState,'digital_access_ready','This evidence does not manufacture settlement or change courier delivery');
  assert.deepEqual((await f.db.prepare('SELECT * FROM commerce_financial_journals ORDER BY sequence').all()).results,journals,'Delivery must not add a financial journal');
  assert.deepEqual((await f.db.prepare('SELECT * FROM commerce_financial_entries ORDER BY journal_sequence,line_number').all()).results,entries,'Delivery must not change captured accounting');
});

test('part integrity, payment changes, grant identity and direct receipt writes cannot bypass verification',async t=>{
  const f=await setup(t),file=await digital(f),order=ok(await f.create(input(f,file))).order;ok(await f.paid(order));
  const g=ok(await grant(f,order)).grant,item=order.items[0],env=await environment(f);
  const corrupt={...env,PRIVATE_ASSETS:{get:async(...args)=>{const object=await env.PRIVATE_ASSETS.get(...args);await object.body.cancel();return {body:new Response(Buffer.alloc(file.bytes.length)).body,size:object.size,customMetadata:object.customMetadata};}}};
  await responseError(buyerDigitalPart(corrupt,buyer,order.id,item.id,g.id,1),503);
  assert.equal(await count(f,'commerce_digital_part_challenges'),0);
  const r=await getPart(f,order,item,g.id,1),bytes=Buffer.from(await r.arrayBuffer()),nonce=r.headers.get('x-ezkart-file-challenge');
  const proof=await digitalDownloadProof(g.id,1,nonce,bytes);
  const another=ok(await grant(f,order)).grant;const r2=await getPart(f,order,item,another.id,1);await r2.arrayBuffer();
  assert.equal((await ack(f,order,item,another.id,1,proof)).status,409);
  await assert.rejects(f.db.prepare('INSERT INTO commerce_digital_deliveries(order_item_id,grant_id,auth_user_id,verified_at) VALUES (?,?,?,?)')
    .bind(item.id,g.id,'buyer',new Date().toISOString()).run(),/digital_proof_invalid/);
  assert.equal((await getPart(f,order,item,g.id,2)).status,404);
  assert.equal((await getPart(f,order,item,g.id,1,{headers:{range:'bytes=0-1'}})).status,405);
  await f.db.prepare('UPDATE orders SET payment_review=1 WHERE id=?').bind(order.id).run();
  assert.equal((await ack(f,order,item,g.id,1,proof)).status,409);assert.equal(await count(f,'commerce_digital_deliveries'),0);
  await assert.rejects(f.db.prepare('INSERT INTO commerce_digital_part_receipts(grant_id,part_number,proof_hash,verified_at) VALUES (?,1,?,?)')
    .bind(g.id,proof,new Date().toISOString()).run(),/digital_proof_invalid/,'A correct proof cannot bypass a payment hold inside the transaction');
});

test('lost committed part acknowledgements recover without another delivery or financial action',async t=>{
  const f=await setup(t),file=await digital(f),order=ok(await f.create(input(f,file))).order;ok(await f.paid(order));
  const g=ok(await grant(f,order)).grant,item=order.items[0],env=await environment(f),r=await getPart(f,order,item,g.id,1);
  const bytes=new Uint8Array(await r.arrayBuffer()),proof=await digitalDownloadProof(g.id,1,r.headers.get('x-ezkart-file-challenge'),bytes);let lost=true;
  const wrapped={...env,DB:{prepare(sql){const q=f.db.prepare(sql);return {bind(...args){const bound=q.bind(...args);return {first:()=>bound.first(),all:()=>bound.all(),run:async()=>{
    const result=await bound.run();if(lost&&sql.includes('INSERT INTO commerce_digital_part_receipts')){lost=false;throw Error('Lost part confirmation');}return result;
  }};}};}}};
  await assert.rejects(acknowledgeDigitalPart(wrapped,buyer,order.id,item.id,g.id,1,{proof}),/Lost part confirmation/);
  assert.equal(await count(f,'commerce_digital_deliveries'),1);
  const recovered=ok(await ack(f,order,item,g.id,1,proof));assert.equal(recovered.deliveryConfirmed,true);
  assert.equal(await count(f,'commerce_digital_deliveries'),1);assert.equal(await count(f,'commerce_digital_part_receipts'),1);
});

test('digital variants keep their own price and identity while sharing the purchased file, and production never needs a sandbox bypass',async t=>{
  const f=await setup(t),file=await digital(f),env=await environment(f);
  await f.db.prepare(`INSERT INTO product_variants(id,seller_id,product_id,name,options_json,sku,price_amount,stock_quantity,weight_grams,sort_order,created_at,updated_at)
    VALUES ('license_pro','seller_alice','guide','Professional','{"hidden":false}','PRO',45000,NULL,NULL,1,'now','now')`).run();
  assert.equal((await f.create(input(f,file))).status,409,'A variant cannot be bypassed by selecting the parent');
  const variant={...file.item,variantId:'license_pro',quantity:3,expectedPrice:45000};
  const order=ok(await f.create(input(f,file,{items:[variant]}))).order;assert.equal(order.subtotal,135000);assert.equal(order.items[0].fulfillment.variantName,'Professional');
  assert.equal(order.items[0].fulfillment.digitalFile.id,file.version);assert.equal(await count(f,'inventory_reservations'),0);
  await f.db.prepare(`UPDATE product_variants SET options_json='{"hidden":true}' WHERE id='license_pro'`).run();
  assert.equal((await f.create(input(f,file,{items:[variant]}))).status,409);ok(await f.paid(order));
  assert.equal((await view(f,order)).items[0].canDownload,true,'A catalog change must not remove a purchased option');
  await f.db.prepare(`UPDATE product_variants SET options_json='{}' WHERE id='license_pro'`).run();
  const production=await createCommerceOrder({...env,APP_ENVIRONMENT:'production'},input(f,file,{environment:'production',items:[variant],checkout:{intentHash:digest('production file fixture'),paymentFlow:'hosted',shop:'alice-shop'}}));
  assert.equal(production.snapshot.shipping.kind,'none');assert.equal(production.snapshot.shipping.skipped,false);assert.equal(production.shippingAmount,0);assert.match(production.id,/^EZK-P-/);
  assert.equal((await view(f,production)).status,404,'Sandbox buyer API cannot read a production fixture');
});
