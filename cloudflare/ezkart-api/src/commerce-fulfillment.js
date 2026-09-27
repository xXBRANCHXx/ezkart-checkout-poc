import {commerceEnvironment,commerceHash,commerceOrder,commerceJobStatement,commerceStorageEnabled} from './commerce-orders.js';
import {currentCommerceEnvironment,customerOrderSeller} from './commerce-access.js';
import {buyerDigitalPurchases} from './commerce-digital.js';

const fail=(message,status=422)=>{throw new Response(message,{status});};
const shipPattern=/^ship_[a-f0-9]{32}$/;
const parse=value=>JSON.parse(value||'{}');
const id=prefix=>prefix+crypto.randomUUID().replaceAll('-','');
const str=(value,max,label,required=false)=>{
  if(typeof value!=='string'||value.length>max||/[\u0000-\u001f]/.test(value)||(required&&!value.trim()))fail(`${label} is invalid`);
  return value.trim();
};
const states=['confirmed','scheduled','allocated','picking_up','picked','in_transit','dropping_off','delivered','return_in_transit','returned','cancelled','disposed','on_hold','rejected','courier_not_found'];
const ranks={queued:0,confirmed:10,scheduled:10,allocated:20,picking_up:30,picked:40,in_transit:50,dropping_off:60,delivered:70,return_in_transit:80,returned:90,disposed:100};
const cancellable=['confirmed','scheduled','allocated','picking_up','on_hold','courier_not_found'];
const providerId=value=>{str(value,160,'Courier order ID',true);if(!/^[A-Za-z0-9][A-Za-z0-9_-]{2,159}$/.test(value))fail('Courier order ID is invalid');return value;};
const safeLink=value=>{if(!value)return '';str(value,2000,'Courier link');let u;try{u=new URL(value);}catch{fail('Courier link is invalid');}if(u.protocol!=='https:'||u.username||u.password||u.port)fail('Courier link is invalid');return u.href;};
const coordinate=value=>{if(value==null)return null;if(typeof value!=='object'||!Number.isFinite(value.latitude)||!Number.isFinite(value.longitude)||Math.abs(value.latitude)>90||Math.abs(value.longitude)>180||(value.latitude===0&&value.longitude===0))fail('Courier coordinate is invalid');return {latitude:value.latitude,longitude:value.longitude};};
const timestamp=value=>{if(!value)return '';str(value,40,'Courier timestamp');if(!/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{1,3})?(?:Z|[+-]\d\d:\d\d)$/.test(value)||!Number.isFinite(Date.parse(value))||Date.parse(value)>Date.now()+300000)fail('Courier timestamp is invalid');return new Date(value).toISOString();};
function eventData(value,nested=false){
  if(!value||!['status','price','waybill'].includes(value.kind))fail('Courier event type is invalid');
  const status=value.status||'';
  if((value.kind==='status'&&!states.includes(status))||(status&&!states.includes(status)))fail('Courier status is invalid');
  const data={kind:value.kind,status,updatedAt:timestamp(value.updatedAt||''),trackingId:str(value.trackingId||'',160,'Tracking ID'),
    waybillId:str(value.waybillId||'',160,'Waybill'),link:safeLink(value.link||''),note:str(value.note||'',500,'Courier note'),
    locationName:str(value.locationName||'',120,'Scan location'),coordinate:coordinate(value.coordinate),proofLink:safeLink(value.proofLink||'')};
  if(value.price!==undefined){if(!Number.isSafeInteger(value.price)||value.price<0||value.price>100000000)fail('Courier price is invalid');data.price=value.price;}
  if(value.kind==='price'&&data.price===undefined)fail('Courier price is required');
  if(value.history!==undefined){
    if(nested||!Array.isArray(value.history)||value.history.length>100)fail('Courier history is invalid');
    data.history=value.history.map(entry=>{const item=eventData(entry,true);if(item.kind!=='status'||!item.updatedAt)fail('Courier history requires a dated status');return item;});
  }
  return data;
}
const shipmentView=row=>row?{id:row.id,orderId:row.order_id,sequence:row.sequence,reference:row.reference,providerId:row.provider_id||'',
  state:row.state,maximumStage:row.maximum_stage,statusAt:row.status_at,statusReceivedAt:row.status_received_at,deliveredAt:row.delivered_at||null,
  tracking:parse(row.tracking_json),actualPrice:row.actual_price,createdAt:row.created_at,boundAt:row.bound_at}:null;
function pickupIssue(order){
  const shipping=order.snapshot.shipping,origin=shipping.origin||{},destination=shipping.destination||{};
  if(shipping.skipped||shipping.kind==='none')return '';
  if(!/^[a-z0-9_]{2,60}$/.test(shipping.courierCode||'')||!/^[a-z0-9_]{2,60}$/.test(shipping.serviceCode||''))return 'The saved courier service is incomplete. Contact support before arranging pickup.';
  if(!/^\d{5}$/.test(origin.origin_postal_code||'')||!/^\d{5}$/.test(destination.postalCode||'')
    ||!origin.origin_contact_name||!order.customer.name||!/^\+?\d{8,15}$/.test(origin.origin_contact_phone||'')||!/^\+?\d{8,15}$/.test(order.customer.phone||'')
    ||typeof origin.origin_address!=='string'||origin.origin_address.length<5||typeof destination.address!=='string'||destination.address.length<5)return 'The saved pickup or delivery address is incomplete. Contact support before arranging pickup.';
  if((['gojek','grab'].includes(shipping.courierCode)||['instant','instant_car','instant_bike','same_day'].includes(shipping.serviceCode))&&(!origin.coordinate||!destination.coordinate))return 'This delivery service needs saved pickup and delivery pins. Contact support before arranging pickup.';
  return '';
}
const eventStatement=(env,order,key,type,data,hash,now)=>env.DB.prepare(`INSERT INTO commerce_order_events
  (id,seller_id,order_id,event_key,event_type,payload_hash,previous_revision,data_json,created_at) VALUES (?,?,?,?,?,?,?,?,?)`)
  .bind(id('event_'),order.sellerId,order.id,key,type,hash,order.revision,JSON.stringify(data),now);
function databaseFailure(error){
  const message=String(error?.message||'')+' '+String(error?.cause?.message||'');
  if(message.includes('fulfillment_actor_forbidden'))fail('Your account cannot change fulfillment',403);
  if(/fulfillment_order_ineligible|commerce_revision_conflict|UNIQUE constraint failed|commerce_immutable_shipment/.test(message))fail('The order or shipment changed. Reload before continuing.',409);
  throw error;
}
async function shipments(env,order){return (await env.DB.prepare('SELECT * FROM commerce_shipments WHERE order_id=? AND seller_id=? ORDER BY sequence DESC').bind(order.id,order.sellerId).all()).results;}

export async function fulfillmentDetail(env,actor,orderId,before=''){
  if(before&&(before.length>120||!/^\d{4}-.*~[a-f0-9]{64}$/.test(before)))fail('History cursor is invalid');
  const order=await commerceOrder(env,actor.sellerId,orderId,currentCommerceEnvironment(env));
  const rows=await shipments(env,order),current=rows[0];
  const result=await env.DB.batch([
    env.DB.prepare("SELECT id,kind,state,attempts,maximum_attempts,last_error,payload_json FROM commerce_jobs WHERE order_id=? AND kind IN ('shipment.create','shipment.cancel','shipment.refresh') ORDER BY created_at DESC,id DESC LIMIT 30").bind(orderId),
    env.DB.prepare(`SELECT * FROM commerce_shipping_inbox WHERE shipment_id IN (SELECT id FROM commerce_shipments WHERE order_id=?)
      AND (?='' OR received_at||'~'||id<?) ORDER BY received_at DESC,id DESC LIMIT 51`).bind(orderId,before,before),
    env.DB.prepare("SELECT kind,json_extract(payload_json,'$.shipmentId') AS shipment_id FROM commerce_jobs WHERE order_id=? AND kind IN ('shipment.cancel','shipment.refresh') AND state IN ('queued','running','uncertain','retry')").bind(orderId),
    env.DB.prepare("SELECT MAX(created_at) AS created_at FROM commerce_fulfillment_actions WHERE order_id=? AND kind='refresh' AND shipment_id=?").bind(orderId,current?.id||''),
  ]);
  const jobs=result[0].results.map(j=>({id:j.id,kind:j.kind,state:j.state,attempts:j.attempts,exhausted:j.attempts>=j.maximum_attempts,error:j.last_error,shipmentId:parse(j.payload_json).shipmentId}));
  const canWrite=commerceStorageEnabled(env)&&actor.role!=='viewer';
  const issue=pickupIssue(order),eligible=canWrite&&order.state==='paid'&&!order.paymentReview&&!order.fulfillmentReview&&!order.snapshot.shipping.skipped&&order.snapshot.shipping.kind!=='none';
  const cancelPending=current&&result[2].results.some(j=>j.shipment_id===current.id&&j.kind==='shipment.cancel');
  const lastRefresh=result[3].results[0]?.created_at,refreshAvailableAt=lastRefresh?new Date(Date.parse(lastRefresh)+120000).toISOString():null;
  const {payment,paymentRequestId,paymentJobState,paymentJobError,...safeOrder}=order;
  return {order:safeOrder,shipments:rows.map(shipmentView),jobs,
    history:result[1].results.slice(0,50).map(r=>({id:r.id,shipmentId:r.shipment_id,source:r.source,receivedAt:r.received_at,...parse(r.payload_json)})),
    historyCursor:result[1].results.length>50?result[1].results[49].received_at+'~'+result[1].results[49].id:null,
    pickupIssue:issue,canAccept:eligible&&order.fulfillmentState==='awaiting_acceptance',canPickup:eligible&&!issue&&['awaiting_pickup_arrangement','cancelled'].includes(order.fulfillmentState),
    canCancel:!!(canWrite&&current?.provider_id&&cancellable.includes(current.state)&&current.maximum_stage<40&&!cancelPending),
    refreshAvailableAt,canRefresh:canWrite&&!!current?.provider_id&&(!refreshAvailableAt||Date.parse(refreshAvailableAt)<=Date.now())&&!result[2].results.some(j=>j.kind==='shipment.refresh'&&j.shipment_id===current.id),enabled:commerceStorageEnabled(env)};
}

export async function fulfillmentList(env,actor,url){
  const limit=Number(url.searchParams.get('limit')||25),cursor=url.searchParams.get('cursor')||'',state=url.searchParams.get('state')||'needs_action',q=(url.searchParams.get('q')||'').trim();
  if(!Number.isInteger(limit)||limit<1||limit>50||cursor.length>160||q.length>100||!['needs_action','all','awaiting_acceptance','processing','in_transit','delivered','attention'].includes(state))fail('Order filters are invalid');
  const where={all:'1',needs_action:"o.checkout_state='paid' AND o.payment_review=0 AND o.fulfillment_review=0 AND o.fulfillment_state IN ('awaiting_acceptance','awaiting_pickup_arrangement','cancelled')",
    awaiting_acceptance:"o.fulfillment_state='awaiting_acceptance'",processing:"o.fulfillment_state IN ('awaiting_pickup_arrangement','pickup_requested','confirmed','scheduled','allocated','picking_up')",
    in_transit:"o.fulfillment_state IN ('picked','in_transit','dropping_off')",delivered:"o.fulfillment_state='delivered'",
    attention:"(o.payment_review=1 OR o.fulfillment_review=1 OR o.fulfillment_state IN ('stock_review','on_hold','rejected','courier_not_found','return_in_transit','returned','disposed') OR EXISTS (SELECT 1 FROM commerce_jobs j WHERE j.order_id=o.id AND j.kind LIKE 'shipment.%' AND j.state IN ('uncertain','dead')))"}[state];
  const result=await env.DB.prepare(`SELECT o.* FROM orders o WHERE o.seller_id=? AND o.commerce_environment=? AND o.commerce_version=1
    AND ${where} AND (?='' OR o.created_at||'~'||o.id<?) AND (?='' OR instr(lower(o.id),lower(?))>0 OR instr(lower(json_extract(o.customer_snapshot_json,'$.name')),lower(?))>0)
    ORDER BY o.created_at DESC,o.id DESC LIMIT ?`).bind(actor.sellerId,currentCommerceEnvironment(env),cursor,cursor,q,q,q,limit+1).all();
  return {sellerId:actor.sellerId,enabled:commerceStorageEnabled(env),canWrite:commerceStorageEnabled(env)&&actor.role!=='viewer',items:result.results.slice(0,limit).map(r=>({id:r.id,revision:r.revision,state:r.checkout_state,
    fulfillmentState:r.fulfillment_state,review:Boolean(r.payment_review||r.fulfillment_review),customerName:parse(r.customer_snapshot_json).name,total:r.total_amount,createdAt:r.created_at})),
    nextCursor:result.results.length>limit?result.results[limit-1].created_at+'~'+result.results[limit-1].id:null};
}

export async function fulfillmentAction(env,actor,orderId,input){
  if(!commerceStorageEnabled(env))fail('Central order processing is not enabled',503);
  if(actor.role==='viewer')fail('Your account cannot change fulfillment',403);
  if(!/^[A-Za-z0-9_-]{16,100}$/.test(input.requestKey||'')||!Number.isSafeInteger(input.revision)||input.revision<1||!['accept','pickup','cancel_pickup','refresh'].includes(input.kind))fail('Fulfillment request is invalid');
  const note=str(input.note||'',1000,'Fulfillment note');
  if(input.kind==='cancel_pickup'&&note.length<5)fail('Explain why this pickup should be cancelled');
  const hash=await commerceHash({orderId,actor:actor.id,revision:input.revision,kind:input.kind,note});
  const existing=()=>env.DB.prepare('SELECT request_hash,receipt_json FROM commerce_fulfillment_actions WHERE seller_id=? AND request_key=?').bind(actor.sellerId,input.requestKey).first();
  const replay=row=>{if(row.request_hash!==hash)fail('This request key already belongs to another operation',409);return parse(row.receipt_json);};
  const previous=await existing();if(previous)return replay(previous);
  const view=await fulfillmentDetail(env,actor,orderId),order=view.order;
  if(order.revision!==input.revision)fail('The order changed. Reload and review it before continuing.',409);
  if(!({accept:view.canAccept,pickup:view.canPickup,cancel_pickup:view.canCancel,refresh:view.canRefresh})[input.kind])fail('This fulfillment action is not currently available',409);
  const now=new Date().toISOString(),actionId=id('fulfill_'),current=view.shipments[0],shipmentId=input.kind==='pickup'?id('ship_'):current?.id||null;
  const receipt={id:actionId,orderId,kind:input.kind,shipmentId,revision:order.revision+1,createdAt:now};
  const statements=[env.DB.prepare(`INSERT INTO commerce_fulfillment_actions(id,seller_id,order_id,request_key,request_hash,order_revision,actor_auth_user_id,kind,shipment_id,note,receipt_json,created_at)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`).bind(actionId,actor.sellerId,orderId,input.requestKey,hash,order.revision,actor.id,input.kind,shipmentId,note,JSON.stringify(receipt),now),
    eventStatement(env,order,'fulfillment:'+input.requestKey,'fulfillment.'+input.kind,{actor:actor.id,shipmentId,note},hash,now)];
  let next=order.fulfillmentState,acceptedAt=order.acceptedAt||null;
  if(input.kind==='accept'){next='awaiting_pickup_arrangement';acceptedAt=now;}
  if(input.kind==='pickup'){
    const sequence=(current?.sequence||0)+1,reference=orderId+'-'+sequence;
    statements.push(env.DB.prepare(`INSERT INTO commerce_shipments(id,seller_id,order_id,commerce_environment,sequence,reference,action_id,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?)`)
      .bind(shipmentId,actor.sellerId,orderId,order.environment,sequence,reference,actionId,now,now));
    statements.push(commerceJobStatement(env,{sellerId:actor.sellerId,orderId,environment:order.environment,kind:'shipment.create',key:'shipment_create:'+shipmentId,data:{shipmentId,reference}},now));next='pickup_requested';
  }
  if(['cancel_pickup','refresh'].includes(input.kind))statements.push(commerceJobStatement(env,{sellerId:actor.sellerId,orderId,environment:order.environment,
    kind:input.kind==='refresh'?'shipment.refresh':'shipment.cancel',key:input.kind+':'+actionId,data:{shipmentId,providerId:current.providerId,note}},now));
  statements.push(env.DB.prepare('UPDATE orders SET fulfillment_state=?,accepted_at=?,revision=revision+1,updated_at=? WHERE id=? AND seller_id=? AND revision=?')
    .bind(next,acceptedAt,now,orderId,actor.sellerId,order.revision));
  statements.push(commerceJobStatement(env,{sellerId:actor.sellerId,orderId,environment:order.environment,kind:'notification.shipment_updated',key:'fulfillment_notice:'+actionId,data:{orderId,kind:input.kind}},now));
  try{await env.DB.batch(statements);return receipt;}catch(error){const row=await existing();if(row)return replay(row);databaseFailure(error);}
}

export async function serviceShipment(env,shipmentId,environment){
  commerceEnvironment(env,environment);if(!shipPattern.test(shipmentId))fail('Shipment not found',404);
  const row=await env.DB.prepare('SELECT * FROM commerce_shipments WHERE id=? AND commerce_environment=?').bind(shipmentId,environment).first();
  if(!row)fail('Shipment not found',404);
  return {shipment:shipmentView(row),accountHash:row.provider_account_hash,order:await commerceOrder(env,row.seller_id,row.order_id,environment)};
}

export async function bindShipmentAccount(env,shipmentId,input){
  const record=await serviceShipment(env,shipmentId,input.environment),{order}=record;
  if(typeof input.accountHash!=='string'||!/^[a-f0-9]{64}$/.test(input.accountHash))fail('Courier account binding is invalid');
  if(record.accountHash&&record.accountHash!==input.accountHash)fail('Courier credentials no longer match this shipment',409);
  if(record.accountHash)return record;
  const now=new Date().toISOString();
  try{await env.DB.batch([eventStatement(env,order,'shipment_account:'+shipmentId,'shipment.account_bound',{shipmentId},input.accountHash,now),
    env.DB.prepare('UPDATE commerce_shipments SET provider_account_hash=?,updated_at=? WHERE id=? AND provider_account_hash IS NULL').bind(input.accountHash,now,shipmentId),
    env.DB.prepare('UPDATE orders SET revision=revision+1,updated_at=? WHERE id=? AND revision=?').bind(now,order.id,order.revision)]);
  }catch(error){const current=await serviceShipment(env,shipmentId,input.environment);if(current.accountHash!==input.accountHash)databaseFailure(error);}
  return serviceShipment(env,shipmentId,input.environment);
}

export async function customerShipment(env,orderId,input){
  commerceEnvironment(env,input.environment);
  if(typeof input.customerId!=='string'||!/^[A-Za-z0-9][A-Za-z0-9_-]{2,95}$/.test(input.customerId))fail('Order not found',404);
  const sellerId=await customerOrderSeller(env,{id:input.customerId},orderId);
  let digital=null;
  if(await env.DB.prepare("SELECT 1 FROM order_items WHERE order_id=? AND seller_id=? AND product_type='digital' LIMIT 1").bind(orderId,sellerId).first()){
    const purchases=await buyerDigitalPurchases(env,{id:input.customerId},orderId),items=purchases.items;
    const verified=items.filter(item=>item.deliveryConfirmed);
    digital={itemCount:items.length,verifiedCount:verified.length,
      deliveredAt:items.length&&verified.length===items.length?verified.map(item=>item.deliveredAt).sort().at(-1):null,
      accessState:items.find(item=>!item.canDownload)?.state||'available'};
  }
  const row=await env.DB.prepare('SELECT * FROM commerce_shipments WHERE order_id=? AND seller_id=? ORDER BY sequence DESC LIMIT 1').bind(orderId,sellerId).first();
  if(!row)return {shipment:null,history:[],digital};
  const events=await env.DB.prepare('SELECT payload_json,received_at FROM commerce_shipping_inbox WHERE shipment_id=? ORDER BY received_sequence DESC LIMIT 100').bind(row.id).all();
  const history=[],seen=new Map();
  for(const event of events.results){const data=parse(event.payload_json);for(const item of [data,...(data.history||[])]){
    if(item.kind!=='status')continue;const key=item.status+':'+(item.updatedAt||'undated');
    if(seen.has(key)){const previous=seen.get(key);for(const field of ['note','locationName','coordinate'])if(!previous[field]&&item[field])previous[field]=item[field];continue;}
    const entry={status:item.status,updatedAt:item.updatedAt,receivedAt:event.received_at,note:item.note||'',locationName:item.locationName||'',coordinate:item.coordinate||null};seen.set(key,entry);history.push(entry);
  }}
  history.sort((a,b)=>(a.updatedAt||a.receivedAt).localeCompare(b.updatedAt||b.receivedAt));
  const view=shipmentView(row),{fieldTimes,statusWatermarkAt,...tracking}=view.tracking;
  return {shipment:{id:view.id,providerId:view.providerId,sequence:view.sequence,state:view.state,statusAt:view.statusAt,statusReceivedAt:view.statusReceivedAt,boundAt:view.boundAt,tracking},history:history.slice(-100),digital};
}

export async function shippingInbox(env,input,source='webhook'){
  const environment=commerceEnvironment(env,input.environment),provider=providerId(input.providerId),data=eventData(input.data);
  const eventId=await commerceHash({environment,provider,source,data}),now=new Date().toISOString();
  await env.DB.prepare(`INSERT INTO commerce_shipping_inbox(id,commerce_environment,provider_id,source,payload_json,received_at)
    SELECT ?,?,?,?,?,? WHERE NOT EXISTS(SELECT 1 FROM commerce_shipping_inbox WHERE id=?)`)
    .bind(eventId,environment,provider,source,JSON.stringify(data),now,eventId).run();
  return {eventId,...await drainShippingInbox(env,environment,provider)};
}

export async function bindShipment(env,shipmentId,input){
  eventData(input.data);
  const {shipment,order}=await serviceShipment(env,shipmentId,input.environment),provider=providerId(input.providerId);
  if(input.verified!==true||input.reference!==shipment.reference)fail('Verified shipment reference is required',409);
  if(shipment.providerId&&shipment.providerId!==provider)fail('This shipment is already linked to a different courier order',409);
  if(!shipment.providerId){
    const now=new Date().toISOString(),hash=await commerceHash({provider,reference:shipment.reference});
    const job=await env.DB.prepare("SELECT id FROM commerce_jobs WHERE order_id=? AND kind='shipment.create' AND json_extract(payload_json,'$.shipmentId')=?").bind(order.id,shipmentId).first();
    if(!job)fail('Original pickup request is missing',409);
    try{await env.DB.batch([eventStatement(env,order,'shipment_bound:'+shipmentId,'shipment.bound',{shipmentId,provider},hash,now),
      env.DB.prepare('UPDATE commerce_shipments SET provider_id=?,bound_at=?,updated_at=? WHERE id=? AND provider_id IS NULL').bind(provider,now,now,shipmentId),
      env.DB.prepare('UPDATE orders SET revision=revision+1,updated_at=? WHERE id=? AND revision=?').bind(now,order.id,order.revision)]);
    }catch(error){const current=await serviceShipment(env,shipmentId,input.environment);if(current.shipment.providerId!==provider)databaseFailure(error);}
  }
  await shippingInbox(env,{environment:input.environment,providerId:provider,data:input.data},'create');
  return serviceShipment(env,shipmentId,input.environment);
}

function reduceEvent(shipment,data,source,receivedAt){
  const next={...shipment,tracking:{...shipment.tracking,fieldTimes:{...shipment.tracking.fieldTimes}}},current=shipment.state,target=data.status;
  const statusWatermark=shipment.tracking.statusWatermarkAt||shipment.statusAt;
  const stale=data.updatedAt&&statusWatermark&&data.updatedAt<statusWatermark;
  const terminal=['delivered','returned','cancelled','disposed'].includes(current);
  const allowedAfter=current==='delivered'?['delivered','return_in_transit','returned','disposed']:[current];
  const rank=ranks[target]??-1;
  const blocked=stale||(rank>=0&&rank<shipment.maximumStage)||(terminal&&!allowedAfter.includes(target));
  let review=false;
  if(target&&data.kind==='status'){
    if(!blocked){next.state=target;next.statusAt=data.updatedAt||(target===current?shipment.statusAt:'');next.statusReceivedAt=receivedAt;next.maximumStage=Math.max(shipment.maximumStage,rank);if(data.updatedAt)next.tracking.statusWatermarkAt=data.updatedAt;}
    else if(current==='cancelled'&&!stale&&rank>=40&&data.updatedAt)review=true;
    // Preserve actual delivery even when a later return becomes the current state.
    // Dated history comes from a verified read of this bound courier shipment.
    if(target==='delivered'&&(!blocked||source==='history'))next.deliveredAt ||= data.updatedAt||receivedAt;
  }
  // Undated retries cannot replace a known waybill or link. Authoritative GET
  // refreshes are revision-checked against callbacks before being applied.
  const authoritative=source==='refresh';
  const mayReplace=key=>authoritative||(data.updatedAt&&data.updatedAt>(next.tracking.fieldTimes[key]||'')&&(data.kind!=='status'||!blocked));
  const remember=key=>{next.tracking.fieldTimes[key]=authoritative?[receivedAt,data.updatedAt].sort().at(-1):data.updatedAt;};
  for(const key of ['trackingId','waybillId','link','proofLink'])if(data[key]&&(!next.tracking[key]||mayReplace(key))){next.tracking[key]=data[key];remember(key);}
  if(data.kind==='status'&&data.coordinate&&data.updatedAt&&(!next.tracking.latestLocation||data.updatedAt>=next.tracking.latestLocation.updatedAt)){
    const previous=next.tracking.latestLocation,same=previous?.updatedAt===data.updatedAt&&previous.latitude===data.coordinate.latitude&&previous.longitude===data.coordinate.longitude;
    next.tracking.latestLocation={...data.coordinate,updatedAt:data.updatedAt,label:data.locationName||(same?previous.label:''),status:data.status,source:'courier_scan'};
  }
  if(data.price!==undefined&&(next.actualPrice===null||mayReplace('price'))){next.actualPrice=data.price;remember('price');}
  return {shipment:next,review};
}

export async function drainShippingInbox(env,environment,provider){
  for(let attempt=0;attempt<4;attempt++){
    const row=await env.DB.prepare('SELECT s.*,o.revision AS observed_order_revision FROM commerce_shipments s JOIN orders o ON o.id=s.order_id WHERE s.commerce_environment=? AND s.provider_id=?').bind(environment,provider).first();
    if(!row)return {matched:false,applied:0};
    const order=await commerceOrder(env,row.seller_id,row.order_id,environment);
    // A callback may commit between these reads. Never combine an older
    // shipment with a newer order revision and then overwrite that callback.
    if(order.revision!==row.observed_order_revision)continue;
    const pending=await env.DB.prepare('SELECT * FROM commerce_shipping_inbox WHERE commerce_environment=? AND provider_id=? AND applied_at IS NULL ORDER BY received_sequence LIMIT 25').bind(environment,provider).all();
    if(!pending.results.length)return {matched:true,applied:0};
    let shipment=shipmentView(row),review=order.fulfillmentReview;
    for(const event of pending.results){
      const data=parse(event.payload_json);
      for(const item of [...(data.history||[]),data]){const next=reduceEvent(shipment,item,item===data?event.source:'history',event.received_at);shipment=next.shipment;review=review||next.review;}
    }
    const current=await env.DB.prepare('SELECT id FROM commerce_shipments WHERE order_id=? ORDER BY sequence DESC LIMIT 1').bind(order.id).first();
    const now=new Date().toISOString(),ids=pending.results.map(r=>r.id),hash=await commerceHash(ids),key='shipping_events:'+hash;
    try{await env.DB.batch([eventStatement(env,order,key,'shipment.updated',{shipmentId:row.id,eventIds:ids},hash,now),
      env.DB.prepare(`UPDATE commerce_shipments SET state=?,maximum_stage=?,status_at=?,status_received_at=?,tracking_json=?,actual_price=?,delivered_at=?,updated_at=? WHERE id=?`)
        .bind(shipment.state,shipment.maximumStage,shipment.statusAt,shipment.statusReceivedAt,JSON.stringify(shipment.tracking),shipment.actualPrice,shipment.deliveredAt,now,row.id),
      env.DB.prepare('UPDATE commerce_shipping_inbox SET applied_at=?,shipment_id=? WHERE id IN (SELECT value FROM json_each(?)) AND applied_at IS NULL').bind(now,row.id,JSON.stringify(ids)),
      env.DB.prepare('UPDATE orders SET fulfillment_state=?,fulfillment_review=?,revision=revision+1,updated_at=? WHERE id=? AND revision=?')
        .bind(current.id===row.id?shipment.state:order.fulfillmentState,Number(review),now,order.id,order.revision),
      commerceJobStatement(env,{sellerId:row.seller_id,orderId:row.order_id,environment,kind:'notification.shipment_updated',key,data:{orderId:row.order_id,shipmentId:row.id,state:shipment.state}},now)]);
      return {matched:true,applied:ids.length,more:ids.length===25};
    }catch(error){if(/commerce_revision_conflict|UNIQUE constraint failed/.test(String(error?.message)+' '+String(error?.cause?.message))&&attempt<3)continue;databaseFailure(error);}
  }
  fail('Courier events are changing. Retry the inbox drain.',409);
}

export async function refreshShipment(env,shipmentId,input){
  const {shipment,order}=await serviceShipment(env,shipmentId,input.environment);
  if(input.revision!==order.revision||input.providerId!==shipment.providerId||!shipment.providerId)fail('Courier updates arrived during refresh. Read the shipment again.',409);
  // The insertion and order revision guard share a transaction. A stale GET
  // response can never overwrite a webhook that committed in the meantime.
  const data=eventData(input.data),eventId=await commerceHash({environment:input.environment,provider:shipment.providerId,source:'refresh',data,revision:input.revision}),now=new Date().toISOString();
  try{await env.DB.batch([eventStatement(env,order,'shipping_refresh:'+eventId,'shipment.refresh_received',{shipmentId},eventId,now),
    env.DB.prepare(`INSERT INTO commerce_shipping_inbox(id,commerce_environment,provider_id,source,payload_json,received_at)
      SELECT ?,?,?,?,?,? WHERE NOT EXISTS(SELECT 1 FROM commerce_shipping_inbox WHERE id=?)`)
      .bind(eventId,input.environment,shipment.providerId,'refresh',JSON.stringify(data),now,eventId),
    env.DB.prepare('UPDATE orders SET revision=revision+1,updated_at=? WHERE id=? AND revision=?').bind(now,order.id,order.revision)]);
  }catch(error){databaseFailure(error);}
  return drainShippingInbox(env,input.environment,shipment.providerId);
}

export async function drainPendingShipping(env,input){
  const environment=commerceEnvironment(env,input.environment);
  const rows=await env.DB.prepare(`SELECT i.provider_id FROM commerce_shipping_inbox i JOIN commerce_shipments s
    ON s.provider_id=i.provider_id AND s.commerce_environment=i.commerce_environment WHERE i.commerce_environment=? AND i.applied_at IS NULL GROUP BY i.provider_id ORDER BY MIN(i.received_sequence) LIMIT 5`).bind(environment).all();
  let applied=0;for(const row of rows.results)applied+=(await drainShippingInbox(env,environment,row.provider_id)).applied;
  return {applied};
}
