import {prepareTransferFunding} from './commerce-transfer-funding.js';
import {treasuryOutcomeSummary} from './commerce-treasury-outcomes.js';
import {treasuryStatusSummaries} from './commerce-treasury-status.js';
import {commerceHash,commerceStorageEnabled} from './commerce-orders.js';
import {currentCommerceEnvironment as mode} from './commerce-access.js';
import {supportActor,supportAccess} from './commerce-support.js';
const fail=(message,status=422)=>{throw new Response(message,{status});};
const fields=(value,allowed)=>{if(!value||typeof value!=='object'||Array.isArray(value)||Object.keys(value).some(k=>!allowed.includes(k)))fail('Treasury parameters are invalid.');};
const key=value=>{if(typeof value!=='string'||!/^[a-f0-9]{32}$/.test(value))fail('Treasury request reference is invalid.');};
async function authorize(env,user){
  if(!['test','beta'].includes(env.APP_ENVIRONMENT)||!commerceStorageEnabled(env))fail('Treasury is unavailable on this deployment.',503);
  const operators=String(env.COMMERCE_TREASURY_OPERATORS||'').split(',').map(x=>x.trim()).filter(Boolean);
  if(!operators.includes(user.id))fail('Ezkart treasury operator access is required.',403);
  const actor=await supportActor(env,user);await supportAccess(env,actor,true);return actor;
}
function destination(env,required=false){
  if(!env.COMMERCE_TREASURY_BANK){if(required)fail('The company bank destination is not configured.',503);return null;}
  let d;try{d=JSON.parse(env.COMMERCE_TREASURY_BANK);}catch{fail('The company bank configuration needs review.',503);}
  fields(d,['configurationId','code','accountNumber','channel','beneficiaryName']);
  if(typeof d.configurationId!=='string'||!/^[A-Za-z0-9_-]{3,80}$/.test(d.configurationId)
    ||typeof d.code!=='string'||!/^[A-Z0-9]{4,16}$/.test(d.code)||typeof d.accountNumber!=='string'||!/^[0-9]{1,22}$/.test(d.accountNumber)
    ||!['BI_FAST','ONLINE'].includes(d.channel)||typeof d.beneficiaryName!=='string'||d.beneficiaryName.trim().length<3
    ||d.beneficiaryName.length>100||/[\u0000-\u001f\u007f]/.test(d.beneficiaryName))fail('The company bank configuration needs review.',503);
  return {configurationId:d.configurationId,code:d.code,accountNumber:d.accountNumber,channel:d.channel,beneficiaryName:d.beneficiaryName};
}
const masked=d=>d?{configurationId:d.configurationId,code:d.code,accountSuffix:d.accountNumber.slice(-4),channel:d.channel,
  expectedBeneficiaryName:d.beneficiaryName,verified:false}:null;
async function platform(env){
  const seller=env.COMMERCE_PLATFORM_WALLET_SELLER;
  if(typeof seller!=='string'||!/^[A-Za-z0-9][A-Za-z0-9_-]{2,95}$/.test(seller))return null;
  return env.DB.prepare(`SELECT e.id,e.seller_id,b.credential_fingerprint,b.client_id,b.parent_profile_id,p.profile_id,p.cash_account
    FROM commerce_wallet_enrollments e JOIN commerce_wallet_provider_profiles p ON p.enrollment_id=e.id
    JOIN commerce_wallet_provider_bindings b ON b.enrollment_id=e.id JOIN sellers s ON s.id=e.seller_id AND s.status='active' WHERE e.seller_id=? AND e.commerce_environment=?`)
    .bind(seller,mode(env)).first();
}
async function funds(env,enrollment){
  if(!enrollment)return null;
  return env.DB.prepare(`SELECT CAST(net_commission AS TEXT) AS netCommission,CAST(eligible_commission AS TEXT) AS eligibleCommission,
    CAST(reversed_commission AS TEXT) AS reversedCommission,CAST(reserved_commission AS TEXT) AS reservedCommission,
    CAST(paid_commission AS TEXT) AS paidCommission,CAST(paid_transfer_fees AS TEXT) AS paidTransferFees,accounting_holds AS accountingHolds,CAST(reserved_transfer_fees AS TEXT) AS reservedTransferFees,fee_contract_holds AS feeContractHolds,
    CAST(reservable_commission AS TEXT) AS reservableCommission,CAST(reservation_shortfall AS TEXT) AS reservationShortfall,
    held_captures AS heldCaptures,unattributed_captures AS unattributedCaptures,refund_holds AS refundHolds,incomplete_journals AS incompleteJournals,source_capacity_exceeded AS sourceCapacityExceeded,length(source_json) AS sourceBytes
    FROM commerce_treasury_funds WHERE platform_enrollment_id=? AND commerce_environment=?`).bind(enrollment,mode(env)).first();
}
const constraints=['transfer_fee_contract_or_current_budget_required'];
export async function treasurySummary(env,user){
  await authorize(env,user);const wallet=await platform(env),bank=destination(env),projection=await funds(env,wallet?.id);
  const recent=await env.DB.prepare(`SELECT i.id,CAST(i.amount AS TEXT) AS amount,i.created_at AS createdAt,c.created_at AS cancelledAt,COALESCE(p.reconciled,0) AS reconciled,EXISTS(SELECT 1 FROM commerce_treasury_bank_grants g WHERE g.intent_id=i.id AND g.stage='payment') AS transferStarted FROM commerce_treasury_intents i LEFT JOIN commerce_treasury_cancellations c ON c.intent_id=i.id LEFT JOIN commerce_treasury_positions p ON p.intent_id=i.id WHERE i.commerce_environment=? ORDER BY i.sequence DESC LIMIT 30`).bind(mode(env)).all();
  return {recentIntents:recent.results,inquiryAvailable:env.COMMERCE_TREASURY_INQUIRY==='enabled',environment:mode(env),platformConfigured:!!wallet,companyBank:masked(bank),funds:projection,
    amountMeaning:'Commission reservation projection; not bank-withdrawable cash.',withdrawableCommission:null,
    executionAvailable:false,blockers:[...(!wallet?['platform_wallet_unconfigured']:[]),...(!bank?['company_bank_unconfigured']:[]),...(projection?.sourceCapacityExceeded?['commission_source_capacity_exceeded']:[]),...constraints],providerCalls:0};
}
const original=(env,id)=>env.DB.prepare(`SELECT i.*,c.created_at AS cancelled_at FROM commerce_treasury_intents i
  LEFT JOIN commerce_treasury_cancellations c ON c.intent_id=i.id WHERE i.id=? AND i.commerce_environment=?`).bind(id,mode(env)).first();
function view(row){return {id:row.id,sequence:row.sequence,environment:row.commerce_environment,amount:String(row.amount),currency:'IDR',
  state:row.cancelled_at?'cancelled':'reserved_pending_bank_verification',companyBank:masked(JSON.parse(row.destination_json)),
  destinationHash:row.destination_hash,partnerReference:row.partner_reference,createdAt:row.created_at,cancelledAt:row.cancelled_at||null,
  payoutConfirmed:false,mayPay:false,providerCalls:0};}
async function detail(env,row){
  if(!row)fail('Treasury intent was not found.',404);
  const current=destination(env),wallet=await platform(env);
  const bank=await env.DB.prepare(`SELECT g.stage,g.confirmation_id AS confirmationId,g.created_at AS startedAt,r.digest,r.beneficiary_name AS beneficiaryName,r.recorded_at AS receivedAt FROM commerce_treasury_bank_grants g LEFT JOIN commerce_treasury_bank_receipts r ON r.intent_id=g.intent_id AND r.stage=g.stage WHERE g.intent_id=?`).bind(row.id).all();
  const confirmations=await env.DB.prepare('SELECT id,inquiry_digest AS inquiryDigest,created_at AS confirmedAt,proof_expires_at AS proofExpiresAt FROM commerce_treasury_bank_confirmations WHERE intent_id=? ORDER BY created_at DESC LIMIT 5').bind(row.id).all();
  const result=view(row),payment=bank.results.find(x=>x.stage==='payment'),inquiry=bank.results.find(x=>x.stage==='inquiry');
  if(payment)result.state=payment.receivedAt?'transfer_response_recorded_pending_reconciliation':'transfer_outcome_unknown';
  else if(!row.cancelled_at&&inquiry)result.state=inquiry.receivedAt?'bank_inquiry_recorded':'bank_inquiry_outcome_unknown';
  let eligible=false;
  if(!payment&&!row.cancelled_at&&wallet)try{await prepareTransferFunding(env,{kind:'treasury',id:row.id,channel:JSON.parse(row.destination_json).channel,fingerprint:wallet.credential_fingerprint,clientId:wallet.client_id,platform:wallet.id});eligible=true;}catch(e){if(!(e instanceof Response))throw e;}
  const outcome=await treasuryOutcomeSummary(env,row.id),providerStatus=(await treasuryStatusSummaries(env,[row.id])).get(row.id)||null;
  if(outcome?.reconciled){result.state='company_transfer_reconciled';result.payoutConfirmed=true;}
  else if(outcome?.reservationConsumed)result.state='recorded_company_outflow_needs_review';
  return {outcome,providerStatus,paymentConfirmationId:payment?.confirmationId||null,intent:result,bank:bank.results,confirmations:confirmations.results,originalSources:JSON.parse(row.source_json),funds:await funds(env,row.platform_enrollment_id),
    configurationChanged:!current||await commerceHash(current)!==row.destination_hash||wallet?.id!==row.platform_enrollment_id,
    executionAvailable:!!eligible&&env.COMMERCE_TREASURY_PAYMENT==='enabled',blockers:eligible?[]:constraints,releasePolicy:'settled_and_verified_whole_order_delivery',providerCalls:0};
}
function admissionFailure(error){
  if(/treasury_funds_unavailable|treasury_platform_inactive/.test(String(error)))fail('Current verified commission cannot cover this reservation.',409);
  if(/treasury_operator_changed|treasury_proof_expired/.test(String(error)))fail('Treasury authorization changed. Verify your authenticator again.',401);
  if(/treasury_payment_in_flight/.test(String(error)))fail('This transfer already has a send grant and cannot be cancelled.',409);
  throw error;
}
export async function reserveTreasury(env,user,input){
  fields(input,['requestKey','amount']);const actor=await authorize(env,user);key(input.requestKey);
  if(typeof input.amount!=='string'||!/^[1-9][0-9]{0,15}$/.test(input.amount)||BigInt(input.amount)>9007199254740991n)fail('Commission amount must be exact whole rupiah within the ledger limit.');
  const id='try_'+(await commerceHash({environment:mode(env),requestKey:input.requestKey})).slice(0,40);
  const replay=async row=>{if(row.operator_id!==actor.id||String(row.amount)!==input.amount)fail('The original treasury intent has different details.',409);return {...await detail(env,row),replayed:true};};
  const prior=await original(env,id);if(prior)return replay(prior);
  const bank=destination(env,true),wallet=await platform(env);if(!wallet)fail('A verified dedicated platform wallet is required.',409);
  const hash=await commerceHash(bank);
  try{
    await env.DB.prepare(`INSERT INTO commerce_treasury_intents(id,commerce_environment,request_key,operator_id,proof_expires_at,
      platform_enrollment_id,amount,destination_hash,destination_json,source_json,partner_reference,created_at)
      SELECT ?,?,?,?,?,?,CAST(? AS INTEGER),?,?,source_json,?,strftime('%Y-%m-%dT%H:%M:%fZ','now')
      FROM commerce_treasury_funds WHERE platform_enrollment_id=? AND commerce_environment=?`)
      .bind(id,mode(env),input.requestKey,actor.id,actor.proofExpiresAt,wallet.id,input.amount,hash,JSON.stringify(bank),
        'EZK-TREASURY-'+(mode(env)==='sandbox'?'S':'P')+'-'+id.slice(4),wallet.id,mode(env)).run();
  }catch(error){const saved=await original(env,id);if(saved)return replay(saved);admissionFailure(error);}
  return {...await detail(env,await original(env,id)),replayed:false};
}
export async function readTreasury(env,user,id){await authorize(env,user);return detail(env,await original(env,id));}
export async function lookupTreasury(env,user,input){fields(input,['requestKey']);await authorize(env,user);key(input.requestKey);
  return detail(env,await original(env,'try_'+(await commerceHash({environment:mode(env),requestKey:input.requestKey})).slice(0,40)));}
export async function cancelTreasury(env,user,id,input){
  fields(input,['requestKey']);const actor=await authorize(env,user);key(input.requestKey);const row=await original(env,id);if(!row)fail('Treasury intent was not found.',404);
  const cancellation=()=>env.DB.prepare('SELECT * FROM commerce_treasury_cancellations WHERE intent_id=?').bind(id).first();
  const replay=async saved=>{if(saved.request_key!==input.requestKey||saved.operator_id!==actor.id)fail('This treasury intent was already cancelled.',409);return {...await detail(env,await original(env,id)),replayed:true};};
  const prior=await cancellation();if(prior)return replay(prior);
  try{await env.DB.prepare(`INSERT INTO commerce_treasury_cancellations(intent_id,request_key,operator_id,proof_expires_at,created_at)
    VALUES(?,?,?,?,strftime('%Y-%m-%dT%H:%M:%fZ','now'))`).bind(id,input.requestKey,actor.id,actor.proofExpiresAt).run();}
  catch(error){const saved=await cancellation();if(saved)return replay(saved);admissionFailure(error);}
  return {...await detail(env,await original(env,id)),replayed:false};
}

export {authorize as treasuryAuthorize,destination as treasuryDestination,platform as treasuryPlatform,original as treasuryOriginal};
