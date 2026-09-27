import {commerceHash,commerceStorageEnabled} from './commerce-orders.js';
import {currentCommerceEnvironment as mode} from './commerce-access.js';
import {refundDetail,refundAccess} from './commerce-refunds.js';
import {supportAccess} from './commerce-support.js';
import {reviewCursor,readReviewCursor} from './commerce-reviews.js';
export const disputeActive=state=>['open','awaiting_buyer','awaiting_store'].includes(state);
const labels={open:'Ezkart review requested',awaiting_buyer:'Ezkart needs information from the buyer',awaiting_store:'Ezkart needs information from the store',approved:'Ezkart approved the refund request',declined:'Ezkart declined the refund request',withdrawn:'Ezkart review withdrawn'};
const fail=(message,status=422)=>{throw new Response(message,{status,headers:status===401?{'x-ezkart-error-code':'support_verification_required'}:{}});};
const actorLabel=kind=>({merchant:'Store',buyer:'Buyer',support:'Ezkart'}[kind]);
const checkedFields=(input,allowed)=>{if(!input||typeof input!=='object'||Array.isArray(input)||Object.keys(input).some(k=>!allowed.includes(k)))fail('Review details are invalid.');};
const integer=(value,min=1,max=Number.MAX_SAFE_INTEGER)=>{if(!Number.isSafeInteger(value)||value<min||value>max)fail('The review version is invalid.');return value;};
const requestKey=value=>{if(typeof value!=='string'||!/^[A-Za-z0-9_-]{16,100}$/.test(value))fail('Review request identity is invalid.');return value;};
const text=value=>{if(typeof value!=='string')fail('Explain the review in 3 to 2,000 characters.');const v=value.replaceAll('\r\n','\n').trim();if(v.length<3||v.length>2000||/[\u0000-\u0008\u000b-\u001f\u007f]/.test(v))fail('Explain the review in 3 to 2,000 characters.');return v;};
function databaseFailure(error){const message=String(error)+' '+String(error?.cause||'');
  if(message.includes('dispute_actor_forbidden'))fail('Your access to this review changed.',403);
  if(message.includes('dispute_proof_expired'))fail('Verify your authenticator again before updating this review.',401);
  if(message.includes('dispute_rate_limit'))fail('Too many updates to this review. Try again later.',429);
  if(message.includes('dispute_allocation_exceeded'))fail('Another refund already covers these purchase amounts. Review the existing requests first.',409);
  if(/dispute_|UNIQUE constraint failed/.test(message))fail('The request, evidence or review changed. Reload before continuing.',409);
  throw error;
}
function eventView(row,support){return {sequence:row.sequence,kind:row.kind,actor:actorLabel(row.actor_kind),message:row.message,createdAt:row.created_at,
  ...(support?{operatorReference:row.actor_kind==='support'?row.actor_auth_user_id:null}:{}),evidenceVersion:['approve','decline','reopen'].includes(row.kind)?row.evidence_version:null};}
export async function disputeView(env,actor,refundId,authority){
  const row=await env.DB.prepare('SELECT * FROM commerce_refund_disputes WHERE refund_id=? AND commerce_environment=?').bind(refundId,mode(env)).first();
  if(!row)return null;
  const result=await env.DB.prepare('SELECT * FROM commerce_refund_dispute_actions WHERE dispute_id=? ORDER BY sequence DESC LIMIT 51').bind(row.id).all();
  const actions=result.results.slice(0,50).reverse(),active=disputeActive(row.state),write=commerceStorageEnabled(env)&&authority.canWrite;
  return {id:row.id,state:row.state,stateLabel:labels[row.state],revision:row.revision,active,openedBy:actorLabel(row.actor_kind),message:row.message,
    createdAt:row.created_at,updatedAt:row.updated_at,actions:actions.map(a=>eventView(a,actor.kind==='support')),
    olderBefore:result.results.length>50?actions[0].sequence:null,canReply:write&&active,
    canWithdraw:write&&active&&actor.kind===row.actor_kind&&actor.id===row.actor_auth_user_id,
    canDecide:write&&active&&actor.kind==='support',canReopen:write&&!active&&actor.kind==='support',
    requiresVerification:actor.kind==='support'&&!authority.canWrite&&authority.role==='reviewer'};
}
export async function disputeHistory(env,actor,refundId,before,expectedOrder=''){
  if(!/^[1-9][0-9]{0,14}$/.test(before||''))fail('Review history boundary is invalid.');
  const detail=await refundDetail(env,actor,refundId,expectedOrder);if(!detail.dispute)fail('Review not found.',404);
  const rows=(await env.DB.prepare('SELECT * FROM commerce_refund_dispute_actions WHERE dispute_id=? AND sequence<? ORDER BY sequence DESC LIMIT 51').bind(detail.dispute.id,Number(before)).all()).results;
  await refundAccess(env,actor,detail.orderId);const actions=rows.slice(0,50).reverse();
  return {actions:actions.map(a=>eventView(a,actor.kind==='support')),olderBefore:rows.length>50?actions[0].sequence:null};
}
export async function changeDispute(env,actor,refundId,raw,expectedOrder=''){
  const detail=await refundDetail(env,actor,refundId,expectedOrder),authority=await refundAccess(env,actor,detail.orderId);
  if(!commerceStorageEnabled(env))fail('Ezkart reviews are not available yet.',503);
  if(actor.kind==='support')await supportAccess(env,actor,true);
  else if(!authority.canWrite)fail('Your account can view reviews but cannot change them.',403);
  checkedFields(raw,['requestKey','kind','revision','refundRevision','orderRevision','evidenceVersion','message']);
  if(!['review_open','review_reply','review_ask_buyer','review_ask_store','review_approve','review_decline','review_withdraw','review_reopen'].includes(raw.kind))fail('Review action is invalid.');
  const kind=raw.kind.slice(7),input={requestKey:requestKey(raw.requestKey),kind,revision:integer(raw.revision,0),refundRevision:integer(raw.refundRevision),
    orderRevision:integer(raw.orderRevision),evidenceVersion:integer(raw.evidenceVersion,0,40),message:text(raw.message)};
  if(actor.kind==='support'&&['open','withdraw'].includes(kind)||actor.kind!=='support'&&!['open','reply','withdraw'].includes(kind))fail('This review action requires an Ezkart reviewer.',403);
  const hash=await commerceHash({actor:{kind:actor.kind,id:actor.id},refundId,environment:mode(env),...input});
  const table=kind==='open'?'commerce_refund_disputes':'commerce_refund_dispute_actions';
  const replay=async()=>{const row=await env.DB.prepare('SELECT request_hash FROM '+table+' WHERE actor_auth_user_id=? AND request_key=?').bind(actor.id,input.requestKey).first();
    if(!row)return null;if(row.request_hash!==hash)fail('This review identity was already used for other details.',409);return refundDetail(env,actor,refundId,expectedOrder);};
  const previous=await replay();if(previous)return previous;
  const now=new Date().toISOString();
  if(kind==='open'){
    if(input.revision!==0||!detail.canRequestReview||detail.revision!==input.refundRevision||detail.evidenceVersion!==input.evidenceVersion)fail('The refund request changed. Reload before requesting a review.',409);
    try{await env.DB.prepare(`INSERT INTO commerce_refund_disputes(id,refund_id,seller_id,order_id,commerce_environment,actor_kind,actor_auth_user_id,request_key,request_hash,refund_revision,evidence_version,message,created_at,updated_at)
      VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).bind('dsp_'+crypto.randomUUID().replaceAll('-',''),refundId,authority.sellerId,detail.orderId,mode(env),actor.kind,actor.id,input.requestKey,hash,input.refundRevision,input.evidenceVersion,input.message,now,now).run();}
    catch(error){const saved=await replay();if(saved)return saved;databaseFailure(error);}
  }else{
    const d=detail.dispute,capability=kind==='reopen'?'canReopen':kind==='withdraw'?'canWithdraw':kind==='reply'?'canReply':'canDecide';
    if(!d||d.revision!==input.revision||!d[capability])fail('This review changed or the action is no longer available. Reload before continuing.',409);
    if(['approve','decline','reopen'].includes(kind)&&(detail.revision!==input.refundRevision||detail.orderRevision!==input.orderRevision||detail.evidenceVersion!==input.evidenceVersion))fail('The purchase or supporting files changed. Reload and review them before deciding.',409);
    try{await env.DB.prepare(`INSERT INTO commerce_refund_dispute_actions(id,dispute_id,actor_kind,actor_auth_user_id,request_key,request_hash,previous_revision,refund_revision,order_revision,evidence_version,proof_expires_at,kind,message,created_at)
      VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).bind('daction_'+crypto.randomUUID().replaceAll('-',''),d.id,actor.kind,actor.id,input.requestKey,hash,input.revision,input.refundRevision,input.orderRevision,input.evidenceVersion,actor.kind==='support'?actor.proofExpiresAt:null,kind,input.message,now).run();}
    catch(error){const saved=await replay();if(saved)return saved;databaseFailure(error);}
  }
  return refundDetail(env,actor,refundId,expectedOrder);
}
export async function supportRefunds(env,actor,url){
  await supportAccess(env,actor);
  for(const key of url.searchParams.keys())if(!['state','cursor'].includes(key)||url.searchParams.getAll(key).length!==1)fail('Review filters are invalid.');
  const state=url.searchParams.get('state')||'open';if(!['all','open','awaiting_buyer','awaiting_store','closed'].includes(state))fail('Review filter is invalid.');
  const scope=await commerceHash({actor:actor.id,environment:mode(env),state}),cursor=url.searchParams.has('cursor')?readReviewCursor(url.searchParams.get('cursor'),scope):null;
  if(cursor&&(!Number.isSafeInteger(cursor.cap)||!Number.isSafeInteger(cursor.before)||cursor.before<1||cursor.cap<cursor.before))fail('Review page is invalid.');
  const cap=cursor?.cap??(await env.DB.prepare('SELECT COALESCE(MAX(sequence),0) cap FROM commerce_refund_disputes WHERE commerce_environment=?').bind(mode(env)).first()).cap;
  const rows=(await env.DB.prepare(`SELECT r.*,d.state AS review_state,d.sequence AS review_sequence,d.created_at AS review_created_at,s.name AS store_name
    FROM commerce_refund_disputes d JOIN commerce_refunds r ON r.id=d.refund_id JOIN sellers s ON s.id=d.seller_id
    WHERE d.commerce_environment=? AND d.sequence<=? AND d.sequence<? AND (?='all' OR (?='open' AND d.state IN ('open','awaiting_buyer','awaiting_store'))
      OR (?='closed' AND d.state IN ('approved','declined','withdrawn')) OR d.state=?) ORDER BY d.sequence DESC LIMIT 26`)
    .bind(mode(env),cap,cursor?.before??cap+1,state,state,state,state).all()).results;
  await supportAccess(env,actor);return {refunds:rows.slice(0,25).map(r=>({id:r.id,orderId:r.order_id,state:r.state,stateLabel:labels[r.review_state],amount:r.amount,
    createdAt:r.review_created_at,storeName:r.store_name,paymentConfirmed:false,processingAvailable:false})),enabled:commerceStorageEnabled(env),
    nextCursor:rows.length>25?reviewCursor({v:1,scope,cap,before:rows[24].review_sequence}):null};
}
