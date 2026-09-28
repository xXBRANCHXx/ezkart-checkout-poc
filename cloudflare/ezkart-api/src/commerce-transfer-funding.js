import {commerceHash} from './commerce-orders.js';
import {currentCommerceEnvironment as mode} from './commerce-access.js';
const fail=(m,s=503)=>{throw new Response(m,{status:s});};
const keys=(x,allowed)=>x&&typeof x==='object'&&!Array.isArray(x)&&Object.keys(x).every(k=>allowed.includes(k));
// This is server-owned merchant-contract configuration, never provider evidence
// supplied by a seller or a fee guessed from the transfer request schema.
export async function transferFeeContract(env){
 let c;try{c=JSON.parse(env.COMMERCE_TRANSFER_FEE_CONTRACT||'null');}catch{fail('The transfer fee contract configuration is invalid.');}
 if(!keys(c,['version','environment','credentialFingerprint','clientId','platformSeller','chargedCashAccount','sellerFeeBilling','channels','evidenceReference','evidenceDigest','validFrom','validUntil'])
  ||c.version!==1||c.environment!==mode(env)||c.platformSeller!==env.COMMERCE_PLATFORM_WALLET_SELLER
  ||typeof c.platformSeller!=='string'||typeof c.clientId!=='string'||!/^[-A-Za-z0-9_]{3,128}$/.test(c.clientId)
  ||typeof c.credentialFingerprint!=='string'||!/^[a-f0-9]{64}$/.test(c.credentialFingerprint)
  ||typeof c.chargedCashAccount!=='string'||!/^\d{1,10}$/.test(c.chargedCashAccount)
  ||c.sellerFeeBilling!=='company_cash_direct'||!keys(c.channels,['BI_FAST','ONLINE'])||!Object.keys(c.channels).length
  ||Object.values(c.channels).some(x=>typeof x!=='string'||!/^(0|[1-9][0-9]{0,15})$/.test(x)||BigInt(x)>9007199254740991n)
  ||typeof c.evidenceReference!=='string'||c.evidenceReference.length<3||c.evidenceReference.length>200||/[\x00-\x1f\x7f]/.test(c.evidenceReference)
  ||typeof c.evidenceDigest!=='string'||!/^[a-f0-9]{64}$/.test(c.evidenceDigest))fail('An actual company-billed transfer fee contract is required before dispatch.');
 for(const k of ['validFrom','validUntil'])if(typeof c[k]!=='string'||!Number.isFinite(Date.parse(c[k]))||new Date(c[k]).toISOString()!==c[k])fail('The transfer fee contract validity is invalid.');
 if(Date.parse(c.validFrom)>Date.now()||Date.parse(c.validUntil)<=Date.now()||c.validUntil<=c.validFrom)fail('The transfer fee contract is not currently effective.');
 const p=await env.DB.prepare(`SELECT e.id,p.cash_account,b.client_id,b.credential_fingerprint FROM commerce_wallet_enrollments e JOIN sellers s ON s.id=e.seller_id AND s.status='active'
 JOIN commerce_wallet_provider_profiles p ON p.enrollment_id=e.id JOIN commerce_wallet_provider_bindings b ON b.enrollment_id=e.id WHERE e.seller_id=? AND e.commerce_environment=?`).bind(c.platformSeller,c.environment).first();
 if(!p||p.cash_account!==c.chargedCashAccount||p.client_id!==c.clientId||p.credential_fingerprint!==c.credentialFingerprint)fail('The fee contract does not identify the current confirmed company cash account.',409);
 const canonical=JSON.stringify({version:1,environment:c.environment,credentialFingerprint:c.credentialFingerprint,clientId:c.clientId,platformSeller:c.platformSeller,
 chargedCashAccount:c.chargedCashAccount,sellerFeeBilling:c.sellerFeeBilling,channels:Object.fromEntries(Object.entries(c.channels).sort()),evidenceReference:c.evidenceReference,evidenceDigest:c.evidenceDigest,validFrom:c.validFrom,validUntil:c.validUntil});
 return {id:'tfc_'+await commerceHash(canonical),json:canonical,platform:p.id,configuration:c};
}
export async function prepareTransferFunding(env,{kind,id,channel,fingerprint,clientId,platform}){
 const c=await transferFeeContract(env);
 if(c.platform!==platform||c.configuration.credentialFingerprint!==fingerprint||c.configuration.clientId!==clientId||!Object.hasOwn(c.configuration.channels,channel))fail('The original transfer is not covered by the configured fee contract.',409);
 const b=await env.DB.prepare('SELECT * FROM commerce_transfer_funding_budget WHERE platform_enrollment_id=?').bind(platform).first();
 const limit=c.configuration.channels[channel];
 if(!b||!b.current||BigInt(b.fee_available)<BigInt(limit))fail('Current delivered commission and provider cash cannot fund this transfer fee.',409);
 if(kind==='treasury'&&!await env.DB.prepare('SELECT intent_id FROM commerce_treasury_release_eligibility WHERE intent_id=?').bind(id).first())fail('Original commission is not released by current settlement and verified delivery.',409);
 const statement=env.DB.prepare(`INSERT INTO commerce_transfer_fee_contracts(id,platform_enrollment_id,contract_json,created_at)
 SELECT ?,?,?,strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE NOT EXISTS(SELECT 1 FROM commerce_transfer_fee_contracts WHERE id=?)`).bind(c.id,platform,c.json,c.id);
 return {contract:c,balanceSequence:b.balance_sequence,statement};
}
export async function originalTransferFunding(env,kind,id){
 const r=await env.DB.prepare(`SELECT r.*,c.contract_json FROM commerce_transfer_fee_reservations r JOIN commerce_transfer_fee_contracts c ON c.id=r.contract_id WHERE r.kind=? AND r.transfer_id=?`).bind(kind,id).first();
 return r?{contractId:r.contract_id,feeLimit:String(r.fee_limit),chargedCashAccount:JSON.parse(r.contract_json).chargedCashAccount,balanceSequence:r.balance_sequence,
  budgetReserved:true,providerFundingVerified:true,feePayer:'ezkart',sellerWithdrawalFee:'0'}:null;
}
export function releaseTransferFeeStatement(env,kind,id,assessmentId){
 const treasury=kind==='treasury',assessments=treasury?'commerce_treasury_outcome_assessments':'commerce_payout_assessments',
 results=treasury?'commerce_treasury_recognitions':'commerce_payout_results',condition=treasury?'1':"r.state IN ('completed','failed')";
 return env.DB.prepare(`INSERT INTO commerce_transfer_fee_releases(kind,transfer_id,assessment_id,observation_cap,status_cap,actual_fee,recorded_at)
 SELECT ?,?,a.id,(SELECT COALESCE(MAX(sequence),0) FROM commerce_provider_financial_observations),a.status_sequence,r.fee_amount,strftime('%Y-%m-%dT%H:%M:%fZ','now')
 FROM ${assessments} a JOIN ${results} r ON r.assessment_sequence=a.sequence
 WHERE a.id=? AND ${condition} AND EXISTS(SELECT 1 FROM ${treasury?'commerce_treasury_positions':'commerce_payout_positions'} p WHERE p.${treasury?'intent_id':'withdrawal_id'}=? AND p.reconciled=1 AND p.${treasury?'recognition_sequence':'assessment_sequence'}=a.sequence) AND EXISTS(SELECT 1 FROM commerce_transfer_fee_reservations WHERE kind=? AND transfer_id=?)
 AND NOT EXISTS(SELECT 1 FROM commerce_transfer_fee_releases WHERE kind=? AND transfer_id=? AND assessment_id=a.id
  AND observation_cap=(SELECT COALESCE(MAX(sequence),0) FROM commerce_provider_financial_observations))`)
 .bind(kind,id,assessmentId,id,kind,id,kind,id);
}
