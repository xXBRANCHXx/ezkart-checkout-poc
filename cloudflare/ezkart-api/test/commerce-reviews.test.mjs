import test from 'node:test';
import assert from 'node:assert/strict';
import {randomBytes} from 'node:crypto';
import {setupCommerceFixture,fixtureShipping} from './commerce-fixture.mjs';
import {applyCommerceSchema} from './commerce-schema.mjs';
import {cleanupReviewPhotos,reviewImage,uploadReviewPhoto} from '../src/commerce-review-media.js';

const buyer='review-buyer',key=()=>randomBytes(16).toString('hex');
const png='data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a8x8AAAAASUVORK5CYII=';
async function fixture(t){
  const f=await setupCommerceFixture(t);await f.db.prepare("UPDATE products SET stock_quantity=1000 WHERE id='tea'").run();
  const customer={name:'Private checkout name',email:'review@example.test',phone:'081234567890',authUserId:buyer};
  const create=async(overrides={})=>{const r=await f.create(f.input({shipping:fixtureShipping,customer,...overrides}));assert.equal(r.status,200,r.error);return r.order;};
  const buyerCall=(path,body,who=buyer)=>f.merchant(path,body,{seller:who,method:body===undefined?'GET':'POST'});
  const path=order=>`/v1/customer/orders/${order.id}/reviews`;
  const view=order=>buyerCall(path(order));
  const act=async(order,kind)=>{const detail=await f.merchant('/v1/fulfillment/'+order.id);const r=await f.merchant('/v1/fulfillment/'+order.id,{kind,revision:detail.order.revision,requestKey:key()},{method:'POST'});assert.equal(r.status,200,r.error);return r;};
  const ship=async(order,status='delivered',history)=>{
    assert.equal((await f.paid(order)).status,200);await act(order,'accept');const pickup=await act(order,'pickup'),id=pickup.receipt.shipmentId;
    assert.equal((await f.call(`/internal/commerce/shipments/${id}/account`,{environment:'sandbox',accountHash:'a'.repeat(64)})).status,200);
    const shipment=(await f.call(`/internal/commerce/shipments/${id}?environment=sandbox`)).shipment,providerId='provider_'+id;
    const response=await f.call(`/internal/commerce/shipments/${id}/bind`,{environment:'sandbox',verified:true,providerId,reference:shipment.reference,data:{kind:'status',status,updatedAt:new Date().toISOString(),...(history?{history}:{})}});
    assert.equal(response.status,200,response.error);return {id,providerId};
  };
  const body=async(order,extra={})=>({kind:'publish',orderItemId:(await view(order)).items[0].orderItemId,requestKey:key(),revision:0,rating:1,title:'Honest feedback',body:'Useful product feedback',publicName:'Buyer',photos:[],...extra});
  const publish=async(order,extra={})=>buyerCall(path(order),await body(order,extra));
  const merchant=(id,kind,revision,extra={})=>f.merchant('/v1/commerce/reviews/'+id,{kind,revision,requestKey:key(),...extra},{method:'POST'});
  const publicList=async(query='product=tea')=>{const response=await f.mf.dispatchFetch('https://api.fixture.test/v1/public/reviews?'+query);return {status:response.status,...await response.json()};};
  return {...f,create,buyerCall,path,view,ship,body,publish,merchantChange:merchant,publicList};
}

test('only the authoritative buyer may review a paid allocated purchase after actual courier delivery',async t=>{
  const f=await fixture(t),order=await f.create();
  assert.equal((await f.view(order)).items[0].canPublish,false);
  assert.equal((await f.publish(order)).status,409);
  assert.equal((await f.buyerCall(f.path(order),undefined,'alice')).status,404);
  assert.equal((await f.buyerCall(f.path(order),undefined,'same-email-account')).status,404);
  const shipment=await f.ship(order,'in_transit');assert.equal((await f.publish(order)).status,409);
  const at=new Date().toISOString();await f.call('/internal/commerce/shipping-events',{environment:'sandbox',providerId:shipment.providerId,data:{kind:'status',status:'delivered',updatedAt:at}});
  const saved=await f.publish(order);assert.equal(saved.status,200,saved.error);assert.equal(saved.review.rating,1);assert.equal(saved.review.state,'published');assert.equal(saved.review.verifiedPurchase,true);
  const publicView=await f.publicList();assert.equal(publicView.summary.average,1);assert.equal(publicView.items.length,1);
  assert(!JSON.stringify(publicView).includes('Private checkout'));assert(!JSON.stringify(publicView).includes('review@example.test'));assert(!JSON.stringify(publicView).includes(buyer));
  assert(!('orderId' in publicView.items[0]));assert(!('revision' in publicView.items[0]));
  await f.call('/internal/commerce/shipping-events',{environment:'sandbox',providerId:shipment.providerId,data:{kind:'status',status:'returned',updatedAt:new Date(Date.now()+1000).toISOString()}});
  const row=await f.db.prepare('SELECT state,delivered_at FROM commerce_shipments WHERE id=?').bind(shipment.id).first();assert.equal(row.state,'returned');assert.equal(row.delivered_at,at);
  assert.equal((await f.publish(order,{revision:1,rating:2})).status,200);
  await assert.rejects(f.db.prepare('UPDATE commerce_shipments SET delivered_at=NULL WHERE id=?').bind(shipment.id).run(),/immutable_delivery_evidence/);
  const skip=await f.create({shipping:{skipped:true,amount:0}});await f.paid(skip);assert.equal((await f.publish(skip)).status,409);
  const guest=await f.create({customer:{name:'Guest',email:'review@example.test',phone:'081234567890'}});
  assert.equal((await f.buyerCall(f.path(guest))).status,404);
  const claimed=await f.call(`/internal/commerce/orders/${guest.id}/claim`,{environment:'sandbox',customer:{id:buyer,email:'review@example.test'}});assert.equal(claimed.status,200,claimed.error);
  assert.equal((await f.view(guest)).status,200);
});

test('review changes replay safely, preserve immutable history and serialize competing revisions',async t=>{
  const f=await fixture(t),order=await f.create();await f.ship(order);const body=await f.body(order);
  const races=await Promise.all([f.buyerCall(f.path(order),body),f.buyerCall(f.path(order),body)]);assert(races.every(r=>r.status===200),JSON.stringify(races));
  const id=races[0].review.id;
  assert.equal((await f.buyerCall(f.path(order),{...body,rating:5})).status,409);
  const withdrawal={kind:'withdraw',orderItemId:body.orderItemId,requestKey:key(),revision:1};
  const competition=await Promise.all([f.buyerCall(f.path(order),withdrawal),f.publish(order,{revision:1,rating:4})]);assert.deepEqual(competition.map(r=>r.status).sort(),[200,409]);
  let current=(await f.view(order)).items[0].review;
  if(current.state!=='withdrawn'){assert.equal((await f.buyerCall(f.path(order),{...withdrawal,requestKey:key(),revision:current.revision})).status,200);current=(await f.view(order)).items[0].review;}
  const replay=await f.buyerCall(f.path(order),body);assert.equal(replay.receipt.revision,1);assert.equal(replay.receipt.replayed,true);assert.equal(replay.review.state,'withdrawn');assert.equal(replay.review.revision,current.revision);
  assert.equal((await f.publicList()).items.length,0);
  const history=await f.buyerCall(f.path(order)+'/'+id+'/history?limit=1');assert.equal(history.items.length,1);assert(history.nextCursor);
  const older=await f.buyerCall(f.path(order)+'/'+id+'/history?limit=1&cursor='+history.nextCursor);assert(older.items[0].revision<history.items[0].revision);
  assert.equal((await f.buyerCall(f.path(order)+'/'+id+'/history',undefined,'bob')).status,404);
  await assert.rejects(f.db.prepare("UPDATE product_reviews SET rating=5 WHERE id=?").bind(id).run(),/review_receipt_required/);
  await assert.rejects(f.db.prepare('DELETE FROM product_reviews WHERE id=?').bind(id).run(),/review_history_retained/);
  await assert.rejects(f.db.prepare("UPDATE commerce_review_changes SET kind='hide'").run(),/review_history_immutable/);
  await assert.rejects(f.db.prepare('DELETE FROM commerce_review_changes').run(),/review_history_immutable/);
});

test('merchant replies follow the reviewed content and moderation never changes buyer text or restores withdrawal',async t=>{
  const f=await fixture(t),order=await f.create();await f.ship(order);let saved=await f.publish(order),id=saved.review.id;
  assert.equal((await f.merchant('/v1/commerce/reviews/'+id,undefined,{seller:'bob'})).status,404);
  const reply=await f.merchantChange(id,'reply',1,{body:'Thank you for the specific feedback.'});assert.equal(reply.status,200,reply.error);assert.equal((await f.publicList()).items[0].reply.body,'Thank you for the specific feedback.');
  saved=await f.publish(order,{revision:2,rating:3,body:'Updated after use.'});assert.equal(saved.status,200,saved.error);
  assert.equal((await f.publicList()).items[0].reply,null);assert.equal(saved.review.savedReply.current,false);
  assert.equal((await f.merchantChange(id,'hide',3,{reason:'negative_rating',note:'I dislike the rating'})).status,422);
  const hidden=await f.merchantChange(id,'hide',3,{reason:'personal_information',note:'Please remove the phone number in the photo.'});assert.equal(hidden.status,200,hidden.error);assert.equal((await f.publicList()).summary.count,0);
  const view=(await f.view(order)).items[0].review;assert.equal(view.rating,3);assert.equal(view.body,'Updated after use.');assert.match(view.moderation.note,/phone number/);
  assert.equal((await f.publish(order,{revision:4,rating:4})).review.state,'hidden','A buyer edit cannot silently remove moderation');
  assert.equal((await f.buyerCall(f.path(order),{kind:'withdraw',revision:5,orderItemId:view.orderItemId,requestKey:key()})).status,200);
  const restored=await f.merchantChange(id,'restore',6);assert.equal(restored.status,200,restored.error);assert.equal(restored.review.state,'withdrawn');assert.equal((await f.publicList()).items.length,0);
  assert.equal((await f.publish(order,{revision:7,rating:2})).status,200);assert.equal((await f.publicList()).items[0].rating,2);
  await f.db.prepare("UPDATE seller_memberships SET role='viewer' WHERE auth_user_id='alice'").run();
  assert.equal((await f.merchantChange(id,'reply',8,{body:'Viewer reply'})).status,403);assert.equal((await f.merchant('/v1/commerce/reviews')).canWrite,false);
});

test('private review photos are owned, retryable, metadata-free and disappear publicly with their review',async t=>{
  const f=await fixture(t),order=await f.create();await f.ship(order);const line=(await f.view(order)).items[0];
  const uploadPath=`/v1/customer/orders/${order.id}/review-media`,input={orderItemId:line.orderItemId,requestKey:key(),dataUrl:png};
  const uploaded=await f.buyerCall(uploadPath,input);assert.equal(uploaded.status,200,uploaded.error);assert.deepEqual((await f.buyerCall(uploadPath,input)).photo,uploaded.photo);
  const photo=uploaded.photo.id;
  const binary=async(path,who)=>f.mf.dispatchFetch('https://api.fixture.test'+path,{headers:who?{authorization:'Bearer '+await f.merchantToken(who)}:{}});
  assert.equal((await binary('/v1/customer/review-media/'+photo,buyer)).status,200);assert.equal((await binary('/v1/customer/review-media/'+photo,'bob')).status,404);
  const saved=await f.publish(order,{photos:[photo]});assert.equal(saved.status,200,saved.error);const id=saved.review.id,publicPath=`/v1/public/reviews/${id}/media/${photo}`;
  const publicPhoto=await binary(publicPath);assert.equal(publicPhoto.status,200);assert.equal(publicPhoto.headers.get('cache-control'),'no-store');assert.equal(publicPhoto.headers.get('content-type'),'image/png');
  assert.equal((await binary(`/v1/commerce/reviews/${id}/media/${photo}`,'bob')).status,404);
  assert.equal((await f.merchantChange(id,'hide',1,{reason:'personal_information',note:'Private details are visible in this image.'})).status,200);assert.equal((await binary(publicPath)).status,404);
  assert.equal((await binary(`/v1/commerce/reviews/${id}/media/${photo}`,'alice')).status,200,'History evidence remains scoped and private');
  assert.equal((await f.merchantChange(id,'restore',2)).status,200);assert.equal((await binary(publicPath)).status,200);
  assert.equal((await f.publish(order,{revision:3,photos:[]})).status,200);assert.equal((await binary(publicPath)).status,404,'Removed photos cannot be fetched from old public URLs');
  const other=await f.create();await f.ship(other);assert.equal((await f.publish(other,{photos:[photo]})).status,409);
  assert.equal((await f.publish(order,{revision:4,photos:[photo,photo]})).status,422);
  await assert.rejects(f.db.prepare('DELETE FROM commerce_review_media_links').run(),/review_photo_link_immutable/);
  await assert.rejects(f.db.prepare('DELETE FROM commerce_review_media').run(),/review_photo_retained/);
  for(const value of ['data:image/svg+xml;base64,PHN2Zy8+','data:image/png;base64,PHN2Zy8+',png.slice(0,-8),'not data'])assert.equal((await f.buyerCall(uploadPath,{...input,requestKey:key(),dataUrl:value})).status,422);
});

test('review filters page the complete cohort and preserve legacy status without inventing verified purchases',async t=>{
  const f=await fixture(t),order=await f.create();await f.ship(order);const saved=await f.publish(order),customer=(await f.db.prepare('SELECT customer_id FROM orders WHERE id=?').bind(order.id).first()).customer_id;
  const insert=(id,rating,status='published',mode='legacy',product='tea')=>f.db.prepare(`INSERT INTO product_reviews(id,seller_id,product_id,customer_id,rating,title,body,status,created_at,updated_at,commerce_environment,moderation_state)
    VALUES(?,'seller_alice',?,?,?,'Legacy title','Legacy body',?,'2026-01-01T00:00:00.000Z','2026-01-01T00:00:00.000Z',?,?)`)
    .bind(id,product,customer,rating,status,mode,status==='published'?'visible':status==='pending'?'pending':'hidden').run();
  for(let i=0;i<61;i++)await insert('legacy_'+String(i).padStart(3,'0'),i%5+1);
  await insert('hidden_legacy',5,'rejected');await insert('pending_legacy',4,'pending');await insert('production_legacy',5,'published','production');await insert('mug_legacy',5,'published','legacy','mug');
  const first=await f.publicList('product=tea&limit=25');assert.equal(first.status,200,first.error);assert.equal(first.summary.count,62);assert.equal(first.summary.ratingSum,182);assert.equal(first.matching,62);assert.equal(first.items[0].id,saved.review.id);
  const catalog=(await f.merchant('/v1/catalog')).products.find(p=>p.id==='tea');assert.equal(catalog.reviewCount,62);assert.equal(catalog.ratingSum,182);assert.equal(catalog.rating,182/62);
  const shop=await f.mf.dispatchFetch('https://api.fixture.test/v1/storefront/view?product=tea'),product=(await shop.json()).products[0];assert.equal(product.reviewCount,62);assert.equal(product.ratingSum,182);assert.equal(product.rating,182/62);
  await insert('backdated_new',5);let items=[...first.items],cursor=first.nextCursor;
  while(cursor){const page=await f.publicList('product=tea&limit=25&cursor='+cursor);assert.equal(page.status,200,page.error);items.push(...page.items);cursor=page.nextCursor;}
  assert.equal(items.length,62);assert.equal(new Set(items.map(i=>i.id)).size,62);assert(items.filter(i=>i.id.startsWith('legacy')).every(i=>!i.verifiedPurchase));
  assert.equal((await f.publicList('product=tea&rating=5&cursor='+first.nextCursor)).status,422);
  const filtered=await f.publicList('product=tea&rating=1');assert.equal(filtered.matching,14);assert.equal(filtered.summary.count,63,'Summary is overall and does not re-average filtered reviews');
  const merchant=await f.merchant('/v1/commerce/reviews?state=pending');assert.equal(merchant.items.length,1);assert.equal(merchant.items[0].id,'pending_legacy');
  const approved=await f.merchantChange('pending_legacy','approve',0);assert.equal(approved.status,200,approved.error);assert.equal(approved.review.verifiedPurchase,false);assert.equal(approved.review.state,'published');
  assert.equal((await f.merchant('/v1/commerce/reviews?product=mug')).items.length,1);
  assert.equal((await f.merchant('/v1/commerce/reviews',undefined,{seller:'bob'})).items.length,0);
  for(const query of ['product=tea&rating=1&rating=2','product=tea&limit=51','product=tea&environment=production','product=tea&sort=evil'])assert.equal((await f.publicList(query)).status,422);
});

test('review photo cleanup retains attached history, removes orphan data and permits uncertain upload recovery',async t=>{
  const f=await fixture(t),order=await f.create();await f.ship(order);const item=(await f.view(order)).items[0].orderItemId;
  const bucket=await f.mf.getR2Bucket('PRIVATE_ASSETS'),mode={DB:f.db,PRIVATE_ASSETS:bucket},expires=new Date(Date.now()-4*86400000).toISOString(),created=new Date(Date.now()-5*86400000).toISOString();
  const id='rphoto_'+key(),r2='review-photos/orphan';
  await f.db.prepare(`INSERT INTO commerce_review_media(id,seller_id,commerce_environment,order_item_id,owner_auth_user_id,request_key,content_hash,r2_key,mime_type,size_bytes,created_at,expires_at)
    VALUES(?,'seller_alice','sandbox',?,?,?,?,?,'image/png',1,?,?)`).bind(id,item,buyer,key(),'hash',r2,created,expires).run();await bucket.put(r2,'x');
  assert.equal(await cleanupReviewPhotos(mode),1);assert.equal(await bucket.get(r2),null);assert.equal(await f.db.prepare('SELECT id FROM commerce_review_media WHERE id=?').bind(id).first(),null);
  const input={orderItemId:item,requestKey:key(),dataUrl:png},uploadPath=`/v1/customer/orders/${order.id}/review-media`,uploaded=await f.buyerCall(uploadPath,input);assert.equal(uploaded.status,200);
  assert.equal((await f.publish(order,{photos:[uploaded.photo.id]})).status,200);
  assert.equal(await cleanupReviewPhotos(mode),0);
});

test('review image containers strip embedded metadata and reject active or unbounded formats',()=>{
  const image=reviewImage(png);assert.equal(image.mime,'image/png');
  const original=Buffer.from(png.split(',')[1],'base64'),label=Buffer.from('Author\0Private name'),chunk=Buffer.alloc(label.length+12);chunk.writeUInt32BE(label.length);chunk.write('tEXt',4);label.copy(chunk,8);
  const tagged=Buffer.concat([original.subarray(0,33),chunk,original.subarray(33)]),clean=reviewImage('data:image/png;base64,'+tagged.toString('base64'));
  assert.deepEqual(clean.bytes,image.bytes);assert(!Buffer.from(clean.bytes).includes(Buffer.from('Private name')));
  const huge=Buffer.from(original);huge.writeUInt32BE(100000,16);assert.throws(()=>reviewImage('data:image/png;base64,'+huge.toString('base64')));
  assert.throws(()=>reviewImage('data:image/jpeg;base64,'+original.toString('base64')));
});

test('dated courier delivery history establishes eligibility without rewinding a later return',async t=>{
  const f=await fixture(t),order=await f.create(),at=new Date(Date.now()-60000).toISOString();
  const shipment=await f.ship(order,'returned',[{kind:'status',status:'delivered',updatedAt:at}]);
  const saved=await f.publish(order);assert.equal(saved.status,200,saved.error);
  const row=await f.db.prepare('SELECT state,delivered_at FROM commerce_shipments WHERE id=?').bind(shipment.id).first();assert.equal(row.state,'returned');assert.equal(row.delivered_at,at);
  const second=await f.create();await f.ship(second,'returned');assert.equal((await f.publish(second)).status,409,'Returned to the seller alone never proves buyer delivery');
});

test('failed object storage is retryable, upload quotas are transactional and expired drafts cannot be published',async t=>{
  const f=await fixture(t),order=await f.create();await f.ship(order);const item=(await f.view(order)).items[0].orderItemId,bucket=await f.mf.getR2Bucket('PRIVATE_ASSETS');
  let fail=true;const env={DB:f.db,APP_ENVIRONMENT:'test',COMMERCE_STORAGE:'d1',PRIVATE_ASSETS:{put:async(...args)=>{if(fail){fail=false;throw Error('Storage interrupted');}return bucket.put(...args);}}};
  const input={orderItemId:item,requestKey:key(),dataUrl:png};
  await assert.rejects(uploadReviewPhoto(env,{id:buyer},order.id,input),/Storage interrupted/);
  assert.equal((await f.db.prepare('SELECT state FROM commerce_review_media WHERE request_key=?').bind(input.requestKey).first()).state,'uploading');
  const recovered=await uploadReviewPhoto(env,{id:buyer},order.id,input);assert(recovered.photo.id);assert.equal((await f.db.prepare('SELECT COUNT(*) AS n FROM commerce_review_media').first()).n,1);
  const yesterday=new Date(Date.now()-86400000).toISOString(),expired='rphoto_'+key();
  await f.db.prepare(`INSERT INTO commerce_review_media(id,seller_id,commerce_environment,order_item_id,owner_auth_user_id,request_key,content_hash,r2_key,mime_type,size_bytes,created_at,expires_at)
    VALUES(?,'seller_alice','sandbox',?,?,?,?,?,'image/png',1,?,?)`).bind(expired,item,buyer,key(),'old',expired,yesterday,yesterday).run();
  await f.db.prepare("UPDATE commerce_review_media SET state='ready' WHERE id=?").bind(expired).run();
  assert.equal((await f.publish(order,{photos:[expired]})).status,409);assert.equal((await f.db.prepare('SELECT COUNT(*) AS n FROM product_reviews').first()).n,0,'The invalid photo rolls the review back');
  for(let n=1;n<29;n++)await uploadReviewPhoto(env,{id:buyer},order.id,{...input,requestKey:key()});
  const last=await Promise.allSettled([uploadReviewPhoto(env,{id:buyer},order.id,{...input,requestKey:key()}),uploadReviewPhoto(env,{id:buyer},order.id,{...input,requestKey:key()})]);
  assert.equal(last.filter(r=>r.status==='fulfilled').length,1);assert.equal(last.find(r=>r.status==='rejected').reason.status,429);
  assert.equal((await uploadReviewPhoto(env,{id:buyer},order.id,input)).photo.id,recovered.photo.id,'Retries do not consume another upload slot');
});

test('review request sizes, input fields and transactional projections cannot bypass the purchase or authorship rules',async t=>{
  const f=await fixture(t),order=await f.create();await f.ship(order);const body=await f.body(order);
  for(const patch of [{rating:0},{rating:'5'},{photos:{}},{publicName:''},{publicName:'Private\nName'},{environment:'production'},{ownerAuthUserId:'bob'},{revision:-1},{body:'x'.repeat(3001)}])assert.equal((await f.buyerCall(f.path(order),{...body,...patch})).status,422);
  const response=await f.mf.dispatchFetch('https://api.fixture.test'+f.path(order),{method:'POST',headers:{authorization:'Bearer '+await f.merchantToken(buyer),'content-type':'application/json'},
    body:new ReadableStream({start(c){c.enqueue(new TextEncoder().encode(JSON.stringify({...body,body:'x'.repeat(25000)})));c.close();}}),duplex:'half'});assert.equal(response.status,413);
  await f.db.prepare("CREATE TRIGGER test_review_projection_failure BEFORE INSERT ON product_reviews WHEN NEW.review_source='purchase' BEGIN SELECT RAISE(ABORT,'test_failure'); END").run();
  assert.equal((await f.buyerCall(f.path(order),body)).status,500);assert.equal((await f.db.prepare('SELECT COUNT(*) AS n FROM commerce_review_changes').first()).n,0);
  await f.db.prepare('DROP TRIGGER test_review_projection_failure').run();assert.equal((await f.buyerCall(f.path(order),body)).status,200);
  const row=await f.db.prepare('SELECT * FROM commerce_review_changes').first(),insert=f.db.prepare(`INSERT INTO commerce_review_changes(review_id,seller_id,commerce_environment,product_id,customer_id,order_item_id,owner_auth_user_id,
    actor_kind,actor_auth_user_id,kind,request_key,request_hash,expected_revision,revision,data_json,created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`);
  const malicious={...JSON.parse(row.data_json),rating:5,buyerState:'withdrawn'};
  await assert.rejects(insert.bind(row.review_id,row.seller_id,row.commerce_environment,row.product_id,row.customer_id,row.order_item_id,row.owner_auth_user_id,'buyer',buyer,'withdraw',key(),'fake',1,2,JSON.stringify(malicious),new Date().toISOString()).run(),/review_content_changed/);
  await assert.rejects(insert.bind(row.review_id,row.seller_id,row.commerce_environment,row.product_id,row.customer_id,row.order_item_id,row.owner_auth_user_id,'merchant','alice','publish',key(),'fake',1,2,row.data_json,new Date().toISOString()).run(),/review_actor_forbidden/);
});

test('migration preserves historical reviews and backfills only bound shipments currently known as delivered',async t=>{
  const f=await setupCommerceFixture(t,{through:21}),created=await f.create(f.input({shipping:fixtureShipping})),order=created.order;await f.paid(order);
  let shipment;
  for(const kind of ['accept','pickup']){const d=await f.merchant('/v1/fulfillment/'+order.id),r=await f.merchant('/v1/fulfillment/'+order.id,{kind,revision:d.order.revision,requestKey:key()},{method:'POST'});assert.equal(r.status,200,r.error);if(kind==='pickup')shipment=r.receipt.shipmentId;}
  const at='2026-09-24T12:00:00.000Z';
  await f.db.prepare("UPDATE commerce_shipments SET provider_id='migrated_courier',provider_account_hash=?,state='delivered',status_at=?,bound_at=? WHERE id=?").bind('a'.repeat(64),at,at,shipment).run();
  const unproven=[];
  for(const kind of ['unbound','returned']){
    const other=(await f.create(f.input({shipping:fixtureShipping}))).order;await f.paid(other);let id;
    for(const action of ['accept','pickup']){const d=await f.merchant('/v1/fulfillment/'+other.id),r=await f.merchant('/v1/fulfillment/'+other.id,{kind:action,revision:d.order.revision,requestKey:key()},{method:'POST'});assert.equal(r.status,200,r.error);if(action==='pickup')id=r.receipt.shipmentId;}
    await f.db.prepare('UPDATE commerce_shipments SET provider_id=?,provider_account_hash=?,state=?,status_at=?,bound_at=? WHERE id=?')
      .bind(kind==='returned'?'migrated_returned':null,kind==='returned'?'a'.repeat(64):null,kind==='returned'?'returned':'delivered',at,at,id).run();unproven.push(id);
  }
  const customer=(await f.db.prepare('SELECT customer_id FROM orders WHERE id=?').bind(order.id).first()).customer_id;
  for(const [id,state] of [['old_public','published'],['old_pending','pending'],['old_hidden','rejected']])await f.db.prepare(`INSERT INTO product_reviews(id,seller_id,product_id,customer_id,rating,title,body,status,created_at,updated_at)
    VALUES(?,'seller_alice','tea',?,2,?,?,?,'2020-01-01T00:00:00.000Z','2020-01-01T00:00:00.000Z')`).bind(id,customer,'Historical '.repeat(15),'Historical body '.repeat(250),state).run();
  await applyCommerceSchema(f.db,21);
  assert.equal((await f.db.prepare('SELECT delivered_at FROM commerce_shipments WHERE id=?').bind(shipment).first()).delivered_at,at);
  for(const id of unproven)assert.equal((await f.db.prepare('SELECT delivered_at FROM commerce_shipments WHERE id=?').bind(id).first()).delivered_at,null);
  const rows=(await f.merchant('/v1/commerce/reviews')).items;assert.equal(rows.length,3);assert(rows.every(r=>!r.verifiedPurchase&&r.publicName==='Customer'&&r.revision===0));
  assert.equal(rows.find(r=>r.id==='old_public').state,'published');assert.equal(rows.find(r=>r.id==='old_hidden').state,'hidden');assert.equal(rows.find(r=>r.id==='old_pending').state,'pending');
  const approve=await f.merchant('/v1/commerce/reviews/old_pending',{kind:'approve',revision:0,requestKey:key()},{method:'POST'});assert.equal(approve.status,200,approve.error);assert.equal(approve.review.body,'Historical body '.repeat(250));assert.equal(approve.review.verifiedPurchase,false);
});
