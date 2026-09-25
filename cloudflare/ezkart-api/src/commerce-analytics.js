import {commerceStorageEnabled} from './commerce-orders.js';
import {queueSql, confirmedSql, additionalSql, scopeSql, commerceReadEnvironment} from './commerce-order-reads.js';

const DAY = 86400000, OFFSET = 7 * 3600000;
export const analyticsReports = ['overview', 'revenue', 'orders', 'payments', 'products'];
const states = ['creating', 'pending', 'paid', 'failed', 'expired', 'cancelled', 'partially_refunded', 'refunded'];
const stages = ['needs-processing', 'processing', 'shipped', 'delivered', 'attention', 'not-required', 'unpaid'];
export const analyticsFailure = (message = 'Analytics filters are invalid', status = 422) => { throw new Response(message, {status}); };
const iso = time => new Date(time).toISOString();
const localDay = time => iso(time + OFFSET).slice(0, 10);
const midnight = date => Date.parse(date + 'T00:00:00.000Z') - OFFSET;
const encode = value => btoa(JSON.stringify(value)).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '');
const validDateSql = "COALESCE((o.created_at>='1970-01-01T00:00:00.000Z' AND strftime('%Y-%m-%dT%H:%M:%fZ',o.created_at,'+0 seconds')=o.created_at),0)";
const sum = value => `CAST(COALESCE(SUM(${value}),0) AS TEXT)`;
export function analyticsParameters(url, allowed) {
  for (const key of url.searchParams.keys()) if (!allowed.includes(key) || url.searchParams.getAll(key).length !== 1) analyticsFailure();
}
function date(value) {
  if (!/^\d{4}-\d\d-\d\d$/.test(value || '') || value < '1970-01-01' || value > '9998-12-31'
    || !Number.isFinite(midnight(value)) || localDay(midnight(value)) !== value) analyticsFailure('Choose valid reporting dates');
  return value;
}
function decode(value, seller, mode) {
  let c;
  try {
    if (!/^[A-Za-z0-9_-]{1,1600}$/.test(value)) throw Error();
    c = JSON.parse(atob(value.replaceAll('-', '+').replaceAll('_', '/')));
    if (c.v !== 1 || c.s !== seller.id || c.e !== mode || !Number.isSafeInteger(c.cap) || c.cap < 0
      || !Number.isFinite(Date.parse(c.at)) || iso(Date.parse(c.at)) !== c.at || Date.parse(c.at) > Date.now()
      || !['7', '30', '90', '180', 'all', 'custom'].includes(c.range)) throw Error();
    date(c.from); date(c.to);
    if (c.from > c.to || c.to > localDay(Date.parse(c.at))) throw Error();
    const days = (midnight(c.to) - midnight(c.from)) / DAY + 1;
    if (!['all', 'custom'].includes(c.range) && (days !== Number(c.range) || c.to !== localDay(Date.parse(c.at)))) throw Error();
  } catch { analyticsFailure('The report reference is invalid. Refresh the report.'); }
  if (Date.now() - Date.parse(c.at) > DAY) analyticsFailure('This report reference has expired. Refresh the report.', 410);
  return c;
}

export async function analyticsContext(env, seller, query, requireCohort = false) {
  const mode = commerceReadEnvironment(env), encoded = query.get('cohort');
  let c;
  if (encoded) {
    c = decode(encoded, seller, mode);
    for (const key of ['range', 'from', 'to']) if (query.has(key) && query.get(key) !== c[key]) analyticsFailure('The reporting dates changed. Refresh the report.');
  } else {
    if (requireCohort) analyticsFailure('Open a report before exporting it');
    const range = query.get('range') || '30', at = iso(Date.now()), today = localDay(Date.parse(at));
    if (!['7', '30', '90', '180', 'all', 'custom'].includes(range)) analyticsFailure();
    const frontier = await env.DB.prepare(`SELECT COALESCE(MAX(o.rowid),0) AS cap,
      MIN(CASE WHEN ${validDateSql} AND o.created_at<=? THEN o.created_at END) AS oldest
      FROM orders o WHERE ${scopeSql}`).bind(at, seller.id, mode).first();
    const to = range === 'custom' ? date(query.get('to')) : today;
    const from = range === 'custom' ? date(query.get('from')) : range === 'all'
      ? (frontier.oldest ? localDay(Date.parse(frontier.oldest)) : today) : localDay(midnight(to) - (Number(range) - 1) * DAY);
    if (to > today || from > to || (range !== 'custom' && (query.has('from') || query.has('to')))) analyticsFailure('Choose dates ending today or earlier');
    c = {v: 1, s: seller.id, e: mode, cap: frontier.cap, at, range, from, to};
  }
  const start = midnight(c.from), end = midnight(c.to) + DAY, days = (end - start) / DAY;
  const requestedGroup = query.get('group') || (days <= 60 ? 'daily' : days <= 180 ? 'weekly' : 'monthly');
  if (!['daily', 'weekly', 'monthly', 'yearly'].includes(requestedGroup)) analyticsFailure();
  const group = days > 20 * 366 ? 'yearly' : days > 730 && ['daily', 'weekly'].includes(requestedGroup) ? 'monthly'
    : days > 90 && requestedGroup === 'daily' ? 'weekly' : requestedGroup;
  const period = {range: c.range, from: c.from, to: c.to, start: iso(start), end: iso(end), days,
    previousStart: c.range === 'all' ? null : iso(start - days * DAY), group, requestedGroup, timeZone: 'Asia/Jakarta'};
  return {cohort: encoded || encode(c), c, period, mode,
    bindings: [seller.id, mode, c.cap, c.at, iso(start), iso(end), period.previousStart || iso(start)]};
}

// Every read is scoped before aggregation. A cohort fixes the insertion frontier
// and order dates; payment/fulfillment states remain live until an export freezes them.
export const analyticsCte = `WITH cfg AS (SELECT ? AS seller,? AS environment,? AS cap,? AS cutoff,? AS start,? AS end,? AS previous),
 scoped AS (SELECT o.*,${confirmedSql} AS confirmed,${additionalSql} AS additional,
   COALESCE(NULLIF((${queueSql}),''),'unpaid') AS stage,
   COALESCE(NULLIF((SELECT json_extract(s.details_json,'$.method') FROM commerce_payment_sessions s
     WHERE s.order_id=o.id AND s.seller_id=o.seller_id AND s.commerce_environment=o.commerce_environment),''),'Not selected') AS method,
   (SELECT c.verified_at FROM commerce_payment_captures c WHERE c.seller_id=o.seller_id AND c.order_id=o.id AND c.capture_kind='order_payment') AS verified_at,
   COALESCE((SELECT SUM(i.quantity) FROM order_items i WHERE i.order_id=o.id AND i.seller_id=o.seller_id),0) AS ordered_units
   FROM orders o,cfg WHERE o.seller_id=cfg.seller AND o.commerce_environment=cfg.environment AND o.commerce_version=1
     AND o.rowid<=cfg.cap AND ${validDateSql} AND o.created_at<=cfg.cutoff),
 period AS (SELECT o.*,CASE WHEN o.created_at>=cfg.start THEN 0 ELSE 1 END AS segment FROM scoped o,cfg
   WHERE o.created_at>=cfg.previous AND o.created_at<cfg.end),
 lines AS (SELECT i.*,COALESCE(i.product_id,'line:'||i.id) AS product_key,o.segment,o.confirmed,o.created_at AS order_created,
   ROW_NUMBER() OVER (PARTITION BY o.segment,COALESCE(i.product_id,'line:'||i.id) ORDER BY o.created_at DESC,o.id DESC,i.id DESC) AS newest
   FROM order_items i JOIN period o ON o.id=i.order_id AND o.seller_id=i.seller_id),
 products AS (SELECT segment,product_key AS key,MAX(CASE WHEN newest=1 THEN title END) AS name,
   COUNT(DISTINCT order_id) AS orders,COUNT(DISTINCT CASE WHEN confirmed>0 THEN order_id END) AS paid_orders,
   SUM(quantity) AS ordered_units,SUM(CASE WHEN confirmed>0 THEN quantity ELSE 0 END) AS units,
   ${sum('CASE WHEN confirmed>0 THEN quantity*unit_price_amount ELSE 0 END')} AS revenue
   FROM lines GROUP BY segment,product_key),
 methods AS (SELECT segment,method AS name,COUNT(*) AS orders,SUM(confirmed>0) AS paid,
   SUM(confirmed=0 AND checkout_state IN ('creating','pending')) AS pending,
   SUM(confirmed=0 AND checkout_state IN ('failed','expired')) AS failed,
   SUM(confirmed=0 AND checkout_state NOT IN ('creating','pending','failed','expired')) AS other,
   ${sum('confirmed')} AS revenue FROM period GROUP BY segment,method),
 durations AS (SELECT segment,ROUND((julianday(verified_at)-julianday(created_at))*86400,3) AS seconds
   FROM period WHERE confirmed>0 AND julianday(verified_at)>=julianday(created_at)),
 ranked_durations AS (SELECT *,ROW_NUMBER() OVER (PARTITION BY segment ORDER BY seconds) AS rank,
   COUNT(*) OVER (PARTITION BY segment) AS samples FROM durations),
 totals AS (SELECT segment,COUNT(*) AS orders,SUM(confirmed>0) AS paid,
   SUM(checkout_state IN ('creating','pending')) AS pending,SUM(checkout_state IN ('failed','expired')) AS failed,
   ${sum('confirmed')} AS revenue,${sum('additional')} AS additional,
   ${sum('CASE WHEN confirmed>0 THEN subtotal_amount ELSE 0 END')} AS product_revenue,
   ${sum('CASE WHEN confirmed>0 THEN shipping_amount ELSE 0 END')} AS shipping,
   ${sum('total_amount')} AS ordered_value,
   ${sum("CASE WHEN checkout_state IN ('creating','pending') THEN total_amount ELSE 0 END")} AS pending_value,
   ${sum("CASE WHEN checkout_state IN ('failed','expired') THEN total_amount ELSE 0 END")} AS failed_value,
   COALESCE(SUM(ordered_units),0) AS ordered_units,COALESCE(SUM(CASE WHEN confirmed>0 THEN ordered_units ELSE 0 END),0) AS units
   FROM period GROUP BY segment)`;

export const analyticsSummarySql = `SELECT s.segment,COALESCE(t.orders,0) AS orders,COALESCE(t.paid,0) AS paid,
 COALESCE(t.pending,0) AS pending,COALESCE(t.failed,0) AS failed,
 ${['revenue','additional','product_revenue','shipping','ordered_value','pending_value','failed_value'].map(k => `COALESCE(t.${k},'0') AS ${k}`).join(',')},
 COALESCE(t.ordered_units,0) AS ordered_units,COALESCE(t.units,0) AS units,
 (SELECT COUNT(*) FROM products p WHERE p.segment=s.segment AND p.units>0) AS products_sold,
 (SELECT CAST(COALESCE(SUM(CAST(p.revenue AS INTEGER)),0) AS TEXT) FROM products p WHERE p.segment=s.segment) AS item_revenue,
 (SELECT COUNT(*) FROM durations d WHERE d.segment=s.segment) AS payment_time_samples,
 (SELECT AVG(seconds) FROM ranked_durations d WHERE d.segment=s.segment AND rank IN ((samples+1)/2,(samples+2)/2)) AS payment_seconds
 FROM (SELECT 0 AS segment UNION ALL SELECT 1) s LEFT JOIN totals t ON t.segment=s.segment ORDER BY s.segment`;

export function analyticsReportRows(report) {
  if (report === 'products') return 'SELECT * FROM products WHERE segment=0';
  if (report === 'payments') return 'SELECT * FROM methods WHERE segment=0';
  return `SELECT id AS order_id,created_at,UPPER(checkout_state) AS status,stage,method AS payment_type,
    COALESCE(json_extract(customer_snapshot_json,'$.name'),'') AS customer_name,
    COALESCE(json_extract(customer_snapshot_json,'$.email'),'') AS customer_email,
    CAST(subtotal_amount AS TEXT) AS subtotal,CAST(shipping_amount AS TEXT) AS shipping_price,CAST(total_amount AS TEXT) AS total,
    CAST(confirmed AS TEXT) AS confirmed,CAST(additional AS TEXT) AS additional
    FROM period WHERE segment=0 ${report === 'revenue' ? 'AND confirmed>0' : ''}`;
}
function tableQuery(report, url) {
  const options = report === 'products' ? {revenue:'CAST(revenue AS INTEGER) DESC,units DESC,key',units:'units DESC,key',orders:'orders DESC,key',name:'name,key'}
    : report === 'payments' ? {orders:'orders DESC,name',revenue:'CAST(revenue AS INTEGER) DESC,name',rate:'1.0*paid/orders DESC,name'}
      : {recent:'created_at DESC,order_id DESC',total:'CAST(total AS INTEGER) DESC,order_id'};
  const sort = url.searchParams.get('sort') || Object.keys(options)[0], q = (url.searchParams.get('q') || '').trim();
  const status = url.searchParams.get('status') || '', stage = url.searchParams.get('stage') || '', method = url.searchParams.get('method') || '';
  const rawPage = url.searchParams.get('table_page') || '1', page = Number(rawPage);
  if (!Object.hasOwn(options, sort) || q.length > 150 || method.length > 100 || /[\u0000-\u001f]/.test(q + method)
    || (status && !states.includes(status.toLowerCase())) || (stage && !stages.includes(stage))
    || !/^[1-9][0-9]{0,8}$/.test(rawPage) || (report !== 'orders' && (status || stage || method))) analyticsFailure();
  const where = [], values = [];
  if (status) { where.push('status=?'); values.push(status.toUpperCase()); }
  if (stage) { where.push('stage=?'); values.push(stage); }
  if (method) { where.push('payment_type=?'); values.push(method); }
  if (q) {
    if (report === 'products' || report === 'payments') {
      where.push(`instr(lower(name${report === 'products' ? "||' '||key" : ''}),lower(?))>0`); values.push(q);
    } else {
      where.push(`(instr(lower(order_id||' '||customer_name||' '||customer_email),lower(?))>0 OR EXISTS
        (SELECT 1 FROM order_items i,cfg WHERE i.order_id=r.order_id AND i.seller_id=cfg.seller
          AND instr(lower(i.title||' '||i.sku||' '||COALESCE(json_extract(i.fulfillment_snapshot_json,'$.variantName'),'')),lower(?))>0))`);
      values.push(q, q);
    }
  }
  return {sql:`, report_rows AS (${analyticsReportRows(report)}), filtered AS (SELECT * FROM report_rows r WHERE ${where.join(' AND ') || '1'})`,
    values, order:options[sort], page, filters:{q, status, stage, method, sort}};
}
function buckets(period) {
  const rows = [];
  for (let start = Date.parse(period.start); start < Date.parse(period.end);) {
    let end;
    const d = new Date(start + OFFSET);
    if (period.group === 'yearly') { d.setUTCFullYear(d.getUTCFullYear() + 1, 0, 1); end = d.getTime() - OFFSET; }
    else if (period.group === 'monthly') { d.setUTCMonth(d.getUTCMonth() + 1, 1); end = d.getTime() - OFFSET; }
    else end = start + (period.group === 'weekly' ? 7 : 1) * DAY;
    end = Math.min(end, Date.parse(period.end));
    rows.push({start:iso(start), end:iso(end), previousStart:iso(start-period.days*DAY), previousEnd:iso(end-period.days*DAY)});
    start = end;
  }
  return rows;
}
function summary(row) {
  const {segment, ...data} = row;
  return {...data, payment_rate:row.orders ? 100*row.paid/row.orders : null, failure_rate:row.orders ? 100*row.failed/row.orders : null,
    aov:row.paid ? ((BigInt(row.revenue)+BigInt(Math.floor(row.paid/2)))/BigInt(row.paid)).toString() : null,
    basket_size:row.orders ? row.ordered_units/row.orders : null, products:[], methods:[],
    status:Object.fromEntries(states.map(k => [k.toUpperCase(),0])), fulfillment:Object.fromEntries(stages.map(k => [k,0])), weekdays:Array(7).fill(0)};
}

export async function merchantAnalytics(env, seller, url) {
  analyticsParameters(url, ['report','range','from','to','group','cohort','q','status','stage','method','sort','table_page']);
  const report = url.searchParams.get('report') || 'overview';
  if (!analyticsReports.includes(report)) analyticsFailure();
  const table = tableQuery(report, url), ctx = await analyticsContext(env,seller,url.searchParams), bounds = buckets(ctx.period);
  const query = (sql, values=[]) => env.DB.prepare(analyticsCte+' '+sql).bind(...ctx.bindings,...values);
  const results = await env.DB.batch([
    query(analyticsSummarySql),
    query('SELECT segment,UPPER(checkout_state) AS state,stage,COUNT(*) AS count FROM period GROUP BY segment,checkout_state,stage'),
    query("SELECT segment,(CAST(strftime('%w',created_at,'+7 hours') AS INTEGER)+6)%7 AS day,COUNT(*) AS count FROM period GROUP BY segment,day"),
    query('SELECT * FROM products WHERE segment=0 ORDER BY CAST(revenue AS INTEGER) DESC,units DESC,key LIMIT 5'),
    query(`, bounds AS (SELECT key AS bucket,value FROM json_each(?)), segments AS (SELECT 0 AS segment UNION ALL SELECT 1)
      SELECT b.bucket,s.segment,COUNT(p.id) AS orders,${sum('p.confirmed')} AS revenue,
      COALESCE(SUM(p.confirmed>0),0) AS paid,COALESCE(SUM(CASE WHEN p.confirmed>0 THEN p.ordered_units ELSE 0 END),0) AS units
      FROM bounds b CROSS JOIN segments s LEFT JOIN period p ON p.segment=s.segment
        AND p.created_at>=json_extract(b.value,CASE WHEN s.segment=0 THEN '$.start' ELSE '$.previousStart' END)
        AND p.created_at<json_extract(b.value,CASE WHEN s.segment=0 THEN '$.end' ELSE '$.previousEnd' END)
      GROUP BY b.bucket,s.segment ORDER BY b.bucket,s.segment`, [JSON.stringify(bounds)]),
    query(table.sql+' SELECT COUNT(*) AS matching FROM filtered',table.values),
    query(table.sql+` SELECT * FROM filtered ORDER BY ${table.order} LIMIT 20 OFFSET
      MIN(?,MAX(0,((SELECT COUNT(*) FROM filtered)-1)/20)*20)`,[...table.values,(table.page-1)*20]),
    env.DB.prepare(`SELECT COALESCE(SUM(NOT (${validDateSql})),0) AS undated,
      COALESCE(SUM((${validDateSql}) AND o.created_at>?),0) AS future FROM orders o WHERE ${scopeSql} AND o.rowid<=?`)
      .bind(ctx.c.at,seller.id,ctx.mode,ctx.c.cap),
  ]);
  const summaries=results[0].results.map(summary);
  for (const row of results[1].results) { summaries[row.segment].status[row.state]+=row.count; summaries[row.segment].fulfillment[row.stage]+=row.count; }
  for (const row of results[2].results) summaries[row.segment].weekdays[row.day]=row.count;
  summaries[0].products=results[3].results;
  const chart=bounds.map(b=>({start:b.start,end:b.end,current:null,previous:null}));
  for (const {bucket,segment,...row} of results[4].results) chart[bucket][segment?'previous':'current']={...row,payment_rate:row.orders?100*row.paid/row.orders:null};
  const matching=results[5].results[0].matching,lastPage=Math.max(1,Math.ceil(matching/20));
  return {enabled:commerceStorageEnabled(env),environment:ctx.mode,checkedAt:iso(Date.now()),cohort:ctx.cohort,report,period:ctx.period,
    current:summaries[0],previous:ctx.period.previousStart?summaries[1]:null,buckets:chart,...results[7].results[0],
    table:{rows:results[6].results,matching,page:Math.min(table.page,lastPage),lastPage,filters:table.filters}};
}
