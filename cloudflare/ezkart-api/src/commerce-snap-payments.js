import {commerceEnvironment,commerceHash,commerceOrder,applyCommerceEvent} from './commerce-orders.js';
import {parseMessageJSON} from './message-json.js';

const fail=(message,status=422)=>{throw new Response(message,{status});};
const fields=(value,allowed)=>{if(!value||typeof value!=='object'||Array.isArray(value)||Object.keys(value).some(key=>!allowed.includes(key)))fail('SNAP payment parameters are invalid');};
const id=value=>typeof value==='string'&&/^[A-Za-z0-9][A-Za-z0-9_-]{2,95}$/.test(value);
const bytes=value=>new TextEncoder().encode(value).length;
const date=value=>{
  if(typeof value!=='string'||!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:Z|[+-](?:(?:0\d|1[0-3]):[0-5]\d|14:00))$/.test(value))fail('Provider timestamp is invalid');
  const n=Date.parse(value);if(!Number.isFinite(n))fail('Provider timestamp is invalid');
  // Date.parse normalizes invalid calendar days; compare the local date too.
  const offset=value.endsWith('Z')?0:(value[19]==='+'?1:-1)*(Number(value.slice(20,22))*60+Number(value.slice(23,25)));
  if(new Date(n+offset*60000).toISOString().slice(0,19)!==value.slice(0,19))fail('Provider timestamp is invalid');return n;
};
const decode=(raw,maximum)=>{
  if(typeof raw!=='string'||bytes(raw)>maximum)fail('Provider receipt is too large or invalid');
  try{const value=parseMessageJSON(raw);if(!value||typeof value!=='object'||Array.isArray(value))throw Error();return value;}
  catch{fail('Provider receipt is invalid or ambiguous');}
};
const money=(value,amount)=>{if(!value||value.currency!=='IDR'||value.value!==String(amount)+'.00')fail('Provider receipt amount does not match this order',409);};
const name=value=>typeof value==='string'&&[...value].length<=255&&value.trim()&&!/[\x00-\x1f\x7f]/.test(value);

async function context(env,orderId,environment){
  commerceEnvironment(env,environment);
  const row=await env.DB.prepare(`SELECT o.seller_id,j.id AS job_id,j.state,j.attempts,j.lease_owner,j.lease_token,j.lease_mode,j.lease_until,
    b.binding_json,b.client_id,b.attempt_id,b.created_at,a.account_number FROM orders o
    JOIN commerce_jobs j ON j.order_id=o.id AND j.seller_id=o.seller_id AND j.kind='payment.create'
    LEFT JOIN commerce_snap_payment_bindings b ON b.order_id=o.id LEFT JOIN commerce_payment_accounts a ON a.order_id=o.id
    WHERE o.id=? AND o.commerce_environment=? AND o.commerce_version=1 AND json_extract(o.snapshot_json,'$.checkout.paymentFlow')='snap_bca'`)
    .bind(orderId,environment).first();
  if(!row)fail('SNAP payment not found',404);
  const order=await commerceOrder(env,row.seller_id,orderId,environment);
  return {row,order,binding:row.binding_json?JSON.parse(row.binding_json):null};
}

export async function snapPayment(env,orderId,environment){
  const {row,order,binding}=await context(env,orderId,environment);
  return {order,jobId:row.job_id,binding,clientId:row.client_id||null,boundAt:row.created_at||null,accountNumber:row.account_number||null};
}

export async function bindSnapPayment(env,orderId,input){
  fields(input,['environment','workerId','leaseToken','credentialFingerprint','clientId','partnerServiceId','customerPrefix']);
  if(!id(input.workerId)||!id(input.leaseToken)||typeof input.credentialFingerprint!=='string'||!/^[a-f0-9]{64}$/.test(input.credentialFingerprint)
    ||typeof input.clientId!=='string'||!/^[A-Za-z0-9_-]{3,128}$/.test(input.clientId)
    ||typeof input.partnerServiceId!=='string'||input.partnerServiceId.length!==8||!/^ *[0-9]{1,8}$/.test(input.partnerServiceId)
    ||typeof input.customerPrefix!=='string'||!/^[0-9]{1,10}$/.test(input.customerPrefix)
    ||input.partnerServiceId.trimStart().length+input.customerPrefix.length>=16)fail('SNAP provider configuration is invalid');
  const {row,order,binding}=await context(env,orderId,input.environment),now=new Date().toISOString();
  if(row.lease_owner!==input.workerId||row.lease_token!==input.leaseToken||row.state!=='running'||row.lease_mode!=='execute'||row.lease_until<=now)fail('This worker cannot start the payment',409);
  if(binding){
    if(binding.credentialFingerprint!==input.credentialFingerprint||row.client_id!==input.clientId
      ||binding.partnerServiceId!==input.partnerServiceId||binding.customerPrefix!==input.customerPrefix)fail('The original payment provider configuration cannot change',409);
    return {mayCreate:false,binding};
  }
  if(order.state!=='creating'||Date.parse(order.expiresAt)<=Date.now()||Date.parse(order.expiresAt)>Date.now()+86400000
    ||!/^[0-9]{32}$/.test(order.paymentRequestId))fail('This order cannot start another payment',409);
  const frozen={environment:order.environment,credentialFingerprint:input.credentialFingerprint,externalId:order.paymentRequestId,
    orderId,partnerServiceId:input.partnerServiceId,customerPrefix:input.customerPrefix,amount:order.total,
    name:order.customer.name,email:order.customer.email,expiresAt:new Date(order.expiresAt).toISOString().replace('.000Z','Z')};
  try{await env.DB.prepare(`INSERT INTO commerce_snap_payment_bindings(order_id,seller_id,commerce_environment,job_id,attempt_id,
    credential_fingerprint,client_id,external_id,binding_json,created_at) VALUES(?,?,?,?,?,?,?,?,?,?)`)
    .bind(orderId,order.sellerId,order.environment,row.job_id,row.job_id+':'+row.attempts,input.credentialFingerprint,input.clientId,
      order.paymentRequestId,JSON.stringify(frozen),now).run();}
  catch(error){if(/commerce_snap_dispatch_mismatch|UNIQUE constraint/.test(String(error)))fail('Payment dispatch changed. Reconcile the original request.',409);throw error;}
  return {mayCreate:true,binding:frozen};
}

function account(data,binding,expected){
  const bin=binding.partnerServiceId.trimStart();
  if(!data||data.partnerServiceId!==binding.partnerServiceId||typeof data.customerNo!=='string'||!/^\d{1,20}$/.test(data.customerNo)
    ||!data.customerNo.startsWith(binding.customerPrefix)||typeof data.virtualAccountNo!=='string'
    ||!new RegExp('^ {0,'+(8-bin.length)+'}[0-9]{16}$').test(data.virtualAccountNo)
    ||data.virtualAccountNo.trimStart()!==bin+data.customerNo||(expected&&data.virtualAccountNo.trimStart()!==expected))fail('Provider receipt account does not match the original payment',409);
  return data.virtualAccountNo.trimStart();
}
function createPayload(b){return {partnerServiceId:b.partnerServiceId,customerNo:b.customerPrefix,virtualAccountNo:b.partnerServiceId+b.customerPrefix,
  virtualAccountName:b.name,virtualAccountEmail:b.email,trxId:b.orderId,totalAmount:{value:String(b.amount)+'.00',currency:'IDR'},
  virtualAccountTrxType:'C',expiredDate:b.expiresAt,additionalInfo:{channel:'VIRTUAL_ACCOUNT_BCA',virtualAccountConfig:{reusableStatus:false}}};}

/** The signed PHP service verifies TLS/provider signatures. Revalidate original
 * identity and money here; raw receipts stay private and no bearer token crosses.
 */
export async function recordSnapPaymentReceipt(env,orderId,input){
  fields(input,['environment','credentialFingerprint','operation','externalId','sentAt','observedAt','requestBody','body']);
  const {row,order,binding}=await context(env,orderId,input.environment);
  if(!binding||input.credentialFingerprint!==binding.credentialFingerprint)fail('Provider receipt has no matching dispatch binding',409);
  if(!['bca-create','bca-notification','bca-status'].includes(input.operation)||typeof input.externalId!=='string'||!/^\d{1,36}$/.test(input.externalId))fail('Provider receipt identity is invalid');
  const sent=date(input.sentAt),observed=date(input.observedAt);
  if(sent>Date.now()+300000||observed>Date.now()+300000||observed<sent-300000)fail('Provider receipt time is invalid');
  const raw=decode(input.body,262144),operation=input.operation;
  let accountNumber,paymentReference=null,type,data,eventKey;
  const base={provider:'doku',amount:order.total,currency:'IDR'};
  if(operation==='bca-create'){
    const request=decode(input.requestBody,8000),va=raw.virtualAccountData;
    if(input.externalId!==binding.externalId||await commerceHash(request)!==await commerceHash(createPayload(binding))
      ||raw.responseCode!=='2002700'||!va||va.trxId!==orderId||va.virtualAccountName!==binding.name
      ||va.virtualAccountTrxType!=='C'||va.additionalInfo?.channel!=='VIRTUAL_ACCOUNT_BCA'
      ||(va.virtualAccountEmail!==undefined&&va.virtualAccountEmail!==binding.email)
      ||(va.additionalInfo?.virtualAccountConfig?.reusableStatus!==undefined&&va.additionalInfo.virtualAccountConfig.reusableStatus!==false)
      ||date(va.expiredDate)!==date(binding.expiresAt))fail('Provider creation receipt does not match the original request',409);
    money(va.totalAmount,order.total);accountNumber=account(va,binding,row.account_number);
    type='payment.created';eventKey='snap_created:'+binding.externalId;
    data={...base,providerRequestId:order.paymentRequestId,expiresAt:binding.expiresAt,method:'VIRTUAL_ACCOUNT_BCA',accountNumber};
  }else if(operation==='bca-notification'){
    if(input.requestBody!==null||raw.trxId!==orderId||raw.additionalInfo?.channel!=='VIRTUAL_ACCOUNT_BCA'
      ||(raw.virtualAccountTrxType!==undefined&&raw.virtualAccountTrxType!=='C')||!name(raw.virtualAccountName)
      ||typeof raw.paymentRequestId!=='string'||!/^[A-Za-z0-9_-]{1,30}$/.test(raw.paymentRequestId)
      ||(raw.trxDateTime!==undefined&&date(raw.trxDateTime)>Date.now()+300000))fail('Provider payment notification is invalid',409);
    money(raw.paidAmount,order.total);accountNumber=account(raw,binding,row.account_number);
    paymentReference='doku_snap_bca_'+await commerceHash(JSON.stringify([order.environment,row.client_id,'VIRTUAL_ACCOUNT_BCA',raw.paymentRequestId]));
    type='payment.succeeded';eventKey='capture:'+paymentReference;
    // Notification request IDs, timestamps and JSON formatting can change on
    // redelivery. The charge event keeps only its original economic identity.
    data={...base,verified:true,reference:paymentReference,originalRequestId:order.paymentRequestId,
      channel:'VIRTUAL_ACCOUNT_BCA',accountNumber,bankReference:raw.paymentRequestId};
  }else{
    if(!row.account_number||Date.now()<Date.parse(row.created_at)+60000||sent<Date.parse(row.created_at)+60000)fail('Wait before observing the original payment status',409);
    const request=decode(input.requestBody,8000),bin=binding.partnerServiceId.trimStart();
    fields(request,['partnerServiceId','customerNo','virtualAccountNo','paymentRequestId']);
    const expected={partnerServiceId:binding.partnerServiceId,customerNo:row.account_number.slice(bin.length),virtualAccountNo:binding.partnerServiceId+row.account_number.slice(bin.length),
      ...(request.paymentRequestId===undefined?{}:{paymentRequestId:request.paymentRequestId})};
    if(await commerceHash(request)!==await commerceHash(expected)||raw.responseCode!=='2002600'
      ||(request.paymentRequestId!==undefined&&(typeof request.paymentRequestId!=='string'||!/^[A-Za-z0-9_-]{1,30}$/.test(request.paymentRequestId))))fail('Provider status request is invalid');
    const rows=Array.isArray(raw.virtualAccountData)?raw.virtualAccountData:[raw.virtualAccountData];
    if(rows.length>100)fail('Provider status response is too large');
    for(const va of rows){
      account(va,binding,row.account_number);money(va.paidAmount,order.total);
      if((va.trxId??raw.additionalInfo?.trxId)!==orderId||(va.trxId!==undefined&&raw.additionalInfo?.trxId!==undefined&&va.trxId!==raw.additionalInfo.trxId)
        ||(request.paymentRequestId!==undefined&&va.paymentRequestId!==request.paymentRequestId))fail('Provider status does not match the original invoice',409);
    }
    accountNumber=row.account_number;
  }
  const bodyHash=await commerceHash(input.body),receiptId='snapr_'+await commerceHash({orderId,operation,credentialFingerprint:binding.credentialFingerprint,
    externalId:input.externalId,sentAt:input.sentAt,bodyHash,requestBody:input.requestBody});
  const statement=env.DB.prepare(`INSERT INTO commerce_snap_payment_receipts(id,order_id,credential_fingerprint,operation,external_id,sent_at,observed_at,
    body_hash,body_json,request_json,account_number,payment_reference,received_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(id) DO NOTHING`)
    .bind(receiptId,orderId,binding.credentialFingerprint,operation,input.externalId,input.sentAt,input.observedAt,bodyHash,input.body,input.requestBody,
      accountNumber,paymentReference,new Date().toISOString());
  let saved=order;
  try{
    if(type)saved=await applyCommerceEvent(env,orderId,{environment:order.environment,sellerId:order.sellerId,eventKey,type,data},
      {paymentReceipt:{orderId,type,statements:[statement]}});
    else await statement.run();
  }catch(error){if(/commerce_snap_|UNIQUE constraint/.test(String(error)))fail('Provider receipt conflicts with the original payment. Review its saved evidence.',409);throw error;}
  return {recorded:true,receiptId,order:saved,paymentConfirmed:operation==='bca-notification',settlementVerified:false};
}
