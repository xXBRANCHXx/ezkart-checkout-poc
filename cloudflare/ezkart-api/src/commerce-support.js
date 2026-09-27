import {commerceEnvironment,commerceHash,commerceStorageEnabled} from './commerce-orders.js';
import {currentCommerceEnvironment as mode} from './commerce-access.js';
const fail=(message,status=422,code='')=>{throw new Response(message,{status,headers:code?{'x-ezkart-error-code':code}:{}});};
const member=async(env,id)=>env.DB.prepare('SELECT role FROM commerce_support_staff WHERE auth_user_id=? AND commerce_environment=?').bind(id,mode(env)).first();

export async function supportSession(env,user){
  const permission=await member(env,user.id),role=permission?.role||'revoked',authorized=['reviewer','viewer'].includes(role);
  const now=Math.floor(Date.now()/1000),methods=Array.isArray(user.assurance?.amr)?user.assurance.amr:[];
  const verifiedAt=Math.max(0,...methods.filter(m=>m?.method==='totp'&&Number.isSafeInteger(m.timestamp)&&m.timestamp<=now+30).map(m=>m.timestamp));
  const canRead=authorized&&user.assurance?.aal==='aal2',expiresAt=Math.min(verifiedAt+600,user.assurance?.expiresAt||0);
  return {authorized,role:authorized?role:null,canRead,canWrite:canRead&&role==='reviewer'&&expiresAt>now&&commerceStorageEnabled(env),
    proofExpiresAt:canRead?expiresAt:0,requiresVerification:authorized&&(!canRead||role==='reviewer'&&expiresAt<=now)};
}
export async function supportActor(env,user){
  const session=await supportSession(env,user);
  if(!session.authorized)fail('Ezkart review access is required.',403);
  if(!session.canRead)fail('Verify your authenticator to open Ezkart reviews.',401,'support_verification_required');
  return {kind:'support',id:user.id,aal:'aal2',proofExpiresAt:session.proofExpiresAt};
}
export async function supportAccess(env,actor,write=false){
  const permission=actor.kind==='support'&&actor.aal==='aal2'?await member(env,actor.id):null;
  if(!permission||!['reviewer','viewer'].includes(permission.role))fail('Your Ezkart review access changed. Reload this page.',403);
  const canWrite=permission.role==='reviewer'&&Number.isSafeInteger(actor.proofExpiresAt)&&actor.proofExpiresAt>Math.floor(Date.now()/1000)&&actor.proofExpiresAt<=Math.floor(Date.now()/1000)+630;
  if(write&&!canWrite)fail(permission.role==='viewer'?'Your account can view Ezkart reviews but cannot decide them.':'Verify your authenticator again before updating this review.',permission.role==='viewer'?403:401,'support_verification_required');
  return {canWrite,role:permission.role};
}

// Only the environment's signed private service can administer this registry.
// Store ownership and email/domain matching confer no platform-support role.
export async function recordSupportPermission(env,input){
  if(!['test','beta'].includes(env.APP_ENVIRONMENT))fail('Support access provisioning is restricted to the workbench.',403);
  if(!input||typeof input!=='object'||Array.isArray(input)||Object.keys(input).some(k=>!['environment','authUserId','role','requestKey','operator','reason'].includes(k)))fail('Support access request is invalid.');
  commerceEnvironment(env,input.environment);
  if(typeof input.authUserId!=='string'||!/^[A-Za-z0-9][A-Za-z0-9_-]{2,95}$/.test(input.authUserId)||!['reviewer','viewer','revoked'].includes(input.role)
    ||typeof input.requestKey!=='string'||!/^[a-f0-9]{32}$/.test(input.requestKey))fail('Support access identity is invalid.');
  for(const [field,max] of [['operator',100],['reason',500]])if(typeof input[field]!=='string'||input[field].trim().length<3||input[field].length>max||/[\u0000-\u001f\u007f]/.test(input[field]))fail('Support access audit details are invalid.');
  const hash=await commerceHash(input),read=()=>env.DB.prepare('SELECT * FROM commerce_support_permissions WHERE request_key=?').bind(input.requestKey).first();
  let row=await read();
  if(!row){
    if(!await env.DB.prepare('SELECT id FROM app_users WHERE auth_user_id=?').bind(input.authUserId).first())fail('This verified account has not signed into Ezkart.',404);
    try{await env.DB.prepare('INSERT INTO commerce_support_permissions(id,commerce_environment,auth_user_id,role,request_key,request_hash,operator,reason,created_at) VALUES(?,?,?,?,?,?,?,?,?)')
      .bind('supportperm_'+crypto.randomUUID().replaceAll('-',''),mode(env),input.authUserId,input.role,input.requestKey,hash,input.operator,input.reason,new Date().toISOString()).run();}
    catch(error){if(!await read())throw error;}row=await read();
  }
  if(row.request_hash!==hash)fail('This access request was already used for different details.',409);
  const current=await member(env,input.authUserId);
  return {receiptId:row.id,authUserId:row.auth_user_id,recordedRole:row.role,currentRole:current?.role||'revoked',createdAt:row.created_at};
}
