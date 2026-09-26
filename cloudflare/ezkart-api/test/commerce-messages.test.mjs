import test from 'node:test';
import assert from 'node:assert/strict';
import {randomBytes} from 'node:crypto';
import {setupCommerceFixture} from './commerce-fixture.mjs';
import {sendMessage,saveReply} from '../src/commerce-messages.js';
import {cleanupMessagePhotos,uploadMessagePhoto} from '../src/commerce-message-media.js';
const key=()=>randomBytes(16).toString('hex'),buyer='message-buyer';
const png='data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a8x8AAAAASUVORK5CYII=';
async function fixture(t){
  const f=await setupCommerceFixture(t),call=(path,body,who=buyer)=>f.merchant('/v1/'+(who===buyer||who==='stranger'?'customer':'commerce')+'/messages'+path,body,{seller:who,method:body===undefined?'GET':'POST'});
  const start=async(context={kind:'product',id:'tea'},who=buyer)=>{const r=await call('',{context},who);assert.equal(r.status,200,r.error);return r.conversation.id;};
  const send=(id,body='Hello',who=buyer,extra={})=>call('/'+id,{kind:'message',body,photos:[],requestKey:key(),...extra},who);
  const state=(id,revision,state)=>call('/'+id,{kind:'state',revision,state,requestKey:key()},'alice');
  return {...f,callMessage:call,start,send,state,env:{DB:f.db,APP_ENVIRONMENT:'test',COMMERCE_STORAGE:'d1',PRIVATE_ASSETS:await f.mf.getR2Bucket('PRIVATE_ASSETS')}};
}
test('pre-sale and owned-order conversations enforce tenant, buyer and permanent ownership boundaries',async t=>{
  const f=await fixture(t),id=await f.start();assert.equal(await f.start(),id);
  assert.equal((await f.callMessage('',{context:{kind:'store',id:'seller_alice'}})).status,404);
  await f.db.prepare(`UPDATE sellers SET settings_json='{"storefront":{"enabled":true}}' WHERE id='seller_alice'`).run();assert.equal(await f.start({kind:'store',id:'seller_alice'}),id);
  const order=(await f.create(f.input({customer:{name:'Buyer',email:'buyer@example.test',phone:'081234567890',authUserId:buyer}}))).order;
  assert.equal(await f.start({kind:'order',id:order.id}),id);assert.equal(await f.start({kind:'order',id:order.id},'alice'),id);
  assert.equal((await f.callMessage('',{context:{kind:'order',id:order.id}},'stranger')).status,404);
  assert.equal((await f.callMessage('/'+id,undefined,'bob')).status,404);assert.equal((await f.callMessage('/'+id,undefined,'stranger')).status,404);
  assert.equal((await f.send(id,'wrong order',buyer,{context:{kind:'product',id:'private'}})).status,404);
  assert.equal((await f.callMessage('',{context:{kind:'product',id:'tea'},sellerId:'seller_bob'})).status,422);
  assert.deepEqual((await f.callMessage('',undefined,'bob')).items,[]);
  await f.db.prepare("UPDATE products SET status='draft' WHERE id='tea'").run();assert.equal((await f.callMessage('',{context:{kind:'product',id:'tea'}})).status,404);
  assert.equal((await f.send(id)).status,200);
});
test('concurrent sends append once, payload mismatches fail and stale state cannot hide a newer reply',async t=>{
  const f=await fixture(t),id=await f.start(),requestKey=key(),body={kind:'message',body:'First',photos:[],requestKey};
  const attempts=await Promise.all(Array.from({length:5},()=>f.callMessage('/'+id,body)));assert(attempts.every(r=>r.status===200));assert.equal(new Set(attempts.map(r=>r.event.id)).size,1);
  assert.equal((await f.callMessage('/'+id,{...body,body:'Altered'})).status,409);
  const two=await Promise.all([f.send(id,'Second'),f.send(id,'Third')]);assert(two.every(r=>r.status===200));
  assert.equal((await f.state(id,1,'resolved')).status,409);assert.equal((await f.state(id,3,'resolved')).status,200);
  assert.equal((await f.send(id,'Reopen')).conversation.state,'open');assert.equal((await f.state(id,5,'blocked')).status,200);
  assert.equal((await f.send(id,'Blocked')).status,409);assert.equal((await f.send(id,'Blocked store','alice')).status,409);
  assert.equal((await f.state(id,6,'open')).status,200);assert.equal((await f.send(id,'Allowed','alice')).status,200);
  await assert.rejects(f.db.prepare("UPDATE commerce_message_events SET body='tampered'").run(),/immutable_message/);
  await assert.rejects(f.db.prepare('DELETE FROM commerce_message_events').run(),/immutable_message/);
});
test('unread positions are monotonic per staff member and histories keep a fixed page boundary',async t=>{
  const f=await fixture(t),id=await f.start();const first=await f.send(id,'One'),second=await f.send(id,'Two'),third=await f.send(id,'Three');
  assert.equal((await f.callMessage('?unread=1',undefined,'alice')).items.length,1);
  const page=await f.callMessage('/'+id+'?limit=2',undefined,'alice');assert.deepEqual(page.items.map(e=>e.body),['Two','Three']);assert(page.nextCursor);
  await f.send(id,'New while paginating');const older=await f.callMessage('/'+id+'?limit=2&cursor='+page.nextCursor,undefined,'alice');assert.deepEqual(older.items.map(e=>e.body),['One']);
  assert.equal((await f.callMessage('/'+id+'/read',{eventId:third.event.id},'alice')).status,200);
  assert.equal((await f.callMessage('/'+id+'/read',{eventId:first.event.id},'alice')).readThrough,third.event.id);
  assert.equal((await f.callMessage('?unread=1',undefined,'alice')).items.length,1);
  assert.equal((await f.callMessage('/'+id+'/read',{eventId:9999},'alice')).status,403);
  const other=await f.start({kind:'product',id:'private'});const foreign=await f.send(other,'Other store');assert.equal((await f.callMessage('/'+id+'/read',{eventId:foreign.event.id},'alice')).status,403);
  assert.equal((await f.callMessage('/'+id+'?cursor='+page.nextCursor)).status,422);
  const stats=await f.callMessage('/stats',undefined,'alice');assert.equal(stats.needsResponse,1);assert.equal(stats.medianFirstResponseSeconds,null);
  await f.send(id,'Actual reply','alice');const after=await f.callMessage('/stats',undefined,'alice');assert.equal(after.needsResponse,0);assert(after.medianFirstResponseSeconds>=0);
});
test('private attachment bytes require participation, published linkage and current authorization',async t=>{
  const f=await fixture(t),id=await f.start(),input={requestKey:key(),dataUrl:png};
  const upload=await f.callMessage('/'+id+'/media',input);assert.equal(upload.status,200,upload.error);
  const photo=upload.photo.id,fetchPhoto=async(who,thread=id)=>f.mf.dispatchFetch('https://api.fixture.test/v1/'+(who===buyer?'customer':'commerce')+'/messages/'+thread+'/media/'+photo,{headers:{authorization:'Bearer '+await f.merchantToken(who)}});
  assert.equal((await fetchPhoto('alice')).status,404);assert.equal((await fetchPhoto(buyer)).status,200);
  assert.equal((await f.callMessage('/'+id+'/media',input)).photo.id,photo);
  assert.equal((await f.send(id,'Photo',buyer,{photos:[photo]})).status,200);
  const response=await fetchPhoto('alice');assert.equal(response.status,200);assert.equal(response.headers.get('cache-control'),'no-store');assert.equal(response.headers.get('content-type'),'image/png');
  assert.equal((await fetchPhoto('bob')).status,404);assert.equal((await f.send(id,'Reuse',buyer,{photos:[photo]})).status,409);
  assert.equal((await f.callMessage('/'+id+'/media',{requestKey:key(),dataUrl:'data:image/svg+xml;base64,PHN2Zy8+'})).status,422);
  await f.db.prepare("DELETE FROM seller_memberships WHERE auth_user_id='alice'").run();
  await assert.rejects(sendMessage(f.env,{kind:'merchant',id:'alice',sellerId:'seller_alice',role:'owner'},id,{kind:'message',body:'stale role',photos:[],requestKey:key()}),r=>r.status===404);
  assert.notEqual((await fetchPhoto('alice')).status,200);
  const me=await f.merchant('/v1/me');assert.equal(me.user.active_seller,null,'Reading the account cannot restore a removed membership');
  assert.equal((await f.db.prepare("SELECT COUNT(*) AS n FROM seller_memberships WHERE auth_user_id='alice'").first()).n,0);
});

test('inbox snapshots retain ordering during new activity, role downgrades are live, and abandoned photos are cleaned safely',async t=>{
  const f=await fixture(t),id=await f.start(),other=await f.start({kind:'product',id:'private'});
  await f.send(id,'First store');await f.send(other,'Second store');const page=await f.callMessage('?limit=1');assert.equal(page.items[0].id,other);assert(page.nextCursor);
  await f.send(id,'Newer activity after the page boundary');const next=await f.callMessage('?limit=1&cursor='+page.nextCursor);assert.equal(next.items[0].id,id);assert.equal(next.items[0].lastMessage,'First store');
  await f.db.prepare("UPDATE seller_memberships SET role='viewer' WHERE auth_user_id='alice'").run();
  assert.equal((await f.callMessage('/'+id,undefined,'alice')).canWrite,false);assert.equal((await f.send(id,'Viewer cannot send','alice')).status,403);
  const photoId='mphoto_'+key(),old=new Date(Date.now()-25*3600000).toISOString(),expired=new Date(Date.now()-3600000).toISOString(),r2='fixture-expired-photo';
  await f.db.prepare(`INSERT INTO commerce_message_media(id,conversation_id,commerce_environment,actor_kind,actor_id,request_key,content_hash,r2_key,mime_type,size_bytes,created_at,expires_at)
    VALUES(?,?,'sandbox','buyer',?,?,?,?,'image/png',10,?,?)`).bind(photoId,id,buyer,key(),'fixture',r2,old,expired).run();
  await f.env.PRIVATE_ASSETS.put(r2,'old bytes');assert.equal(await cleanupMessagePhotos(f.env),1);assert.equal(await f.env.PRIVATE_ASSETS.get(r2),null);
  assert.equal((await f.db.prepare('SELECT state FROM commerce_message_media WHERE id=?').bind(photoId).first()).state,'deleting');
  await f.env.PRIVATE_ASSETS.put(r2,'late upload');assert.equal(await cleanupMessagePhotos(f.env),1);assert.equal(await f.env.PRIVATE_ASSETS.get(r2),null);
  await assert.rejects(f.db.prepare("UPDATE commerce_message_media SET state='ready' WHERE id=?").bind(photoId).run(),/immutable_message_photo/);
});
test('attachment failures preserve pending upload and the same request completes without duplicate storage',async t=>{
  const f=await fixture(t),id=await f.start(),actor={kind:'buyer',id:buyer},input={requestKey:key(),dataUrl:png};
  await assert.rejects(uploadMessagePhoto({...f.env,PRIVATE_ASSETS:{put:async()=>{throw Error('interrupted');}}},actor,id,input),/interrupted/);
  const row=await f.db.prepare('SELECT state FROM commerce_message_media').first();assert.equal(row.state,'uploading');
  const ready=await uploadMessagePhoto(f.env,actor,id,input);assert(ready.photo.id);assert.equal((await f.db.prepare('SELECT COUNT(*) AS n FROM commerce_message_media').first()).n,1);
  assert.equal(await cleanupMessagePhotos(f.env),0);
});
test('saved replies have stable retry receipts, conflict protection and live role checks',async t=>{
  const f=await fixture(t),input={title:'Thank you',body:'Thanks for contacting our store.',state:'active',revision:0,requestKey:key()};
  const first=await f.callMessage('/replies',input,'alice');assert.equal(first.status,200,first.error);
  assert.deepEqual((await f.callMessage('/replies',input,'alice')).reply,first.reply);
  assert.equal((await f.callMessage('/replies',{...input,title:'Changed'},'alice')).status,409);
  const edit={...first.reply,body:'A real update',requestKey:key()};assert.equal((await f.callMessage('/replies',edit,'bob')).status,409);
  assert.equal((await f.callMessage('/replies',edit,'alice')).reply.revision,2);assert.equal((await f.callMessage('/replies',{...edit,requestKey:key()},'alice')).status,409);
  assert.equal((await f.callMessage('/replies',{...edit,revision:2,state:'archived',requestKey:key()},'alice')).status,200);
  assert.equal((await f.callMessage('/replies',undefined,'alice')).items.length,0);
  await f.db.prepare("UPDATE seller_memberships SET role='viewer' WHERE auth_user_id='alice'").run();
  assert.equal((await f.callMessage('/replies',input,'alice')).status,403);
  await assert.rejects(saveReply(f.env,{kind:'merchant',id:'alice',sellerId:'seller_alice',role:'owner'},{...input,requestKey:key()}),r=>r.status===403);
});
test('strict JSON, method and query limits reject ambiguous input; central hold rejects writes',async t=>{
  const f=await fixture(t),id=await f.start(),token=await f.merchantToken(buyer);
  for(const suffix of ['?limit=1&limit=2','?environment=production','?state=anything','?limit=51'])assert.equal((await f.callMessage(suffix)).status,422);
  const bad=await f.mf.dispatchFetch('https://api.fixture.test/v1/customer/messages/'+id,{method:'POST',headers:{authorization:'Bearer '+token,'content-type':'application/json'},body:'{"kind":"message","kind":"state"}'});assert.equal(bad.status,400);
  await assert.rejects(sendMessage({...f.env,COMMERCE_STORAGE:'files'},{kind:'buyer',id:buyer},id,{kind:'message',body:'Held',photos:[],requestKey:key()}),r=>r.status===503);
  assert.equal((await f.send(id,'x'.repeat(4001))).status,422);
  for(let n=0;n<40;n++)assert.equal((await f.send(id,'Message '+n)).status,200);
  assert.equal((await f.send(id,'Limited')).status,429);
});


test('buyers retain their private transcript after a store closes while new sends remain forbidden',async t=>{
  const f=await fixture(t),id=await f.start(),sent=await f.send(id,'Keep this order conversation');
  await f.db.prepare("UPDATE sellers SET status='closed' WHERE id='seller_alice'").run();
  const detail=await f.callMessage('/'+id);assert.equal(detail.status,200);assert.equal(detail.items[0].body,'Keep this order conversation');assert.equal(detail.canWrite,false);
  assert.equal((await f.callMessage('')).items.length,1);assert.equal((await f.callMessage('/'+id+'/read',{eventId:sent.event.id})).status,200);
  assert.equal((await f.send(id,'Cannot send')).status,403);assert.equal((await f.callMessage('/'+id,undefined,'stranger')).status,404);assert.equal((await f.callMessage('/'+id,undefined,'alice')).status,403);
});
