import {requireSellingOnboarding} from './seller-publication.js';
import {commerceEnvironment,commerceHash,commerceOrder,applyCommerceEvent} from './commerce-orders.js';
import {paymentRoute} from './commerce-payment-routing.js';
import {parseMessageJSON} from './message-json.js';
import {parseFinancialEvidenceJSON,FinancialJsonNumber} from './financial-evidence-json.js';
import {deploymentProfile} from './deployment.js';
const fail=(m,s=422)=>{throw new Response(m,{status:s});};
const fields=(o,keys)=>{if(!o||typeof o!=='object'||Array.isArray(o)||Object.keys(o).some(k=>!keys.includes(k)))fail('Checkout parameters are invalid');};
const text=(v,max=128)=>typeof v==='string'&&v.length>0&&v.length<=max&&!/[\x00-\x1f\x7f]/.test(v);
const date=v=>{if(typeof v!=='string'||!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/.test(v)||!Number.isFinite(Date.parse(v))||new Date(v).toISOString().replace('.000Z','Z')!==v)fail('Checkout timestamp is invalid');return Date.parse(v);};
const decode=(v,max=262144)=>{try{if(typeof v!=='string'||new TextEncoder().encode(v).length>max)throw Error();const o=parseMessageJSON(v);if(!o||typeof o!=='object'||Array.isArray(o))throw Error();return o;}catch{fail('Checkout evidence is invalid or ambiguous');}};
const methods=v=>Array.isArray(v)&&v.length>0&&v.length<=4&&new Set(v).size===v.length&&v.every(x=>['QRIS','CREDIT_CARD','VIRTUAL_ACCOUNT_BCA','EMONEY_SHOPEEPAY'].includes(x));
const exactAmount=(raw,path,amount)=>{let v;try{v=parseFinancialEvidenceJSON(raw);for(const p of path)v=v?.[p];}catch{}v=v instanceof FinancialJsonNumber?v.value:v;if(typeof v!=='string'||!new RegExp('^'+amount+'(?:\\.00)?$').test(v))fail('Checkout amount does not match the original order',409);};
async function context(env,orderId,environment){
 commerceEnvironment(env,environment);
 const row=await env.DB.prepare(`SELECT o.seller_id,j.id AS job_id,j.state,j.attempts,j.lease_owner,j.lease_token,j.lease_mode,j.lease_until,
 b.binding_json,b.client_id,b.created_at FROM orders o JOIN commerce_jobs j ON j.order_id=o.id AND j.kind='payment.create'
 LEFT JOIN commerce_hosted_payment_bindings b ON b.order_id=o.id WHERE o.id=? AND o.commerce_environment=? AND o.commerce_version=1
 AND json_extract(o.snapshot_json,'$.checkout.paymentFlow')='routed_hosted'`).bind(orderId,environment).first();
 if(!row)fail('Routed Checkout not found',404);
 return {row,order:await commerceOrder(env,row.seller_id,orderId,environment),binding:row.binding_json?JSON.parse(row.binding_json):null};
}
export async function hostedPayment(env,orderId,environment){const {row,order,binding}=await context(env,orderId,environment);return {order,binding,clientId:row.client_id||null,jobId:row.job_id,boundAt:row.created_at||null,route:await paymentRoute(env,orderId,environment)};}
export function hostedPayload(b){return {order:{invoice_number:b.orderId,amount:b.amount,currency:'IDR',callback_url:b.returnUrl,callback_url_result:b.returnUrl,
 auto_redirect:false,disable_retry_payment:true,recover_abandoned_cart:false},payment:{payment_due_date:b.paymentDueMinutes,type:'SALE',payment_method_types:b.methods},
 customer:{name:b.name,email:b.email},additional_info:{override_notification_url:b.notificationUrl},additionalInfo:{account:{id:b.routing.profileId,split_rule_id:b.routing.splitRuleId}}};}
export async function bindHostedPayment(env,orderId,input){
 fields(input,['environment','workerId','leaseToken','credentialFingerprint','clientId','methods']);
 if(!text(input.workerId,96)||!text(input.leaseToken,96)||!/^[a-f0-9]{64}$/.test(input.credentialFingerprint||'')||!text(input.clientId)||!methods(input.methods))fail('Checkout provider configuration is invalid');
 const {row,order,binding}=await context(env,orderId,input.environment),now=new Date().toISOString();
 if(row.state!=='running'||row.lease_mode!=='execute'||row.lease_owner!==input.workerId||row.lease_token!==input.leaseToken||row.lease_until<=now)fail('This worker cannot start Checkout',409);
 if(binding){if(binding.credentialFingerprint!==input.credentialFingerprint||row.client_id!==input.clientId)fail('Original Checkout credentials cannot change',409);return {mayCreate:false,binding};}
 const shopee=order.snapshot.checkout.paymentChoice==='shopeepay';
 if(shopee ? input.methods.length!==1||input.methods[0]!=='EMONEY_SHOPEEPAY' : input.methods.includes('EMONEY_SHOPEEPAY'))fail('Checkout methods do not match the original choice',409);
 const minutes=Math.floor((Date.parse(order.expiresAt)-Date.now())/60000);
 if(order.state!=='creating'||minutes<1||minutes>1440||order.total>999999999999)fail('This order cannot start another Checkout',409);
 const route=await paymentRoute(env,orderId,input.environment);
 const activeRoute=await env.DB.prepare(`SELECT 1 FROM commerce_payment_route_bindings b
  JOIN commerce_wallet_enrollments p ON p.id=b.platform_enrollment_id
  JOIN sellers ps ON ps.id=p.seller_id AND ps.status='active' JOIN sellers ss ON ss.id=b.seller_id AND ss.status='active'
  WHERE b.order_id=? AND p.seller_id=?`).bind(orderId,env.COMMERCE_PLATFORM_WALLET_SELLER||'').first();
 if(!activeRoute)fail('The original active payment destinations are required',409);
 if(!route?.routing||route.binding.credentialFingerprint!==input.credentialFingerprint||route.clientId!==input.clientId)fail('Confirmed original payment routing is required',409);
 const origin=deploymentProfile(env)?.origin;if(!origin)fail('Checkout origin is unavailable',503);
 const frozen={environment:order.environment,credentialFingerprint:input.credentialFingerprint,externalId:order.paymentRequestId,orderId,amount:order.total,
 name:order.customer.name,email:order.customer.email,expiresAt:new Date(order.expiresAt).toISOString().replace(/\.\d{3}Z$/,'Z'),paymentDueMinutes:minutes,methods:[...input.methods].sort(),
 returnUrl:origin+'/cart/payment.php?order='+orderId,notificationUrl:origin+'/cart/api/doku-hosted-webhook.php',routing:route.routing};
 await requireSellingOnboarding(env,order.sellerId,input.environment);
 try{await env.DB.prepare(`INSERT INTO commerce_hosted_payment_bindings(order_id,seller_id,commerce_environment,job_id,attempt_id,credential_fingerprint,client_id,external_id,binding_json,created_at) VALUES(?,?,?,?,?,?,?,?,?,?)`)
 .bind(orderId,order.sellerId,order.environment,row.job_id,row.job_id+':'+row.attempts,input.credentialFingerprint,input.clientId,order.paymentRequestId,JSON.stringify(frozen),now).run();}
 catch(e){if(/commerce_hosted_|payment_route_|UNIQUE/.test(String(e)))fail('Checkout dispatch changed. Reconcile the original request.',409);throw e;}
 return {mayCreate:true,binding:frozen};
}
export async function recordHostedPaymentReceipt(env,orderId,input){
 fields(input,['environment','credentialFingerprint','operation','externalId','sentAt','observedAt','requestBody','body']);
 const {row,order,binding:b}=await context(env,orderId,input.environment);
 if(!b||b.credentialFingerprint!==input.credentialFingerprint)fail('Checkout receipt does not match its original dispatch',409);
 if(!text(input.externalId)||!['checkout-create','checkout-notification'].includes(input.operation))fail('Checkout receipt identity is invalid');
 const sent=date(input.sentAt),observed=date(input.observedAt);if(sent>Date.now()+300000||observed>Date.now()+300000||observed<sent-300000)fail('Checkout receipt time is invalid');
 const raw=decode(input.body);let type,data,eventKey,reference=null;
 if(input.operation==='checkout-create'){
  const request=decode(input.requestBody,16000),response=raw.response,p=response?.payment,o=response?.order;
  if(input.externalId!==b.externalId||await commerceHash(request)!==await commerceHash(hostedPayload(b))||!Array.isArray(raw.message)||raw.message.length!==1||raw.message[0]!=='SUCCESS'
   ||o?.invoice_number!==orderId||(o.currency!==undefined&&o.currency!=='IDR')||!text(p?.token_id)||typeof p.expired_date!=='string'||!/^\d{14}$/.test(p.expired_date)
   ||(p.payment_method_types!==undefined&&(!methods(p.payment_method_types)||p.payment_method_types.some(m=>!b.methods.includes(m)))))fail('Checkout session does not match the original request',409);
  exactAmount(input.body,['response','order','amount'],order.total);
  if(response.additionalInfo?.account!==undefined&&(response.additionalInfo.account.id!==b.routing.profileId||response.additionalInfo.account.split_rule_id!==b.routing.splitRuleId))fail('Checkout returned different routing',409);
  const d=p.expired_date,expiry=d.slice(0,4)+'-'+d.slice(4,6)+'-'+d.slice(6,8)+'T'+d.slice(8,10)+':'+d.slice(10,12)+':'+d.slice(12,14)+'+07:00',stamp=Date.parse(expiry);
  if(!Number.isFinite(stamp)||new Date(stamp+7*3600000).toISOString().slice(0,19).replaceAll(/[-T:]/g,'')!==d||stamp>Date.parse(b.expiresAt)+60000||stamp<Date.parse(row.created_at))fail('Checkout expiry is invalid',409);
  let url;try{url=new URL(p.url);}catch{fail('Checkout URL is invalid');}
  if(url.search||url.hash||!/^\/(?:checkout-link(?:-v2)?|checkout\/link)\/[A-Za-z0-9_-]+$/.test(url.pathname)||url.pathname.split('/').pop()!==p.token_id)fail('Checkout token does not match the payment URL',409);
  type='payment.created';eventKey='hosted_created:'+b.externalId;data={provider:'doku',providerRequestId:b.externalId,amount:order.total,currency:'IDR',expiresAt:new Date(stamp).toISOString(),paymentUrl:p.url};
 }else{
  if(input.requestBody!==null||raw.order?.invoice_number!==orderId||(raw.order.currency!==undefined&&raw.order.currency!=='IDR')||!b.methods.includes(raw.channel?.id==='QRIS_DOKU'?'QRIS':raw.channel?.id==='EMONEY_SHOPEE_PAY'?'EMONEY_SHOPEEPAY':raw.channel?.id))fail('Checkout notification does not match the original payment',409);
  exactAmount(input.body,['order','amount'],order.total);
  // Channel-specific stable payment references are checked below; Request-Id
  // identifies delivery, never a charge. Pending/failed observations save only.
  const status=raw.transaction?.status;if(!['SUCCESS','PENDING','FAILED','TIMEOUT','EXPIRED','REDIRECT'].includes(status))fail('Unsupported Checkout payment status',409);
  if(status==='SUCCESS'){
   // Five-minute local clock tolerance; delayed delivery is still accepted.
   if(date(raw.transaction.date)<Date.parse(row.created_at)-300000)fail('Payment predates the original Checkout',409);
   const charge=hostedCharge(raw);reference='doku_checkout_'+await commerceHash(JSON.stringify([order.environment,row.client_id,orderId,raw.channel.id,charge]));
   type='payment.succeeded';eventKey='capture:'+reference;data={provider:'doku',verified:true,amount:order.total,currency:'IDR',reference,bankReference:charge,originalRequestId:b.externalId,channel:raw.channel.id};
  }
 }
 const bodyHash=await commerceHash(input.body),receiptId='checkoutr_'+await commerceHash({orderId,operation:input.operation,credentialFingerprint:b.credentialFingerprint,externalId:input.externalId,sentAt:input.sentAt,bodyHash,requestBody:input.requestBody});
 const statement=env.DB.prepare(`INSERT INTO commerce_hosted_payment_receipts(id,order_id,credential_fingerprint,operation,external_id,sent_at,observed_at,body_hash,body_json,request_json,payment_reference,received_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(id) DO NOTHING`)
 .bind(receiptId,orderId,b.credentialFingerprint,input.operation,input.externalId,input.sentAt,input.observedAt,bodyHash,input.body,input.requestBody,reference,new Date().toISOString());
 let saved=order;try{if(type)saved=await applyCommerceEvent(env,orderId,{environment:order.environment,sellerId:order.sellerId,eventKey,type,data},{paymentReceipt:{orderId,type,statements:[statement]}});else await statement.run();}
 catch(e){if(/commerce_hosted_|UNIQUE/.test(String(e)))fail('Checkout receipt conflicts with the original payment',409);throw e;}
 return {recorded:true,receiptId,order:saved,paymentConfirmed:reference!==null,settlementVerified:false};
}
function hostedCharge(raw){
 // Local invoice-scoped correlation of documented economic facts. This is not
 // a provider-issued global ID. Notification delivery IDs/times are excluded.
 const channel=raw.channel?.id,acquirer=raw.acquirer?.id,at=raw.transaction?.date;
 if(!text(acquirer)||date(at)>Date.now()+300000)fail('Provider transaction details are invalid',409);
 if(channel==='QRIS_DOKU'){
  if(raw.service?.id!=='QRIS'||!text(raw.emoney_payment?.account_id)||!text(raw.emoney_payment?.approval_code))fail('QRIS payment details are incomplete',409);
  return JSON.stringify([acquirer,at,raw.emoney_payment.account_id,raw.emoney_payment.approval_code]);
 }
 if(channel==='EMONEY_SHOPEE_PAY'){
  const p=raw.shopeepay_payment;
  if(raw.service?.id!=='EMONEY'||acquirer!=='SHOPEE_PAY'||!text(raw.transaction?.original_request_id)
   ||(p?.transaction_status!==undefined&&p.transaction_status!=='3')
   ||(p?.transaction_message!==undefined&&p.transaction_message!=='SUCCESS'))fail('ShopeePay payment details are incomplete or inconsistent',409);
  // Mandatory original request identifies the payment; optional issuer fields
  // must not change its identity between redeliveries of the same payment.
  return JSON.stringify([acquirer,raw.transaction.original_request_id]);
 }
 if(channel==='CREDIT_CARD'){
  if(raw.service?.id!=='CREDIT_CARD'||raw.transaction?.type!=='SALE'||!text(raw.transaction?.original_request_id)||!text(raw.card_payment?.approval_code)
   ||raw.card_payment?.response_code!=='00')fail('Card sale details are incomplete or unsupported',409);
  return JSON.stringify([acquirer,at,raw.transaction.original_request_id,raw.card_payment.approval_code]);
 }
 if(channel==='VIRTUAL_ACCOUNT_BCA'){
  const identifiers=raw.virtual_account_payment?.identifier??raw.virtual_account_payment?.identifer;
  const refs=Array.isArray(identifiers)?identifiers.filter(v=>v?.name==='REFERENCE').map(v=>v.value):[];
  if(raw.service?.id!=='VIRTUAL_ACCOUNT'||acquirer!=='BCA'||!text(raw.transaction?.original_request_id)||!/^\d{8,23}$/.test(raw.virtual_account_info?.virtual_account_number||'')
   ||refs.length!==1||!text(refs[0]))fail('BCA payment reference is incomplete',409);
  return JSON.stringify([acquirer,raw.transaction.original_request_id,raw.virtual_account_info.virtual_account_number,refs[0]]);
 }
 fail('Unsupported Checkout channel',409);
}
