export const campaignAutomationSource=async(env,campaignId)=>{
  const row=await env.DB.prepare('SELECT automation_id,rule_revision,id FROM commerce_automation_runs WHERE campaign_id=?').bind(campaignId).first();
  return row?{id:row.automation_id,revision:row.rule_revision,runId:row.id}:null;
};
