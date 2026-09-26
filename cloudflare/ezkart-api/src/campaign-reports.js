import {commerceHash} from './commerce-orders.js';
import {commerceReadEnvironment} from './commerce-order-reads.js';
import {settingsActor,publicStoreProfile} from './merchant-settings.js';
import {reviewCursor,readReviewCursor} from './commerce-reviews.js';

export const reportFailure=(message='Campaign report filters are invalid',status=422)=>{throw new Response(message,{status});};
export const reportParameters=(url,allowed)=>{for(const key of url.searchParams.keys())if(!allowed.includes(key)||url.searchParams.getAll(key).length!==1)reportFailure();};
const DAY=86400000,zones={'Asia/Jakarta':7,'Asia/Makassar':8,'Asia/Jayapura':9},ranges=['7','30','90','180','all','custom'];
const iso=n=>new Date(n).toISOString(),day=(n,zone)=>iso(n+zones[zone]*3600000).slice(0,10),midnight=(d,zone)=>Date.parse(d+'T00:00:00.000Z')-zones[zone]*3600000;
const validDate=(d,zone)=>typeof d==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(d)&&d>='1970-01-01'&&d<='2099-12-31'&&Number.isFinite(midnight(d,zone))&&day(midnight(d,zone),zone)===d;
const validStamp=s=>typeof s==='string'&&/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(s)&&Number.isFinite(Date.parse(s))&&iso(Date.parse(s))===s;
export const campaignMetrics={recipients:'Recipients',submitted:'Submitted',delivered:'Delivered',queued:'Queued',sending:'Sending',retry:'Retry scheduled',cancelled:'Cancelled recipients',notSent:'Not sent',unconfirmed:'Unconfirmed submissions',needsReview:'Needs review',delayed:'Delivery delayed',failed:'Delivery failed',bounced:'Bounced',complained:'Complaints',suppressed:'Suppressed',unsubscribed:'Unsubscribed through this email'};
const expressions={recipients:'COUNT(c.id)',submitted:'SUM(d.submitted_at IS NOT NULL)',delivered:'SUM(d.delivered_confirmed)',
  ...Object.fromEntries(Object.entries({queued:'queued',sending:'sending',retry:'retry',cancelled:'cancelled',notSent:'skipped',unconfirmed:'uncertain',delayed:'delayed',failed:'failed',bounced:'bounced',complained:'complained',suppressed:'suppressed'}).map(([k,state])=>[k,`SUM(d.delivery_state='${state}')`])),
  needsReview:'SUM(d.needs_review)',unsubscribed:'SUM(EXISTS(SELECT 1 FROM commerce_campaign_email_requests x JOIN commerce_unsubscribe_changes u ON u.token_hash=x.unsubscribe_hash WHERE x.candidate_id=c.id))'};
const metrics=Object.keys(campaignMetrics);
export async function campaignReportContext(env,actor,params,required=false,view='campaign_report'){
  const seller=await settingsActor(env,actor),mode=commerceReadEnvironment(env),scope=await commerceHash({actor,mode,view});
  let cohort=params.get('cohort'),c;
  if(params.has('cohort')&&(typeof cohort!=='string'||!/^[A-Za-z0-9_-]{1,1600}$/.test(cohort)))reportFailure();
  if(cohort){
    c=readReviewCursor(cohort,scope);
    if(Object.keys(c).sort().join(',')!=='at,cap,from,range,scope,timeZone,to,v'||!Number.isSafeInteger(c.cap)||c.cap<0||c.cap>=Number.MAX_SAFE_INTEGER||!validStamp(c.at)||Date.parse(c.at)>Date.now()
      ||!ranges.includes(c.range)||!Object.hasOwn(zones,c.timeZone)||!validDate(c.from,c.timeZone)||!validDate(c.to,c.timeZone)||c.from>c.to||c.to>day(Date.parse(c.at),c.timeZone))reportFailure('The report reference is invalid. Refresh the report.');
    if(Date.now()-Date.parse(c.at)>=DAY)reportFailure('This report reference has expired. Refresh the report.',410);
    for(const key of ['range','from','to'])if(params.has(key)&&params.get(key)!==c[key])reportFailure('The reporting dates changed. Refresh the report.');
    if(!['all','custom'].includes(c.range)&&(c.to!==day(Date.parse(c.at),c.timeZone)||(midnight(c.to,c.timeZone)-midnight(c.from,c.timeZone))/DAY+1!==Number(c.range)))reportFailure();
  }else{
    if(required)reportFailure('Open a campaign report before exporting it');
    const range=params.get('range')??'30',at=iso(Date.now()),timeZone=publicStoreProfile(seller).timezone,today=day(Date.parse(at),timeZone);
    if(!ranges.includes(range)||range!=='custom'&&(params.has('from')||params.has('to')))reportFailure();
    const frontier=await env.DB.prepare('SELECT COALESCE(MAX(rowid),0) AS cap,MIN(created_at) AS oldest FROM commerce_campaign_publications WHERE seller_id=? AND commerce_environment=? AND created_at<=?').bind(seller.id,mode,at).first();
    const to=range==='custom'?params.get('to'):today,from=range==='custom'?params.get('from'):range==='all'?(frontier.oldest?day(Date.parse(frontier.oldest),timeZone):today):day(midnight(to,timeZone)-(Number(range)-1)*DAY,timeZone);
    if(!validDate(from,timeZone)||!validDate(to,timeZone)||from>to||to>today)reportFailure('Choose valid publication dates ending today or earlier');
    c={v:1,scope,cap:frontier.cap,at,range,from,to,timeZone};cohort=reviewCursor(c);
  }
  const start=midnight(c.from,c.timeZone),end=midnight(c.to,c.timeZone)+DAY,days=(end-start)/DAY,previous=c.range==='all'?start:start-days*DAY;
  const period={range:c.range,from:c.from,to:c.to,timeZone:c.timeZone,group:days<=90?'daily':days<=730?'weekly':days<=20*366?'monthly':'yearly',previousFrom:c.range==='all'?null:day(previous,c.timeZone),previousTo:c.range==='all'?null:day(start-DAY,c.timeZone)};
  return {seller,actor,mode,cohort,c,period,start:iso(start),end:iso(end),bindings:[seller.id,mode,c.cap,c.at,iso(start),iso(end),iso(previous),'+'+zones[c.timeZone]+' hours']};
}

// Publication dates and the insertion frontier are fixed. Outcomes stay live
// until an export materializes them atomically. No order/revenue attribution is inferred.
export const campaignPublicationCte=`WITH cfg AS (SELECT ? AS seller,? AS environment,? AS cap,? AS cutoff,? AS start,? AS end,? AS previous,? AS offset),
 publications AS (SELECT p.rowid AS n,p.id,p.campaign_id,p.data_json,p.created_at,s.send_at,s.cancelled,s.candidate_count,
   CASE WHEN p.created_at>=cfg.start THEN 0 ELSE 1 END AS segment,strftime('%Y-%m-%d',p.created_at,cfg.offset) AS local_day
   FROM commerce_campaign_publications p LEFT JOIN commerce_campaign_publication_state s ON s.id=p.id,cfg
   WHERE p.seller_id=cfg.seller AND p.commerce_environment=cfg.environment AND p.rowid<=cfg.cap AND p.created_at<=cfg.cutoff
     AND p.created_at>=cfg.previous AND p.created_at<cfg.end)`;
export const campaignReportCte=campaignPublicationCte+`,
 reports AS (SELECT p.n,p.id,p.campaign_id,json_extract(p.data_json,'$.name') AS name,json_extract(p.data_json,'$.subject') AS subject,
   p.created_at AS published_at,p.send_at AS scheduled_at,p.cancelled AS campaign_cancelled,p.segment,p.local_day,
   ${metrics.map(k=>`COALESCE(${expressions[k]},0) AS ${k}`).join(',')},
   (p.candidate_count IS NULL OR COUNT(c.id)!=p.candidate_count OR COUNT(d.candidate_id)!=p.candidate_count) AS corrupt
   FROM publications p LEFT JOIN commerce_campaign_candidates c ON c.publication_id=p.id
   LEFT JOIN commerce_campaign_delivery_status d ON d.candidate_id=c.id GROUP BY p.id)`;
const totalsSql=`json_object('campaigns',COUNT(*),${metrics.map(k=>`'${k}',COALESCE(SUM(${k}),0)`).join(',')})`;
export const campaignReportRowJson=`json_object('id',id,'campaignId',campaign_id,'name',name,'subject',subject,'publishedAt',published_at,'scheduledAt',scheduled_at,'cancelled',json(CASE campaign_cancelled WHEN 1 THEN 'true' ELSE 'false' END),'totals',json_object(${metrics.map(k=>`'${k}',${k}`).join(',')}))`;
export async function campaignReport(env,actor,url){
  reportParameters(url,['range','from','to','cohort','cursor']);
  const ctx=await campaignReportContext(env,actor,url.searchParams),scope=await commerceHash({actor,cohort:ctx.cohort,view:'campaign_report_page'});
  if(url.searchParams.has('cursor')&&!url.searchParams.has('cohort'))reportFailure('Keep the original report reference when loading another page');
  const cursor=url.searchParams.has('cursor')?readReviewCursor(url.searchParams.get('cursor'),scope):null;
  if(cursor&&(!Number.isSafeInteger(cursor.before)||cursor.before<1||cursor.before>ctx.c.cap+1))reportFailure('Campaign report page is invalid');
  const bucket={daily:'local_day',weekly:"date(local_day,'-'||((CAST(strftime('%w',local_day) AS INTEGER)+6)%7)||' days')",monthly:"substr(local_day,1,7)||'-01'",yearly:"substr(local_day,1,4)||'-01-01'"}[ctx.period.group];
  const row=await env.DB.prepare(campaignReportCte+` SELECT
    (SELECT COALESCE(SUM(corrupt),0) FROM reports) AS corrupt,
    (SELECT ${totalsSql} FROM reports WHERE segment=0) AS selected,
    (SELECT ${totalsSql} FROM reports WHERE segment=1) AS previous,
    (SELECT json_group_array(json(value)) FROM (SELECT json_object('date',${bucket},'totals',${totalsSql}) AS value FROM reports WHERE segment=0 GROUP BY ${bucket} ORDER BY ${bucket})) AS series,
    (SELECT json_group_array(json(value)) FROM (SELECT ${campaignReportRowJson} AS value FROM reports WHERE segment=0 AND n<? ORDER BY n DESC LIMIT 21)) AS items,
    (SELECT n FROM reports WHERE segment=0 AND n<? ORDER BY n DESC LIMIT 1 OFFSET 19) AS next_before`)
    .bind(...ctx.bindings,cursor?.before??ctx.c.cap+1,cursor?.before??ctx.c.cap+1).first();
  if(row.corrupt)reportFailure('A campaign queue needs an operator review before this report is available.',503);
  const items=JSON.parse(row.items);await settingsActor(env,actor);
  return {storeId:ctx.seller.id,environment:ctx.mode,cohort:ctx.cohort,period:ctx.period,publicationCutoff:ctx.c.at,observedAt:iso(Date.now()),
    totals:JSON.parse(row.selected),previous:ctx.period.previousFrom?JSON.parse(row.previous):null,series:JSON.parse(row.series),items:items.slice(0,20),
    nextCursor:items.length>20?reviewCursor({v:1,scope,before:row.next_before}):null};
}
