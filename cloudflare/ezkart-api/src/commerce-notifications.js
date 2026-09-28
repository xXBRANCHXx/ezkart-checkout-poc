import {sellerAlertCount} from './seller-alerts.js';
import {commerceHash} from './commerce-orders.js';
import {currentCommerceEnvironment as mode} from './commerce-access.js';
import {reviewCursor,readReviewCursor} from './commerce-reviews.js';
import {settingsActor,notificationGroups} from './merchant-settings.js';
import {notificationsEnabled,notificationSourceKinds} from './notification-policy.js';
import {emailConfiguration} from './email-provider.js';
import {emailStatusFields,emailStatusJoins,emailDeliveryStatus} from './email-status.js';
const fail=(message,status=422)=>{throw new Response(message,{status});};
const fields=(input,allowed)=>{if(!input||typeof input!=='object'||Array.isArray(input)||Object.keys(input).some(k=>!allowed.includes(k)))fail('Notification request is invalid');};
const query=(url,allowed)=>{for(const key of url.searchParams.keys())if(!allowed.includes(key)||url.searchParams.getAll(key).length!==1)fail('Notification filters are invalid');};
async function access(env,actor){if(actor.kind==='merchant')await settingsActor(env,actor);else if(actor.kind!=='buyer'||!actor.id)fail('Sign in to read notifications',401);}
const visibility=actor=>actor.kind==='merchant'?`e.seller_id=? AND EXISTS(SELECT 1 FROM seller_memberships m JOIN sellers s ON s.id=m.seller_id WHERE m.seller_id=e.seller_id AND m.auth_user_id=? AND s.status='active')`:
  `(EXISTS(SELECT 1 FROM commerce_conversations c WHERE c.id=e.conversation_id AND c.buyer_auth_user_id=?) OR EXISTS(SELECT 1 FROM orders o LEFT JOIN commerce_order_owners a ON a.order_id=o.id WHERE o.id=e.order_id AND COALESCE(a.auth_user_id,NULLIF(json_extract(o.customer_snapshot_json,'$.authUserId'),''))=?))`;
const scopeArgs=actor=>actor.kind==='merchant'?[actor.sellerId,actor.id]:[actor.id,actor.id];
const visibleWhere=actor=>`r.actor_kind=? AND r.actor_id=? AND e.commerce_environment=? AND ${visibility(actor)}`;
const bindings=(env,actor)=>[actor.kind,actor.id,mode(env),...scopeArgs(actor)];
const tables=`commerce_notification_recipients r JOIN commerce_notification_events e ON e.id=r.event_id JOIN sellers s ON s.id=e.seller_id LEFT JOIN commerce_notification_reads d ON d.recipient_id=r.id`;
function view(row,actor,connected){
  const href=row.conversation_id?'/cart/messages.php?conversation='+encodeURIComponent(row.conversation_id):row.order_id?'/cart/return.php?order='+encodeURIComponent(row.order_id)+(row.refund_id?'&refund='+encodeURIComponent(row.refund_id):''):'/cart/';
  const merchant=row.conversation_id?'?page=messages&conversation='+encodeURIComponent(row.conversation_id):row.refund_id?'?page=refunds&refund='+encodeURIComponent(row.refund_id):row.return_id?'?page=returns&return='+encodeURIComponent(row.return_id):row.order_id?'?page=orders&order='+encodeURIComponent(row.order_id):'?page=products';
  return {id:row.id,category:row.category,title:row.title,body:row.body,storeName:row.store_name,createdAt:row.occurred_at,deliveredAt:row.created_at,readAt:row.read_at||null,
    href:actor.kind==='merchant'?'/cart/admin/'+merchant:href,data:JSON.parse(row.data_json),emailStatus:emailDeliveryStatus(row,connected).status,email:emailDeliveryStatus(row,connected)};
}
export async function notificationStats(env,actor,url){
  await access(env,actor);query(url,[]);
  const row=await env.DB.prepare(`SELECT COALESCE(SUM(CASE WHEN r.in_app=1 AND d.recipient_id IS NULL THEN 1 ELSE 0 END),0) AS unread,
    COALESCE(SUM(r.in_app),0) AS total,COALESCE(SUM(CASE WHEN r.email_requested=1 AND mb.request_id IS NULL AND ms.job_id IS NULL AND (mj.state IS NULL OR mj.state!='dead') THEN 1 ELSE 0 END),0) AS email_waiting,
    COALESCE(SUM(CASE WHEN r.email_requested=1 AND ((ms.uncertain=1 AND NOT EXISTS(SELECT 1 FROM commerce_email_resolutions mr WHERE mr.request_id=mx.id)) OR mj.state='dead' OR EXISTS(SELECT 1 FROM commerce_email_delivery_evidence me WHERE me.request_id=mx.id AND me.kind IN ('bounced','complained','failed','suppressed'))) THEN 1 ELSE 0 END),0) AS email_attention
    FROM ${tables} ${emailStatusJoins} WHERE ${visibleWhere(actor)}`).bind(...bindings(env,actor)).first();
  await access(env,actor);const alerts=await sellerAlertCount(env,actor);return {...row,unread:Number(row.unread)+alerts,total:Number(row.total)+alerts,alerts,enabled:notificationsEnabled(env),emailEnabled:emailConfiguration(env).ready};
}
export async function notificationInbox(env,actor,url,channel='inbox'){
  await access(env,actor);query(url,channel==='email'?['category','q','cursor']:['category','state','q','cursor']);
  const category=url.searchParams.get('category')||'',state=url.searchParams.get('state')||'all',term=(url.searchParams.get('q')||'').trim();
  if(category&&!notificationGroups.includes(category)||!['all','unread','read'].includes(state)||term.length>120||/[\u0000-\u001f]/.test(term))fail('Notification filters are invalid');
  const scope=await commerceHash({environment:mode(env),actor,category,state,term,channel}),cursor=url.searchParams.has('cursor')?readReviewCursor(url.searchParams.get('cursor'),scope):null;
  if(cursor&&(!Number.isSafeInteger(cursor.cap)||!Number.isSafeInteger(cursor.before)||cursor.cap<cursor.before||cursor.before<1))fail('Notification page is invalid');
  const requested=channel==='email'?'r.email_requested=1':'r.in_app=1';
  const max=await env.DB.prepare(`SELECT COALESCE(MAX(r.id),0) AS id FROM ${tables} WHERE ${visibleWhere(actor)} AND ${requested}`).bind(...bindings(env,actor)).first();
  const cap=cursor?.cap??max.id,before=cursor?.before??cap+1,like='%'+term.replace(/[|%_]/g,'|$&')+'%';
  const rows=await env.DB.prepare(`SELECT r.id,r.created_at,r.email_requested,e.category,e.title,e.body,e.data_json,e.occurred_at,e.order_id,e.return_id,e.refund_id,e.conversation_id,s.name AS store_name,d.read_at,${emailStatusFields()}
    FROM ${tables} ${emailStatusJoins} WHERE ${visibleWhere(actor)} AND ${requested} AND r.id<=? AND r.id<? AND (?='' OR e.category=?)
      AND (?='all' OR (?='unread' AND d.recipient_id IS NULL) OR (?='read' AND d.recipient_id IS NOT NULL))
      AND (?='' OR e.title LIKE ? ESCAPE '|' OR e.body LIKE ? ESCAPE '|') ORDER BY r.id DESC LIMIT 26`)
    .bind(...bindings(env,actor),cap,before,category,category,state,state,state,term,like,like).all();
  await access(env,actor);const items=rows.results.slice(0,25);
  return {items:items.map(row=>view(row,actor,emailConfiguration(env).ready)),nextCursor:rows.results.length>25?reviewCursor({v:1,scope,cap,before:items.at(-1).id}):null,enabled:notificationsEnabled(env)};
}
export async function readNotifications(env,actor,input){
  await access(env,actor);if(!notificationsEnabled(env))fail('Notification delivery is not enabled yet',503);
  fields(input,['ids']);if(!Array.isArray(input.ids)||!input.ids.length||input.ids.length>50||new Set(input.ids).size!==input.ids.length||input.ids.some(id=>!Number.isSafeInteger(id)||id<1))fail('Choose up to 50 notifications to mark read');
  const ids=JSON.stringify(input.ids),matched=await env.DB.prepare(`SELECT r.id FROM ${tables} WHERE ${visibleWhere(actor)} AND r.in_app=1 AND r.id IN (SELECT value FROM json_each(?))`).bind(...bindings(env,actor),ids).all();
  if(matched.results.length!==input.ids.length)fail('Notification not found',404);
  try{await env.DB.prepare(`INSERT INTO commerce_notification_reads(recipient_id,actor_kind,actor_id,read_at)
    SELECT r.id,r.actor_kind,r.actor_id,? FROM commerce_notification_recipients r WHERE r.id IN (SELECT value FROM json_each(?)) AND r.actor_kind=? AND r.actor_id=?
      AND NOT EXISTS(SELECT 1 FROM commerce_notification_reads d WHERE d.recipient_id=r.id)`).bind(new Date().toISOString(),ids,actor.kind,actor.id).run();}
  catch(error){if(/notification_read_forbidden/.test(String(error)+' '+String(error.cause||'')))fail('Your access to these notifications changed. Reload this page.',403);throw error;}
  await access(env,actor);return {read:input.ids};
}
export async function notificationProcessing(env,actor,url){
  if(actor.kind!=='merchant')fail('Notification processing is unavailable',404);await access(env,actor);query(url,['state','cursor']);
  const state=url.searchParams.get('state')||'attention';if(!['all','attention','queued','succeeded'].includes(state))fail('Choose an available delivery state');
  const scope=await commerceHash({environment:mode(env),actor,state,view:'notification_processing'}),cursor=url.searchParams.has('cursor')?readReviewCursor(url.searchParams.get('cursor'),scope):null;
  const stamp=value=>typeof value==='string'&&/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value)&&Number.isFinite(Date.parse(value));
  if(cursor&&(!Array.isArray(cursor.before)||cursor.before.length!==2||!stamp(cursor.before[0])||!stamp(cursor.cap)||cursor.before[0]>cursor.cap||typeof cursor.before[1]!=='string'||!/^job_[a-f0-9]{32}$/.test(cursor.before[1])))fail('Processing page is invalid');
  const cap=cursor?.cap||new Date().toISOString(),before=cursor?.before||[cap,'~'];
  const stalled=`((j.state IN ('queued','running') AND j.available_at<strftime('%Y-%m-%dT%H:%M:%fZ','now','-15 minutes'))
    OR (mb.created_at<strftime('%Y-%m-%dT%H:%M:%fZ','now','-15 minutes') AND NOT EXISTS(SELECT 1 FROM commerce_email_delivery_evidence me WHERE me.request_id=mx.id AND me.kind IN ('delivered','bounced','complained','failed','suppressed'))))`;
  const rows=await env.DB.prepare(`SELECT j.id,j.order_id,j.kind,j.state,j.attempts,j.created_at,j.updated_at,j.available_at,e.id AS event_id,e.suppression,
    (SELECT COUNT(*) FROM commerce_notification_recipients r WHERE r.event_id=e.id AND r.in_app=1) AS inboxes,
    (SELECT COUNT(*) FROM commerce_notification_recipients r WHERE r.event_id=e.id AND r.email_requested=1) AS email_requested_count,
    CASE WHEN j.kind='notification.send' THEN 1 ELSE 0 END AS email_requested,${emailStatusFields('j','mx','ms','mb')},${stalled} AS stalled
    FROM commerce_jobs j LEFT JOIN commerce_notification_events e ON e.job_id=j.id
    LEFT JOIN commerce_email_requests mx ON mx.job_id=j.id LEFT JOIN commerce_email_skips ms ON ms.job_id=j.id LEFT JOIN commerce_email_verified_bindings mb ON mb.request_id=mx.id
    WHERE j.seller_id=? AND j.commerce_environment=? AND j.kind IN (SELECT value FROM json_each(?))
      AND j.created_at<=? AND (j.created_at<? OR (j.created_at=? AND j.id<?))
      AND (?='all' OR (?='attention' AND (j.state IN ('retry','uncertain','dead') OR EXISTS(SELECT 1 FROM commerce_email_delivery_evidence me WHERE me.request_id=mx.id AND me.kind IN ('bounced','complained','failed','suppressed')) OR (EXISTS(SELECT 1 FROM commerce_email_delivery_evidence me WHERE me.request_id=mx.id AND me.kind='delayed') AND NOT EXISTS(SELECT 1 FROM commerce_email_delivery_evidence me WHERE me.request_id=mx.id AND me.kind IN ('delivered','bounced','complained','failed','suppressed')))
        OR ${stalled})) OR (?='queued' AND j.state IN ('queued','running')) OR (?='succeeded' AND j.state='succeeded'))
    ORDER BY j.created_at DESC,j.id DESC LIMIT 26`).bind(actor.sellerId,mode(env),JSON.stringify([...notificationSourceKinds,'notification.send']),cap,before[0],before[0],before[1],state,state,state,state).all();
  await access(env,actor);const items=rows.results.slice(0,25);
  return {items:items.map(row=>({id:row.id,orderId:row.order_id,kind:row.kind,state:row.state,attempts:row.attempts,createdAt:row.created_at,updatedAt:row.updated_at,nextAttemptAt:row.available_at,
    deliveredInApp:row.inboxes,emailRequested:row.email_requested_count,email:row.kind==='notification.send'?emailDeliveryStatus(row,emailConfiguration(env).ready):null,suppression:row.suppression||'',stalled:Boolean(row.stalled),
    message:row.state==='dead'?'This update needs an operator review.':row.stalled?(row.mail_submitted_at?'A final email delivery update has not arrived. An operator check is needed.':'This update has waited more than 15 minutes past its scheduled attempt. An operator check is needed.'):row.state==='uncertain'?'The next attempt will check the saved result before delivering.':row.state==='retry'?'A retry is scheduled.':''})),
    nextCursor:rows.results.length>25?reviewCursor({v:1,scope,cap,before:[items.at(-1).created_at,items.at(-1).id]}):null,enabled:notificationsEnabled(env),emailEnabled:emailConfiguration(env).ready};
}
