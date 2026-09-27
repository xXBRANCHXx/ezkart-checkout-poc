import {commerceEnvironment,commerceStorageEnabled} from './commerce-orders.js';

const fail=(message,status=422)=>{throw new Response(message,{status});};
const sellerId=/^[A-Za-z0-9][A-Za-z0-9_-]{2,95}$/;
const orderId=/^EZK-[SP]-[A-F0-9]{24}$/;
function scope(env,input,{optionalSeller=false}={}){
  commerceEnvironment(env,input.environment);
  if(!(optionalSeller&&input.seller===undefined)&&(typeof input.seller!=='string'||!sellerId.test(input.seller)))fail('Earnings store is invalid');
  if(input.orderId!==undefined&&(typeof input.orderId!=='string'||!orderId.test(input.orderId)))fail('Earnings order is invalid');
  if(input.orderId!==undefined&&input.seller===undefined)fail('An order requires its original store');
}
function query(url,allowed){const input={};for(const [key,value] of url.searchParams){if(!allowed.includes(key)||key in input)fail('Earnings query is invalid');input[key]=value;}return input;}

export async function reconcileEarnings(env,input){
  if(!input||typeof input!=='object'||Array.isArray(input)||Object.keys(input).some(k=>!['seller','environment','orderId','limit'].includes(k)))fail('Earnings reconciliation parameters are invalid');
  scope(env,input,{optionalSeller:true});
  const size=input.limit??25;if(!Number.isInteger(size)||size<1||size>100)fail('Earnings batch size is invalid');
  const values=[input.environment,input.seller||'',input.seller||'',input.orderId||'',input.orderId||''];
  const filter="commerce_environment=? AND (?='' OR seller_id=?) AND (?='' OR order_id=?)";
  const result=await env.DB.batch([
    env.DB.prepare('SELECT COUNT(*) AS n FROM commerce_earnings_assessments WHERE '+filter).bind(...values),
    env.DB.prepare(`INSERT INTO commerce_earnings_assessments(id,version,seller_id,order_id,capture_id,commerce_environment,previous_id,state,net_amount,available_amount,reserved_amount,source_json,recorded_at)
      SELECT 'earn_'||lower(hex(randomblob(20))),1,seller_id,order_id,capture_id,commerce_environment,assessment_id,state,net_amount,available_amount,reserved_amount,source_json,strftime('%Y-%m-%dT%H:%M:%fZ','now')
      FROM commerce_earnings_positions WHERE reconciled=0 AND ${filter} ORDER BY COALESCE(assessment_sequence,0),capture_id LIMIT ?`).bind(...values,size),
    env.DB.prepare('SELECT COUNT(*) AS n FROM commerce_earnings_positions WHERE reconciled=0 AND '+filter).bind(...values),
    env.DB.prepare('SELECT COUNT(*) AS n FROM commerce_earnings_assessments WHERE '+filter).bind(...values),
  ]);
  return {recorded:result[3].results[0].n-result[0].results[0].n,remaining:result[2].results[0].n,caughtUp:result[2].results[0].n===0,providerCalls:0};
}

export async function earningsHousekeeping(env){
  if(!commerceStorageEnabled(env)||!['test','beta'].includes(env.APP_ENVIRONMENT))return {skipped:true};
  return reconcileEarnings(env,{environment:env.APP_ENVIRONMENT==='test'?'sandbox':'production',limit:25});
}

export async function earningsForOrder(env,input){
  scope(env,input);if(input.orderId===undefined)fail('An earnings order is required');
  const original=await env.DB.prepare(`SELECT o.id,c.id AS capture_id FROM orders o LEFT JOIN commerce_payment_captures c
    ON c.order_id=o.id AND c.capture_kind='order_payment' WHERE o.id=? AND o.seller_id=? AND o.commerce_environment=? AND o.commerce_version=1`)
    .bind(input.orderId,input.seller,input.environment).first();
  if(!original)fail('Earnings order was not found',404);
  const p=original.capture_id?await env.DB.prepare('SELECT * FROM commerce_earnings_positions WHERE capture_id=?').bind(original.capture_id).first():null;
  if(!p)return {orderId:input.orderId,state:'unavailable',holds:[original.capture_id?'capture_accounting_incomplete':'payment_unconfirmed'],
    assessmentId:null,reconciled:false,netAmount:null,availableEarnings:'0',reservedEarnings:'0',pendingEarnings:null,withdrawalsEnabled:false,availableToWithdraw:null};
  const holds=JSON.parse(p.holds_json);if(!p.reconciled)holds.push('earnings_reconciliation_required');
  return {orderId:input.orderId,state:p.state,holds,assessmentId:p.assessment_id,reconciled:!!p.reconciled,netAmount:String(p.net_amount),
    availableEarnings:String(p.reconciled?p.available_amount:0),reservedEarnings:String(p.reserved_amount),
    pendingEarnings:String(p.net_amount-(p.reconciled?p.available_amount:0)-p.reserved_amount),recordedAvailable:String(p.recorded_available),recordedReserved:String(p.recorded_reserved),
    source:JSON.parse(p.source_json),recordedAt:p.recorded_at,withdrawalsEnabled:false,availableToWithdraw:null};
}
export async function earningsOrderStatus(env,url){return earningsForOrder(env,query(url,['seller','environment','orderId']));}

export async function earningsSummary(env,url){
  const input=query(url,['seller','environment']);scope(env,input);const values=[input.seller,input.environment];
  const results=await env.DB.batch([
    env.DB.prepare(`SELECT COUNT(*) AS orders,COALESCE(SUM(reconciled=0),0) AS unreconciled,
      CAST(COALESCE(SUM(CASE WHEN reconciled=1 THEN available_amount ELSE 0 END),0) AS TEXT) AS available,
      CAST(COALESCE(SUM(reserved_amount),0) AS TEXT) AS reserved,
      CAST(COALESCE(SUM(net_amount-CASE WHEN reconciled=1 THEN available_amount ELSE 0 END-reserved_amount),0) AS TEXT) AS pending,
      CAST(COALESCE(SUM(MAX(-net_amount,0)),0) AS TEXT) AS deficit,
      CAST(COALESCE(SUM(recorded_available),0) AS TEXT) AS recorded_available,
      CAST(COALESCE(SUM(recorded_reserved),0) AS TEXT) AS recorded_reserved,
      COALESCE(SUM(json_extract(source_json,'$.recognitionId') IS NULL),0) AS unknown_fees
      FROM commerce_earnings_positions WHERE seller_id=? AND commerce_environment=?`).bind(...values),
    env.DB.prepare(`SELECT COUNT(*) AS missing FROM commerce_payment_captures c WHERE c.seller_id=? AND c.commerce_environment=?
      AND c.capture_kind='order_payment' AND NOT EXISTS(SELECT 1 FROM commerce_earnings_positions p WHERE p.capture_id=c.id)`).bind(...values),
    env.DB.prepare(`SELECT COUNT(*) AS invalid FROM commerce_financial_journals j WHERE j.seller_id=? AND j.commerce_environment=?
      AND ((SELECT COUNT(*) FROM commerce_financial_entries e WHERE e.journal_sequence=j.sequence)!=json_array_length(j.lines_json)
        OR COALESCE((SELECT SUM(e.amount) FROM commerce_financial_entries e WHERE e.journal_sequence=j.sequence),1)!=0)`).bind(...values),
  ]);
  const row=results[0].results[0],incomplete=results[1].results[0].missing,invalid=results[2].results[0].invalid;
  const net=BigInt(row.available)-BigInt(row.deficit),holds=[];
  if(row.unreconciled)holds.push('earnings_reconciliation_required');
  if(incomplete||invalid)holds.push('capture_accounting_incomplete');
  if(BigInt(row.deficit)>0n)holds.push('negative_seller_allocation');
  return {currency:'IDR',orders:row.orders,unreconciledOrders:row.unreconciled,incompleteCaptures:incomplete,balanced:invalid===0,
    availableEarnings:incomplete||invalid?'0':String(net>0n?net:0n),reservedEarnings:row.reserved,pendingEarnings:row.pending,
    negativeAllocations:row.deficit,recordedAvailable:row.recorded_available,recordedReserved:row.recorded_reserved,
    unknownProcessingFees:row.unknown_fees,holds,withdrawalMinimum:'250000',sellerWithdrawalFee:'0',withdrawalsEnabled:false,availableToWithdraw:null};
}

export async function earningsHistory(env,url){
  const input=query(url,['seller','environment','before','cap','limit']);scope(env,input);
  for(const field of ['before','cap'])if(input[field]!==undefined&&(!/^[1-9][0-9]{0,15}$/.test(input[field])||!Number.isSafeInteger(Number(input[field]))))fail('Earnings history boundary is invalid');
  if(input.limit!==undefined&&!/^[1-9][0-9]?$/.test(input.limit))fail('Earnings history size is invalid');
  const size=Number(input.limit??20);if(size>50)fail('Earnings history size is invalid');
  const cap=input.cap===undefined?(await env.DB.prepare('SELECT COALESCE(MAX(sequence),0) AS n FROM commerce_earnings_assessments WHERE seller_id=? AND commerce_environment=?').bind(input.seller,input.environment).first()).n:Number(input.cap);
  const rows=(await env.DB.prepare(`SELECT a.sequence,a.id,a.order_id,a.state,a.net_amount,a.available_amount,a.reserved_amount,a.source_json,a.recorded_at,
    a.available_amount-COALESCE(p.available_amount,0) AS available_change,a.reserved_amount-COALESCE(p.reserved_amount,0) AS reserved_change
    FROM commerce_earnings_assessments a JOIN commerce_financial_journals j ON j.id='financial_earnings_'||a.id
    LEFT JOIN commerce_earnings_assessments p ON p.id=a.previous_id
    WHERE a.seller_id=? AND a.commerce_environment=? AND a.sequence<=? AND a.sequence<? ORDER BY a.sequence DESC LIMIT ?`)
    .bind(input.seller,input.environment,cap,Number(input.before??Number.MAX_SAFE_INTEGER),size+1).all()).results;
  return {items:rows.slice(0,size).map(r=>({sequence:r.sequence,id:r.id,orderId:r.order_id,state:r.state,netAmount:String(r.net_amount),
    availableAfter:String(r.available_amount),reservedAfter:String(r.reserved_amount),availableChange:String(r.available_change),reservedChange:String(r.reserved_change),
    holds:JSON.parse(r.source_json).holds,recordedAt:r.recorded_at})),cap,nextBefore:rows.length>size?rows[size-1].sequence:null};
}
