import {commerceEnvironment,commerceHash} from './commerce-orders.js';
import {parseMessageJSON} from './message-json.js';
import {parseFinancialEvidenceJSON,FinancialJsonNumber} from './financial-evidence-json.js';

const fail=(message,status=422)=>{throw new Response(message,{status});};
const fields=(input,keys)=>{if(!input||typeof input!=='object'||Array.isArray(input)||Object.keys(input).some(k=>!keys.includes(k)))fail('Payment routing parameters are invalid');};
const id=value=>typeof value==='string'&&/^[A-Za-z0-9][A-Za-z0-9_-]{2,95}$/.test(value);
const decode=raw=>{try{if(typeof raw!=='string'||new TextEncoder().encode(raw).length>16000)throw Error();const v=parseMessageJSON(raw);if(!v||typeof v!=='object'||Array.isArray(v))throw Error();return v;}catch{fail('Payment routing evidence is invalid');}};
const timestamp=value=>{
  if(typeof value!=='string'||!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/.test(value)||!Number.isFinite(Date.parse(value))||new Date(value).toISOString().replace('.000Z','Z')!==value)fail('Routing evidence timestamp is invalid');
  return Date.parse(value);
};

export function splitRulePayload(binding){
  return {transactionType:'PAYMENT',rules:[{type:'FLAT',value:binding.platformAmount,currency:'IDR',accountNumber:Number(binding.platformCashAccount)}]};
}

export async function paymentRoute(env,orderId,environment){
  commerceEnvironment(env,environment);
  const row=await env.DB.prepare(`SELECT b.binding_json,b.client_id,r.split_rule_id FROM commerce_payment_route_bindings b
    LEFT JOIN commerce_payment_route_receipts r ON r.order_id=b.order_id WHERE b.order_id=? AND b.commerce_environment=?`).bind(orderId,environment).first();
  return row?{binding:JSON.parse(row.binding_json),clientId:row.client_id,routing:row.split_rule_id?{profileId:JSON.parse(row.binding_json).sellerProfileId,splitRuleId:row.split_rule_id}:null}:null;
}

export async function bindPaymentRoute(env,orderId,input){
  fields(input,['environment','workerId','leaseToken','credentialFingerprint','clientId']);commerceEnvironment(env,input.environment);
  if(!id(input.workerId)||!id(input.leaseToken)||typeof input.credentialFingerprint!=='string'||!/^[a-f0-9]{64}$/.test(input.credentialFingerprint)
    ||typeof input.clientId!=='string'||!/^[A-Za-z0-9_-]{3,128}$/.test(input.clientId))fail('Payment routing identity is invalid');
  const row=await env.DB.prepare(`SELECT o.*,j.id AS job_id,j.attempts,j.lease_owner,j.lease_token,j.lease_mode,j.lease_until,j.state AS job_state,
    json_extract(j.payload_json,'$.providerRequestId') AS payment_request_id FROM orders o JOIN commerce_jobs j ON j.order_id=o.id AND j.kind='payment.create'
    WHERE o.id=? AND o.commerce_environment=? AND o.commerce_version=1 AND json_extract(o.snapshot_json,'$.checkout.paymentFlow')='snap_bca'`).bind(orderId,input.environment).first();
  if(!row)fail('SNAP payment not found',404);
  const now=new Date().toISOString();
  if(row.job_state!=='running'||row.lease_owner!==input.workerId||row.lease_token!==input.leaseToken||row.lease_until<=now)fail('This worker cannot prepare payment routing',409);
  const existing=await paymentRoute(env,orderId,input.environment);
  if(existing){
    if(existing.binding.credentialFingerprint!==input.credentialFingerprint||existing.clientId!==input.clientId)fail('Original routing credentials cannot change',409);
    return {mayCreateRule:false,...existing};
  }
  if(row.lease_mode!=='execute'||row.checkout_state!=='creating'||row.expires_at<=now)fail('This payment cannot start routing',409);
  if(!id(env.COMMERCE_PLATFORM_WALLET_SELLER)||env.COMMERCE_PLATFORM_WALLET_SELLER===row.seller_id)fail('The platform fee destination is not configured',503);
  const wallets=await env.DB.prepare(`SELECT e.id,e.seller_id,p.profile_id,p.cash_account,b.credential_fingerprint,b.client_id,b.parent_profile_id
    FROM commerce_wallet_enrollments e JOIN commerce_wallet_provider_profiles p ON p.enrollment_id=e.id
    JOIN commerce_wallet_provider_bindings b ON b.enrollment_id=e.id JOIN sellers s ON s.id=e.seller_id AND s.status='active'
    WHERE e.commerce_environment=? AND e.seller_id IN (?,?)`).bind(input.environment,row.seller_id,env.COMMERCE_PLATFORM_WALLET_SELLER).all();
  const seller=wallets.results.find(w=>w.seller_id===row.seller_id),platform=wallets.results.find(w=>w.seller_id===env.COMMERCE_PLATFORM_WALLET_SELLER);
  if(!seller||!platform)fail('Confirmed seller and platform wallets are required before payment',409);
  if(wallets.results.length!==2||wallets.results.some(w=>w.credential_fingerprint!==input.credentialFingerprint||w.client_id!==input.clientId)
    ||seller.parent_profile_id!==platform.parent_profile_id||seller.cash_account===platform.cash_account
    ||!/^SAC-[A-Za-z0-9_-]{1,18}$/.test(seller.profile_id)||!/^[1-9][0-9]{0,9}$/.test(platform.cash_account))fail('Payment destinations do not match the original provider accounts',409);
  const fees=JSON.parse(row.snapshot_json).fees;
  if(!fees||fees.version!==1||!['standard','advanced'].includes(fees.plan)||fees.commissionBasisPoints!==(fees.plan==='advanced'?600:500)
    ||!Number.isSafeInteger(fees.commissionAmount)||fees.commissionAmount!==Number((BigInt(row.subtotal_amount)*BigInt(fees.commissionBasisPoints)+5000n)/10000n)
    ||fees.adminAmount!==1250||fees.processingFeePolicy!=='actual_provider_fee'||fees.withdrawalMinimum!==250000||fees.sellerWithdrawalFee!==0)fail('Original fee policy requires review',409);
  const platformAmount=row.shipping_amount+fees.commissionAmount+fees.adminAmount;
  if(!Number.isSafeInteger(platformAmount)||platformAmount<1)fail('Original fee allocation is invalid',409);
  const externalId=BigInt('0x'+(await commerceHash('split-rule:'+orderId)).slice(0,26)).toString().padStart(32,'0');
  const binding={environment:input.environment,credentialFingerprint:input.credentialFingerprint,externalId,orderId,
    sellerProfileId:seller.profile_id,platformCashAccount:platform.cash_account,grossAmount:row.total_amount,platformAmount};
  try{await env.DB.prepare(`INSERT INTO commerce_payment_route_bindings(order_id,seller_id,commerce_environment,job_id,attempt_id,seller_enrollment_id,
    platform_enrollment_id,credential_fingerprint,client_id,external_id,binding_json,created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)`)
    .bind(orderId,row.seller_id,input.environment,row.job_id,row.job_id+':'+row.attempts,seller.id,platform.id,input.credentialFingerprint,input.clientId,externalId,JSON.stringify(binding),now).run();}
  catch(error){if(/payment_route_|UNIQUE constraint/.test(String(error)))fail('Routing dispatch changed. Reconcile the original request.',409);throw error;}
  return {mayCreateRule:true,binding,clientId:input.clientId,routing:null};
}

export async function recordPaymentRoute(env,orderId,input){
  fields(input,['environment','evidence']);commerceEnvironment(env,input.environment);
  const route=await paymentRoute(env,orderId,input.environment);if(!route)fail('Original routing dispatch is not recorded',409);
  const e=input.evidence,b=route.binding;
  fields(e,['environment','credentialFingerprint','operation','externalId','requestedAt','observedAt','requestBody','responseBody']);
  if(e.environment!==input.environment||e.credentialFingerprint!==b.credentialFingerprint||e.operation!=='split-rules'||e.externalId!==b.externalId)fail('Routing receipt does not match its dispatch',409);
  const sent=timestamp(e.requestedAt),observed=timestamp(e.observedAt);
  if(sent>Date.now()+300000||observed>Date.now()+300000||observed<sent)fail('Routing evidence time is invalid');
  const request=decode(e.requestBody),response=decode(e.responseBody),expected=splitRulePayload(b);
  for(const original of [e.requestBody,e.responseBody]){
    let raw;try{raw=parseFinancialEvidenceJSON(original);}catch{fail('Payment routing evidence is invalid');}
    const rule=Array.isArray(raw.rules)&&raw.rules.length===1?raw.rules[0]:null;
    if(!rule||!(rule.value instanceof FinancialJsonNumber)||!/^(0|[1-9][0-9]*)(?:\.0{1,2})?$/.test(rule.value.value)
      ||rule.value.value.split('.')[0]!==String(b.platformAmount)||!(rule.accountNumber instanceof FinancialJsonNumber)
      ||rule.accountNumber.value!==b.platformCashAccount)fail('Routing evidence does not preserve the original exact allocation',409);
  }
  if(await commerceHash(request)!==await commerceHash(expected)||response.transactionType!=='PAYMENT'
    ||typeof response.responseCode!=='string'||!/^200[0-9]{4}$/.test(response.responseCode)
    ||typeof response.splitRuleId!=='string'||!/^[A-Za-z0-9][A-Za-z0-9_-]{0,35}$/.test(response.splitRuleId)
    ||await commerceHash(response.rules)!==await commerceHash(expected.rules))fail('DOKU did not confirm the original flat allocation',409);
  const evidenceHash=await commerceHash(e),stored=await env.DB.prepare('SELECT evidence_hash FROM commerce_payment_route_receipts WHERE order_id=?').bind(orderId).first();
  if(stored){if(stored.evidence_hash!==evidenceHash)fail('Original split-rule evidence cannot change',409);return {recorded:true,replayed:true,routing:route.routing};}
  let written;
  try{written=await env.DB.prepare(`INSERT INTO commerce_payment_route_receipts(order_id,credential_fingerprint,split_rule_id,evidence_hash,evidence_json,received_at)
    SELECT ?,?,?,?,?,? WHERE NOT EXISTS(SELECT 1 FROM commerce_payment_route_receipts WHERE order_id=?)`)
    .bind(orderId,b.credentialFingerprint,response.splitRuleId,evidenceHash,JSON.stringify(e),new Date().toISOString(),orderId).run();}
  catch(error){if(/payment_route_|UNIQUE constraint/.test(String(error)))fail('Split-rule evidence conflicts with the original routing',409);throw error;}
  const saved=await env.DB.prepare('SELECT evidence_hash FROM commerce_payment_route_receipts WHERE order_id=?').bind(orderId).first();
  if(saved?.evidence_hash!==evidenceHash)fail('Split-rule evidence conflicts with the original routing',409);
  return {recorded:true,replayed:written.meta.changes===0,routing:{profileId:b.sellerProfileId,splitRuleId:response.splitRuleId}};
}
