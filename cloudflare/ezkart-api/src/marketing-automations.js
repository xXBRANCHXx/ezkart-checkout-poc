import {commerceHash,commerceStorageEnabled} from './commerce-orders.js';
import {commerceReadEnvironment} from './commerce-order-reads.js';
import {settingsActor,publicStoreProfile} from './merchant-settings.js';
import {campaignValues} from './marketing-campaigns.js';
import {campaignEmailConfiguration} from './email-provider.js';
import {campaignEmailPayload} from './campaign-email-template.js';
import {readReviewCursor,reviewCursor} from './commerce-reviews.js';

export const automationFailure=(message,status=422,code='')=>{throw new Response(message,{status,headers:code?{'x-ezkart-error-code':code}:{}});};
const fail=automationFailure;
export const automationReady=env=>env.COMMERCE_MARKETING_AUTOMATIONS==='enabled'&&commerceStorageEnabled(env)&&campaignEmailConfiguration(env).ready;
export const automationId=id=>typeof id==='string'&&/^auto_[a-f0-9]{32}$/.test(id);
const key=value=>typeof value==='string'&&/^[a-f0-9]{32}$/.test(value);
const revision=value=>Number.isSafeInteger(value)&&value>=0&&value<Number.MAX_SAFE_INTEGER;
const exact=(value,fields)=>value&&typeof value==='object'&&!Array.isArray(value)&&Object.keys(value).sort().join(',')===[...fields].sort().join(',');
export const automationFields=['name','trigger','delayMinutes','cooldownDays','subject','preheader','heading','body','buttonLabel','audience'];
export function automationValues(input){
  if(!exact(input,automationFields)||!['welcome','paid','expired','winback'].includes(input.trigger)
    ||!Number.isSafeInteger(input.delayMinutes)||input.delayMinutes<0||input.delayMinutes>(input.trigger==='winback'?525600:43200)
    ||input.trigger==='winback'&&input.delayMinutes<1440||!Number.isSafeInteger(input.cooldownDays)||input.cooldownDays<1||input.cooldownDays>90)
    fail('Choose a supported automation trigger, delay and repeat interval');
  const {trigger,delayMinutes,cooldownDays,...copy}=input,values=campaignValues({...copy,plannedAt:null,archived:false});
  const {plannedAt,archived,...content}=values;return {...content,trigger,delayMinutes,cooldownDays};
}
export const automationCampaignValues=values=>({name:values.name,subject:values.subject,preheader:values.preheader,heading:values.heading,body:values.body,
  buttonLabel:values.buttonLabel,audience:values.audience,plannedAt:null,archived:false});
const query=(url,fields)=>{for(const k of url.searchParams.keys())if(!fields.includes(k)||url.searchParams.getAll(k).length!==1)fail('Automation parameters are invalid');};
export const automationView=row=>({id:row.id,revision:row.revision,state:row.state,values:JSON.parse(row.data_json),createdAt:row.created_at,updatedAt:row.updated_at});
export const automationRow=(env,actor,id)=>env.DB.prepare('SELECT * FROM commerce_automations WHERE id=? AND seller_id=? AND commerce_environment=?')
  .bind(id,actor.sellerId,commerceReadEnvironment(env)).first();
export async function listAutomations(env,actor,url){
  const seller=await settingsActor(env,actor),mode=commerceReadEnvironment(env);query(url,['state','q','cursor']);
  const state=url.searchParams.get('state')||'available',term=(url.searchParams.get('q')||'').trim();
  if(!['available','active','paused','archived','all'].includes(state)||term.length>120||/[\u0000-\u001f]/.test(term))fail('Automation filters are invalid');
  const scope=await commerceHash({actor,mode,state,term,view:'automations'}),cursor=url.searchParams.has('cursor')?readReviewCursor(url.searchParams.get('cursor'),scope):null;
  if(cursor&&(!Number.isSafeInteger(cursor.cap)||cursor.cap<0||!Number.isSafeInteger(cursor.before)||cursor.before<1||cursor.before>cursor.cap+1))fail('Automation page is invalid');
  const cap=cursor?.cap??(await env.DB.prepare('SELECT COALESCE(MAX(rowid),0) AS cap FROM commerce_automations WHERE seller_id=? AND commerce_environment=?').bind(seller.id,mode).first()).cap;
  const [totals,rows]=await env.DB.batch([
    env.DB.prepare(`SELECT COUNT(*) AS total,COALESCE(SUM(state='active'),0) AS active,COALESCE(SUM(state='paused'),0) AS paused,COALESCE(SUM(state='archived'),0) AS archived
      FROM commerce_automations WHERE seller_id=? AND commerce_environment=?`).bind(seller.id,mode),
    env.DB.prepare(`SELECT rowid AS n,* FROM commerce_automations WHERE seller_id=? AND commerce_environment=? AND rowid<=? AND rowid<?
      AND (?='all' OR (?='available' AND state!='archived') OR state=?) AND (?='' OR instr(lower(json_extract(data_json,'$.name')||' '||json_extract(data_json,'$.subject')),lower(?))>0)
      ORDER BY rowid DESC LIMIT 26`).bind(seller.id,mode,cap,cursor?.before??cap+1,state,state,state,term,term)
  ]);await settingsActor(env,actor);const items=rows.results.slice(0,25);
  return {storeId:seller.id,environment:mode,canEdit:seller.role!=='viewer',processingAvailable:automationReady(env),timezone:publicStoreProfile(seller).timezone,
    summary:totals.results[0],items:items.map(automationView),nextCursor:rows.results.length>25?reviewCursor({v:1,scope,cap,before:items.at(-1).n}):null};
}
export async function readAutomation(env,actor,id,url){
  await settingsActor(env,actor);query(url,[]);const row=automationId(id)&&await automationRow(env,actor,id);if(!row)fail('Automation not found',404);
  const status=await automationStatus(env,row);await settingsActor(env,actor);return {automation:automationView(row),processingAvailable:automationReady(env),...status};
}
export function automationDatabaseFailure(error){
  const detail=String(error)+' '+String(error.cause||'');
  if(detail.includes('automation_forbidden'))fail('Your store access changed. Reload this automation.',403);
  if(detail.includes('automation_revision_conflict'))fail('This automation changed in another session. Review the saved version.',409,'automation_revision_conflict');
  if(detail.includes('automation_transition'))fail('Pause this automation before editing or archiving it.',409,'automation_state_changed');
  if(detail.includes('automation_boundary'))fail('New activity arrived while activating. Review and retry the original action.',409,'automation_boundary_changed');
  if(detail.includes('automation_activation'))fail('Complete the message and enable your shop before including its button.');
  if(detail.includes('automation_limit'))fail('The store limit is 100 saved automations and 20 active automations.',429);
  if(detail.includes('automation_rate'))fail('Too many automation changes. Try again later.',429);
  throw error;
}
async function change(env,actor,id,kind,input){
  const saving=kind==='save';
  if(!exact(input,saving?['id','revision','requestKey','values']:['revision','requestKey','kind'])||!revision(input.revision)||!key(input.requestKey)
    ||saving&&input.id!==null&&!automationId(input.id)||!saving&&(!automationId(id)||!['activate','pause','archive','restore'].includes(kind)))fail('Automation change reference is invalid');
  const seller=await settingsActor(env,actor),mode=commerceReadEnvironment(env),values=saving?automationValues(input.values):null;
  id=saving?(input.id||'auto_'+(await commerceHash({actor:actor.id,seller:seller.id,mode,key:input.requestKey})).slice(0,32)):id;
  const hash=await commerceHash({actor:actor.id,seller:seller.id,mode,id,kind,revision:input.revision,...(saving?{values}:{})});
  const original=()=>env.DB.prepare('SELECT * FROM commerce_automation_changes WHERE actor_id=? AND request_key=?').bind(actor.id,input.requestKey).first();
  const result=async(receipt,replayed)=>{
    if(receipt.request_hash!==hash)fail('This request reference belongs to another automation change',409,'automation_reference_conflict');
    const current=await automationRow(env,actor,id);await settingsActor(env,actor);if(!current)fail('The saved automation is unavailable',503);
    return {receipt:{id,revision:receipt.revision,kind:receipt.kind,state:receipt.state,values:JSON.parse(receipt.data_json),requestKey:receipt.request_key,createdAt:receipt.created_at,replayed},automation:automationView(current)};
  };
  const old=await original();if(old)return result(old,true);
  if(seller.role==='viewer')fail('Your store role cannot change automations',403);
  const current=await automationRow(env,actor,id);
  if(saving&&input.id===null&&input.revision!==0)fail('A new automation must start as a paused draft');
  if((!saving||input.id!==null)&&!current)fail('Automation not found',404);
  if(current?.revision!==input.revision&&input.revision!==0)fail('This automation changed in another session. Review the saved version.',409,'automation_revision_conflict');
  const data=saving?JSON.stringify(values):current.data_json,state={save:'paused',activate:'active',pause:'paused',archive:'archived',restore:'paused'}[kind];
  if(kind==='activate'){
    if(!automationReady(env))fail('Automation processing is not connected yet. You can save and edit paused drafts.',503);
    const configuration=campaignEmailConfiguration(env),copy=automationCampaignValues(JSON.parse(data));let shop={};try{shop=JSON.parse(seller.settings_json||'{}').storefront||{};}catch{}
    try{campaignEmailPayload(configuration,{sellerId:seller.id,storeName:seller.name,shopEnabled:shop.enabled===true,values:copy},configuration.sender,'campmail_'+'0'.repeat(32),configuration.origin+'/cart/unsubscribe.php?t='+'0'.repeat(64));}
    catch{fail('Complete the message and enable your shop before including its button.');}
  }
  try{await env.DB.prepare(`INSERT INTO commerce_automation_changes(automation_id,seller_id,commerce_environment,actor_id,request_key,request_hash,
    expected_revision,revision,kind,state,data_json,event_after,created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,
    CASE WHEN ?='activate' THEN (SELECT COALESCE(MAX(sequence),0) FROM commerce_marketing_events WHERE seller_id=? AND commerce_environment=?)
      ELSE COALESCE((SELECT event_after FROM commerce_automations WHERE id=?),0) END,?)`)
    .bind(id,seller.id,mode,actor.id,input.requestKey,hash,input.revision,input.revision+1,kind,state,data,kind,seller.id,mode,id,new Date().toISOString()).run();}
  catch(error){const raced=await original();if(raced)return result(raced,true);automationDatabaseFailure(error);}
  return result(await original(),false);
}
export const saveAutomation=(env,actor,input)=>change(env,actor,null,'save',input);
export const changeAutomation=(env,actor,id,input)=>change(env,actor,id,input?.kind,input);
export async function automationHistory(env,actor,id,url){
  await settingsActor(env,actor);query(url,['cursor']);const row=automationId(id)&&await automationRow(env,actor,id);if(!row)fail('Automation not found',404);
  const scope=await commerceHash({actor,id,mode:commerceReadEnvironment(env),view:'automation_history'}),cursor=url.searchParams.has('cursor')?readReviewCursor(url.searchParams.get('cursor'),scope):null;
  if(cursor&&(!revision(cursor.cap)||cursor.cap<1||!Number.isSafeInteger(cursor.before)||cursor.before<1||cursor.before>cursor.cap+1))fail('Automation history page is invalid');
  const cap=cursor?.cap??row.revision,rows=await env.DB.prepare('SELECT * FROM commerce_automation_changes WHERE automation_id=? AND revision<=? AND revision<? ORDER BY revision DESC LIMIT 21')
    .bind(id,cap,cursor?.before??cap+1).all();await settingsActor(env,actor);const items=rows.results.slice(0,20).map(r=>({revision:r.revision,kind:r.kind,state:r.state,values:JSON.parse(r.data_json),createdAt:r.created_at,actor:r.actor_id===actor.id?'you':'store_member'}));
  return {items,nextCursor:rows.results.length>20?reviewCursor({v:1,scope,cap,before:items.at(-1).revision}):null};
}

async function automationStatus(env,row){
  const [totals,issues,frontier]=await env.DB.batch([
    env.DB.prepare(`SELECT COUNT(*) AS enrolled,COALESCE(SUM(state IN ('waiting','due')),0) AS waiting,COALESCE(SUM(state='stopping'),0) AS stopping,
      COALESCE(SUM(outcome='published'),0) AS published,COALESCE(SUM(submitted_at IS NOT NULL),0) AS submitted,
      COALESCE(SUM(delivered_confirmed),0) AS delivered,COALESCE(SUM(state IN ('skipped','cancelled')),0) AS skipped,
      COALESCE(SUM(needs_review),0) AS needsReview FROM commerce_automation_activity WHERE automation_id=?`).bind(row.id),
    env.DB.prepare(`SELECT stage,code,created_at,retry_after FROM commerce_automation_processing_status WHERE automation_id=? AND rule_revision=? ORDER BY stage`).bind(row.id,row.revision),
    env.DB.prepare('SELECT MAX(created_at) AS scanned_at FROM commerce_automation_scans WHERE automation_id=? AND rule_revision=?').bind(row.id,row.revision)
  ]);
  return {summary:totals.results[0],processingIssues:issues.results.map(r=>({stage:r.stage,code:r.code,createdAt:r.created_at,retryAfter:r.retry_after})),
    lastCheckedAt:frontier.results[0]?.scanned_at||null};
}
export async function automationActivity(env,actor,id,url){
  await settingsActor(env,actor);query(url,['cursor','status']);const row=automationId(id)&&await automationRow(env,actor,id);if(!row)fail('Automation not found',404);
  const status=url.searchParams.get('status')||'all',filters={all:'1',waiting:"a.state IN ('waiting','due','stopping')",published:"a.outcome='published'",skipped:"a.state IN ('skipped','cancelled')",needs_review:'a.needs_review=1'};
  if(!Object.hasOwn(filters,status))fail('Automation activity filter is invalid');
  const scope=await commerceHash({actor,id,mode:commerceReadEnvironment(env),status,view:'automation_activity'}),cursor=url.searchParams.has('cursor')?readReviewCursor(url.searchParams.get('cursor'),scope):null;
  if(cursor&&(!Number.isSafeInteger(cursor.cap)||cursor.cap<0||!Number.isSafeInteger(cursor.before)||cursor.before<1||cursor.before>cursor.cap+1))fail('Automation activity page is invalid');
  const cap=cursor?.cap??(await env.DB.prepare('SELECT COALESCE(MAX(id),0) AS cap FROM commerce_automation_enrollments WHERE automation_id=?').bind(id).first()).cap;
  const rows=await env.DB.prepare(`SELECT * FROM commerce_automation_activity a WHERE a.automation_id=? AND a.id<=? AND a.id<? AND ${filters[status]} ORDER BY a.id DESC LIMIT 26`).bind(id,cap,cursor?.before??cap+1).all();
  await settingsActor(env,actor);const items=rows.results.slice(0,25);
  return {filter:status,items:items.map(r=>({id:r.id,ruleRevision:r.rule_revision,customerId:r.customer_id,orderId:r.order_id,name:r.name,email:r.email,
    consentRevision:r.consent_revision,trigger:r.trigger_kind,eventAt:r.event_at,dueAt:r.due_at,createdAt:r.created_at,state:r.state,reason:r.reason,needsReview:Boolean(r.needs_review),
    campaignId:r.campaign_id,publicationId:r.publication_id,submittedAt:r.submitted_at,deliveredAt:r.delivered_at})),
    nextCursor:rows.results.length>25?reviewCursor({v:1,scope,cap,before:items.at(-1).id}):null};
}
