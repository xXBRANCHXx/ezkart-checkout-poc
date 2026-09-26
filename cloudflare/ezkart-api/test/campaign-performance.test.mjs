import test from 'node:test';
import assert from 'node:assert/strict';
import {campaignDeliveryFixture} from './campaign-delivery-fixture.mjs';
import {prepareAttributionCampaign} from './campaign-attribution-fixture.mjs';
import {performanceJourney} from './campaign-performance-fixture.mjs';
import {historicalCampaign} from './campaign-report-fixture.mjs';
import {publicationKey as key,publicationActor as actor,publicationBase} from './campaign-publication-fixture.mjs';
import {fixtureShipping} from './commerce-fixture.mjs';
import {campaignPerformance,campaignPerformanceCte,campaignPerformanceContext} from '../src/campaign-performance.js';
import {createCampaignPerformanceExport,readCampaignPerformanceExport,cleanupCampaignPerformanceExports,campaignPerformanceHeaders} from '../src/campaign-performance-exports.js';
import {applyCommerceSchema} from './commerce-schema.mjs';
import {campaignVisitHash} from '../src/campaign-attribution.js';
const base='/v1/commerce/marketing',url=query=>new URL('https://fixture.test'+base+'/performance'+(query?'?'+query:''));
const report=(f,query='')=>f.merchant(base+'/performance'+(query?'?'+query:'')),intent=r=>({cohort:r.cohort,requestKey:key()}),create=(f,body)=>f.merchant(base+'/performance-exports',body,{method:'POST'}),page=(f,id,query='')=>f.merchant(base+'/performance-exports/'+id+(query?'?'+query:''));
async function fixture(t,options={}){const f=await campaignDeliveryFixture(t,options),campaign=await prepareAttributionCampaign(f);assert.equal((await f.drain()).processed,1);return performanceJourney(f,campaign);}

test('campaign performance counts verified order payments and converted visits without multiplying recipients, orders or additional captures',async t=>{
  const f=await fixture(t),a=await f.visit(),b=await f.visit(),one=await f.checkout(a.visit,{shipping:fixtureShipping}),two=await f.checkout(a.visit),unverified=await f.checkout(b.visit),direct=await f.checkout();
  assert.equal((await f.paid(one)).status,200);assert.equal((await f.paid(two)).status,200);assert.equal((await f.paid(direct)).status,200);assert.equal((await f.paid(one)).status,200);assert.equal((await f.paid(one,{reference:'additional-payment'})).status,200);
  await f.db.prepare("UPDATE orders SET checkout_state='paid' WHERE id=?").bind(unverified.id).run();await f.db.prepare("UPDATE orders SET checkout_state='refunded' WHERE id=?").bind(one.id).run();
  const r=await report(f);assert.equal(r.status,200,JSON.stringify(r));assert.deepEqual(r.totals,{campaigns:1,trackedCampaigns:1,untrackedCampaigns:0,visits:2,limitedVisits:0,checkouts:3,paidOrders:2,convertedVisits:1,grossPaid:'58000',productPaid:'40000',shippingPaid:'18000',additionalPaid:'38000'});
  assert.equal(r.items[0].id,f.campaign.publication.id);assert.deepEqual(r.series[0].totals,r.totals);
  for(const secret of [a.visit,b.visit,'buyer1@example.test',one.id,'additional-payment','campaign-buyer-1','campaignVisitHash'])assert(!JSON.stringify(r).includes(secret));
  const made=await create(f,intent(r));assert.equal(made.status,200,JSON.stringify(made));assert.deepEqual(made.export.headers,campaignPerformanceHeaders);const rows=(await page(f,made.export.id)).rows;assert.equal(rows[0].cells.length,19);assert.deepEqual(rows[0].cells.slice(7),[1,0,2,0,3,2,1,'58000','40000','18000','38000','50.00']);
  const context=await campaignPerformanceContext(f.env,actor,new URLSearchParams({cohort:r.cohort})),plan=(await f.db.prepare('EXPLAIN QUERY PLAN '+campaignPerformanceCte+' SELECT * FROM performance').bind(...context.bindings).all()).results;
  assert(plan.some(r=>r.detail.includes('idx_commerce_captures_order_kind')));assert(!plan.some(r=>/SCAN d\b/.test(r.detail)),JSON.stringify(plan));
});

test('publication cohorts keep their original store-local dates, copy, pagination and frontier while outcome evidence stays live',async t=>{
  const f=await fixture(t),old=await historicalCampaign(f,'2026-08-10T16:30:00.000Z'),next=await historicalCampaign(f,'2026-08-10T17:00:00.000Z');
  const r=await report(f,'range=custom&from=2026-08-11&to=2026-08-11');assert.equal(r.status,200,JSON.stringify(r));assert.deepEqual(r.items.map(v=>v.id),[next.id]);assert.equal(r.previous.campaigns,1);assert.equal(r.items[0].totals.trackedCampaigns,0);assert.equal(r.items[0].totals.visits,0);
  await f.merchant(publicationBase,{id:next.campaignId,revision:1,requestKey:key(),values:{...f.values,name:'Later draft name',archived:true}},{method:'POST'});
  const profile=(await f.merchant('/v1/commerce/settings')).profile.values;assert.equal((await f.merchant('/v1/commerce/settings',{kind:'profile',revision:0,requestKey:key(),values:{...profile,timezone:'Asia/Jayapura'}},{method:'POST'})).status,200);assert.deepEqual((await report(f,'cohort='+r.cohort)).items,r.items);assert.equal((await report(f,'cohort='+r.cohort)).period.timeZone,'Asia/Jakarta');
  for(let n=1;n<=21;n++)await historicalCampaign(f,'2026-08-'+String(n).padStart(2,'0')+'T12:00:00.000Z');
  const all=await report(f,'range=all');assert.equal(all.totals.campaigns,24);assert.equal(all.items.length,20);assert(all.nextCursor);
  const inserted=await historicalCampaign(f,'2026-08-24T12:00:00.000Z'),more=await report(f,'cohort='+all.cohort+'&cursor='+all.nextCursor);assert.equal(more.items.length,4);assert.equal(more.nextCursor,null);assert(!more.items.some(r=>r.id===inserted.id));
  const exported=await create(f,intent(all));assert.equal(exported.status,200,JSON.stringify(exported));assert.equal(exported.export.rowCount,24);let after=0,rows=[];do{const p=await page(f,exported.export.id,'after='+after+'&limit=7');assert.equal(p.status,200,JSON.stringify(p));rows.push(...p.rows);after=p.nextAfter;}while(after!==null);
  assert.equal(rows.length,24);assert.equal(new Set(rows.map(r=>r.cells[0])).size,24);assert(!rows.some(r=>r.cells[0]===inserted.id));assert.equal(rows.find(r=>r.cells[0]===old.id).cells[18],'');
  const current=await report(f),visit=await f.visit(),order=await f.checkout(visit.visit);await f.paid(order);const later=await report(f,'cohort='+current.cohort);assert.equal(later.totals.paidOrders,1);assert.equal(later.totals.convertedVisits,1);
});

test('performance and delivery receipts remain separate and exact exports survive a lost acknowledgement and later payments',async t=>{
  const f=await fixture(t),r=await report(f),body=intent(r),delivery=await f.merchant(base+'/reports'),d=await f.merchant(base+'/report-exports',intent(delivery),{method:'POST'}),oldRows=await f.merchant(base+'/report-exports/'+d.export.id);
  await f.db.prepare("CREATE TRIGGER fixture_export_failure BEFORE INSERT ON commerce_campaign_performance_export_rows BEGIN SELECT RAISE(ABORT,'fixture_export_failure'); END").run();assert.equal((await create(f,body)).status,500);assert.equal(await f.count('commerce_campaign_performance_exports'),0);assert.equal(await f.count('commerce_campaign_performance_export_rows'),0);await f.db.prepare('DROP TRIGGER fixture_export_failure').run();
  let lost=true;const DB=new Proxy(f.db,{get(target,k){if(k==='batch')return async statements=>{const result=await target.batch(statements);if(lost){lost=false;throw Error('Fixture lost acknowledgement');}return result;};return typeof target[k]==='function'?target[k].bind(target):target[k];}});
  const recovered=await createCampaignPerformanceExport({...f.env,DB},actor,body);assert.equal(recovered.replayed,true);const before=await page(f,recovered.export.id);
  const visit=await f.visit();await f.paid(await f.checkout(visit.visit));assert.equal((await report(f,'cohort='+r.cohort)).totals.paidOrders,1);
  const both=await Promise.all([create(f,body),create(f,body)]);assert(both.every(r=>r.status===200&&r.replayed));assert.deepEqual(await page(f,recovered.export.id),before);assert.equal(await f.count('commerce_campaign_performance_exports'),1);
  assert.deepEqual(await f.merchant(base+'/report-exports/'+d.export.id),oldRows);assert.equal(oldRows.rows[0].cells.length,23);
  assert.equal((await create(f,{...body,cohort:delivery.cohort})).status,409);assert.equal((await create(f,intent(delivery))).status,422);assert.equal((await f.merchant(base+'/report-exports',intent(r),{method:'POST'})).status,422);
  for(const table of ['commerce_campaign_performance_exports','commerce_campaign_performance_export_rows']){await assert.rejects(f.db.prepare('DELETE FROM '+table).run(),/campaign_performance_retained/);await assert.rejects(f.db.prepare('INSERT OR REPLACE INTO '+table+' SELECT * FROM '+table).run(),/campaign_performance_immutable/);}
});

test('concurrent first exports create one snapshot with the same identity',async t=>{
  const f=await fixture(t),r=await report(f),body=intent(r),results=await Promise.all([create(f,body),create(f,body)]);assert(results.every(r=>r.status===200),JSON.stringify(results));assert.equal(results.filter(r=>!r.replayed).length,1);assert.equal(results[0].export.id,results[1].export.id);assert.equal(await f.count('commerce_campaign_performance_exports'),1);
});

test('money remains exact above JavaScript integer precision in totals, chart groups and frozen CSV cells',async t=>{
  const f=await fixture(t),visit=await f.visit(),hash=await campaignVisitHash(visit.visit,'sandbox'),max=Number.MAX_SAFE_INTEGER,now=new Date().toISOString();
  for(const n of [0,1]){const id='EZK-S-'+String(n+1).padStart(24,'A'),amount=max-n;
    await f.db.prepare(`INSERT INTO orders(id,seller_id,commerce_version,commerce_environment,checkout_state,subtotal_amount,shipping_amount,total_amount,customer_snapshot_json,snapshot_json,created_at,updated_at)
      VALUES (?,'seller_alice',1,'sandbox','creating',?,0,?,'{}',?,?,?)`).bind(id,amount,amount,JSON.stringify({checkout:{campaignVisitHash:hash},fees:{plan:'standard'},shipping:{skipped:true}}),now,now).run();
    await f.db.prepare(`INSERT INTO commerce_payment_captures(id,seller_id,order_id,provider,commerce_environment,provider_reference,amount,currency,capture_kind,verified_at)
      VALUES (?,'seller_alice',?,'doku','sandbox',?,?,'IDR','order_payment',?)`).bind('large_capture_'+n,id,'large_reference_'+n,amount,now).run();
  }
  const r=await report(f);assert.equal(r.status,200,JSON.stringify(r));const exact=(2n*BigInt(max)-1n).toString();assert.equal(r.totals.grossPaid,exact);assert.equal(r.totals.productPaid,exact);assert.equal(r.items[0].totals.grossPaid,exact);assert.equal(r.series[0].totals.productPaid,exact);assert.equal(r.totals.convertedVisits,1);
  const made=await create(f,intent(r));assert.equal(made.status,200,JSON.stringify(made));assert.deepEqual((await page(f,made.export.id)).rows[0].cells.slice(14),[exact,exact,'0','0','100.00']);
});

test('current membership, account/store headers, environment and view bind reports and exports during holds',async t=>{
  const f=await fixture(t),r=await report(f),made=await create(f,intent(r));assert.equal(made.status,200,JSON.stringify(made));
  assert.equal((await f.mf.dispatchFetch(url().href)).status,401);assert.equal((await f.merchant(base+'/performance?cohort='+r.cohort,undefined,{seller:'bob'})).status,422);assert.equal((await f.merchant(base+'/performance-exports/'+made.export.id,undefined,{seller:'bob'})).status,404);
  assert.equal((await f.mf.dispatchFetch(url().href,{headers:{authorization:'Bearer '+await f.merchantToken(),'X-Ezkart-Marketing-Store':'seller_bob'}})).status,409);
  await assert.rejects(campaignPerformance({...f.env,APP_ENVIRONMENT:'production'},actor,url('cohort='+r.cohort)),e=>e.status===422);
  assert.equal((await campaignPerformance({...f.env,COMMERCE_STORAGE:'off',COMMERCE_CAMPAIGN_SEND:'off'},actor,url('cohort='+r.cohort))).totals.campaigns,1);
  await f.db.prepare("UPDATE seller_memberships SET role='viewer' WHERE auth_user_id='alice'").run();assert.equal((await create(f,intent(r))).status,200);
  await f.db.prepare("DELETE FROM seller_memberships WHERE auth_user_id='alice'").run();assert.equal((await page(f,made.export.id)).status,403);assert.equal((await create(f,intent(r))).status,403);
});

test('strict filter, cursor, receipt and page boundaries reject ambiguity and expired cohorts',async t=>{
  const f=await fixture(t),r=await report(f),delivery=await f.merchant(base+'/reports');
  for(const query of ['range=','cohort=','range=7&range=30','range=week','range=custom','range=custom&from=2026-02-30&to=2026-03-01','range=7&from=2026-01-01','range=custom&from=2099-01-01&to=2099-01-02','environment=production','cursor=bad','cohort='+delivery.cohort,'cohort='+r.cohort+'&range=7'])assert.equal((await report(f,query)).status,422,query);
  const c=JSON.parse(Buffer.from(r.cohort,'base64url'));for(const change of [{cap:-1},{cap:Number.MAX_SAFE_INTEGER},{timeZone:'UTC'},{v:2},{extra:true},{at:'2099-01-01T00:00:00.000Z'}])assert.equal((await report(f,'cohort='+Buffer.from(JSON.stringify({...c,...change})).toString('base64url'))).status,422);
  const made=await create(f,intent(r));for(const query of ['after=','after=-1','after=2','limit=','limit=501','limit=1&limit=2','sellerId=seller_bob'])assert.equal((await page(f,made.export.id,query)).status,422,query);
  for(const route of ['/performance/'+made.export.id,'/performance-exports/'+made.export.id+'/history','/report-exports/'+made.export.id,'/campaigns/'+made.export.id])assert.equal((await f.merchant(base+route)).status,404,route);
  t.mock.timers.enable({apis:['Date'],now:Date.parse(c.at)+86400000});try{await assert.rejects(campaignPerformance(f.env,actor,url('cohort='+r.cohort)),e=>e.status===410);}finally{t.mock.timers.reset();}
});

test('measurement limits remain visible without creating conversions and expired references preserve historical outcomes',async t=>{
  const f=await fixture(t),visit=await f.visit();await f.paid(await f.checkout(visit.visit));
  const guard=await f.db.prepare("SELECT sql FROM sqlite_master WHERE name='commerce_campaign_visit_bucket_update'").first();await f.db.prepare('DROP TRIGGER commerce_campaign_visit_bucket_update').run();await f.db.prepare('UPDATE commerce_campaign_visit_buckets SET recorded=10000').run();await f.db.prepare(guard.sql).run();assert.equal((await f.visit()).visit,null);
  const r=await report(f);assert.equal(r.status,200,JSON.stringify(r));assert.equal(r.totals.visits,10000);assert.equal(r.totals.limitedVisits,1);assert.equal(r.totals.convertedVisits,1);
  await f.db.prepare('DROP TRIGGER commerce_campaign_visit_delete').run();await f.db.prepare('DELETE FROM commerce_campaign_visits').run();assert.deepEqual((await report(f,'cohort='+r.cohort)).totals,r.totals);
  const made=await create(f,intent(r));assert.equal((await page(f,made.export.id)).rows[0].cells[18],'0.01');
});

test('missing visit aggregates or invalid capture evidence fail reporting and export atomically instead of understating the source',async t=>{
  const f=await fixture(t),visit=await f.visit();await f.paid(await f.checkout(visit.visit));const r=await report(f);assert.equal(r.status,200,JSON.stringify(r));
  await assert.rejects(f.db.prepare('DELETE FROM commerce_campaign_visit_buckets').run(),/immutable/);await f.db.prepare('DROP TRIGGER commerce_campaign_visit_bucket_delete').run();await f.db.prepare('DELETE FROM commerce_campaign_visit_buckets').run();
  assert.equal((await report(f)).status,503);assert.equal((await create(f,intent(r))).status,503);assert.equal(await f.count('commerce_campaign_performance_exports'),0);
});

test('empty and scheduled/cancelled campaigns report zero outcomes and export a complete empty snapshot',async t=>{
  const f=await campaignDeliveryFixture(t),empty=await report(f,'range=all');assert.equal(empty.status,200,JSON.stringify(empty));assert.equal(empty.totals.campaigns,0);assert.equal(empty.totals.grossPaid,'0');assert.deepEqual(empty.items,[]);assert.equal(empty.previous,null);
  const zero=await create(f,intent(empty));assert.equal(zero.status,200,JSON.stringify(zero));assert.equal(zero.export.rowCount,0);assert.deepEqual((await page(f,zero.export.id)).rows,[]);
  await f.addBuyer(1);assert.equal((await f.publish({...f.intent(),scheduledAt:new Date(Date.now()+86400000).toISOString()})).status,200);assert.equal((await f.action('cancel')).status,200);const r=await report(f);assert.equal(r.totals.campaigns,1);assert.equal(r.items[0].cancelled,true);assert.equal(r.totals.trackedCampaigns,0);assert.equal(r.totals.visits,0);assert.equal(r.totals.paidOrders,0);assert.equal(r.totals.grossPaid,'0');
});

test('performance row guards reject gapped snapshots, changed scope, rounded money and fabricated conversion before commit',async t=>{
  const f=await fixture(t),visit=await f.visit();await f.paid(await f.checkout(visit.visit));const r=await report(f),made=await create(f,intent(r)),source=await f.db.prepare('SELECT * FROM commerce_campaign_performance_exports WHERE id=?').bind(made.export.id).first(),row=await f.db.prepare('SELECT * FROM commerce_campaign_performance_export_rows WHERE export_id=?').bind(made.export.id).first();
  const header=(id,extra={})=>{const v={...source,id,request_key:key(),state:'building',row_count:0,...extra};return f.db.prepare('INSERT INTO commerce_campaign_performance_exports('+Object.keys(v).join(',')+') VALUES('+Object.keys(v).map(()=>'?').join(',')+')').bind(...Object.values(v));};
  for(const change of [{seller_id:'seller_bob'},{actor_id:'bob'},{period_json:'{}'},{state:'ready'}])await assert.rejects(header('cpex_'+key(),change).run(),/campaign_performance_/);
  for(const [index,value] of [[0,'cpub_'+'f'.repeat(32)],[13,2],[14,20000],[15,'020000'],[18,'0.00']]){const id='cpex_'+key(),cells=JSON.parse(row.cells_json);cells[index]=value;
    await assert.rejects(f.db.batch([header(id),f.db.prepare('INSERT INTO commerce_campaign_performance_export_rows VALUES (?,?,?,?)').bind(id,1,row.publication_id,JSON.stringify(cells)),f.db.prepare("UPDATE commerce_campaign_performance_exports SET state='ready',row_count=1 WHERE id=?").bind(id)]),/campaign_performance_/);
  }
  const id='cpex_'+key();await assert.rejects(f.db.batch([header(id),f.db.prepare('INSERT INTO commerce_campaign_performance_export_rows VALUES (?,?,?,?)').bind(id,2,row.publication_id,row.cells_json),f.db.prepare("UPDATE commerce_campaign_performance_exports SET state='ready',row_count=1 WHERE id=?").bind(id)]),/campaign_performance_immutable/);assert.equal(await f.count('commerce_campaign_performance_exports'),1);
  await assert.rejects(f.db.prepare('UPDATE commerce_campaign_performance_export_rows SET ordinal=2').run(),/immutable/);
});

test('a corrupted primary capture cannot silently become campaign revenue or an export',async t=>{
  const f=await fixture(t),visit=await f.visit(),order=await f.checkout(visit.visit);await f.paid(order);const r=await report(f);assert.equal(r.status,200);
  await assert.rejects(f.db.prepare('UPDATE commerce_payment_captures SET amount=amount+1 WHERE order_id=?').bind(order.id).run(),/immutable/);
  const guard=await f.db.prepare("SELECT sql FROM sqlite_master WHERE name='commerce_captures_no_update'").first();await f.db.prepare('DROP TRIGGER commerce_captures_no_update').run();await f.db.prepare('UPDATE commerce_payment_captures SET amount=amount+1 WHERE order_id=?').bind(order.id).run();await f.db.prepare(guard.sql).run();
  assert.equal((await report(f)).status,503);assert.equal((await create(f,intent(r))).status,503);assert.equal(await f.count('commerce_campaign_performance_exports'),0);
});

test('performance export limits, retention and populated migration preserve existing report snapshots',async t=>{
  const f=await fixture(t,{through:39}),delivery=await f.merchant(base+'/reports'),old=await f.merchant(base+'/report-exports',intent(delivery),{method:'POST'}),before=await f.merchant(base+'/report-exports/'+old.export.id);
  const tables=(await f.db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' AND substr(name,1,4)!='_cf_' ORDER BY name").all()).results.map(r=>r.name),records=await Promise.all(tables.map(name=>f.db.prepare('SELECT * FROM '+name+' ORDER BY rowid').all()));
  await applyCommerceSchema(f.db,39,40);for(let n=0;n<tables.length;n++)assert.deepEqual((await f.db.prepare('SELECT * FROM '+tables[n]+' ORDER BY rowid').all()).results,records[n].results,tables[n]);assert.deepEqual(await f.merchant(base+'/report-exports/'+old.export.id),before);
  const r=await report(f),original=intent(r),first=await create(f,original);assert.equal(first.status,200,JSON.stringify(first));for(let n=1;n<20;n++)assert.equal((await create(f,intent(r))).status,200);assert.equal((await create(f,intent(r))).status,429);assert.equal((await create(f,original)).replayed,true);
  const guard=await f.db.prepare("SELECT sql FROM sqlite_master WHERE name='commerce_campaign_performance_finalize'").first();await f.db.prepare('DROP TRIGGER commerce_campaign_performance_finalize').run();await f.db.prepare("UPDATE commerce_campaign_performance_exports SET publication_cutoff='2000-01-01T00:00:00.000Z',created_at='2000-01-01T00:00:00.000Z',expires_at='2000-01-02T00:00:00.000Z'").run();await f.db.prepare(guard.sql).run();
  assert.equal((await page(f,first.export.id)).status,410);await cleanupCampaignPerformanceExports(f.env);assert.equal(await f.count('commerce_campaign_performance_export_rows'),0);assert.equal(await f.count('commerce_campaign_performance_exports'),0);assert.equal(await f.count('commerce_campaign_report_exports'),1);
});
