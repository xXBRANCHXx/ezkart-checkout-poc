import {commerceHash,commerceStorageEnabled} from './commerce-orders.js';
import {currentCommerceEnvironment as mode,customerOrderSeller} from './commerce-access.js';
import {reviewCursor,readReviewCursor} from './commerce-reviews.js';
import {verifiedMessageOrigin} from './message-origin.js';

export const messageFail=(message,status=422)=>{throw new Response(message,{status});};
export const messageId=id=>typeof id==='string'&&/^conv_[a-f0-9]{32}$/.test(id);
export const messagePhotoId=id=>typeof id==='string'&&/^mphoto_[a-f0-9]{32}$/.test(id);
const ref=id=>typeof id==='string'&&/^[A-Za-z0-9][A-Za-z0-9_-]{2,95}$/.test(id);
export function messageFields(input,allowed){if(!input||typeof input!=='object'||Array.isArray(input)||Object.keys(input).some(k=>!allowed.includes(k)))messageFail('Message request is invalid');}
export function messageText(value,max,required=false){if(typeof value!=='string'||value.length>max||/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(value)||(required&&!value.trim()))messageFail('Message text is invalid');return value.trim();}
export function messageKey(key){if(typeof key!=='string'||!/^[a-f0-9]{32}$/.test(key))messageFail('Message request reference is invalid');}
export function messageWritable(env,actor){if(!commerceStorageEnabled(env))messageFail('Messaging is not enabled yet',503);if(actor.kind==='merchant'&&actor.role==='viewer')messageFail('Your store role cannot send or change messages',403);}
export function messageError(error){
  const detail=String(error)+' '+String(error.cause||'');
  if(/message_forbidden|message_read_invalid/.test(detail))messageFail('You cannot access this conversation',403);
  if(/message_revision|immutable_saved_reply_change/.test(detail))messageFail('This conversation or saved reply changed. Reload it before saving again.',409);
  if(/message_blocked/.test(detail))messageFail('This conversation is blocked. The store must reopen it before messages can be sent.',409);
  if(/message_photo_invalid/.test(detail))messageFail('A photo expired or was already sent. Upload it again.',409);
  if(/message_rate/.test(detail))messageFail('Too many messages or uploads. Please try again later.',429);
  if(/message_reply_limit/.test(detail))messageFail('Archive a saved reply before adding another. The limit is 100.',409);
  throw error;
}
const actorSql=actor=>actor.kind==='buyer'?'c.buyer_auth_user_id=?':`c.seller_id=? AND EXISTS(SELECT 1 FROM seller_memberships m WHERE m.seller_id=c.seller_id AND m.auth_user_id=?)`;
const actorBindings=actor=>actor.kind==='buyer'?[actor.id]:[actor.sellerId,actor.id];
export async function messageConversation(env,actor,id){
  if(!messageId(id))messageFail('Conversation not found',404);
  const row=await env.DB.prepare(`SELECT c.*,(SELECT origin_json FROM commerce_message_origins WHERE conversation_id=c.id) AS origin_json,s.status AS store_status,COALESCE(NULLIF(json_extract(s.settings_json,'$.storefront.name'),''),s.name) AS store_name FROM commerce_conversations c JOIN sellers s ON s.id=c.seller_id
    WHERE c.id=? AND c.commerce_environment=? AND ${actor.kind==='merchant'?"s.status='active' AND":''} ${actorSql(actor)}`).bind(id,mode(env),...actorBindings(actor)).first();
  if(!row)messageFail('Conversation not found',404);return row;
}
function conversationView(row,actor){return {id:row.id,storeId:row.seller_id,name:actor.kind==='buyer'?row.store_name:row.buyer_name,
  state:row.state,revision:row.revision,lastEventId:row.last_event_id,createdAt:row.created_at,origin:row.origin_json?JSON.parse(row.origin_json):null,
  ...(row.position!==undefined?{unread:Boolean(row.unread),needsResponse:Boolean(row.last_buyer>row.last_merchant),lastMessage:row.last_body||'',updatedAt:row.activity_at||row.created_at}:{})};}
// Context is re-authorized for every send. Browser-provided seller and buyer IDs
// are never accepted. A claimed order remains bound to its permanent account.
async function messageContext(env,actor,input,row=null){
  messageFields(input,['kind','id']);if(!['order','product','store'].includes(input.kind)||!ref(input.id))messageFail('Choose an order, product or store');
  let sellerId,buyerId,buyerName,view;
  if(input.kind==='order'){
    if(actor.kind==='buyer')await customerOrderSeller(env,actor,input.id);
    const order=await env.DB.prepare(`SELECT o.id,o.seller_id,o.customer_snapshot_json,COALESCE(a.auth_user_id,NULLIF(json_extract(o.customer_snapshot_json,'$.authUserId'),'')) AS buyer
      FROM orders o LEFT JOIN commerce_order_owners a ON a.order_id=o.id WHERE o.id=? AND o.commerce_environment=? AND o.commerce_version=1`).bind(input.id,mode(env)).first();
    if(!order||!order.buyer||(actor.kind==='merchant'&&order.seller_id!==actor.sellerId)||(actor.kind==='buyer'&&order.buyer!==actor.id))messageFail('Order not found or its buyer has not signed in yet',404);
    sellerId=order.seller_id;buyerId=order.buyer;buyerName=String(JSON.parse(order.customer_snapshot_json).name||'Customer').slice(0,100);
    view={kind:'order',id:order.id,label:order.id};
  }else{
    if(actor.kind!=='buyer'&&!row)messageFail('Choose an order belonging to a signed-in customer',422);
    const item=input.kind==='product'?await env.DB.prepare(`SELECT s.id,s.name,p.title FROM products p JOIN sellers s ON s.id=p.seller_id WHERE p.id=? AND p.status='active' AND s.status='active'`).bind(input.id).first():
      await env.DB.prepare(`SELECT s.id,s.name FROM sellers s WHERE s.id=? AND s.status='active' AND json_extract(s.settings_json,'$.storefront.enabled')=1`).bind(input.id).first();
    if(!item)messageFail('Store or product not found',404);
    sellerId=item.id;buyerId=row?.buyer_auth_user_id||actor.id;buyerName=messageText(actor.name||'Customer',100,true);
    view={kind:input.kind,id:input.id,label:(item.title||item.name).slice(0,160)};
  }
  if(row&&(row.seller_id!==sellerId||row.buyer_auth_user_id!==buyerId))messageFail('This context belongs to a different conversation',404);
  return {sellerId,buyerId,buyerName,view};
}
export async function startConversation(env,actor,input){
  messageWritable(env,actor);messageFields(input,['context','origin']);
  const context=await messageContext(env,actor,input.context),id='conv_'+(await commerceHash({mode:mode(env),seller:context.sellerId,buyer:context.buyerId})).slice(0,32);
  const origin=await verifiedMessageOrigin(env,actor,context.sellerId,input.origin);
  const previous=await env.DB.prepare('SELECT id FROM commerce_conversations WHERE id=?').bind(id).first();
  if(!previous){
    try{await env.DB.prepare(`INSERT INTO commerce_conversations(id,seller_id,commerce_environment,buyer_auth_user_id,buyer_name,created_at,context_kind,context_id,creator_kind,creator_id)
      SELECT ?,?,?,?,?,?,?,?,?,? WHERE EXISTS(SELECT 1 FROM sellers s WHERE s.id=? AND s.status='active')
      ${actor.kind==='merchant'?"AND EXISTS(SELECT 1 FROM seller_memberships WHERE seller_id=? AND auth_user_id=? AND role!='viewer')":''}
      ON CONFLICT(id) DO NOTHING`).bind(id,context.sellerId,mode(env),context.buyerId,context.buyerName,new Date().toISOString(),input.context.kind,input.context.id,actor.kind,actor.id,context.sellerId,
        ...(actor.kind==='merchant'?[actor.sellerId,actor.id]:[])).run();}catch(error){if(!await env.DB.prepare('SELECT id FROM commerce_conversations WHERE id=?').bind(id).first())messageError(error);}
  }
  await messageConversation(env,actor,id);
  if(origin)await env.DB.prepare('INSERT INTO commerce_message_origins(conversation_id,origin_json,created_at) VALUES(?,?,?) ON CONFLICT DO NOTHING').bind(id,JSON.stringify(origin),new Date().toISOString()).run();
  return {conversation:conversationView(await messageConversation(env,actor,id),actor),context:context.view};
}
const savedEvent=(env,actor,key)=>env.DB.prepare('SELECT * FROM commerce_message_events WHERE actor_kind=? AND actor_id=? AND commerce_environment=? AND request_key=?').bind(actor.kind,actor.id,mode(env),key).first();
function eventView(row,actor){return {id:row.id,kind:row.kind,body:row.body,photos:JSON.parse(row.media_json),context:JSON.parse(row.context_json),state:row.state,
  sender:row.actor_kind,mine:row.actor_kind===actor.kind,createdAt:row.created_at};}
export async function sendMessage(env,actor,id,input){
  messageWritable(env,actor);const isState=input?.kind==='state';
  messageFields(input,isState?['kind','state','revision','requestKey']:['kind','body','photos','context','requestKey']);
  if(!['message','state'].includes(input.kind))messageFail('Message action is invalid');messageKey(input.requestKey);
  const row=await messageConversation(env,actor,id),hash=await commerceHash({id,...input});
  const result=async(receipt,replayed)=>{if(receipt.request_hash!==hash)messageFail('This request was already used for a different message',409);return {event:eventView(receipt,actor),replayed,conversation:conversationView(await messageConversation(env,actor,id),actor)};};
  const old=await savedEvent(env,actor,input.requestKey);if(old)return result(old,true);
  let body='',photos=[],context={},state='open',revision=null;
  if(isState){
    if(actor.kind!=='merchant')messageFail('Only the store can change conversation state',403);
    if(!['open','resolved','blocked'].includes(input.state)||!Number.isSafeInteger(input.revision)||input.revision<0)messageFail('Conversation state reference is invalid');
    state=input.state;revision=input.revision;
  }else{
    body=messageText(input.body,4000);photos=input.photos;
    if(!Array.isArray(photos)||photos.length>4||new Set(photos).size!==photos.length||photos.some(id=>!messagePhotoId(id))||(!body&&!photos.length))messageFail('Write a message or attach up to four photos');
    if(input.context!==undefined&&input.context!==null)context=(await messageContext(env,actor,input.context,row)).view;
  }
  try{await env.DB.prepare(`INSERT INTO commerce_message_events(conversation_id,commerce_environment,actor_kind,actor_id,request_key,request_hash,kind,body,media_json,context_json,state,expected_revision,created_at)
    VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)`).bind(id,mode(env),actor.kind,actor.id,input.requestKey,hash,input.kind,body,JSON.stringify(photos),JSON.stringify(context),state,revision,new Date().toISOString()).run();}
  catch(error){const raced=await savedEvent(env,actor,input.requestKey);if(raced)return result(raced,true);messageError(error);}
  return result(await savedEvent(env,actor,input.requestKey),false);
}
function parameters(url,allowed){for(const key of url.searchParams.keys())if(!allowed.includes(key)||url.searchParams.getAll(key).length!==1)messageFail('Message filters are invalid');
  const raw=url.searchParams.get('limit')||'30';if(!/^[1-9][0-9]?$/.test(raw)||Number(raw)>50)messageFail('Choose up to 50 results per page');return Number(raw);}
export async function conversationDetail(env,actor,id,url){
  const limit=parameters(url,['limit','cursor']),row=await messageConversation(env,actor,id),scope=await commerceHash({mode:mode(env),actor,id,view:'events'});
  const cursor=url.searchParams.has('cursor')?readReviewCursor(url.searchParams.get('cursor'),scope):null;
  if(cursor&&(!Number.isSafeInteger(cursor.cap)||!Number.isSafeInteger(cursor.before)||cursor.cap<cursor.before||cursor.before<1))messageFail('Message page is invalid');
  const cap=cursor?.cap??row.last_event_id,before=cursor?.before??cap+1;
  const events=await env.DB.prepare('SELECT * FROM commerce_message_events WHERE conversation_id=? AND id<=? AND id<? ORDER BY id DESC LIMIT ?').bind(id,cap,before,limit+1).all();
  const items=events.results.slice(0,limit),opposite=actor.kind==='buyer'?'merchant':'buyer';
  const read=await env.DB.prepare('SELECT MAX(event_id) AS event_id FROM commerce_message_reads WHERE conversation_id=? AND actor_kind=?').bind(id,opposite).first();
  // Recheck authorization after the reads, including revoked store membership.
  await messageConversation(env,actor,id);
  return {conversation:conversationView(row,actor),items:items.reverse().map(e=>eventView(e,actor)),readThrough:read?.event_id||0,
    canWrite:commerceStorageEnabled(env)&&actor.role!=='viewer'&&row.state!=='blocked'&&row.store_status==='active',enabled:commerceStorageEnabled(env),
    nextCursor:events.results.length>limit?reviewCursor({v:1,scope,cap,before:items[0].id}):null};
}
export async function markConversationRead(env,actor,id,input){
  if(!commerceStorageEnabled(env))messageFail('Messaging is not enabled yet',503);messageFields(input,['eventId']);
  await messageConversation(env,actor,id);if(!Number.isSafeInteger(input.eventId)||input.eventId<1)messageFail('Read position is invalid');
  try{await env.DB.prepare(`INSERT INTO commerce_message_reads(conversation_id,actor_kind,actor_id,event_id,updated_at) VALUES(?,?,?,?,?)
    ON CONFLICT(conversation_id,actor_kind,actor_id) DO UPDATE SET event_id=MAX(event_id,excluded.event_id),updated_at=excluded.updated_at`)
    .bind(id,actor.kind,actor.id,input.eventId,new Date().toISOString()).run();}catch(error){messageError(error);}
  return {readThrough:(await env.DB.prepare('SELECT event_id FROM commerce_message_reads WHERE conversation_id=? AND actor_kind=? AND actor_id=?').bind(id,actor.kind,actor.id).first()).event_id};
}
export async function messageInbox(env,actor,url){
  const limit=parameters(url,['q','state','unread','cursor','limit']),q=messageText(url.searchParams.get('q')||'',120),state=url.searchParams.get('state')||'all',unread=url.searchParams.get('unread')||'all';
  if(!['all','open','resolved','blocked','needs-response'].includes(state)||!['all','1'].includes(unread))messageFail('Message filters are invalid');
  const scope=await commerceHash({mode:mode(env),actor,view:'inbox',q,state,unread}),cursor=url.searchParams.has('cursor')?readReviewCursor(url.searchParams.get('cursor'),scope):null;
  if(cursor&&(!Number.isSafeInteger(cursor.cap)||!Number.isSafeInteger(cursor.before)||cursor.cap<cursor.before||cursor.before<0||!messageId(cursor.id)||typeof cursor.at!=='string'||!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(cursor.at)))messageFail('Inbox page is invalid');
  const cap=cursor?.cap??(await env.DB.prepare('SELECT COALESCE(MAX(id),0) AS cap FROM commerce_message_events').first()).cap;
  const at=cursor?.at??new Date().toISOString();
  const search='%'+q.replace(/[\\%_]/g,'\\$&')+'%',opposite=actor.kind==='buyer'?'merchant':'buyer';
  const rows=await env.DB.prepare(`WITH snapshot AS (SELECT c.*,(SELECT origin_json FROM commerce_message_origins WHERE conversation_id=c.id) AS origin_json,s.status AS store_status,COALESCE(NULLIF(json_extract(s.settings_json,'$.storefront.name'),''),s.name) AS store_name,
    COALESCE((SELECT MAX(e.id) FROM commerce_message_events e WHERE e.conversation_id=c.id AND e.id<=?),0) AS position,
    COALESCE((SELECT e.state FROM commerce_message_events e WHERE e.conversation_id=c.id AND e.id<=? ORDER BY e.id DESC LIMIT 1),'open') AS snapshot_state,
    COALESCE((SELECT MAX(e.id) FROM commerce_message_events e WHERE e.conversation_id=c.id AND e.id<=? AND e.kind='message' AND e.actor_kind='buyer'),0) AS last_buyer,
    COALESCE((SELECT MAX(e.id) FROM commerce_message_events e WHERE e.conversation_id=c.id AND e.id<=? AND e.kind='message' AND e.actor_kind='merchant'),0) AS last_merchant,
    (SELECT body FROM commerce_message_events e WHERE e.conversation_id=c.id AND e.id<=? AND e.kind='message' ORDER BY e.id DESC LIMIT 1) AS last_body,
    (SELECT created_at FROM commerce_message_events e WHERE e.conversation_id=c.id AND e.id<=? ORDER BY e.id DESC LIMIT 1) AS activity_at,
    EXISTS(SELECT 1 FROM commerce_message_events e WHERE e.conversation_id=c.id AND e.id<=? AND e.kind='message' AND e.actor_kind=?
      AND e.id>COALESCE((SELECT event_id FROM commerce_message_reads r WHERE r.conversation_id=c.id AND r.actor_kind=? AND r.actor_id=?),0)) AS unread
    FROM commerce_conversations c JOIN sellers s ON s.id=c.seller_id WHERE c.commerce_environment=? AND c.created_at<=? AND ${actor.kind==='merchant'?"s.status='active' AND":''} ${actorSql(actor)})
    SELECT * FROM snapshot WHERE (?='all' OR snapshot_state=? OR (?='needs-response' AND snapshot_state='open' AND last_buyer>last_merchant))
      AND (?='all' OR unread=1) AND (?='' OR buyer_name LIKE ? ESCAPE '\\' OR store_name LIKE ? ESCAPE '\\'
        OR EXISTS(SELECT 1 FROM commerce_message_events e WHERE e.conversation_id=snapshot.id AND e.id<=? AND (e.body LIKE ? ESCAPE '\\' OR e.context_json LIKE ? ESCAPE '\\')))
      AND (position<? OR (position=? AND id<?)) ORDER BY position DESC,id DESC LIMIT ?`)
    .bind(cap,cap,cap,cap,cap,cap,cap,opposite,actor.kind,actor.id,mode(env),at,...actorBindings(actor),state,state,state,unread,q,search,search,cap,search,search,
      cursor?.before??cap+1,cursor?.before??cap+1,cursor?.id??'z',limit+1).all();
  const items=rows.results.slice(0,limit),last=items.at(-1);
  return {items:items.map(r=>conversationView({...r,state:r.snapshot_state},actor)),nextCursor:rows.results.length>limit?reviewCursor({v:1,scope,cap,at,before:last.position,id:last.id}):null,
    enabled:commerceStorageEnabled(env),canWrite:commerceStorageEnabled(env)&&actor.role!=='viewer'};
}
export async function messageStats(env,actor,url){
  parameters(url,[]);if(actor.kind!=='merchant')messageFail('Store statistics are unavailable',403);
  const today=new Date(Date.now()+7*3600000).toISOString().slice(0,10),start=new Date(Date.parse(today+'T00:00:00+07:00')).toISOString(),since=new Date(Date.now()-30*86400000).toISOString();
  const counts=await env.DB.prepare(`SELECT COUNT(CASE WHEN c.state='open' THEN 1 END) AS open,
    COUNT(CASE WHEN c.state='open' AND (SELECT actor_kind FROM commerce_message_events e WHERE e.conversation_id=c.id AND e.kind='message' ORDER BY id DESC LIMIT 1)='buyer' THEN 1 END) AS needsResponse,
    COUNT(CASE WHEN c.state='resolved' AND EXISTS(SELECT 1 FROM commerce_message_events e WHERE e.id=c.last_event_id AND e.created_at>=?) THEN 1 END) AS resolvedToday
    FROM commerce_conversations c WHERE c.seller_id=? AND c.commerce_environment=?`).bind(start,actor.sellerId,mode(env)).first();
  const response=await env.DB.prepare(`WITH first AS (SELECT c.id,(SELECT MIN(id) FROM commerce_message_events e WHERE e.conversation_id=c.id AND e.kind='message' AND e.actor_kind='buyer') AS buyer
    FROM commerce_conversations c WHERE c.seller_id=? AND c.commerce_environment=?), replies AS (SELECT b.created_at AS asked,
    (SELECT e.created_at FROM commerce_message_events e WHERE e.conversation_id=first.id AND e.kind='message' AND e.actor_kind='merchant' AND e.id>first.buyer ORDER BY e.id LIMIT 1) AS answered
    FROM first JOIN commerce_message_events b ON b.id=first.buyer), durations AS (SELECT MAX(0,ROUND((julianday(answered)-julianday(asked))*86400)) AS seconds FROM replies WHERE answered>=?)
    SELECT seconds FROM durations ORDER BY seconds LIMIT 2-(SELECT COUNT(*) FROM durations)%2 OFFSET ((SELECT COUNT(*) FROM durations)-1)/2`)
    .bind(actor.sellerId,mode(env),since).all();
  return {...counts,medianFirstResponseSeconds:response.results.length?response.results.reduce((s,r)=>s+r.seconds,0)/response.results.length:null,responseWindowDays:30,timeZone:'Asia/Jakarta'};
}
export async function savedReplies(env,actor,url){parameters(url,[]);if(actor.kind!=='merchant')messageFail('Saved replies are unavailable',403);
  const rows=await env.DB.prepare("SELECT id,title,body,state,revision FROM commerce_saved_replies WHERE seller_id=? AND commerce_environment=? AND state='active' ORDER BY title,id LIMIT 100").bind(actor.sellerId,mode(env)).all();return {items:rows.results};}
export async function saveReply(env,actor,input){
  messageWritable(env,actor);if(actor.kind!=='merchant')messageFail('Saved replies are unavailable',403);
  messageFields(input,['id','title','body','state','revision','requestKey']);messageKey(input.requestKey);
  if(!Number.isSafeInteger(input.revision)||input.revision<0||!['active','archived'].includes(input.state)||(input.id&&!/^reply_[a-f0-9]{32}$/.test(input.id)))messageFail('Saved reply reference is invalid');
  const id=input.id||'reply_'+(await commerceHash({actor:actor.id,mode:mode(env),key:input.requestKey})).slice(0,32),title=messageText(input.title,80,true),body=messageText(input.body,4000,true),hash=await commerceHash({seller:actor.sellerId,...input});
  const read=()=>env.DB.prepare('SELECT * FROM commerce_saved_reply_changes WHERE actor_id=? AND commerce_environment=? AND request_key=?').bind(actor.id,mode(env),input.requestKey).first();
  const result=r=>{if(r.request_hash!==hash)messageFail('This reference was already used for another saved reply',409);return {reply:{id:r.reply_id,title:r.title,body:r.body,state:r.state,revision:r.revision}};};
  const old=await read();if(old)return result(old);
  try{await env.DB.prepare(`INSERT INTO commerce_saved_reply_changes(reply_id,seller_id,commerce_environment,actor_id,request_key,request_hash,title,body,state,revision,created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?)`)
    .bind(id,actor.sellerId,mode(env),actor.id,input.requestKey,hash,title,body,input.state,input.revision+1,new Date().toISOString()).run();}catch(error){const raced=await read();if(raced)return result(raced);messageError(error);}
  return result(await read());
}
