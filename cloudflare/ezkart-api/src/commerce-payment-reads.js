import {commerceHash,commerceStorageEnabled} from './commerce-orders.js';
import {confirmedSql,additionalSql,scopeSql,commerceReadEnvironment,readParameters,readDate,readCursor,makeReadCursor} from './commerce-order-reads.js';

const fail=(message,status=422)=>{throw new Response(message,{status});};
const reference=/^EZK-[SP]-[A-F0-9]{24}$/;
const states=['creating','pending','paid','failed','expired','cancelled','partially_refunded','refunded'];
const methodSql=`COALESCE(NULLIF((SELECT json_extract(s.details_json,'$.method') FROM commerce_payment_sessions s
  WHERE s.order_id=o.id AND s.seller_id=o.seller_id AND s.commerce_environment=o.commerce_environment),''),'Not selected')`;
const reviewSql=`(o.payment_review=1 OR (${additionalSql})>0 OR
  (o.checkout_state IN ('creating','pending') AND EXISTS(SELECT 1 FROM commerce_jobs j WHERE j.order_id=o.id AND j.seller_id=o.seller_id
    AND j.commerce_environment=o.commerce_environment AND j.kind='payment.create'
    AND (j.state IN ('uncertain','dead') OR (j.state='running' AND (j.lease_until IS NULL OR j.lease_until<=strftime('%Y-%m-%dT%H:%M:%fZ','now')))))))`;
const scope=`WITH scoped AS (SELECT o.*,${confirmedSql} AS confirmed,${additionalSql} AS additional,${methodSql} AS method,
  ${reviewSql} AS needs_review FROM orders o WHERE ${scopeSql} AND o.rowid<=?),
  period AS (SELECT * FROM scoped WHERE (?='' OR created_at>=?) AND (?='' OR created_at<?))`;
const sum=x=>`CAST(COALESCE(SUM(${x}),0) AS TEXT)`;
const paymentView=row=>({id:row.id,state:row.checkout_state,createdAt:row.created_at,updatedAt:row.updated_at,
  total:row.total,subtotal:row.subtotal,shipping:row.shipping,confirmed:row.confirmed,additional:row.additional,method:row.method,
  needsReview:row.needs_review===1,customerName:row.customer_name,customerEmail:row.customer_email,primaryReference:row.primary_reference,
  verifiedAt:row.verified_at});
const columns=`o.id,o.checkout_state,o.created_at,o.updated_at,CAST(o.total_amount AS TEXT) AS total,
  CAST(o.subtotal_amount AS TEXT) AS subtotal,CAST(o.shipping_amount AS TEXT) AS shipping,
  CAST(o.confirmed AS TEXT) AS confirmed,CAST(o.additional AS TEXT) AS additional,o.method,o.needs_review,
  COALESCE(json_extract(o.customer_snapshot_json,'$.name'),'') AS customer_name,
  COALESCE(json_extract(o.customer_snapshot_json,'$.email'),'') AS customer_email,
  (SELECT c.provider_reference FROM commerce_payment_captures c WHERE c.order_id=o.id AND c.seller_id=o.seller_id AND c.capture_kind='order_payment') AS primary_reference,
  (SELECT c.verified_at FROM commerce_payment_captures c WHERE c.order_id=o.id AND c.seller_id=o.seller_id AND c.capture_kind='order_payment') AS verified_at`;

export async function merchantPaymentList(env,seller,url){
  const limit=readParameters(url,['limit','cursor','state','evidence','review','method','q','from','to']);
  const state=url.searchParams.get('state')||'all',evidence=url.searchParams.get('evidence')||'all',review=url.searchParams.get('review')||'all';
  const method=url.searchParams.get('method')||'',q=(url.searchParams.get('q')||'').trim(),from=url.searchParams.get('from')||'',to=url.searchParams.get('to')||'';
  if(!['all',...states].includes(state)||!['all','verified','unverified','additional'].includes(evidence)||!['all','yes','no'].includes(review)
    ||method.length>100||q.length>120||/[\u0000-\u001f]/.test(method+q))fail('Payment filters are invalid');
  const start=from?readDate(from):'',end=to?readDate(to,true):'',mode=commerceReadEnvironment(env);
  if(start&&end&&start>=end)fail('The start date must not be after the end date');
  const hash=await commerceHash({mode,state,evidence,review,method,q,from,to}),encoded=url.searchParams.get('cursor');
  const previous=encoded?readCursor(encoded,seller.id,'payments',hash):null;
  if(previous&&!reference.test(previous.id))fail('Payment cursor is invalid');
  const cap=previous?.cap??(await env.DB.prepare(`SELECT COALESCE(MAX(o.rowid),0) AS cap FROM orders o WHERE ${scopeSql}`).bind(seller.id,mode).first()).cap;
  const bindings=[seller.id,mode,cap,start,start,end,end],where=[],values=[];
  if(state!=='all'){where.push('o.checkout_state=?');values.push(state);}
  if(evidence!=='all')where.push(evidence==='verified'?'o.confirmed>0':evidence==='unverified'?'o.confirmed=0':'o.additional>0');
  if(review!=='all')where.push('o.needs_review='+(review==='yes'?'1':'0'));
  if(method){where.push('o.method=?');values.push(method);}
  if(q){where.push(`(instr(lower(o.id),lower(?))>0 OR instr(lower(json_extract(o.customer_snapshot_json,'$.name')),lower(?))>0
    OR instr(lower(json_extract(o.customer_snapshot_json,'$.email')),lower(?))>0
    OR EXISTS(SELECT 1 FROM commerce_payment_captures c WHERE c.order_id=o.id AND c.seller_id=o.seller_id AND instr(lower(c.provider_reference),lower(?))>0)
    OR EXISTS(SELECT 1 FROM commerce_payment_sessions s WHERE s.order_id=o.id AND s.seller_id=o.seller_id AND instr(lower(s.provider_request_id),lower(?))>0)
    OR instr(lower(replace(o.method,'_',' ')),lower(replace(?,'_',' ')))>0)`);values.push(...Array(6).fill(q));}
  const filter=where.join(' AND ')||'1',backwards=previous?.d==='after',direction=backwards?'ASC':'DESC',comparison=backwards?'>':'<';
  const query=(sql,extra=[])=>env.DB.prepare(scope+' '+sql).bind(...bindings,...extra);
  const results=await env.DB.batch([
    query(`SELECT COUNT(*) AS orders,COALESCE(SUM(confirmed>0),0) AS paidOrders,${sum('confirmed')} AS gross,${sum('additional')} AS additional,
      COALESCE(SUM(confirmed=0 AND checkout_state IN ('creating','pending')),0) AS awaitingOrders,
      ${sum("CASE WHEN confirmed=0 AND checkout_state IN ('creating','pending') THEN total_amount ELSE 0 END")} AS awaitingAmount,
      COALESCE(SUM(needs_review),0) AS needsReview FROM period`),
    query('SELECT method,COUNT(*) AS orders FROM period GROUP BY method ORDER BY COUNT(*) DESC,method LIMIT 21'),
    query('SELECT COUNT(*) AS matching FROM period o WHERE '+filter,values),
    query(`SELECT ${columns} FROM period o WHERE ${filter}
      ${previous?`AND (o.created_at${comparison}? OR (o.created_at=? AND o.id${comparison}?))`:''}
      ORDER BY o.created_at ${direction},o.id ${direction} LIMIT ?`,[...values,...(previous?[previous.at,previous.at,previous.id]:[]),limit+1]),
    query(`SELECT EXISTS(SELECT 1 FROM period o WHERE ${filter}
      ${previous?`AND (o.created_at${backwards?'<':'>'}? OR (o.created_at=? AND o.id${backwards?'<=':'>='}?))`:'AND 0'}) AS opposite`,
      [...values,...(previous?[previous.at,previous.at,previous.id]:[])]),
  ]);
  const raw=results[3].results,rows=raw.slice(0,limit);if(backwards)rows.reverse();
  const hasBefore=backwards?raw.length>limit:results[4].results[0].opposite===1,hasAfter=backwards?results[4].results[0].opposite===1:raw.length>limit;
  const summary=results[0].results[0];summary.average=summary.paidOrders?((BigInt(summary.gross)+BigInt(Math.floor(summary.paidOrders/2)))/BigInt(summary.paidOrders)).toString():null;
  summary.paymentRate=summary.orders?100*summary.paidOrders/summary.orders:null;
  const methods=results[1].results.slice(0,20);
  return {enabled:commerceStorageEnabled(env),environment:mode,period:{from,to,timeZone:'Asia/Jakarta',basis:'order_created_at'},summary,
    methods,otherMethodOrders:summary.orders-methods.reduce((n,m)=>n+m.orders,0),matching:results[2].results[0].matching,items:rows.map(paymentView),
    pageCursor:encoded||makeReadCursor(seller.id,'payments',hash,cap,{created_at:'9999-12-31T23:59:59.999Z',id:'EZK-S-'+'F'.repeat(24)}),
    previousCursor:rows.length&&hasBefore?makeReadCursor(seller.id,'payments',hash,cap,rows[0],'after'):null,
    nextCursor:rows.length&&hasAfter?makeReadCursor(seller.id,'payments',hash,cap,rows.at(-1)):null};
}

const historySql={
  captures:`SELECT c.rowid AS n,c.id,c.verified_at AS created_at,c.provider,c.provider_reference AS reference,
    CAST(c.amount AS TEXT) AS amount,c.currency,c.capture_kind AS kind FROM commerce_payment_captures c
    WHERE c.seller_id=? AND c.order_id=? AND c.commerce_environment=?`,
  attempts:`SELECT a.rowid AS n,a.id,a.started_at AS created_at,a.finished_at AS finishedAt,a.attempt,a.mode,a.outcome,j.id AS requestId
    FROM commerce_job_attempts a JOIN commerce_jobs j ON j.id=a.job_id
    WHERE j.seller_id=? AND j.order_id=? AND j.commerce_environment=? AND j.kind='payment.create'`,
  events:`SELECT e.rowid AS n,e.id,e.created_at,e.event_type AS type,e.previous_revision+1 AS revision
    FROM commerce_order_events e JOIN orders o ON o.id=e.order_id AND o.seller_id=e.seller_id
    WHERE e.seller_id=? AND e.order_id=? AND o.commerce_environment=? AND e.event_type LIKE 'payment.%'`,
};
function historyQuery(env,seller,id,mode,kind,limit=20,before=null){
  return env.DB.prepare(`WITH entries AS (${historySql[kind]}) SELECT *,(SELECT COALESCE(MAX(n),0) FROM entries) AS cap FROM entries
    ${before?'WHERE n<=? AND (created_at<? OR (created_at=? AND id<?))':''} ORDER BY created_at DESC,id DESC LIMIT ?`)
    .bind(seller.id,id,mode,...(before?[before.cap,before.at,before.at,before.id]:[]),limit+1);
}
async function historyView(seller,id,mode,kind,rows,limit=20){
  return {items:rows.slice(0,limit).map(({n,cap,created_at,...entry})=>({...entry,createdAt:created_at})),
    nextCursor:rows.length>limit?makeReadCursor(seller.id,'payment_'+kind,await commerceHash({id,mode}),rows[0].cap,rows[limit-1]):null};
}
async function assertPayment(env,seller,id){
  if(!reference.test(id))fail('Payment record not found',404);
  const mode=commerceReadEnvironment(env);
  if(!await env.DB.prepare(`SELECT id FROM orders o WHERE ${scopeSql} AND o.id=?`).bind(seller.id,mode,id).first())fail('Payment record not found',404);
  return mode;
}
export async function merchantPaymentHistory(env,seller,id,kind,url){
  const limit=readParameters(url,['limit','cursor']);if(!Object.hasOwn(historySql,kind))fail('Payment history not found',404);
  const mode=await assertPayment(env,seller,id),encoded=url.searchParams.get('cursor'),hash=await commerceHash({id,mode});
  const before=encoded?readCursor(encoded,seller.id,'payment_'+kind,hash):null;
  if(before&&before.d!=='before')fail('Payment history cursor is invalid');
  const result=await historyQuery(env,seller,id,mode,kind,limit,before).all();
  // Keep the initial frontier on every continuation, including backdated inserts.
  if(before)for(const row of result.results)row.cap=before.cap;
  return historyView(seller,id,mode,kind,result.results,limit);
}
export async function merchantPaymentDetail(env,seller,id){
  const mode=await assertPayment(env,seller,id);
  const results=await env.DB.batch([
    env.DB.prepare(`WITH record AS (SELECT o.*,${confirmedSql} AS confirmed,${additionalSql} AS additional,${methodSql} AS method,
      ${reviewSql} AS needs_review FROM orders o WHERE ${scopeSql} AND o.id=?)
      SELECT ${columns},o.expires_at,o.revision,o.payment_review FROM record o`).bind(seller.id,mode,id),
    env.DB.prepare(`SELECT provider_request_id AS reference,created_at AS createdAt,json_extract(details_json,'$.provider') AS provider,
      json_extract(details_json,'$.method') AS method,json_extract(details_json,'$.expiresAt') AS expiresAt
      FROM commerce_payment_sessions WHERE seller_id=? AND order_id=? AND commerce_environment=?`).bind(seller.id,id,mode),
    env.DB.prepare(`SELECT state,COUNT(*) AS count,COALESCE(SUM(attempts),0) AS attempts,
      COALESCE(SUM(state='running' AND (lease_until IS NULL OR lease_until<=strftime('%Y-%m-%dT%H:%M:%fZ','now'))),0) AS timedOut
      FROM commerce_jobs WHERE seller_id=? AND order_id=? AND commerce_environment=? AND kind='payment.create' GROUP BY state`).bind(seller.id,id,mode),
    ...Object.keys(historySql).map(kind=>historyQuery(env,seller,id,mode,kind)),
  ]);
  const row=results[0].results[0];
  return {enabled:commerceStorageEnabled(env),environment:mode,order:{...paymentView(row),expiresAt:row.expires_at,revision:row.revision,paymentReview:row.payment_review===1},
    session:results[1].results[0]||null,operations:results[2].results,
    ...Object.fromEntries(await Promise.all(Object.keys(historySql).map(async(kind,i)=>[kind,await historyView(seller,id,mode,kind,results[i+3].results)])))};
}
