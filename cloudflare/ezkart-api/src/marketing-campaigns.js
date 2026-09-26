import {commerceHash,commerceStorageEnabled} from './commerce-orders.js';
import {commerceReadEnvironment} from './commerce-order-reads.js';
import {settingsActor,publicStoreProfile} from './merchant-settings.js';
import {customerFilters,customerFilterSql,customerCte,customerContext} from './commerce-customers.js';
import {reviewCursor,readReviewCursor} from './commerce-reviews.js';
import {emailConfiguration,campaignEmailConfiguration} from './email-provider.js';

const fail=(message,status=422,code='')=>{throw new Response(message,{status,headers:code?{'x-ezkart-error-code':code}:{}});};
const fields=(value,allowed)=>{if(!value||typeof value!=='object'||Array.isArray(value)||Object.keys(value).some(k=>!allowed.includes(k)))fail('Campaign fields are invalid');};
const campaignId=id=>typeof id==='string'&&/^cmp_[a-f0-9]{32}$/.test(id);
const text=(value,max,multiline=false)=>{if(typeof value!=='string'||value.length>max||/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(value)||!multiline&&/[\r\n\t]/.test(value))fail('Check the campaign text and try again');return value.replaceAll('\r\n','\n').trim();};
const stamp=value=>typeof value==='string'&&/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value)&&Number.isFinite(Date.parse(value))&&new Date(value).toISOString()===value;
const view=row=>({id:row.id,revision:row.revision,values:JSON.parse(row.data_json),createdAt:row.created_at,updatedAt:row.updated_at});
const query=(url,allowed)=>{for(const k of url.searchParams.keys())if(!allowed.includes(k)||url.searchParams.getAll(k).length!==1)fail('Campaign filters are invalid');};
const current=(env,actor,id)=>env.DB.prepare('SELECT * FROM commerce_campaigns WHERE id=? AND seller_id=? AND commerce_environment=?').bind(id,actor.sellerId,commerceReadEnvironment(env)).first();
export function campaignValues(input){
  fields(input,['name','subject','preheader','heading','body','buttonLabel','plannedAt','audience','archived']);
  const name=text(input.name,120);if(!name)fail('Give this campaign a name');
  if(typeof input.archived!=='boolean'||input.plannedAt!==null&&!stamp(input.plannedAt))fail('Campaign date or archive state is invalid');
  return {name,subject:text(input.subject,160),preheader:text(input.preheader,200),heading:text(input.heading,160),body:text(input.body,6000,true),
    buttonLabel:text(input.buttonLabel,60),plannedAt:input.plannedAt,audience:customerFilters(input.audience),archived:input.archived};
}
export async function campaignWorkspace(env,actor){
  const seller=await settingsActor(env,actor),mode=commerceReadEnvironment(env),profile=publicStoreProfile(seller);
  const [summary,segments]=await Promise.all([
    env.DB.prepare(`SELECT COUNT(*) AS total,COALESCE(SUM(json_extract(c.data_json,'$.archived')=0),0) AS active,
      COALESCE(SUM(json_extract(c.data_json,'$.archived')=0 AND (p.id IS NOT NULL OR json_extract(c.data_json,'$.plannedAt') IS NOT NULL)),0) AS planned
      FROM commerce_campaigns c LEFT JOIN commerce_campaign_publication_state p ON p.campaign_id=c.id WHERE c.seller_id=? AND c.commerce_environment=?`).bind(seller.id,mode).first(),
    env.DB.prepare("SELECT id,revision,data_json FROM commerce_customer_segments WHERE seller_id=? AND commerce_environment=? AND json_extract(data_json,'$.archived')=0 ORDER BY updated_at DESC,id LIMIT 50").bind(seller.id,mode).all()
  ]);
  await settingsActor(env,actor);
  let shop={};try{shop=JSON.parse(seller.settings_json||'{}').storefront||{};}catch{}
  return {storeId:seller.id,environment:mode,storeName:seller.name,timezone:profile.timezone,canEdit:seller.role!=='viewer',summary,
    segments:segments.results.map(r=>({id:r.id,revision:r.revision,name:JSON.parse(r.data_json).name,filters:JSON.parse(r.data_json).filters})),
    shopUrl:(mode==='sandbox'?'https://test.ezkart.id':'https://ezkart.id')+'/shop/?store='+encodeURIComponent(seller.id),shopEnabled:shop.enabled===true,
    audienceAvailable:commerceStorageEnabled(env),emailServiceConnected:emailConfiguration(env).ready,deliveryAvailable:campaignEmailConfiguration(env).ready};
}
export async function listCampaigns(env,actor,url){
  const seller=await settingsActor(env,actor);query(url,['state','q','month','cursor']);
  const mode=commerceReadEnvironment(env),state=url.searchParams.get('state')||'active',term=text(url.searchParams.get('q')||'',120),month=url.searchParams.get('month')||'';
  if(!['active','archived','all'].includes(state)||month&&!/^20\d{2}-(?:0[1-9]|1[0-2])$/.test(month))fail('Choose an available campaign filter');
  const offset={ 'Asia/Jakarta':'+7 hours','Asia/Makassar':'+8 hours','Asia/Jayapura':'+9 hours' }[publicStoreProfile(seller).timezone];
  const scope=await commerceHash({actor,mode,state,term,month,offset}),cursor=url.searchParams.has('cursor')?readReviewCursor(url.searchParams.get('cursor'),scope):null;
  if(cursor&&(!Number.isSafeInteger(cursor.cap)||!Number.isSafeInteger(cursor.before)||cursor.before<1||cursor.cap<cursor.before))fail('Campaign page is invalid');
  const cap=cursor?.cap??(await env.DB.prepare('SELECT COALESCE(MAX(rowid),0) AS id FROM commerce_campaigns WHERE seller_id=? AND commerce_environment=?').bind(seller.id,mode).first()).id;
  const rows=await env.DB.prepare(`SELECT c.rowid AS campaign_n,c.*,p.id AS publication_id,p.send_at AS publication_time,p.cancelled AS publication_cancelled
    FROM commerce_campaigns c LEFT JOIN commerce_campaign_publication_state p ON p.campaign_id=c.id
    WHERE c.seller_id=? AND c.commerce_environment=? AND c.rowid<=? AND c.rowid<?
    AND (?='all' OR json_extract(c.data_json,'$.archived')=?) AND (?='' OR instr(lower(json_extract(c.data_json,'$.name')||' '||json_extract(c.data_json,'$.subject')),lower(?))>0)
    AND (?='' OR strftime('%Y-%m',COALESCE(p.send_at,json_extract(c.data_json,'$.plannedAt')),?)=?) ORDER BY c.rowid DESC LIMIT 26`)
    .bind(seller.id,mode,cap,cursor?.before??cap+1,state,Number(state==='archived'),term,term,month,offset,month).all();
  const items=rows.results.slice(0,25);await settingsActor(env,actor);
  // Row IDs bound paging; edits are live. Refresh to reflect moved/archived drafts.
  return {items:items.map(r=>({...view(r),publication:r.publication_id?{id:r.publication_id,scheduledAt:r.publication_time,cancelled:Boolean(r.publication_cancelled)}:null})),nextCursor:rows.results.length>25?reviewCursor({v:1,scope,cap,before:items.at(-1).campaign_n}):null};
}
export async function readCampaign(env,actor,id,url){
  await settingsActor(env,actor);query(url,[]);if(!campaignId(id))fail('Campaign not found',404);
  const row=await current(env,actor,id);if(!row)fail('Campaign not found',404);await settingsActor(env,actor);return {campaign:view(row)};
}
export async function saveCampaign(env,actor,input){
  fields(input,['id','revision','requestKey','values']);
  if(input.id!==null&&!campaignId(input.id)||!Number.isSafeInteger(input.revision)||input.revision<0||input.revision>=Number.MAX_SAFE_INTEGER
    ||typeof input.requestKey!=='string'||!/^[a-f0-9]{32}$/.test(input.requestKey))fail('Campaign save reference is invalid');
  const seller=await settingsActor(env,actor),mode=commerceReadEnvironment(env),values=campaignValues(input.values);
  const id=input.id||'cmp_'+(await commerceHash({seller:seller.id,mode,actor:actor.id,key:input.requestKey})).slice(0,32);
  const hash=await commerceHash({actor:actor.id,seller:seller.id,mode,id,revision:input.revision,values});
  const old=()=>env.DB.prepare('SELECT * FROM commerce_campaign_changes WHERE actor_id=? AND request_key=?').bind(actor.id,input.requestKey).first();
  const result=async(r,replayed)=>{
    if(r.request_hash!==hash)fail('This save reference was already used for different changes',409,'campaign_reference_conflict');
    const latest=await current(env,actor,id);await settingsActor(env,actor);if(!latest)fail('Saved campaign is unavailable',503);
    return {receipt:{id:r.campaign_id,requestKey:r.request_key,revision:r.revision,values:JSON.parse(r.data_json),createdAt:r.created_at,replayed},campaign:view(latest)};
  };
  const previous=await old();if(previous)return result(previous,true);
  if(seller.role==='viewer')fail('Your store role cannot change campaigns',403);
  if(!input.id&&(input.revision!==0||values.archived))fail('A new campaign must start as an active draft');
  if(input.id&&!await current(env,actor,id))fail('Campaign not found',404);
  try{await env.DB.prepare(`INSERT INTO commerce_campaign_changes(actor_id,request_key,request_hash,campaign_id,seller_id,commerce_environment,expected_revision,revision,data_json,created_at)
    VALUES(?,?,?,?,?,?,?,?,?,?)`).bind(actor.id,input.requestKey,hash,id,seller.id,mode,input.revision,input.revision+1,JSON.stringify(values),new Date().toISOString()).run();}
  catch(error){const raced=await old();if(raced)return result(raced,true);const detail=String(error)+' '+String(error.cause||'');
    if(detail.includes('campaign_revision_conflict'))fail('This campaign changed in another session. Compare the saved version before saving.',409,'campaign_revision_conflict');
    if(detail.includes('campaign_forbidden'))fail('Your store access changed. Reload this page.',403);
    if(detail.includes('campaign_rate_limited'))fail('Too many campaign changes. Try again later.',429);throw error;
  }
  return result(await old(),false);
}
export async function campaignHistory(env,actor,id,url){
  await settingsActor(env,actor);query(url,['cursor']);const row=campaignId(id)&&await current(env,actor,id);if(!row)fail('Campaign not found',404);
  const scope=await commerceHash({actor,id,environment:commerceReadEnvironment(env),view:'campaign_history'}),cursor=url.searchParams.has('cursor')?readReviewCursor(url.searchParams.get('cursor'),scope):null;
  if(cursor&&(!Number.isSafeInteger(cursor.cap)||!Number.isSafeInteger(cursor.before)||cursor.before<1||cursor.cap<cursor.before))fail('Campaign history page is invalid');
  const cap=cursor?.cap??row.revision,before=cursor?.before??cap+1;
  const rows=await env.DB.prepare('SELECT revision,actor_id,data_json,created_at FROM commerce_campaign_changes WHERE campaign_id=? AND seller_id=? AND commerce_environment=? AND revision<=? AND revision<? ORDER BY revision DESC LIMIT 21')
    .bind(id,actor.sellerId,commerceReadEnvironment(env),cap,before).all();await settingsActor(env,actor);const items=rows.results.slice(0,20);
  return {items:items.map(r=>({revision:r.revision,values:JSON.parse(r.data_json),createdAt:r.created_at,actor:r.actor_id===actor.id?'you':'store_member'})),
    nextCursor:rows.results.length>20?reviewCursor({v:1,scope,cap,before:items.at(-1).revision}):null};
}
export async function campaignAudience(env,actor,input){
  fields(input,['filters','cursor']);const seller=await settingsActor(env,actor);
  if(!commerceStorageEnabled(env))fail('Customer audiences are not available yet',503);
  const filters=customerFilters(input.filters),filter=customerFilterSql(filters),mode=commerceReadEnvironment(env),scope=await commerceHash({actor,mode,filters,view:'campaign_audience'});
  const cursor=input.cursor!==undefined?readReviewCursor(input.cursor,scope):null;
  if(cursor&&(!Number.isSafeInteger(cursor.cap)||cursor.cap<0||typeof cursor.before!=='string'||!/^customer_[A-Za-z0-9_-]{1,85}$/.test(cursor.before)))fail('Audience page is invalid');
  const cap=cursor?.cap??(await customerContext(env,{id:seller.id})).cap,bind=[seller.id,mode,cap,...filter.values];
  const [summary,rows]=await env.DB.batch([
    env.DB.prepare(customerCte+` SELECT COUNT(*) AS matching,COALESCE(SUM(p.marketing_consent='granted'),0) AS granted,
      COALESCE(SUM(p.marketing_consent='withdrawn'),0) AS withdrawn,COALESCE(SUM(p.marketing_consent='not_recorded'),0) AS unrecorded FROM profiles p WHERE ${filter.where}`).bind(...bind),
    env.DB.prepare(customerCte+` SELECT p.id,p.name,p.email,p.orders,p.paid_orders,p.marketing_consent FROM profiles p WHERE ${filter.where}
      AND p.id>? ORDER BY p.id LIMIT 26`).bind(...bind,cursor?.before||'')
  ]);await settingsActor(env,actor);const items=rows.results.slice(0,25);
  return {summary:summary.results[0],items:items.map(r=>({id:r.id,name:r.name,email:r.email,orders:r.orders,paidOrders:r.paid_orders,permission:r.marketing_consent})),
    nextCursor:rows.results.length>25?reviewCursor({v:1,scope,cap,before:items.at(-1).id}):null};
}
