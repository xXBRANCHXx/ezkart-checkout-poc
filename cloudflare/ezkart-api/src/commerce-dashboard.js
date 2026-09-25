import {commerceStorageEnabled} from './commerce-orders.js';
import {queueSql,confirmedSql,additionalSql,scopeSql,commerceReadEnvironment} from './commerce-order-reads.js';

const day=86400000,offset=7*3600000;
const states=['creating','pending','paid','failed','expired','cancelled','partially_refunded','refunded'];
const queues=['needs-processing','processing','shipped','delivered','attention','not-required'];
const localDay=time=>new Date(time+offset).toISOString().slice(0,10);
const utc=date=>Date.parse(date+'T00:00:00.000Z')-offset;
const fail=()=>{throw new Response('Dashboard filters are invalid',{status:422});};

function groupStart(date,group){
  const d=new Date(date+'T00:00:00.000Z');
  if(group==='yearly')d.setUTCMonth(0,1);
  else if(group==='monthly')d.setUTCDate(1);
  else if(group==='weekly')d.setUTCDate(d.getUTCDate()-(d.getUTCDay()+6)%7);
  return d.toISOString().slice(0,10);
}
function nextGroup(date,group){
  const d=new Date(date+'T00:00:00.000Z');
  if(group==='yearly')d.setUTCFullYear(d.getUTCFullYear()+1);
  else if(group==='monthly')d.setUTCMonth(d.getUTCMonth()+1);
  else d.setUTCDate(d.getUTCDate()+(group==='weekly'?7:1));
  return d.toISOString().slice(0,10);
}
const sum=expression=>`CAST(COALESCE(SUM(${expression}),0) AS TEXT)`;

export async function merchantDashboard(env,seller,url){
  for(const key of url.searchParams.keys())if(!['range','group'].includes(key)||url.searchParams.getAll(key).length!==1)fail();
  const range=url.searchParams.get('range')||'30',requestedGroup=url.searchParams.get('group')||'daily';
  if(!['7','30','90','all'].includes(range)||!['daily','weekly','monthly','yearly'].includes(requestedGroup))fail();
  const now=Date.now(),mode=commerceReadEnvironment(env),today=localDay(now),end=utc(today)+day;
  // Capture the insertion frontier before deriving an all-time chart span.
  // Later inserts cannot change the cohort between the span read and the batch.
  const frontier=await env.DB.prepare(`SELECT COALESCE(MAX(o.rowid),0) AS cap,
    MIN(CASE WHEN o.created_at<? THEN o.created_at END) AS oldest FROM orders o WHERE ${scopeSql}`)
    .bind(new Date(end).toISOString(),seller.id,mode).first();
  const from=range==='all'?(frontier.oldest?localDay(Date.parse(frontier.oldest)):today):localDay(end-Number(range)*day);
  const days=(end-utc(from))/day;
  let group=requestedGroup;
  if(days>20*366)group='yearly';
  else if(days>366&&['daily','weekly'].includes(group))group='monthly';
  else if(days>90&&group==='daily')group='weekly';
  const scoped=`WITH scoped AS (SELECT o.*,${queueSql} AS queue,${confirmedSql} AS confirmed_amount,${additionalSql} AS additional_amount
    FROM orders o WHERE ${scopeSql} AND o.rowid<=?),
    period AS (SELECT * FROM scoped WHERE created_at>=? AND created_at<?)`;
  const bindings=[seller.id,mode,frontier.cap,new Date(utc(from)).toISOString(),new Date(end).toISOString()];
  const query=sql=>env.DB.prepare(scoped+' '+sql).bind(...bindings);
  const dateSql="date(o.created_at,'+7 hours')";
  const bucket=group==='yearly'?`strftime('%Y-01-01',o.created_at,'+7 hours')`:group==='monthly'?`strftime('%Y-%m-01',o.created_at,'+7 hours')`:
    group==='weekly'?`date(${dateSql},'-'||((CAST(strftime('%w',o.created_at,'+7 hours') AS INTEGER)+6)%7)||' days')`:dateSql;
  const productQuery=(paid,limit)=>query(`, lines AS (SELECT i.*,o.created_at AS order_created FROM order_items i JOIN period o ON o.id=i.order_id AND o.seller_id=i.seller_id ${paid?'WHERE o.confirmed_amount>0':''})
    SELECT l.product_id AS id,(SELECT x.title FROM lines x WHERE x.product_id=l.product_id ORDER BY x.order_created DESC,x.order_id DESC,x.id DESC LIMIT 1) AS title,
      SUM(l.quantity) AS quantity,${sum('l.quantity*l.unit_price_amount')} AS amount
    FROM lines l GROUP BY l.product_id ORDER BY ${paid?'SUM(l.quantity*l.unit_price_amount)':'SUM(l.quantity)'} DESC,l.product_id LIMIT ${limit}`);
  const results=await env.DB.batch([
    query(`SELECT COUNT(*) AS orders,COALESCE(SUM(confirmed_amount>0),0) AS paidOrders,
      COALESCE(SUM(checkout_state IN ('creating','pending')),0) AS pendingOrders,
      COALESCE(SUM(checkout_state IN ('failed','expired')),0) AS failedOrders,COALESCE(SUM(queue='attention'),0) AS needsReview,
      ${sum('confirmed_amount')} AS confirmedAmount,${sum('additional_amount')} AS additionalAmount,
      ${sum('CASE WHEN confirmed_amount>0 THEN subtotal_amount ELSE 0 END')} AS productAmount,
      ${sum('CASE WHEN confirmed_amount>0 THEN shipping_amount ELSE 0 END')} AS shippingAmount,
      ${sum("CASE WHEN checkout_state IN ('creating','pending') THEN total_amount ELSE 0 END")} AS pendingAmount,
      ${sum("CASE WHEN checkout_state IN ('failed','expired') THEN total_amount ELSE 0 END")} AS failedAmount,
      ${sum("CASE WHEN checkout_state='cancelled' THEN total_amount ELSE 0 END")} AS cancelledAmount,
      COALESCE(SUM(EXISTS(SELECT 1 FROM commerce_shipments s WHERE s.seller_id=o.seller_id AND s.order_id=o.id AND s.provider_id IS NOT NULL
        AND s.sequence=(SELECT MAX(x.sequence) FROM commerce_shipments x WHERE x.seller_id=o.seller_id AND x.order_id=o.id))),0) AS bookedOrders
      FROM period o`),
    query('SELECT queue,COUNT(*) AS count FROM scoped GROUP BY queue'),
    query('SELECT checkout_state AS state,COUNT(*) AS count FROM period GROUP BY checkout_state'),
    query(`SELECT ${bucket} AS date,${sum('confirmed_amount')} AS amount,COUNT(*) AS paidOrders FROM period o WHERE confirmed_amount>0 GROUP BY date ORDER BY date`),
    query(`SELECT o.id,o.checkout_state AS state,o.queue,o.total_amount AS total,o.created_at AS createdAt,
      COALESCE(json_extract(o.customer_snapshot_json,'$.name'),'') AS customerName,
      COALESCE(json_extract(o.snapshot_json,'$.shipping.destination.location'),'') AS destination,
      (SELECT i.title FROM order_items i WHERE i.seller_id=o.seller_id AND i.order_id=o.id ORDER BY i.id LIMIT 1) AS firstItem
      FROM period o ORDER BY o.created_at DESC,o.id DESC LIMIT 5`),
    productQuery(true,5),productQuery(false,3),
    query(`SELECT COALESCE(SUM(i.quantity),0) AS orderedUnits,COALESCE(SUM(CASE WHEN o.confirmed_amount>0 THEN i.quantity ELSE 0 END),0) AS paidUnits
      FROM order_items i JOIN period o ON o.id=i.order_id AND o.seller_id=i.seller_id`),
  ]);
  const summary={...results[0].results[0],...results[7].results[0]},series=new Map(results[3].results.map(r=>[r.date,r]));
  const buckets=[];
  for(let date=groupStart(from,group);date<=today;date=nextGroup(date,group))buckets.push(series.get(date)||{date,amount:'0',paidOrders:0});
  const total=results[1].results.reduce((n,r)=>n+r.count,0);
  summary.averageAmount=summary.paidOrders?((BigInt(summary.confirmedAmount)+BigInt(Math.floor(summary.paidOrders/2)))/BigInt(summary.paidOrders)).toString():'0';
  summary.paymentRate=summary.orders?Math.round(summary.paidOrders/summary.orders*1000)/10:0;
  return {sellerId:seller.id,environment:mode,enabled:commerceStorageEnabled(env),checkedAt:new Date(now).toISOString(),
    period:{range,from,to:today,timeZone:'Asia/Jakarta',basis:'order_created_at'},chart:{requestedGroup,group,buckets},summary,
    operations:{total,queues:Object.fromEntries(queues.map(k=>[k,results[1].results.find(r=>r.queue===k)?.count||0]))},
    statuses:Object.fromEntries(states.map(k=>[k,results[2].results.find(r=>r.state===k)?.count||0])),
    recent:results[4].results,topProducts:results[5].results,catalogActivity:results[6].results};
}
