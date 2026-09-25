import {commerceHash} from './commerce-orders.js';
import {commerceReadEnvironment} from './commerce-order-reads.js';
import {customerFailure as fail,customerFilters,customerContext,customerCte,customerFilterSql} from './commerce-customers.js';

const headers=['Customer ID','Name','Email','Phone','Latest delivery location','Orders','Verified paid orders','Gross verified payments (IDR)','Additional captures (IDR)','First order (WIB)','Last order (WIB)','Tags','Marketing consent'];
const get=(env,seller,id)=>env.DB.prepare('SELECT * FROM commerce_customer_exports WHERE id=? AND seller_id=? AND commerce_environment=?').bind(id,seller.id,commerceReadEnvironment(env)).first();
function metadata(row){
  if(Date.parse(row.expires_at)<=Date.now())fail('This customer export has expired. Create a new export.',410);
  if(row.state!=='ready')fail('The export is not ready. Retry the same request.',503);
  return {id:row.id,filters:JSON.parse(row.filters_json),createdAt:row.created_at,expiresAt:row.expires_at,rowCount:row.row_count,headers,filename:'ezkart-customers-'+row.created_at.slice(0,10)+'.csv'};
}
export async function createCustomerExport(env,seller,input){
  if(!input||typeof input!=='object'||Array.isArray(input)||Object.keys(input).some(k=>!['requestKey','filters','cohort'].includes(k))||typeof input.cohort!=='string'
    ||typeof input.requestKey!=='string'||!/^[a-f0-9]{32}$/.test(input.requestKey))fail('Customer export request is invalid');
  const filters=customerFilters(input.filters),mode=commerceReadEnvironment(env),hash=await commerceHash({filters,cohort:input.cohort}),id='cex_'+(await commerceHash({seller:seller.id,mode,key:input.requestKey})).slice(0,40),existing=await get(env,seller,id);
  if(existing){if(existing.request_hash!==hash)fail('This request was used for a different customer export',409);return {export:metadata(existing),replayed:true};}
  const ctx=await customerContext(env,seller,input.cohort),filter=customerFilterSql(filters),now=Date.now();
  try{await env.DB.batch([
    env.DB.prepare(`INSERT INTO commerce_customer_exports(id,seller_id,commerce_environment,request_key,request_hash,filters_json,created_at,expires_at)
      SELECT ?,?,?,?,?,?,?,? WHERE NOT EXISTS(SELECT 1 FROM commerce_customer_exports WHERE id=?)`).bind(id,seller.id,mode,input.requestKey,hash,JSON.stringify(filters),new Date(now).toISOString(),new Date(now+86400000).toISOString(),id),
    env.DB.prepare(`INSERT INTO commerce_customer_export_rows(export_id,ordinal,cells_json)
      SELECT ?,r.ordinal,r.cells_json FROM (${customerCte} SELECT ROW_NUMBER() OVER(ORDER BY p.last_at DESC,p.id DESC) AS ordinal,
        json_array(p.id,p.name,p.email,p.phone,p.location,p.orders,p.paid_orders,CAST(p.gross AS TEXT),CAST(p.additional AS TEXT),
          strftime('%Y-%m-%d %H:%M:%S',p.first_at,'+7 hours'),strftime('%Y-%m-%d %H:%M:%S',p.last_at,'+7 hours'),
          (SELECT group_concat(value,', ') FROM json_each(p.tags_json)),
          CASE p.marketing_consent WHEN 'granted' THEN 'Email allowed' WHEN 'withdrawn' THEN 'Email withdrawn' ELSE 'Not recorded' END) AS cells_json FROM profiles p WHERE ${filter.where}) r
      WHERE EXISTS(SELECT 1 FROM commerce_customer_exports WHERE id=? AND request_hash=? AND state='building')`).bind(id,...ctx.bindings,...filter.values,id,hash),
    env.DB.prepare("UPDATE commerce_customer_exports SET state='ready',row_count=(SELECT COUNT(*) FROM commerce_customer_export_rows WHERE export_id=?) WHERE id=? AND request_hash=? AND state='building'").bind(id,id,hash),
  ]);}catch(error){if(String(error).includes('customer_export_rate'))fail('You can create 10 customer export snapshots per hour. Retry an existing download or try later.',429);throw error;}
  const saved=await get(env,seller,id);if(!saved||saved.request_hash!==hash)fail('This request was used for a different customer export',409);
  return {export:metadata(saved),replayed:false};
}
export async function readCustomerExport(env,seller,id,url){
  for(const key of url.searchParams.keys())if(!['after','limit'].includes(key)||url.searchParams.getAll(key).length!==1)fail('Customer export page is invalid');
  const afterText=url.searchParams.get('after')||'0',limitText=url.searchParams.get('limit')||'500';
  if(!/^(0|[1-9][0-9]{0,12})$/.test(afterText)||!/^[1-9][0-9]{0,3}$/.test(limitText)||Number(limitText)>1000)fail('Customer export page is invalid');
  const row=await get(env,seller,id);if(!row)fail('Customer export not found',404);
  const view=metadata(row),after=Number(afterText),limit=Number(limitText);if(after>view.rowCount)fail('Export page is outside this snapshot');
  const result=await env.DB.prepare('SELECT ordinal,cells_json FROM commerce_customer_export_rows WHERE export_id=? AND ordinal>? ORDER BY ordinal LIMIT ?').bind(id,after,limit).all(),items=result.results.map(r=>({ordinal:r.ordinal,cells:JSON.parse(r.cells_json)})),last=items.at(-1)?.ordinal??after;
  if(items.some((r,i)=>r.ordinal!==after+i+1)||(last<view.rowCount&&items.length<limit))fail('This export is no longer available. Create a new export.',410);
  return {export:view,rows:items,nextAfter:last<view.rowCount?last:null};
}
export async function cleanupCustomerExports(env){
  await env.DB.batch([
    env.DB.prepare(`DELETE FROM commerce_customer_export_rows WHERE rowid IN (SELECT r.rowid FROM commerce_customer_export_rows r
      JOIN commerce_customer_exports e ON e.id=r.export_id WHERE e.expires_at<=strftime('%Y-%m-%dT%H:%M:%fZ','now') LIMIT 5000)`),
    env.DB.prepare(`DELETE FROM commerce_customer_exports WHERE rowid IN (SELECT e.rowid FROM commerce_customer_exports e
      WHERE e.expires_at<=strftime('%Y-%m-%dT%H:%M:%fZ','now') AND NOT EXISTS(SELECT 1 FROM commerce_customer_export_rows r WHERE r.export_id=e.id) LIMIT 100)`),
  ]);
}
