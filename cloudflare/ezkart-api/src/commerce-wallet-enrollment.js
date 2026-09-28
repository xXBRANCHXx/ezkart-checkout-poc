import {requireSellerOnboarding,onboardingFailure} from './seller-onboarding.js';
import {commerceEnvironment,commerceHash} from './commerce-orders.js';
import {parseFinancialEvidenceJSON,FinancialJsonNumber} from './financial-evidence-json.js';

const fail=(message,status=422)=>{throw new Response(message,{status});};
const id=value=>typeof value==='string'&&/^[A-Za-z0-9][A-Za-z0-9_-]{2,95}$/.test(value);
const fields=(value,allowed)=>{if(!value||typeof value!=='object'||Array.isArray(value)||Object.keys(value).some(key=>!allowed.includes(key)))fail('Wallet parameters are invalid');};
const walletRowSQL=`SELECT e.*,j.state AS job_state,j.attempts,j.last_error,j.lease_owner,j.lease_token,j.lease_until,j.lease_mode,
  b.credential_fingerprint,b.client_id,b.parent_profile_id,b.attempt_id,p.profile_id,p.cash_account,p.pending_account,p.recorded_at,r.registration_json
  FROM commerce_wallet_enrollments e JOIN commerce_jobs j ON j.id=e.job_id
  LEFT JOIN commerce_wallet_provider_bindings b ON b.enrollment_id=e.id LEFT JOIN commerce_wallet_provider_profiles p ON p.enrollment_id=e.id
  LEFT JOIN commerce_wallet_registration_receipts r ON r.enrollment_id=e.id`;
async function rowById(env,enrollmentId,environment){
  if(!/^wallet_[a-f0-9]{40}$/.test(enrollmentId))fail('Wallet setup not found',404);
  const row=await env.DB.prepare(walletRowSQL+' WHERE e.id=? AND e.commerce_environment=?').bind(enrollmentId,environment).first();
  if(!row)fail('Wallet setup not found',404);return row;
}
const view=row=>row?{id:row.id,environment:row.commerce_environment,status:row.profile_id?'connected':(['uncertain','dead'].includes(row.job_state)?'review':row.job_state==='running'?'connecting':'queued'),
  accountName:row.account_name,email:row.owner_email,createdAt:row.created_at,connectedAt:row.recorded_at||null,attempts:row.attempts,
  providerAccountSuffix:row.cash_account?row.cash_account.slice(-4):null}:null;

export async function walletOwner(env,input){
  commerceEnvironment(env,input.environment);fields(input.actor,['id','email','proofExpiresAt']);
  if(!id(input.seller)||!id(input.actor.id)||typeof input.actor.email!=='string'||input.actor.email.length>160||!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(input.actor.email))fail('Verified wallet identity is invalid');
  const expiry=Date.parse(input.actor.proofExpiresAt),now=Date.now();
  if(!Number.isFinite(expiry)||new Date(expiry).toISOString()!==input.actor.proofExpiresAt||expiry<=now||expiry>now+630000)fail('Unlock Wallet again before continuing',401);
  const seller=await env.DB.prepare(`SELECT s.id,s.name FROM sellers s JOIN seller_memberships m ON m.seller_id=s.id
    WHERE s.id=? AND s.status='active' AND m.auth_user_id=? AND m.role='owner'`).bind(input.seller,input.actor.id).first();
  if(!seller)fail('Only the current store owner can manage this wallet',403);return seller;
}

export async function walletEnrollment(env,input){
  fields(input,['environment','seller','actor','action','requestKey']);const seller=await walletOwner(env,input);
  if(!['read','enroll'].includes(input.action)||input.action==='read'&&input.requestKey!==undefined)fail('Wallet action is invalid');
  const read=()=>env.DB.prepare(walletRowSQL+' WHERE e.seller_id=? AND e.commerce_environment=?').bind(input.seller,input.environment).first();
  const current=await read();
  if(input.action==='read')return {enrollment:view(current),owner:{storeName:seller.name,email:input.actor.email.toLowerCase()},availableToWithdraw:null};
  if(typeof input.requestKey!=='string'||!/^[a-f0-9]{32}$/.test(input.requestKey))fail('Wallet request reference is invalid');
  if(current){if(current.request_key!==input.requestKey||current.owner_auth_id!==input.actor.id)fail('Wallet setup already exists. Refresh its current status.',409);return {enrollment:view(current),replayed:true};}
  await requireSellerOnboarding(env,input.seller,input.environment);
  const email=input.actor.email.toLowerCase();
  if(email.length>25||!/^\S+@\S+\.\S+$/.test(email))fail('This verified email is longer than the wallet provider supports. Contact support before setup.');
  if(!seller.name.trim()||[...seller.name].length>128||/[\x00-\x1f\x7f]/.test(seller.name))fail('Save a valid store name before connecting Wallet.');
  const suffix=(await commerceHash({seller:input.seller,environment:input.environment})).slice(0,40),enrollmentId='wallet_'+suffix;
  const jobId='job_'+suffix.slice(0,32),partnerReference='EZK-W-'+(input.environment==='sandbox'?'S':'P')+'-'+suffix,now=new Date().toISOString();
  try{
    await env.DB.batch([
      env.DB.prepare(`INSERT INTO commerce_jobs(id,seller_id,commerce_environment,job_key,kind,payload_json,available_at,created_at,updated_at)
        VALUES(?,?,?,'wallet.register','wallet.register',?,?,?,?) ON CONFLICT(seller_id,commerce_environment,job_key) DO NOTHING`)
        .bind(jobId,input.seller,input.environment,JSON.stringify({enrollmentId,partnerReferenceNo:partnerReference}),now,now,now),
      env.DB.prepare(`INSERT INTO commerce_wallet_enrollments(id,seller_id,commerce_environment,request_key,owner_auth_id,owner_email,account_name,partner_reference,job_id,proof_expires_at,created_at)
        VALUES(?,?,?,?,?,?,?,?,?,?,?)`).bind(enrollmentId,input.seller,input.environment,input.requestKey,input.actor.id,email,seller.name,partnerReference,jobId,input.actor.proofExpiresAt,now),
    ]);
  }catch(error){
    const saved=await read();
    if(saved&&saved.request_key===input.requestKey&&saved.owner_auth_id===input.actor.id)return {enrollment:view(saved),replayed:true};
    if(saved)fail('Wallet setup already exists. Refresh its current status.',409);
    if(/wallet_owner_changed|wallet_proof_expired/.test(String(error)))fail('Your wallet authorization changed. Unlock Wallet again.',409);
    onboardingFailure(error);
  }
  return {enrollment:view(await read()),replayed:false};
}

export async function walletRegistration(env,enrollmentId,environment){
  commerceEnvironment(env,environment);const row=await rowById(env,enrollmentId,environment);
  const authorized=await env.DB.prepare(`SELECT 1 AS ok FROM seller_memberships m JOIN sellers s ON s.id=m.seller_id
    WHERE s.id=? AND s.status='active' AND m.auth_user_id=? AND m.role='owner'`).bind(row.seller_id,row.owner_auth_id).first();
  return {id:row.id,seller:row.seller_id,environment:row.commerce_environment,jobId:row.job_id,jobState:row.job_state,ownerStillAuthorized:!!authorized,
    request:{partnerReferenceNo:row.partner_reference,type:'DEFAULT',name:row.account_name,email:row.owner_email,countryCode:'ID'},
    binding:row.credential_fingerprint?{credentialFingerprint:row.credential_fingerprint,clientId:row.client_id,parentProfileId:row.parent_profile_id,attemptId:row.attempt_id}:null,
    registrationBody:row.registration_json||null,
    profile:row.profile_id?{profileId:row.profile_id,cashAccount:row.cash_account,pendingAccount:row.pending_account}:null};
}

export async function bindWalletRegistration(env,enrollmentId,input){
  fields(input,['environment','workerId','leaseToken','credentialFingerprint','clientId','parentProfileId']);commerceEnvironment(env,input.environment);
  if(!id(input.workerId)||!id(input.leaseToken)||typeof input.credentialFingerprint!=='string'||!/^[a-f0-9]{64}$/.test(input.credentialFingerprint)
    ||typeof input.clientId!=='string'||!/^[A-Za-z0-9_-]{3,128}$/.test(input.clientId)||typeof input.parentProfileId!=='string'||!/^[A-Za-z0-9][A-Za-z0-9_-]{1,21}$/.test(input.parentProfileId))fail('Wallet provider identity is invalid');
  const row=await rowById(env,enrollmentId,input.environment);
  if(row.lease_owner!==input.workerId||row.lease_token!==input.leaseToken||row.job_state!=='running'||row.lease_mode!=='execute'||row.lease_until<=new Date().toISOString())fail('This worker cannot start wallet registration',409);
  if(row.credential_fingerprint){
    if(row.credential_fingerprint!==input.credentialFingerprint||row.client_id!==input.clientId||row.parent_profile_id!==input.parentProfileId)fail('Wallet provider credentials changed. Review the original registration.',409);
    // A saved binding means the write may already have left the server. A new
    // lease must reconcile it; it may not issue another register request.
    if(row.attempt_id!==row.job_id+':'+row.attempts)fail('Wallet registration may already have started. Reconcile the original request.',409);
    return {bound:true,mayRegister:false};
  }
  try{await env.DB.prepare(`INSERT INTO commerce_wallet_provider_bindings(enrollment_id,credential_fingerprint,client_id,parent_profile_id,attempt_id,created_at) VALUES(?,?,?,?,?,?)`)
    .bind(enrollmentId,input.credentialFingerprint,input.clientId,input.parentProfileId,row.job_id+':'+row.attempts,new Date().toISOString()).run();}
  catch(error){if(/wallet_binding_(immutable|lease_mismatch)/.test(String(error)))fail('Wallet registration changed. Reconcile the original request.',409);throw error;}
  return {bound:true,mayRegister:true};
}

// Preserve original numeric account tokens as well as rejecting duplicate keys.
// No floating-point conversion may turn an exponent/fraction into an account ID.
function evidence(raw){
  if(typeof raw!=='string'||raw.length>16000)fail('Wallet provider evidence is invalid');
  try{const parsed=parseFinancialEvidenceJSON(raw);if(!parsed||typeof parsed!=='object'||Array.isArray(parsed)||parsed instanceof FinancialJsonNumber)throw Error();return parsed;}
  catch{fail('Wallet provider evidence is invalid or ambiguous');}
}
function providerAccounts(response){
  if(typeof response.responseCode!=='string'||!/^200[0-9]{4}$/.test(response.responseCode)||!Array.isArray(response.accounts)||response.accounts.length>10)fail('Wallet provider accounts are invalid');
  const ids=new Set(),accounts={};
  for(const item of response.accounts){
    const number=item?.accountNo instanceof FinancialJsonNumber?item.accountNo.value:item?.accountNo;
    if(!item||typeof item!=='object'||typeof number!=='string'||!/^[0-9]{1,10}$/.test(number)||ids.has(number))fail('Wallet provider accounts are ambiguous');
    ids.add(number);
    if(['DOKU_MERCHANT_POINT','DOKU_SYSTEM_POINT'].includes(item.type)&&item.currency==='POINT')continue;
    if(!['DOKU_MERCHANT_IDR','DOKU_MERCHANT_PENDING_IDR'].includes(item.type)||item.currency!=='IDR'||accounts[item.type])fail('Wallet provider accounts are invalid');
    accounts[item.type]=number;
  }
  if(Object.keys(accounts).length!==2)fail('Both provider IDR accounts are required');return accounts;
}
function registrationEvidence(row,body){
  const registration=evidence(body);providerAccounts(registration);
  if(registration.accounts.length>3||registration.accounts.some(account=>account.type==='DOKU_SYSTEM_POINT'))fail('Wallet registration accounts are invalid');
  if(typeof registration.profileId!=='string'||!/^[A-Za-z0-9][A-Za-z0-9_-]{1,21}$/.test(registration.profileId)
    ||registration.parentProfileId!==row.parent_profile_id||registration.profileId===row.parent_profile_id)fail('Wallet registration does not match its provider parent');
  return registration;
}
export async function saveWalletRegistrationReceipt(env,enrollmentId,input){
  fields(input,['environment','credentialFingerprint','registrationBody']);commerceEnvironment(env,input.environment);
  const row=await rowById(env,enrollmentId,input.environment);
  if(!row.credential_fingerprint||row.credential_fingerprint!==input.credentialFingerprint)fail('Wallet evidence does not match its original provider credentials',409);
  registrationEvidence(row,input.registrationBody);
  if(row.registration_json){if(row.registration_json!==input.registrationBody)fail('A different registration response is already recorded. Review the original request.',409);return {recorded:true,replayed:true};}
  try{await env.DB.prepare('INSERT INTO commerce_wallet_registration_receipts(enrollment_id,registration_json,received_at) VALUES(?,?,?)')
    .bind(enrollmentId,input.registrationBody,new Date().toISOString()).run();}
  catch(error){const saved=await rowById(env,enrollmentId,input.environment);if(saved.registration_json===input.registrationBody)return {recorded:true,replayed:true};
    if(saved.registration_json)fail('A different registration response is already recorded. Review the original request.',409);throw error;}
  return {recorded:true,replayed:false};
}
export async function recordWalletRegistration(env,enrollmentId,input){
  fields(input,['environment','credentialFingerprint','confirmationBody']);commerceEnvironment(env,input.environment);
  const row=await rowById(env,enrollmentId,input.environment);
  if(!row.credential_fingerprint||row.credential_fingerprint!==input.credentialFingerprint)fail('Wallet evidence does not match its original provider credentials',409);
  if(!row.registration_json)fail('Record the original registration response before confirming its accounts',409);
  const registration=registrationEvidence(row,row.registration_json),confirmation=evidence(input.confirmationBody),accounts=providerAccounts(registration),confirmed=providerAccounts(confirmation);
  if(registration.profileId!==confirmation.profileId
    ||Object.entries(accounts).some(([type,number])=>confirmed[type]!==number))fail('Wallet registration and account confirmation disagree');
  if(row.profile_id){
    if(row.profile_id!==registration.profileId||row.cash_account!==accounts.DOKU_MERCHANT_IDR||row.pending_account!==accounts.DOKU_MERCHANT_PENDING_IDR)fail('This wallet already has a different provider account',409);
    return {recorded:true,replayed:true};
  }
  try{await env.DB.prepare(`INSERT INTO commerce_wallet_provider_profiles(enrollment_id,commerce_environment,profile_id,cash_account,pending_account,registration_json,confirmation_json,recorded_at)
    VALUES(?,?,?,?,?,?,?,?)`).bind(enrollmentId,input.environment,registration.profileId,accounts.DOKU_MERCHANT_IDR,accounts.DOKU_MERCHANT_PENDING_IDR,row.registration_json,input.confirmationBody,new Date().toISOString()).run();}
  catch(error){
    const saved=await rowById(env,enrollmentId,input.environment);
    if(saved.profile_id===registration.profileId&&saved.cash_account===accounts.DOKU_MERCHANT_IDR&&saved.pending_account===accounts.DOKU_MERCHANT_PENDING_IDR)return {recorded:true,replayed:true};
    if(/wallet_(profile|account)_immutable|UNIQUE constraint/.test(String(error)))fail('A provider account is already linked. Review the existing wallet.',409);throw error;
  }
  return {recorded:true,replayed:false};
}
