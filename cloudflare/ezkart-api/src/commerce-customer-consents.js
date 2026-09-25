import {commerceEnvironment,commerceHash} from './commerce-orders.js';
import {claimCommerceOrder} from './commerce-access.js';

const fail=(message,status=422)=>{throw new Response(message,{status});};
const policyVersion='email-promotions-v1';
const ownerSql=`SELECT DISTINCT o.seller_id FROM orders o LEFT JOIN commerce_order_owners a ON a.order_id=o.id
  WHERE o.commerce_environment=? AND o.commerce_version=1
    AND COALESCE(a.auth_user_id,NULLIF(json_extract(o.customer_snapshot_json,'$.authUserId'),''))=?`;
const emailValid=value=>typeof value==='string'&&value.length<=160&&value===value.trim().toLowerCase()&&/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
const idValid=value=>typeof value==='string'&&/^[A-Za-z0-9][A-Za-z0-9_-]{2,95}$/.test(value);
const encode=value=>btoa(Array.from(new TextEncoder().encode(JSON.stringify(value)),b=>String.fromCharCode(b)).join('')).replaceAll('+','-').replaceAll('/','_').replace(/=+$/,'');
function decode(value,scope){
  let data;
  try{if(typeof value!=='string'||!/^[A-Za-z0-9_-]{1,1800}$/.test(value))throw Error();data=JSON.parse(new TextDecoder().decode(Uint8Array.from(atob(value.replaceAll('-','+').replaceAll('_','/')),c=>c.charCodeAt(0))));}catch{fail('Preference page reference is invalid');}
  if(data?.v!==1||data.scope!==scope)fail('Preference page belongs to another account or view');
  return data;
}
const statement=(name,email)=>`I agree to receive promotional emails from ${name} at ${email}. I can stop these emails in Email preferences at any time. This choice does not affect order and delivery updates.`;
function view(row,currentEmail){
  return {sellerId:row.seller_id,storeName:row.store_name,email:row.email,revision:row.revision||0,
    state:row.revision?(row.allowed?'granted':'withdrawn'):'not_recorded',updatedAt:row.updated_at||null,
    canGrant:row.email===currentEmail&&row.store_status==='active'&&Boolean(row.owned),
    policyVersion,statement:statement(row.store_name,row.email)};
}
const preference=(env,mode,id,seller,email)=>env.DB.prepare(`SELECT c.*,s.name AS store_name,s.status AS store_status,
  EXISTS(SELECT 1 FROM (${ownerSql}) WHERE seller_id=c.seller_id) AS owned
  FROM commerce_customer_consents c JOIN sellers s ON s.id=c.seller_id
  WHERE c.seller_id=? AND c.commerce_environment=? AND c.auth_user_id=? AND c.email=?`).bind(mode,id,seller,mode,id,email).first();
const receipt=(env,mode,id,key)=>env.DB.prepare('SELECT * FROM commerce_customer_consent_changes WHERE auth_user_id=? AND commerce_environment=? AND request_key=?').bind(id,mode,key).first();

// Identity is supplied only by the signed PHP service after verifying the Google
// account. No merchant bearer route accepts or writes a buyer's permission.
export async function customerConsents(env,input){
  if(!input||typeof input!=='object'||Array.isArray(input))fail('Preference request is invalid');
  const {customer,action}=input,fields={list:['orderId','cursor'],history:['sellerId','email','cursor'],save:['sellerId','email','revision','requestKey','allow','policyVersion','statement']}[action];
  if(!fields||Object.keys(input).some(k=>!['customer','environment','action',...fields].includes(k))
    ||!customer||Object.keys(customer).some(k=>!['id','email'].includes(k))||!idValid(customer.id)||!emailValid(customer.email))fail('Verified preference identity is invalid');
  const mode=commerceEnvironment(env,input.environment),id=customer.id,email=customer.email;
  if(input.cursor!==undefined&&(typeof input.cursor!=='string'||!input.cursor))fail('Preference page reference is invalid');
  if(action==='list'){
    if(input.orderId!==undefined){if(typeof input.orderId!=='string')fail('Order reference is invalid');await claimCommerceOrder(env,input.orderId,{environment:mode,customer});}
    const scope=await commerceHash({id,email,mode,kind:'consent_list'}),cursor=input.cursor?decode(input.cursor,scope):null;
    if(cursor&&(!idValid(cursor.seller)||!emailValid(cursor.email)))fail('Preference page reference is invalid');
    const rows=await env.DB.prepare(`WITH owned AS (${ownerSql}), available AS (
      SELECT seller_id FROM owned UNION SELECT seller_id FROM commerce_customer_consents WHERE auth_user_id=? AND commerce_environment=?
    ), choices AS (
      SELECT seller_id,? AS email FROM available UNION SELECT seller_id,email FROM commerce_customer_consents WHERE auth_user_id=? AND commerce_environment=?
    ) SELECT k.seller_id,k.email,s.name AS store_name,s.status AS store_status,c.revision,c.allowed,c.updated_at,
      EXISTS(SELECT 1 FROM owned WHERE seller_id=k.seller_id) AS owned
      FROM choices k JOIN sellers s ON s.id=k.seller_id LEFT JOIN commerce_customer_consents c ON c.seller_id=k.seller_id
        AND c.commerce_environment=? AND c.auth_user_id=? AND c.email=k.email
      ${cursor?'WHERE k.seller_id>? OR (k.seller_id=? AND k.email>?)':''}
      ORDER BY k.seller_id,k.email LIMIT 26`).bind(mode,id,id,mode,email,id,mode,mode,id,...(cursor?[cursor.seller,cursor.seller,cursor.email]:[])).all();
    const items=rows.results.slice(0,25),last=items.at(-1);
    return {email,environment:mode,items:items.map(row=>view(row,email)),nextCursor:rows.results.length>25?encode({v:1,scope,seller:last.seller_id,email:last.email}):null};
  }
  if(!idValid(input.sellerId)||!emailValid(input.email))fail('Preference reference is invalid');
  const current=await preference(env,mode,id,input.sellerId,input.email);
  if(action==='history'){
    if(!current)fail('Preference history not found',404);
    const scope=await commerceHash({id,mode,seller:input.sellerId,email:input.email,kind:'consent_history'}),cursor=input.cursor?decode(input.cursor,scope):null;
    if(cursor&&(!Number.isSafeInteger(cursor.before)||!Number.isSafeInteger(cursor.cap)||cursor.before<1||cursor.cap<cursor.before))fail('Preference history reference is invalid');
    const cap=cursor?.cap??current.revision,before=cursor?.before??cap+1;
    const rows=await env.DB.prepare(`SELECT revision,allowed,policy_version,statement,source,created_at FROM commerce_customer_consent_changes
      WHERE seller_id=? AND commerce_environment=? AND auth_user_id=? AND email=? AND revision<=? AND revision<? ORDER BY revision DESC LIMIT 21`)
      .bind(input.sellerId,mode,id,input.email,cap,before).all(),items=rows.results.slice(0,20);
    return {items:items.map(row=>({revision:row.revision,state:row.allowed?'granted':'withdrawn',policyVersion:row.policy_version,statement:row.statement,source:row.source,createdAt:row.created_at})),
      nextCursor:rows.results.length>20?encode({v:1,scope,cap,before:items.at(-1).revision}):null};
  }
  if(typeof input.allow!=='boolean'||!Number.isSafeInteger(input.revision)||input.revision<0||input.revision>=Number.MAX_SAFE_INTEGER
    ||typeof input.requestKey!=='string'||!/^[a-f0-9]{32}$/.test(input.requestKey)||input.policyVersion!==policyVersion
    ||typeof input.statement!=='string'||input.statement.length>1000)fail('Email preference choice is invalid');
  const hash=await commerceHash({seller:input.sellerId,email:input.email,revision:input.revision,allow:input.allow,policyVersion,statement:input.statement}),old=await receipt(env,mode,id,input.requestKey);
  const result=async (saved,replayed)=>{
    if(saved.request_hash!==hash)fail('This request was already used for a different preference',409);
    const latest=await preference(env,mode,id,input.sellerId,input.email);
    return {receipt:{revision:saved.revision,state:saved.allowed?'granted':'withdrawn',createdAt:saved.created_at,replayed},preference:view(latest,email)};
  };
  if(old)return result(old,true);
  if(input.allow&&input.email!==email)fail('Only your currently verified email can receive new permission',403);
  const store=await env.DB.prepare(`SELECT s.name,s.status,EXISTS(SELECT 1 FROM (${ownerSql}) WHERE seller_id=s.id) AS owned FROM sellers s WHERE s.id=?`).bind(mode,id,input.sellerId).first();
  if(!store||(!store.owned&&!current)||(!current&&input.email!==email))fail('Preference not found',404);
  if(input.allow&&input.statement!==statement(store.name,input.email))fail('The email permission wording changed. Reload it before choosing again.',409);
  const text=input.allow?statement(store.name,input.email):`I withdraw permission for promotional emails from ${store.name} at ${input.email}. Order and delivery updates are unaffected.`;
  try{
    await env.DB.prepare(`INSERT INTO commerce_customer_consent_changes(seller_id,commerce_environment,auth_user_id,email,request_key,request_hash,
      expected_revision,revision,allowed,policy_version,statement,source,created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,'buyer_preferences',?)`)
      .bind(input.sellerId,mode,id,input.email,input.requestKey,hash,input.revision,input.revision+1,input.allow?1:0,policyVersion,text,new Date().toISOString()).run();
  }catch(error){
    const raced=await receipt(env,mode,id,input.requestKey);if(raced)return result(raced,true);
    if(String(error).includes('consent_revision_conflict'))fail('Your preference changed in another session. Reload it before choosing again.',409);
    if(String(error).includes('consent_owner_required'))fail('Preference not found',404);
    if(String(error).includes('consent_store_inactive'))fail('This store is not accepting new email permissions',409);
    throw error;
  }
  return result(await receipt(env,mode,id,input.requestKey),false);
}
