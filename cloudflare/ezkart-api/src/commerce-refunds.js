import {commerceHash,commerceStorageEnabled} from './commerce-orders.js';
import {currentCommerceEnvironment as mode,customerOrderSeller} from './commerce-access.js';
import {reviewCursor,readReviewCursor} from './commerce-reviews.js';
import {disputeView,disputeActive} from './commerce-refund-disputes.js';
import {supportAccess} from './commerce-support.js';

const fail=(message,status=422,code='')=>{throw new Response(message,{status,headers:code?{'x-ezkart-error-code':code}:{}});};
const conflict=message=>fail(message,409,'refund_conflict');
const fields=(input,allowed)=>{if(!input||typeof input!=='object'||Array.isArray(input)||Object.keys(input).some(k=>!allowed.includes(k)))fail('Refund details are invalid.');};
const integer=(value,label,min=0,max=100000000000)=>{if(!Number.isSafeInteger(value)||value<min||value>max)fail(label+' is invalid.');return value;};
const requestKey=value=>{if(typeof value!=='string'||!/^[A-Za-z0-9_-]{16,100}$/.test(value))fail('Refund request identity is invalid.');return value;};
const message=value=>{if(typeof value!=='string')fail('Explain the refund in 3 to 2,000 characters.');const clean=value.replaceAll('\r\n','\n').trim();if(clean.length<3||clean.length>2000||/[\u0000-\u0008\u000b-\u001f]/.test(clean))fail('Explain the refund in 3 to 2,000 characters.');return clean;};
const reasons=['not_received','damaged','wrong_item','not_as_described','file_problem','changed_mind','other'];
const caseId=value=>{if(typeof value!=='string'||!/^ref_[a-f0-9]{32}$/.test(value))fail('Refund request not found.',404);};
const labels={requested:'Awaiting store review',approved:'Approved — awaiting refund',declined:'Declined',withdrawn:'Withdrawn'};
const reservationSql="(r.state IN ('requested','approved') OR EXISTS(SELECT 1 FROM commerce_refund_disputes d WHERE d.refund_id=r.id AND d.state IN ('open','awaiting_buyer','awaiting_store')))";
const reservedSql=`COALESCE((SELECT SUM(ri.amount) FROM commerce_refund_items ri JOIN commerce_refunds r ON r.id=ri.refund_id
  WHERE ri.order_item_id=i.id AND ${reservationSql}),0)`;
const reasonFor=order=>order.payment_review?'This payment needs a support review.':order.checkout_state!=='paid'?
  (['partially_refunded','refunded'].includes(order.checkout_state)?'This order’s refunds need a support review.':'Refund requests open after payment is confirmed.'):
  !order.capture_id?'This payment needs a support review.':'';

async function access(env,actor,orderId){
  if(actor.kind==='buyer')return {sellerId:await customerOrderSeller(env,{id:actor.id},orderId),canWrite:true};
  if(actor.kind==='support'){
    const authority=await supportAccess(env,actor),order=await env.DB.prepare('SELECT seller_id FROM orders WHERE id=? AND commerce_environment=?').bind(orderId,mode(env)).first();
    if(!order)fail('Order not found.',404);return {...authority,sellerId:order.seller_id};
  }
  if(actor.kind!=='merchant'||!actor.id||!actor.sellerId)fail('Store access is required.',403);
  const member=await env.DB.prepare(`SELECT m.role FROM seller_memberships m JOIN sellers s ON s.id=m.seller_id
    WHERE m.seller_id=? AND m.auth_user_id=? AND s.status='active'`).bind(actor.sellerId,actor.id).first();
  if(!member)fail('Your store access changed. Reload this page.',403);
  return {sellerId:actor.sellerId,canWrite:member.role!=='viewer'};
}
async function orderFor(env,actor,orderId){
  if(!/^EZK-[SP]-[A-F0-9]{24}$/.test(orderId||''))fail('Order not found.',404);
  const authority=await access(env,actor,orderId);
  const order=await env.DB.prepare(`SELECT o.id,o.seller_id,o.checkout_state,o.payment_review,o.revision,o.shipping_amount,o.total_amount,
    json_extract(o.customer_snapshot_json,'$.name') AS customer_name,
    (SELECT c.id FROM commerce_payment_captures c WHERE c.order_id=o.id AND c.capture_kind='order_payment' AND c.amount=o.total_amount) AS capture_id
    FROM orders o WHERE o.id=? AND o.seller_id=? AND o.commerce_environment=? AND o.commerce_version=1`).bind(orderId,authority.sellerId,mode(env)).first();
  if(!order)fail('Order not found.',404);return {order,authority};
}
async function writable(env,actor,orderId){
  if(!commerceStorageEnabled(env))fail('Refund requests are not available yet.',503);
  const authority=await access(env,actor,orderId);if(!authority.canWrite)fail('Your account can view refund requests but cannot change them.',403);return authority;
}
function databaseFailure(error){
  const text=String(error)+' '+String(error?.cause||'');
  if(text.includes('refund_actor_forbidden'))fail('Your access to this refund changed. Reload this page.',403);
  if(text.includes('refund_request_limit'))fail('Too many new refund requests for this order. Please try again later.',429);
  if(/refund_|UNIQUE constraint failed/.test(text))conflict('The order or refund allocation changed. Reload and review the saved request.');
  throw error;
}
const caseView=row=>({id:row.id,orderId:row.order_id,revision:row.revision,state:row.state,stateLabel:disputeActive(row.dispute_state)?'Ezkart review in progress':labels[row.state],
  amount:row.amount,currency:'IDR',createdAt:row.created_at,updatedAt:row.updated_at,
  paymentConfirmed:false,processingAvailable:false});

export async function refundOrder(env,actor,orderId){
  const {order,authority}=await orderFor(env,actor,orderId);
  const result=await env.DB.batch([
    env.DB.prepare(`SELECT i.id,i.title,i.product_type,i.quantity,i.unit_price_amount,i.fulfillment_snapshot_json,${reservedSql} AS reserved
      FROM order_items i WHERE i.order_id=? AND i.seller_id=? ORDER BY i.id`).bind(orderId,order.seller_id),
    env.DB.prepare(`SELECT COALESCE(SUM(r.shipping_amount),0) AS reserved FROM commerce_refunds r WHERE r.order_id=? AND ${reservationSql}`).bind(orderId),
  ]);
  const items=result[0].results.map(i=>({orderItemId:i.id,title:i.title,variant:JSON.parse(i.fulfillment_snapshot_json).variantName||'',type:i.product_type,
    quantity:i.quantity,price:i.unit_price_amount,paidAmount:i.quantity*i.unit_price_amount,reservedAmount:i.reserved,
    availableAmount:['physical','digital'].includes(i.product_type)?i.quantity*i.unit_price_amount-i.reserved:0}));
  const shipping={paidAmount:order.shipping_amount,reservedAmount:result[1].results[0].reserved,availableAmount:order.shipping_amount-result[1].results[0].reserved};
  const reason=!commerceStorageEnabled(env)?'Refund requests are not available yet.':!authority.canWrite?'Your account can view refund requests but cannot change them.':reasonFor(order)||
    (!items.some(i=>i.availableAmount>0)&&shipping.availableAmount===0?'The remaining purchase amount is already included in refund requests.':'');
  await access(env,actor,orderId);
  return {order:{id:orderId,revision:order.revision,state:order.checkout_state,...(actor.kind==='merchant'?{customerName:order.customer_name}: {})},
    items,shipping,canCreate:!reason,reason,enabled:commerceStorageEnabled(env),processingAvailable:false};
}

export async function refundDetail(env,actor,id,expectedOrder=''){
  caseId(id);
  const row=await env.DB.prepare('SELECT * FROM commerce_refunds WHERE id=? AND commerce_environment=?').bind(id,mode(env)).first();
  if(!row||(expectedOrder&&row.order_id!==expectedOrder))fail('Refund request not found.',404);
  if(actor.kind==='support'&&!await env.DB.prepare('SELECT id FROM commerce_refund_disputes WHERE refund_id=?').bind(id).first())fail('Review not found.',404);
  const {order,authority}=await orderFor(env,actor,row.order_id);if(order.seller_id!==row.seller_id)fail('Refund request not found.',404);
  const result=await env.DB.batch([
    env.DB.prepare(`SELECT ri.order_item_id,ri.amount,i.title,i.quantity,i.unit_price_amount,i.product_type,i.fulfillment_snapshot_json,
      p.version_id AS purchased_file,d.verified_at AS downloaded_at
      FROM commerce_refund_items ri JOIN order_items i ON i.id=ri.order_item_id
      LEFT JOIN commerce_digital_purchases p ON p.order_item_id=i.id AND p.order_id=i.order_id AND p.seller_id=i.seller_id
      LEFT JOIN commerce_digital_entitlements e ON e.order_item_id=p.order_item_id AND e.capture_id=?
      LEFT JOIN commerce_digital_deliveries d ON d.order_item_id=e.order_item_id AND d.evidence_version=1
      WHERE ri.refund_id=? ORDER BY ri.order_item_id`).bind(row.capture_id,id),
    env.DB.prepare('SELECT kind,actor_kind,message,created_at FROM commerce_refund_actions WHERE refund_id=? ORDER BY sequence').bind(id),
    env.DB.prepare(`SELECT c.amount,c.currency,c.verified_at,o.payment_review,o.fulfillment_review,
      json_extract(o.snapshot_json,'$.shipping.skipped') AS shipping_skipped,
      (SELECT MIN(s.delivered_at) FROM commerce_shipments s WHERE s.order_id=o.id AND s.seller_id=o.seller_id
        AND s.commerce_environment=o.commerce_environment AND s.provider_id IS NOT NULL AND s.provider_account_hash IS NOT NULL AND s.delivered_at IS NOT NULL) AS courier_delivered_at
      FROM commerce_payment_captures c JOIN orders o ON o.id=c.order_id AND o.seller_id=c.seller_id
      WHERE c.id=? AND c.order_id=? AND c.seller_id=? AND c.commerce_environment=? AND c.capture_kind='order_payment'`).bind(row.capture_id,row.order_id,row.seller_id,row.commerce_environment),
    env.DB.prepare(`SELECT r.id,r.state,r.created_at,COUNT(*) OVER() AS related_count,
      (SELECT json_group_array(json_object('orderItemId',ri.order_item_id,'quantity',ri.quantity,'received',
        COALESCE((SELECT SUM(n.received_quantity) FROM commerce_return_inspections n WHERE n.return_id=ri.return_id AND n.order_item_id=ri.order_item_id),0)))
        FROM commerce_return_items ri WHERE ri.return_id=r.id AND EXISTS(SELECT 1 FROM commerce_refund_items fi WHERE fi.refund_id=? AND fi.order_item_id=ri.order_item_id)) AS items_json
      FROM commerce_returns r WHERE r.order_id=? AND r.seller_id=? AND EXISTS(SELECT 1 FROM commerce_return_items ri
        JOIN commerce_refund_items fi ON fi.order_item_id=ri.order_item_id WHERE ri.return_id=r.id AND fi.refund_id=?)
      ORDER BY r.created_at DESC,r.id DESC LIMIT 20`).bind(id,row.order_id,row.seller_id,id),
    env.DB.prepare(`SELECT id,actor_kind,filename,mime_type,size_bytes,content_hash,caption,state,created_at,ready_at
      FROM commerce_refund_attachments WHERE refund_id=? ORDER BY sequence`).bind(id),
  ]);
  const dispute=await disputeView(env,actor,id,authority),data=JSON.parse(row.data_json),canWrite=commerceStorageEnabled(env)&&authority.canWrite&&row.state==='requested'&&!dispute?.active&&actor.kind!=='support';
  const payment=result[2].results[0];
  await access(env,actor,row.order_id);
  return {...caseView({...row,dispute_state:dispute?.state}),orderRevision:order.revision,reason:data.reason,note:data.note,shippingAmount:row.shipping_amount,
    dispute,canRequestReview:commerceStorageEnabled(env)&&authority.canWrite&&actor.kind!=='support'&&!dispute&&row.state!=='withdrawn',
    evidenceVersion:result[4].results.reduce((sum,file)=>sum+1+(file.state==='ready'?1:0),0),
    canUploadEvidence:commerceStorageEnabled(env)&&authority.canWrite&&actor.kind!=='support',
    attachments:result[4].results.map(file=>({id:file.id,actor:file.actor_kind==='merchant'?'Store':'Buyer',filename:file.filename,
      mime:file.mime_type,size:file.size_bytes,sha256:file.content_hash,caption:file.caption,state:file.state,createdAt:file.created_at,readyAt:file.ready_at})),
    items:result[0].results.map(i=>{const snapshot=JSON.parse(i.fulfillment_snapshot_json),file=snapshot.digitalFile;
      return {orderItemId:i.order_item_id,amount:i.amount,title:i.title,variant:snapshot.variantName||'',quantity:i.quantity,price:i.unit_price_amount,type:i.product_type,
        ...(i.product_type==='digital'?{download:file&&i.purchased_file===file.id?{filename:file.filename,version:file.version,size:file.size,confirmedAt:i.downloaded_at||null}:null}:{})};}),
    evidence:{payment:payment?{amount:payment.amount,currency:payment.currency,confirmedAt:payment.verified_at}:null,
      paymentReview:Boolean(payment?.payment_review),fulfillmentReview:Boolean(payment?.fulfillment_review),shippingSkipped:Boolean(payment?.shipping_skipped),courierDeliveredAt:payment?.courier_delivered_at||null,
      returns:result[3].results.map(r=>({id:r.id,state:r.state,createdAt:r.created_at,items:JSON.parse(r.items_json)})),moreReturns:Number(result[3].results[0]?.related_count||0)>20},
    history:result[1].results.map(a=>({kind:a.kind,actor:a.actor_kind==='merchant'?'Store':'Buyer',message:a.message,createdAt:a.created_at})),
    canApprove:canWrite&&actor.kind==='merchant'&&!reasonFor(order),canDecline:canWrite&&actor.kind==='merchant',
    canWithdraw:canWrite&&(actor.kind==='buyer'||row.actor_kind==='merchant'&&row.actor_auth_user_id===actor.id)};
}

export async function refundList(env,actor,url,orderId=''){
  const authority=orderId?(await orderFor(env,actor,orderId)).authority:await access(env,actor,'');
  for(const key of url.searchParams.keys())if(!['state','cursor'].includes(key)||url.searchParams.getAll(key).length!==1)fail('Refund filters are invalid.');
  const state=url.searchParams.get('state')||'all';if(!['all','open','requested','approved','declined','withdrawn'].includes(state))fail('Refund status is invalid.');
  const scope=await commerceHash({actor,environment:mode(env),orderId,state}),cursor=url.searchParams.has('cursor')?readReviewCursor(url.searchParams.get('cursor'),scope):null;
  if(cursor&&(!Number.isSafeInteger(cursor.cap)||!Number.isSafeInteger(cursor.before)||cursor.before<1||cursor.cap<cursor.before))fail('Refund page is invalid.');
  const cap=cursor?.cap??(await env.DB.prepare('SELECT COALESCE(MAX(sequence),0) AS cap FROM commerce_refunds WHERE seller_id=? AND commerce_environment=?').bind(authority.sellerId,mode(env)).first()).cap;
  const result=await env.DB.prepare(`SELECT r.*,(SELECT d.state FROM commerce_refund_disputes d WHERE d.refund_id=r.id) AS dispute_state
    FROM commerce_refunds r WHERE r.seller_id=? AND r.commerce_environment=? AND (?='' OR r.order_id=?)
    AND r.sequence<=? AND r.sequence<? AND (?='all' OR (?='open' AND ${reservationSql}) OR r.state=?) ORDER BY r.sequence DESC LIMIT 26`)
    .bind(authority.sellerId,mode(env),orderId,orderId,cap,cursor?.before??cap+1,state,state,state).all();
  const rows=result.results.slice(0,25);await access(env,actor,orderId);
  return {refunds:rows.map(caseView),nextCursor:result.results.length>25?reviewCursor({v:1,scope,cap,before:rows.at(-1).sequence}):null,enabled:commerceStorageEnabled(env)};
}

export async function createRefund(env,actor,orderId,raw){
  await writable(env,actor,orderId);
  fields(raw,['requestKey','orderRevision','reason','note','items','shippingAmount']);
  if(!reasons.includes(raw.reason)||!Array.isArray(raw.items)||raw.items.length>50)fail('Choose the items and explain the refund.');
  const items=raw.items.map(item=>{fields(item,['orderItemId','amount']);if(typeof item.orderItemId!=='string'||!/^item_[A-Za-z0-9-]{3,90}$/.test(item.orderItemId))fail('Refund item is invalid.');
    return {orderItemId:item.orderItemId,amount:integer(item.amount,'Requested item amount',1)};}).sort((a,b)=>a.orderItemId.localeCompare(b.orderItemId));
  if(new Set(items.map(i=>i.orderItemId)).size!==items.length)fail('Choose each item once.');
  const input={requestKey:requestKey(raw.requestKey),orderRevision:integer(raw.orderRevision,'Order revision',1,Number.MAX_SAFE_INTEGER),
    reason:raw.reason,note:message(raw.note),items,shippingAmount:integer(raw.shippingAmount??0,'Requested shipping amount',0,100000000)};
  const amount=integer(items.reduce((total,item)=>total+item.amount,input.shippingAmount),'Total requested amount',1);
  const hash=await commerceHash({actor:{kind:actor.kind,id:actor.id},orderId,environment:mode(env),...input});
  const replay=async()=>{const saved=await env.DB.prepare('SELECT id,request_hash FROM commerce_refunds WHERE actor_auth_user_id=? AND request_key=?').bind(actor.id,input.requestKey).first();
    if(!saved)return null;if(saved.request_hash!==hash)conflict('This request identity was already used for different refund details.');return refundDetail(env,actor,saved.id,orderId);};
  const previous=await replay();if(previous)return previous;
  const {order}=await orderFor(env,actor,orderId);if(order.revision!==input.orderRevision)conflict('The order changed. Reload before requesting a refund.');
  const reason=reasonFor(order);if(reason)conflict(reason);
  const id='ref_'+crypto.randomUUID().replaceAll('-',''),now=new Date().toISOString();
  const data=JSON.stringify({reason:input.reason,note:input.note,items,shippingAmount:input.shippingAmount});
  try{await env.DB.prepare(`INSERT INTO commerce_refunds(id,seller_id,order_id,commerce_environment,capture_id,actor_kind,actor_auth_user_id,
    request_key,request_hash,order_revision,data_json,amount,shipping_amount,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`)
    .bind(id,order.seller_id,orderId,mode(env),order.capture_id,actor.kind,actor.id,input.requestKey,hash,input.orderRevision,data,amount,input.shippingAmount,now,now).run();}
  catch(error){const saved=await replay();if(saved)return saved;databaseFailure(error);}
  return refundDetail(env,actor,id,orderId);
}

export async function changeRefund(env,actor,id,raw,expectedOrder=''){
  caseId(id);const detail=await refundDetail(env,actor,id,expectedOrder);await writable(env,actor,detail.orderId);
  fields(raw,['requestKey','revision','orderRevision','kind','message','evidenceVersion']);
  if(!['approve','decline','withdraw'].includes(raw.kind))fail('Refund action is invalid.');
  if(actor.kind==='buyer'&&raw.kind!=='withdraw')fail('Only the store can decide a refund request.',403);
  const input={requestKey:requestKey(raw.requestKey),revision:integer(raw.revision,'Refund revision',1,Number.MAX_SAFE_INTEGER),
    orderRevision:integer(raw.orderRevision,'Order revision',1,Number.MAX_SAFE_INTEGER),kind:raw.kind,message:message(raw.message),
    ...(raw.evidenceVersion===undefined?{}:{evidenceVersion:integer(raw.evidenceVersion,'Evidence version',0,40)})};
  const hash=await commerceHash({actor:{kind:actor.kind,id:actor.id},refundId:id,environment:mode(env),...input});
  const replay=async()=>{const saved=await env.DB.prepare('SELECT refund_id,request_hash FROM commerce_refund_actions WHERE actor_auth_user_id=? AND request_key=?').bind(actor.id,input.requestKey).first();
    if(!saved)return null;if(saved.refund_id!==id||saved.request_hash!==hash)conflict('This request identity was already used for another refund decision.');return refundDetail(env,actor,id,expectedOrder);};
  const previous=await replay();if(previous)return previous;
  if(detail.revision!==input.revision||detail.orderRevision!==input.orderRevision)conflict('The order or refund request changed. Reload before deciding.');
  if(detail.evidenceVersion!==(input.evidenceVersion??0))conflict('The supporting files changed. Reload and review them before deciding.');
  if(!detail['can'+input.kind[0].toUpperCase()+input.kind.slice(1)])conflict('This action is no longer available. Reload the refund request.');
  const authority=await access(env,actor,detail.orderId),now=new Date().toISOString();
  try{await env.DB.prepare(`INSERT INTO commerce_refund_actions(id,refund_id,seller_id,actor_kind,actor_auth_user_id,request_key,request_hash,
    previous_revision,order_revision,kind,message,created_at,evidence_version) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`)
    .bind('raction_'+crypto.randomUUID().replaceAll('-',''),id,authority.sellerId,actor.kind,actor.id,input.requestKey,hash,input.revision,input.orderRevision,input.kind,input.message,now,input.evidenceVersion??0).run();}
  catch(error){const saved=await replay();if(saved)return saved;databaseFailure(error);}
  return refundDetail(env,actor,id,expectedOrder);
}
export {access as refundAccess};
