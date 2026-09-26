import {commerceHash,commerceStorageEnabled} from './commerce-orders.js';
import {commerceReadEnvironment} from './commerce-order-reads.js';
import {settingsActor} from './merchant-settings.js';
import {customerCte,customerFilterSql,customerContext} from './commerce-customers.js';
import {campaignValues} from './marketing-campaigns.js';
import {campaignEmailConfiguration} from './email-provider.js';
import {campaignEmailPayload} from './campaign-email-template.js';
import {reviewCursor,readReviewCursor} from './commerce-reviews.js';

const fail=(message,status=422,code='')=>{throw new Response(message,{status,headers:code?{'x-ezkart-error-code':code}:{}});};
const fields=(value,keys)=>{if(!value||typeof value!=='object'||Array.isArray(value)||Object.keys(value).some(k=>!keys.includes(k)))fail('Campaign publication fields are invalid');};
const validId=id=>typeof id==='string'&&/^cmp_[a-f0-9]{32}$/.test(id);
const validKey=key=>typeof key==='string'&&/^[a-f0-9]{32}$/.test(key);
const revision=value=>Number.isSafeInteger(value)&&value>=0&&value<Number.MAX_SAFE_INTEGER;
const stamp=value=>typeof value==='string'&&/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value)&&Number.isFinite(Date.parse(value))&&new Date(value).toISOString()===value;
const scheduled=(value,now)=>{if(!stamp(value)||Date.parse(value)<now+60000||Date.parse(value)>now+366*86400000)fail('Schedule at least one minute ahead and within the next year');return value;};
const query=(url,keys)=>{for(const k of url.searchParams.keys())if(!keys.includes(k)||url.searchParams.getAll(k).length!==1)fail('Publication parameters are invalid');};
const saved=(env,actor,id)=>env.DB.prepare(`SELECT p.*,COUNT(j.id) AS summary_recipients,COALESCE(SUM(j.state='queued'),0) AS summary_queued,
  COALESCE(SUM(d.delivery_state='cancelled'),0) AS summary_cancelled,
  COALESCE(SUM(j.state IN ('retry','uncertain','dead') AND COALESCE(json_extract(j.result_json,'$.cancelled'),0)!=1),0) AS summary_attention,
  COALESCE(SUM(j.state='running'),0) AS summary_processing,
  COALESCE(SUM(d.submitted_at IS NOT NULL),0) AS submitted,COALESCE(SUM(d.delivered_at IS NOT NULL),0) AS delivered,
  COALESCE(SUM(d.delivery_state='skipped'),0) AS skipped,COALESCE(SUM(d.delivery_state='uncertain'),0) AS uncertain,
  COALESCE(SUM(d.delivery_state='failed'),0) AS failed,COALESCE(SUM(d.delivery_state='bounced'),0) AS bounced,
  COALESCE(SUM(d.delivery_state='complained'),0) AS complained,COALESCE(SUM(d.delivery_state='suppressed'),0) AS suppressed,
  COALESCE(SUM(d.delivery_state='delayed'),0) AS delayed,COALESCE(SUM(d.needs_review=1),0) AS needs_review FROM commerce_campaign_publication_state p
  LEFT JOIN commerce_campaign_candidates c ON c.publication_id=p.id LEFT JOIN commerce_jobs j ON j.id='job_campaign_'||c.id
  LEFT JOIN commerce_campaign_delivery_status d ON d.candidate_id=c.id
  WHERE p.campaign_id=? AND p.seller_id=? AND p.commerce_environment=? GROUP BY p.id`).bind(id,actor.sellerId,commerceReadEnvironment(env)).first();
const campaign=(env,actor,id)=>env.DB.prepare('SELECT * FROM commerce_campaigns WHERE id=? AND seller_id=? AND commerce_environment=?').bind(id,actor.sellerId,commerceReadEnvironment(env)).first();
async function view(env,row){
  if(row.summary_recipients!==row.candidate_count)fail('This campaign queue needs an operator review.',503);
  const summary={recipients:row.summary_recipients,queued:row.summary_queued,cancelled:row.summary_cancelled,attention:row.summary_attention,processing:row.summary_processing};
  return {id:row.id,campaignId:row.campaign_id,campaignRevision:row.campaign_revision,revision:row.action_revision,values:JSON.parse(row.data_json),storeName:row.store_name,
    scheduledAt:row.send_at,createdAt:row.created_at,updatedAt:row.updated_at,cancelled:Boolean(row.cancelled),candidateCount:row.candidate_count,summary,
    deliverySummary:{submitted:row.submitted,delivered:row.delivered,skipped:row.skipped,uncertain:row.uncertain,failed:row.failed,bounced:row.bounced,complained:row.complained,suppressed:row.suppressed,delayed:row.delayed,needsReview:row.needs_review}};
}
function databaseFailure(error){
  const detail=String(error)+' '+String(error.cause||'');
  if(detail.includes('campaign_publication_forbidden'))fail('Your store access or details changed. Reload this campaign.',403);
  if(/campaign_publication_(revision|boundary)|campaign_candidate_ineligible/.test(detail))fail('The campaign or audience changed. Review it before publishing.',409,'campaign_publication_changed');
  if(detail.includes('campaign_publication_action_revision'))fail('The publication changed. Reload before changing its schedule.',409,'campaign_publication_conflict');
  if(detail.includes('campaign_processing_started'))fail('Processing has started. This campaign can no longer be rescheduled.',409,'campaign_processing_started');
  if(/campaign_publication(_action)?_rate/.test(detail))fail('Too many campaign changes. Try again later.',429);
  if(detail.includes('candidate_count>=1'))fail('No customers currently match this audience with promotional email permission',422,'campaign_audience_empty');
  throw error;
}
export async function readPublication(env,actor,id,url){
  await settingsActor(env,actor);query(url,[]);if(!validId(id)||!await campaign(env,actor,id))fail('Campaign not found',404);
  const row=await saved(env,actor,id),publication=row?await view(env,row):null;await settingsActor(env,actor);return {publication};
}
export async function publishCampaign(env,actor,id,input){
  fields(input,['revision','requestKey','scheduledAt']);
  if(!validId(id)||!revision(input.revision)||input.revision<1||!validKey(input.requestKey)||input.scheduledAt!==null&&!stamp(input.scheduledAt))fail('Campaign publication reference is invalid');
  const seller=await settingsActor(env,actor),mode=commerceReadEnvironment(env),hash=await commerceHash({actor:actor.id,seller:seller.id,mode,id,...input});
  const original=()=>env.DB.prepare('SELECT * FROM commerce_campaign_publications WHERE actor_id=? AND request_key=?').bind(actor.id,input.requestKey).first();
  const result=async(row,replayed)=>{
    if(row.request_hash!==hash)fail('This publication reference was already used for another request',409,'campaign_publication_reference');
    const current=await saved(env,actor,id);if(!current)fail('The saved audience is unavailable. Retry the original publication.',503);
    const publication=await view(env,current);await settingsActor(env,actor);
    return {receipt:{id:row.id,campaignId:id,campaignRevision:row.campaign_revision,requestKey:row.request_key,scheduledAt:row.scheduled_at,createdAt:row.created_at,replayed},publication};
  };
  const previous=await original();if(previous)return result(previous,true);
  if(seller.role==='viewer')fail('Your store role cannot publish campaigns',403);
  const configuration=campaignEmailConfiguration(env);if(!commerceStorageEnabled(env)||!configuration.ready)fail('Campaign delivery is not connected',503);
  const source=await campaign(env,actor,id);if(!source)fail('Campaign not found',404);
  if(await saved(env,actor,id))fail('This campaign already has a publication. Use its existing record.',409,'campaign_already_published');
  if(source.revision!==input.revision)fail('The campaign changed. Review the saved version before publishing.',409,'campaign_publication_changed');
  const values=campaignValues(JSON.parse(source.data_json));let shop={};try{shop=JSON.parse(seller.settings_json||'{}').storefront||{};}catch{}
  const frozen={sellerId:seller.id,storeName:seller.name,shopEnabled:shop.enabled===true,values};
  // Validate the rendered content without creating a token or provider request.
  try{campaignEmailPayload(configuration,frozen,configuration.sender,'campmail_'+'0'.repeat(32),configuration.origin+'/cart/unsubscribe.php?t='+'0'.repeat(64));}
  catch{fail('Complete the subject, heading and message, and enable your shop before including its button.');}
  const ctx=await customerContext(env,seller),filter=customerFilterSql(values.audience),now=Date.now(),created=new Date(now).toISOString(),sendAt=input.scheduledAt===null?created:scheduled(input.scheduledAt,now);
  const publicationId='cpub_'+(await commerceHash({seller:seller.id,mode,id})).slice(0,32);
  try{await env.DB.batch([
    env.DB.prepare(`INSERT INTO commerce_campaign_publications(id,campaign_id,seller_id,commerce_environment,actor_id,request_key,request_hash,campaign_revision,data_json,store_name,shop_enabled,order_cap,scheduled_at,created_at)
      VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).bind(publicationId,id,seller.id,mode,actor.id,input.requestKey,hash,source.revision,source.data_json,seller.name,Number(frozen.shopEnabled),ctx.cap,sendAt,created),
    env.DB.prepare(`INSERT INTO commerce_campaign_candidates(publication_id,customer_id,order_id,auth_user_id,email,name,consent_revision,created_at)
      SELECT ?,r.id,r.last_order,r.auth_user_id,r.address,r.name,r.consent_revision,? FROM (${customerCte}
        SELECT p.id,p.last_order,p.name,consent.auth_user_id,consent.email AS address,consent.revision AS consent_revision,
          ROW_NUMBER() OVER(PARTITION BY consent.auth_user_id,consent.email ORDER BY p.last_at DESC,p.id) AS address_position
        FROM profiles p JOIN orders o ON o.id=p.last_order LEFT JOIN commerce_order_owners owner ON owner.order_id=o.id
        JOIN commerce_customer_consents consent ON consent.seller_id=p.seller_id AND consent.commerce_environment=p.commerce_environment
          AND consent.auth_user_id=COALESCE(owner.auth_user_id,NULLIF(json_extract(o.customer_snapshot_json,'$.authUserId'),'')) AND consent.email=lower(trim(p.email))
        WHERE ${filter.where} AND consent.allowed=1) r WHERE r.address_position=1 ORDER BY r.id`).bind(publicationId,created,...ctx.bindings,...filter.values),
    env.DB.prepare(`INSERT INTO commerce_campaign_seals(publication_id,candidate_count,created_at)
      SELECT ?,COUNT(*),? FROM commerce_campaign_candidates WHERE publication_id=?`).bind(publicationId,created,publicationId)
  ]);}catch(error){
    const raced=await original();if(raced)return result(raced,true);
    if(await saved(env,actor,id))fail('This campaign already has a publication. Use its existing record.',409,'campaign_already_published');databaseFailure(error);
  }
  return result(await original(),false);
}
export async function changePublication(env,actor,id,input){
  fields(input,['kind','revision','requestKey','scheduledAt']);
  if(!validId(id)||!revision(input.revision)||!validKey(input.requestKey)||!['reschedule','cancel'].includes(input.kind)
    ||input.kind==='cancel'&&input.scheduledAt!==null||input.kind==='reschedule'&&!stamp(input.scheduledAt))fail('Publication change reference is invalid');
  const seller=await settingsActor(env,actor),row=await saved(env,actor,id);if(!row)fail('Publication not found',404);
  const hash=await commerceHash({actor:actor.id,seller:seller.id,mode:commerceReadEnvironment(env),publication:row.id,...input});
  const original=()=>env.DB.prepare('SELECT * FROM commerce_campaign_publication_actions WHERE actor_id=? AND request_key=?').bind(actor.id,input.requestKey).first();
  const result=async(r,replayed)=>{
    if(r.request_hash!==hash)fail('This change reference was already used for another request',409,'campaign_publication_reference');
    const latest=await saved(env,actor,id),publication=await view(env,latest);await settingsActor(env,actor);
    return {receipt:{id:r.publication_id,requestKey:r.request_key,revision:r.revision,kind:r.kind,scheduledAt:r.scheduled_at,createdAt:r.created_at,replayed},publication};
  };
  const previous=await original();if(previous)return result(previous,true);
  if(seller.role==='viewer')fail('Your store role cannot change campaign publication',403);
  const now=Date.now();if(input.kind==='reschedule')scheduled(input.scheduledAt,now);
  try{await env.DB.prepare(`INSERT INTO commerce_campaign_publication_actions(publication_id,actor_id,request_key,request_hash,expected_revision,revision,kind,scheduled_at,created_at)
    VALUES(?,?,?,?,?,?,?,?,?)`).bind(row.id,actor.id,input.requestKey,hash,input.revision,input.revision+1,input.kind,input.scheduledAt,new Date(now).toISOString()).run();}
  catch(error){const raced=await original();if(raced)return result(raced,true);databaseFailure(error);}
  return result(await original(),false);
}
export async function publicationRecipients(env,actor,id,url){
  await settingsActor(env,actor);query(url,['cursor']);const row=validId(id)&&await saved(env,actor,id);if(!row)fail('Publication not found',404);
  const scope=await commerceHash({actor,publication:row.id,view:'campaign_recipients'}),cursor=url.searchParams.has('cursor')?readReviewCursor(url.searchParams.get('cursor'),scope):null;
  if(cursor&&(!Number.isSafeInteger(cursor.after)||cursor.after<1))fail('Recipient page is invalid');
  const rows=await env.DB.prepare(`SELECT c.id,c.customer_id,c.name,c.email,c.consent_revision,j.state,j.result_json,d.delivery_state,d.skip_reason,d.needs_review,d.submitted_at,d.delivered_at FROM commerce_campaign_candidates c
    JOIN commerce_jobs j ON j.id='job_campaign_'||c.id JOIN commerce_campaign_delivery_status d ON d.candidate_id=c.id WHERE c.publication_id=? AND c.id>? ORDER BY c.id LIMIT 26`).bind(row.id,cursor?.after||0).all();
  const items=rows.results.slice(0,25).map(r=>({id:r.id,customerId:r.customer_id,name:r.name,email:r.email,consentRevision:r.consent_revision,
    state:r.result_json&&JSON.parse(r.result_json).cancelled===true?'cancelled':r.state,
    delivery:{state:r.delivery_state,reason:r.skip_reason,needsReview:Boolean(r.needs_review),submittedAt:r.submitted_at,deliveredAt:r.delivered_at}}));await settingsActor(env,actor);
  return {items,total:row.candidate_count,nextCursor:rows.results.length>25?reviewCursor({v:1,scope,after:items.at(-1).id}):null};
}
export async function publicationHistory(env,actor,id,url){
  await settingsActor(env,actor);query(url,['cursor']);const row=validId(id)&&await saved(env,actor,id);if(!row)fail('Publication not found',404);
  const scope=await commerceHash({actor,publication:row.id,view:'campaign_publication_history'}),cursor=url.searchParams.has('cursor')?readReviewCursor(url.searchParams.get('cursor'),scope):null;
  if(cursor&&(!Number.isSafeInteger(cursor.cap)||cursor.cap<0||!Number.isSafeInteger(cursor.before)||cursor.before<1||cursor.cap<cursor.before-1))fail('Publication history page is invalid');
  const cap=cursor?.cap??row.action_revision,before=cursor?.before??cap+1;
  const rows=await env.DB.prepare(`SELECT revision,kind,scheduled_at,created_at,actor_id FROM (
    SELECT 0 AS revision,'publish' AS kind,scheduled_at,created_at,actor_id FROM commerce_campaign_publications WHERE id=?
    UNION ALL SELECT revision,kind,scheduled_at,created_at,actor_id FROM commerce_campaign_publication_actions WHERE publication_id=?
    ) WHERE revision<=? AND revision<? ORDER BY revision DESC LIMIT 21`).bind(row.id,row.id,cap,before).all();
  const items=rows.results.slice(0,20).map(r=>({revision:r.revision,kind:r.kind,scheduledAt:r.scheduled_at,createdAt:r.created_at,actor:r.actor_id===actor.id?'you':'store_member'}));await settingsActor(env,actor);
  return {items,nextCursor:rows.results.length>20?reviewCursor({v:1,scope,cap,before:items.at(-1).revision}):null};
}
