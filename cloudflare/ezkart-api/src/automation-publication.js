import {commerceHash} from './commerce-orders.js';
import {commerceReadEnvironment} from './commerce-order-reads.js';
import {automationReady,automationFailure,automationCampaignValues} from './marketing-automations.js';
import {campaignEmailConfiguration} from './email-provider.js';
import {campaignEmailPayload} from './campaign-email-template.js';
import {recordAutomationProcessingIssue} from './automation-processing-state.js';

const skippedReasons=['paused','store_closed','access_removed','preference_off','consent_changed','shop_disabled','order_changed','superseded','audience_changed','frequency','stale'];
export async function skipAutomationEnrollments(env){
  if(!automationReady(env))return {held:true,skipped:0};
  const result=await env.DB.prepare(`INSERT INTO commerce_automation_outcomes(enrollment_id,state,reason,run_id,candidate_id,created_at)
    SELECT e.id,'skipped',e.reason,NULL,NULL,? FROM commerce_automation_eligibility e WHERE e.commerce_environment=?
      AND e.reason IN (SELECT value FROM json_each(?)) AND NOT EXISTS(SELECT 1 FROM commerce_automation_outcomes done WHERE done.enrollment_id=e.id)
    ORDER BY e.due_at,e.id LIMIT 50`).bind(new Date().toISOString(),commerceReadEnvironment(env),JSON.stringify(skippedReasons)).run();
  return {held:false,skipped:result.meta.changes};
}
export async function publishAutomationBatch(env){
  if(!automationReady(env))return {held:true,published:0};
  const mode=commerceReadEnvironment(env),first=await env.DB.prepare(`SELECT e.*,store.name AS store_name,
      COALESCE(json_extract(store.settings_json,'$.storefront.enabled'),0) AS shop_enabled
    FROM commerce_automation_eligibility e JOIN sellers store ON store.id=e.seller_id WHERE e.commerce_environment=? AND e.reason=''
      AND e.due_at<=strftime('%Y-%m-%dT%H:%M:%fZ','now') AND NOT EXISTS(SELECT 1 FROM commerce_automation_outcomes done WHERE done.enrollment_id=e.id)
      AND NOT EXISTS(SELECT 1 FROM commerce_automation_processing_status issue WHERE issue.automation_id=e.automation_id AND issue.rule_revision=e.rule_revision
        AND issue.stage='publish' AND issue.retry_after>strftime('%Y-%m-%dT%H:%M:%fZ','now'))
    ORDER BY e.due_at,e.id LIMIT 1`).bind(mode).first();
  if(!first)return {held:false,published:0};
  const rows=await env.DB.prepare(`SELECT id FROM (SELECT e.id,e.due_at,ROW_NUMBER() OVER(PARTITION BY e.auth_user_id,e.email ORDER BY e.due_at,e.id) AS position
    FROM commerce_automation_eligibility e WHERE e.automation_id=? AND e.rule_revision=? AND e.reason='' AND e.due_at<=strftime('%Y-%m-%dT%H:%M:%fZ','now')
      AND NOT EXISTS(SELECT 1 FROM commerce_automation_outcomes done WHERE done.enrollment_id=e.id)) WHERE position=1 ORDER BY due_at,id LIMIT 25`)
    .bind(first.automation_id,first.rule_revision).all();
  if(!rows.results.length)return {held:false,published:0,changed:true};
  const ids=rows.results.map(r=>r.id).sort((a,b)=>a-b),selection=JSON.stringify(ids),hash=await commerceHash({automation:first.automation_id,revision:first.rule_revision,enrollments:ids});
  const id='arun_'+hash.slice(0,32),campaignId='cmp_'+hash.slice(0,32),publicationId='cpub_'+hash.slice(0,32),created=new Date().toISOString();
  const draftKey=(await commerceHash({run:id,stage:'draft'})).slice(0,32),publicationKey=(await commerceHash({run:id,stage:'publication'})).slice(0,32);
  const copy=automationCampaignValues(JSON.parse(first.data_json)),data=JSON.stringify(copy),configuration=campaignEmailConfiguration(env);
  const original=()=>env.DB.prepare('SELECT * FROM commerce_automation_runs WHERE id=?').bind(id).first();
  const recover=saved=>{
    if(saved.state!=='ready'||saved.automation_id!==first.automation_id||saved.rule_revision!==first.rule_revision||saved.enrollment_ids_json!==selection
      ||saved.campaign_id!==campaignId||saved.publication_id!==publicationId)automationFailure('This automation publication needs an operator review.',503);
    return {held:false,published:ids.length,runId:id,publicationId,campaignId,replayed:true};
  };
  const previous=await original();if(previous)return recover(previous);
  try{campaignEmailPayload(configuration,{sellerId:first.seller_id,storeName:first.store_name,shopEnabled:Boolean(first.shop_enabled),values:copy},configuration.sender,
    'campmail_'+'0'.repeat(32),configuration.origin+'/cart/unsubscribe.php?t='+'0'.repeat(64));}
  catch(error){
    await recordAutomationProcessingIssue(env,first.automation_id,first.rule_revision,'publish','publication_invalid');
    automationFailure('The saved automation message needs an operator review.',503,'automation_publication_invalid');
  }
  try{await env.DB.batch([
    env.DB.prepare(`INSERT INTO commerce_campaign_changes(actor_id,request_key,request_hash,campaign_id,seller_id,commerce_environment,expected_revision,revision,data_json,created_at)
      VALUES(?,?,?,?,?,?,0,1,?,?)`).bind(first.actor_id,draftKey,hash,campaignId,first.seller_id,mode,data,created),
    env.DB.prepare(`INSERT INTO commerce_campaign_publications(id,campaign_id,seller_id,commerce_environment,actor_id,request_key,request_hash,campaign_revision,data_json,store_name,shop_enabled,order_cap,scheduled_at,created_at)
      VALUES(?,?,?,?,?,?,?,1,?,?,?,(SELECT COALESCE(MAX(rowid),0) FROM orders WHERE seller_id=? AND commerce_environment=? AND commerce_version=1),?,?)`)
      .bind(publicationId,campaignId,first.seller_id,mode,first.actor_id,publicationKey,hash,data,first.store_name,Number(first.shop_enabled),first.seller_id,mode,created,created),
    env.DB.prepare(`INSERT INTO commerce_automation_runs(id,automation_id,rule_revision,campaign_id,publication_id,enrollment_ids_json,created_at)
      VALUES(?,?,?,?,?,?,?)`).bind(id,first.automation_id,first.rule_revision,campaignId,publicationId,selection,created),
    env.DB.prepare(`INSERT INTO commerce_campaign_candidates(publication_id,customer_id,order_id,auth_user_id,email,name,consent_revision,created_at)
      SELECT ?,customer_id,order_id,auth_user_id,email,name,consent_revision,? FROM commerce_automation_eligibility WHERE id IN (SELECT value FROM json_each(?))
        AND reason='' AND due_at<=? ORDER BY id`).bind(publicationId,created,selection,created),
    env.DB.prepare(`INSERT INTO commerce_campaign_seals(publication_id,candidate_count,created_at)
      SELECT ?,COUNT(*),? FROM commerce_campaign_candidates WHERE publication_id=?`).bind(publicationId,created,publicationId),
    env.DB.prepare(`INSERT INTO commerce_automation_outcomes(enrollment_id,state,reason,run_id,candidate_id,created_at)
      SELECT e.id,'published','',?,c.id,? FROM commerce_automation_enrollments e JOIN commerce_campaign_candidates c ON c.publication_id=?
        AND c.customer_id=e.customer_id AND c.order_id=e.order_id AND c.auth_user_id=e.auth_user_id AND c.email=e.email
        AND c.consent_revision=e.consent_revision WHERE e.id IN (SELECT value FROM json_each(?))`).bind(id,created,publicationId,selection),
    env.DB.prepare("UPDATE commerce_automation_runs SET state='ready' WHERE id=? AND state='building'").bind(id)
  ]);}catch(error){
    const saved=await original();if(saved)return recover(saved);
    const detail=String(error)+' '+String(error.cause||'');
    if(/campaign_(rate_limited|publication_rate)/.test(detail)){
      await recordAutomationProcessingIssue(env,first.automation_id,first.rule_revision,'publish','rate_limited');
      return {held:false,published:0,limited:true};
    }
    if(/automation_(run_invalid|outcome_invalid|outcome_immutable)|campaign_(forbidden|publication_forbidden|publication_boundary|candidate_ineligible)|UNIQUE constraint failed/.test(detail))return {held:false,published:0,changed:true};
    throw error;
  }
  const saved=await original();if(!saved)automationFailure('Automation publication was not confirmed. Retry processing.',503);
  return {...recover(saved),replayed:false};
}
