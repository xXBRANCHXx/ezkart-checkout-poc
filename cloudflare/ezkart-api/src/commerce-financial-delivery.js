import {commerceEnvironment} from './commerce-orders.js';

const fail=(message,status=422)=>{throw new Response(message,{status});};
function scope(env,input){
  commerceEnvironment(env,input.environment);
  if(typeof input.seller!=='string'||!/^[A-Za-z0-9][A-Za-z0-9_-]{2,95}$/.test(input.seller))fail('Financial store is invalid');
}
function orderId(value){if(typeof value!=='string'||!/^EZK-[SP]-[A-F0-9]{24}$/.test(value))fail('Financial order is invalid');}

// Backfill only existing original evidence. Never accept a delivery assertion.
export async function reconcileFinancialDeliveries(env,input){
  if(!input||typeof input!=='object'||Array.isArray(input)||Object.keys(input).some(k=>!['seller','environment','orderId','limit'].includes(k)))fail('Delivery reconciliation parameters are invalid');
  scope(env,input);if(input.orderId!==undefined)orderId(input.orderId);
  const size=input.limit??25;if(!Number.isInteger(size)||size<1||size>100)fail('Delivery reconciliation limit is invalid');
  const values=[input.seller,input.environment,input.orderId||'',input.orderId||''];
  const pending=`FROM commerce_order_delivery_accounting a WHERE a.seller_id=? AND a.commerce_environment=? AND (?='' OR a.order_id=?)
    AND NOT EXISTS(SELECT 1 FROM commerce_order_delivery_receipts r WHERE r.capture_id=a.capture_id)`;
  const results=await env.DB.batch([
    env.DB.prepare(`INSERT INTO commerce_order_delivery_receipts(id,seller_id,order_id,commerce_environment,capture_id,item_count,source_json,confirmed_at,recorded_at)
      SELECT 'delivery_'||a.capture_id,a.seller_id,a.order_id,a.commerce_environment,a.capture_id,a.item_count,a.source_json,a.confirmed_at,?
      ${pending} ORDER BY a.capture_id LIMIT ?`).bind(new Date().toISOString(),...values,size),
    env.DB.prepare('SELECT COUNT(*) AS remaining '+pending).bind(...values),
  ]);
  return {recorded:results[0].meta.changes,remainingEligible:results[1].results[0].remaining,
    caughtUp:results[1].results[0].remaining===0,earningsReleased:false};
}

export async function financialDeliveryStatus(env,url){
  const input={};for(const [key,value] of url.searchParams){if(!['seller','environment','orderId'].includes(key)||key in input)fail('Delivery parameters are invalid');input[key]=value;}
  scope(env,input);orderId(input.orderId);
  const row=await env.DB.prepare(`SELECT o.checkout_state,o.fulfillment_state,o.payment_review,o.fulfillment_review,
    c.id AS capture_id,j.allocation_state,r.id AS receipt_id,r.confirmed_at,r.recorded_at,r.source_json,
    (SELECT COUNT(*) FROM commerce_payment_captures x WHERE x.order_id=o.id AND x.capture_kind='duplicate_payment') AS additional_captures,
    (SELECT COUNT(*) FROM commerce_refunds x WHERE x.order_id=o.id AND x.state IN ('requested','approved')) AS pending_refunds,
    (SELECT COUNT(*) FROM commerce_returns x WHERE x.order_id=o.id AND x.state NOT IN ('declined','withdrawn')) AS unresolved_returns,
    (SELECT COUNT(*) FROM commerce_jobs x WHERE x.order_id=o.id AND (x.kind LIKE 'shipment.%' OR x.kind='payment.create')
      AND (x.state IN ('uncertain','dead') OR (x.kind='shipment.cancel' AND x.state IN ('queued','running','retry')))) AS unresolved_jobs
    FROM orders o LEFT JOIN commerce_payment_captures c ON c.order_id=o.id AND c.seller_id=o.seller_id
      AND c.commerce_environment=o.commerce_environment AND c.capture_kind='order_payment' AND c.amount=o.total_amount AND c.currency=o.currency
    LEFT JOIN commerce_financial_journals j ON j.capture_id=c.id AND j.kind='capture'
    LEFT JOIN commerce_order_delivery_receipts r ON r.capture_id=c.id
    WHERE o.id=? AND o.seller_id=? AND o.commerce_environment=? AND o.commerce_version=1`).bind(input.orderId,input.seller,input.environment).first();
  if(!row)fail('Financial order not found',404);
  const reasons=[];
  if(!row.capture_id)reasons.push('payment_unconfirmed');
  if(row.checkout_state!=='paid')reasons.push('payment_state_requires_review');
  if(row.payment_review||row.additional_captures)reasons.push('payment_review');
  if(row.fulfillment_review)reasons.push('fulfillment_review');
  if(row.fulfillment_state==='stock_review')reasons.push('stock_review');
  if(['return_in_transit','returned','disposed'].includes(row.fulfillment_state))reasons.push('courier_return');
  if(row.unresolved_jobs)reasons.push('provider_job_unresolved');
  if(row.pending_refunds)reasons.push('refund_requires_reconciliation');
  if(row.unresolved_returns)reasons.push('return_requires_reconciliation');
  if(row.capture_id&&row.allocation_state!=='allocated')reasons.push('capture_accounting_incomplete');
  if(!row.receipt_id)reasons.push('delivery_unconfirmed');
  // This immutable receipt preserves the evidence chosen at completion. Later
  // equivalent courier observations need not become the canonical source again.
  return {orderId:input.orderId,deliveryConfirmed:Boolean(row.receipt_id),
    receipt:row.receipt_id?{id:row.receipt_id,confirmedAt:row.confirmed_at,recordedAt:row.recorded_at,source:JSON.parse(row.source_json)}:null,
    holds:reasons,settlementVerified:false,releaseReady:false,availableToWithdraw:null};
}
