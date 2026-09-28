import {releaseTransferFeeStatement} from './commerce-transfer-funding.js';
import {commerceEnvironment,commerceHash} from './commerce-orders.js';

const fail=(message,status=422)=>{throw new Response(message,{status});};
const fields=(input,allowed)=>{if(!input||typeof input!=='object'||Array.isArray(input)||Object.keys(input).some(k=>!allowed.includes(k)))fail('Payout reconciliation parameters are invalid');};
function scope(env,environment){
  commerceEnvironment(env,environment);
  if(!['test','beta'].includes(env.APP_ENVIRONMENT))fail('Payout reconciliation is unavailable on this deployment',503);
}
const original=(env,id,environment)=>env.DB.prepare(`SELECT w.id FROM commerce_withdrawals w
  JOIN commerce_withdrawal_payment_grants g ON g.withdrawal_id=w.id WHERE w.id=? AND w.commerce_environment=?`).bind(id,environment).first();
const assessmentSQL=`SELECT a.*,r.*,f.current AS source_current,j.id AS journal_id,
  NOT EXISTS(SELECT 1 FROM commerce_payout_assessments later WHERE later.withdrawal_id=a.withdrawal_id AND later.sequence>a.sequence) AS latest
  FROM commerce_payout_assessments a JOIN commerce_payout_results r ON r.assessment_sequence=a.sequence
  JOIN commerce_payout_source_freshness f ON f.assessment_sequence=a.sequence
  LEFT JOIN commerce_financial_journals j ON j.id='financial_payout_'||a.id`;
const assessment=r=>r?{id:r.id,sequence:r.sequence,state:r.state,reason:r.reason,providerReference:r.provider_reference,
  feeAmount:String(r.fee_amount),paidAmount:String(r.paid_amount),sourceCurrent:!!r.source_current,latest:!!r.latest,
  source:JSON.parse(r.source_json),providerAt:r.provider_at,observedAt:r.observed_at,recordedAt:r.recorded_at,journalId:r.journal_id}:null;

// Safe for the already-authorized merchant response: no provider references,
// account identifiers, credentials or original evidence leave this projection.
export async function payoutSummaries(env,ids){
  if(!ids.length)return new Map();
  const rows=(await env.DB.prepare(`SELECT * FROM commerce_payout_positions WHERE withdrawal_id IN (${ids.map(()=>'?').join(',')})`)
    .bind(...ids).all()).results;
  return new Map(rows.filter(r=>r.assessment_id).map(r=>[r.withdrawal_id,{
    state:r.reconciled?r.state:'review',reason:r.source_current?r.reason:'provider_evidence_changed',
    reconciled:!!r.reconciled,payoutConfirmed:!!r.reconciled&&r.state==='completed',
    paidAmount:String(r.paid_amount),reservedAmount:r.recognition_id?'0':String(r.amount),
    sellerFee:'0',recordedAt:r.recorded_at,reconciliationRequired:!r.reconciled,
  }]));
}

export async function payoutStatus(env,id,input){
  fields(input,['environment']);scope(env,input.environment);
  if(!await original(env,id,input.environment))fail('Original payment dispatch was not found',404);
  const latest=await env.DB.prepare(assessmentSQL+' WHERE a.withdrawal_id=? ORDER BY a.sequence DESC LIMIT 1').bind(id).first();
  return {withdrawalId:id,assessment:assessment(latest),outcome:(await payoutSummaries(env,[id])).get(id)||null,
    providerCalls:0,mayPay:false};
}

export async function reconcilePayout(env,id,input){
  fields(input,['environment','sellerCollectionId','platformCollectionId','statusCap']);scope(env,input.environment);
  if(!await original(env,id,input.environment))fail('Original payment dispatch was not found',404);
  for(const k of ['sellerCollectionId','platformCollectionId'])if(typeof input[k]!=='string'||!/^fcol_[a-f0-9]{40}$/.test(input[k]))fail('Original account collection IDs are required');
  if(!Number.isSafeInteger(input.statusCap)||input.statusCap<1)fail('An original status history boundary is required');
  const assessmentId='payout_'+(await commerceHash({version:1,withdrawal:id,environment:input.environment,
    sellerCollectionId:input.sellerCollectionId,platformCollectionId:input.platformCollectionId,statusCap:input.statusCap})).slice(0,40);
  const collections=(await env.DB.prepare('SELECT id,sequence FROM commerce_provider_financial_collections WHERE id IN (?,?)')
    .bind(input.sellerCollectionId,input.platformCollectionId).all()).results;
  const seller=collections.find(c=>c.id===input.sellerCollectionId),platform=collections.find(c=>c.id===input.platformCollectionId);
  if(!seller||!platform||seller.sequence===platform.sequence)fail('Both original account collections are required',409);
  const prior=await env.DB.prepare('SELECT id FROM commerce_payout_assessments WHERE withdrawal_id=? ORDER BY sequence DESC LIMIT 1').bind(id).first();
  let saved;
  try{
    [saved]=await env.DB.batch([env.DB.prepare(`INSERT INTO commerce_payout_assessments(id,version,withdrawal_id,seller_collection_sequence,platform_collection_sequence,status_sequence,previous_id,recorded_at)
      SELECT ?,1,?,?,?,?,?,strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE NOT EXISTS(SELECT 1 FROM commerce_payout_assessments WHERE id=?)`)
      .bind(assessmentId,id,seller.sequence,platform.sequence,input.statusCap,prior?.id||null,assessmentId),releaseTransferFeeStatement(env,'withdrawal',id,assessmentId)]);
  }catch(error){
    if(/payout_(original_accounts_required|complete_window_required|history_superseded|status_superseded|concurrent_assessment|reference_conflict)/.test(String(error)))
      fail('Payout evidence is incomplete, superseded or conflicts with the original transfer. Reconcile the original provider records.',409);
    throw error;
  }
  const recorded=await env.DB.prepare(assessmentSQL+' WHERE a.id=?').bind(assessmentId).first();
  if(!recorded)fail('Payout assessment was not saved',500);
  return {recorded:assessment(recorded),replayed:saved.meta.changes===0,...await payoutStatus(env,id,{environment:input.environment})};
}
