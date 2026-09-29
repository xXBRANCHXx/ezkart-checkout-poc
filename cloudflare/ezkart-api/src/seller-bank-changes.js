import {commerceHash} from './commerce-orders.js';
import {currentCommerceEnvironment as mode} from './commerce-access.js';
import {supportAccess} from './commerce-support.js';
const fail=(message,status=422)=>{throw new Response(message,{status});};
const clean=(value,min,max)=>typeof value==='string'&&value.trim().length>=min&&value.length<=max&&!/[\u0000-\u001f\u007f]/.test(value);
const view=r=>({id:r.id,seller:r.seller_id,owner:r.owner_auth_id,revision:r.revision,bank:{code:r.bank_code,accountSuffix:r.account_number.slice(-4),channel:r.channel},reason:r.reason,status:r.outcome||'pending',createdAt:r.created_at,reviewedAt:r.reviewed_at||null});
export async function sellerBankChange(env,input){
 const r=await env.DB.prepare(`SELECT r.*,d.outcome,d.created_at AS reviewed_at FROM seller_bank_change_requests r LEFT JOIN seller_bank_change_decisions d ON d.request_id=r.id WHERE r.seller_id=? AND r.owner_auth_id=? ORDER BY r.created_at DESC,r.rowid DESC LIMIT 1`).bind(input.seller,input.actor.id).first();return r?view(r):null;
}
export async function requestBankChange(env,input){
 if(!clean(input.reason,20,500))fail('Explain why you need to change your saved bank (20–500 characters).');
 const hash=await commerceHash({revision:input.revision,owner:input.actor.id,bank:input.bank,reason:input.reason.trim()});
 const previous=()=>env.DB.prepare('SELECT * FROM seller_bank_change_requests WHERE seller_id=? AND request_key=?').bind(input.seller,input.requestKey).first();
 const replay=await previous();if(replay){if(replay.request_hash!==hash)fail('This reference belongs to a different bank change.',409);return;}
 try{await env.DB.prepare(`INSERT INTO seller_bank_change_requests(id,seller_id,commerce_environment,owner_auth_id,revision,request_key,request_hash,bank_code,account_number,channel,reason,proof_expires_at,created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)`).bind('bcr_'+crypto.randomUUID().replaceAll('-',''),input.seller,input.environment,input.actor.id,input.revision,input.requestKey,hash,input.bank.code,input.bank.accountNumber,input.bank.channel,input.reason.trim(),input.actor.proofExpiresAt,new Date().toISOString()).run();}
 catch(error){if((await previous())?.request_hash===hash)return;if(/bank_change_pending|onboarding_revision_conflict/.test(String(error)))fail('A bank change is pending or your saved bank changed. Refresh before continuing.',409);throw error;}
}
export async function reviewBankChanges(env,actor,id,body){
 const access=await supportAccess(env,actor,body!==undefined);
 const base=`SELECT r.*,d.outcome,d.notes,d.verification_reference,d.reviewer_auth_id,d.created_at AS reviewed_at FROM seller_bank_change_requests r LEFT JOIN seller_bank_change_decisions d ON d.request_id=r.id WHERE r.commerce_environment=?`;
 if(!id){const rows=await env.DB.prepare(base+' ORDER BY (d.request_id IS NULL) DESC,r.created_at DESC LIMIT 100').bind(mode(env)).all();return {requests:rows.results.map(view),canWrite:access.canWrite};}
 const row=await env.DB.prepare(base+' AND r.id=?').bind(mode(env),id).first();if(!row)fail('Bank change not found.',404);
 if(body!==undefined){
  if(!body||Array.isArray(body)||Object.keys(body).some(k=>!['outcome','notes','verificationReference','ownerContactVerified','bankOwnershipVerified'].includes(k))||!['approved','rejected'].includes(body.outcome)||!clean(body.notes,20,1000))fail('Record a decision and review notes (20–1000 characters).');
  if(body.outcome==='approved'&&(body.ownerContactVerified!==true||body.bankOwnershipVerified!==true||!clean(body.verificationReference,10,200)))fail('Verify the owner through an established contact and check bank ownership. Record the private case reference before approving.');
  if(row.owner_auth_id===actor.id||await env.DB.prepare('SELECT 1 FROM seller_memberships WHERE seller_id=? AND auth_user_id=?').bind(row.seller_id,actor.id).first())fail('A separate Ezkart reviewer must decide this bank change.',403);
  const reference=body.outcome==='approved'?body.verificationReference.trim():'';
  if(row.outcome){if(row.outcome!==body.outcome||row.notes!==body.notes.trim()||row.verification_reference!==reference||row.reviewer_auth_id!==actor.id)fail('This request already has a different decision. Reload the review.',409);}
  else try{await env.DB.prepare('INSERT INTO seller_bank_change_decisions(request_id,reviewer_auth_id,outcome,notes,verification_reference,proof_expires_at,created_at) VALUES(?,?,?,?,?,?,?)').bind(id,actor.id,body.outcome,body.notes.trim(),reference,new Date(actor.proofExpiresAt*1000).toISOString(),new Date().toISOString()).run();}
  catch(error){if(/onboarding_|bank_change_|UNIQUE constraint/.test(String(error)))fail('The bank, owner, reviewer access or decision changed. Reload and review again.',409);throw error;}
  return reviewBankChanges(env,actor,id);
 }
 const active=await env.DB.prepare('SELECT * FROM seller_onboarding_current_bank WHERE seller_id=?').bind(row.seller_id).first();
 return {request:{...view(row),bank:{...view(row).bank,accountNumber:row.account_number},notes:row.notes||null,verificationReference:row.verification_reference||null,reviewer:row.reviewer_auth_id||null},activeBank:active?{code:active.bank_code,accountSuffix:active.account_number.slice(-4),revision:active.revision}:null,canWrite:access.canWrite};
}
