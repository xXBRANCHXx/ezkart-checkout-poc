import {commerceHash} from './commerce-orders.js';
import {settingsActor} from './merchant-settings.js';
import {reviewCursor,readReviewCursor} from './commerce-reviews.js';
import {campaignReportContext,campaignPublicationCte,reportFailure,reportParameters} from './campaign-reports.js';

export const campaignPerformanceCounts={trackedCampaigns:'Campaigns with tracked links',untrackedCampaigns:'Campaigns with older untracked links',visits:'Recorded link visits',limitedVisits:'Visits without measurement',checkouts:'Attributed checkouts',paidOrders:'Verified paid orders',convertedVisits:'Visits with a paid order'};
export const campaignPerformanceAmounts={grossPaid:'Gross paid (IDR)',productPaid:'Gross product sales (IDR)',shippingPaid:'Paid shipping (IDR)',additionalPaid:'Additional payments for review (IDR)'};
export const campaignPerformanceMetrics={...campaignPerformanceCounts,...campaignPerformanceAmounts};
export const campaignPerformanceContext=(env,actor,params,required=false)=>campaignReportContext(env,actor,params,required,'campaign_performance_report');
const counts=Object.keys(campaignPerformanceCounts),amounts=Object.keys(campaignPerformanceAmounts);
const sum=value=>`CAST(COALESCE(SUM(${value}),0) AS TEXT)`;
const money=value=>`CAST(COALESCE(${value},0) AS TEXT)`;
// Aggregate visits and orders independently, then join by publication. Joining
// individual visits, recipients and captures would multiply monetary amounts.
export const campaignPerformanceCte=campaignPublicationCte+`,
 reports AS (SELECT p.n,p.id,p.campaign_id,json_extract(p.data_json,'$.name') AS name,json_extract(p.data_json,'$.subject') AS subject,
   p.created_at AS published_at,p.send_at AS scheduled_at,p.cancelled AS campaign_cancelled,p.segment,p.local_day,
   (p.candidate_count IS NULL OR COUNT(c.id)!=p.candidate_count OR COUNT(j.id)!=p.candidate_count) AS corrupt
   FROM publications p LEFT JOIN commerce_campaign_candidates c ON c.publication_id=p.id
   LEFT JOIN commerce_jobs j ON j.id='job_campaign_'||c.id AND j.kind='campaign.send'
     AND j.seller_id=(SELECT seller FROM cfg) AND j.commerce_environment=(SELECT environment FROM cfg) GROUP BY p.id),
 link_coverage AS (SELECT p.id,
   EXISTS(SELECT 1 FROM commerce_campaign_link_messages m JOIN commerce_campaign_email_starts s ON s.request_id=m.request_id WHERE m.publication_id=p.id) AS trackedCampaigns,
   (json_extract(p.data_json,'$.buttonLabel')!='' AND EXISTS(SELECT 1 FROM commerce_campaign_candidates c JOIN commerce_campaign_email_requests x ON x.candidate_id=c.id
     WHERE c.publication_id=p.id AND EXISTS(SELECT 1 FROM commerce_campaign_email_starts s WHERE s.request_id=x.id)
       AND NOT EXISTS(SELECT 1 FROM commerce_campaign_link_messages m WHERE m.request_id=x.id))) AS untrackedCampaigns
   FROM publications p),
 visits AS (SELECT p.id,SUM(b.recorded) AS visits,SUM(b.limited) AS limitedVisits,
   SUM(b.seller_id!=cfg.seller OR b.commerce_environment!=cfg.environment) AS corrupt
   FROM publications p JOIN commerce_campaign_visit_buckets b ON b.publication_id=p.id,cfg GROUP BY p.id),
 attributed AS (SELECT a.publication_id,a.order_id,a.visit_hash,o.subtotal_amount,o.shipping_amount,COALESCE(c.amount,0) AS paid,
   COALESCE((SELECT SUM(d.amount) FROM commerce_payment_captures d WHERE d.order_id=o.id AND d.capture_kind='duplicate_payment'),0) AS additional,
   (o.id IS NULL OR o.seller_id!=cfg.seller OR o.commerce_environment!=cfg.environment OR o.commerce_version!=1
     OR a.seller_id!=cfg.seller OR a.commerce_environment!=cfg.environment OR a.created_at!=o.created_at
     OR json_extract(o.snapshot_json,'$.checkout.campaignVisitHash') IS NOT a.visit_hash
     OR (c.id IS NOT NULL AND (c.amount!=o.total_amount OR c.currency!='IDR' OR c.seller_id!=o.seller_id OR c.commerce_environment!=o.commerce_environment))
     OR EXISTS(SELECT 1 FROM commerce_payment_captures d WHERE d.order_id=o.id AND (d.seller_id!=o.seller_id OR d.commerce_environment!=o.commerce_environment OR d.currency!='IDR'))) AS corrupt
   FROM publications p JOIN commerce_campaign_order_attributions a ON a.publication_id=p.id
   LEFT JOIN orders o ON o.id=a.order_id LEFT JOIN commerce_payment_captures c ON c.order_id=o.id AND c.capture_kind='order_payment',cfg),
 orders_by_campaign AS (SELECT publication_id,COUNT(*) AS checkouts,SUM(paid>0) AS paidOrders,COUNT(DISTINCT CASE WHEN paid>0 THEN visit_hash END) AS convertedVisits,
   COUNT(DISTINCT visit_hash) AS attributedVisits,SUM(paid) AS grossPaid,SUM(CASE WHEN paid>0 THEN subtotal_amount ELSE 0 END) AS productPaid,
   SUM(CASE WHEN paid>0 THEN shipping_amount ELSE 0 END) AS shippingPaid,SUM(additional) AS additionalPaid,SUM(corrupt) AS corrupt FROM attributed GROUP BY publication_id),
 performance AS (SELECT r.n,r.id,r.campaign_id,r.name,r.subject,r.published_at,r.scheduled_at,r.campaign_cancelled,r.segment,r.local_day,
   l.trackedCampaigns,l.untrackedCampaigns,COALESCE(v.visits,0) AS visits,COALESCE(v.limitedVisits,0) AS limitedVisits,
   COALESCE(o.checkouts,0) AS checkouts,COALESCE(o.paidOrders,0) AS paidOrders,COALESCE(o.convertedVisits,0) AS convertedVisits,
   ${amounts.map(k=>`${money('o.'+k)} AS ${k}`).join(',')},
   (r.corrupt OR COALESCE(v.corrupt,0)>0 OR COALESCE(o.corrupt,0)>0 OR COALESCE(o.attributedVisits,0)>COALESCE(v.visits,0)
     OR ((COALESCE(v.visits,0)>0 OR COALESCE(v.limitedVisits,0)>0) AND l.trackedCampaigns=0)) AS corrupt
   FROM reports r JOIN link_coverage l ON l.id=r.id LEFT JOIN visits v ON v.id=r.id LEFT JOIN orders_by_campaign o ON o.publication_id=r.id)`;
const totalsSql=`json_object('campaigns',COUNT(*),${counts.map(k=>`'${k}',COALESCE(SUM(${k}),0)`).join(',')},${amounts.map(k=>`'${k}',${sum('CAST('+k+' AS INTEGER)')}`).join(',')})`;
export const campaignPerformanceRowJson=`json_object('id',id,'campaignId',campaign_id,'name',name,'subject',subject,'publishedAt',published_at,'scheduledAt',scheduled_at,'cancelled',json(CASE campaign_cancelled WHEN 1 THEN 'true' ELSE 'false' END),'totals',json_object(${Object.keys(campaignPerformanceMetrics).map(k=>`'${k}',${k}`).join(',')}))`;
export const campaignConversionSql="CASE WHEN visits=0 THEN '' ELSE printf('%.2f',100.0*convertedVisits/visits) END";
export function validPerformanceTotals(v,aggregate=false){
  return v&&Object.keys(v).sort().join(',')===[...counts,...amounts,...(aggregate?['campaigns']:[])].sort().join(',')
    &&[...counts,...(aggregate?['campaigns']:[])].every(k=>Number.isSafeInteger(v[k])&&v[k]>=0)
    &&amounts.every(k=>typeof v[k]==='string'&&/^(0|[1-9][0-9]{0,18})$/.test(v[k])&&BigInt(v[k])<=9223372036854775807n)
    &&v.paidOrders<=v.checkouts&&v.convertedVisits<=v.paidOrders&&v.convertedVisits<=v.visits
    &&v.trackedCampaigns<=(aggregate?v.campaigns:1)&&v.untrackedCampaigns<=(aggregate?v.campaigns:1)
    &&BigInt(v.grossPaid)===BigInt(v.productPaid)+BigInt(v.shippingPaid);
}
export async function campaignPerformance(env,actor,url){
  reportParameters(url,['range','from','to','cohort','cursor']);
  const ctx=await campaignPerformanceContext(env,actor,url.searchParams),scope=await commerceHash({actor,cohort:ctx.cohort,view:'campaign_performance_page'});
  if(url.searchParams.has('cursor')&&!url.searchParams.has('cohort'))reportFailure('Keep the original report reference when loading another page');
  const cursor=url.searchParams.has('cursor')?readReviewCursor(url.searchParams.get('cursor'),scope):null;
  if(cursor&&(!Number.isSafeInteger(cursor.before)||cursor.before<1||cursor.before>ctx.c.cap+1))reportFailure('Campaign performance page is invalid');
  const bucket={daily:'local_day',weekly:"date(local_day,'-'||((CAST(strftime('%w',local_day) AS INTEGER)+6)%7)||' days')",monthly:"substr(local_day,1,7)||'-01'",yearly:"substr(local_day,1,4)||'-01-01'"}[ctx.period.group];
  const row=await env.DB.prepare(campaignPerformanceCte+` SELECT
    (SELECT COALESCE(SUM(corrupt),0) FROM performance) AS corrupt,
    (SELECT ${totalsSql} FROM performance WHERE segment=0) AS selected,
    (SELECT ${totalsSql} FROM performance WHERE segment=1) AS previous,
    (SELECT json_group_array(json(value)) FROM (SELECT json_object('date',${bucket},'totals',${totalsSql}) AS value FROM performance WHERE segment=0 GROUP BY ${bucket} ORDER BY ${bucket})) AS series,
    (SELECT json_group_array(json(value)) FROM (SELECT ${campaignPerformanceRowJson} AS value FROM performance WHERE segment=0 AND n<? ORDER BY n DESC LIMIT 21)) AS items,
    (SELECT n FROM performance WHERE segment=0 AND n<? ORDER BY n DESC LIMIT 1 OFFSET 19) AS next_before`)
    .bind(...ctx.bindings,cursor?.before??ctx.c.cap+1,cursor?.before??ctx.c.cap+1).first();
  const totals=JSON.parse(row.selected),previous=JSON.parse(row.previous),series=JSON.parse(row.series),items=JSON.parse(row.items);
  if(row.corrupt||!validPerformanceTotals(totals,true)||!validPerformanceTotals(previous,true)||series.some(s=>!validPerformanceTotals(s.totals,true))||items.some(r=>!validPerformanceTotals(r.totals)))
    reportFailure('Campaign performance evidence needs an operator review before this report is available.',503);
  await settingsActor(env,actor);
  return {storeId:ctx.seller.id,environment:ctx.mode,cohort:ctx.cohort,period:ctx.period,publicationCutoff:ctx.c.at,observedAt:new Date().toISOString(),
    totals,previous:ctx.period.previousFrom?previous:null,series,items:items.slice(0,20),nextCursor:items.length>20?reviewCursor({v:1,scope,before:row.next_before}):null};
}
