import {commerceHash} from './commerce-orders.js';
import {claimCommerceJobs,finishCommerceJob} from './commerce-jobs.js';
import {currentCommerceEnvironment as mode} from './commerce-access.js';
import {notificationSourceKinds,notificationsEnabled} from './notification-policy.js';

const invalid=()=>{throw Object.assign(new Error('Notification source is invalid'),{code:'notification_source_invalid'});};
const labels={requested:'requested',approved:'approved',declined:'declined',withdrawn:'withdrawn',receiving:'being received',inspected:'inspected',closed:'closed',
  queued:'queued',confirmed:'confirmed',allocated:'assigned to a courier',picking_up:'awaiting pickup',picked:'picked up',dropping_off:'out for delivery',delivered:'delivered',cancelled:'cancelled',rejected:'rejected',returned:'returned',on_hold:'on hold',delivery_failed:'delivery failed'};
async function content(env,job){
  const data=job.data;
  if(!data||typeof data!=='object'||Array.isArray(data))invalid();
  if(job.kind==='notification.message_received'){
    if(!Number.isSafeInteger(data.eventId)||data.eventId<1)invalid();
    const row=await env.DB.prepare(`SELECT e.id,e.actor_kind,e.kind,c.id AS conversation_id,c.seller_id,c.commerce_environment FROM commerce_message_events e JOIN commerce_conversations c ON c.id=e.conversation_id WHERE e.id=?`).bind(data.eventId).first();
    if(!row||row.seller_id!==job.sellerId||row.commerce_environment!==job.environment||row.kind!=='message')invalid();
    return {category:'messages',audience:row.actor_kind==='buyer'?'merchant':'buyer',conversationId:row.conversation_id,title:row.actor_kind==='buyer'?'New buyer message':'New message from your store',body:'Open the conversation to read the message and any attached photos.',data:{eventId:row.id}};
  }
  if(job.kind==='notification.weekly_activity'){
    if(typeof data.from!=='string'||typeof data.to!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(data.from)||!/^\d{4}-\d{2}-\d{2}$/.test(data.to)||Date.parse(data.to)-Date.parse(data.from)!==604800000)invalid();
    const from=data.from+'T00:00:00+07:00',to=data.to+'T00:00:00+07:00';
    const [counts,items]=await env.DB.batch([
      env.DB.prepare(`SELECT COUNT(*) AS products,SUM(CASE WHEN EXISTS(SELECT 1 FROM order_items i JOIN commerce_payment_captures c ON c.order_id=i.order_id
        WHERE i.product_id=p.id AND c.seller_id=p.seller_id AND c.commerce_environment=? AND c.capture_kind='order_payment' AND c.verified_at>=strftime('%Y-%m-%dT%H:%M:%fZ',?) AND c.verified_at<strftime('%Y-%m-%dT%H:%M:%fZ',?)) THEN 1 ELSE 0 END) AS with_orders
        FROM products p WHERE p.seller_id=? AND p.status='active'`).bind(job.environment,from,to,job.sellerId),
      env.DB.prepare(`SELECT p.id,p.title FROM products p WHERE p.seller_id=? AND p.status='active' AND NOT EXISTS(SELECT 1 FROM order_items i JOIN commerce_payment_captures c ON c.order_id=i.order_id
        WHERE i.product_id=p.id AND c.seller_id=p.seller_id AND c.commerce_environment=? AND c.capture_kind='order_payment' AND c.verified_at>=strftime('%Y-%m-%dT%H:%M:%fZ',?) AND c.verified_at<strftime('%Y-%m-%dT%H:%M:%fZ',?)) ORDER BY p.title,p.id LIMIT 10`).bind(job.sellerId,job.environment,from,to),
    ]);
    const total=counts.results[0].products,withoutOrders=total-Number(counts.results[0].with_orders||0);
    return {category:'weekly_activity',audience:'merchant',title:'Weekly catalog activity',body:`${withoutOrders} of ${total} active products had no provider-confirmed paid orders during the week starting ${data.from} (Jakarta).`,data:{from:data.from,to:data.to,total,withoutOrders,products:items.results.map(p=>({id:p.id,name:p.title.slice(0,160)}))}};
  }
  const order=await env.DB.prepare(`SELECT o.id,o.checkout_state,o.fulfillment_state,o.expires_at,EXISTS(SELECT 1 FROM commerce_payment_captures p WHERE p.order_id=o.id AND p.capture_kind='order_payment') AS captured
    FROM orders o WHERE o.id=? AND o.seller_id=? AND o.commerce_environment=? AND o.commerce_version=1`).bind(job.orderId,job.sellerId,job.environment).first();
  if(!order||data.orderId!==order.id)invalid();
  const result={audience:'both',orderId:order.id,data:{}};
  if(job.kind==='notification.order_state'){
    if(data.state==='paid'){
      if(!order.captured)invalid();return {...result,category:'payment_confirmed',title:'Payment confirmed',body:`Payment for ${order.id} was confirmed by the provider. Open the order for its current fulfillment status.`};
    }
    if(data.state==='pending')return {...result,category:'payment_pending',title:'Payment session opened',body:'',suppression:'not_actionable'};
    if(!['failed','expired','cancelled'].includes(data.state))invalid();
    return {...result,category:'payment_failed',title:data.state==='cancelled'?'Checkout cancelled':data.state==='expired'?'Payment window expired':'Payment could not be created',body:`Order ${order.id}: ${data.state==='cancelled'?'the checkout was cancelled':data.state==='expired'?'the payment window closed':'payment creation failed'}. Open the order for its current payment status.`};
  }
  if(job.kind==='notification.payment_pending')return {...result,category:'payment_pending',title:'Payment pending for 30 minutes',body:`Order ${order.id} is still awaiting payment. Check the order before taking any action.`};
  if(job.kind==='notification.payment_review')return {...result,audience:'merchant',category:'payment_review',title:'Payment or stock review needed',body:`Order ${order.id} needs review. Open the payment and fulfillment records before taking action.`};
  if(job.kind==='notification.stock_recovered')return {...result,audience:'merchant',category:'payment_review',title:'Stock review resolved',body:`The stock review for ${order.id} was resolved. Open the order for its current fulfillment status.`};
  if(job.kind==='notification.return_updated'){
    const row=typeof data.returnId==='string'?await env.DB.prepare('SELECT id FROM commerce_returns WHERE id=? AND seller_id=? AND order_id=?').bind(data.returnId,job.sellerId,order.id).first():null;
    if(!row||!['requested','approved','declined','withdrawn','receiving','inspected','closed'].includes(data.state))invalid();
    return {...result,returnId:row.id,category:'returns',title:'Return '+labels[data.state],body:`The return for ${order.id} is ${labels[data.state]}. Open the return to review the details.`,data:{state:data.state}};
  }
  if(job.kind==='notification.shipment_updated'){
    if(data.kind){
      const actions={accept:['Order accepted','The store accepted the order for fulfillment.'],pickup:['Pickup requested','A pickup was requested. This does not confirm that the courier has collected the parcel.'],cancel_pickup:['Pickup cancellation requested','A cancellation was requested. Check tracking for the courier’s confirmation.'],refresh:['Tracking refresh requested','']};
      if(!Object.hasOwn(actions,data.kind))invalid();const [title,body]=actions[data.kind];
      return {...result,category:'shipping',title,body:`${order.id}: ${body}`,data:{action:data.kind},...(data.kind==='refresh'?{suppression:'not_actionable'}:{})};
    }
    if(typeof data.shipmentId!=='string'||typeof data.state!=='string'||!/^[a-z_]{2,40}$/.test(data.state))invalid();
    const shipment=await env.DB.prepare('SELECT id FROM commerce_shipments WHERE id=? AND order_id=? AND seller_id=? AND commerce_environment=?').bind(data.shipmentId,order.id,job.sellerId,job.environment).first();if(!shipment)invalid();
    return {...result,category:'shipping',title:'Shipping update',body:`Order ${order.id}: ${labels[data.state]||data.state.replaceAll('_',' ')}. Open tracking for the current status.`,data:{state:data.state,shipmentId:shipment.id}};
  }
  invalid();
}

// Event plus recipient fan-out is one database transaction. A lost job-completion
// acknowledgement reuses that receipt and never recreates its recipients.
export async function deliverNotificationJob(env,job,workerId){
  if(!notificationsEnabled(env)||!notificationSourceKinds.includes(job.kind))throw new Response('Notification processing is not enabled',{status:503});
  const prior=await env.DB.prepare('SELECT id FROM commerce_notification_events WHERE job_id=?').bind(job.id).first();
  let id=prior?.id;
  if(!id){
    const item=await content(env,job);id='notice_'+(await commerceHash({job:job.id,environment:job.environment})).slice(0,32);
    const source=await env.DB.prepare('SELECT created_at FROM commerce_jobs WHERE id=?').bind(job.id).first();if(!source)invalid();
    const now=new Date().toISOString();
    await env.DB.prepare(`INSERT INTO commerce_notification_events(id,job_id,source_lease_token,seller_id,commerce_environment,category,audience,order_id,conversation_id,return_id,title,body,data_json,suppression,occurred_at,created_at)
      SELECT ?,?,?,?,?,?,?,?,?,?,?,?,?,CASE WHEN NOT EXISTS(SELECT 1 FROM sellers WHERE id=? AND status='active') THEN 'store_closed'
        WHEN ?='notification.payment_pending' AND NOT EXISTS(SELECT 1 FROM orders WHERE id=? AND checkout_state IN ('creating','pending') AND expires_at>?) THEN 'obsolete' ELSE ? END,?,?
      WHERE NOT EXISTS(SELECT 1 FROM commerce_notification_events WHERE job_id=?)`)
      .bind(id,job.id,job.leaseToken,job.sellerId,job.environment,item.category,item.audience,item.orderId||null,item.conversationId||null,item.returnId||null,item.title,item.body,JSON.stringify(item.data||{}),job.sellerId,job.kind,job.orderId,now,item.suppression||'',source.created_at,now,job.id).run();
  }
  return finishCommerceJob(env,job.id,{environment:job.environment,workerId,leaseToken:job.leaseToken,outcome:'succeeded',result:{notificationId:id}});
}

export async function dispatchNotifications(env,limit=3){
  if(!notificationsEnabled(env))return {processed:0,failed:0,held:true};
  if(!Number.isSafeInteger(limit)||limit<1||limit>3)throw new Response('Notification batch is invalid',{status:422});
  const workerId='notices_'+crypto.randomUUID().replaceAll('-',''),environment=mode(env),out={processed:0,failed:0,held:false};
  for(const leaseMode of ['reconcile','execute']){
    const remaining=limit-out.processed-out.failed;if(!remaining)break;
    const jobs=await claimCommerceJobs(env,{environment,workerId,kinds:notificationSourceKinds,mode:leaseMode,limit:remaining,leaseSeconds:120});
    for(const job of jobs){try{await deliverNotificationJob(env,job,workerId);out.processed++;}
      catch(error){out.failed++;try{await finishCommerceJob(env,job.id,{environment,workerId,leaseToken:job.leaseToken,outcome:error.code==='notification_source_invalid'?'dead':'uncertain',
        error:error.code==='notification_source_invalid'?'The source event needs an operator review.':'The result was not confirmed. The next attempt will check the saved notification.',result:{}});}catch{/* An expired lease or storage outage is recovered by the next claimant. */}}
    }
  }
  return out;
}

export function notificationWeek(now=new Date()){
  const local=new Date(now.getTime()+7*3600000),day=(local.getUTCDay()+6)%7;
  const monday=Date.UTC(local.getUTCFullYear(),local.getUTCMonth(),local.getUTCDate()-day);
  const end=monday-(day===0&&local.getUTCHours()<9?604800000:0);
  return {from:new Date(end-604800000).toISOString().slice(0,10),to:new Date(end).toISOString().slice(0,10)};
}
export async function scheduleNotifications(env,{now=new Date(),limit=50}={}){
  if(!notificationsEnabled(env))return {pending:0,weekly:0,held:true};
  if(!(now instanceof Date)||!Number.isFinite(now.getTime())||!Number.isSafeInteger(limit)||limit<1||limit>100)throw new Response('Notification schedule is invalid',{status:422});
  const at=now.toISOString(),before=new Date(now.getTime()-1800000).toISOString(),environment=mode(env),week=notificationWeek(now);
  const results=await env.DB.batch([
    env.DB.prepare(`INSERT INTO commerce_jobs(id,seller_id,order_id,commerce_environment,job_key,kind,payload_json,available_at,created_at,updated_at)
      SELECT 'job_'||lower(hex(randomblob(16))),o.seller_id,o.id,o.commerce_environment,'pending_payment:'||o.id,'notification.payment_pending',json_object('orderId',o.id),?,?,?
      FROM orders o JOIN sellers s ON s.id=o.seller_id WHERE o.commerce_version=1 AND o.commerce_environment=? AND o.checkout_state IN ('creating','pending')
        AND o.created_at<=? AND o.expires_at>? AND s.status='active' AND NOT EXISTS(SELECT 1 FROM commerce_jobs j WHERE j.seller_id=o.seller_id AND j.commerce_environment=o.commerce_environment AND j.job_key='pending_payment:'||o.id)
      ORDER BY o.created_at,o.id LIMIT ?`).bind(at,at,at,environment,before,at,limit),
    env.DB.prepare(`INSERT INTO commerce_jobs(id,seller_id,commerce_environment,job_key,kind,payload_json,available_at,created_at,updated_at)
      SELECT 'job_'||lower(hex(randomblob(16))),s.id,?,'weekly_activity:'||?,'notification.weekly_activity',json_object('from',?,'to',?),?,?,?
      FROM sellers s WHERE s.status='active' AND s.created_at<strftime('%Y-%m-%dT%H:%M:%fZ',?||'T00:00:00+07:00')
        AND EXISTS(SELECT 1 FROM products p WHERE p.seller_id=s.id AND p.status='active')
        AND NOT EXISTS(SELECT 1 FROM commerce_jobs j WHERE j.seller_id=s.id AND j.commerce_environment=? AND j.job_key='weekly_activity:'||?)
      ORDER BY s.id LIMIT ?`).bind(environment,week.to,week.from,week.to,at,at,at,week.to,environment,week.to,limit),
  ]);
  return {pending:results[0].meta.changes,weekly:results[1].meta.changes,held:false};
}
