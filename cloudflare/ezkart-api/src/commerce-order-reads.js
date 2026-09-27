import {commerceHash,commerceStorageEnabled,commerceEnvironment} from './commerce-orders.js';

const fail=(message,status=422)=>{throw new Response(message,{status});};
const parse=value=>JSON.parse(value||'{}');
const orderPattern=/^EZK-[SP]-[A-F0-9]{24}$/;
const states=['creating','pending','paid','failed','expired','cancelled','partially_refunded','refunded'];
const queues=['needs-processing','processing','shipped','delivered','attention','not-required'];
const environment=env=>commerceEnvironment(env,env.APP_ENVIRONMENT==='test'?'sandbox':'production');
const maximumPage=50;

// A queue is an operational state, independent of reporting dates. Unknown
// provider outcomes and stock/payment conflicts always take priority.
const queueSql=`CASE
 WHEN o.payment_review=1 OR o.fulfillment_review=1 OR o.fulfillment_state IN ('stock_review','on_hold','rejected','courier_not_found','return_in_transit','returned','disposed','cancelled')
   OR EXISTS(SELECT 1 FROM commerce_jobs j WHERE j.seller_id=o.seller_id AND j.order_id=o.id AND j.state IN ('uncertain','dead')
     AND ((j.kind='payment.create' AND o.checkout_state IN ('creating','pending')) OR (j.kind IN ('shipment.create','shipment.cancel','shipment.refresh')
       AND json_extract(j.payload_json,'$.shipmentId')=(SELECT s.id FROM commerce_shipments s WHERE s.seller_id=o.seller_id AND s.order_id=o.id ORDER BY s.sequence DESC LIMIT 1)))) THEN 'attention'
 WHEN o.checkout_state NOT IN ('paid','partially_refunded') THEN ''
 WHEN json_extract(o.snapshot_json,'$.shipping.skipped')=1 OR json_extract(o.snapshot_json,'$.shipping.kind')='none' THEN 'not-required'
 WHEN o.fulfillment_state='delivered' THEN 'delivered'
 WHEN o.fulfillment_state IN ('picked','in_transit','dropping_off') THEN 'shipped'
 WHEN o.fulfillment_state IN ('awaiting_pickup_arrangement','pickup_requested','confirmed','scheduled','allocated','picking_up') THEN 'processing'
 ELSE 'needs-processing' END`;
const confirmedSql=`COALESCE((SELECT SUM(c.amount) FROM commerce_payment_captures c WHERE c.seller_id=o.seller_id AND c.order_id=o.id AND c.capture_kind='order_payment'),0)`;
const additionalSql=`COALESCE((SELECT SUM(c.amount) FROM commerce_payment_captures c WHERE c.seller_id=o.seller_id AND c.order_id=o.id AND c.capture_kind='duplicate_payment'),0)`;
const scopeSql='o.seller_id=? AND o.commerce_environment=? AND o.commerce_version=1';

// Reporting uses the same authenticated scope, capture policy and operational
// queues as the order manager, so the two views cannot reinterpret an order.
export {queueSql,confirmedSql,additionalSql,scopeSql,environment as commerceReadEnvironment};
export {parameters as readParameters,localDate as readDate,validateCursor as readCursor,cursor as makeReadCursor};

function parameters(url,allowed){
  for(const name of url.searchParams.keys())if(!allowed.includes(name)||url.searchParams.getAll(name).length!==1)fail('Order filters are invalid');
  const limit=Number(url.searchParams.get('limit')||25);
  if(!Number.isInteger(limit)||limit<1||limit>maximumPage)fail('Choose a page size between 1 and 50');
  return limit;
}
function localDate(value,end=false){
  if(!/^\d{4}-\d\d-\d\d$/.test(value)||value<'1970-01-01'||value>'9998-12-31')fail('Order date is invalid');
  const utc=Date.parse(value+'T00:00:00.000Z');
  if(!Number.isFinite(utc)||new Date(utc).toISOString().slice(0,10)!==value)fail('Order date is invalid');
  return new Date(utc-7*3600000+(end?86400000:0)).toISOString();
}
const encode=value=>btoa(JSON.stringify(value)).replaceAll('+','-').replaceAll('/','_').replace(/=+$/,'');
function decode(value){
  if(!/^[A-Za-z0-9_-]{1,1000}$/.test(value))fail('Order cursor is invalid');
  try{return JSON.parse(atob(value.replaceAll('-','+').replaceAll('_','/')));}catch{fail('Order cursor is invalid');}
}
function validateCursor(value,sellerId,kind,hash){
  const c=decode(value);
  if(!c||c.v!==1||c.s!==sellerId||c.t!==kind||c.h!==hash||!['before','after'].includes(c.d)||!Number.isSafeInteger(c.cap)||c.cap<0
    ||!/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(c.at||'')||!Number.isFinite(Date.parse(c.at))
    ||typeof c.id!=='string'||c.id.length>100)fail('This cursor does not match the selected orders');
  return c;
}
const cursor=(sellerId,kind,hash,cap,row,direction='before')=>encode({v:1,s:sellerId,t:kind,h:hash,cap,at:row.created_at,id:row.id,d:direction});

function orderSummary(row){
  const customer=parse(row.customer_snapshot_json),snapshot=parse(row.snapshot_json);
  return {id:row.id,revision:row.revision,state:row.checkout_state,fulfillmentState:row.fulfillment_state,
    queue:row.queue,review:row.queue==='attention',customerName:customer.name||'',customerEmail:customer.email||'',
    subtotal:row.subtotal_amount,shippingAmount:row.shipping_amount,total:row.total_amount,currency:row.currency,
    shippingSkipped:snapshot.shipping?.skipped===true,shippingKind:snapshot.shipping?.kind||'carrier',confirmedAmount:row.confirmed_amount_text??row.confirmed_amount,additionalAmount:row.additional_amount_text??row.additional_amount,
    itemCount:row.item_count,unitCount:row.unit_count,firstItem:row.first_item||'',createdAt:row.created_at,paidAt:row.paid_at};
}

export async function merchantOrderList(env,seller,url){
  const limit=parameters(url,['limit','cursor','state','queue','q','from','to','order']);
  const state=url.searchParams.get('state')||'all',queue=url.searchParams.get('queue')||'all',q=(url.searchParams.get('q')||'').trim(),order=url.searchParams.get('order')||'';
  const from=url.searchParams.get('from')||'',to=url.searchParams.get('to')||'',mode=environment(env);
  if(!['all',...states].includes(state)||!['all',...queues].includes(queue)||q.length>120||/[\u0000-\u001f]/.test(q)
    ||(order&&!orderPattern.test(order)))fail('Order filters are invalid');
  const start=from?localDate(from):'',end=to?localDate(to,true):'';
  if(start&&end&&start>=end)fail('The start date must not be after the end date');
  const hash=await commerceHash({mode,state,queue,q,from,to,order}),encoded=url.searchParams.get('cursor');
  const previous=encoded?validateCursor(encoded,seller.id,'orders',hash):null;
  const backwards=previous?.d==='after',comparison=backwards?'>':'<',direction=backwards?'ASC':'DESC';
  if(previous&&!orderPattern.test(previous.id))fail('Order cursor is invalid');
  // An insertion watermark excludes orders created after the first page even
  // if their timestamps tie. Existing orders retain their current live state.
  const cap=previous?.cap??(await env.DB.prepare(`SELECT COALESCE(MAX(o.rowid),0) AS cap FROM orders o WHERE ${scopeSql}`).bind(seller.id,mode).first()).cap;
  const scoped=`WITH scoped AS (SELECT o.*,${queueSql} AS queue,${confirmedSql} AS confirmed_amount,${additionalSql} AS additional_amount
    FROM orders o WHERE ${scopeSql} AND o.rowid<=?)`;
  const clauses=[],values=[];
  if(state!=='all'){clauses.push('o.checkout_state=?');values.push(state);}
  if(queue!=='all'){clauses.push('o.queue=?');values.push(queue);}
  if(start){clauses.push('o.created_at>=?');values.push(start);}
  if(end){clauses.push('o.created_at<?');values.push(end);}
  if(order){clauses.push('o.id=?');values.push(order);}
  if(q){clauses.push(`(instr(lower(o.id),lower(?))>0 OR instr(lower(json_extract(o.customer_snapshot_json,'$.name')),lower(?))>0
    OR instr(lower(json_extract(o.customer_snapshot_json,'$.email')),lower(?))>0 OR instr(json_extract(o.customer_snapshot_json,'$.phone'),?)>0
    OR EXISTS(SELECT 1 FROM order_items i WHERE i.seller_id=o.seller_id AND i.order_id=o.id AND
      (instr(lower(i.title),lower(?))>0 OR instr(lower(i.sku),lower(?))>0 OR instr(lower(json_extract(i.fulfillment_snapshot_json,'$.variantName')),lower(?))>0)))`);values.push(...Array(7).fill(q));}
  const where=clauses.length?clauses.join(' AND '):'1';
  const result=await env.DB.batch([
    env.DB.prepare(`${scoped} SELECT COUNT(*) AS total,COALESCE(SUM(confirmed_amount>0),0) AS paid,
      CAST(COALESCE(SUM(confirmed_amount),0) AS TEXT) AS confirmedAmount,CAST(COALESCE(SUM(additional_amount),0) AS TEXT) AS additionalAmount,
      COALESCE(SUM(checkout_state IN ('creating','pending')),0) AS awaitingPayment,COALESCE(SUM(queue='attention'),0) AS needsReview FROM scoped`).bind(seller.id,mode,cap),
    env.DB.prepare(`${scoped} SELECT queue,COUNT(*) AS count FROM scoped GROUP BY queue`).bind(seller.id,mode,cap),
    env.DB.prepare(`${scoped} SELECT COUNT(*) AS total FROM scoped o WHERE ${where}`).bind(seller.id,mode,cap,...values),
    env.DB.prepare(`${scoped} SELECT o.*,CAST(o.confirmed_amount AS TEXT) AS confirmed_amount_text,CAST(o.additional_amount AS TEXT) AS additional_amount_text,
      (SELECT COUNT(*) FROM order_items i WHERE i.seller_id=o.seller_id AND i.order_id=o.id) AS item_count,
      (SELECT SUM(i.quantity) FROM order_items i WHERE i.seller_id=o.seller_id AND i.order_id=o.id) AS unit_count,
      (SELECT i.title FROM order_items i WHERE i.seller_id=o.seller_id AND i.order_id=o.id ORDER BY i.id LIMIT 1) AS first_item
      FROM scoped o WHERE ${where} ${previous?`AND (o.created_at${comparison}? OR (o.created_at=? AND o.id${comparison}?))`:''}
      ORDER BY o.created_at ${direction},o.id ${direction} LIMIT ?`).bind(seller.id,mode,cap,...values,...(previous?[previous.at,previous.at,previous.id]:[]),limit+1),
    env.DB.prepare(`${scoped} SELECT EXISTS(SELECT 1 FROM scoped o WHERE ${where}
      ${previous?`AND (o.created_at${backwards?'<':'>'}? OR (o.created_at=? AND o.id${backwards?'<=':'>='}?))`:'AND 0'}) AS opposite`)
      .bind(seller.id,mode,cap,...values,...(previous?[previous.at,previous.at,previous.id]:[])),
  ]);
  const raw=result[3].results,rows=raw.slice(0,limit);if(backwards)rows.reverse();
  const hasBefore=backwards?raw.length>limit:result[4].results[0].opposite===1;
  const hasAfter=backwards?result[4].results[0].opposite===1:raw.length>limit;
  return {sellerId:seller.id,environment:mode,enabled:commerceStorageEnabled(env),summary:result[0].results[0],
    queues:Object.fromEntries(queues.map(k=>[k,result[1].results.find(r=>r.queue===k)?.count||0])),matching:result[2].results[0].total,
    items:rows.map(orderSummary),pageCursor:encoded||cursor(seller.id,'orders',hash,cap,{created_at:'9999-12-31T23:59:59.999Z',id:'EZK-S-'+'F'.repeat(24)}),
    previousCursor:rows.length&&hasBefore?cursor(seller.id,'orders',hash,cap,rows[0],'after'):null,
    nextCursor:rows.length&&hasAfter?cursor(seller.id,'orders',hash,cap,rows.at(-1)):null};
}

const detailScope=(env,seller,id)=>{
  if(!orderPattern.test(id))fail('Order not found',404);
  return [id,seller.id,environment(env)];
};
const detailWhere='id=? AND seller_id=? AND commerce_environment=? AND commerce_version=1';
const capturesSql=`SELECT id,provider,provider_reference AS reference,amount,currency,capture_kind AS kind,verified_at AS created_at,
  (SELECT MAX(x.rowid) FROM commerce_payment_captures x WHERE x.seller_id=c.seller_id AND x.order_id=c.order_id) AS cap
  FROM commerce_payment_captures c WHERE seller_id=? AND order_id=?`;
const eventsSql=`SELECT id,event_type AS type,previous_revision+1 AS revision,created_at,
  (SELECT MAX(x.rowid) FROM commerce_order_events x WHERE x.seller_id=c.seller_id AND x.order_id=c.order_id) AS cap
  FROM commerce_order_events c WHERE seller_id=? AND order_id=?`;
const entryView=row=>{const {created_at,cap,...entry}=row;return {...entry,createdAt:created_at};};
const address=value=>Object.fromEntries(['name','phone','email','organization','address','location','postalCode','note','coordinate'].filter(k=>value?.[k]!==undefined).map(k=>[k,value[k]]));
export async function merchantOrderDetail(env,seller,id){
  const scope=detailScope(env,seller,id);
  const results=await env.DB.batch([
    env.DB.prepare(`SELECT o.*,${queueSql} AS queue,CAST((${confirmedSql}) AS TEXT) AS confirmed_amount,CAST((${additionalSql}) AS TEXT) AS additional_amount FROM orders o WHERE o.${detailWhere}`).bind(...scope),
    env.DB.prepare('SELECT id,product_id,title,sku,quantity,unit_price_amount,fulfillment_snapshot_json FROM order_items WHERE seller_id=? AND order_id=? ORDER BY id LIMIT 201').bind(seller.id,id),
    env.DB.prepare(`${capturesSql} ORDER BY created_at DESC,id DESC LIMIT 21`).bind(seller.id,id),
    env.DB.prepare(`${eventsSql} ORDER BY created_at DESC,id DESC LIMIT 21`).bind(seller.id,id),
    env.DB.prepare("SELECT state,COUNT(*) AS lines,SUM(quantity) AS quantity FROM inventory_reservations WHERE seller_id=? AND order_id=? GROUP BY state").bind(seller.id,id),
    env.DB.prepare("SELECT kind,state,COUNT(*) AS count FROM commerce_jobs WHERE seller_id=? AND order_id=? AND state IN ('queued','running','retry','uncertain','dead') GROUP BY kind,state").bind(seller.id,id),
  ]);
  const row=results[0].results[0];if(!row)fail('Order not found',404);
  if(results[1].results.length>200)fail('This order needs an expanded item view. Contact support.',503);
  const customer=parse(row.customer_snapshot_json),shipping=parse(row.snapshot_json).shipping||{};
  const items=results[1].results.map(i=>{const f=parse(i.fulfillment_snapshot_json);return {id:i.id,productId:i.product_id,title:i.title,sku:i.sku,
    quantity:i.quantity,price:i.unit_price_amount,variantName:f.variantName||'',weightGrams:f.weightGrams||null};});
  const snapshot={customer:{name:customer.name||'',email:customer.email||'',phone:customer.phone||''},
    destination:address(shipping.destination),origin:address({name:shipping.origin?.origin_contact_name,phone:shipping.origin?.origin_contact_phone,
      email:shipping.origin?.origin_contact_email,address:shipping.origin?.origin_address,postalCode:shipping.origin?.origin_postal_code,note:shipping.origin?.origin_note,coordinate:shipping.origin?.coordinate}),returnAddress:shipping.returnAddress?address(shipping.returnAddress):null,
    courier:shipping.quote?.courier||shipping.courierCode||'',service:shipping.quote?.service||shipping.serviceCode||''};
  const history=async(kind,rows)=>({items:rows.slice(0,20).map(entryView),nextCursor:rows.length>20?cursor(seller.id,kind,await commerceHash(id),rows[0].cap,rows[19]):null});
  return {sellerId:seller.id,environment:row.commerce_environment,enabled:commerceStorageEnabled(env),
    order:{...orderSummary({...row,item_count:items.length,unit_count:items.reduce((n,i)=>n+i.quantity,0),first_item:items[0]?.title}),
      snapshot,items,expiresAt:row.expires_at,updatedAt:row.updated_at,acceptedAt:row.accepted_at,paymentReview:row.payment_review===1,fulfillmentReview:row.fulfillment_review===1},
    inventory:results[4].results,operations:results[5].results,
    captures:await history('captures',results[2].results),activity:await history('activity',results[3].results)};
}

export async function merchantOrderHistory(env,seller,id,kind,url){
  const limit=parameters(url,['limit','cursor']);
  const scope=detailScope(env,seller,id);
  if(!['captures','activity'].includes(kind))fail('Order history not found',404);
  if(!await env.DB.prepare(`SELECT id FROM orders WHERE ${detailWhere}`).bind(...scope).first())fail('Order not found',404);
  const hash=await commerceHash(id),encoded=url.searchParams.get('cursor'),before=encoded?validateCursor(encoded,seller.id,kind,hash):null;
  if(before&&before.d!=='before')fail('History cursor is invalid');
  const sql=kind==='captures'?capturesSql:eventsSql;
  const time=kind==='captures'?'verified_at':'created_at';
  const result=await env.DB.prepare(`${sql} ${before?`AND c.rowid<=? AND (${time}<? OR (${time}=? AND id<?))`:''} ORDER BY created_at DESC,id DESC LIMIT ?`)
    .bind(seller.id,id,...(before?[before.cap,before.at,before.at,before.id]:[]),limit+1).all();
  return {items:result.results.slice(0,limit).map(entryView),nextCursor:result.results.length>limit?cursor(seller.id,kind,hash,before?.cap??result.results[0].cap,result.results[limit-1]):null};
}
