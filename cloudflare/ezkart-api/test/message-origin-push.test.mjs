import test from 'node:test';
import assert from 'node:assert/strict';
import {randomBytes,createHash,createHmac} from 'node:crypto';
import {setupCommerceFixture} from './commerce-fixture.mjs';
import {dispatchNotifications} from '../src/commerce-notification-dispatch.js';
import {dispatchCustomerPush,encryptedPushRequest,validatePushEndpoint} from '../src/customer-web-push.js';
const b64=x=>Buffer.from(x).toString('base64url'),raw=x=>Buffer.from(x,'base64url'),key=()=>randomBytes(16).toString('hex'),buyer='message-buyer';
async function config(){const vapid=await crypto.subtle.generateKey({name:'ECDSA',namedCurve:'P-256'},true,['sign','verify']),jwk=await crypto.subtle.exportKey('jwk',vapid.privateKey);
 return {CUSTOMER_WEB_PUSH:'enabled',WEB_PUSH_VAPID_PUBLIC_KEY:b64(await crypto.subtle.exportKey('raw',vapid.publicKey)),WEB_PUSH_VAPID_PRIVATE_KEY:jwk.d,WEB_PUSH_VAPID_SUBJECT:'mailto:fixture@example.test'};}
async function subscription(){const pair=await crypto.subtle.generateKey({name:'ECDH',namedCurve:'P-256'},true,['deriveBits']),auth=randomBytes(16);
 return {pair,auth,value:{endpoint:'https://fcm.googleapis.com/fcm/send/'+key(),expirationTime:null,keys:{p256dh:b64(await crypto.subtle.exportKey('raw',pair.publicKey)),auth:b64(auth)}}};}
async function fixture(t){const settings=await config(),f=await setupCommerceFixture(t,{notifications:'scheduled',bindings:settings});
 const api=(path,input,who=buyer)=>f.merchant('/v1/'+(who===buyer||who==='stranger'?'customer':'commerce')+'/messages'+path,input,{seller:who,method:input===undefined?'GET':'POST'});
 const env={DB:f.db,APP_ENVIRONMENT:'test',COMMERCE_STORAGE:'d1',COMMERCE_NOTIFICATIONS:'scheduled',...settings,PRIVATE_ASSETS:await f.mf.getR2Bucket('PRIVATE_ASSETS')};
 return {...f,settings,env,api};}
test('message source resolves saved tracking records, survives expiry/reload and refuses caller labels and wrong tenants',async t=>{
 const f=await fixture(t),visit=randomBytes(32).toString('hex'),hash=createHash('sha256').update('tracking:sandbox:'+visit).digest('hex'),campaign='trk_'+key(),source=randomBytes(32).toString('hex');
 await f.db.prepare(`INSERT INTO tracking_campaigns(id,seller_id,commerce_environment,name,request_hash,started_at) VALUES(?,'seller_alice','sandbox','September Launch','fixture',?)`).bind(campaign,new Date().toISOString()).run();
 await f.db.prepare("INSERT INTO tracking_pages VALUES(?,'zero-syrup','Zero Syrup','/alice/shop/zero-syrup')").bind(campaign).run();
 await f.db.prepare("INSERT INTO tracking_sources VALUES(?,?,'zero-syrup','Facebook',?)").bind(source,campaign,new Date().toISOString()).run();
 await f.db.prepare('INSERT INTO tracking_visits VALUES(?,?,?,?,?,?)').bind(hash,source,'fixture',new Date().toISOString(),new Date(Date.now()+3600000).toISOString(),JSON.stringify({utmSource:'Spoofed platform'})).run();
 const spoof=await f.api('',{context:{kind:'product',id:'tea'},origin:{trackingVisit:visit,platform:'Fake'}});assert.equal(spoof.status,422);
 const foreign=await f.api('',{context:{kind:'product',id:'private'},origin:{trackingVisit:visit}});assert.equal(foreign.conversation.origin,null);
 const response=await f.api('',{context:{kind:'product',id:'tea'},origin:{pageId:'zero-syrup',trackingVisit:visit}});assert.equal(response.status,200,response.error);
 const expected={pageId:'zero-syrup',pageName:'Zero Syrup',platform:'Facebook',campaign:'September Launch',campaignId:campaign,verifiedTrackingLink:true};assert.deepEqual(response.conversation.origin,expected);
 await f.db.prepare("UPDATE tracking_visits SET expires_at='2000-01-01T00:00:00.000Z' WHERE token_hash=?").bind(hash).run();
 assert.deepEqual((await f.api('/'+response.conversation.id,undefined,'alice')).conversation.origin,expected);
 assert.deepEqual((await f.api('',undefined,'alice')).items[0].origin,expected);
 await assert.rejects(f.db.prepare("UPDATE commerce_message_origins SET origin_json='{}'").run(),/immutable_message_origin/);
 assert.equal((await f.api('/'+response.conversation.id,undefined,'stranger')).status,404);
 const missing=await f.api('',{context:{kind:'product',id:'tea'},origin:{trackingVisit:'a'.repeat(64)}},'stranger');assert.equal(missing.conversation.origin,null);
 await f.env.PRIVATE_ASSETS.put('sellers/seller_alice/landing-pages/plain-page.json',JSON.stringify({id:'plain-page',name:'Plain Page',status:'published',publishedHtml:'<html></html>'}));
 const plain=await f.api('',{context:{kind:'product',id:'tea'},origin:{pageId:'plain-page'}},'stranger');assert.equal(plain.conversation.origin.pageName,'Plain Page');assert.equal(plain.conversation.origin.platform,null);assert.equal(plain.conversation.origin.campaign,null);
});
test('authenticated push subscriptions are bounded, reject SSRF, isolate revocation and invalidate previous account deliveries',async t=>{
 const f=await fixture(t),s=await subscription();assert.equal((await f.api('/push')).available,true);
 assert.equal((await f.api('/push',{action:'subscribe',subscription:s.value})).subscribed,true);
 const row=await f.db.prepare('SELECT * FROM customer_push_subscriptions').first();
 await f.api('/push',{action:'subscribe',subscription:s.value});assert.equal((await f.db.prepare('SELECT generation FROM customer_push_subscriptions').first()).generation,row.generation);
 assert.equal((await f.api('/push',{action:'status',endpoint:s.value.endpoint},'stranger')).subscribed,false);
 await f.api('/push',{action:'revoke',endpoint:s.value.endpoint},'stranger');assert.equal((await f.db.prepare('SELECT active FROM customer_push_subscriptions').first()).active,1);
 for(const endpoint of ['http://fcm.googleapis.com/fcm/send/x','https://127.0.0.1/private','https://fcm.googleapis.com.attacker.test/x','https://web.push.apple.com:443/x','https://user@fcm.googleapis.com/x']){
  // URL normalizes the standard port; explicit default 443 is harmless.
  if(endpoint.includes(':443'))continue;
  assert.equal((await f.api('/push',{action:'subscribe',subscription:{...s.value,endpoint}})).status,422);
 }
 assert.throws(()=>validatePushEndpoint('https://localhost/x'));
 assert.equal((await f.api('/push',{action:'subscribe',subscription:{...s.value,keys:{...s.value.keys,p256dh:b64(randomBytes(65))}}})).status,422);
 assert.equal((await f.api('/push',{action:'subscribe',subscription:s.value,actorId:'stranger'})).status,422);
 await f.api('/push',{action:'subscribe',subscription:s.value},'stranger');const moved=await f.db.prepare('SELECT * FROM customer_push_subscriptions').first();assert.equal(moved.actor_id,'stranger');assert.notEqual(moved.generation,row.generation);
 await f.api('/push',{action:'revoke',endpoint:s.value.endpoint},'stranger');assert.equal((await f.db.prepare('SELECT active FROM customer_push_subscriptions').first()).active,0);
 await f.api('/push',{action:'subscribe',subscription:s.value});
 for(let n=0;n<9;n++)assert.equal((await f.api('/push',{action:'subscribe',subscription:{...s.value,endpoint:s.value.endpoint+'-'+n}})).status,200);
 assert.equal((await f.api('/push',{action:'subscribe',subscription:{...s.value,endpoint:s.value.endpoint+'-overflow'}})).status,409);
 assert.equal((await f.merchant('/v1/customer/messages/push',undefined,{seller:buyer,method:'DELETE'})).status,405);
});
async function decrypt(request,s){const body=Buffer.from(await request.arrayBuffer()),salt=body.subarray(0,16),sender=body.subarray(21,21+body[20]);assert.equal(body.readUInt32BE(16),4096);
 const peer=await crypto.subtle.importKey('raw',sender,{name:'ECDH',namedCurve:'P-256'},false,[]),secret=Buffer.from(await crypto.subtle.deriveBits({name:'ECDH',public:peer},s.pair.privateKey,256));
 const h=(k,v)=>createHmac('sha256',k).update(v).digest(),expand=(k,v,n)=>h(k,Buffer.concat([Buffer.from(v),Buffer.from([1])])).subarray(0,n);
 const ikm=expand(h(s.auth,secret),Buffer.concat([Buffer.from('WebPush: info\0'),raw(s.value.keys.p256dh),sender]),32),prk=h(salt,ikm);
 const aes=await crypto.subtle.importKey('raw',expand(prk,'Content-Encoding: aes128gcm\0',16),'AES-GCM',false,['decrypt']);
 const clear=Buffer.from(await crypto.subtle.decrypt({name:'AES-GCM',iv:expand(prk,'Content-Encoding: nonce\0',12)},aes,body.subarray(21+body[20])));assert.equal(clear.at(-1),2);return JSON.parse(clear.subarray(0,-1));}
test('fixture push encrypts RFC payload and VAPID signature; leases send once, opt-in avoids backfill and gone endpoints revoke',async t=>{
 const f=await fixture(t),s=await subscription(),start=await f.api('',{context:{kind:'product',id:'tea'}}),id=start.conversation.id;
 const send=body=>f.api('/'+id,{kind:'message',body,photos:[],requestKey:key()},'alice');
 await send('Old private message');await dispatchNotifications(f.env);await f.api('/push',{action:'subscribe',subscription:s.value});
 await send('Never include this private text');await dispatchNotifications(f.env);
 let count=0;const sender=async request=>{count++;assert.equal(request.headers.get('content-encoding'),'aes128gcm');const data=await decrypt(request,s);assert.equal(data.url,'https://test.ezkart.id/cart/messages.php?conversation='+id);assert(!JSON.stringify(data).includes('private'));assert.equal(data.body,'Open Messages to read your reply.');
  const auth=request.headers.get('authorization'),jwt=auth.match(/t=([^,]+)/)[1],parts=jwt.split('.'),claims=JSON.parse(raw(parts[1]));assert.equal(claims.aud,'https://fcm.googleapis.com');assert.equal(claims.sub,'mailto:fixture@example.test');
  const pub=await crypto.subtle.importKey('raw',raw(f.settings.WEB_PUSH_VAPID_PUBLIC_KEY),{name:'ECDSA',namedCurve:'P-256'},false,['verify']);assert(await crypto.subtle.verify({name:'ECDSA',hash:'SHA-256'},pub,raw(parts[2]),new TextEncoder().encode(parts.slice(0,2).join('.'))));return new Response(null,{status:201});};
 await Promise.all([dispatchCustomerPush(f.env,{send:sender}),dispatchCustomerPush(f.env,{send:sender})]);assert.equal(count,1);
 await dispatchCustomerPush(f.env,{send:sender});assert.equal(count,1);
 await send('Second');await dispatchNotifications(f.env);await dispatchCustomerPush(f.env,{send:async()=>new Response(null,{status:410})});assert.equal((await f.db.prepare('SELECT active FROM customer_push_subscriptions').first()).active,0);
 await send('Disabled');await dispatchNotifications(f.env);await dispatchCustomerPush(f.env,{send:sender});assert.equal(count,1);
 assert.equal((await dispatchCustomerPush({...f.env,CUSTOMER_WEB_PUSH:'off'},{send:sender})).held,true);
});
test('shared-browser account transfer cancels old-generation pending sends and re-enabling does not replay history',async t=>{
 const f=await fixture(t),s=await subscription(),id=(await f.api('',{context:{kind:'product',id:'tea'}})).conversation.id;
 await f.api('/push',{action:'subscribe',subscription:s.value});
 await f.api('/'+id,{kind:'message',body:'Only the permanent buyer owns this reply',photos:[],requestKey:key()},'alice');await dispatchNotifications(f.env);
 await dispatchCustomerPush(f.env,{send:async()=>new Response(null,{status:503})});
 const pending=await f.db.prepare('SELECT * FROM customer_push_deliveries').first();assert.equal(pending.state,'pending');
 await f.api('/push',{action:'subscribe',subscription:s.value},'stranger');
 await f.db.prepare("UPDATE customer_push_deliveries SET available_at='2000-01-01T00:00:00.000Z'").run();let sent=0;
 await dispatchCustomerPush(f.env,{send:async()=>{sent++;return new Response(null,{status:201});}});assert.equal(sent,0);
 assert.equal((await f.db.prepare('SELECT state FROM customer_push_deliveries').first()).state,'revoked');
 await f.api('/push',{action:'subscribe',subscription:s.value});await dispatchCustomerPush(f.env,{send:async()=>{sent++;return new Response(null,{status:201});}});assert.equal(sent,0);
});
