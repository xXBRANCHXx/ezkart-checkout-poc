import test from 'node:test';
import assert from 'node:assert/strict';
import {campaignDeliveryFixture} from './campaign-delivery-fixture.mjs';
import {publicationKey as key,publicationActor as actor,publicationBase} from './campaign-publication-fixture.mjs';
import {historicalCampaign} from './campaign-report-fixture.mjs';
import {campaignReport} from '../src/campaign-reports.js';
import {createCampaignReportExport,readCampaignReportExport,cleanupCampaignReportExports,campaignReportHeaders} from '../src/campaign-report-exports.js';
import {recordEmailWebhook} from '../src/commerce-email-delivery.js';
import {lookupCampaignEmail,resolveCampaignEmail} from '../src/email-investigation.js';
import {emailFixtureEvent,emailFixtureCallback} from './email-fixture.mjs';
import {grantCampaignConsent} from './campaign-unsubscribe-fixture.mjs';
import {applyCommerceSchema} from './commerce-schema.mjs';

const base='/v1/commerce/marketing',url=query=>new URL('https://fixture.test'+base+'/reports'+(query?'?'+query:''));
const read=(f,query='')=>f.merchant(base+'/reports'+(query?'?'+query:'')),intent=r=>({cohort:r.cohort,requestKey:key()}),create=(f,b)=>f.merchant(base+'/report-exports',b,{method:'POST'});
const page=(f,id,query='')=>f.merchant(base+'/report-exports/'+id+(query?'?'+query:''));
const encode=c=>Buffer.from(JSON.stringify(c)).toString('base64url'),decode=s=>JSON.parse(Buffer.from(s,'base64url'));
const record=(f,c,type)=>recordEmailWebhook(emailFixtureCallback(emailFixtureEvent(c.message,c.id,type)),f.env,'test_mail');
async function seeded(t,options={}){const f=await campaignDeliveryFixture(t,options);await f.addBuyer(1);assert.equal((await f.publish()).status,200);return f;}

test('reports distinguish submitted, delivered, uncertain, complaint and link-withdrawal evidence without exposing recipient identities',async t=>{
  const f=await campaignDeliveryFixture(t,{bindings:{COMMERCE_EMAIL_RECONCILE:'enabled',RESEND_READ_API_KEY:'re_fixture_campaign_reader'}}),buyers=[];
  for(let n=1;n<=4;n++)buyers.push(await f.addBuyer(n));assert.equal((await f.publish()).status,200);
  assert.equal((await read(f)).totals.queued,4);await f.drain(1);f.control.outcomes.push('lost');await f.drain(1);f.control.outcomes.push('rate');await f.drain(1);
  await record(f,f.control.calls[0],'email.delivered');await record(f,f.control.calls[0],'email.complained');await f.decline(buyers.find(b=>!f.control.calls.some(c=>c.message.to.includes(b.buyer.email))).grant);
  const link=new URL(f.control.calls[0].message.headers['List-Unsubscribe'].slice(1,-1));
  const withdraw=()=>f.mf.dispatchFetch('https://fixture.test/v1/public/campaign-unsubscribe'+link.search,{method:'POST',headers:{'content-type':'application/x-www-form-urlencoded'},body:'List-Unsubscribe=One-Click'});
  assert.equal((await withdraw()).status,200);await grantCampaignConsent(f,{buyer:buyers.find(b=>f.control.calls[0].message.to.includes(b.buyer.email)).buyer,revision:2});assert.equal((await withdraw()).status,200);
  const report=await read(f);assert.equal(report.status,200,JSON.stringify(report));
  for(const [k,n] of Object.entries({campaigns:1,recipients:4,submitted:1,delivered:1,complained:1,unconfirmed:2,needsReview:2,retry:0,queued:1,unsubscribed:1}))assert.equal(report.totals[k],n,k);
  assert.equal(report.series[0].totals.recipients,4);assert.equal(report.items[0].totals.unsubscribed,1);
  for(const privateValue of ['buyer1@example.test','campaign-buyer-1',link.searchParams.get('t')])assert(!JSON.stringify(report).includes(privateValue));
  const x=await f.db.prepare("SELECT * FROM commerce_campaign_email_requests WHERE request_json=?").bind(f.control.calls[1].body).first(),lookupKey=key();
  const lookup=await lookupCampaignEmail(f.env,{environment:'sandbox',requestId:x.id,providerId:f.control.calls[1].id,lookupKey,operator:'report_fixture'},f.fetcher);assert.equal(lookup.receipt.outcome,'matched');
  const job=await f.db.prepare('SELECT * FROM commerce_jobs WHERE id=?').bind(x.job_id).first();
  await resolveCampaignEmail(f.env,{environment:'sandbox',requestId:x.id,lookupKey,operator:'report_fixture',resolutionKey:key(),expectedUpdatedAt:job.updated_at});
  const fixed=await read(f,'cohort='+report.cohort);assert.equal(fixed.totals.delivered,2);assert.equal(fixed.totals.submitted,2);assert.equal(fixed.totals.needsReview,1);assert.equal(f.control.calls.length,3);
});

test('store-local publication dates, equal previous periods and frozen copy survive later settings and draft changes',async t=>{
  const f=await seeded(t),one=await historicalCampaign(f,'2026-08-10T16:30:00.000Z'),two=await historicalCampaign(f,'2026-08-10T17:00:00.000Z');
  let r=await read(f,'range=custom&from=2026-08-11&to=2026-08-11');assert.equal(r.status,200,JSON.stringify(r));assert.deepEqual(r.items.map(x=>x.id),[two.id]);assert.equal(r.previous.campaigns,1);assert.equal(r.period.previousFrom,'2026-08-10');assert.equal(r.series[0].date,'2026-08-11');
  assert.equal((await f.merchant(publicationBase,{id:two.campaignId,revision:1,requestKey:key(),values:{...f.values,name:'Later edit',subject:'Changed after publishing',archived:true}},{method:'POST'})).status,200);
  const profile=(await f.merchant('/v1/commerce/settings')).profile.values;
  assert.equal((await f.merchant('/v1/commerce/settings',{kind:'profile',revision:0,requestKey:key(),values:{...profile,timezone:'Asia/Jayapura'}},{method:'POST'})).status,200);
  const old=await read(f,'cohort='+r.cohort);assert.deepEqual(old.items,r.items);assert.equal(old.period.timeZone,'Asia/Jakarta');
  r=await read(f,'range=custom&from=2026-08-11&to=2026-08-11');assert.equal(r.totals.campaigns,2);assert.equal(r.previous.campaigns,0);assert.equal(r.period.timeZone,'Asia/Jayapura');assert.equal(r.items[0].name,f.values.name);
  assert.equal((await read(f,'range=180')).period.group,'weekly');assert.equal((await read(f,'range=custom&from=2020-01-01&to=2025-01-01')).period.group,'monthly');
  assert.equal((await read(f,'range=custom&from=1970-01-01&to=2025-01-01')).period.group,'yearly');
  const all=await read(f,'range=all');assert.equal(all.previous,null);assert.equal(all.totals.campaigns,3);assert.equal(all.period.from,'2026-08-11');
});

test('campaign paging keeps its original cohort while complete exports include every row and exclude later publications',async t=>{
  const f=await seeded(t);for(let n=1;n<=23;n++)await historicalCampaign(f,'2026-08-'+String(n).padStart(2,'0')+'T12:00:00.000Z');
  const r=await read(f,'range=all');assert.equal(r.status,200,JSON.stringify(r));assert.equal(r.items.length,20);assert.equal(r.totals.campaigns,24);assert(r.nextCursor);
  const late=await historicalCampaign(f,'2026-08-24T12:00:00.000Z');
  const next=await read(f,'cohort='+r.cohort+'&cursor='+r.nextCursor);assert.equal(next.items.length,4);assert.equal(next.nextCursor,null);assert.equal(next.totals.campaigns,24);assert.equal(new Set([...r.items,...next.items].map(x=>x.id)).size,24);assert(!next.items.some(x=>x.id===late.id));
  const made=await create(f,intent(r));assert.equal(made.status,200,JSON.stringify(made));assert.equal(made.export.rowCount,24);
  const rows=[];let after=0;do{const v=await page(f,made.export.id,'after='+after+'&limit=7');assert.equal(v.status,200,JSON.stringify(v));rows.push(...v.rows);after=v.nextAfter;}while(after!==null);
  assert.deepEqual(rows.map(x=>x.ordinal),Array.from({length:24},(_,i)=>i+1));assert.equal(new Set(rows.map(x=>x.cells[0])).size,24);assert(!rows.some(x=>x.cells[0]===late.id));assert(rows.every(x=>x.cells.length===23));
  assert.equal((await read(f,'range=all')).totals.campaigns,25);
});

test('export materialization is atomic, replayable after a lost acknowledgement and immutable as later evidence arrives',async t=>{
  const f=await seeded(t),r=await read(f),body=intent(r);
  await f.db.prepare("CREATE TRIGGER fixture_report_failure BEFORE INSERT ON commerce_campaign_report_export_rows BEGIN SELECT RAISE(ABORT,'fixture_report_failure'); END").run();
  assert.equal((await create(f,body)).status,500);assert.equal(await f.count('commerce_campaign_report_exports'),0);assert.equal(await f.count('commerce_campaign_report_export_rows'),0);
  await f.db.prepare('DROP TRIGGER fixture_report_failure').run();let lost=true;
  const DB=new Proxy(f.db,{get(target,k){if(k==='batch')return async statements=>{const result=await target.batch(statements);if(lost){lost=false;throw Error('Fixture lost committed acknowledgement');}return result;};return typeof target[k]==='function'?target[k].bind(target):target[k];}});
  const a=await createCampaignReportExport({...f.env,DB},actor,body);assert.equal(a.replayed,true);assert.equal(a.export.rowCount,1);assert.equal(a.export.storeId,'seller_alice');assert.deepEqual(a.export.headers,campaignReportHeaders);
  const before=await page(f,a.export.id);await f.drain(1);await record(f,f.control.calls[0],'email.delivered');assert.equal((await read(f,'cohort='+r.cohort)).totals.delivered,1);
  const both=await Promise.all([create(f,body),create(f,body)]);assert(both.every(v=>v.status===200&&v.replayed));assert.equal(await f.count('commerce_campaign_report_exports'),1);assert.deepEqual(await page(f,a.export.id),before);
  assert.equal((await create(f,{...body,cohort:(await read(f,'range=7')).cohort})).status,409);
  for(const sql of ["UPDATE commerce_campaign_report_exports SET row_count=row_count+1","UPDATE commerce_campaign_report_export_rows SET ordinal=ordinal+1","DELETE FROM commerce_campaign_report_exports","DELETE FROM commerce_campaign_report_export_rows","INSERT OR REPLACE INTO commerce_campaign_report_exports SELECT * FROM commerce_campaign_report_exports","INSERT OR REPLACE INTO commerce_campaign_report_export_rows SELECT * FROM commerce_campaign_report_export_rows"])
    await assert.rejects(f.db.prepare(sql).run(),/campaign_report_/);
});

test('report and export access follow current membership, account, environment and store even during holds',async t=>{
  const f=await seeded(t),r=await read(f),b=intent(r),created=await create(f,b);assert.equal(created.status,200,JSON.stringify(created));
  assert.equal((await f.merchant(base+'/reports?cohort='+r.cohort,undefined,{seller:'bob'})).status,422);
  assert.equal((await f.merchant(base+'/report-exports/'+created.export.id,undefined,{seller:'bob'})).status,404);
  assert.equal((await f.merchant(base+'/reports',undefined,{seller:'absent'})).status,403);
  await assert.rejects(campaignReport({...f.env,APP_ENVIRONMENT:'production'},actor,url('cohort='+r.cohort)),e=>e.status===422);
  assert.equal((await campaignReport({...f.env,COMMERCE_STORAGE:'legacy',COMMERCE_CAMPAIGN_SEND:'off'},actor,url('cohort='+r.cohort))).totals.recipients,1);
  await f.db.prepare("UPDATE seller_memberships SET role='viewer' WHERE auth_user_id='alice'").run();assert.equal((await create(f,intent(r))).status,200);assert.equal((await create(f,b)).replayed,true);
  const response=await f.mf.dispatchFetch('https://fixture.test'+base+'/reports',{headers:{authorization:'Bearer '+await f.merchantToken(),'X-Ezkart-Marketing-Store':'seller_bob'}});assert.equal(response.status,409);
  await f.db.prepare("DELETE FROM seller_memberships WHERE auth_user_id='alice'").run();assert.equal((await page(f,created.export.id)).status,403);assert.equal((await create(f,b)).status,403);
});

test('strict filters reject altered, expired and cross-view cohorts without confusing a new report with a missing value',async t=>{
  const f=await seeded(t),r=await read(f),c=decode(r.cohort);
  for(const query of ['range=','cohort=','range=week','range=7&range=30','range=7&from=2026-01-01','range=custom','range=custom&from=2026-02-30&to=2026-03-01','range=custom&from=2026-08-10&to=2026-08-09','range=custom&from=2099-01-01&to=2099-01-02','environment=production','cohort='+r.cohort+'&range=7','cursor=x'])assert.equal((await read(f,query)).status,422,query);
  for(const change of [{cap:-1},{cap:1.5},{cap:Number.MAX_SAFE_INTEGER},{at:'2026-08-01'},{at:'2099-01-01T00:00:00.000Z'},{timeZone:'UTC'},{from:'2026-02-30'},{scope:'another'},{v:2},{extra:'x'}])assert.equal((await read(f,'cohort='+encode({...c,...change}))).status,422,JSON.stringify(change));
  const expired=encode({...c,range:'custom',at:'2026-08-31T00:00:00.000Z',from:'2026-08-01',to:'2026-08-01'});assert.equal((await read(f,'cohort='+expired)).status,410);assert.equal((await create(f,{cohort:expired,requestKey:key()})).status,410);
  const a=await create(f,intent(r));for(const query of ['after=','limit=','after=-1','after=2','limit=501','limit=1&limit=2','sellerId=seller_bob'])assert.equal((await page(f,a.export.id,query)).status,422,query);
  for(const body of [{},[],{...intent(r),extra:true},{...intent(r),requestKey:'bad'}])assert.equal((await create(f,body)).status,Array.isArray(body)?400:422);
});

test('empty stores and scheduled or cancelled publications report recorded outcomes without manufacturing delivery',async t=>{
  const f=await campaignDeliveryFixture(t),empty=await read(f,'range=all');assert.equal(empty.totals.campaigns,0);assert.deepEqual(empty.items,[]);assert.deepEqual(empty.series,[]);assert.equal(empty.previous,null);
  const zero=await create(f,intent(empty));assert.equal(zero.status,200,JSON.stringify(zero));assert.equal(zero.export.rowCount,0);assert.deepEqual((await page(f,zero.export.id)).rows,[]);
  await f.addBuyer(1);assert.equal((await f.publish({...f.intent(),scheduledAt:new Date(Date.now()+86400000).toISOString()})).status,200);assert.equal((await read(f)).totals.queued,1);assert.equal((await f.action('cancel')).status,200);
  const r=await read(f);assert.equal(r.totals.cancelled,1);assert.equal(r.totals.submitted,0);assert.equal(r.totals.delivered,0);assert.equal(r.items[0].cancelled,true);assert.equal(r.items[0].totals.queued,0);
});

test('new exports are rate limited while the original exact receipt stays recoverable',async t=>{
  const f=await seeded(t),r=await read(f),original=intent(r);assert.equal((await create(f,original)).status,200);
  for(let n=1;n<20;n++)assert.equal((await create(f,intent(r))).status,200);assert.equal((await create(f,intent(r))).status,429);assert.equal((await create(f,original)).replayed,true);assert.equal(await f.count('commerce_campaign_report_exports'),20);
});

test('database guards reject incomplete, mis-scoped or gapped report materialization',async t=>{
  const f=await seeded(t),r=await read(f),a=await create(f,intent(r)),source=await f.db.prepare('SELECT * FROM commerce_campaign_report_exports WHERE id=?').bind(a.export.id).first(),row=await f.db.prepare('SELECT * FROM commerce_campaign_report_export_rows WHERE export_id=?').bind(a.export.id).first();
  const header=(id,extra={})=>{const v={...source,id,request_key:key(),state:'building',row_count:0,...extra};return f.db.prepare('INSERT INTO commerce_campaign_report_exports('+Object.keys(v).join(',')+') VALUES('+Object.keys(v).map(()=>'?').join(',')+')').bind(...Object.values(v));};
  for(const extra of [{actor_id:'bob'},{seller_id:'seller_bob'},{period_json:'{}'},{state:'ready'}])await assert.rejects(header('crex_'+key(),extra).run(),/campaign_report_/);
  for(const change of [{ordinal:2},{cells_json:JSON.stringify(['wrong',...JSON.parse(row.cells_json).slice(1)])},{publication_id:'cpub_'+'f'.repeat(32)}]){
    const id='crex_'+key(),v={...row,export_id:id,...change};await assert.rejects(f.db.batch([header(id),f.db.prepare('INSERT INTO commerce_campaign_report_export_rows VALUES (?,?,?,?)').bind(v.export_id,v.ordinal,v.publication_id,v.cells_json),f.db.prepare("UPDATE commerce_campaign_report_exports SET state='ready',row_count=1 WHERE id=?").bind(id)]),/campaign_report_/);
    assert.equal(await f.count('commerce_campaign_report_exports'),1);
  }
  const id='crex_'+key();await assert.rejects(f.db.batch([header(id),f.db.prepare("UPDATE commerce_campaign_report_exports SET state='ready' WHERE id=?").bind(id)]),/campaign_report_/);
});

test('cleanup only deletes expired snapshots and a missing suffix never becomes a successful partial download',async t=>{
  const f=await seeded(t),a=await create(f,intent(await read(f))),header=await f.db.prepare('SELECT * FROM commerce_campaign_report_exports WHERE id=?').bind(a.export.id).first();
  await cleanupCampaignReportExports(f.env);assert.equal((await page(f,a.export.id)).status,200);
  // Simulate elapsed retention only in this isolated fixture, restoring the real
  // immutable guard before invoking the production cleanup/read paths.
  const guard=await f.db.prepare("SELECT sql FROM sqlite_master WHERE name='commerce_campaign_report_finalize'").first();await f.db.prepare('DROP TRIGGER commerce_campaign_report_finalize').run();
  await f.db.prepare("UPDATE commerce_campaign_report_exports SET publication_cutoff='2000-01-01T00:00:00.000Z',created_at='2000-01-01T00:00:00.000Z',expires_at='2000-01-02T00:00:00.000Z' WHERE id=?").bind(a.export.id).run();await f.db.prepare(guard.sql).run();
  assert.equal((await page(f,a.export.id)).status,410);
  let removed=false;const DB=new Proxy(f.db,{get(target,k){if(k==='prepare')return sql=>{const statement=target.prepare(sql);if(!sql.startsWith('SELECT * FROM commerce_campaign_report_exports'))return statement;return {bind:()=>({first:async()=>{if(!removed){removed=true;await cleanupCampaignReportExports(f.env);}return header;}})};};return typeof target[k]==='function'?target[k].bind(target):target[k];}});
  await assert.rejects(readCampaignReportExport({...f.env,DB},actor,a.export.id,new URL('https://fixture.test')),e=>e.status===410);assert.equal((await page(f,a.export.id)).status,404);assert.equal(await f.count('commerce_campaign_report_export_rows'),0);
});

test('migration 0038 preserves existing campaign evidence and makes it reportable without sending mail',async t=>{
  const f=await seeded(t,{through:37});await f.drain(1);await record(f,f.control.calls[0],'email.delivered');
  const tables=['commerce_campaigns','commerce_campaign_publications','commerce_campaign_candidates','commerce_campaign_email_requests','commerce_email_events','commerce_jobs'],before=await Promise.all(tables.map(n=>f.db.prepare('SELECT * FROM '+n+' ORDER BY rowid').all()));
  await applyCommerceSchema(f.db,37,38);for(let i=0;i<tables.length;i++)assert.deepEqual((await f.db.prepare('SELECT * FROM '+tables[i]+' ORDER BY rowid').all()).results,before[i].results,tables[i]);
  assert.equal((await read(f)).totals.delivered,1);assert.equal(f.control.calls.length,1);assert.deepEqual((await f.db.prepare('PRAGMA foreign_key_check').all()).results,[]);
});

test('a missing recipient job fails reporting closed and cannot produce a smaller successful export',async t=>{
  const f=await seeded(t),r=await read(f);await assert.rejects(f.db.prepare("DELETE FROM commerce_jobs WHERE kind='campaign.send'").run(),/campaign_/);
  // Simulate damage from outside the protected application in this fixture.
  await f.db.prepare('DROP TRIGGER commerce_campaign_job_delete').run();await f.db.prepare("DELETE FROM commerce_jobs WHERE kind='campaign.send'").run();
  assert.equal((await read(f,'cohort='+r.cohort)).status,503);assert.equal((await create(f,intent(r))).status,500);
  assert.equal(await f.count('commerce_campaign_report_exports'),0);assert.equal(await f.count('commerce_campaign_report_export_rows'),0);
});

test('membership revocation during export materialization rolls back every export row',async t=>{
  const f=await seeded(t),r=await read(f);let changed=false;
  const DB=new Proxy(f.db,{get(target,k){if(k==='batch')return async statements=>{changed=true;await target.prepare("DELETE FROM seller_memberships WHERE auth_user_id='alice'").run();return target.batch(statements);};return typeof target[k]==='function'?target[k].bind(target):target[k];}});
  await assert.rejects(createCampaignReportExport({...f.env,DB},actor,intent(r)),e=>e.status===403);assert(changed);assert.equal(await f.count('commerce_campaign_report_exports'),0);assert.equal(await f.count('commerce_campaign_report_export_rows'),0);
});

test('concurrent first submissions materialize one snapshot and report which request reused it',async t=>{
  const f=await seeded(t),r=await read(f),body=intent(r);let waiting=0,release;const barrier=new Promise(resolve=>{release=resolve;});
  const DB=new Proxy(f.db,{get(target,k){if(k==='prepare')return sql=>{const statement=target.prepare(sql);if(!sql.startsWith('SELECT * FROM commerce_campaign_report_exports'))return statement;
    return {bind(...values){const bound=statement.bind(...values);return {async first(){const row=await bound.first();if(!row&&waiting<2){waiting++;if(waiting===2)release();await barrier;}return row;}};}};
  };return typeof target[k]==='function'?target[k].bind(target):target[k];}});
  const both=await Promise.all([createCampaignReportExport({...f.env,DB},actor,body),createCampaignReportExport({...f.env,DB},actor,body)]);
  assert.deepEqual(both.map(v=>v.replayed).sort(),[false,true]);assert.deepEqual(both[0].export,both[1].export);assert.equal(await f.count('commerce_campaign_report_exports'),1);assert.equal(await f.count('commerce_campaign_report_export_rows'),1);
});
