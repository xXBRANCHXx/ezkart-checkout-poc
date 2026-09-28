import {commerceStorageEnabled} from './commerce-orders.js';
import {currentCommerceEnvironment,customerOrderSeller} from './commerce-access.js';
import {serveDigitalFile,digitalPartBytes} from './digital-files.js';

const fail=(message,status=422,code='')=>{throw new Response(message,{status,headers:code?{'x-ezkart-error-code':code}:{}});};
const iso=()=>new Date().toISOString();
const enabled=env=>{if(!commerceStorageEnabled(env))fail('Central commerce storage is not enabled',503);};
const itemId=value=>{if(typeof value!=='string'||!/^item_[A-Za-z0-9-]{3,90}$/.test(value))fail('Download not found.',404);};
const state=row=>row.payment_review?'payment_review':row.refund_partial?'refund_review':row.refund_revoked?'refunded':row.checkout_state==='partially_refunded'&&!row.allocated_refund?'refund_review':
  ['paid','partially_refunded'].includes(row.checkout_state)?(row.capture_id?'available':'unavailable'):row.checkout_state;
const requireAvailable=row=>{if(state(row)!=='available')fail(state(row)==='refund_review'?
  'Downloads are on hold while the refunded items are reviewed. Contact support.':
  'This purchase is not currently available for download.',409,'digital_access_unavailable');};
const failure=error=>{
  const message=String(error?.message||'')+' '+String(error?.cause?.message||'');
  if(message.includes('commerce_digital_download_limit'))fail('Too many download requests. Wait before requesting another download.',429,'digital_download_limit');
  if(message.includes('commerce_digital_access_changed'))fail('Your purchase access changed. Reload before downloading.',409,'digital_access_changed');
  if(message.includes('commerce_digital_proof_invalid'))fail('The complete file bytes could not be verified. Retry this part.',409,'digital_proof_invalid');
  throw error;
};
const purchaseSql=`SELECT p.order_item_id,p.order_id,p.seller_id,p.version_id,i.title,i.quantity,i.fulfillment_snapshot_json,
  o.checkout_state,o.payment_review,
  EXISTS(SELECT 1 FROM commerce_refund_order_totals t WHERE t.order_id=o.id AND t.refunded_amount<o.total_amount) AS allocated_refund,
  EXISTS(SELECT 1 FROM commerce_digital_refund_revocations r WHERE r.order_item_id=p.order_item_id AND r.capture_id=e.capture_id) AS refund_revoked,
  EXISTS(SELECT 1 FROM commerce_digital_refund_revocations r WHERE r.order_item_id=p.order_item_id AND r.capture_id=e.capture_id AND r.fully_refunded=0) AS refund_partial,
  e.capture_id,u.*,v.version,d.verified_at AS delivered_at FROM commerce_digital_purchases p
  JOIN order_items i ON i.id=p.order_item_id JOIN orders o ON o.id=p.order_id
  JOIN digital_product_versions v ON v.id=p.version_id JOIN digital_file_uploads u ON u.id=v.upload_id
  LEFT JOIN commerce_digital_entitlements e ON e.order_item_id=p.order_item_id
  LEFT JOIN commerce_digital_deliveries d ON d.order_item_id=p.order_item_id
  WHERE p.order_id=? AND p.seller_id=? AND o.commerce_environment=?`;

async function purchase(env,user,orderId,orderItemId){
  enabled(env);itemId(orderItemId);
  const sellerId=await customerOrderSeller(env,user,orderId);
  const row=await env.DB.prepare(purchaseSql+' AND p.order_item_id=?').bind(orderId,sellerId,currentCommerceEnvironment(env),orderItemId).first();
  if(!row)fail('Download not found.',404);
  return row;
}
export async function buyerDigitalPurchases(env,user,orderId){
  enabled(env);const sellerId=await customerOrderSeller(env,user,orderId);
  const rows=(await env.DB.prepare(purchaseSql+' ORDER BY p.order_item_id').bind(orderId,sellerId,currentCommerceEnvironment(env)).all()).results;
  return {orderId,items:rows.map(row=>({orderItemId:row.order_item_id,title:row.title,quantity:row.quantity,
    variantName:JSON.parse(row.fulfillment_snapshot_json).variantName||'',
    file:{id:row.version_id,version:row.version,filename:row.filename,size:row.size_bytes},
    state:state(row),canDownload:state(row)==='available',deliveryConfirmed:Boolean(row.delivered_at),deliveredAt:row.delivered_at||null})),
    deliveryPolicy:'verified_complete_download',deliveryVerificationAvailable:true};
}
const grantView=row=>({id:row.id,orderItemId:row.order_item_id,createdAt:row.created_at,expiresAt:row.expires_at,expired:Date.parse(row.expires_at)<=Date.now()});
export async function createDigitalDownloadGrant(env,user,orderId,orderItemId,input){
  const row=await purchase(env,user,orderId,orderItemId);requireAvailable(row);
  if(!input||typeof input!=='object'||Array.isArray(input)||Object.keys(input).some(key=>key!=='requestKey')
    ||typeof input.requestKey!=='string'||!/^[A-Za-z0-9_-]{16,100}$/.test(input.requestKey))fail('Download request identity is invalid.');
  const existing=()=>env.DB.prepare('SELECT * FROM commerce_digital_download_grants WHERE auth_user_id=? AND request_key=?').bind(user.id,input.requestKey).first();
  const replay=receipt=>{if(receipt.order_item_id!==orderItemId)fail('This request was already used for another download.',409,'digital_download_conflict');return {grant:grantView(receipt)};};
  const previous=await existing();if(previous)return replay(previous);
  const now=iso(),expiresAt=new Date(Date.parse(now)+86400000).toISOString(),id='dgrant_'+crypto.randomUUID().replaceAll('-','');
  try{await env.DB.prepare(`INSERT INTO commerce_digital_download_grants(id,order_item_id,auth_user_id,request_key,created_at,expires_at)
    VALUES (?,?,?,?,?,?)`).bind(id,orderItemId,user.id,input.requestKey,now,expiresAt).run();}
  catch(error){const saved=await existing();if(saved)return replay(saved);failure(error);}
  // A grant response can be recovered after any lost reply. It remains bound
  // to the buyer and must pass current authorization when it is used.
  return {grant:{id,orderItemId,createdAt:now,expiresAt,expired:false}};
}

async function authorizeGrant(env,user,orderId,orderItemId,grantId){
  if(!/^dgrant_[a-f0-9]{32}$/.test(grantId||''))fail('Download not found.',404);
  const row=await purchase(env,user,orderId,orderItemId);requireAvailable(row);
  const grant=await env.DB.prepare('SELECT * FROM commerce_digital_download_grants WHERE id=? AND order_item_id=? AND auth_user_id=?')
    .bind(grantId,orderItemId,user.id).first();
  if(!grant)fail('Download not found.',404);
  if(Date.parse(grant.expires_at)<=Date.now())fail('This download request expired. Request another download.',410,'digital_download_expired');
  if(row.state!=='ready'||!row.retained_at)fail('The purchased file is temporarily unavailable. Contact support.',503,'digital_integrity');
  return {row,grant};
}
function requestStatement(env,grantId,range,now=iso()){
  return env.DB.prepare(`INSERT INTO commerce_digital_download_requests(id,grant_id,requested_range,authorized_at) VALUES (?,?,?,?)`)
    .bind('dreq_'+crypto.randomUUID().replaceAll('-',''),grantId,range,now);
}
export async function buyerDigitalFile(env,user,orderId,orderItemId,grantId,request){
  const authorize=async()=>(await authorizeGrant(env,user,orderId,orderItemId,grantId)).row;
  const row=await authorize();
  return serveDigitalFile(env,row,request,async()=>{
    await authorize();
    if(request.method==='HEAD')return;
    // This records authorization to start a byte response, never completed
    // delivery. Browser integrity acknowledgement is a separate contract.
    try{await requestStatement(env,grantId,request.headers.get('range')||'').run();}
    catch(error){failure(error);}
  });
}

const hex=bytes=>[...new Uint8Array(bytes)].map(v=>v.toString(16).padStart(2,'0')).join('');
const sha=async bytes=>hex(await crypto.subtle.digest('SHA-256',bytes));
export async function digitalDownloadProof(grantId,part,nonce,bytes){
  const prefix=new TextEncoder().encode(`ezkart-digital-part-v1\n${grantId}\n${part}\n${nonce}\n`),input=new Uint8Array(prefix.length+bytes.length);
  input.set(prefix);input.set(bytes,prefix.length);return sha(input);
}
const partNumber=value=>{if(!Number.isInteger(value)||value<1||value>100)fail('Download part not found.',404);return value;};
export async function readDigitalDownloadGrant(env,user,orderId,orderItemId,grantId){
  const {row,grant}=await authorizeGrant(env,user,orderId,orderItemId,grantId);
  const parts=(await env.DB.prepare(`SELECT c.part_number,c.nonce,r.verified_at FROM commerce_digital_part_challenges c
    LEFT JOIN commerce_digital_part_receipts r ON r.grant_id=c.grant_id AND r.part_number=c.part_number
    WHERE c.grant_id=? ORDER BY c.part_number`).bind(grantId).all()).results;
  return {grant:grantView(grant),file:{filename:row.filename,size:row.size_bytes,partSize:digitalPartBytes,manifest:JSON.parse(row.manifest_json)},
    parts:parts.map(p=>({number:p.part_number,nonce:p.nonce,verifiedAt:p.verified_at||null})),deliveryConfirmed:Boolean(row.delivered_at),deliveredAt:row.delivered_at||null};
}

export async function buyerDigitalPart(env,user,orderId,orderItemId,grantId,number){
  partNumber(number);const {row}=await authorizeGrant(env,user,orderId,orderItemId,grantId);
  if(number>row.part_count)fail('Download part not found.',404);
  const offset=(number-1)*digitalPartBytes,length=Math.min(digitalPartBytes,row.size_bytes-offset);
  const object=await env.PRIVATE_ASSETS.get(row.r2_key,{range:{offset,length}});
  if(!object?.body||object.size!==row.size_bytes||object.customMetadata?.digitalUpload!==row.id||object.customMetadata?.requestHash!==row.request_hash){
    await object?.body?.cancel();fail('The purchased file could not be verified. Contact support.',503,'digital_integrity');
  }
  const bytes=new Uint8Array(await new Response(object.body).arrayBuffer()),checksum=JSON.parse(row.manifest_json)[number-1];
  if(bytes.length!==length||await sha(bytes)!==checksum)fail('The purchased file could not be verified. Contact support.',503,'digital_integrity');
  await authorizeGrant(env,user,orderId,orderItemId,grantId);
  const existing=await env.DB.prepare('SELECT nonce FROM commerce_digital_part_challenges WHERE grant_id=? AND part_number=?').bind(grantId,number).first();
  const nonce=existing?.nonce||hex(crypto.getRandomValues(new Uint8Array(32))),proof=await digitalDownloadProof(grantId,number,nonce,bytes),now=iso();
  try{await env.DB.batch([
    env.DB.prepare(`INSERT INTO commerce_digital_part_challenges(grant_id,part_number,nonce,proof_hash,created_at)
      SELECT ?,?,?,?,? WHERE NOT EXISTS (SELECT 1 FROM commerce_digital_part_challenges WHERE grant_id=? AND part_number=?)`)
      .bind(grantId,number,nonce,proof,now,grantId,number),requestStatement(env,grantId,'part='+number,now),
  ]);}catch(error){failure(error);}
  // Concurrent requests use the committed challenge, never a losing nonce.
  const saved=await env.DB.prepare('SELECT nonce FROM commerce_digital_part_challenges WHERE grant_id=? AND part_number=?').bind(grantId,number).first();
  await authorizeGrant(env,user,orderId,orderItemId,grantId);
  return new Response(bytes,{headers:{'content-type':'application/octet-stream','content-length':String(bytes.length),
    'cache-control':'private, no-store','x-content-type-options':'nosniff','content-security-policy':"default-src 'none'; sandbox",
    'x-ezkart-file-challenge':saved.nonce,'x-ezkart-file-sha256':checksum,'x-ezkart-file-part':String(number)}});
}

export async function acknowledgeDigitalPart(env,user,orderId,orderItemId,grantId,number,input){
  partNumber(number);await authorizeGrant(env,user,orderId,orderItemId,grantId);
  if(!input||typeof input!=='object'||Array.isArray(input)||Object.keys(input).length!==1||typeof input.proof!=='string'||!/^[a-f0-9]{64}$/.test(input.proof))fail('A file verification proof is required.');
  const previous=await env.DB.prepare('SELECT proof_hash FROM commerce_digital_part_receipts WHERE grant_id=? AND part_number=?').bind(grantId,number).first();
  if(previous){if(previous.proof_hash!==input.proof)fail('This file part was already verified with different proof.',409,'digital_proof_invalid');}
  else try{await env.DB.prepare(`INSERT INTO commerce_digital_part_receipts(grant_id,part_number,proof_hash,verified_at)
    SELECT ?,?,?,? WHERE NOT EXISTS (SELECT 1 FROM commerce_digital_part_receipts WHERE grant_id=? AND part_number=?)`)
    .bind(grantId,number,input.proof,iso(),grantId,number).run();}
  catch(error){failure(error);}
  const committed=await env.DB.prepare('SELECT proof_hash FROM commerce_digital_part_receipts WHERE grant_id=? AND part_number=?').bind(grantId,number).first();
  if(committed?.proof_hash!==input.proof)fail('This file part was already verified with different proof.',409,'digital_proof_invalid');
  return readDigitalDownloadGrant(env,user,orderId,orderItemId,grantId);
}
