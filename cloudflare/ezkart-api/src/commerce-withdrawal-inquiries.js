import {commerceEnvironment,commerceHash} from './commerce-orders.js';
import {authorizeWithdrawalOwner,withdrawalFailure} from './commerce-withdrawals.js';
import {parseFinancialEvidenceJSON,FinancialJsonNumber} from './financial-evidence-json.js';

export {ownerWithdrawal as withdrawalInquiryOwner,validateReceipt as validateWithdrawalInquiryReceipt,date as withdrawalEvidenceDate,
  text as withdrawalEvidenceText,phpJSON as withdrawalEvidenceJSON,sha as withdrawalEvidenceHash};

const fail=(message,status=422)=>{throw new Response(message,{status});};
const fields=(input,allowed)=>{if(!input||typeof input!=='object'||Array.isArray(input)||Object.keys(input).some(k=>!allowed.includes(k)))fail('Bank inquiry parameters are invalid');};
const ownerFields=['environment','seller','actor'];
const evidenceFields=['environment','credentialFingerprint','operation','externalId','requestedAt','observedAt','requestBody','responseBody'];
function scope(env,environment){commerceEnvironment(env,environment);if(!['test','beta'].includes(env.APP_ENVIRONMENT))fail('Withdrawals are not enabled on this deployment',503);}
async function ownerWithdrawal(env,id,input){
  await authorizeWithdrawalOwner(env,input);
  const row=await env.DB.prepare('SELECT * FROM commerce_withdrawals WHERE id=? AND seller_id=? AND commerce_environment=?').bind(id,input.seller,input.environment).first();
  if(!row)fail('Withdrawal was not found',404);
  if(row.owner_auth_id!==input.actor.id)fail('This request belongs to a previous owner. Review or cancel it before starting another.',409);
  return row;
}
const grant=async(env,id,environment)=>env.DB.prepare(`SELECT g.* FROM commerce_withdrawal_inquiry_grants g
  WHERE g.withdrawal_id=? AND g.commerce_environment=?`).bind(id,environment).first();
const sha=async value=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(value))),n=>n.toString(16).padStart(2,'0')).join('');
// Match PHP JSON_UNESCAPED_UNICODE without JSON_UNESCAPED_LINE_TERMINATORS.
const phpJSON=value=>JSON.stringify(value).replace(/\u2028/g,'\\u2028').replace(/\u2029/g,'\\u2029');
const payload=b=>({partnerReferenceNo:b.partnerReferenceNo,type:'BANK_ACCOUNT',channel:b.channel,amount:{value:b.amount+'.00',currency:'IDR'},
  fromAccount:b.fromAccount,beneficiaryBankCode:b.beneficiaryBankCode,beneficiaryAccountNumber:b.beneficiaryAccountNumber});

export async function startWithdrawalInquiry(env,id,input){
  fields(input,[...ownerFields,'credentialFingerprint','clientId']);scope(env,input.environment);
  if(env.COMMERCE_WITHDRAWAL_INQUIRY!=='enabled')fail('Bank inquiry dispatch is not enabled',503);
  const row=await ownerWithdrawal(env,id,input);
  if(typeof input.credentialFingerprint!=='string'||!/^[a-f0-9]{64}$/.test(input.credentialFingerprint)
    ||typeof input.clientId!=='string'||!/^[A-Za-z0-9_-]{3,128}$/.test(input.clientId))fail('Bank inquiry provider identity is invalid');
  const replay=saved=>{if(saved.credential_fingerprint!==input.credentialFingerprint||saved.client_id!==input.clientId)fail('The original bank inquiry credentials cannot change',409);
    return {mayInquire:false,binding:JSON.parse(saved.binding_json)};};
  const original=await grant(env,id,input.environment);if(original)return replay(original);
  const wallet=await env.DB.prepare(`SELECT p.cash_account,b.credential_fingerprint,b.client_id FROM commerce_wallet_provider_profiles p
    JOIN commerce_wallet_provider_bindings b ON b.enrollment_id=p.enrollment_id WHERE p.enrollment_id=?`).bind(row.enrollment_id).first();
  if(!wallet||wallet.credential_fingerprint!==input.credentialFingerprint||wallet.client_id!==input.clientId)fail('Bank inquiry credentials do not match the confirmed seller account',409);
  const external=async stage=>BigInt('0x'+(await commerceHash('withdrawal-'+stage+':'+id)).slice(0,26)).toString().padStart(32,'0');
  const binding={environment:input.environment,credentialFingerprint:input.credentialFingerprint,partnerReferenceNo:row.partner_reference,
    fromAccount:wallet.cash_account,beneficiaryBankCode:row.bank_code,beneficiaryAccountNumber:row.bank_account,amount:String(row.amount),channel:row.channel,
    inquiryExternalId:await external('inquiry'),paymentExternalId:await external('payment')};
  try{
    await env.DB.prepare(`INSERT INTO commerce_withdrawal_inquiry_grants(withdrawal_id,commerce_environment,owner_auth_id,proof_expires_at,
      credential_fingerprint,client_id,inquiry_external_id,payment_external_id,binding_json,request_body,created_at)
      VALUES(?,?,?,?,?,?,?,?,?,?,strftime('%Y-%m-%dT%H:%M:%fZ','now'))`)
      .bind(id,input.environment,input.actor.id,input.actor.proofExpiresAt,input.credentialFingerprint,input.clientId,binding.inquiryExternalId,binding.paymentExternalId,
        JSON.stringify(binding),JSON.stringify(payload(binding))).run();
  }catch(error){const saved=await grant(env,id,input.environment);if(saved)return replay(saved);withdrawalFailure(error);}
  return {mayInquire:true,binding};
}

function date(value){
  if(typeof value!=='string')fail('Bank inquiry evidence time is invalid');
  const match=/^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2})(?:\.(\d{1,6}))?(Z|[+-](?:(?:0\d|1[0-3]):[0-5]\d|14:00))$/.exec(value);
  if(!match)fail('Bank inquiry evidence time is invalid');
  const local=Date.parse(match[1]+'Z'),at=Date.parse(match[1]+match[3]);
  if(!Number.isFinite(local)||!Number.isFinite(at)||new Date(local).toISOString().slice(0,19)!==match[1])fail('Bank inquiry evidence time is invalid');
  const iso=new Date(at).toISOString();if(!/^\d{4}-/.test(iso))fail('Bank inquiry evidence time is invalid');
  return iso.slice(0,19)+'.'+(match[2]||'').padEnd(6,'0')+'Z';
}
function text(value,max){
  if(typeof value!=='string'||!value.trim()||[...value].length>max||/[\x00-\x1f\x7f\uD800-\uDFFF]/u.test(value))fail('Bank inquiry evidence fields are invalid');return value;
}
async function validateReceipt(g,e){
  fields(e,evidenceFields);const b=JSON.parse(g.binding_json);
  if(Object.keys(e).length!==evidenceFields.length||e.environment!==g.commerce_environment||e.credentialFingerprint!==g.credential_fingerprint
    ||e.operation!=='transfer-inquiry'||e.externalId!==g.inquiry_external_id||e.requestBody!==g.request_body
    ||typeof e.responseBody!=='string'||new TextEncoder().encode(e.responseBody).length>16000)fail('Bank inquiry receipt does not match its original dispatch',409);
  const sent=date(e.requestedAt),observed=date(e.observedAt);
  if(sent>observed||Date.parse(sent)<Date.parse(g.created_at)-300000||Date.parse(observed)>Date.now()+300000)fail('Bank inquiry evidence time is invalid');
  let r;try{r=parseFinancialEvidenceJSON(e.responseBody);}catch{fail('Bank inquiry JSON is invalid or ambiguous');}
  if(!r||typeof r!=='object'||Array.isArray(r)||typeof r.responseCode!=='string'||!/^200[0-9]{4}$/.test(r.responseCode))fail('Bank inquiry was not confirmed');
  const original=payload(b);
  for(const k of ['partnerReferenceNo','type','channel','beneficiaryBankCode','beneficiaryAccountNumber'])if(r[k]!==original[k])fail('Bank inquiry response does not match the original destination',409);
  const account=r.fromAccount instanceof FinancialJsonNumber?r.fromAccount.value:r.fromAccount;
  if(account!==b.fromAccount||r.amount?.value!==b.amount+'.00'||r.amount?.currency!=='IDR')fail('Bank inquiry response does not match the original amount or seller account',409);
  const name=text(r.beneficiaryAccountName,256),reference=text(r.referenceNo,64);
  const digest=await sha('ezkart.doku.bank-inquiry.v1\n'+phpJSON([...evidenceFields.map(k=>e[k]),b.paymentExternalId]));
  return {name,reference,digest,sent,observed,evidence:JSON.stringify(Object.fromEntries(evidenceFields.map(k=>[k,e[k]])))};
}

export async function saveWithdrawalInquiryReceipt(env,id,input){
  fields(input,['environment','evidence']);scope(env,input.environment);
  const g=await grant(env,id,input.environment);if(!g)fail('Original bank inquiry dispatch was not found',404);
  const data=await validateReceipt(g,input.evidence);
  const read=()=>env.DB.prepare('SELECT * FROM commerce_withdrawal_inquiry_receipts WHERE withdrawal_id=?').bind(id).first();
  const replay=saved=>{if(saved.inquiry_digest!==data.digest||saved.evidence_json!==data.evidence)fail('A different bank inquiry receipt is already recorded',409);
    return {recorded:true,replayed:true,inquiryDigest:saved.inquiry_digest,payoutConfirmed:false};};
  const prior=await read();if(prior)return replay(prior);
  try{
    await env.DB.prepare(`INSERT INTO commerce_withdrawal_inquiry_receipts(withdrawal_id,commerce_environment,credential_fingerprint,
      provider_reference,beneficiary_name,inquiry_digest,evidence_json,requested_at,observed_at,recorded_at)
      VALUES(?,?,?,?,?,?,?,?,?,strftime('%Y-%m-%dT%H:%M:%fZ','now'))`)
      .bind(id,input.environment,g.credential_fingerprint,data.reference,data.name,data.digest,data.evidence,data.sent,data.observed).run();
  }catch(error){const saved=await read();if(saved)return replay(saved);if(/withdrawal_inquiry_|UNIQUE constraint/.test(String(error)))fail('Bank inquiry receipt conflicts with original evidence',409);throw error;}
  return {recorded:true,replayed:false,inquiryDigest:data.digest,payoutConfirmed:false};
}

export async function withdrawalInquiryRecovery(env,id,input){
  fields(input,['environment']);scope(env,input.environment);const g=await grant(env,id,input.environment);
  if(!g)fail('Original bank inquiry dispatch was not found',404);
  const r=await env.DB.prepare('SELECT evidence_json,inquiry_digest FROM commerce_withdrawal_inquiry_receipts WHERE withdrawal_id=?').bind(id).first();
  const diagnostic=await env.DB.prepare('SELECT stage,reason,provider_status AS providerStatus,recorded_at AS recordedAt FROM commerce_withdrawal_inquiry_diagnostics WHERE withdrawal_id=?').bind(id).first();
  return {binding:JSON.parse(g.binding_json),originalEvidence:r?JSON.parse(r.evidence_json):null,inquiryDigest:r?.inquiry_digest||null,diagnostic,mayInquire:false,payoutConfirmed:false};
}

export async function recordWithdrawalInquiryDiagnostic(env,id,input){
  fields(input,['environment','stage','reason','providerStatus']);scope(env,input.environment);
  if(!['provider_inquiry','persist_receipt','verify_receipt'].includes(input.stage)||typeof input.reason!=='string'||!/^[a-z0-9_]{1,64}$/.test(input.reason)
    ||!Number.isInteger(input.providerStatus)||(input.providerStatus!==0&&(input.providerStatus<100||input.providerStatus>599)))fail('Bank inquiry diagnostic is invalid');
  if(!await grant(env,id,input.environment))fail('Original bank inquiry dispatch was not found',404);
  await env.DB.prepare(`INSERT INTO commerce_withdrawal_inquiry_diagnostics(withdrawal_id,stage,reason,provider_status,recorded_at)
    SELECT ?,?,?,?,strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE NOT EXISTS(SELECT 1 FROM commerce_withdrawal_inquiry_diagnostics WHERE withdrawal_id=?)`)
    .bind(id,input.stage,input.reason,input.providerStatus,id).run();
  return {recorded:true,payoutConfirmed:false};
}

export async function confirmWithdrawalBank(env,id,input){
  fields(input,[...ownerFields,'requestKey','inquiryDigest']);await ownerWithdrawal(env,id,input);
  if(typeof input.requestKey!=='string'||!/^[a-f0-9]{32}$/.test(input.requestKey)||typeof input.inquiryDigest!=='string'||!/^[a-f0-9]{64}$/.test(input.inquiryDigest))fail('Bank confirmation reference is invalid');
  const read=()=>env.DB.prepare('SELECT * FROM commerce_withdrawal_confirmations WHERE withdrawal_id=? AND request_key=?').bind(id,input.requestKey).first();
  const result=(row,replayed)=>{if(row.inquiry_digest!==input.inquiryDigest||row.owner_auth_id!==input.actor.id)fail('This confirmation reference already has different details',409);
    return {confirmation:{id:row.id,inquiryDigest:row.inquiry_digest,confirmedAt:row.created_at,proofExpiresAt:row.proof_expires_at},replayed,payoutConfirmed:false};};
  const prior=await read();if(prior)return result(prior,true);
  const confirmationId='wdconf_'+(await commerceHash({withdrawalId:id,requestKey:input.requestKey})).slice(0,40);
  try{
    await env.DB.prepare(`INSERT INTO commerce_withdrawal_confirmations(id,withdrawal_id,request_key,owner_auth_id,proof_expires_at,inquiry_digest,funds_json,created_at)
      SELECT ?,?,?,?,?,?,f.source_json,strftime('%Y-%m-%dT%H:%M:%fZ','now') FROM commerce_withdrawal_funds f WHERE f.seller_id=? AND f.commerce_environment=?`)
      .bind(confirmationId,id,input.requestKey,input.actor.id,input.actor.proofExpiresAt,input.inquiryDigest,input.seller,input.environment).run();
  }catch(error){const saved=await read();if(saved)return result(saved,true);if(/withdrawal_confirmation_mismatch/.test(String(error)))fail('Confirm the original bank inquiry before continuing',409);withdrawalFailure(error);}
  const saved=await read();if(!saved)fail('Bank confirmation could not be saved',409);return result(saved,false);
}
