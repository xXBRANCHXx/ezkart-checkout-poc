import {commerceEnvironment, commerceHash, commerceOrder, commerceJobStatement, commerceStorageEnabled} from './commerce-orders.js';
import {inventorySql} from './inventory.js';

const fail = (message, status = 422, code = '') => {throw new Response(message, {status, headers: code ? {'x-ezkart-error-code':code} : {}});};
const environment = env => commerceEnvironment(env, env.APP_ENVIRONMENT === 'test' ? 'sandbox' : 'production');
const conflict = message => fail(message, 409, 'stock_review_conflict');
const revision = value => {if(!Number.isSafeInteger(value)||value<1)fail('The stock review version is invalid');return value;};

export async function stockReviewList(env, seller, url) {
  const limit=Number(url.searchParams.get('limit')||20),cursor=url.searchParams.get('cursor')||'';
  if(!Number.isInteger(limit)||limit<1||limit>50||cursor.length>150||/[\u0000-\u001f]/.test(cursor))fail('The stock review page is invalid');
  const rows=await env.DB.prepare(`SELECT o.id,o.revision,o.created_at,o.paid_at,o.payment_review,
    json_extract(o.customer_snapshot_json,'$.name') AS customer_name,
    (SELECT SUM(i.quantity) FROM order_items i WHERE i.order_id=o.id AND i.product_type='physical') AS quantity,
    o.created_at || '~' || o.id AS cursor
    FROM orders o WHERE o.seller_id=? AND o.commerce_environment=? AND o.commerce_version=1
      AND o.checkout_state='paid' AND o.fulfillment_state='stock_review'
      AND (?='' OR o.created_at || '~' || o.id<?)
    ORDER BY o.created_at DESC,o.id DESC LIMIT ?`).bind(seller.id,environment(env),cursor,cursor,limit+1).all();
  const page=rows.results.slice(0,limit);
  return {items:page.map(row=>({id:row.id,revision:row.revision,createdAt:row.created_at,paidAt:row.paid_at,
    customerName:row.customer_name||'',quantity:row.quantity,paymentReview:Boolean(row.payment_review)})),
    nextCursor:rows.results.length>limit?page.at(-1).cursor:null};
}

export async function stockReviewDetails(env, seller, orderId) {
  const order=await commerceOrder(env,seller.id,orderId,environment(env));
  const physical=order.items.filter(item=>item.productType==='physical');
  const keys=physical.map(item=>item.productId+'~'+(item.fulfillment.variantId||''));
  const results=await env.DB.batch([
    env.DB.prepare(`${inventorySql} SELECT * FROM inventory WHERE row_key IN (SELECT value FROM json_each(?))`)
      .bind(seller.id,seller.id,seller.id,seller.id,JSON.stringify(keys)),
    env.DB.prepare('SELECT receipt_json FROM commerce_stock_resolutions WHERE seller_id=? AND order_id=?').bind(seller.id,orderId),
    env.DB.prepare("SELECT COUNT(*) AS n FROM commerce_payment_captures WHERE seller_id=? AND order_id=? AND capture_kind='order_payment'").bind(seller.id,orderId),
  ]);
  const stock=new Map(results[0].results.map(row=>[row.row_key,row]));
  const items=physical.map(item=>{
    const current=stock.get(item.productId+'~'+(item.fulfillment.variantId||''));
    return {orderItemId:item.id,productId:item.productId,variantId:item.fulfillment.variantId||'',
      title:item.title+(item.fulfillment.variantName?' — '+item.fulfillment.variantName:''),sku:item.sku,quantity:item.quantity,
      current:current?{title:current.title,sku:current.sku,revision:current.revision,onHand:current.on_hand,
        reserved:current.reserved,available:current.available,hidden:Boolean(current.hidden),status:current.status}:null};
  });
  const receipt=results[1].results[0]?JSON.parse(results[1].results[0].receipt_json):null;
  const reason=receipt?'Stock has already been allocated for this order.':order.state!=='paid'||order.fulfillmentState!=='stock_review'?'This order no longer needs a stock review.':
    order.paymentReview||!results[2].results[0].n?'Resolve the payment review before allocating stock.':
    !commerceStorageEnabled(env)?'Order stock recovery is not available yet.':
    seller.role==='viewer'?'Your account cannot allocate stock.':
    items.some(item=>!item.current)?'An original product option is no longer in the physical catalog. Restore that same option before continuing.':
    items.some(item=>item.current.available<item.quantity)?'There is not enough available stock for every item. Receive stock or arrange a refund before continuing.':'';
  return {order:{id:order.id,revision:order.revision,customerName:order.customer.name,paidAt:order.paidAt,
    state:order.state,fulfillmentState:order.fulfillmentState,paymentReview:order.paymentReview},items,receipt,canResolve:!reason,reason};
}

export async function resolveStockReview(env, seller, authUserId, orderId, raw) {
  if(seller.role==='viewer')fail('Your account cannot allocate stock',403);
  if(!commerceStorageEnabled(env))fail('Order stock recovery is not available yet',503);
  if(!raw||typeof raw!=='object'||Array.isArray(raw))fail('A stock review is required');
  if(typeof raw.requestKey!=='string'||!/^[A-Za-z0-9_-]{16,100}$/.test(raw.requestKey))fail('The stock review request key is invalid');
  if(raw.confirmed!==true)fail('Confirm that every item was checked before allocating stock');
  if(typeof raw.note!=='string'||raw.note.trim().length<3||raw.note.length>500||/[\u0000-\u0008\u000b-\u001f]/.test(raw.note.replaceAll('\r\n','\n')))fail('Explain the stock review in a note of 3 to 500 characters');
  if(!Array.isArray(raw.items)||!raw.items.length||raw.items.length>50)fail('Review every original order item');
  const items=raw.items.map(item=>{
    if(!item||typeof item.orderItemId!=='string'||!/^item_[A-Za-z0-9-]{3,90}$/.test(item.orderItemId))fail('The reviewed order item is invalid');
    return {orderItemId:item.orderItemId,productRevision:revision(item.productRevision)};
  }).sort((a,b)=>a.orderItemId.localeCompare(b.orderItemId));
  if(new Set(items.map(item=>item.orderItemId)).size!==items.length)fail('Each order item must be reviewed once');
  const input={requestKey:raw.requestKey,revision:revision(raw.revision),note:raw.note.replaceAll('\r\n','\n').trim(),confirmed:true,items};
  const hash=await commerceHash({...input,orderId,authUserId});
  const replay=async()=>{
    const row=await env.DB.prepare('SELECT request_hash,receipt_json FROM commerce_stock_resolutions WHERE seller_id=? AND request_key=?').bind(seller.id,input.requestKey).first();
    if(!row)return null;if(row.request_hash!==hash)conflict('This request key was already used for a different stock review');return JSON.parse(row.receipt_json);
  };
  const previous=await replay();if(previous)return previous;
  const review=await stockReviewDetails(env,seller,orderId);
  if(!review.canResolve){const completed=await replay();if(completed)return completed;conflict(review.reason);}
  if(review.order.revision!==input.revision)conflict('The order changed. Reload the review and check it again.');
  const selected=new Map(items.map(item=>[item.orderItemId,item]));
  if(items.length!==review.items.length||review.items.some(item=>!selected.has(item.orderItemId)))fail('Review every original order item');
  const products=new Map();
  for(const item of review.items){
    if(selected.get(item.orderItemId).productRevision!==item.current.revision)conflict('Product details or stock changed. Reload the review and check every item again.');
    products.set(item.productId,item.current.revision);
  }
  const now=new Date().toISOString(),id='stock_'+crypto.randomUUID().replaceAll('-','');
  const order=await commerceOrder(env,seller.id,orderId,environment(env));
  const fulfillment=order.snapshot.shipping.skipped?'not_required':'awaiting_acceptance';
  const receipt={id,orderId,createdAt:now,note:input.note,fulfillmentState:fulfillment,
    items:review.items.map(item=>({orderItemId:item.orderItemId,productId:item.productId,variantId:item.variantId,
      title:item.title,sku:item.sku,quantity:item.quantity,before:item.current.onHand,after:item.current.onHand-item.quantity}))};
  const statements=[
    env.DB.prepare(`INSERT INTO commerce_order_events(id,seller_id,order_id,event_key,event_type,payload_hash,previous_revision,data_json,created_at)
      VALUES (?,?,?,?,'inventory.stock_recovered',?,?,?,?)`).bind('event_'+crypto.randomUUID(),seller.id,orderId,'stock_recovery:'+input.requestKey,hash,input.revision,JSON.stringify({resolutionId:id,actor:authUserId,note:input.note}),now),
    env.DB.prepare(`INSERT INTO commerce_stock_resolutions(id,seller_id,order_id,request_key,request_hash,order_revision,actor_auth_user_id,note,receipt_json,created_at)
      VALUES (?,?,?,?,?,?,?,?,?,?)`).bind(id,seller.id,orderId,input.requestKey,hash,input.revision,authUserId,input.note,JSON.stringify(receipt),now),
  ];
  // Assert all product versions first: each allocation then advances its parent.
  for(const [productId,productRevision] of products)statements.push(env.DB.prepare(`INSERT INTO seller_events(id,seller_id,actor_auth_user_id,event_type,entity_type,entity_id,payload_json,created_at)
    VALUES (?,?,?,'inventory.adjusted','product',?,?,?)`).bind('event_'+crypto.randomUUID(),seller.id,authUserId,productId,JSON.stringify({expectedRevision:productRevision,stockResolutionId:id,orderId}),now));
  statements.push(env.DB.prepare(`INSERT INTO commerce_stock_allocations(resolution_id,seller_id,order_item_id,product_id,variant_id,quantity)
    SELECT ?,?,json_extract(value,'$.orderItemId'),json_extract(value,'$.productId'),json_extract(value,'$.variantId'),json_extract(value,'$.quantity') FROM json_each(?)`).bind(id,seller.id,JSON.stringify(receipt.items)),
    env.DB.prepare('UPDATE orders SET fulfillment_state=?,revision=revision+1,updated_at=? WHERE seller_id=? AND id=? AND revision=?').bind(fulfillment,now,seller.id,orderId,input.revision),
    commerceJobStatement(env,{sellerId:seller.id,orderId,environment:environment(env),kind:'notification.stock_recovered',key:'stock_recovery:'+orderId,data:{orderId,resolutionId:id}},now));
  try{await env.DB.batch(statements);}catch(error){
    const completed=await replay();if(completed)return completed;
    const message=`${error?.message||''} ${error?.cause?.message||''}`;
    if(/commerce_insufficient_stock|commerce_reserved_stock/.test(message))conflict('Available stock changed. Reload the review. No items were allocated.');
    if(/commerce_revision_conflict|catalog_revision_conflict|stock_review_changed|stock_review_product_changed|UNIQUE constraint failed/.test(message))conflict('The order or its stock changed. Reload the review before continuing.');
    throw error;
  }
  return receipt;
}
