import {commerceHash} from './commerce-orders.js';
import {commerceReadEnvironment} from './commerce-order-reads.js';
import {deploymentProfile} from './deployment.js';
const fail=(message,status=422)=>{throw new Response(message,{status});};
const hex=value=>typeof value==='string'&&/^[a-f0-9]{64}$/.test(value);
const name=value=>{if(typeof value!=='string'||!value.trim()||value.trim().length>120||/[\u0000-\u001f]/.test(value))fail('Enter a name of 1–120 characters');return value.trim().normalize('NFC');};
const key=value=>{if(typeof value!=='string'||!/^[a-f0-9]{32}$/.test(value))fail('The save reference is invalid');return value;};
const random=()=>Array.from(crypto.getRandomValues(new Uint8Array(32)),v=>v.toString(16).padStart(2,'0')).join('');
export const trackingHash=(token,env)=>commerceHash('tracking:'+commerceReadEnvironment(env)+':'+token);
const rows=async statement=>(await statement.all()).results;
const exact=(input,keys)=>{if(!input||typeof input!=='object'||Array.isArray(input)||Object.keys(input).some(k=>!keys.includes(k)))fail('Campaign request is invalid');};
const write=seller=>{if(!['owner','admin','editor'].includes(seller.role))fail('Your store role cannot change campaigns',403);};
export const campaignDays=(start,end)=>Math.max(1,Math.floor((Date.parse(end)+25200000)/86400000)-Math.floor((Date.parse(start)+25200000)/86400000)+1);
export async function trackingCampaign(env,seller,id){
 const c=await env.DB.prepare('SELECT * FROM tracking_campaigns WHERE id=? AND seller_id=? AND commerce_environment=?').bind(id,seller.id,commerceReadEnvironment(env)).first();
 if(!c)fail('Campaign not found',404);return c;
}
export async function createTrackingCampaign(env,seller,input,readPage){
 write(seller);exact(input,['requestKey','name','pages']);const id='trk_'+key(input.requestKey),title=name(input.name);
 if(!Array.isArray(input.pages)||!input.pages.length||input.pages.length>50||new Set(input.pages).size!==input.pages.length||input.pages.some(p=>typeof p!=='string'||!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(p)||p.length>48))fail('Select 1–50 different landing pages');
 const hash=await commerceHash({name:title,pages:[...input.pages].sort()}),mode=commerceReadEnvironment(env);
 const existing=await env.DB.prepare('SELECT * FROM tracking_campaigns WHERE id=?').bind(id).first();
 if(existing){if(existing.seller_id!==seller.id||existing.commerce_environment!==mode||existing.request_hash!==hash)fail('This save reference belongs to another campaign',409);return {campaign:existing};}
 const pages=await Promise.all(input.pages.map(async id=>{const p=await readPage(id);return {id,name:p.name||id,path:p.publicPath};}));
 const now=new Date().toISOString();
 await env.DB.batch([
  env.DB.prepare('INSERT INTO tracking_campaigns(id,seller_id,commerce_environment,name,request_hash,started_at) VALUES(?,?,?,?,?,?) ON CONFLICT(id) DO NOTHING').bind(id,seller.id,mode,title,hash,now),
  ...pages.map(p=>env.DB.prepare(`INSERT INTO tracking_pages(campaign_id,page_id,name,public_path) SELECT ?,?,?,? WHERE EXISTS(SELECT 1 FROM tracking_campaigns WHERE id=? AND seller_id=? AND commerce_environment=? AND request_hash=?) ON CONFLICT DO NOTHING`).bind(id,p.id,p.name,p.path,id,seller.id,mode,hash))
 ]);
 const saved=await trackingCampaign(env,seller,id);if(saved.request_hash!==hash)fail('The original save had different values',409);return {campaign:saved};
}
export async function addTrackingSource(env,seller,id,input){
 write(seller);exact(input,['requestKey','pageId','name']);const c=await trackingCampaign(env,seller,id),sourceId=await commerceHash(id+':'+key(input.requestKey)),title=name(input.name);
 const saved=await env.DB.prepare('SELECT * FROM tracking_sources WHERE id=?').bind(sourceId).first();
 if(saved){if(saved.page_id!==input.pageId||saved.name!==title)fail('The original source save had different values',409);return {source:saved};}
 if(c.ended_at)fail('This campaign has ended',409);
 if(typeof input.pageId!=='string'||!await env.DB.prepare('SELECT 1 FROM tracking_pages WHERE campaign_id=? AND page_id=?').bind(id,input.pageId).first())fail('Choose a landing page in this campaign');
 try{await env.DB.prepare('INSERT INTO tracking_sources(id,campaign_id,page_id,name,created_at) VALUES(?,?,?,?,?) ON CONFLICT(id) DO NOTHING').bind(sourceId,id,input.pageId,title,new Date().toISOString()).run();}
 catch(error){if(/tracking_source_limit/.test(String(error)))fail('Each landing page can have up to 40 tracking URLs',409);if(/tracking_campaign_ended/.test(String(error)))fail('This campaign has ended',409);if(/UNIQUE/.test(String(error)))fail('This page already has a source with that name',409);throw error;}
 const source=await env.DB.prepare('SELECT * FROM tracking_sources WHERE id=?').bind(sourceId).first();
 if(source.page_id!==input.pageId||source.name!==title)fail('The original source save had different values',409);return {source};
}
export async function endTrackingCampaign(env,seller,id){
 write(seller);await trackingCampaign(env,seller,id);
 await env.DB.prepare('UPDATE tracking_campaigns SET ended_at=? WHERE id=? AND ended_at IS NULL').bind(new Date().toISOString(),id).run();
 return {campaign:await trackingCampaign(env,seller,id)};
}
// Every report aggregates in SQL. Browser events never supply order value or paid status.
const reportSql=`WITH cfg AS (SELECT ? AS campaign,? AS start,? AS end,? AS seller,? AS mode,? AS now,? AS ended),
 groups AS (SELECT '' AS key,'' AS page,'' AS source UNION ALL
 SELECT 'page:'||page_id,page_id,'' FROM tracking_pages,cfg WHERE campaign_id=cfg.campaign UNION ALL
 SELECT 'source:'||id,'',id FROM tracking_sources,cfg WHERE campaign_id=cfg.campaign),
 visits AS (SELECT v.*,g.key FROM tracking_visits v JOIN tracking_sources s ON s.id=v.source_id JOIN cfg ON s.campaign_id=cfg.campaign
 JOIN groups g ON (g.page='' OR g.page=s.page_id) AND (g.source='' OR g.source=s.id) WHERE v.created_at>=cfg.start AND v.created_at<=cfg.end),
 events AS (SELECT e.*,v.key FROM tracking_events e JOIN visits v ON v.token_hash=e.visit_hash,cfg WHERE e.occurred_at<=cfg.end),
 timed AS (SELECT key,visit_hash,SUM(ms) AS ms FROM (SELECT key,visit_hash,document_id,MAX(elapsed_ms) AS ms FROM events GROUP BY key,visit_hash,document_id) GROUP BY key,visit_hash),
 activity AS (SELECT v.*,COALESCE(t.ms,0) AS ms,
 MAX(CASE WHEN e.kind='page_view' THEN 1 ELSE 0 END) AS viewed,
 MAX(CASE WHEN e.kind IN ('product_interaction','add_to_cart') THEN 1 ELSE 0 END) AS interacted,
 MAX(CASE WHEN e.kind='checkout_start' THEN 1 ELSE 0 END) AS checkout,
 MAX(CASE WHEN e.kind='shipping_selected' THEN 1 ELSE 0 END) AS shipping,
 MAX(CASE WHEN e.kind='payment_attempt' THEN 1 ELSE 0 END) AS payment
 FROM visits v LEFT JOIN timed t ON t.visit_hash=v.token_hash AND t.key=v.key LEFT JOIN events e ON e.visit_hash=v.token_hash AND e.key=v.key GROUP BY v.key,v.token_hash),
 paid AS (SELECT o.id,v.key,a.visit_hash,o.subtotal_amount,
 (SELECT COALESCE(SUM(quantity),0) FROM order_items i WHERE i.order_id=o.id AND i.seller_id=o.seller_id) AS units
 FROM tracking_orders a JOIN visits v ON v.token_hash=a.visit_hash JOIN orders o ON o.id=a.order_id,cfg
 WHERE o.created_at<=cfg.end AND o.seller_id=cfg.seller AND o.commerce_environment=cfg.mode
 AND EXISTS(SELECT 1 FROM commerce_payment_captures p WHERE p.order_id=o.id AND p.seller_id=o.seller_id AND p.commerce_environment=o.commerce_environment AND p.capture_kind='order_payment' AND p.verified_at<=cfg.end)),
 stats AS (SELECT a.key,COUNT(CASE WHEN viewed THEN 1 END) AS visitors,COUNT(DISTINCT CASE WHEN viewed THEN visitor_hash END) AS uniqueVisitors,
 SUM(interacted) AS interacted,SUM(checkout) AS checkoutStarts,SUM(shipping) AS shippingSelected,SUM(payment) AS paymentAttempts,
 SUM(CASE WHEN viewed THEN ms ELSE 0 END) AS totalTimeMs,
 COUNT(CASE WHEN viewed AND EXISTS(SELECT 1 FROM paid WHERE visit_hash=token_hash AND key=a.key) THEN 1 END) AS convertedVisitors,
 COUNT(CASE WHEN checkout AND EXISTS(SELECT 1 FROM paid WHERE visit_hash=token_hash AND key=a.key) THEN 1 END) AS completedCheckouts,
 COUNT(CASE WHEN checkout AND NOT EXISTS(SELECT 1 FROM paid WHERE visit_hash=token_hash AND key=a.key) AND (expires_at<=cfg.now OR cfg.ended=1) THEN 1 END) AS abandonedCheckouts FROM activity a,cfg GROUP BY a.key),
 sales AS (SELECT key,COUNT(*) AS orders,SUM(units) AS unitsSold,SUM(subtotal_amount) AS totalSales FROM paid GROUP BY key)
 SELECT g.key,s.visitors,s.uniqueVisitors,s.interacted,s.checkoutStarts,s.shippingSelected,s.paymentAttempts,s.totalTimeMs,s.convertedVisitors,s.completedCheckouts,s.abandonedCheckouts,p.orders,p.unitsSold,p.totalSales
 FROM groups g LEFT JOIN stats s ON s.key=g.key LEFT JOIN sales p ON p.key=g.key`;
async function allTrackingMetrics(env,c,at=new Date().toISOString()){
 const end=c.ended_at||at,days=campaignDays(c.started_at,end);
 const results=await rows(env.DB.prepare(reportSql).bind(c.id,c.started_at,end,c.seller_id,c.commerce_environment,at,c.ended_at?1:0));
 return new Map(results.map(row=>{const {key,...values}=row,m=Object.fromEntries(Object.entries(values).map(([k,v])=>[k,v||0])),ratio=(a,b)=>b?a/b:0;
 return [key,{...m,campaignDays:days,averageOrderValue:ratio(m.totalSales,m.orders),conversionRate:ratio(m.convertedVisitors,m.visitors),checkoutCompletionRate:ratio(m.completedCheckouts,m.checkoutStarts),averageTimeMs:ratio(m.totalTimeMs,m.visitors),salesPerDay:m.totalSales/days,ordersPerDay:m.orders/days}];}));
}
export async function trackingMetrics(env,c,{page='',source='',at=new Date().toISOString()}={}){
 return (await allTrackingMetrics(env,c,at)).get(source?'source:'+source:page?'page:'+page:'');
}
export async function trackingReport(env,seller,id){
 const c=await trackingCampaign(env,seller,id),at=new Date().toISOString();
 const pages=await rows(env.DB.prepare('SELECT * FROM tracking_pages WHERE campaign_id=? ORDER BY name,page_id').bind(id));
 const sources=await rows(env.DB.prepare('SELECT * FROM tracking_sources WHERE campaign_id=? ORDER BY created_at,id').bind(id));
 const metrics=await allTrackingMetrics(env,c,at);
 return {campaign:c,observedAt:at,metrics:metrics.get(''),pages:pages.map(p=>({...p,metrics:metrics.get('page:'+p.page_id)})),sources:sources.map(s=>({...s,metrics:metrics.get('source:'+s.id)})),origin:deploymentProfile(env).origin};
}
export async function listTrackingCampaigns(env,seller,url){
 if([...url.searchParams.keys()].some(k=>!['before'].includes(k))||url.searchParams.getAll('before').length>1)fail('Campaign filters are invalid');
 const before=url.searchParams.get('before')||'';if(before&&!/^trk_[a-f0-9]{32}$/.test(before))fail('Invalid campaign cursor');
 const list=await rows(env.DB.prepare(`SELECT * FROM tracking_campaigns WHERE seller_id=? AND commerce_environment=? AND (?='' OR rowid<(SELECT rowid FROM tracking_campaigns WHERE id=? AND seller_id=?)) ORDER BY rowid DESC LIMIT 51`).bind(seller.id,commerceReadEnvironment(env),before,before,seller.id));
 const more=list.length>50;list.length=Math.min(list.length,50);const at=new Date().toISOString(),campaigns=[];
 for(const c of list)campaigns.push({...c,metrics:await trackingMetrics(env,c,{at})});
 return {campaigns,next:more?list.at(-1).id:null,observedAt:at};
}
export async function startTrackingVisit(env,input){
 exact(input,['source','visitor','path','dimensions']);if(!hex(input.source||'')||!hex(input.visitor||'')||typeof input.path!=='string')fail('Tracking link is invalid',404);
 const mode=commerceReadEnvironment(env),row=await env.DB.prepare(`SELECT s.id,c.id AS campaign_id,c.seller_id,c.ended_at,p.public_path FROM tracking_sources s JOIN tracking_campaigns c ON c.id=s.campaign_id JOIN tracking_pages p ON p.campaign_id=s.campaign_id AND p.page_id=s.page_id WHERE s.id=? AND c.commerce_environment=?`).bind(input.source,mode).first();
 if(!row||row.public_path!==input.path)fail('Tracking link is invalid',404);if(row.ended_at)return {visit:null};
 const token=random(),now=new Date().toISOString(),expires=new Date(Date.now()+86400000).toISOString();
 const dimensions=cleanDimensions(input.dimensions);
 try{await env.DB.prepare('INSERT INTO tracking_visits(token_hash,source_id,visitor_hash,created_at,expires_at,dimensions_json) VALUES(?,?,?,?,?,?)').bind(await trackingHash(token,env),row.id,await commerceHash(row.seller_id+':'+mode+':'+input.visitor),now,expires,JSON.stringify(dimensions)).run();}
 catch(error){if(/tracking_campaign_ended|tracking_visit_limit/.test(String(error)))return {visit:null};throw error;}
 return {visit:token};
}
function cleanDimensions(value={}){
 const out={schemaVersion:1};if(!value||typeof value!=='object'||Array.isArray(value))return out;
 for(const k of ['device','language','referrerHost','utmSource','utmMedium','utmCampaign','country','browser'])if(typeof value[k]==='string')out[k]=value[k].replace(/[\u0000-\u001f]/g,'').slice(0,120);
 return out;
}
const eventKinds=['page_view','product_interaction','add_to_cart','checkout_start','shipping_selected','payment_attempt','checkout_error','engagement','scroll_depth','page_exit','variant_selected'];
export async function recordTrackingEvent(env,input){
 exact(input,['visit','id','kind','documentId','elapsedMs','properties']);
 if(!hex(input.visit||'')||!hex(input.id||'')||!hex(input.documentId||'')||!eventKinds.includes(input.kind)||!Number.isSafeInteger(input.elapsedMs)||input.elapsedMs<0||input.elapsedMs>86400000)fail('Tracking event is invalid');
 const hash=await trackingHash(input.visit,env),now=new Date().toISOString();
 const visit=await env.DB.prepare(`SELECT v.* FROM tracking_visits v JOIN tracking_sources s ON s.id=v.source_id JOIN tracking_campaigns c ON c.id=s.campaign_id WHERE v.token_hash=? AND v.expires_at>? AND c.ended_at IS NULL AND c.commerce_environment=?`).bind(hash,now,commerceReadEnvironment(env)).first();
 if(!visit)return {recorded:false};
 const properties={schemaVersion:1};for(const k of ['depth','viewportWidth','viewportHeight','loadMs'])if(Number.isFinite(input.properties?.[k]))properties[k]=Math.max(0,Math.min(100000,input.properties[k]));
 // No customer text, URLs with query strings, form values, addresses or payment data.
 for(const k of ['productId','variantId','errorCode','phase'])if(typeof input.properties?.[k]==='string'&&/^[a-zA-Z0-9_-]{1,96}$/.test(input.properties[k]))properties[k]=input.properties[k];
 try{await env.DB.prepare(`INSERT INTO tracking_events(id,visit_hash,kind,document_id,elapsed_ms,occurred_at,properties_json)
 SELECT ?,?,?,?,?,?,? WHERE EXISTS(SELECT 1 FROM tracking_visits v JOIN tracking_sources s ON s.id=v.source_id JOIN tracking_campaigns c ON c.id=s.campaign_id WHERE v.token_hash=? AND c.ended_at IS NULL) ON CONFLICT(id) DO NOTHING`).bind(input.id,hash,input.kind,input.documentId,Math.min(input.elapsedMs,Math.max(0,Date.now()-Date.parse(visit.created_at))),now,JSON.stringify(properties),hash).run();}
 catch(error){if(/tracking_event_limit/.test(String(error)))return {recorded:false};throw error;}
 return {recorded:true};
}
