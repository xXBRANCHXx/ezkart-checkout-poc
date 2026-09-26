import {commerceHash} from './commerce-orders.js';
import {parseMessageJSON} from './message-json.js';

const encoder=new TextEncoder();
const fail=(code,message,options={})=>{throw Object.assign(new Error(message),{code,...options});};
export const emailAddress=value=>typeof value==='string'&&value.length<=254&&value===value.trim().toLowerCase()
  &&/^[a-z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?\.[a-z]{2,63}$/.test(value)
  &&!value.includes('..');
const stamp=value=>typeof value==='string'&&/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?(?:Z|[+-]\d{2}:\d{2})$/.test(value)&&Number.isFinite(Date.parse(value));
const profileId=value=>typeof value==='string'&&/^[A-Za-z0-9][A-Za-z0-9_-]{2,63}$/.test(value);
const webhookKey=value=>typeof value==='string'&&/^whsec_[A-Za-z0-9+/]{24,180}={0,2}$/.test(value);
export const emailProviderId=value=>typeof value==='string'&&/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(value);

export function emailWebhookProfiles(env){
  try{
    const raw=String(env.COMMERCE_EMAIL_WEBHOOKS||'');if(raw.length>4096)return {};
    const entries=JSON.parse(raw);if(!entries||typeof entries!=='object'||Array.isArray(entries)||Object.keys(entries).length>4)return {};
    for(const [id,value] of Object.entries(entries))if(!profileId(id)||!Array.isArray(value)||value.length<1||value.length>2||value.some(key=>!webhookKey(key)))return {};
    return entries;
  }catch{return {};}
}

// This status contains no credentials and is suitable for private merchant UI.
function emailConnection(env){
  const held={ready:false,reason:'not_connected'};
  if(env.COMMERCE_EMAIL_PROVIDER!=='resend')return held;
  if(env.COMMERCE_STORAGE!=='d1')return {ready:false,reason:'commerce_hold'};
  if(!['test','production'].includes(env.APP_ENVIRONMENT))return held;
  const sender=env.COMMERCE_EMAIL_FROM,profile=env.COMMERCE_EMAIL_PROFILE;
  if(!emailAddress(sender)||!profileId(profile))return held;
  if(typeof env.RESEND_API_KEY!=='string'||!/^re_[A-Za-z0-9_-]{12,240}$/.test(env.RESEND_API_KEY))return held;
  try{const auth=new URL(env.SUPABASE_URL);if(auth.protocol!=='https:'||auth.username||auth.password||auth.search||auth.hash||auth.port||auth.pathname!=='/')return held;}catch{return held;}
  return {ready:true,reason:'ready',sender,profile,environment:env.APP_ENVIRONMENT==='test'?'sandbox':'production',origin:env.APP_ENVIRONMENT==='test'?'https://test.ezkart.id':'https://ezkart.id'};
}
export function emailConfiguration(env){
  const held={ready:false,reason:'not_connected'};
  if(env.COMMERCE_EMAIL_SEND!=='enabled')return held;
  const connection=emailConnection(env);if(!connection.ready)return connection;
  const start=env.COMMERCE_EMAIL_START_AT;
  if(!stamp(start)||!Object.hasOwn(emailWebhookProfiles(env),connection.profile))return held;
  if(typeof env.SUPABASE_SERVICE_ROLE_KEY!=='string'||env.SUPABASE_SERVICE_ROLE_KEY.length<20||env.SUPABASE_SERVICE_ROLE_KEY.length>4096||/[\s\r\n]/.test(env.SUPABASE_SERVICE_ROLE_KEY))return held;
  let allowlist=[];
  if(env.APP_ENVIRONMENT==='test'){
    try{allowlist=JSON.parse(env.COMMERCE_EMAIL_TEST_RECIPIENTS||'[]');}catch{return held;}
    if(!Array.isArray(allowlist)||allowlist.length<1||allowlist.length>20||new Set(allowlist).size!==allowlist.length||allowlist.some(email=>!emailAddress(email)))return {ready:false,reason:'test_recipients_required'};
  }
  return {...connection,start:new Date(start).toISOString(),allowlist};
}

// Connecting transactional mail does not authorize promotional submissions.
export function campaignEmailConfiguration(env){
  if(env.COMMERCE_CAMPAIGN_SEND!=='enabled')return {ready:false,reason:'campaign_hold'};
  return emailConfiguration(env);
}

export function campaignUnsubscribeHeaders(configuration,url){
  const origin=configuration.environment==='sandbox'?'https://test.ezkart.id':configuration.environment==='production'?'https://ezkart.id':'';
  const prefix=origin+'/cart/unsubscribe.php?t=';
  if(!origin||configuration.origin!==origin||typeof url!=='string'||!url.startsWith(prefix)||!/^[a-f0-9]{64}$/.test(url.slice(prefix.length))){
    fail('email_request_invalid','The campaign unsubscribe link is invalid.',{noEffect:true});
  }
  return {'List-Unsubscribe':'<'+url+'>','List-Unsubscribe-Post':'List-Unsubscribe=One-Click'};
}

// Investigation can remain available while sending is disabled. The original
// send credential identity must still match; a separate same-account reader key
// avoids giving the sending key broader permissions solely for investigation.
export function emailLookupConfiguration(env){
  if(env.COMMERCE_EMAIL_RECONCILE!=='enabled')return {ready:false,reason:'not_connected'};
  const connection=emailConnection(env),reader=env.RESEND_READ_API_KEY||env.RESEND_API_KEY;
  if(!connection.ready)return connection;
  if(typeof reader!=='string'||!/^re_[A-Za-z0-9_-]{12,240}$/.test(reader))return {ready:false,reason:'not_connected'};
  return connection;
}
export async function emailReaderHash(env,configuration=emailLookupConfiguration(env)){
  if(!configuration.ready)fail('email_lookup_not_connected','Email investigation is not connected.');
  return commerceHash({provider:'resend',environment:configuration.environment,profile:configuration.profile,key:env.RESEND_READ_API_KEY||env.RESEND_API_KEY});
}

export async function retrieveResendEmail(env,id,fetcher=fetch){
  if(!emailLookupConfiguration(env).ready)fail('email_lookup_not_connected','Email investigation is not connected.');
  if(!emailProviderId(id))fail('email_lookup_invalid','Choose a valid provider email reference.');
  let response;
  try{response=await fetcher('https://api.resend.com/emails/'+id,{method:'GET',redirect:'manual',signal:AbortSignal.timeout(15000),
    headers:{authorization:'Bearer '+(env.RESEND_READ_API_KEY||env.RESEND_API_KEY),accept:'application/json','user-agent':'Ezkart/1.0'}});}
  catch{return {outcome:'unavailable',status:0,raw:null,data:null};}
  let raw,data;try{raw=await boundedBody(response,98304);data=parseMessageJSON(raw);}catch{return {outcome:'invalid',status:response.status,raw:null,data:null};}
  const outcome=response.status===200?'received':response.status===404?'not_found':response.status===429||response.status>=500?'unavailable':response.status>=400?'rejected':'invalid';
  return {outcome,status:response.status,raw,data};
}

export async function emailCredentialHash(env,configuration=emailConfiguration(env)){
  if(!configuration.ready)fail('email_not_connected','Email delivery is not connected.');
  return commerceHash({provider:'resend',profile:configuration.profile,environment:configuration.environment,from:configuration.sender,origin:configuration.origin,
    apiKey:env.RESEND_API_KEY,auth:env.SUPABASE_URL});
}

async function boundedBody(response,limit=65536){
  if(Number(response.headers.get('content-length'))>limit)fail('email_response_invalid','The provider response could not be verified.');
  if(!response.body)return '';
  const reader=response.body.getReader(),chunks=[];let size=0;
  try{for(;;){const {done,value}=await reader.read();if(done)break;size+=value.byteLength;if(size>limit){await reader.cancel();fail('email_response_invalid','The provider response could not be verified.');}chunks.push(value);}}
  finally{reader.releaseLock();}
  const bytes=new Uint8Array(size);let offset=0;for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.byteLength;}
  try{return new TextDecoder('utf-8',{fatal:true}).decode(bytes);}catch{fail('email_response_invalid','The provider response could not be verified.');}
}

// A fresh server-side Auth lookup is mandatory. Profile metadata and checkout
// contact addresses are not proof of a currently confirmed account email.
export async function verifiedEmailRecipient(env,actorId,fetcher=fetch){
  if(!emailConfiguration(env).ready)fail('email_not_connected','Email delivery is not connected.',{noEffect:true});
  if(typeof actorId!=='string'||!/^[A-Za-z0-9][A-Za-z0-9_-]{2,95}$/.test(actorId))fail('email_identity_invalid','The recipient account could not be verified.',{noEffect:true});
  let response;
  try{response=await fetcher(String(env.SUPABASE_URL).replace(/\/$/,'')+'/auth/v1/admin/users/'+encodeURIComponent(actorId),{
    method:'GET',redirect:'manual',signal:AbortSignal.timeout(10000),headers:{accept:'application/json',apikey:env.SUPABASE_SERVICE_ROLE_KEY,authorization:'Bearer '+env.SUPABASE_SERVICE_ROLE_KEY}});}
  catch{fail('email_identity_unavailable','Recipient verification is temporarily unavailable.',{noEffect:true,retry:true});}
  if(response.status===404)fail('email_identity_invalid','The recipient account is no longer available.',{noEffect:true});
  if(!response.ok)fail('email_identity_unavailable','Recipient verification is temporarily unavailable.',{noEffect:true,retry:true});
  let raw,user;try{raw=await boundedBody(response);user=parseMessageJSON(raw);}catch{fail('email_identity_unavailable','Recipient verification could not be confirmed.',{noEffect:true,retry:true});}
  if(user?.id!==actorId||!emailAddress(user.email)||!stamp(user.email_confirmed_at)||Date.parse(user.email_confirmed_at)>Date.now()
    ||user.is_anonymous===true||user.deleted_at||user.banned_until&&(!stamp(user.banned_until)||Date.parse(user.banned_until)>Date.now())){
    fail('email_identity_invalid','The recipient needs a current verified account email.',{noEffect:true});
  }
  return {id:actorId,email:user.email,confirmedAt:new Date(user.email_confirmed_at).toISOString(),verifiedAt:new Date().toISOString()};
}

function validateSavedEmail(configuration,payload,idempotencyKey,campaign=false){
  if(typeof payload!=='string'||encoder.encode(payload).byteLength>(campaign?65536:48000)||typeof idempotencyKey!=='string'||!/^[A-Za-z0-9_/-]{1,256}$/.test(idempotencyKey))fail('email_request_invalid','The saved email request is invalid.',{noEffect:true});
  let message;try{message=parseMessageJSON(payload);}catch{fail('email_request_invalid','The saved email request is invalid.',{noEffect:true});}
  const allowed=['from','to','subject','html','text','tags',...(campaign?['headers']:[])];
  if(!message||typeof message!=='object'||Array.isArray(message)||Object.keys(message).some(key=>!allowed.includes(key))
    ||message.from!=='Ezkart <'+configuration.sender+'>'||!Array.isArray(message.to)||message.to.length!==1||!emailAddress(message.to[0])
    ||configuration.environment==='sandbox'&&!configuration.allowlist.includes(message.to[0])
    ||typeof message.subject!=='string'||message.subject.length<1||message.subject.length>200||/[\r\n]/.test(message.subject)
    ||typeof message.html!=='string'||typeof message.text!=='string'||!message.html||!message.text||!Array.isArray(message.tags)||message.tags.length!==(campaign?4:3)
    ||message.tags.some(t=>!t||typeof t!=='object'||Array.isArray(t)||Object.keys(t).length!==2||typeof t.name!=='string'||typeof t.value!=='string')
    ||!message.tags.some(t=>t?.name==='ezkart_environment'&&t.value===configuration.environment)
    ||!message.tags.some(t=>t?.name==='ezkart_profile'&&t.value===configuration.profile)
    ||!message.tags.some(t=>t?.name==='ezkart_delivery'&&(campaign?/^campmail_[a-f0-9]{32}$/:/^email_[a-f0-9]{32}$/).test(t.value||''))
    ||campaign&&!message.tags.some(t=>t.name==='ezkart_purpose'&&t.value==='campaign')){
    fail('email_request_invalid','The saved email request does not match this delivery environment.',{noEffect:true});
  }
  if(campaign){
    const h=message.headers,delivery=message.tags.find(t=>t.name==='ezkart_delivery').value;
    if(!h||typeof h!=='object'||Array.isArray(h)||Object.keys(h).length!==2||typeof h['List-Unsubscribe']!=='string'
      ||h['List-Unsubscribe'][0]!=='<'||h['List-Unsubscribe'].at(-1)!=='>'||h['List-Unsubscribe-Post']!=='List-Unsubscribe=One-Click'
      ||idempotencyKey!=='ezkart_campaign/'+configuration.environment+'/'+delivery){
      fail('email_request_invalid','The saved campaign headers or retry reference are invalid.',{noEffect:true});
    }
    const url=h['List-Unsubscribe'].slice(1,-1);campaignUnsubscribeHeaders(configuration,url);
    if(!message.text.includes(url)||!message.html.includes('href="'+url+'"'))fail('email_request_invalid','The campaign needs its visible unsubscribe link.',{noEffect:true});
  }
}

export async function sendResendEmail(env,payload,idempotencyKey,fetcher=fetch){
  const configuration=emailConfiguration(env);if(!configuration.ready)fail('email_not_connected','Email delivery is not connected.',{noEffect:true});
  validateSavedEmail(configuration,payload,idempotencyKey);
  return submitResendEmail(env,payload,idempotencyKey,fetcher);
}

// Only the campaign outbox may call this after its current consent, identity,
// suppression and lease checks. Transport validation is not send authority.
export async function sendResendCampaignEmail(env,payload,idempotencyKey,fetcher=fetch){
  const configuration=campaignEmailConfiguration(env);if(!configuration.ready)fail('email_not_connected','Campaign delivery is not connected.',{noEffect:true});
  validateSavedEmail(configuration,payload,idempotencyKey,true);
  return submitResendEmail(env,payload,idempotencyKey,fetcher);
}

async function submitResendEmail(env,payload,idempotencyKey,fetcher){
  let response;
  try{response=await fetcher('https://api.resend.com/emails',{method:'POST',redirect:'manual',signal:AbortSignal.timeout(15000),
    headers:{authorization:'Bearer '+env.RESEND_API_KEY,'content-type':'application/json',accept:'application/json','user-agent':'Ezkart/1.0','Idempotency-Key':idempotencyKey},body:payload});}
  catch{fail('email_send_uncertain','The email submission result was not confirmed.',{uncertain:true});}
  let raw,data;try{raw=await boundedBody(response,12000);data=parseMessageJSON(raw);}catch{fail('email_send_uncertain','The email submission result could not be verified.',{uncertain:true});}
  if(response.ok){if(!emailProviderId(data?.id))fail('email_send_uncertain','The provider email reference was not confirmed.',{uncertain:true});return {id:data.id,raw};}
  if(response.status===409&&data?.name==='concurrent_idempotent_requests')fail('email_send_uncertain','An identical email submission is still being processed.',{uncertain:true});
  if(response.status===429)fail('email_rate_limited','The email service is temporarily rate limited.',{noEffect:true,retry:true});
  if(response.status>=400&&response.status<500)fail('email_send_rejected','The email service rejected the saved request. An operator review is needed.',{noEffect:true});
  fail('email_send_uncertain','The email service did not confirm the submission result.',{uncertain:true});
}

export async function verifyResendWebhook(request,env,profile,now=Date.now()){
  const profiles=emailWebhookProfiles(env),keys=Object.hasOwn(profiles,profile)?profiles[profile]:null;if(!keys)throw new Response('Email callback profile is not configured',{status:503});
  if(request.method!=='POST'||!/^application\/json(?:;|$)/i.test(request.headers.get('content-type')||''))throw new Response('Use a JSON POST request',{status:415});
  const id=request.headers.get('svix-id')||'',timestamp=request.headers.get('svix-timestamp')||'',signatures=request.headers.get('svix-signature')||'';
  if(!/^[A-Za-z0-9_-]{8,128}$/.test(id)||!/^\d{10}$/.test(timestamp)||Math.abs(now-Number(timestamp)*1000)>300000||signatures.length>1024)throw new Response('Invalid email callback signature',{status:401});
  let raw;try{raw=await boundedBody(request,65536);}catch{throw new Response('Email callback is too large or malformed',{status:413});}
  const content=encoder.encode(id+'.'+timestamp+'.'+raw);let valid=false;
  for(const secret of keys){let key;try{key=await crypto.subtle.importKey('raw',Uint8Array.from(atob(secret.slice(6)),c=>c.charCodeAt(0)),{name:'HMAC',hash:'SHA-256'},false,['verify']);}catch{continue;}
    for(const value of signatures.split(' ')){if(!/^v1,[A-Za-z0-9+/]{43}=$/.test(value))continue;
      if(await crypto.subtle.verify('HMAC',key,Uint8Array.from(atob(value.slice(3)),c=>c.charCodeAt(0)),content))valid=true;
    }
  }
  if(!valid)throw new Response('Invalid email callback signature',{status:401});
  let payload;try{payload=parseMessageJSON(raw);}catch{throw new Response('Email callback JSON is invalid',{status:400});}
  if(!payload||typeof payload!=='object'||Array.isArray(payload))throw new Response('Email callback JSON is invalid',{status:400});
  return {id,profile,raw,payload,receivedAt:new Date(now).toISOString(),signedAt:new Date(Number(timestamp)*1000).toISOString(),hash:await commerceHash(raw)};
}
