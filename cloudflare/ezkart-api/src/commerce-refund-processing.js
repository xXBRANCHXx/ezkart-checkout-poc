import {commerceHash,commerceStorageEnabled} from './commerce-orders.js';
import {currentCommerceEnvironment as mode} from './commerce-access.js';
import {refundDetail,refundAccess} from './commerce-refunds.js';
import {supportAccess} from './commerce-support.js';
import {refundCostPreview} from './commerce-refund-costs.js';
const fail=(message,status=422)=>{throw new Response(message,{status,headers:status===401?{'x-ezkart-error-code':'support_verification_required'}:{}});};
const fields=(input,allowed)=>{if(!input||typeof input!=='object'||Array.isArray(input)||Object.keys(input).some(k=>!allowed.includes(k)))fail('Refund processing details are invalid.');};
const text=(value,label,min,max)=>{if(typeof value!=='string'||value.trim().length<min||value.trim().length>max||/[\u0000-\u001f\u007f]/.test(value))fail(label+' is invalid.');return value.trim();};
const key=value=>{if(typeof value!=='string'||!/^[A-Za-z0-9_-]{16,100}$/.test(value))fail('Request identity is invalid.');return value;};
const id=(value,prefix)=>{if(typeof value!=='string'||!new RegExp('^'+prefix+'_[a-f0-9]{32}$').test(value))fail('Refund processing reference is invalid.');return value;};
const integer=value=>{if(!Number.isSafeInteger(value)||value<0)fail('Refund processing version is invalid.');return value;};
const bankFor=(env,refund)=>env.DB.prepare('SELECT * FROM commerce_refund_current_bank WHERE refund_id=?').bind(refund).first();
const requestFor=(env,refund)=>env.DB.prepare('SELECT * FROM commerce_refund_provider_requests WHERE refund_id=?').bind(refund).first();
function databaseFailure(error){const value=String(error)+' '+String(error?.cause||'');
  if(value.includes('actor_forbidden'))fail('Your access to this refund changed.',403);
  if(value.includes('proof_expired'))fail('Verify your authenticator before updating refund processing.',401);
  if(value.includes('rate_limit'))fail('Too many bank-detail changes. Try again later.',429);
  if(/refund_bank_|refund_handoff_|UNIQUE constraint failed/.test(value))fail('The refund, bank details or provider request changed. Reload and review the original record.',409);
  throw error;
}
export async function refundProcessingView(env,actor,row,authority,dispute){
  const [bank,request,source,finalization]=await Promise.all([bankFor(env,row.id),requestFor(env,row.id),
    env.DB.prepare('SELECT bank_id,settlement_id FROM commerce_refund_handoff_sources WHERE refund_id=?').bind(row.id).first(),env.DB.prepare('SELECT * FROM commerce_refund_finalizations WHERE refund_id=?').bind(row.id).first()]);
  const submission=request?await env.DB.prepare('SELECT * FROM commerce_refund_provider_submissions WHERE provider_request_id=?').bind(request.id).first():null;
  const approved=row.state==='approved',enabled=commerceStorageEnabled(env),staff=actor.kind==='support',fresh=staff&&authority.canWrite&&enabled;
  const reason=!approved?'Bank details are collected after approval.':dispute?.active?'An Ezkart review is open.':!bank?'Waiting for the buyer’s bank details.':
    !source?'The original payment and current settled funds must be verified before preparing a DOKU request.':'';
  return {state:finalization?'confirmed':submission?'submitted':request?'prepared':approved?'awaiting_preparation':'not_approved',
    stateLabel:finalization?(actor.kind==='buyer'?'Refund confirmed':'Refund confirmed — funding reconciliation pending'):submission?'Submitted to DOKU — refund not confirmed':request?'DOKU request prepared — submission not recorded':'Refund payment not confirmed',
    bankProvided:Boolean(bank),bank:bank&&actor.kind!=='merchant'?{id:bank.id,bankName:bank.bank_name,accountName:bank.account_name,
      accountEnding:bank.account_number.slice(-4),savedAt:bank.created_at}:null,
    canProvideBank:enabled&&actor.kind==='buyer'&&approved&&!request&&!dispute?.active,
    canPrepare:fresh&&!request&&Boolean(source),canDownload:fresh&&Boolean(request),canRecordSubmission:!finalization&&fresh&&Boolean(request)&&!submission,
    requiresVerification:staff&&authority.role==='reviewer'&&!authority.canWrite,
    reason:request?'':reason,request:request?{id:request.id,preparedAt:request.created_at,...(staff?{settlementId:request.settlement_id}: {})}:null,
    submission:submission?{submittedAt:submission.submitted_at,recordedAt:submission.recorded_at,...(staff?{channel:submission.channel,reference:submission.reference}: {})}:null,
    ...(actor.kind==='buyer'?{}:{costs:finalization?null:await refundCostPreview(env,row)}),paymentConfirmed:Boolean(finalization),
    ...(finalization?{confirmedAt:finalization.returned_at,fundingState:'unreconciled',refundFeeState:finalization.refund_fee_amount===null?'unknown':'custody_unresolved',
      ...(actor.kind==='buyer'?{}:{commissionReversal:String(finalization.commission_reversal),actualRefundFee:finalization.refund_fee_amount===null?null:String(finalization.refund_fee_amount),refundFeePayer:null})}: {})};
}

export async function saveRefundBank(env,actor,refundId,raw,expectedOrder=''){
  const detail=await refundDetail(env,actor,refundId,expectedOrder);
  if(actor.kind!=='buyer')fail('Only the original buyer can provide refund bank details.',403);
  if(!commerceStorageEnabled(env))fail('Refund bank details are unavailable.',503);
  fields(raw,['previousId','bankName','accountName','accountNumber','confirmed']);
  const input={previousId:raw.previousId===null?null:id(raw.previousId,'rbank'),bankName:text(raw.bankName,'Bank name',2,100),
    accountName:text(raw.accountName,'Account holder name',2,100),accountNumber:text(raw.accountNumber,'Account number',5,34),confirmed:raw.confirmed};
  if(!/^[0-9]{5,34}$/.test(input.accountNumber)||input.confirmed!==true)fail('Check the bank details and confirm this refund destination.');
  const hash=await commerceHash({actor:actor.id,environment:mode(env),refundId,...input});
  const replay=async()=>Boolean(await env.DB.prepare('SELECT id FROM commerce_refund_bank_details WHERE request_hash=? AND actor_auth_user_id=?').bind(hash,actor.id).first());
  if(await replay())return refundDetail(env,actor,refundId,expectedOrder);
  if(!detail.processing.canProvideBank)fail('The refund’s bank details cannot be changed now. Contact Ezkart if the prepared details are incorrect.',409);
  try{await env.DB.prepare(`INSERT INTO commerce_refund_bank_details(id,refund_id,actor_auth_user_id,previous_id,request_hash,bank_name,account_name,account_number,created_at)
    VALUES(?,?,?,?,?,?,?,?,?)`).bind('rbank_'+crypto.randomUUID().replaceAll('-',''),refundId,actor.id,input.previousId,hash,input.bankName,input.accountName,input.accountNumber,new Date().toISOString()).run();}
  catch(error){if(!await replay())databaseFailure(error);}
  return refundDetail(env,actor,refundId,expectedOrder);
}

export async function changeRefundProcessing(env,actor,refundId,raw){
  const detail=await refundDetail(env,actor,refundId);await supportAccess(env,actor,true);
  if(!commerceStorageEnabled(env))fail('Refund processing is unavailable.',503);
  if(!['prepare_provider_request','record_provider_submission'].includes(raw?.kind))fail('Refund processing action is invalid.');
  const prepare=raw.kind==='prepare_provider_request';
  fields(raw,prepare?['kind','requestKey','bankId','refundRevision','orderRevision','evidenceVersion']:
    ['kind','requestKey','providerRequestId','channel','reference','submittedAt','confirmed']);
  const input={kind:raw.kind,requestKey:key(raw.requestKey),...(prepare?{bankId:id(raw.bankId,'rbank'),refundRevision:integer(raw.refundRevision),
    orderRevision:integer(raw.orderRevision),evidenceVersion:integer(raw.evidenceVersion)}:{providerRequestId:id(raw.providerRequestId,'rprov'),
    channel:raw.channel,reference:text(raw.reference,'Provider ticket or sent-message reference',3,200),submittedAt:raw.submittedAt,confirmed:raw.confirmed})};
  if(!prepare&&(!['support_ticket','email'].includes(input.channel)||input.confirmed!==true||typeof input.submittedAt!=='string'
    ||!/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(input.submittedAt)||!Number.isFinite(Date.parse(input.submittedAt))))fail('Provide the actual submission reference and time, and confirm it was sent.');
  const hash=await commerceHash({actor:actor.id,environment:mode(env),refundId,...input}),table=prepare?'commerce_refund_provider_requests':'commerce_refund_provider_submissions';
  const replay=async()=>{const r=await env.DB.prepare('SELECT request_hash FROM '+table+' WHERE actor_auth_user_id=? AND request_key=?').bind(actor.id,input.requestKey).first();
    if(!r)return false;if(r.request_hash!==hash)fail('This request identity was used for different processing details.',409);return true;};
  if(await replay())return refundDetail(env,actor,refundId);
  const now=new Date().toISOString();
  if(prepare){
    const source=await env.DB.prepare('SELECT * FROM commerce_refund_handoff_sources WHERE refund_id=?').bind(refundId).first();
    if(!detail.processing.canPrepare||!source||source.bank_id!==input.bankId||source.refund_revision!==input.refundRevision
      ||source.order_revision!==input.orderRevision||source.evidence_version!==input.evidenceVersion)fail('Review the current approved refund, buyer bank details, evidence and settlement before preparing the request.',409);
    try{await env.DB.prepare(`INSERT INTO commerce_refund_provider_requests(id,refund_id,bank_id,settlement_id,actor_auth_user_id,proof_expires_at,request_key,request_hash,refund_revision,order_revision,evidence_version,snapshot_json,created_at)
      VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)`).bind('rprov_'+crypto.randomUUID().replaceAll('-',''),refundId,source.bank_id,source.settlement_id,actor.id,actor.proofExpiresAt,input.requestKey,hash,
      input.refundRevision,input.orderRevision,input.evidenceVersion,source.snapshot_json,now).run();}catch(error){if(!await replay())databaseFailure(error);}
  }else{
    if(!detail.processing.canRecordSubmission||detail.processing.request.id!==input.providerRequestId)fail('This original provider request already has a submission record or changed. Reload it before continuing.',409);
    try{await env.DB.prepare(`INSERT INTO commerce_refund_provider_submissions(id,provider_request_id,actor_auth_user_id,proof_expires_at,request_key,request_hash,channel,reference,submitted_at,recorded_at)
      VALUES(?,?,?,?,?,?,?,?,?,?)`).bind('rsubmit_'+crypto.randomUUID().replaceAll('-',''),input.providerRequestId,actor.id,actor.proofExpiresAt,input.requestKey,hash,input.channel,input.reference,input.submittedAt,now).run();}
    catch(error){if(!await replay())databaseFailure(error);}
  }
  return refundDetail(env,actor,refundId);
}

export async function refundProviderPacket(env,actor,refundId){
  const detail=await refundDetail(env,actor,refundId);await supportAccess(env,actor,true);
  if(!detail.processing.request)fail('No provider request has been prepared.',404);
  const request=await requestFor(env,refundId),s=JSON.parse(request.snapshot_json);
  const bank=await env.DB.prepare('SELECT bank_name,account_name,account_number FROM commerce_refund_bank_details WHERE id=? AND refund_id=?').bind(request.bank_id,refundId).first();
  if(!bank)fail('Original refund bank details require a storage review.',503);
  const content=['DOKU non-card refund request','', 'Ezkart request: '+request.id,'Ezkart refund: '+refundId,
    'Brand ID: '+s.brandId,'Invoice number: '+s.invoiceNumber,'Transaction date: '+s.transactionDate,
    'Transaction amount: IDR '+s.transactionAmount,'Refund amount: IDR '+s.refundAmount,
    'Original payment reference: '+s.paymentReference,'Customer bank: '+bank.bank_name,
    'Account holder: '+bank.account_name,'Account number: '+bank.account_number,'',
    'Please process this refund against the original settled transaction and provide the processing reference, outcome and any actual refund fee.',
    'This is one original request. If it was already submitted, follow up with the same reference instead of requesting another refund.',''].join('\n');
  // Recheck current authorization after reading the sensitive original destination.
  await refundAccess(env,actor,detail.orderId);await supportAccess(env,actor,true);
  return {filename:request.id+'.txt',content,sha256:[...new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(content)))].map(n=>n.toString(16).padStart(2,'0')).join(''),requestId:request.id};
}
