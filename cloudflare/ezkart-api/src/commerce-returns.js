import {commerceHash,commerceOrder,commerceJobStatement,commerceStorageEnabled} from './commerce-orders.js';
import {currentCommerceEnvironment,customerOrderSeller} from './commerce-access.js';
import {inventorySql} from './inventory.js';

const fail=(message,status=422,code='')=>{throw new Response(message,{status,headers:code?{'x-ezkart-error-code':code}:{}});};
const conflict=message=>fail(message,409,'return_conflict');
const integer=(value,label,min=0,max=10000)=>{if(!Number.isSafeInteger(value)||value<min||value>max)fail(`${label} is invalid`);return value;};
const version=value=>integer(value,'Version',1,Number.MAX_SAFE_INTEGER);
const note=(value,label,required=true,max=1000)=>{
  if(typeof value!=='string'||value.length>max)fail(`${label} must be at most ${max} characters`);
  const cleaned=value.replaceAll('\r\n','\n').trim();
  if(/[\u0000-\u0008\u000b-\u001f]/.test(cleaned)||(required&&cleaned.length<3))fail(`${label} must explain the return`);return cleaned;
};
const key=value=>{if(typeof value!=='string'||!/^[A-Za-z0-9_-]{16,100}$/.test(value))fail('Return request key is invalid');return value;};
const itemId=value=>{if(typeof value!=='string'||!/^item_[A-Za-z0-9-]{3,90}$/.test(value))fail('Order item is invalid');return value;};
const reasons=['damaged','wrong_item','not_as_described','changed_mind','delivery_failed','other'];
const isMerchant=actor=>actor.kind==='merchant';
const write=(env,actor)=>{
  if(!commerceStorageEnabled(env))fail('Returns are not available yet',503);
  if(isMerchant(actor)&&actor.role==='viewer')fail('Your account cannot change returns',403);
};
const receivedSql="COALESCE((SELECT SUM(n.received_quantity) FROM commerce_return_inspections n WHERE n.return_id=ri.return_id AND n.order_item_id=ri.order_item_id),0)";
const outstandingSql=`COALESCE((SELECT SUM(CASE WHEN r.state IN ('declined','withdrawn','closed') THEN ${receivedSql} ELSE ri.quantity END)
  FROM commerce_return_items ri JOIN commerce_returns r ON r.id=ri.return_id WHERE ri.order_item_id=i.id),0)`;
const consumedSql="CASE WHEN EXISTS (SELECT 1 FROM inventory_reservations h WHERE h.order_item_id=i.id AND h.state='committed') OR EXISTS (SELECT 1 FROM commerce_stock_allocations a WHERE a.order_item_id=i.id) THEN i.quantity ELSE 0 END";
const actorCanWrite=(env,actor)=>commerceStorageEnabled(env)&&(!isMerchant(actor)||actor.role!=='viewer');
const caseId=value=>{if(typeof value!=='string'||!/^ret_[a-f0-9]{32}$/.test(value))fail('Return not found',404);return value;};

async function actorSeller(env,actor,orderId){
  return isMerchant(actor)?actor.sellerId:customerOrderSeller(env,{id:actor.id},orderId);
}
async function stockFor(env,sellerId,items){
  const rows=await env.DB.prepare(`${inventorySql} SELECT * FROM inventory WHERE row_key IN (SELECT value FROM json_each(?))`)
    .bind(sellerId,sellerId,sellerId,sellerId,JSON.stringify(items.map(item=>item.productId+'~'+item.variantId))).all();
  return new Map(rows.results.map(row=>[row.row_key,{title:row.title,sku:row.sku,revision:row.revision,onHand:row.on_hand,hidden:Boolean(row.hidden),status:row.status}]));
}
function databaseFailure(error){
  const message=`${error?.message||''} ${error?.cause?.message||''}`;
  if(message.includes('return_actor_forbidden'))fail('Your account cannot change this return',403);
  if(/return_original_option_missing/.test(message))conflict('An original option changed or cannot accept this stock. Reload the inspection. No quantities were saved.');
  if(/return_quantity_exceeded/.test(message))conflict('Return quantities changed. Reload the return before continuing. No quantities were saved.');
  if(/return_order_changed|return_revision_conflict|commerce_revision_conflict|catalog_revision_conflict|return_inspection_incomplete|UNIQUE constraint failed/.test(message))conflict('The order, return or stock changed. Reload and review it before continuing.');
  throw error;
}
const orderEvent=(env,sellerId,orderId,orderRevision,eventKey,type,data,hash,now)=>env.DB.prepare(`INSERT INTO commerce_order_events
  (id,seller_id,order_id,event_key,event_type,payload_hash,previous_revision,data_json,created_at) VALUES (?,?,?,?,?,?,?,?,?)`)
  .bind('event_'+crypto.randomUUID(),sellerId,orderId,eventKey,type,hash,orderRevision,JSON.stringify(data),now);
const advanceOrder=(env,sellerId,orderId,orderRevision,now)=>env.DB.prepare('UPDATE orders SET revision=revision+1,updated_at=? WHERE seller_id=? AND id=? AND revision=?').bind(now,sellerId,orderId,orderRevision);

export async function returnOrder(env,actor,orderId){
  const sellerId=await actorSeller(env,actor,orderId),order=await commerceOrder(env,sellerId,orderId,currentCommerceEnvironment(env));
  const rows=await env.DB.prepare(`SELECT i.*,${consumedSql} AS consumed,${outstandingSql} AS allocated FROM order_items i WHERE i.order_id=? AND i.seller_id=? ORDER BY i.id`).bind(orderId,sellerId).all();
  const items=rows.results.map(row=>{const f=JSON.parse(row.fulfillment_snapshot_json);return {orderItemId:row.id,productId:row.product_id,variantId:f.variantId||'',
    title:row.title+(f.variantName?' — '+f.variantName:''),sku:row.sku,ordered:row.quantity,consumed:row.consumed,allocated:row.allocated,
    availableToReturn:Math.max(0,row.consumed-row.allocated),price:row.unit_price_amount};});
  const fulfillmentOk=(isMerchant(actor)?['delivered','return_in_transit','returned']:['delivered']).includes(order.fulfillmentState);
  const reason=order.items.every(item=>item.productType!=='physical')?'For help with digital files, message the store from this order.':!['paid','partially_refunded','refunded'].includes(order.state)?'This order has no completed payment.':!fulfillmentOk?
    'A return can be opened after confirmed delivery or a courier return.':!items.some(item=>item.availableToReturn>0)?'All eligible units are already included in a return.':
    !commerceStorageEnabled(env)?'Returns are not available yet.':isMerchant(actor)&&actor.role==='viewer'?'Your account can view returns but cannot create them.':'';
  return {order:{id:order.id,sellerId,revision:order.revision,customerName:order.customer.name,state:order.state,fulfillmentState:order.fulfillmentState},items,canCreate:!reason,reason};
}

export async function returnList(env,actor,url){
  if(!isMerchant(actor))fail('Store access is required',403);
  const limit=Number(url.searchParams.get('limit')||25),cursor=url.searchParams.get('cursor')||'',state=url.searchParams.get('state')||'open';
  integer(limit,'Page size',1,50);
  if(cursor.length>150||/[\u0000-\u001f]/.test(cursor)||!['open','all','requested','approved','receiving','inspected','declined','withdrawn','closed'].includes(state))fail('Return filter is invalid');
  const result=await env.DB.prepare(`SELECT r.*,json_extract(o.customer_snapshot_json,'$.name') AS customer_name,
    (SELECT SUM(quantity) FROM commerce_return_items i WHERE i.return_id=r.id) AS quantity,
    COALESCE((SELECT SUM(received_quantity) FROM commerce_return_inspections n WHERE n.return_id=r.id),0) AS received,
    r.created_at || '~' || r.id AS cursor FROM commerce_returns r JOIN orders o ON o.id=r.order_id AND o.seller_id=r.seller_id
    WHERE r.seller_id=? AND o.commerce_environment=? AND (?='all' OR (?='open' AND r.state IN ('requested','approved','receiving','inspected')) OR r.state=?)
      AND (?='' OR r.created_at || '~' || r.id<?) ORDER BY r.created_at DESC,r.id DESC LIMIT ?`)
    .bind(actor.sellerId,currentCommerceEnvironment(env),state,state,state,cursor,cursor,limit+1).all();
  const rows=result.results.slice(0,limit);
  return {items:rows.map(row=>({id:row.id,orderId:row.order_id,state:row.state,revision:row.revision,reason:row.reason,
    customerName:row.customer_name||'',quantity:row.quantity,received:row.received,createdAt:row.created_at,updatedAt:row.updated_at})),nextCursor:result.results.length>limit?rows.at(-1).cursor:null,
    sellerId:actor.sellerId,enabled:commerceStorageEnabled(env),canCreate:actorCanWrite(env,actor)};
}

export async function returnDetail(env,actor,returnId,expectedOrderId='',before=''){
  caseId(returnId);
  if(before!==''&&!/^[1-9][0-9]{0,14}$/.test(String(before)))fail('History cursor is invalid');
  const historyBefore=before===''?Number.MAX_SAFE_INTEGER:Number(before);
  const row=await env.DB.prepare(`SELECT r.*,o.revision AS current_order_revision,o.checkout_state,o.fulfillment_state,
    json_extract(o.customer_snapshot_json,'$.name') AS customer_name FROM commerce_returns r JOIN orders o ON o.id=r.order_id AND o.seller_id=r.seller_id
    WHERE r.id=? AND o.commerce_environment=?`).bind(returnId,currentCommerceEnvironment(env)).first();
  if(!row||(expectedOrderId&&row.order_id!==expectedOrderId))fail('Return not found',404);
  if(await actorSeller(env,actor,row.order_id)!==row.seller_id)fail('Return not found',404);
  const result=await env.DB.batch([
    env.DB.prepare(`SELECT ri.*,i.product_id,i.title,i.sku,i.fulfillment_snapshot_json,${receivedSql} AS received,
      COALESCE((SELECT SUM(n.restocked_quantity) FROM commerce_return_inspections n WHERE n.return_id=ri.return_id AND n.order_item_id=ri.order_item_id),0) AS restocked
      FROM commerce_return_items ri JOIN order_items i ON i.id=ri.order_item_id AND i.seller_id=ri.seller_id WHERE ri.return_id=? ORDER BY ri.order_item_id`).bind(returnId),
    env.DB.prepare('SELECT * FROM commerce_return_actions WHERE return_id=? AND previous_revision<? ORDER BY previous_revision DESC LIMIT 51').bind(returnId,historyBefore),
  ]);
  const items=result[0].results.map(item=>{const f=JSON.parse(item.fulfillment_snapshot_json);return {orderItemId:item.order_item_id,productId:item.product_id,variantId:f.variantId||'',
    title:item.title+(f.variantName?' — '+f.variantName:''),sku:item.sku,quantity:item.quantity,received:item.received,restocked:item.restocked,remaining:item.quantity-item.received};});
  if(isMerchant(actor)){const stock=await stockFor(env,row.seller_id,items);for(const item of items)item.current=stock.get(item.productId+'~'+item.variantId)||null;}
  const canWrite=actorCanWrite(env,actor),merchant=isMerchant(actor);
  return {id:row.id,sellerId:row.seller_id,order:{id:row.order_id,revision:row.current_order_revision,customerName:row.customer_name,state:row.checkout_state,fulfillmentState:row.fulfillment_state},
    revision:row.revision,state:row.state,reason:row.reason,customerNote:row.customer_note,createdAt:row.created_at,updatedAt:row.updated_at,items,
    historyCursor:result[1].results.length>50?String(result[1].results[49].previous_revision):null,
    actions:result[1].results.slice(0,50).map(action=>({id:action.id,kind:action.kind,state:action.target_state,actor:action.actor_kind==='customer'?'Customer':'Store',
      message:action.public_message,createdAt:action.created_at,...(merchant?{privateNote:action.private_note,receipt:JSON.parse(action.receipt_json)}:{})})),
    canApprove:canWrite&&merchant&&row.state==='requested',canDecline:canWrite&&merchant&&row.state==='requested',
    canWithdraw:canWrite&&row.state==='requested',canInspect:canWrite&&merchant&&['approved','receiving'].includes(row.state),
    canClose:canWrite&&merchant&&['approved','receiving'].includes(row.state)};
}

export async function customerReturns(env,user,orderId,url){
  const actor={kind:'customer',id:user.id},overview=await returnOrder(env,actor,orderId);
  const cursor=url.searchParams.get('cursor')||'';
  if(cursor.length>150||/[\u0000-\u001f]/.test(cursor))fail('Return filter is invalid');
  const rows=await env.DB.prepare(`SELECT id,state,reason,created_at,updated_at,created_at || '~' || id AS cursor FROM commerce_returns
    WHERE order_id=? AND seller_id=? AND (?='' OR created_at || '~' || id<?) ORDER BY created_at DESC,id DESC LIMIT 26`)
    .bind(orderId,overview.order.sellerId,cursor,cursor).all();
  const page=rows.results.slice(0,25);
  return {...overview,returns:page.map(row=>({id:row.id,state:row.state,reason:row.reason,createdAt:row.created_at,updatedAt:row.updated_at})),nextCursor:rows.results.length>25?page.at(-1).cursor:null};
}

export async function createReturn(env,actor,orderId,raw){
  write(env,actor);
  if(!raw||typeof raw!=='object'||Array.isArray(raw))fail('Return details are required');
  if(!reasons.includes(raw.reason)||(!isMerchant(actor)&&raw.reason==='delivery_failed'))fail('Choose a return reason');
  if(!Array.isArray(raw.items)||!raw.items.length||raw.items.length>50)fail('Choose between 1 and 50 order items');
  const items=raw.items.map(item=>({orderItemId:itemId(item?.orderItemId),quantity:integer(item?.quantity,'Return quantity',1)})).sort((a,b)=>a.orderItemId.localeCompare(b.orderItemId));
  if(new Set(items.map(item=>item.orderItemId)).size!==items.length)fail('Choose each order item once');
  const input={requestKey:key(raw.requestKey),orderRevision:version(raw.orderRevision),reason:raw.reason,note:note(raw.note,'Return explanation'),items};
  const sellerId=await actorSeller(env,actor,orderId),hash=await commerceHash({...input,orderId,actor:{kind:actor.kind,id:actor.id}});
  const replay=async()=>{const row=await env.DB.prepare('SELECT id,request_hash FROM commerce_returns WHERE seller_id=? AND request_key=?').bind(sellerId,input.requestKey).first();
    if(!row)return null;if(row.request_hash!==hash)conflict('This request key was already used for another return');return returnDetail(env,actor,row.id,orderId);};
  const previous=await replay();if(previous)return previous;
  const overview=await returnOrder(env,actor,orderId);
  if(!overview.canCreate){const completed=await replay();if(completed)return completed;conflict(overview.reason);}
  if(overview.order.revision!==input.orderRevision){const completed=await replay();if(completed)return completed;conflict('The order changed. Reload before requesting a return.');}
  for(const item of items){const original=overview.items.find(row=>row.orderItemId===item.orderItemId);if(!original||item.quantity>original.availableToReturn)fail('A return quantity exceeds the remaining original units');}
  const id='ret_'+crypto.randomUUID().replaceAll('-',''),now=new Date().toISOString();
  try{await env.DB.batch([
    orderEvent(env,sellerId,orderId,input.orderRevision,'return_request:'+input.requestKey,'return.requested',{returnId:id,actor:actor.kind},hash,now),
    env.DB.prepare(`INSERT INTO commerce_returns(id,seller_id,order_id,request_key,request_hash,order_revision,reason,customer_note,actor_kind,actor_auth_user_id,created_at,updated_at)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`).bind(id,sellerId,orderId,input.requestKey,hash,input.orderRevision,input.reason,input.note,actor.kind,actor.id,now,now),
    env.DB.prepare(`INSERT INTO commerce_return_items(return_id,seller_id,order_item_id,quantity) SELECT ?,?,json_extract(value,'$.orderItemId'),json_extract(value,'$.quantity') FROM json_each(?)`).bind(id,sellerId,JSON.stringify(items)),
    advanceOrder(env,sellerId,orderId,input.orderRevision,now),
    commerceJobStatement(env,{sellerId,orderId,environment:currentCommerceEnvironment(env),kind:'notification.return_updated',key:'return_created:'+id,data:{orderId,returnId:id,state:'requested'}},now),
  ]);}catch(error){const completed=await replay();if(completed)return completed;databaseFailure(error);}
  return returnDetail(env,actor,id,orderId);
}

export async function returnAction(env,actor,returnId,raw,expectedOrderId=''){
  write(env,actor);caseId(returnId);
  if(!raw||typeof raw!=='object'||Array.isArray(raw))fail('Return action is required');
  if(!['approve','decline','withdraw','inspect','close'].includes(raw.kind)||(!isMerchant(actor)&&raw.kind!=='withdraw'))fail('This return action is not allowed',403);
  const input={requestKey:key(raw.requestKey),revision:version(raw.revision),orderRevision:version(raw.orderRevision),kind:raw.kind,
    message:note(raw.message||'',raw.kind==='approve'?'Return instructions':'Message for the customer',['approve','decline','close'].includes(raw.kind),2000),
    privateNote:raw.kind==='inspect'?note(raw.privateNote,'Inspection note'):'',confirmed:raw.kind==='inspect'?raw.confirmed===true:false,items:[]};
  if(input.kind==='inspect'){
    if(!input.confirmed)fail('Confirm the goods were physically received and inspected');
    if(!Array.isArray(raw.items)||!raw.items.length||raw.items.length>50)fail('Enter the units physically received');
    input.items=raw.items.map(item=>{const received=integer(item?.received,'Received quantity',1),restocked=integer(item?.restocked,'Restocked quantity',0,received);
      return {orderItemId:itemId(item?.orderItemId),received,restocked,productRevision:restocked?version(item.productRevision):null};}).sort((a,b)=>a.orderItemId.localeCompare(b.orderItemId));
    if(new Set(input.items.map(item=>item.orderItemId)).size!==input.items.length)fail('Inspect each order item once per receipt');
  }
  const detail=await returnDetail(env,actor,returnId,expectedOrderId),hash=await commerceHash({...input,returnId,actor:{kind:actor.kind,id:actor.id}});
  const replay=async()=>{const row=await env.DB.prepare('SELECT request_hash,receipt_json FROM commerce_return_actions WHERE return_id=? AND request_key=?').bind(returnId,input.requestKey).first();
    if(!row)return null;if(row.request_hash!==hash)conflict('This request key was already used for a different return action');return JSON.parse(row.receipt_json);};
  const previous=await replay();if(previous)return previous;
  if(detail.revision!==input.revision||detail.order.revision!==input.orderRevision)conflict('The return or order changed. Reload it before continuing.');
  if(!detail['can'+input.kind[0].toUpperCase()+input.kind.slice(1)])conflict('This action is no longer available for the return');
  const products=new Map(),lines=[];
  for(const item of input.items){const original=detail.items.find(row=>row.orderItemId===item.orderItemId);
    if(!original||item.received>original.remaining)fail('Received quantity exceeds the units remaining in this return');
    if(item.restocked){if(!original.current)conflict('The original option is no longer in the physical catalog. Keep those units out of stock until the catalog is resolved.');
      if(original.current.revision!==item.productRevision)conflict('Stock changed during inspection. Reload and review the current quantities.');
      if(original.current.onHand+item.restocked>1000000000)fail('Resulting stock is too large');products.set(original.productId,item.productRevision);}
    lines.push({...item,title:original.title,sku:original.sku,productId:original.productId,variantId:original.variantId,
      before:original.current?.onHand??null,after:original.current?original.current.onHand+item.restocked:null});
  }
  const states={approve:'approved',decline:'declined',withdraw:'withdrawn',close:'closed'};
  const target=input.kind==='inspect'?(detail.items.every(item=>item.received+(input.items.find(line=>line.orderItemId===item.orderItemId)?.received||0)===item.quantity)?'inspected':'receiving'):states[input.kind];
  const now=new Date().toISOString(),id='return_action_'+crypto.randomUUID().replaceAll('-',''),orderId=detail.order.id,sellerId=detail.sellerId;
  const receipt={id,returnId,orderId,kind:input.kind,state:target,createdAt:now,message:input.message,items:lines};
  const statements=[orderEvent(env,sellerId,orderId,input.orderRevision,'return_action:'+id,'return.'+input.kind,{returnId,actionId:id,actor:actor.kind},hash,now),
    env.DB.prepare(`INSERT INTO commerce_return_actions(id,seller_id,return_id,request_key,request_hash,previous_revision,order_revision,kind,target_state,actor_kind,actor_auth_user_id,public_message,private_note,receipt_json,created_at)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).bind(id,sellerId,returnId,input.requestKey,hash,input.revision,input.orderRevision,input.kind,target,actor.kind,actor.id,input.message,input.privateNote,JSON.stringify(receipt),now)];
  for(const [productId,productRevision] of products)statements.push(env.DB.prepare(`INSERT INTO seller_events(id,seller_id,actor_auth_user_id,event_type,entity_type,entity_id,payload_json,created_at)
    VALUES (?,?,?,'inventory.adjusted','product',?,?,?)`).bind('event_'+crypto.randomUUID(),sellerId,actor.id,productId,JSON.stringify({expectedRevision:productRevision,returnId,actionId:id}),now));
  if(lines.length)statements.push(env.DB.prepare(`INSERT INTO commerce_return_inspections(action_id,return_id,seller_id,order_item_id,received_quantity,restocked_quantity)
    SELECT ?,?,?,json_extract(value,'$.orderItemId'),json_extract(value,'$.received'),json_extract(value,'$.restocked') FROM json_each(?)`).bind(id,returnId,sellerId,JSON.stringify(lines)));
  statements.push(env.DB.prepare('UPDATE commerce_returns SET state=?,revision=revision+1,updated_at=? WHERE id=? AND seller_id=? AND revision=?').bind(target,now,returnId,sellerId,input.revision),
    advanceOrder(env,sellerId,orderId,input.orderRevision,now),
    commerceJobStatement(env,{sellerId,orderId,environment:currentCommerceEnvironment(env),kind:'notification.return_updated',key:'return_action:'+id,data:{orderId,returnId,actionId:id,state:target}},now));
  try{await env.DB.batch(statements);}catch(error){const completed=await replay();if(completed)return completed;databaseFailure(error);}
  return receipt;
}
