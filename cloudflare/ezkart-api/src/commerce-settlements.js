import {commerceEnvironment,commerceHash} from './commerce-orders.js';

const fail=(message,status=422)=>{throw new Response(message,{status});};
function scope(env,input){
  commerceEnvironment(env,input.environment);
  if(typeof input.seller!=='string'||!/^[A-Za-z0-9][A-Za-z0-9_-]{2,95}$/.test(input.seller)
    ||typeof input.orderId!=='string'||!/^EZK-[SP]-[A-F0-9]{24}$/.test(input.orderId))fail('Settlement order or store is invalid');
}
async function order(env,input){
  scope(env,input);
  const row=await env.DB.prepare(`SELECT o.id,c.id AS capture_id,
    (SELECT COUNT(*) FROM commerce_payment_captures x WHERE x.order_id=o.id AND x.capture_kind='duplicate_payment') AS additional_captures
    FROM orders o LEFT JOIN commerce_payment_captures c ON c.order_id=o.id AND c.seller_id=o.seller_id AND c.capture_kind='order_payment'
      AND c.commerce_environment=o.commerce_environment AND c.currency=o.currency AND c.amount=o.total_amount
    WHERE o.id=? AND o.seller_id=? AND o.commerce_environment=? AND o.commerce_version=1`).bind(input.orderId,input.seller,input.environment).first();
  if(!row)fail('Settlement order was not found',404);return row;
}
const assessmentSelect=`SELECT a.*,r.state,r.reason,r.provider_reference,r.fee_amount,r.seller_cash_amount,r.platform_cash_amount,r.provider_at,r.observed_at,r.source_json,
  f.current AS history_current,j.id AS journal_id,
  NOT EXISTS(SELECT 1 FROM commerce_settlement_assessments later WHERE later.capture_id=a.capture_id AND later.sequence>a.sequence) AS latest
  FROM commerce_settlement_assessments a JOIN commerce_settlement_results r ON r.assessment_sequence=a.sequence
  JOIN commerce_settlement_source_freshness f ON f.assessment_sequence=a.sequence
  LEFT JOIN commerce_financial_journals j ON j.id='financial_settlement_'||a.id`;
function assessment(row){return row?{id:row.id,sequence:row.sequence,state:row.state,reason:row.reason,providerReference:row.provider_reference,
  historyCurrent:!!row.history_current,latest:!!row.latest,feeAmount:String(row.fee_amount),sellerCashAmount:String(row.seller_cash_amount),platformCashAmount:String(row.platform_cash_amount),
  source:JSON.parse(row.source_json),providerAt:row.provider_at,observedAt:row.observed_at,recordedAt:row.recorded_at,journalId:row.journal_id}:null;}

export async function settlementForOrder(env,input){
  const context=await order(env,input);
  const row=context.capture_id?await env.DB.prepare(assessmentSelect+' WHERE a.capture_id=? ORDER BY a.sequence DESC LIMIT 1').bind(context.capture_id).first():null;
  const recognized=context.capture_id?await env.DB.prepare(`SELECT a.id,r.state,r.fee_amount,r.seller_cash_amount,r.platform_cash_amount FROM commerce_settlement_assessments a
    JOIN commerce_settlement_results r ON r.assessment_sequence=a.sequence AND r.state IN ('settled','voided')
    WHERE a.capture_id=? ORDER BY a.sequence DESC LIMIT 1`).bind(context.capture_id).first():null;
  const holds=[];
  if(!context.capture_id)holds.push('payment_unconfirmed');
  if(!row)holds.push('settlement_unobserved');
  else {
    if(row.state!=='settled')holds.push(row.reason);
    if(!row.history_current)holds.push('provider_history_changed');
  }
  if(context.additional_captures)holds.push('additional_payment_review');
  return {orderId:input.orderId,captureId:context.capture_id,assessment:assessment(row),holds,settlementVerified:holds.length===0,
    recognized:recognized?{assessmentId:recognized.id,state:recognized.state,feeAmount:String(recognized.fee_amount),sellerCashAmount:String(recognized.seller_cash_amount),platformCashAmount:String(recognized.platform_cash_amount)}:null,
    earningsReleased:false,availableToWithdraw:null};
}

export async function financialSettlementStatus(env,url){
  const input={};for(const [key,value] of url.searchParams){if(!['seller','environment','orderId'].includes(key)||key in input)fail('Settlement query is invalid');input[key]=value;}
  return settlementForOrder(env,input);
}

export async function reconcileProviderSettlement(env,input){
  if(!input||typeof input!=='object'||Array.isArray(input)||Object.keys(input).some(key=>!['seller','environment','orderId','sellerCollectionId','platformCollectionId'].includes(key)))fail('Settlement reconciliation parameters are invalid');
  const context=await order(env,input);
  for(const key of ['sellerCollectionId','platformCollectionId'])if(typeof input[key]!=='string'||!/^fcol_[a-f0-9]{40}$/.test(input[key]))fail('Settlement collection ID is invalid');
  if(!context.capture_id)fail('A verified primary payment is required before settlement',409);
  if(context.additional_captures)fail('Additional payments require provider attribution review',409);
  const hash=await commerceHash({version:1,captureId:context.capture_id,sellerCollectionId:input.sellerCollectionId,platformCollectionId:input.platformCollectionId}),id='stlm_'+hash.slice(0,40);
  const prior=await env.DB.prepare('SELECT id FROM commerce_settlement_assessments WHERE capture_id=? ORDER BY sequence DESC LIMIT 1').bind(context.capture_id).first();
  const collections=(await env.DB.prepare('SELECT id,sequence FROM commerce_provider_financial_collections WHERE id IN (?,?)').bind(input.sellerCollectionId,input.platformCollectionId).all()).results;
  const seller=collections.find(c=>c.id===input.sellerCollectionId),platform=collections.find(c=>c.id===input.platformCollectionId);
  if(!seller||!platform||seller.sequence===platform.sequence)fail('Both original account collections are required',409);
  let saved;
  try{saved=await env.DB.prepare(`INSERT INTO commerce_settlement_assessments
    (id,version,seller_id,order_id,capture_id,commerce_environment,seller_collection_sequence,platform_collection_sequence,previous_id,recorded_at)
    SELECT ?,1,?,?,?,?,?,?,?,? WHERE NOT EXISTS(SELECT 1 FROM commerce_settlement_assessments WHERE id=?)`)
    .bind(id,input.seller,input.orderId,context.capture_id,input.environment,seller.sequence,platform.sequence,prior?.id||null,new Date().toISOString(),id).run();}
  catch(error){
    if(/\bsettlement_(original_routing_required|additional_payment_review|complete_window_required|history_superseded|concurrent_assessment|group_identity_conflict)\b/.test(String(error)))fail('Settlement evidence is incomplete, superseded or conflicts with the original payment. Reconcile the original provider records.',409);
    throw error;
  }
  const recorded=await env.DB.prepare(assessmentSelect+' WHERE a.id=?').bind(id).first();
  if(!recorded)fail('Settlement assessment was not saved',500);
  return {recorded:assessment(recorded),replayed:saved.meta.changes===0,...await settlementForOrder(env,input)};
}
