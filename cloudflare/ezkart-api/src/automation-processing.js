import {commerceHash} from './commerce-orders.js';
import {commerceReadEnvironment} from './commerce-order-reads.js';
import {customerCteWithFrontier,customerFilterSql} from './commerce-customers.js';
import {automationReady,automationFailure} from './marketing-automations.js';
import {recordAutomationProcessingIssue} from './automation-processing-state.js';

// A scan receipt and every enrollment commit in one batch. Permission is pinned
// at the original event, not acquired retroactively when the scanner catches up.
export async function scanAutomationEvents(env){
  if(!automationReady(env))return {held:true,scanned:0,enrolled:0};
  const mode=commerceReadEnvironment(env),row=await env.DB.prepare(`SELECT a.* FROM commerce_automation_scan_state a
    JOIN sellers store ON store.id=a.seller_id AND store.status='active'
    JOIN seller_memberships member ON member.seller_id=a.seller_id AND member.auth_user_id=a.actor_id AND member.role!='viewer'
    WHERE a.commerce_environment=? AND a.state='active' AND EXISTS(SELECT 1 FROM commerce_marketing_events e
      WHERE e.seller_id=a.seller_id AND e.commerce_environment=a.commerce_environment AND e.sequence>a.scanned_through)
      AND NOT EXISTS(SELECT 1 FROM commerce_automation_processing_status issue WHERE issue.automation_id=a.id AND issue.rule_revision=a.revision
        AND issue.stage='scan' AND issue.retry_after>strftime('%Y-%m-%dT%H:%M:%fZ','now'))
    ORDER BY a.scanned_at,a.id LIMIT 1`).bind(mode).first();
  if(!row)return {held:false,scanned:0,enrolled:0};
  const upper=await env.DB.prepare(`SELECT MAX(sequence) AS cap,COUNT(*) AS n FROM (SELECT sequence FROM commerce_marketing_events
    WHERE seller_id=? AND commerce_environment=? AND sequence>? ORDER BY sequence LIMIT 50)`).bind(row.seller_id,mode,row.scanned_through).first();
  const id='ascan_'+(await commerceHash({automation:row.id,revision:row.revision,from:row.scanned_through,to:upper.cap})).slice(0,32),created=new Date().toISOString();
  const values=JSON.parse(row.data_json),filter=customerFilterSql(values.audience);
  const customerCte=customerCteWithFrontier('(SELECT order_cap FROM commerce_automation_scans WHERE id=?)');
  const receipt=()=>env.DB.prepare(`SELECT s.*,COUNT(e.id) AS enrolled FROM commerce_automation_scans s
    LEFT JOIN commerce_automation_enrollments e ON e.scan_id=s.id WHERE s.id=? GROUP BY s.id`).bind(id).first();
  try{await env.DB.batch([
    env.DB.prepare(`INSERT INTO commerce_automation_scans(id,automation_id,rule_revision,from_sequence,to_sequence,order_cap,event_count,created_at)
      VALUES(?,?,?,?,?,(SELECT COALESCE(MAX(rowid),0) FROM orders WHERE seller_id=? AND commerce_environment=? AND commerce_version=1),?,?)`)
      .bind(id,row.id,row.revision,row.scanned_through,upper.cap,row.seller_id,mode,upper.n,created),
    env.DB.prepare(`INSERT INTO commerce_automation_enrollments(scan_id,automation_id,rule_revision,event_sequence,customer_id,order_id,auth_user_id,email,name,consent_revision,due_at,created_at)
      SELECT ?,?,?,e.sequence,p.id,o.id,e.auth_user_id,e.email,COALESCE(json_extract(o.customer_snapshot_json,'$.name'),''),e.consent_revision,
        strftime('%Y-%m-%dT%H:%M:%fZ',e.occurred_at,'+'||?||' minutes'),? FROM (${customerCte} SELECT * FROM profiles) p
      JOIN commerce_marketing_events e ON e.seller_id=p.seller_id AND e.commerce_environment=p.commerce_environment AND e.sequence>? AND e.sequence<=?
      JOIN orders o ON o.id=COALESCE(e.order_id,p.last_order) AND o.customer_id=p.id AND o.seller_id=p.seller_id AND o.commerce_environment=p.commerce_environment AND o.commerce_version=1
      LEFT JOIN commerce_order_owners owner ON owner.order_id=o.id
      JOIN commerce_customer_consents consent ON consent.seller_id=e.seller_id AND consent.commerce_environment=e.commerce_environment AND consent.auth_user_id=e.auth_user_id AND consent.email=e.email
      WHERE ${filter.where} AND consent.allowed=1 AND consent.revision=e.consent_revision AND lower(trim(json_extract(o.customer_snapshot_json,'$.email')))=e.email
        AND COALESCE(owner.auth_user_id,NULLIF(json_extract(o.customer_snapshot_json,'$.authUserId'),''))=e.auth_user_id
        AND ((?='welcome' AND e.kind='permission') OR (? IN ('paid','winback') AND e.kind='payment') OR (?='expired' AND e.kind='expiry'))
      ORDER BY e.sequence,p.id`).bind(id,row.id,row.revision,values.delayMinutes,created,row.seller_id,mode,id,row.scanned_through,upper.cap,...filter.values,values.trigger,values.trigger,values.trigger)
  ]);}catch(error){
    const saved=await receipt();if(saved)return {held:false,scanned:saved.event_count,enrolled:saved.enrolled,scanId:id,replayed:true};
    const detail=String(error)+' '+String(error.cause||'');
    if(/automation_scan_(changed|immutable)/.test(detail))return {held:false,scanned:0,enrolled:0,changed:true};
    if(/automation_source_invalid|automation_enrollment_invalid/.test(detail)){
      await recordAutomationProcessingIssue(env,row.id,row.revision,'scan','source_invalid');
      automationFailure('Automation source evidence needs an operator review.',503,'automation_source_invalid');
    }
    throw error;
  }
  const saved=await receipt();if(!saved)automationFailure('Automation scan was not confirmed. Retry processing.',503);
  return {held:false,scanned:saved.event_count,enrolled:saved.enrolled,scanId:id,replayed:false};
}
