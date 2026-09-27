import {commerceEnvironment} from './commerce-orders.js';
import {withdrawalFailure} from './commerce-withdrawals.js';
import {withdrawalInquiryOwner,validateWithdrawalInquiryReceipt,withdrawalEvidenceDate,withdrawalEvidenceText,withdrawalEvidenceJSON,withdrawalEvidenceHash} from './commerce-withdrawal-inquiries.js';
import {parseFinancialEvidenceJSON,FinancialJsonNumber} from './financial-evidence-json.js';

const fail=(message,status=422)=>{throw new Response(message,{status});};
const fields=(input,allowed)=>{if(!input||typeof input!=='object'||Array.isArray(input)||Object.keys(input).some(k=>!allowed.includes(k)))fail('Withdrawal payment parameters are invalid');};
const evidenceFields=['environment','credentialFingerprint','operation','externalId','requestedAt','observedAt','requestBody','responseBody'];
const ownerFields=['environment','seller','actor'];
const date=withdrawalEvidenceDate,text=withdrawalEvidenceText,wire=withdrawalEvidenceJSON;
function scope(env,environment){commerceEnvironment(env,environment);if(!['test','beta'].includes(env.APP_ENVIRONMENT))fail('Withdrawals are not enabled on this deployment',503);}
const grant=(env,id,environment)=>env.DB.prepare('SELECT * FROM commerce_withdrawal_payment_grants WHERE withdrawal_id=? AND commerce_environment=?').bind(id,environment).first();
async function feeAccount(env,enrollment){
  if(!enrollment)return null;
  const row=await env.DB.prepare(`SELECT e.seller_id,p.profile_id,p.cash_account,b.parent_profile_id FROM commerce_wallet_enrollments e
    JOIN commerce_wallet_provider_profiles p ON p.enrollment_id=e.id JOIN commerce_wallet_provider_bindings b ON b.enrollment_id=e.id WHERE e.id=?`).bind(enrollment).first();
  if(!row)fail('The original platform account requires review',409);
  return {enrollmentId:enrollment,seller:row.seller_id,profileId:row.profile_id,cashAccount:row.cash_account,parentProfileId:row.parent_profile_id,
    feePayer:'ezkart',sellerWithdrawalFee:'0',providerFundingVerified:false};
}
async function inquiry(env,id){
  const row=await env.DB.prepare(`SELECT g.*,r.inquiry_digest,r.evidence_json,r.provider_reference,r.beneficiary_name
    FROM commerce_withdrawal_inquiry_grants g JOIN commerce_withdrawal_inquiry_receipts r ON r.withdrawal_id=g.withdrawal_id WHERE g.withdrawal_id=?`).bind(id).first();
  if(!row)fail('The original verified bank inquiry is required',409);
  const original=JSON.parse(row.evidence_json),checked=await validateWithdrawalInquiryReceipt(row,original);
  if(checked.digest!==row.inquiry_digest)fail('The original bank inquiry needs review',409);
  return {...row,binding:JSON.parse(row.binding_json),original};
}
function paymentBody(g){
  return wire({...JSON.parse(g.request_body),referenceNo:g.provider_reference,beneficiaryAccountName:g.beneficiary_name});
}

// This is the durable execution boundary, not a scheduled or merchant caller.
// The flag must remain held until fee funding, outcome accounting and the actual
// transport integration are complete. A replay never renews send authority.
export async function startWithdrawalPayment(env,id,input){
  fields(input,[...ownerFields,'confirmationId','credentialFingerprint','clientId']);scope(env,input.environment);
  if(env.COMMERCE_WITHDRAWAL_PAYMENT!=='enabled')fail('Withdrawal payment dispatch is not enabled',503);
  await withdrawalInquiryOwner(env,id,input);
  if(typeof input.confirmationId!=='string'||!/^wdconf_[a-f0-9]{40}$/.test(input.confirmationId)
    ||typeof input.credentialFingerprint!=='string'||!/^[a-f0-9]{64}$/.test(input.credentialFingerprint)
    ||typeof input.clientId!=='string'||!/^[A-Za-z0-9_-]{3,128}$/.test(input.clientId))fail('Withdrawal payment identity is invalid');
  const replay=saved=>{
    if(saved.confirmation_id!==input.confirmationId||saved.credential_fingerprint!==input.credentialFingerprint||saved.client_id!==input.clientId)
      fail('The original payment confirmation and provider identity cannot change',409);
    return {mayPay:false,payoutConfirmed:false};
  };
  const previous=await grant(env,id,input.environment);if(previous)return replay(previous);
  const original=await inquiry(env,id);
  if(original.credential_fingerprint!==input.credentialFingerprint||original.client_id!==input.clientId)fail('Payment credentials differ from the original bank inquiry',409);
  if(typeof env.COMMERCE_PLATFORM_WALLET_SELLER!=='string'||!/^[A-Za-z0-9][A-Za-z0-9_-]{2,95}$/.test(env.COMMERCE_PLATFORM_WALLET_SELLER)
    ||env.COMMERCE_PLATFORM_WALLET_SELLER===input.seller)fail('The platform withdrawal-fee account is not configured',503);
  const platform=await env.DB.prepare(`SELECT p.enrollment_id FROM commerce_wallet_enrollments e
    JOIN commerce_wallet_provider_profiles p ON p.enrollment_id=e.id AND p.commerce_environment=e.commerce_environment
    WHERE e.seller_id=? AND e.commerce_environment=?`).bind(env.COMMERCE_PLATFORM_WALLET_SELLER,input.environment).first();
  if(!platform)fail('A confirmed platform account is required before withdrawal payment',409);
  try{
    await env.DB.prepare(`INSERT INTO commerce_withdrawal_payment_grants(withdrawal_id,commerce_environment,confirmation_id,owner_auth_id,
      proof_expires_at,credential_fingerprint,client_id,payment_external_id,inquiry_digest,request_body,platform_enrollment_id,funds_json,created_at)
      SELECT ?,?,?,?,?,?,?,?,?,?,?,f.source_json,strftime('%Y-%m-%dT%H:%M:%fZ','now') FROM commerce_withdrawal_funds f WHERE f.seller_id=? AND f.commerce_environment=?`)
      .bind(id,input.environment,input.confirmationId,input.actor.id,input.actor.proofExpiresAt,input.credentialFingerprint,input.clientId,
        original.payment_external_id,original.inquiry_digest,paymentBody(original),platform.enrollment_id,input.seller,input.environment).run();
  }catch(error){const saved=await grant(env,id,input.environment);if(saved)return replay(saved);paymentFailure(error);}
  if(!await grant(env,id,input.environment))fail('Withdrawal payment could not be prepared',409);
  return {mayPay:true,binding:original.binding,originalInquiry:original.original,inquiryDigest:original.inquiry_digest,
    confirmationId:input.confirmationId,feeAccount:await feeAccount(env,platform.enrollment_id),payoutConfirmed:false};
}
function paymentFailure(error){
  if(/withdrawal_payment_platform_required/.test(String(error)))fail('The platform fee account does not match the original provider identity',409);
  if(/withdrawal_payment_confirmation/.test(String(error)))fail('Confirm the original bank details again with fresh Wallet verification',409);
  if(/withdrawal_payment_source/.test(String(error)))fail('The payment no longer matches its original bank inquiry',409);
  withdrawalFailure(error);
}

async function validateReceipt(env,g,e){
  fields(e,evidenceFields);
  if(Object.keys(e).length!==evidenceFields.length||e.environment!==g.commerce_environment||e.credentialFingerprint!==g.credential_fingerprint
    ||e.operation!=='transfer-payment'||e.externalId!==g.payment_external_id||e.requestBody!==g.request_body
    ||typeof e.responseBody!=='string'||new TextEncoder().encode(e.responseBody).length>16000)fail('Payment receipt differs from its original dispatch',409);
  const sent=date(e.requestedAt),observed=date(e.observedAt);
  if(sent>observed||Date.parse(sent)<Date.parse(g.created_at)-300000||Date.parse(observed)>Date.now()+300000)fail('Payment evidence time is invalid');
  const original=await inquiry(env,g.withdrawal_id),b=original.binding;
  if(original.inquiry_digest!==g.inquiry_digest||paymentBody(original)!==g.request_body)fail('The original payment inquiry is inconsistent',409);
  let r;try{r=parseFinancialEvidenceJSON(e.responseBody);}catch{fail('Payment JSON is invalid or ambiguous');}
  if(!r||typeof r!=='object'||Array.isArray(r)||typeof r.responseCode!=='string'||!/^200[0-9]{4}$/.test(r.responseCode))fail('Payment response was not successful');
  const expected=JSON.parse(g.request_body);
  for(const key of ['partnerReferenceNo','type','channel','beneficiaryBankCode','beneficiaryAccountNumber','beneficiaryAccountName'])
    if(r[key]!==expected[key])fail('Payment response does not match the original destination',409);
  const from=r.fromAccount instanceof FinancialJsonNumber?r.fromAccount.value:r.fromAccount;
  if(from!==b.fromAccount||r.amount?.value!==b.amount+'.00'||r.amount?.currency!=='IDR')fail('Payment response does not match the original amount or source',409);
  const reference=text(r.referenceNo,64),bankReference=text(r.referenceNumber,64),processed=date(r.transactionDate);
  if(Date.parse(processed)>Date.parse(observed)+300000||Date.parse(processed)<Date.parse(original.original.requestedAt)-300000)fail('Payment processing time is invalid');
  const evidence=JSON.stringify(Object.fromEntries(evidenceFields.map(k=>[k,e[k]])));
  const digest=await withdrawalEvidenceHash('ezkart.doku.bank-payment.v1\n'+wire([g.confirmation_id,g.inquiry_digest,...evidenceFields.map(k=>e[k])]));
  return {reference,bankReference,processed,sent,observed,evidence,digest};
}

export async function saveWithdrawalPaymentReceipt(env,id,input){
  fields(input,['environment','evidence']);scope(env,input.environment);
  const g=await grant(env,id,input.environment);if(!g)fail('Original payment dispatch was not found',404);
  const data=await validateReceipt(env,g,input.evidence);
  const read=()=>env.DB.prepare('SELECT evidence_json,payment_digest FROM commerce_withdrawal_payment_receipts WHERE withdrawal_id=?').bind(id).first();
  const replay=saved=>{if(saved.evidence_json!==data.evidence||saved.payment_digest!==data.digest)fail('A different payment response is already recorded',409);
    return {recorded:true,replayed:true,paymentDigest:saved.payment_digest,payoutConfirmed:false};};
  const previous=await read();if(previous)return replay(previous);
  try{
    await env.DB.prepare(`INSERT INTO commerce_withdrawal_payment_receipts(withdrawal_id,commerce_environment,credential_fingerprint,provider_reference,
      bank_reference,payment_digest,evidence_json,requested_at,observed_at,processed_at,recorded_at)
      VALUES(?,?,?,?,?,?,?,?,?,?,strftime('%Y-%m-%dT%H:%M:%fZ','now'))`)
      .bind(id,input.environment,g.credential_fingerprint,data.reference,data.bankReference,data.digest,data.evidence,data.sent,data.observed,data.processed).run();
  }catch(error){const saved=await read();if(saved)return replay(saved);if(/withdrawal_payment_|UNIQUE constraint/.test(String(error)))fail('Payment receipt conflicts with original evidence',409);throw error;}
  return {recorded:true,replayed:false,paymentDigest:data.digest,payoutConfirmed:false};
}

export async function withdrawalPaymentRecovery(env,id,input){
  fields(input,['environment']);scope(env,input.environment);const g=await grant(env,id,input.environment);
  if(!g)fail('Original payment dispatch was not found',404);
  const original=await inquiry(env,id);
  const r=await env.DB.prepare('SELECT evidence_json,payment_digest FROM commerce_withdrawal_payment_receipts WHERE withdrawal_id=?').bind(id).first();
  const diagnostic=await env.DB.prepare('SELECT stage,reason,provider_status AS providerStatus,recorded_at AS recordedAt FROM commerce_withdrawal_payment_diagnostics WHERE withdrawal_id=?').bind(id).first();
  return {binding:original.binding,clientId:g.client_id,originalInquiry:original.original,inquiryDigest:g.inquiry_digest,confirmationId:g.confirmation_id,
    requestBody:g.request_body,originalPayment:r?JSON.parse(r.evidence_json):null,paymentDigest:r?.payment_digest||null,diagnostic,
    feeAccount:await feeAccount(env,g.platform_enrollment_id),mayPay:false,payoutConfirmed:false};
}

export async function recordWithdrawalPaymentDiagnostic(env,id,input){
  fields(input,['environment','stage','reason','providerStatus']);scope(env,input.environment);
  if(!['provider_payment','persist_receipt','verify_receipt'].includes(input.stage)||typeof input.reason!=='string'||!/^[a-z0-9_]{1,64}$/.test(input.reason)
    ||!Number.isInteger(input.providerStatus)||(input.providerStatus!==0&&(input.providerStatus<100||input.providerStatus>599)))fail('Payment diagnostic is invalid');
  if(!await grant(env,id,input.environment))fail('Original payment dispatch was not found',404);
  await env.DB.prepare(`INSERT INTO commerce_withdrawal_payment_diagnostics(withdrawal_id,stage,reason,provider_status,recorded_at)
    SELECT ?,?,?,?,strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE NOT EXISTS(SELECT 1 FROM commerce_withdrawal_payment_diagnostics WHERE withdrawal_id=?)`)
    .bind(id,input.stage,input.reason,input.providerStatus,id).run();
  return {recorded:true,mayPay:false,payoutConfirmed:false};
}
