import {commerceHash,commerceStorageEnabled} from './commerce-orders.js';
import {currentCommerceEnvironment as mode} from './commerce-access.js';
import {deploymentProfile} from './deployment.js';
import {notificationsEnabled} from './notification-policy.js';
import {messageFields,messageFail} from './commerce-messages.js';

const enc=new TextEncoder(),bytes=s=>Uint8Array.from(atob(s.replace(/-/g,'+').replace(/_/g,'/')),c=>c.charCodeAt(0));
const b64=data=>btoa(String.fromCharCode(...new Uint8Array(data))).replace(/=/g,'').replace(/\+/g,'-').replace(/\//g,'_');
const join=(...arrays)=>{const result=new Uint8Array(arrays.reduce((n,a)=>n+a.length,0));let at=0;for(const a of arrays){result.set(a,at);at+=a.length;}return result;};
const random=()=>Array.from(crypto.getRandomValues(new Uint8Array(16)),v=>v.toString(16).padStart(2,'0')).join('');
const validKey=(value,length)=>{try{return typeof value==='string'&&/^[A-Za-z0-9_-]+$/.test(value)&&bytes(value).length===length;}catch{return false;}};
export function webPushConfigured(env){return commerceStorageEnabled(env)&&notificationsEnabled(env)&&env.CUSTOMER_WEB_PUSH==='enabled'&&validKey(env.WEB_PUSH_VAPID_PUBLIC_KEY,65)&&validKey(env.WEB_PUSH_VAPID_PRIVATE_KEY,32)&&/^mailto:[^\s@]+@[^\s@]+$|^https:\/\/[^\s]+$/.test(env.WEB_PUSH_VAPID_SUBJECT||'');}
export function pushStatus(env){return {available:webPushConfigured(env),publicKey:webPushConfigured(env)?env.WEB_PUSH_VAPID_PUBLIC_KEY:null};}
export function validatePushEndpoint(value){
 let url;try{url=new URL(value);}catch{messageFail('Browser push endpoint is invalid');}
 const allowed=url.hostname==='fcm.googleapis.com'||url.hostname==='updates.push.services.mozilla.com'||url.hostname==='web.push.apple.com'||/^[a-z0-9-]+\.notify\.windows\.com$/.test(url.hostname);
 if(typeof value!=='string'||value.length>2048||!allowed||url.protocol!=='https:'||url.username||url.password||url.hash||url.port||url.pathname==='/')messageFail('Browser push service is not supported');
 return url.href;
}
export async function savePushSubscription(env,actor,input){
 if(actor.kind!=='buyer')messageFail('Customer sign-in is required',403);
 if(!commerceStorageEnabled(env))messageFail('Messaging is not enabled yet',503);
 messageFields(input,['action','subscription','endpoint']);
 if(['status','revoke'].includes(input.action)){
  if(input.subscription!==undefined)messageFail('Push request is invalid');
  const endpoint=validatePushEndpoint(input.endpoint),id=await commerceHash(endpoint);
  if(input.action==='status')return {subscribed:Boolean(await env.DB.prepare('SELECT id FROM customer_push_subscriptions WHERE id=? AND actor_id=? AND commerce_environment=? AND active=1').bind(id,actor.id,mode(env)).first())};
  await env.DB.prepare('UPDATE customer_push_subscriptions SET active=0,updated_at=? WHERE id=? AND actor_id=? AND commerce_environment=?').bind(new Date().toISOString(),id,actor.id,mode(env)).run();
  return {subscribed:false};
 }
 if(input.action!=='subscribe'||input.endpoint!==undefined)messageFail('Push request is invalid');
 if(!webPushConfigured(env))messageFail('Browser notifications are not configured yet',503);
 const sub=input.subscription;messageFields(sub,['endpoint','expirationTime','keys']);messageFields(sub.keys,['p256dh','auth']);
 const endpoint=validatePushEndpoint(sub.endpoint);
 if(!validKey(sub.keys.p256dh,65)||bytes(sub.keys.p256dh)[0]!==4||!validKey(sub.keys.auth,16))messageFail('Browser push keys are invalid');
 try{await crypto.subtle.importKey('raw',bytes(sub.keys.p256dh),{name:'ECDH',namedCurve:'P-256'},false,[]);}catch{messageFail('Browser push key is invalid');}
 if(sub.expirationTime!==undefined&&sub.expirationTime!==null&&(!Number.isFinite(sub.expirationTime)||sub.expirationTime<Date.now()))messageFail('Browser subscription has expired');
 const id=await commerceHash(endpoint),now=new Date().toISOString();
 // Repeated confirmation preserves opt-in time; account/key changes reset it and
 // invalidate pending deliveries from a previous sign-in on this browser.
 try{await env.DB.prepare(`INSERT INTO customer_push_subscriptions(id,actor_id,commerce_environment,generation,endpoint,p256dh,auth,created_at,updated_at)
  VALUES(?,?,?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET actor_id=excluded.actor_id,commerce_environment=excluded.commerce_environment,
  generation=CASE WHEN active=1 AND actor_id=excluded.actor_id AND commerce_environment=excluded.commerce_environment AND p256dh=excluded.p256dh AND auth=excluded.auth THEN generation ELSE excluded.generation END,
  created_at=CASE WHEN active=1 AND actor_id=excluded.actor_id AND commerce_environment=excluded.commerce_environment AND p256dh=excluded.p256dh AND auth=excluded.auth THEN created_at ELSE excluded.created_at END,
  endpoint=excluded.endpoint,p256dh=excluded.p256dh,auth=excluded.auth,active=1,updated_at=excluded.updated_at`).bind(id,actor.id,mode(env),random(),endpoint,sub.keys.p256dh,sub.keys.auth,now,now).run();}catch(error){if(/customer_push_limit/.test(String(error)+String(error.cause||'')))messageFail('Disable an old browser notification subscription before adding another. The limit is ten.',409);throw error;}
 return {subscribed:true};
}
async function hmac(key,data){const k=await crypto.subtle.importKey('raw',key,{name:'HMAC',hash:'SHA-256'},false,['sign']);return new Uint8Array(await crypto.subtle.sign('HMAC',k,data));}
const expand=async(prk,info,length)=>(await hmac(prk,join(info,new Uint8Array([1])))).slice(0,length);
// RFC 8291 single-record aes128gcm, RFC 8292 ES256 VAPID. Payloads are
// deliberately generic: no message text, customer names, photos or credentials.
export async function encryptedPushRequest(env,subscription,payload){
 const endpoint=validatePushEndpoint(subscription.endpoint),receiver=bytes(subscription.p256dh),auth=bytes(subscription.auth);
 const pair=await crypto.subtle.generateKey({name:'ECDH',namedCurve:'P-256'},true,['deriveBits']);
 const sender=new Uint8Array(await crypto.subtle.exportKey('raw',pair.publicKey));
 const peer=await crypto.subtle.importKey('raw',receiver,{name:'ECDH',namedCurve:'P-256'},false,[]);
 const secret=new Uint8Array(await crypto.subtle.deriveBits({name:'ECDH',public:peer},pair.privateKey,256));
 const ikm=await expand(await hmac(auth,secret),join(enc.encode('WebPush: info\0'),receiver,sender),32);
 const salt=crypto.getRandomValues(new Uint8Array(16)),prk=await hmac(salt,ikm);
 const key=await crypto.subtle.importKey('raw',await expand(prk,enc.encode('Content-Encoding: aes128gcm\0'),16),'AES-GCM',false,['encrypt']);
 const iv=await expand(prk,enc.encode('Content-Encoding: nonce\0'),12),clear=join(enc.encode(JSON.stringify(payload)),new Uint8Array([2]));
 if(clear.length>3000)throw Error('Push payload is too large');
 const cipher=new Uint8Array(await crypto.subtle.encrypt({name:'AES-GCM',iv},key,clear));
 const header=new Uint8Array(5);new DataView(header.buffer).setUint32(0,4096);header[4]=sender.length;
 const pub=bytes(env.WEB_PUSH_VAPID_PUBLIC_KEY),jwk={kty:'EC',crv:'P-256',x:b64(pub.slice(1,33)),y:b64(pub.slice(33)),d:env.WEB_PUSH_VAPID_PRIVATE_KEY};
 const signing=await crypto.subtle.importKey('jwk',jwk,{name:'ECDSA',namedCurve:'P-256'},false,['sign']);
 const unsigned=b64(enc.encode(JSON.stringify({typ:'JWT',alg:'ES256'})))+'.'+b64(enc.encode(JSON.stringify({aud:new URL(endpoint).origin,exp:Math.floor(Date.now()/1000)+3600,sub:env.WEB_PUSH_VAPID_SUBJECT})));
 const jwt=unsigned+'.'+b64(await crypto.subtle.sign({name:'ECDSA',hash:'SHA-256'},signing,enc.encode(unsigned)));
 return new Request(endpoint,{method:'POST',redirect:'error',signal:AbortSignal.timeout(15000),headers:{Authorization:`vapid t=${jwt}, k=${env.WEB_PUSH_VAPID_PUBLIC_KEY}`,'Content-Encoding':'aes128gcm','Content-Type':'application/octet-stream',TTL:'300',Urgency:'normal'},body:join(salt,header,sender,cipher)});
}
export async function dispatchCustomerPush(env,{limit=10,send=fetch}={}){
 if(!webPushConfigured(env))return {held:true,sent:0,failed:0};
 if(!Number.isSafeInteger(limit)||limit<1||limit>25)throw Error('Push limit is invalid');
 const now=new Date().toISOString();
 await env.DB.prepare(`INSERT INTO customer_push_deliveries(event_id,subscription_id,generation,available_at,updated_at)
 SELECT e.id,s.id,s.generation,?,? FROM commerce_notification_events e JOIN commerce_notification_recipients r ON r.event_id=e.id AND r.actor_kind='buyer'
 JOIN commerce_conversations c ON c.id=e.conversation_id AND c.buyer_auth_user_id=r.actor_id JOIN sellers shop ON shop.id=c.seller_id AND shop.status='active'
 JOIN customer_push_subscriptions s ON s.actor_id=r.actor_id AND s.commerce_environment=e.commerce_environment AND s.active=1
 WHERE e.category='messages' AND e.suppression='' AND e.commerce_environment=? AND e.created_at>=s.created_at AND e.created_at>=? ON CONFLICT DO NOTHING`)
 .bind(now,now,mode(env),new Date(Date.now()-86400000).toISOString()).run();
 const jobs=await env.DB.prepare(`SELECT d.*,s.endpoint,s.p256dh,s.auth,e.conversation_id FROM customer_push_deliveries d JOIN customer_push_subscriptions s ON s.id=d.subscription_id
 JOIN commerce_notification_events e ON e.id=d.event_id WHERE e.commerce_environment=? AND d.available_at<=? AND d.attempts<3
 AND (d.state='pending' OR (d.state='sending' AND d.lease_until<?)) ORDER BY d.available_at LIMIT ?`).bind(mode(env),now,now,limit).all();
 const result={held:false,sent:0,failed:0};
 for(const job of jobs.results){
  const token=random(),until=new Date(Date.now()+90000).toISOString();
  const claim=await env.DB.prepare(`UPDATE customer_push_deliveries SET state='sending',attempts=attempts+1,lease_token=?,lease_until=?,updated_at=?
   WHERE event_id=? AND subscription_id=? AND generation=? AND (state='pending' OR (state='sending' AND lease_until<?)) AND attempts<3`).bind(token,until,now,job.event_id,job.subscription_id,job.generation,now).run();
  if(!claim.meta.changes)continue;
  let state='pending';
  // Recheck opt-in, sign-in ownership, current store and conversation ownership
  // immediately before sending. Never fan out a recipient list from the browser.
  const live=await env.DB.prepare(`SELECT s.id FROM customer_push_subscriptions s JOIN commerce_notification_events e ON e.id=? JOIN commerce_conversations c ON c.id=e.conversation_id
   JOIN sellers shop ON shop.id=c.seller_id WHERE s.id=? AND s.generation=? AND s.active=1 AND s.actor_id=c.buyer_auth_user_id AND s.commerce_environment=e.commerce_environment AND shop.status='active'`)
   .bind(job.event_id,job.subscription_id,job.generation).first();
  if(!live)state='revoked';
  else try{
   const url=deploymentProfile(env).origin+'/cart/messages.php?conversation='+job.conversation_id;
   const response=await send(await encryptedPushRequest(env,job,{title:'New message from your store',body:'Open Messages to read your reply.',url,tag:job.event_id}));
   if(response.status>=200&&response.status<300){state='sent';result.sent++;}
   else if([404,410].includes(response.status)){state='revoked';await env.DB.prepare('UPDATE customer_push_subscriptions SET active=0,updated_at=? WHERE id=? AND generation=?').bind(now,job.subscription_id,job.generation).run();}
   else if(response.status<500&&response.status!==429)state='failed';
  }catch{/* A transport interruption retries the same event/tag, never its message. */}
  if(state==='pending'&&job.attempts>=2)state='failed';
  if(state==='failed')result.failed++;
  await env.DB.prepare(`UPDATE customer_push_deliveries SET state=?,lease_token=NULL,lease_until=NULL,available_at=?,updated_at=? WHERE event_id=? AND subscription_id=? AND generation=? AND lease_token=?`)
   .bind(state,new Date(Date.now()+60000).toISOString(),new Date().toISOString(),job.event_id,job.subscription_id,job.generation,token).run();
 }
 return result;
}
