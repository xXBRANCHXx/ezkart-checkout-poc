export async function recordAutomationProcessingIssue(env,automationId,revision,stage,code){
  const created=new Date().toISOString();
  await env.DB.prepare(`INSERT INTO commerce_automation_processing_issues(automation_id,rule_revision,stage,code,created_at,retry_after)
    SELECT id,revision,?,?,?,strftime('%Y-%m-%dT%H:%M:%fZ',?,'+5 minutes') FROM commerce_automations
    WHERE id=? AND revision=? AND state='active'`).bind(stage,code,created,created,automationId,revision).run();
}
