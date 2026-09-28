import {prepareTransferFunding,originalTransferFunding} from './commerce-transfer-funding.js';
import {commerceEnvironment,commerceHash} from './commerce-orders.js';
import {currentCommerceEnvironment as mode} from './commerce-access.js';
import {treasuryAuthorize,treasuryDestination,treasuryPlatform,treasuryOriginal} from './commerce-treasury.js';
import {validateWithdrawalInquiryReceipt,withdrawalEvidenceJSON as wire,withdrawalEvidenceDate as date,withdrawalEvidenceText as text,withdrawalEvidenceHash as hash} from './commerce-withdrawal-inquiries.js';
import {parseFinancialEvidenceJSON,FinancialJsonNumber} from './financial-evidence-json.js';
const fail=(m,s=422)=>{throw new Response(m,{status:s});};
const fields=(x,allowed)=>{if(!x||typeof x!=='object'||Array.isArray(x)||Object.keys(x).some(k=>!allowed.includes(k)))fail('Treasury bank parameters are invalid.');};
const grant=(env,id,stage)=>env.DB.prepare('SELECT * FROM commerce_treasury_bank_grants WHERE intent_id=? AND stage=? AND commerce_environment=?').bind(id,stage,mode(env)).first();
const receipt=(env,id,stage)=>env.DB.prepare('SELECT * FROM commerce_treasury_bank_receipts WHERE intent_id=? AND stage=?').bind(id,stage).first();
const payload=b=>({partnerReferenceNo:b.partnerReferenceNo,type:'BANK_ACCOUNT',channel:b.channel,amount:{value:b.amount+'.00',currency:'IDR'},fromAccount:b.fromAccount,beneficiaryBankCode:b.beneficiaryBankCode,beneficiaryAccountNumber:b.beneficiaryAccountNumber});
const failure=e=>{if(/treasury_|transfer_funding_|UNIQUE constraint/.test(String(e)))fail('The original treasury source, authorization or confirmation changed; review it before continuing.',409);throw e;};
async function current(env,id){
 const row=await treasuryOriginal(env,id);if(!row)fail('Treasury intent was not found.',404);
 const wallet=await treasuryPlatform(env),bank=treasuryDestination(env,true);
 if(row.cancelled_at||wallet?.id!==row.platform_enrollment_id||await commerceHash(bank)!==row.destination_hash)fail('The original company account configuration changed or the intent was cancelled.',409);
 const funds=await env.DB.prepare('SELECT * FROM commerce_treasury_funds WHERE platform_enrollment_id=? AND commerce_environment=?').bind(wallet.id,mode(env)).first();
 if(!funds||funds.reservation_shortfall||funds.refund_holds||funds.unattributed_captures||funds.incomplete_journals||funds.source_capacity_exceeded)fail('Current commission sources are held.',409);
 const now=JSON.parse(funds.source_json).captures;
 if(JSON.parse(row.source_json).captures.some(old=>old.eligible===1&&!now.some(c=>c.captureId===old.captureId&&c.eligible===1&&c.commission===old.commission&&c.reversed===old.reversed)))fail('An original commission source is held or changed.',409);
 return {row,wallet,funds,bank};
}
async function originalInquiry(env,id){
 const g=await grant(env,id,'inquiry'),r=await receipt(env,id,'inquiry');if(!g||!r)fail('The original bank inquiry receipt is required.',409);
 const evidence=JSON.parse(r.evidence_json),checked=await validateWithdrawalInquiryReceipt(g,evidence);
 if(checked.digest!==r.digest)fail('Original bank evidence requires review.',409);
 return {g,r,evidence};
}
export async function startTreasuryBank(env,user,id,stage,input){
 fields(input,['credentialFingerprint','clientId',...(stage==='payment'?['confirmationId']:[])]);const actor=await treasuryAuthorize(env,user);
 if(typeof input.credentialFingerprint!=='string'||!/^[a-f0-9]{64}$/.test(input.credentialFingerprint)||typeof input.clientId!=='string'||!/^[A-Za-z0-9_-]{3,128}$/.test(input.clientId))fail('Treasury provider identity is invalid.');
 const replay=g=>{if(g.credential_fingerprint!==input.credentialFingerprint||g.client_id!==input.clientId||(stage==='payment'&&g.confirmation_id!==input.confirmationId))fail('Original dispatch identity cannot change.',409);return {mayInquire:false,mayPay:false,payoutConfirmed:false};};
 const previous=await grant(env,id,stage);if(previous)return replay(previous);
 if(env[stage==='inquiry'?'COMMERCE_TREASURY_INQUIRY':'COMMERCE_TREASURY_PAYMENT']!=='enabled')fail('Treasury '+stage+' dispatch is held.',503);
 const {row,wallet,funds}=await current(env,id);
 if(wallet.credential_fingerprint!==input.credentialFingerprint||wallet.client_id!==input.clientId)fail('Provider credentials differ from the original company wallet.',409);
 let binding,body,original,funding;
 if(stage==='payment'){
  if(typeof input.confirmationId!=='string'||!/^tryconf_[a-f0-9]{40}$/.test(input.confirmationId))fail('Original bank confirmation is required.');

  original=await originalInquiry(env,id);binding=JSON.parse(original.g.binding_json);
  if(original.g.client_id!==input.clientId||binding.credentialFingerprint!==input.credentialFingerprint)fail('The original inquiry provider identity changed.',409);
  body=wire({...JSON.parse(original.g.request_body),referenceNo:original.r.provider_reference,beneficiaryAccountName:original.r.beneficiary_name});
  funding=await prepareTransferFunding(env,{kind:'treasury',id,channel:binding.channel,fingerprint:input.credentialFingerprint,clientId:input.clientId,platform:wallet.id});
 }else{
  const bank=JSON.parse(row.destination_json),external=async name=>BigInt('0x'+(await commerceHash('treasury-'+name+':'+id)).slice(0,26)).toString().padStart(32,'0');
  binding={environment:mode(env),credentialFingerprint:input.credentialFingerprint,partnerReferenceNo:row.partner_reference,fromAccount:wallet.cash_account,
   beneficiaryBankCode:bank.code,beneficiaryAccountNumber:bank.accountNumber,amount:String(row.amount),channel:bank.channel,inquiryExternalId:await external('inquiry'),paymentExternalId:await external('payment')};
  body=wire(payload(binding));
 }
 try{const statement=env.DB.prepare(`INSERT INTO commerce_treasury_bank_grants(intent_id,stage,commerce_environment,operator_id,proof_expires_at,credential_fingerprint,client_id,
  inquiry_external_id,payment_external_id,binding_json,request_body,source_json,destination_hash,confirmation_id,funding_contract_id,funding_balance_sequence,created_at)
  VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,strftime('%Y-%m-%dT%H:%M:%fZ','now'))`).bind(id,stage,mode(env),actor.id,actor.proofExpiresAt,input.credentialFingerprint,input.clientId,
   binding.inquiryExternalId,binding.paymentExternalId,JSON.stringify(binding),body,funds.source_json,row.destination_hash,input.confirmationId||null,funding?.contract.id||null,funding?.balanceSequence||null);
  if(funding)await env.DB.batch([funding.statement,statement]);else await statement.run();}
 catch(e){const saved=await grant(env,id,stage);if(saved)return replay(saved);failure(e);}
 return {funding:await originalTransferFunding(env,'treasury',id),binding,mayInquire:stage==='inquiry',mayPay:stage==='payment',payoutConfirmed:false,...(original?{originalInquiry:original.evidence,inquiryDigest:original.r.digest,confirmationId:input.confirmationId}:{})};
}
export async function confirmTreasuryBank(env,user,id,input){
 fields(input,['requestKey','inquiryDigest']);const actor=await treasuryAuthorize(env,user);
 if(typeof input.requestKey!=='string'||!/^[a-f0-9]{32}$/.test(input.requestKey)||typeof input.inquiryDigest!=='string'||!/^[a-f0-9]{64}$/.test(input.inquiryDigest))fail('Bank confirmation reference is invalid.');
 const read=()=>env.DB.prepare('SELECT id,inquiry_digest,operator_id FROM commerce_treasury_bank_confirmations WHERE intent_id=? AND request_key=?').bind(id,input.requestKey).first();
 const result=(c,replayed)=>{if(c.inquiry_digest!==input.inquiryDigest||c.operator_id!==actor.id)fail('Confirmation details differ.',409);return {confirmationId:c.id,replayed,payoutConfirmed:false};};
 const prior=await read();if(prior)return result(prior,true);
 const {funds,bank}=await current(env,id),original=await originalInquiry(env,id);
 if(original.r.digest!==input.inquiryDigest||original.r.beneficiary_name!==bank.beneficiaryName)fail('Returned company bank holder must match the pinned company legal name exactly.',409);
 const confirmationId='tryconf_'+(await commerceHash({id,requestKey:input.requestKey})).slice(0,40);
 try{await env.DB.prepare(`INSERT INTO commerce_treasury_bank_confirmations VALUES(?,?,?,?,?,?,?,strftime('%Y-%m-%dT%H:%M:%fZ','now'))`)
  .bind(confirmationId,id,input.requestKey,input.inquiryDigest,actor.id,actor.proofExpiresAt,funds.source_json).run();}
 catch(e){const saved=await read();if(saved)return result(saved,true);failure(e);}return result(await read(),false);
}
export async function treasuryBankRecovery(env,id,stage,input){
 fields(input,['environment']);commerceEnvironment(env,input.environment);
 const g=await grant(env,id,stage);if(!g)fail('Original treasury dispatch was not found.',404);
 const r=await receipt(env,id,stage),original=stage==='payment'?await originalInquiry(env,id):null;
 return {funding:await originalTransferFunding(env,'treasury',id),binding:JSON.parse(g.binding_json),clientId:g.client_id,requestBody:g.request_body,originalEvidence:r?JSON.parse(r.evidence_json):null,
  digest:r?.digest||null,mayInquire:false,mayPay:false,payoutConfirmed:false,...(original?{originalInquiry:original.evidence,inquiryDigest:original.r.digest,confirmationId:g.confirmation_id}:{})};
}
async function paymentReceipt(env,id,g,e){
 const keys=['environment','credentialFingerprint','operation','externalId','requestedAt','observedAt','requestBody','responseBody'];fields(e,keys);
 if(Object.keys(e).length!==8||e.environment!==g.commerce_environment||e.credentialFingerprint!==g.credential_fingerprint||e.operation!=='transfer-payment'
  ||e.externalId!==g.payment_external_id||e.requestBody!==g.request_body||typeof e.responseBody!=='string'||new TextEncoder().encode(e.responseBody).length>16000)fail('Transfer evidence differs from its original send grant.',409);
 const sent=date(e.requestedAt),observed=date(e.observedAt);if(sent>observed||Date.parse(sent)<Date.parse(g.created_at)-300000||Date.parse(observed)>Date.now()+300000)fail('Transfer evidence time is invalid.');
 const original=await originalInquiry(env,id),b=JSON.parse(g.binding_json),expected=JSON.parse(g.request_body);let r;
 try{r=parseFinancialEvidenceJSON(e.responseBody);}catch{fail('Transfer response JSON is invalid or ambiguous.');}
 if(!r||typeof r.responseCode!=='string'||!/^200[0-9]{4}$/.test(r.responseCode))fail('Transfer response was not successful.');
 for(const k of ['partnerReferenceNo','type','channel','beneficiaryBankCode','beneficiaryAccountNumber','beneficiaryAccountName'])if(r[k]!==expected[k])fail('Transfer response destination differs.',409);
 const from=r.fromAccount instanceof FinancialJsonNumber?r.fromAccount.value:r.fromAccount;
 if(from!==b.fromAccount||r.amount?.value!==b.amount+'.00'||r.amount?.currency!=='IDR')fail('Transfer response amount or source differs.',409);
 const reference=text(r.referenceNo,64),name=text(r.beneficiaryAccountName,256),processed=date(r.transactionDate);text(r.referenceNumber,64);
 if(Date.parse(processed)>Date.parse(observed)+300000||Date.parse(processed)<Date.parse(original.evidence.requestedAt)-300000)fail('Transfer processing time is invalid.');
 return {reference,name,evidence:JSON.stringify(Object.fromEntries(keys.map(k=>[k,e[k]]))),digest:await hash('ezkart.doku.bank-payment.v1\n'+wire([g.confirmation_id,original.r.digest,...keys.map(k=>e[k])]))};
}
export async function saveTreasuryBankReceipt(env,id,stage,input){
 fields(input,['environment','evidence']);commerceEnvironment(env,input.environment);
 const g=await grant(env,id,stage);if(!g)fail('Original treasury dispatch was not found.',404);
 const data=stage==='inquiry'?await validateWithdrawalInquiryReceipt(g,input.evidence):await paymentReceipt(env,id,g,input.evidence);
 const replay=r=>{if(r.digest!==data.digest||r.evidence_json!==data.evidence)fail('A different original receipt is already recorded.',409);return {recorded:true,replayed:true,digest:r.digest,payoutConfirmed:false};};
 const prior=await receipt(env,id,stage);if(prior)return replay(prior);
 try{await env.DB.prepare(`INSERT INTO commerce_treasury_bank_receipts VALUES(?,?,?,?,?,?,?,?,strftime('%Y-%m-%dT%H:%M:%fZ','now'))`)
  .bind(id,stage,mode(env),g.credential_fingerprint,data.reference,data.digest,data.name,data.evidence).run();}
 catch(e){const saved=await receipt(env,id,stage);if(saved)return replay(saved);failure(e);}
 return {recorded:true,replayed:false,digest:data.digest,payoutConfirmed:false};
}
