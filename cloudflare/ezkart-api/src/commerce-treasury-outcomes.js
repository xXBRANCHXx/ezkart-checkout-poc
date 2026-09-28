import {commerceEnvironment,commerceHash} from './commerce-orders.js';
import {currentCommerceEnvironment as mode} from './commerce-access.js';
const fail=(m,s=422)=>{throw new Response(m,{status:s});};
const fields=(x,keys)=>{if(!x||typeof x!=='object'||Array.isArray(x)||Object.keys(x).some(k=>!keys.includes(k)))fail('Treasury outcome parameters are invalid.');};
function scope(env,environment){commerceEnvironment(env,environment);if(!['test','beta'].includes(env.APP_ENVIRONMENT))fail('Treasury observations are unavailable on this deployment.',503);}
export async function treasuryObservationScope(env,id,input){
 fields(input,['environment']);scope(env,input.environment);
 const g=await env.DB.prepare(`SELECT g.*,p.profile_id,p.cash_account,p.pending_account,i.platform_enrollment_id,e.seller_id
 FROM commerce_treasury_bank_grants g JOIN commerce_treasury_intents i ON i.id=g.intent_id
 JOIN commerce_wallet_provider_profiles p ON p.enrollment_id=i.platform_enrollment_id JOIN commerce_wallet_enrollments e ON e.id=i.platform_enrollment_id
 WHERE g.intent_id=? AND g.stage='payment' AND g.commerce_environment=?`).bind(id,mode(env)).first();
 if(!g)fail('The original company transfer grant was not found.',404);
 const binding=JSON.parse(g.binding_json);if(binding.fromAccount!==g.cash_account)fail('Original company account needs review.',409);
 return {original:{intentId:id,environment:g.commerce_environment,clientId:g.client_id,binding,confirmationId:g.confirmation_id,grantedAt:g.created_at,
  account:{enrollmentId:g.platform_enrollment_id,seller:g.seller_id,profileId:g.profile_id,cashAccount:g.cash_account,pendingAccount:g.pending_account}},mayPay:false,providerCalls:0};
}
const projection=r=>r?{assessmentId:r.id,state:r.current?r.state:'held',reason:r.current?r.reason:'provider_evidence_changed',sourceCurrent:!!r.current,
 observedFee:r.observed_fee??null,observedAt:r.observed_at,recordedAt:r.recorded_at,
 accountingState:r.reconciled?'company_cash_outflow_recorded':r.recognition_sequence?'recorded_outflow_needs_review':r.current&&r.state==='matched_success'&&r.observed_fee!==null?'held_exact_journal_range':'held_original_evidence_incomplete',
 recognizedPrincipal:String(r.paid_amount||0),recognizedFee:r.recognition_sequence?String(r.fee_amount):null,
 payoutConfirmed:!!r.reconciled,reconciled:!!r.reconciled,reservationConsumed:!!r.recognition_sequence,reservationReleased:false}:null;
const read=(env,id)=>env.DB.prepare(`SELECT a.*,r.state,r.reason,r.observed_fee,r.observed_at,r.source_json,f.current,p.recognition_sequence,p.paid_amount,p.fee_amount,p.reconciled FROM commerce_treasury_outcome_assessments a
 JOIN commerce_treasury_outcome_results r ON r.assessment_sequence=a.sequence JOIN commerce_treasury_outcome_freshness f ON f.assessment_sequence=a.sequence
 JOIN commerce_treasury_positions p ON p.intent_id=a.intent_id WHERE a.intent_id=? ORDER BY a.sequence DESC LIMIT 1`).bind(id).first();
export async function treasuryOutcomeSummary(env,id){return projection(await read(env,id));}
export async function treasuryOutcomeRead(env,id,input){
 await treasuryObservationScope(env,id,input);const r=await read(env,id);
 return {intentId:id,outcome:projection(r),source:r?JSON.parse(r.source_json):null,mayPay:false,providerCalls:0};
}
export async function reconcileTreasuryOutcome(env,id,input){
 fields(input,['environment','collectionId','statusCap']);scope(env,input.environment);
 await treasuryObservationScope(env,id,{environment:input.environment});
 if(typeof input.collectionId!=='string'||!/^fcol_[a-f0-9]{40}$/.test(input.collectionId)||!Number.isSafeInteger(input.statusCap)||input.statusCap<1)fail('Original company collection and status boundary are required.');
 const c=await env.DB.prepare('SELECT sequence FROM commerce_provider_financial_collections WHERE id=?').bind(input.collectionId).first();if(!c)fail('Original provider collection was not found.',404);
 const receipt=await env.DB.prepare("SELECT digest FROM commerce_treasury_bank_receipts WHERE intent_id=? AND stage='payment'").bind(id).first();
 const digest=receipt?.digest||null,assessmentId='tryout_'+(await commerceHash({version:1,id,collectionId:input.collectionId,statusCap:input.statusCap,paymentReceiptDigest:digest})).slice(0,40);
 const prior=await read(env,id);let saved;
 try{const statements=[env.DB.prepare(`INSERT INTO commerce_treasury_outcome_assessments(id,intent_id,collection_sequence,status_sequence,payment_receipt_digest,previous_id,recorded_at)
 SELECT ?,?,?,?,?,?,strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE NOT EXISTS(SELECT 1 FROM commerce_treasury_outcome_assessments WHERE id=?)`)
 .bind(assessmentId,id,c.sequence,input.statusCap,digest,prior?.id||null,assessmentId),
 env.DB.prepare(`INSERT INTO commerce_treasury_recognitions(assessment_sequence,intent_id,previous_sequence,paid_amount,fee_amount,recorded_at)
 SELECT c.assessment_sequence,c.intent_id,c.previous_sequence,c.paid_amount,c.fee_amount,strftime('%Y-%m-%dT%H:%M:%fZ','now')
 FROM commerce_treasury_recognition_candidates c JOIN commerce_treasury_outcome_assessments a ON a.sequence=c.assessment_sequence
 WHERE a.id=? AND NOT EXISTS(SELECT 1 FROM commerce_treasury_recognitions n WHERE n.assessment_sequence=c.assessment_sequence)`).bind(assessmentId)];
 [saved]=await env.DB.batch(statements);}
 catch(e){if(/treasury_outcome_|treasury_recognition_|treasury_cash_reference_|CHECK constraint/.test(String(e)))fail('Original treasury observations are incomplete, stale or conflicting. Keep the transfer reserved and review its original evidence.',409);throw e;}
 return {assessmentId,replayed:saved.meta.changes===0,...await treasuryOutcomeRead(env,id,{environment:input.environment})};
}
