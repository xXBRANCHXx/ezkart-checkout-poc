import {commerceHash,commerceStorageEnabled} from './commerce-orders.js';
import {commerceReadEnvironment} from './commerce-order-reads.js';
import {deploymentProfile} from './deployment.js';

const fail=(message,status=400)=>{throw new Response(message,{status});};
const unavailable=()=>fail('This unsubscribe link is unavailable.',404);
const tokenPattern=/^[a-f0-9]{64}$/;
const tokenHash=token=>commerceHash({purpose:'campaign_unsubscribe',token});
const id=value=>typeof value==='string'&&/^[A-Za-z0-9][A-Za-z0-9_-]{2,95}$/.test(value);
const publicView=row=>({storeName:row.store_name,emailHint:[...row.email.split('@')[0]][0]+'•••@'+row.email.split('@').slice(1).join('@'),unsubscribed:row.allowed===0});
const read=(env,hash)=>env.DB.prepare(`SELECT t.token_hash,t.seller_id,t.commerce_environment,t.auth_user_id,t.email,c.revision,c.allowed,s.name AS store_name
  FROM commerce_unsubscribe_tokens t JOIN commerce_customer_consents c ON c.seller_id=t.seller_id AND c.commerce_environment=t.commerce_environment
    AND c.auth_user_id=t.auth_user_id AND c.email=t.email JOIN sellers s ON s.id=t.seller_id
  WHERE t.token_hash=? AND t.commerce_environment=?`).bind(hash,commerceReadEnvironment(env)).first();

// Prepare for a campaign outbox message; never expose an issuance API to a
// merchant or public caller.
// The caller must atomically batch this statement with its immutable message
// containing the returned URL. An outbox retry reads that original message.
export async function prepareCampaignUnsubscribe(env,input){
  if(!commerceStorageEnabled(env))fail('Campaign preparation is not enabled.',503);
  if(!input||typeof input!=='object'||Array.isArray(input)||Object.keys(input).some(k=>!['sellerId','authUserId','email','reference','consentRevision'].includes(k))
    ||!id(input.sellerId)||!id(input.authUserId)||typeof input.email!=='string'||input.email.length>160||input.email!==input.email.trim().toLowerCase()
    ||!/^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/.test(input.email)||typeof input.reference!=='string'||!/^[A-Za-z0-9][A-Za-z0-9_.:-]{2,159}$/.test(input.reference)
    ||!Number.isSafeInteger(input.consentRevision)||input.consentRevision<1)fail('Campaign unsubscribe reference is invalid.',422);
  const token=Array.from(crypto.getRandomValues(new Uint8Array(32)),b=>b.toString(16).padStart(2,'0')).join(''),hash=await tokenHash(token),mode=commerceReadEnvironment(env);
  return {tokenHash:hash,url:deploymentProfile(env).origin+'/cart/unsubscribe.php?t='+token,
    statement:env.DB.prepare(`INSERT INTO commerce_unsubscribe_tokens(token_hash,seller_id,commerce_environment,auth_user_id,email,reference,consent_revision,created_at) VALUES(?,?,?,?,?,?,?,?)`)
      .bind(hash,input.sellerId,mode,input.authUserId,input.email,input.reference,input.consentRevision,new Date().toISOString())};
}

function queryToken(url){
  if([...url.searchParams.keys()].length!==1||!url.searchParams.has('t')||!tokenPattern.test(url.searchParams.get('t')||''))unavailable();return url.searchParams.get('t');
}
async function body(request){
  const type=request.headers.get('content-type')||'',length=request.headers.get('content-length');
  if(type.length>200||!/^application\/x-www-form-urlencoded(?:\s*;\s*charset=utf-8)?\s*$/i.test(type)&&!/^multipart\/form-data\s*;/i.test(type))fail('Use an unsubscribe form request.',415);
  if(length!==null&&(!/^\d+$/.test(length)||Number(length)>8192))fail('Unsubscribe request is too large.',413);
  const reader=request.body?.getReader();if(!reader)fail('Unsubscribe confirmation is required.');const chunks=[];let size=0;
  try{while(true){const {done,value}=await reader.read();if(done)break;size+=value.byteLength;if(size>8192){await reader.cancel();fail('Unsubscribe request is too large.',413);}chunks.push(value);}}finally{reader.releaseLock();}
  const bytes=new Uint8Array(size);let at=0;for(const chunk of chunks){bytes.set(chunk,at);at+=chunk.byteLength;}
  let form;
  try{form=/^multipart\//i.test(type)?await new Request('https://unsubscribe.invalid/',{method:'POST',headers:{'content-type':type},body:bytes}).formData():new URLSearchParams(new TextDecoder('utf-8',{fatal:true}).decode(bytes));}
  catch{fail('Unsubscribe confirmation is invalid.');}
  if([...form.keys()].length!==1||form.get('List-Unsubscribe')!=='One-Click')fail('Unsubscribe confirmation is invalid.');
}

export async function campaignUnsubscribe(env,request){
  const url=new URL(request.url);
  if(!['GET','HEAD','POST'].includes(request.method))fail('Method not allowed.',405);
  const hash=await tokenHash(queryToken(url));
  if(request.method==='POST')await body(request);
  // No account cookies, authorization headers, active-store selection or sending
  // flags participate in a capability-authorized withdrawal.
  for(let attempt=0;attempt<3;attempt++){
    const row=await read(env,hash);if(!row)unavailable();
    if(request.method!=='POST'||row.allowed===0)return {...publicView(row),changed:false};
    if(row.revision>=Number.MAX_SAFE_INTEGER)fail('This email preference needs support. Please try again later.',503);
    const changeId='cuw_'+(await commerceHash({hash,revision:row.revision})).slice(0,32);
    try{
      const saved=await env.DB.prepare(`INSERT INTO commerce_unsubscribe_changes(id,token_hash,seller_id,commerce_environment,auth_user_id,email,expected_revision,revision,statement,created_at)
        SELECT ?,t.token_hash,t.seller_id,t.commerce_environment,t.auth_user_id,t.email,c.revision,c.revision+1,
          'I withdraw permission for promotional emails from '||s.name||' at '||t.email||'. Order and delivery updates are unaffected.',?
        FROM commerce_unsubscribe_tokens t JOIN commerce_customer_consents c ON c.seller_id=t.seller_id AND c.commerce_environment=t.commerce_environment
          AND c.auth_user_id=t.auth_user_id AND c.email=t.email JOIN sellers s ON s.id=t.seller_id
        WHERE t.token_hash=? AND t.commerce_environment=? AND c.revision=? AND c.allowed=1`)
        .bind(changeId,new Date().toISOString(),hash,commerceReadEnvironment(env),row.revision).run();
      if(saved.meta.changes>0)return {...publicView(row),unsubscribed:true,changed:true};
    }catch(error){if(!(String(error)+' '+String(error.cause||'')).includes('consent_unsubscribe_conflict'))throw error;}
  }
  fail('Your email preference changed. Please try the unsubscribe link again.',409);
}
