import {commerceHash,commerceStorageEnabled} from './commerce-orders.js';
import {confirmedSql,additionalSql,scopeSql,commerceReadEnvironment,readParameters,readDate,readCursor,makeReadCursor} from './commerce-order-reads.js';

export const customerFailure=(message,status=422)=>{throw new Response(message,{status});};
export const customerPattern=/^customer_[A-Za-z0-9_-]{1,85}$/;
export const customerFilterKeys=['q','activity','minSpend','minOrders','maxOrders','lastFrom','lastTo','location','tag'];
const clean=(value,max)=>{
  if(typeof value!=='string'||value.length>max||/[\u0000-\u001f]/.test(value))customerFailure('Customer filters are invalid');
  return value.trim();
};
export function customerFilters(input={}){
  if(!input||typeof input!=='object'||Array.isArray(input)||Object.keys(input).some(k=>!customerFilterKeys.includes(k)))customerFailure('Customer filters are invalid');
  const result=Object.fromEntries(customerFilterKeys.map(k=>[k,clean(input[k]??'',k==='q'?120:k==='location'?100:32)]));
  result.activity||='all';
  if(!['all','high_value','one_order','repeat','no_paid'].includes(result.activity))customerFailure('Customer activity is invalid');
  for(const key of ['minSpend','minOrders','maxOrders'])if(result[key]){
    if(!/^(0|[1-9][0-9]{0,18})$/.test(result[key])||BigInt(result[key])>(key==='minSpend'?9223372036854775807n:1000000000n))customerFailure('Customer number filter is invalid');
  }
  if(result.minOrders&&result.maxOrders&&BigInt(result.minOrders)>BigInt(result.maxOrders))customerFailure('Minimum orders must not exceed maximum orders');
  const from=result.lastFrom?readDate(result.lastFrom):'',to=result.lastTo?readDate(result.lastTo,true):'';
  if(from&&to&&from>=to)customerFailure('The start date must not be after the end date');
  result.tag=result.tag.normalize('NFC').toLowerCase();
  return result;
}
// Callers may pin the frontier inside their own transaction. This argument is
// SQL supplied by application code, never a request/filter value.
export const customerCteWithFrontier=(frontier='?')=>`WITH scoped_orders AS (
  SELECT o.rowid AS n,o.*,${confirmedSql} AS confirmed,${additionalSql} AS additional FROM orders o WHERE ${scopeSql} AND o.rowid<=${frontier}
), ranked AS (
  SELECT *,ROW_NUMBER() OVER(PARTITION BY customer_id ORDER BY created_at DESC,id DESC) AS position FROM scoped_orders WHERE customer_id IS NOT NULL
), totals AS (
  SELECT customer_id,COUNT(*) AS orders,SUM(confirmed>0) AS paid_orders,SUM(confirmed) AS gross,SUM(additional) AS additional,
    MIN(created_at) AS first_at,MAX(created_at) AS last_at FROM ranked GROUP BY customer_id
), profiles AS (
  SELECT c.id,r.seller_id,r.commerce_environment,t.orders,t.paid_orders,t.gross,t.additional,t.first_at,t.last_at,r.id AS last_order,
    COALESCE(json_extract(r.customer_snapshot_json,'$.name'),'') AS name,COALESCE(json_extract(r.customer_snapshot_json,'$.email'),'') AS email,
    COALESCE(json_extract(r.customer_snapshot_json,'$.phone'),'') AS phone,COALESCE(json_extract(r.shipping_address_json,'$.location'),'') AS location,
    r.shipping_address_json AS address_json,COALESCE(json_extract(p.data_json,'$.tags'),'[]') AS tags_json,
    COALESCE(json_extract(p.data_json,'$.note'),'') AS note,COALESCE(p.revision,0) AS revision,p.updated_at AS profile_updated_at,
    CASE WHEN consent.revision IS NULL THEN 'not_recorded' WHEN consent.allowed=1 THEN 'granted' ELSE 'withdrawn' END AS marketing_consent,
    consent.updated_at AS consent_updated_at
  FROM totals t JOIN ranked r ON r.customer_id=t.customer_id AND r.position=1 JOIN customers c ON c.id=r.customer_id AND c.seller_id=r.seller_id
  LEFT JOIN commerce_customer_profiles p ON p.seller_id=r.seller_id AND p.customer_id=r.customer_id AND p.commerce_environment=r.commerce_environment
  LEFT JOIN commerce_order_owners owner ON owner.order_id=r.id
  LEFT JOIN commerce_customer_consents consent ON consent.seller_id=r.seller_id AND consent.commerce_environment=r.commerce_environment
    AND consent.auth_user_id=COALESCE(owner.auth_user_id,NULLIF(json_extract(r.customer_snapshot_json,'$.authUserId'),''))
    AND consent.email=lower(trim(json_extract(r.customer_snapshot_json,'$.email')))
)`;
export const customerCte=customerCteWithFrontier();
export const customerColumns='p.*,CAST(p.gross AS TEXT) AS exact_gross,CAST(p.additional AS TEXT) AS exact_additional';
export function customerFilterSql(filters){
  const where=[],values=[];
  if(filters.q){where.push("(instr(lower(p.id||' '||p.name||' '||p.email||' '||p.phone),lower(?))>0)");values.push(filters.q);}
  if(filters.activity!=='all')where.push({high_value:'p.gross>=150000',one_order:'p.orders=1',repeat:'p.paid_orders>=2',no_paid:'p.paid_orders=0'}[filters.activity]);
  for(const [key,expression] of [['minSpend','p.gross>=CAST(? AS INTEGER)'],['minOrders','p.orders>=CAST(? AS INTEGER)'],['maxOrders','p.orders<=CAST(? AS INTEGER)']]){
    if(filters[key]){where.push(expression);values.push(filters[key]);}
  }
  if(filters.lastFrom){where.push('p.last_at>=?');values.push(readDate(filters.lastFrom));}
  if(filters.lastTo){where.push('p.last_at<?');values.push(readDate(filters.lastTo,true));}
  if(filters.location){where.push('instr(lower(p.location),lower(?))>0');values.push(filters.location);}
  if(filters.tag){where.push('EXISTS(SELECT 1 FROM json_each(p.tags_json) WHERE value=?)');values.push(filters.tag);}
  return {where:where.join(' AND ')||'1',values};
}
const encode=value=>btoa(JSON.stringify(value)).replaceAll('+','-').replaceAll('/','_').replace(/=+$/,'');
export async function customerContext(env,seller,cohort){
  const mode=commerceReadEnvironment(env);
  if(cohort!==undefined){
    let value;
    try{if(typeof cohort!=='string'||!/^[A-Za-z0-9_-]{1,1000}$/.test(cohort))throw Error();value=JSON.parse(atob(cohort.replaceAll('-','+').replaceAll('_','/')));}catch{customerFailure('Customer list reference is invalid');}
    if(value?.v!==1||value.s!==seller.id||value.e!==mode||!Number.isSafeInteger(value.cap)||value.cap<0||!Number.isSafeInteger(value.until)||value.until<=Date.now()||value.until>Date.now()+86401000)customerFailure('Customer list reference expired or belongs to another view');
    return {mode,cap:value.cap,bindings:[seller.id,mode,value.cap]};
  }
  const cap=(await env.DB.prepare(`SELECT COALESCE(MAX(o.rowid),0) AS cap FROM orders o WHERE ${scopeSql}`).bind(seller.id,mode).first()).cap;
  return {mode,cap,bindings:[seller.id,mode,cap]};
}
const profileView=(row,detail=false)=>({id:row.id,name:row.name,email:row.email,phone:row.phone,location:row.location,
  orders:row.orders,paidOrders:row.paid_orders,gross:row.exact_gross,additional:row.exact_additional,firstAt:row.first_at,lastAt:row.last_at,lastOrder:row.last_order,
  tags:JSON.parse(row.tags_json),...(detail?{profile:{revision:row.revision,note:row.note,tags:JSON.parse(row.tags_json),updatedAt:row.profile_updated_at},
    address:(()=>{const a=JSON.parse(row.address_json||'{}');return {address:a.address||'',location:a.location||'',postalCode:a.postalCode||''};})(),marketingConsent:row.marketing_consent,marketingConsentAt:row.consent_updated_at}:{})});

export async function merchantCustomers(env,seller,url){
  const limit=readParameters(url,[...customerFilterKeys,'limit','cursor']),filters=customerFilters(Object.fromEntries(customerFilterKeys.filter(k=>url.searchParams.has(k)).map(k=>[k,url.searchParams.get(k)]))),
    mode=commerceReadEnvironment(env),hash=await commerceHash({mode,filters}),encoded=url.searchParams.get('cursor'),before=encoded?readCursor(encoded,seller.id,'customers',hash):null;
  if(before&&!customerPattern.test(before.id))customerFailure('Customer cursor is invalid');
  const cap=before?.cap??(await customerContext(env,seller)).cap,bindings=[seller.id,mode,cap],filter=customerFilterSql(filters),backwards=before?.d==='after',direction=backwards?'ASC':'DESC',comparison=backwards?'>':'<';
  const query=(sql,extra=[])=>env.DB.prepare(customerCte+' '+sql).bind(...bindings,...extra);
  const results=await env.DB.batch([
    query(`SELECT COUNT(*) AS customers,COALESCE(SUM(orders),0) AS orders,COALESCE(SUM(paid_orders>0),0) AS payingCustomers,COALESCE(SUM(paid_orders>=2),0) AS repeatCustomers,
      CAST(COALESCE(SUM(gross),0) AS TEXT) AS gross,CAST(COALESCE(SUM(additional),0) AS TEXT) AS additional,
      COUNT(DISTINCT NULLIF(location,'')) AS markets,COALESCE(SUM(gross>=150000),0) AS highValue,COALESCE(SUM(orders=1),0) AS oneOrder,COALESCE(SUM(paid_orders=0),0) AS noPaid,
      (SELECT COUNT(*) FROM scoped_orders WHERE customer_id IS NULL) AS unassignedOrders FROM profiles`),
    query('SELECT COUNT(*) AS matching FROM profiles p WHERE '+filter.where,filter.values),
    query(`SELECT ${customerColumns} FROM profiles p WHERE ${filter.where} ${before?`AND (p.last_at${comparison}? OR (p.last_at=? AND p.id${comparison}?))`:''}
      ORDER BY p.last_at ${direction},p.id ${direction} LIMIT ?`,[...filter.values,...(before?[before.at,before.at,before.id]:[]),limit+1]),
    query(`SELECT EXISTS(SELECT 1 FROM profiles p WHERE ${filter.where} ${before?`AND (p.last_at${backwards?'<':'>'}? OR (p.last_at=? AND p.id${backwards?'<=':'>='}?))`:'AND 0'}) AS opposite`,[...filter.values,...(before?[before.at,before.at,before.id]:[])]),
  ]);
  const raw=results[2].results,items=raw.slice(0,limit);if(backwards)items.reverse();
  const first=items[0],last=items.at(-1),cursor=(row,d)=>makeReadCursor(seller.id,'customers',hash,cap,{created_at:row.last_at,id:row.id},d),summary=results[0].results[0];
  summary.average=summary.customers?((BigInt(summary.gross)+BigInt(Math.floor(summary.customers/2)))/BigInt(summary.customers)).toString():null;
  return {enabled:commerceStorageEnabled(env),environment:mode,canEdit:seller.role!=='viewer',filters,summary,matching:results[1].results[0].matching,items:items.map(row=>profileView(row)),
    cohort:encode({v:1,s:seller.id,e:mode,cap,until:Date.now()+86400000}),
    pageCursor:encoded||cursor({last_at:'9999-12-31T23:59:59.999Z',id:'customer_'+'z'.repeat(85)}),
    previousCursor:first&&(backwards?raw.length>limit:results[3].results[0].opposite)?cursor(first,'after'):null,
    nextCursor:last&&(backwards?results[3].results[0].opposite:raw.length>limit)?cursor(last):null};
}
export async function assertCustomer(env,seller,id){
  if(!customerPattern.test(id))customerFailure('Customer not found',404);
  const mode=commerceReadEnvironment(env);
  if(!await env.DB.prepare(`SELECT id FROM orders o WHERE ${scopeSql} AND o.customer_id=? LIMIT 1`).bind(seller.id,mode,id).first())customerFailure('Customer not found',404);
  return mode;
}
export async function customerOrderHistory(env,seller,id,url){
  const limit=readParameters(url,['cursor','limit']),mode=await assertCustomer(env,seller,id),hash=await commerceHash({id,mode}),encoded=url.searchParams.get('cursor'),before=encoded?readCursor(encoded,seller.id,'customer_orders',hash):null;
  if(before&&before.d!=='before')customerFailure('Customer order cursor is invalid');
  const cap=before?.cap??(await customerContext(env,seller)).cap;
  const rows=await customerOrderQuery(env,seller,id,mode,cap,limit,before).all();
  return customerOrdersView(rows.results,seller,hash,cap,limit);
}
function customerOrderQuery(env,seller,id,mode,cap,limit,before=null){
  return env.DB.prepare(`SELECT o.id,o.created_at,o.checkout_state AS state,CAST(o.total_amount AS TEXT) AS total,
    CAST(${confirmedSql} AS TEXT) AS confirmed,CAST(${additionalSql} AS TEXT) AS additional FROM orders o
    WHERE ${scopeSql} AND o.customer_id=? AND o.rowid<=? ${before?'AND (o.created_at<? OR (o.created_at=? AND o.id<?))':''}
    ORDER BY o.created_at DESC,o.id DESC LIMIT ?`).bind(seller.id,mode,id,cap,...(before?[before.at,before.at,before.id]:[]),limit+1);
}
function customerOrdersView(rows,seller,hash,cap,limit){
  return {items:rows.slice(0,limit).map(({created_at,...row})=>({...row,createdAt:created_at})),
    nextCursor:rows.length>limit?makeReadCursor(seller.id,'customer_orders',hash,cap,rows[limit-1]):null};
}
export async function merchantCustomer(env,seller,id){
  await assertCustomer(env,seller,id);const ctx=await customerContext(env,seller);
  const results=await env.DB.batch([
    env.DB.prepare(customerCte+` SELECT ${customerColumns} FROM profiles p WHERE p.id=?`).bind(...ctx.bindings,id),
    customerOrderQuery(env,seller,id,ctx.mode,ctx.cap,20),
  ]),row=results[0].results[0];
  if(!row)customerFailure('Customer not found',404);
  return {enabled:commerceStorageEnabled(env),environment:ctx.mode,canEdit:seller.role!=='viewer',customer:profileView(row,true),
    orders:customerOrdersView(results[1].results,seller,await commerceHash({id,mode:ctx.mode}),ctx.cap,20)};
}
