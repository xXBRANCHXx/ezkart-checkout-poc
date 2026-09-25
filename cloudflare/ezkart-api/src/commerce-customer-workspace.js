import {commerceHash} from './commerce-orders.js';
import {commerceReadEnvironment,readParameters,readCursor,makeReadCursor} from './commerce-order-reads.js';
import {customerFailure as fail,customerFilters,assertCustomer} from './commerce-customers.js';

export const segmentPattern=/^cseg_[a-f0-9]{40}$/;
const parseProfile=input=>{
  if(!input||typeof input.note!=='string'||input.note.length>2000||/[\u0000-\u0008\u000b-\u001f]/.test(input.note.replaceAll('\r\n','\n'))
    ||!Array.isArray(input.tags)||input.tags.length>10||input.tags.some(t=>typeof t!=='string'))fail('Use a note up to 2,000 characters and up to 10 tags');
  const tags=[...new Set(input.tags.map(t=>t.trim().normalize('NFC').toLowerCase()))].sort();
  if(tags.some(t=>!t||t.length>32||/[\u0000-\u001f]/.test(t)))fail('Each tag must contain 1 to 32 characters');
  return {note:input.note.replaceAll('\r\n','\n').trim(),tags};
};
const parseSegment=input=>{
  if(!input||typeof input.name!=='string'||!input.name.trim()||input.name.length>80||/[\u0000-\u001f]/.test(input.name)||typeof input.archived!=='boolean')fail('Segment name or state is invalid');
  return {name:input.name.trim(),filters:customerFilters(input.filters),archived:input.archived};
};
const segmentView=row=>({id:row.id,revision:row.revision,...JSON.parse(row.data_json),createdAt:row.created_at,updatedAt:row.updated_at});
async function savedSegment(env,seller,id){
  return env.DB.prepare('SELECT * FROM commerce_customer_segments WHERE id=? AND seller_id=? AND commerce_environment=?')
    .bind(id,seller.id,commerceReadEnvironment(env)).first();
}
export async function customerSegment(env,seller,id){
  const row=segmentPattern.test(id)?await savedSegment(env,seller,id):null;if(!row)fail('Segment not found',404);
  return {canEdit:seller.role!=='viewer',segment:segmentView(row)};
}
export async function customerSegments(env,seller,url){
  const limit=readParameters(url,['state','limit','cursor']),state=url.searchParams.get('state')||'active',mode=commerceReadEnvironment(env);
  if(!['active','archived','all'].includes(state))fail('Segment filter is invalid');
  const hash=await commerceHash({mode,state}),encoded=url.searchParams.get('cursor'),before=encoded?readCursor(encoded,seller.id,'customer_segments',hash):null;
  if(before&&(before.d!=='before'||!segmentPattern.test(before.id)))fail('Segment cursor is invalid');
  const cap=before?.cap??(await env.DB.prepare('SELECT COALESCE(MAX(rowid),0) AS cap FROM commerce_customer_segments WHERE seller_id=? AND commerce_environment=?').bind(seller.id,mode).first()).cap;
  const result=await env.DB.prepare(`SELECT * FROM commerce_customer_segments WHERE seller_id=? AND commerce_environment=? AND rowid<=?
    ${state==='all'?'':"AND json_extract(data_json,'$.archived')="+(state==='archived'?1:0)}
    ${before?'AND (created_at<? OR (created_at=? AND id<?))':''} ORDER BY created_at DESC,id DESC LIMIT ?`)
    .bind(seller.id,mode,cap,...(before?[before.at,before.at,before.id]:[]),limit+1).all();
  return {canEdit:seller.role!=='viewer',items:result.results.slice(0,limit).map(segmentView),
    nextCursor:result.results.length>limit?makeReadCursor(seller.id,'customer_segments',hash,cap,result.results[limit-1]):null};
}
export async function saveCustomerWorkspace(env,seller,actorId,kind,id,input){
  if(seller.role==='viewer')fail('Your account can view customers but cannot change notes or segments',403);
  const keys=kind==='profile'?['revision','requestKey','note','tags']:['revision','requestKey','name','filters','archived'];
  if(!input||typeof input!=='object'||Array.isArray(input)||Object.keys(input).some(k=>!keys.includes(k))||!Number.isSafeInteger(input.revision)||input.revision<0||input.revision>=Number.MAX_SAFE_INTEGER
    ||typeof input.requestKey!=='string'||!/^[a-f0-9]{32}$/.test(input.requestKey))fail('Customer save request is invalid');
  const mode=commerceReadEnvironment(env),data=kind==='profile'?parseProfile(input):parseSegment(input);
  if(kind==='profile')await assertCustomer(env,seller,id);
  else if(id){if(!segmentPattern.test(id)||!await savedSegment(env,seller,id))fail('Segment not found',404);}
  else{if(input.revision!==0||data.archived)fail('A new segment must start active');id='cseg_'+(await commerceHash({seller:seller.id,mode,key:input.requestKey})).slice(0,40);}
  const hash=await commerceHash({kind,id,revision:input.revision,data}),previous=()=>env.DB.prepare('SELECT * FROM commerce_customer_changes WHERE seller_id=? AND commerce_environment=? AND request_key=?').bind(seller.id,mode,input.requestKey).first();
  const replay=row=>{
    if(row.request_hash!==hash)fail('This save request was already used for different customer changes',409);
    return {id,revision:row.revision,createdAt:row.created_at,replayed:true};
  };
  let row=await previous();if(row)return replay(row);
  const now=new Date().toISOString();
  try{await env.DB.prepare(`INSERT INTO commerce_customer_changes(seller_id,commerce_environment,request_key,request_hash,target_kind,target_id,expected_revision,revision,actor_auth_user_id,data_json,created_at)
    VALUES (?,?,?,?,?,?,?,?,?,?,?)`).bind(seller.id,mode,input.requestKey,hash,kind,id,input.revision,input.revision+1,actorId,JSON.stringify(data),now).run();}
  catch(error){row=await previous();if(row)return replay(row);const message=String(error?.message)+' '+String(error?.cause?.message);
    if(message.includes('customer_actor_forbidden'))fail('Your account cannot change customers',403);
    if(message.includes('customer_profile_missing'))fail('Customer not found',404);
    if(message.includes('customer_revision_conflict'))fail('Saved data changed in another session. Reload the saved version before applying your changes.',409);
    if(message.includes('customer_segment_limit'))fail('You can keep 50 active segments. Archive an unused segment first.',409);
    throw error;
  }
  return {id,revision:input.revision+1,createdAt:now,replayed:false};
}
export async function customerProfileHistory(env,seller,actorId,id,url){
  const mode=await assertCustomer(env,seller,id),limit=readParameters(url,['limit','cursor']),hash=await commerceHash({mode,id}),encoded=url.searchParams.get('cursor'),before=encoded?readCursor(encoded,seller.id,'customer_changes',hash):null;
  if(before&&(before.d!=='before'||!/^\d+$/.test(before.id)||!Number.isSafeInteger(Number(before.id))||Number(before.id)<1))fail('Profile history cursor is invalid');
  const cap=before?.cap??(await env.DB.prepare("SELECT COALESCE(MAX(rowid),0) AS cap FROM commerce_customer_changes WHERE seller_id=? AND commerce_environment=? AND target_kind='profile' AND target_id=?").bind(seller.id,mode,id).first()).cap;
  const rows=await env.DB.prepare(`SELECT c.revision AS id,c.revision,c.created_at,c.actor_auth_user_id,c.data_json,COALESCE(NULLIF(u.display_name,''),'Store member') AS actor
    FROM commerce_customer_changes c LEFT JOIN app_users u ON u.auth_user_id=c.actor_auth_user_id
    WHERE c.seller_id=? AND c.commerce_environment=? AND c.target_kind='profile' AND c.target_id=? AND c.rowid<=? ${before?'AND c.revision<?':''}
    ORDER BY c.revision DESC LIMIT ?`).bind(seller.id,mode,id,cap,...(before?[Number(before.id)]:[]),limit+1).all();
  const page=rows.results.slice(0,limit);
  return {items:page.map(row=>({revision:row.revision,createdAt:row.created_at,actor:row.actor,byYou:row.actor_auth_user_id===actorId,...JSON.parse(row.data_json)})),
    nextCursor:rows.results.length>limit?makeReadCursor(seller.id,'customer_changes',hash,cap,{...page.at(-1),id:String(page.at(-1).id)}):null};
}
