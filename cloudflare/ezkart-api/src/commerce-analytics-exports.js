import {commerceHash} from './commerce-orders.js';
import {commerceReadEnvironment} from './commerce-order-reads.js';
import {analyticsReports,analyticsFailure,analyticsParameters,analyticsContext,analyticsCte,analyticsSummarySql,analyticsReportRows} from './commerce-analytics.js';

const headers = {
  overview:['Metric','Selected period','Previous period'],
  products:['Product ID','Product','Orders','Paid orders','Ordered units','Paid units','Item revenue (IDR)'],
  payments:['Method','Orders','Verified paid','Pending or creating','Failed or expired','Other','Payment rate (%)','Gross verified payments (IDR)'],
  orders:['Order','Created (WIB)','Payment status','Fulfillment','Payment method','Product amount (IDR)','Shipping (IDR)','Total (IDR)','Verified payment (IDR)','Additional captures (IDR)'],
};
headers.revenue=headers.orders;
function exportSql(report, hasPrevious) {
  if(report==='overview'){
    const metrics=[['Gross verified payments (IDR)','revenue'],['Additional captures (IDR)','additional'],['Orders','orders'],
      ['Payment rate (%)','CASE WHEN orders>0 THEN 100.0*paid/orders END'],
      ['Average paid order (IDR)',"CASE WHEN paid>0 THEN CAST((CAST(revenue AS INTEGER)+paid/2)/paid AS TEXT) END"],
      ['Paid units','units'],['Failed or expired orders','failed']];
    const value=segment=>`CASE CAST(m.key AS INTEGER) ${metrics.map(([,expression],i)=>
      `WHEN ${i} THEN (SELECT ${expression} FROM summaries WHERE segment=${segment})`).join(' ')} END`;
    return `, summaries AS (${analyticsSummarySql}) SELECT CAST(m.key AS INTEGER)+1 AS ordinal,
      json_array(m.value,${value(0)},${hasPrevious?value(1):'NULL'}) AS cells_json
      FROM json_each('${JSON.stringify(metrics.map(([label])=>label))}') m`;
  }
  const order=report==='products'?'CAST(revenue AS INTEGER) DESC,units DESC,key':report==='payments'?'orders DESC,name':'created_at DESC,order_id DESC';
  const cells=report==='products'?'key,name,orders,paid_orders,ordered_units,units,revenue'
    :report==='payments'?'name,orders,paid,pending,failed,other,100.0*paid/orders,revenue'
      :"order_id,strftime('%Y-%m-%d %H:%M:%S',created_at,'+7 hours'),status,stage,payment_type,subtotal,shipping_price,total,confirmed,additional";
  return `, report_rows AS (${analyticsReportRows(report)}) SELECT ROW_NUMBER() OVER (ORDER BY ${order}) AS ordinal,json_array(${cells}) AS cells_json FROM report_rows`;
}
const getExport=(env,seller,id)=>env.DB.prepare('SELECT * FROM commerce_analytics_exports WHERE id=? AND seller_id=? AND commerce_environment=?')
  .bind(id,seller.id,commerceReadEnvironment(env)).first();
function metadata(row) {
  if(Date.parse(row.expires_at)<=Date.now())analyticsFailure('This export has expired. Create a new export.',410);
  if(row.state!=='ready')analyticsFailure('The export is not ready. Retry with the same request.',503);
  const period=JSON.parse(row.period_json);
  return {id:row.id,report:row.report,period,createdAt:row.created_at,expiresAt:row.expires_at,rowCount:row.row_count,
    headers:headers[row.report],filename:`ezkart-${row.report}-${period.from}-${period.to}.csv`};
}

export async function createAnalyticsExport(env,seller,body) {
  if(!body || Object.keys(body).some(k=>!['report','cohort','requestKey'].includes(k)) || !analyticsReports.includes(body.report)
    || typeof body.cohort!=='string' || !/^[A-Za-z0-9_-]{1,1600}$/.test(body.cohort) || !/^[a-f0-9]{32}$/.test(body.requestKey||''))analyticsFailure('Export request is invalid');
  const mode=commerceReadEnvironment(env),hash=await commerceHash({report:body.report,cohort:body.cohort}),
    id='aex_'+(await commerceHash({seller:seller.id,mode,key:body.requestKey})).slice(0,40);
  const existing=await getExport(env,seller,id);
  if(existing){
    if(existing.request_hash!==hash)analyticsFailure('This export request key was already used for another report.',409);
    return {export:metadata(existing),replayed:true};
  }
  const ctx=await analyticsContext(env,seller,new URLSearchParams({cohort:body.cohort}),true),now=Date.now();
  // The admission, complete materialization and receipt commit together. A lost
  // HTTP response is recovered by request key, never by re-reading live orders.
  try {
    await env.DB.batch([
      env.DB.prepare(`INSERT INTO commerce_analytics_exports(id,seller_id,commerce_environment,request_key,request_hash,report,period_json,created_at,expires_at)
        SELECT ?,?,?,?,?,?,?,?,? WHERE NOT EXISTS(SELECT 1 FROM commerce_analytics_exports WHERE id=?)`)
        .bind(id,seller.id,mode,body.requestKey,hash,body.report,JSON.stringify(ctx.period),new Date(now).toISOString(),new Date(now+86400000).toISOString(),id),
      env.DB.prepare(`INSERT INTO commerce_analytics_export_rows(export_id,ordinal,cells_json)
        SELECT ?,r.ordinal,r.cells_json FROM (${analyticsCte} ${exportSql(body.report,ctx.period.previousStart!==null)}) r
        WHERE EXISTS(SELECT 1 FROM commerce_analytics_exports WHERE id=? AND request_hash=? AND state='building')`)
        .bind(id,...ctx.bindings,id,hash),
      env.DB.prepare(`UPDATE commerce_analytics_exports SET state='ready',row_count=(SELECT COUNT(*) FROM commerce_analytics_export_rows WHERE export_id=?)
        WHERE id=? AND request_hash=? AND state='building'`).bind(id,id,hash),
    ]);
  } catch(error) {
    if(String(error).includes('analytics_export_rate'))analyticsFailure('The export limit is 20 new snapshots per hour. Retry an existing download or try later.',429);
    throw error;
  }
  const saved=await getExport(env,seller,id);
  if(!saved || saved.request_hash!==hash)analyticsFailure('This export request key was already used for another report.',409);
  return {export:metadata(saved),replayed:false};
}

export async function readAnalyticsExport(env,seller,id,url) {
  analyticsParameters(url,['after','limit']);
  const afterText=url.searchParams.get('after')||'0',limitText=url.searchParams.get('limit')||'500';
  if(!/^(0|[1-9][0-9]{0,12})$/.test(afterText)||!/^[1-9][0-9]{0,3}$/.test(limitText)||Number(limitText)>1000)analyticsFailure('Export page is invalid');
  const row=await getExport(env,seller,id);
  if(!row)analyticsFailure('Export not found',404);
  const view=metadata(row),after=Number(afterText);
  if(after>view.rowCount)analyticsFailure('Export page is outside this snapshot');
  const rows=await env.DB.prepare('SELECT ordinal,cells_json FROM commerce_analytics_export_rows WHERE export_id=? AND ordinal>? ORDER BY ordinal LIMIT ?')
    .bind(id,after,Number(limitText)).all();
  const items=rows.results.map(r=>({ordinal:r.ordinal,cells:JSON.parse(r.cells_json)})),last=items.at(-1)?.ordinal??after;
  // Expiry cleanup can occur between the metadata and row reads. Never describe
  // a deleted suffix as a successful complete export.
  if((last<view.rowCount&&items.length<Number(limitText)) || items.some((r,i)=>r.ordinal!==after+i+1))analyticsFailure('This export is no longer available. Create a new export.',410);
  return {export:view,rows:items,nextAfter:last<view.rowCount?last:null};
}

export async function cleanupAnalyticsExports(env) {
  await env.DB.batch([
    env.DB.prepare(`DELETE FROM commerce_analytics_export_rows WHERE rowid IN (SELECT r.rowid FROM commerce_analytics_export_rows r
      JOIN commerce_analytics_exports e ON e.id=r.export_id WHERE e.expires_at<=strftime('%Y-%m-%dT%H:%M:%fZ','now') LIMIT 5000)`),
    env.DB.prepare(`DELETE FROM commerce_analytics_exports WHERE rowid IN (SELECT e.rowid FROM commerce_analytics_exports e
      WHERE e.expires_at<=strftime('%Y-%m-%dT%H:%M:%fZ','now') AND NOT EXISTS(SELECT 1 FROM commerce_analytics_export_rows r WHERE r.export_id=e.id) LIMIT 100)`),
  ]);
}
