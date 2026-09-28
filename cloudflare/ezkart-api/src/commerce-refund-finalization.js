import {commerceEnvironment,commerceStorageEnabled} from './commerce-orders.js';
const fail=(message,status=422)=>{throw new Response(message,{status});};

// HMAC authorizes reconciliation only. All money and outcome identity must come
// from the database's provider-verified evidence projection, currently closed.
export async function finalizeConfirmedRefund(env,input){
  if(!input||typeof input!=='object'||Array.isArray(input)||Object.keys(input).some(k=>!['environment','seller','refundId','evidenceId'].includes(k)))fail('Refund finalization parameters are invalid.');
  commerceEnvironment(env,input.environment);
  if(!commerceStorageEnabled(env))fail('Refund accounting is unavailable.',503);
  if(!/^[A-Za-z0-9][A-Za-z0-9_-]{2,95}$/.test(input.seller||'')||!/^ref_[a-f0-9]{32}$/.test(input.refundId||'')
    ||typeof input.evidenceId!=='string'||input.evidenceId.length<1||input.evidenceId.length>200)fail('Refund finalization references are invalid.');
  const scope=[input.refundId,input.seller,input.environment];
  if(!await env.DB.prepare('SELECT id FROM commerce_refunds WHERE id=? AND seller_id=? AND commerce_environment=?').bind(...scope).first())fail('Refund not found.',404);
  const saved=()=>env.DB.prepare('SELECT * FROM commerce_refund_finalizations WHERE refund_id=? AND seller_id=? AND commerce_environment=?').bind(...scope).first();
  const receipt=row=>{
    if(row.evidence_id!==input.evidenceId)fail('This refund already has a different original outcome.',409);
    return {refundId:row.refund_id,evidenceId:row.evidence_id,state:'confirmed',paymentConfirmed:true,journalId:'financial_refund_'+row.refund_id,
      amount:String(row.product_amount+row.shipping_amount),commissionReversal:String(row.commission_reversal),
      actualRefundFee:row.refund_fee_amount===null?null:String(row.refund_fee_amount),refundFeePayer:null,
      fundingState:'unreconciled',refundFeeState:row.refund_fee_amount===null?'unknown':'custody_unresolved',returnedAt:row.returned_at};
  };
  const prior=await saved();if(prior)return receipt(prior);
  try{
    await env.DB.prepare(`INSERT INTO commerce_refund_finalizations
      (refund_id,provider_request_id,evidence_id,capture_id,seller_id,order_id,commerce_environment,credential_fingerprint,outcome_reference,
       product_amount,shipping_amount,commission_reversal,cumulative_product_amount,refund_fee_amount,evidence_json,returned_at,posted_at)
      SELECT refund_id,provider_request_id,evidence_id,capture_id,seller_id,order_id,commerce_environment,credential_fingerprint,outcome_reference,
       product_amount,shipping_amount,commission_reversal,cumulative_product_amount,refund_fee_amount,evidence_json,returned_at,strftime('%Y-%m-%dT%H:%M:%fZ','now')
      FROM commerce_refund_finalization_sources WHERE refund_id=? AND seller_id=? AND commerce_environment=? AND evidence_id=?`)
      .bind(...scope,input.evidenceId).run();
  }catch(error){
    const committed=await saved();if(committed)return receipt(committed);
    if(/refund_finalization_|UNIQUE constraint failed/.test(String(error)+' '+String(error?.cause)))fail('The original refund outcome conflicts with saved evidence.',409);
    throw error;
  }
  const committed=await saved();if(committed)return receipt(committed);
  fail('No supported verified returned-funds evidence exists for this original refund request. Submission records are not payment evidence.',409);
}
