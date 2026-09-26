import {commerceHash} from './commerce-orders.js';
import {commerceReadEnvironment} from './commerce-order-reads.js';
import {settingsActor} from './merchant-settings.js';
import {reportFailure,reportParameters} from './campaign-reports.js';
import {campaignPerformanceContext,campaignPerformanceCte,campaignPerformanceMetrics,campaignConversionSql} from './campaign-performance.js';

export const campaignPerformanceHeaders=['Publication ID','Campaign ID','Campaign','Subject','Published (UTC)','Scheduled send (UTC)','Campaign cancelled',...Object.values(campaignPerformanceMetrics),'Visit conversion (%)'];
const get=(env,actor,id)=>env.DB.prepare('SELECT * FROM commerce_campaign_performance_exports WHERE id=? AND seller_id=? AND commerce_environment=?').bind(id,actor.sellerId,commerceReadEnvironment(env)).first();
const metadata=row=>{
  if(row.expires_at<=new Date().toISOString())reportFailure('This campaign export has expired. Create a new export.',410);
  if(row.state!=='ready')reportFailure('The export was not confirmed. Retry its original request.',503);
  const period=JSON.parse(row.period_json);
  return {id:row.id,storeId:row.seller_id,environment:row.commerce_environment,requestKey:row.request_key,cohort:row.cohort,period,createdAt:row.created_at,expiresAt:row.expires_at,rowCount:row.row_count,headers:campaignPerformanceHeaders,filename:`ezkart-campaign-performance-${period.from}-${period.to}.csv`};
};
export async function createCampaignPerformanceExport(env,actor,input){
  if(!input||typeof input!=='object'||Array.isArray(input)||Object.keys(input).sort().join(',')!=='cohort,requestKey'||typeof input.cohort!=='string'||!/^[A-Za-z0-9_-]{1,1600}$/.test(input.cohort)||typeof input.requestKey!=='string'||!/^[a-f0-9]{32}$/.test(input.requestKey))reportFailure('Campaign export reference is invalid');
  await settingsActor(env,actor);const mode=commerceReadEnvironment(env),id='cpex_'+(await commerceHash({actor,mode,key:input.requestKey})).slice(0,32),hash=await commerceHash({actor,mode,cohort:input.cohort});
  const existing=await get(env,actor,id);if(existing){if(existing.request_hash!==hash)reportFailure('This export reference belongs to another report',409);const value=metadata(existing);await settingsActor(env,actor);return {export:value,replayed:true};}
  const ctx=await campaignPerformanceContext(env,actor,new URLSearchParams({cohort:input.cohort}),true),created=new Date().toISOString();let replayed=false;
  try{const result=await env.DB.batch([
    env.DB.prepare(`INSERT INTO commerce_campaign_performance_exports(id,seller_id,commerce_environment,actor_id,request_key,request_hash,cohort,period_json,publication_cap,publication_cutoff,start_at,end_at,created_at,expires_at)
      SELECT ?,?,?,?,?,?,?,?,?,?,?,?,?,? WHERE NOT EXISTS(SELECT 1 FROM commerce_campaign_performance_exports WHERE id=?)`)
      .bind(id,actor.sellerId,mode,actor.id,input.requestKey,hash,input.cohort,JSON.stringify(ctx.period),ctx.c.cap,ctx.c.at,ctx.start,ctx.end,created,new Date(Date.parse(created)+86400000).toISOString(),id),
    env.DB.prepare(`INSERT INTO commerce_campaign_performance_export_rows(export_id,ordinal,publication_id,cells_json)
      SELECT ?,ROW_NUMBER() OVER(ORDER BY n DESC),id,json(CASE WHEN corrupt=0 THEN json_array(id,campaign_id,name,subject,published_at,scheduled_at,CASE campaign_cancelled WHEN 1 THEN 'Yes' ELSE 'No' END,${Object.keys(campaignPerformanceMetrics).join(',')},${campaignConversionSql}) ELSE 'invalid campaign evidence' END)
      FROM (${campaignPerformanceCte} SELECT * FROM performance WHERE segment=0) WHERE EXISTS(SELECT 1 FROM commerce_campaign_performance_exports WHERE id=? AND request_hash=? AND state='building')`)
      .bind(id,...ctx.bindings,id,hash),
    env.DB.prepare(`UPDATE commerce_campaign_performance_exports SET state='ready',row_count=(SELECT COUNT(*) FROM commerce_campaign_performance_export_rows WHERE export_id=?)
      WHERE id=? AND request_hash=? AND state='building'`).bind(id,id,hash)
  ]);replayed=result[0].meta.changes===0;}catch(error){
    const committed=await get(env,actor,id);if(committed?.request_hash===hash&&committed.state==='ready'){const value=metadata(committed);await settingsActor(env,actor);return {export:value,replayed:true};}
    const detail=String(error)+' '+String(error.cause||'');if(detail.includes('campaign_performance_rate'))reportFailure('The export limit is 20 new snapshots per hour. Retry an existing export or try later.',429);
    if(detail.includes('malformed JSON')||detail.includes('campaign_performance_row'))reportFailure('Campaign performance evidence needs an operator review before this export is available.',503);
    if(detail.includes('campaign_performance_forbidden'))reportFailure('Your store access changed. Reload this page.',403);throw error;
  }
  const row=await get(env,actor,id);if(!row||row.request_hash!==hash)reportFailure('This export reference belongs to another report',409);
  const value=metadata(row);await settingsActor(env,actor);return {export:value,replayed};
}
export async function readCampaignPerformanceExport(env,actor,id,url){
  await settingsActor(env,actor);reportParameters(url,['after','limit']);
  const after=url.searchParams.get('after')??'0',limit=url.searchParams.get('limit')??'250';
  if(!/^cpex_[a-f0-9]{32}$/.test(id)||!/^(0|[1-9][0-9]{0,12})$/.test(after)||!/^[1-9][0-9]{0,2}$/.test(limit)||Number(limit)>500)reportFailure('Campaign export page is invalid');
  const row=await get(env,actor,id);if(!row)reportFailure('Campaign export not found',404);const value=metadata(row);
  if(Number(after)>value.rowCount)reportFailure('The export page is outside this snapshot');
  const result=await env.DB.prepare('SELECT ordinal,cells_json FROM commerce_campaign_performance_export_rows WHERE export_id=? AND ordinal>? ORDER BY ordinal LIMIT ?').bind(id,Number(after),Number(limit)).all();
  const rows=result.results.map(r=>({ordinal:r.ordinal,cells:JSON.parse(r.cells_json)})),last=rows.at(-1)?.ordinal??Number(after);
  if(rows.some((r,i)=>r.ordinal!==Number(after)+i+1)||last<value.rowCount&&rows.length<Number(limit))reportFailure('This export is no longer available. Create a new export.',410);
  await settingsActor(env,actor);return {export:value,rows,nextAfter:last<value.rowCount?last:null};
}
export async function cleanupCampaignPerformanceExports(env){
  await env.DB.batch([
    env.DB.prepare(`DELETE FROM commerce_campaign_performance_export_rows WHERE rowid IN (SELECT r.rowid FROM commerce_campaign_performance_export_rows r JOIN commerce_campaign_performance_exports e ON e.id=r.export_id WHERE e.expires_at<=strftime('%Y-%m-%dT%H:%M:%fZ','now') LIMIT 5000)`),
    env.DB.prepare(`DELETE FROM commerce_campaign_performance_exports WHERE rowid IN (SELECT e.rowid FROM commerce_campaign_performance_exports e WHERE e.expires_at<=strftime('%Y-%m-%dT%H:%M:%fZ','now') AND NOT EXISTS(SELECT 1 FROM commerce_campaign_performance_export_rows r WHERE r.export_id=e.id) LIMIT 100)`)
  ]);
}
