import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {mkdir,readFile} from 'node:fs/promises';
import {setupCentralFixture} from './central-fixture.mjs';
import {browser,pageFor,choose} from './review-workspace-fixture.mjs';
import {publicationFixtureOn,publicationKey as key} from '../../cloudflare/ezkart-api/test/campaign-publication-fixture.mjs';
import {campaignMailConfiguration} from '../../cloudflare/ezkart-api/test/campaign-email-fixture.mjs';
import {prepareAttributionCampaign} from '../../cloudflare/ezkart-api/test/campaign-attribution-fixture.mjs';
import {performanceJourney} from '../../cloudflare/ezkart-api/test/campaign-performance-fixture.mjs';
import {historicalCampaign} from '../../cloudflare/ezkart-api/test/campaign-report-fixture.mjs';
import {fixtureShipping} from '../../cloudflare/ezkart-api/test/commerce-fixture.mjs';
import {dispatchCampaignEmails} from '../../cloudflare/ezkart-api/src/campaign-email-delivery.js';
const base='/v1/commerce/marketing',screens='/tmp/ezkart-campaign-performance-ui-01a0d643',storage='ezkart.marketing.performance.v1:alice:seller_alice:sandbox';
const panel=p=>p.locator('[data-campaign-performance]'),cloud=r=>new URL(r.url()).searchParams.get('cloud'),writes=f=>f.control.calls.filter(c=>c.path===base+'/performance-exports'&&c.body),saved=p=>p.evaluate(k=>JSON.parse(sessionStorage.getItem(k)),storage);
async function fixture(t,{history=0}={}){
  const bindings={...campaignMailConfiguration(),COMMERCE_EMAIL_TEST_RECIPIENTS:'["buyer1@example.test"]'},f=await publicationFixtureOn(await setupCentralFixture(t,{}, {bindings}),bindings),campaign=await prepareAttributionCampaign(f);
  const sent=await dispatchCampaignEmails(f.env,2,async url=>url.includes('/auth/v1/admin/users/')?Response.json({id:'campaign-buyer-1',email:'buyer1@example.test',email_confirmed_at:'2026-09-01T00:00:00Z'}):Response.json({id:randomUUID()}));assert.equal(sent.processed,1);assert.equal(await f.count('commerce_campaign_email_starts'),1);
  for(let n=1;n<=history;n++)await historicalCampaign(f,'2026-09-'+String(n).padStart(2,'0')+'T12:00:00.000Z',{values:{...f.values,name:n===1?'=SUM(1,2)':'History '+n,subject:n===1?'\u200b＋1 formula subject':f.values.subject}});
  const journey=await performanceJourney(f,campaign),visit=await journey.visit(),other=await journey.visit(),order=await journey.checkout(visit.visit,{shipping:fixtureShipping});await journey.checkout(other.visit);assert.equal((await f.paid(order)).status,200);assert.equal((await f.paid(order,{reference:'additional_'+order.id})).status,200);
  const cookie=f.app.adminCookie({supabase_access_token:await f.merchantToken('alice','alice@example.test'),admin_user:{id:'alice',email:'alice@example.test'}});return {...journey,order,cookie};
}
async function open(p,f){await p.goto(f.app.base+'/cart/admin/?page=marketing&campaign-report=performance');await panel(p).locator('[data-report-content]').waitFor({state:'visible'});}
async function download(p,label='Export complete CSV'){const [file]=await Promise.all([p.waitForEvent('download'),panel(p).getByRole('button',{name:label,exact:true}).click()]);return {file,text:await readFile(await file.path(),'utf8')};}

test('desktop and mobile performance reports show verified sales, honest conversion and complete immutable CSVs',async t=>{
  await mkdir(screens,{recursive:true});const b=await browser(t);
  for(const width of [1360,390])await t.test(String(width),async t=>{
    const f=await fixture(t,{history:1}),p=await pageFor(b,f,width),errors=[];p.on('pageerror',e=>errors.push(e.message));await open(p,f);
    assert.equal(await panel(p).locator('[data-report-metric=visits] strong').textContent(),'2');assert.equal(await panel(p).locator('[data-report-metric=paidOrders] strong').textContent(),'1');assert.equal(await panel(p).locator('[data-report-metric=conversion] strong').textContent(),'50.00%');assert.match(await panel(p).locator('[data-report-metric=productPaid] strong').textContent(),/20[.]000/);
    await panel(p).getByText('All performance totals and measurement details',{exact:true}).click();assert.match(await panel(p).locator('[data-report-metric=additionalPaid] strong').textContent(),/38[.]000/);assert.match(await panel(p).locator('[data-report-metric=shippingPaid] strong').textContent(),/18[.]000/);assert.match(await panel(p).textContent(),/not settled or withdrawable/);
    await panel(p).getByText('Conversion by publication date',{exact:true}).click();await panel(p).locator('[data-report-series] li').first().waitFor();await panel(p).getByRole('heading',{name:'Campaign performance',exact:true}).evaluate(node=>window.scrollTo(0,node.getBoundingClientRect().top+scrollY-95));await p.screenshot({path:screens+'/performance-'+width+'.png'});assert.equal(await p.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
    const csv=await download(p);assert.match(csv.file.suggestedFilename(),/^ezkart-campaign-performance-/);assert(csv.text.includes('"50.00"'));assert(csv.text.includes('"38000","20000","18000","38000"'));assert(csv.text.includes('"\'=SUM(1,2)"'));assert(csv.text.includes('"\'\u200b＋1 formula subject"'));assert(!csv.text.includes(f.order.id));assert(!csv.text.includes('buyer1@example.test'));assert.equal(writes(f).length,1);
    await p.reload();await panel(p).getByRole('button',{name:'Download saved CSV again',exact:true}).waitFor();assert.equal((await download(p,'Download saved CSV again')).text,csv.text);
    await choose(p,p.locator('[data-marketing]'),'campaignReport','Delivery and permissions');assert.equal(await panel(p).isVisible(),false);await p.locator('[data-campaign-reports] [data-report-content]').waitFor({state:'visible'});assert.equal(await p.locator('[data-campaign-reports] [data-report-metric=submitted] strong').textContent(),'1');
    await choose(p,p.locator('[data-marketing]'),'campaignReport','Visits and verified payments');assert.equal((await download(p,'Download saved CSV again')).text,csv.text);assert.equal(writes(f).length,1);await panel(p).locator('[data-report-table]').evaluate(node=>window.scrollTo(0,node.getBoundingClientRect().top+scrollY-95));await p.screenshot({path:screens+'/table-'+width+'.png'});assert.deepEqual(errors,[]);await p.context().close();
  });
});

test('lost performance export acknowledgements recover the original snapshot after reload, report switching and changed filters',async t=>{
  const f=await fixture(t),b=await browser(t),p=await pageFor(b,f,390);await open(p,f);f.control.drop=base+'/performance-exports';await panel(p).getByRole('button',{name:'Export complete CSV',exact:true}).click();await panel(p).getByText('The result was not confirmed. Retry the original export. No partial file was saved.',{exact:true}).waitFor();const original=writes(f)[0].body;assert.equal((await saved(p)).receipt,null);
  await p.reload();await panel(p).getByRole('button',{name:'Retry original export',exact:true}).waitFor();await choose(p,panel(p),'range','All history');await panel(p).getByRole('button',{name:'Apply report dates',exact:true}).click();await panel(p).getByText('All available publication history.',{exact:false}).waitFor();const csv=await download(p,'Retry original export');assert.deepEqual(writes(f).at(-1).body,original);assert.equal(await f.count('commerce_campaign_performance_exports'),1);
  await choose(p,p.locator('[data-marketing]'),'campaignReport','Delivery and permissions');await p.locator('[data-campaign-reports] [data-report-content]').waitFor({state:'visible'});const [delivery]=await Promise.all([p.waitForEvent('download'),p.locator('[data-campaign-reports] [data-report-export]').click()]);assert.match(delivery.suggestedFilename(),/^ezkart-campaign-delivery-/);assert.equal(await f.count('commerce_campaign_report_exports'),1);
  await choose(p,p.locator('[data-marketing]'),'campaignReport','Visits and verified payments');assert.equal((await download(p,'Download saved CSV again')).text,csv.text);await download(p,'Create a fresh export');assert.notEqual(writes(f).at(-1).body.requestKey,original.requestKey);assert.equal(await f.count('commerce_campaign_performance_exports'),2);
});

test('partial or altered performance exports never download and recover every row with original metadata',async t=>{
  const f=await fixture(t,{history:2}),b=await browser(t),p=await pageFor(b,f),downloads=[];p.on('download',d=>downloads.push(d));let broken=true,badMoney=false;
  await p.route('**/cart/admin/?cloud=*',async route=>{const path=cloud(route.request());if(path?.startsWith(base+'/performance-exports/')){
    if(broken&&path.includes('after=1&'))return route.fulfill({status:503,json:{ok:false,error:'Fixture interrupted performance page'}});
    const u=new URL(route.request().url());u.searchParams.set('cloud',path.replace('limit=250','limit=1'));
    if(badMoney){const response=await route.fetch({url:u.href}),data=await response.json();data.rows[0].cells[15]=20000;return route.fulfill({response,json:data});}
    return route.continue({url:u.href});}await route.continue();});
  await open(p,f);await panel(p).getByRole('button',{name:'Export complete CSV',exact:true}).click();await panel(p).getByText('Fixture interrupted performance page No partial file was saved.',{exact:true}).waitFor();assert.equal(downloads.length,0);const id=(await saved(p)).receipt.id;
  broken=false;badMoney=true;await panel(p).getByRole('button',{name:'Retry original export',exact:true}).click();await panel(p).getByText('The export page could not be verified. Retry the original export. No partial file was saved.',{exact:true}).waitFor();assert.equal(downloads.length,0);
  await p.reload();await panel(p).getByRole('button',{name:'Retry original export',exact:true}).waitFor();badMoney=false;const csv=await download(p,'Retry original export');assert.equal((csv.text.match(/"cpub_[a-f0-9]{32}"/g)||[]).length,3);assert.equal((await saved(p)).receipt.id,id);assert.equal(writes(f).length,1);
});

test('performance storage failures and tampered receipts retain recovery data and prevent a new ambiguous export',async t=>{
  const f=await fixture(t),b=await browser(t),p=await pageFor(b,f);await open(p,f);
  await p.evaluate(()=>{const original=Storage.prototype.setItem;window.restoreStorage=()=>{Storage.prototype.setItem=original;};Storage.prototype.setItem=function(k,v){if(k.startsWith('ezkart.marketing.performance.'))throw Error('Fixture denied storage');return original.call(this,k,v);};});
  await panel(p).getByRole('button',{name:'Export complete CSV',exact:true}).click();await panel(p).getByRole('button',{name:'Retry browser storage',exact:true}).waitFor();assert.equal(writes(f).length,0);await p.evaluate(()=>window.restoreStorage());await panel(p).getByRole('button',{name:'Retry browser storage',exact:true}).click();
  let wrong=true;await p.route('**/cart/admin/?cloud=*',async route=>{if(wrong&&cloud(route.request())===base+'/performance-exports'){const response=await route.fetch(),data=await response.json();data.export.filename=data.export.filename.replace('performance','delivery');return route.fulfill({response,json:data});}await route.continue();});
  await panel(p).getByRole('button',{name:'Retry original export',exact:true}).click();await panel(p).getByText('The export receipt could not be verified. Retry the original export. No partial file was saved.',{exact:true}).waitFor();const original=writes(f)[0].body;wrong=false;await download(p,'Retry original export');assert.deepEqual(writes(f).at(-1).body,original);
  await p.evaluate(k=>sessionStorage.setItem(k,'{"corrupt":"retain"}'),storage);await p.reload();await panel(p).getByRole('button',{name:'Retry browser storage',exact:true}).waitFor();assert.equal(await panel(p).getByRole('button',{name:'Export complete CSV',exact:true}).isDisabled(),true);assert.equal(await p.evaluate(k=>sessionStorage.getItem(k),storage),'{"corrupt":"retain"}');
});

test('performance pagination retains prior rows on failure and exposes measurement limits without clipping mobile controls',async t=>{
  const f=await fixture(t,{history:21}),b=await browser(t),p=await pageFor(b,f,390);await open(p,f);assert.equal(await panel(p).locator('tbody tr').count(),20);let fail=true;
  await p.route('**/cart/admin/?cloud=*',async route=>{const path=cloud(route.request());if(fail&&path?.startsWith(base+'/performance?')&&path.includes('cursor=')){fail=false;return route.fulfill({status:503,json:{ok:false,error:'Performance page interrupted'}});}await route.continue();});
  await panel(p).getByRole('button',{name:'Load more report campaigns',exact:true}).click();await panel(p).getByText('Performance page interrupted',{exact:true}).waitFor();assert.equal(await panel(p).locator('tbody tr').count(),20);await panel(p).getByRole('button',{name:'Try report again',exact:true}).click();await panel(p).getByText('22 of 22 campaigns shown.',{exact:true}).waitFor();
  const bucket=await f.db.prepare('SELECT * FROM commerce_campaign_visit_buckets').first();await f.db.prepare('UPDATE commerce_campaign_visit_buckets SET limited=limited+1 WHERE publication_id=? AND bucket=?').bind(bucket.publication_id,bucket.bucket).run();await panel(p).getByRole('button',{name:'Refresh report',exact:true}).click();await panel(p).getByText('1 visit could not be measured',{exact:false}).waitFor();assert.equal(await panel(p).locator('[data-report-metric=conversion] strong').textContent(),'50.00%');await panel(p).getByRole('heading',{name:'Campaign performance',exact:true}).evaluate(node=>window.scrollTo(0,node.getBoundingClientRect().top+scrollY-95));await p.screenshot({path:screens+'/limited-390.png'});assert.equal(await p.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
});

test('performance PHP proxy validates scope, methods and parameters; revoked membership masks both report views',async t=>{
  const f=await fixture(t),b=await browser(t),p=await pageFor(b,f);await open(p,f);const csrf=await p.evaluate(()=>document.body.dataset.adminCsrfToken),headers={Cookie:f.cookie.name+'='+f.cookie.value,'X-Ezkart-CSRF':csrf,'X-Ezkart-Marketing-Account':'alice','X-Ezkart-Marketing-Store':'seller_alice'},proxy=path=>'/cart/admin/?cloud='+encodeURIComponent(base+path);
  assert.equal((await f.app.request(proxy('/performance'))).status,401);assert.equal((await f.app.request(proxy('/performance'),undefined,headers)).status,200);
  for(const suffix of ['?cohort=','?range=7&range=30','?environment=production','?range=7#fragment'])assert.equal((await f.app.request(proxy('/performance'+suffix),undefined,headers)).status,400);
  assert.equal((await f.app.request(proxy('/performance'),{},headers)).status,405);assert.equal((await f.app.request(proxy('/performance-exports'),undefined,headers)).status,405);assert.equal((await f.app.request(proxy('/performance-exports/crex_'+'0'.repeat(32)),undefined,headers)).status,400);
  await f.db.prepare("DELETE FROM seller_memberships WHERE auth_user_id='alice'").run();await panel(p).getByRole('button',{name:'Refresh report',exact:true}).click();await p.locator('[data-marketing]').getByRole('link',{name:'Reload sign-in',exact:true}).waitFor();assert.equal(await p.locator('[data-campaign-performance],[data-campaign-reports]').count(),0);
});
