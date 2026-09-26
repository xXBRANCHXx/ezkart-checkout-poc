import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdir,readFile} from 'node:fs/promises';
import {setupCentralFixture} from './central-fixture.mjs';
import {browser,pageFor,choose} from './review-workspace-fixture.mjs';
import {campaignMailConfiguration} from '../../cloudflare/ezkart-api/test/campaign-email-fixture.mjs';
import {publicationFixtureOn,publicationKey as key,publicationBase} from '../../cloudflare/ezkart-api/test/campaign-publication-fixture.mjs';
import {historicalCampaign} from '../../cloudflare/ezkart-api/test/campaign-report-fixture.mjs';
const base='/v1/commerce/marketing',screens='/tmp/ezkart-campaign-reports-ui-01a0d643',root=p=>p.locator('[data-marketing]'),panel=p=>p.locator('[data-campaign-reports]');
const storage='ezkart.marketing.reports.v1:alice:seller_alice:sandbox';
async function fixture(t,{published=true}={}){
  const bindings=campaignMailConfiguration(),f=await publicationFixtureOn(await setupCentralFixture(t,{}, {bindings}),bindings),cookie=f.app.adminCookie({supabase_access_token:await f.merchantToken('alice','alice@example.test'),admin_user:{id:'alice',email:'alice@example.test'}});
  if(published){await f.addBuyer(1);assert.equal((await f.publish()).status,200);}return {...f,cookie};
}
async function open(p,f){await p.goto(f.app.base+'/cart/admin/?page=marketing');await root(p).getByText('Drafts and your planning calendar are ready.',{exact:true}).waitFor();await panel(p).locator('[data-report-content]').waitFor({state:'visible'});}
const cloud=r=>new URL(r.url()).searchParams.get('cloud'),exportWrites=f=>f.control.calls.filter(c=>c.path===base+'/report-exports'&&c.body);
const saved=p=>p.evaluate(k=>JSON.parse(sessionStorage.getItem(k)),storage);
async function download(p,label='Export complete CSV'){
  const [file]=await Promise.all([p.waitForEvent('download'),panel(p).getByRole('button',{name:label,exact:true}).click()]);return {file,text:await readFile(await file.path(),'utf8')};
}

test('campaign reports use real publication periods, comparisons and complete CSVs at desktop and phone widths',async t=>{
  await mkdir(screens,{recursive:true});const b=await browser(t);
  for(const width of [1360,390])await t.test(String(width),async t=>{
    const f=await fixture(t),a=await historicalCampaign(f,'2026-08-11T01:00:00.000Z',{values:{...f.values,name:'=SUM(1,2)',subject:'\u200b＋1 formula-like subject'}});await historicalCampaign(f,'2026-08-10T01:00:00.000Z');
    assert.equal((await f.merchant(publicationBase,{id:a.campaignId,revision:1,requestKey:key(),values:{...f.values,name:'Later draft copy',archived:true}},{method:'POST'})).status,200);
    const p=await pageFor(b,f,width),errors=[];p.on('pageerror',e=>errors.push(e.message));await open(p,f);
    await choose(p,panel(p),'range','Custom dates');await panel(p).getByLabel('Published from',{exact:true}).fill('2026-08-11');await panel(p).getByLabel('Published through',{exact:true}).fill('2026-08-11');assert.equal(await panel(p).getByRole('button',{name:'Export complete CSV',exact:true}).isDisabled(),true);
    await panel(p).getByRole('button',{name:'Apply report dates',exact:true}).click();await panel(p).getByText('Comparison: 2026-08-10 to 2026-08-10.',{exact:false}).waitFor();await panel(p).getByRole('button',{name:'Open campaign =SUM(1,2)',exact:true}).waitFor();
    assert.equal(await panel(p).locator('[data-report-metric=delivered] strong').textContent(),'0');assert.equal(await panel(p).locator('[data-report-metric=delivered] small').textContent(),'0 vs previous (0)');
    await panel(p).getByText('All delivery and permission totals',{exact:true}).click();assert.equal(await panel(p).locator('[data-report-metric=queued] strong').textContent(),'1');await panel(p).getByText('Delivery by publication date',{exact:true}).click();await panel(p).locator('[data-report-series] li').waitFor();
    await panel(p).getByRole('heading',{name:'Campaign reports',exact:true}).scrollIntoViewIfNeeded();await p.screenshot({path:screens+'/report-'+width+'.png'});assert.equal(await p.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
    const csv=await download(p);assert(csv.text.includes('"Publication dates (Asia/Jakarta)","2026-08-11","2026-08-11"'));assert(csv.text.includes('"\'=SUM(1,2)"'));assert(csv.text.includes('"\'\u200b＋1 formula-like subject"'));assert(!csv.text.includes('buyer1@example.test'));assert.equal(csv.file.suggestedFilename(),'ezkart-campaign-delivery-2026-08-11-2026-08-11.csv');
    await panel(p).getByText('Downloaded all 1 campaign. This saved snapshot is available for 24 hours.',{exact:true}).waitFor();assert.equal(exportWrites(f).length,1);
    await p.reload();await panel(p).getByRole('button',{name:'Download saved CSV again',exact:true}).waitFor();const second=await download(p,'Download saved CSV again');assert.equal(second.text,csv.text);assert.equal(exportWrites(f).length,1);
    await choose(p,panel(p),'range','All history');await panel(p).getByRole('button',{name:'Apply report dates',exact:true}).click();await panel(p).getByRole('button',{name:'Open campaign =SUM(1,2)',exact:true}).click();await root(p).locator('[data-marketing-form] input[name=name]').waitFor({state:'visible'});assert.equal(await root(p).locator('[data-marketing-form] input[name=name]').inputValue(),'Later draft copy');
    assert.deepEqual(errors,[]);await p.context().close();
  });
});

test('an export with a lost acknowledgement survives reload and changing filters with the same exact request',async t=>{
  const f=await fixture(t),b=await browser(t),p=await pageFor(b,f,390);await open(p,f);f.control.drop=base+'/report-exports';await panel(p).getByRole('button',{name:'Export complete CSV',exact:true}).click();
  await panel(p).getByText('The result was not confirmed. Retry the original export. No partial file was saved.',{exact:true}).waitFor();const original=exportWrites(f)[0].body,record=await saved(p);assert.deepEqual(record.request,original);assert.equal(record.receipt,null);assert.equal(await f.count('commerce_campaign_report_exports'),1);
  await p.reload();await panel(p).getByRole('button',{name:'Retry original export',exact:true}).waitFor();await choose(p,panel(p),'range','All history');await panel(p).getByRole('button',{name:'Apply report dates',exact:true}).click();await panel(p).getByText('All available publication history.',{exact:false}).waitFor();
  const recovered=await download(p,'Retry original export');assert(recovered.text.includes('"Publication dates (Asia/Jakarta)"'));assert.deepEqual(exportWrites(f).at(-1).body,original);assert.equal(await f.count('commerce_campaign_report_exports'),1);assert.equal((await saved(p)).complete,true);
  await p.screenshot({path:screens+'/recovered-390.png',fullPage:true});
  await download(p,'Create a fresh export');assert.notEqual(exportWrites(f).at(-1).body.requestKey,original.requestKey);assert.equal(await f.count('commerce_campaign_report_exports'),2);
});

test('incomplete export pages never download a partial file; recovery reads every page from the original snapshot',async t=>{
  const f=await fixture(t);await historicalCampaign(f,'2026-09-24T00:00:00.000Z');await historicalCampaign(f,'2026-09-25T00:00:00.000Z');const b=await browser(t),p=await pageFor(b,f);let downloads=0,breakPage=true;p.on('download',()=>downloads++);
  await p.route('**/cart/admin/?cloud=*',async route=>{
    const path=cloud(route.request());if(path?.startsWith(base+'/report-exports/')){
      if(breakPage&&path.includes('after=1&')){await route.fulfill({status:503,json:{ok:false,error:'Fixture interrupted second page'}});return;}
      const u=new URL(route.request().url());u.searchParams.set('cloud',path.replace('limit=250','limit=1'));await route.continue({url:u.href});return;
    }await route.continue();
  });
  await open(p,f);await panel(p).getByRole('button',{name:'Export complete CSV',exact:true}).click();await panel(p).getByText('Fixture interrupted second page No partial file was saved.',{exact:true}).waitFor();assert.equal(downloads,0);assert.equal(exportWrites(f).length,1);
  const id=(await saved(p)).receipt.id;await p.reload();await panel(p).getByRole('button',{name:'Retry original export',exact:true}).waitFor();breakPage=false;const csv=await download(p,'Retry original export');assert.equal((csv.text.match(/"cpub_[a-f0-9]{32}"/g)||[]).length,3);assert.equal((await saved(p)).receipt.id,id);assert.equal(exportWrites(f).length,1);assert.equal(downloads,1);
});

test('mismatched receipts remain unresolved and malformed pages cannot be accepted as a complete export',async t=>{
  const f=await fixture(t),b=await browser(t),p=await pageFor(b,f);let wrong=true,badPage=false,downloads=0;p.on('download',()=>downloads++);
  await p.route('**/cart/admin/?cloud=*',async route=>{
    const path=cloud(route.request());if(path===base+'/report-exports'&&wrong){const response=await route.fetch(),data=await response.json();data.export.requestKey='f'.repeat(32);await route.fulfill({response,json:data});return;}
    if(path?.startsWith(base+'/report-exports/')&&badPage){const response=await route.fetch(),data=await response.json();data.rows[0].cells.pop();await route.fulfill({response,json:data});return;}await route.continue();
  });
  await open(p,f);await panel(p).getByRole('button',{name:'Export complete CSV',exact:true}).click();await panel(p).getByText('The export receipt could not be verified. Retry the original export. No partial file was saved.',{exact:true}).waitFor();const original=exportWrites(f)[0].body;assert.equal((await saved(p)).receipt,null);
  await p.reload();await panel(p).getByRole('button',{name:'Retry original export',exact:true}).waitFor();wrong=false;badPage=true;await panel(p).getByRole('button',{name:'Retry original export',exact:true}).click();await panel(p).getByText('The export page could not be verified. Retry the original export. No partial file was saved.',{exact:true}).waitFor();assert.equal(downloads,0);assert.deepEqual(exportWrites(f).at(-1).body,original);
  badPage=false;await download(p,'Retry original export');assert.equal(downloads,1);assert.equal(await f.count('commerce_campaign_report_exports'),1);
});

test('browser storage failures and corrupted saved references block new exports without deleting recovery data',async t=>{
  const f=await fixture(t),b=await browser(t),p=await pageFor(b,f);await open(p,f);
  await p.evaluate(()=>{const original=Storage.prototype.setItem;window.restoreStorage=()=>{Storage.prototype.setItem=original;};Storage.prototype.setItem=function(k,v){if(k.startsWith('ezkart.marketing.reports.'))throw Error('Fixture denied storage');return original.call(this,k,v);};});
  await panel(p).getByRole('button',{name:'Export complete CSV',exact:true}).click();await panel(p).getByRole('button',{name:'Retry browser storage',exact:true}).waitFor();assert.equal(exportWrites(f).length,0);assert.equal(await panel(p).getByRole('button',{name:'Retry original export',exact:true}).isDisabled(),true);
  await p.evaluate(()=>window.restoreStorage());await panel(p).getByRole('button',{name:'Retry browser storage',exact:true}).click();await download(p,'Retry original export');assert.equal(exportWrites(f).length,1);
  await p.evaluate(k=>sessionStorage.setItem(k,'{"unverified":"retain me"}'),storage);await p.reload();await panel(p).getByRole('button',{name:'Retry browser storage',exact:true}).waitFor();assert.equal(await panel(p).getByRole('button',{name:'Export complete CSV',exact:true}).isDisabled(),true);assert.equal(await p.evaluate(k=>sessionStorage.getItem(k),storage),'{"unverified":"retain me"}');assert.equal(exportWrites(f).length,1);
});

test('expired export responses permit a deliberate fresh snapshot while keeping the original reference until then',async t=>{
  const f=await fixture(t),b=await browser(t),p=await pageFor(b,f);await open(p,f);f.control.drop=base+'/report-exports';await panel(p).getByRole('button',{name:'Export complete CSV',exact:true}).click();await panel(p).getByRole('button',{name:'Retry original export',exact:true}).waitFor();const original=await saved(p);
  let expire=true;await p.route('**/cart/admin/?cloud=*',async route=>{if(expire&&cloud(route.request())===base+'/report-exports'){await route.fulfill({status:410,json:{ok:false,error:'This campaign export has expired. Create a new export.'}});return;}await route.continue();});
  await panel(p).getByRole('button',{name:'Retry original export',exact:true}).click();await panel(p).getByRole('button',{name:'Saved export expired',exact:true}).waitFor();assert.deepEqual((await saved(p)).request,original.request);assert.equal(await f.count('commerce_campaign_report_exports'),1);
  await p.reload();await panel(p).getByRole('button',{name:'Create a fresh export',exact:true}).waitFor();expire=false;await download(p,'Create a fresh export');assert.notEqual((await saved(p)).request.requestKey,original.request.requestKey);
});

test('report page failures retain prior rows, and stale responses cannot replace a newly selected period',async t=>{
  const f=await fixture(t);for(let n=1;n<=21;n++)await historicalCampaign(f,'2026-09-'+String(n).padStart(2,'0')+'T00:00:00.000Z');const b=await browser(t),p=await pageFor(b,f);await open(p,f);assert.equal(await panel(p).locator('tbody tr').count(),20);
  let fail=true;await p.route('**/cart/admin/?cloud=*',async route=>{const path=cloud(route.request());if(fail&&path?.startsWith(base+'/reports?')&&path.includes('cursor=')){fail=false;await route.fulfill({status:503,json:{ok:false,error:'Report page interrupted'}});return;}await route.continue();});
  await panel(p).getByRole('button',{name:'Load more report campaigns',exact:true}).click();await panel(p).getByText('Report page interrupted',{exact:true}).waitFor();assert.equal(await panel(p).locator('tbody tr').count(),20);await panel(p).getByRole('button',{name:'Try report again',exact:true}).click();await panel(p).getByText('22 of 22 campaigns shown.',{exact:true}).waitFor();
  let release,entered;const blocked=new Promise(r=>{release=r;}),started=new Promise(r=>{entered=r;});await p.route('**/cart/admin/?cloud=*',async route=>{const path=cloud(route.request());if(path===base+'/reports?range=7'){const response=await route.fetch();entered();await blocked;await route.fulfill({response});return;}await route.continue();});
  await choose(p,panel(p),'range','Last 7 days');await panel(p).getByRole('button',{name:'Apply report dates',exact:true}).click();await started;await choose(p,panel(p),'range','All history');await panel(p).getByRole('button',{name:'Apply report dates',exact:true}).click();await panel(p).getByText('All available publication history.',{exact:false}).waitFor();const arrived=p.waitForResponse(r=>cloud(r.request())===base+'/reports?range=7');release();await arrived;await p.waitForTimeout(30);assert.match(await panel(p).locator('[data-report-observed]').textContent(),/All available/);assert.equal(await panel(p).locator('select[name=range]').inputValue(),'all');
});

test('the PHP report proxy enforces strict paths, CSRF and account binding, and hides a receipt after sign-in changes',async t=>{
  const f=await fixture(t),b=await browser(t),p=await pageFor(b,f);await open(p,f);const csrf=await p.locator('body').getAttribute('data-admin-csrf-token');
  const headers={Cookie:f.cookie.name+'='+f.cookie.value,'X-Ezkart-CSRF':csrf,'X-Ezkart-Marketing-Account':'alice','X-Ezkart-Marketing-Store':'seller_alice'},path=s=>'/cart/admin/?cloud='+encodeURIComponent(base+s);
  for(const target of ['/reports?range=30&range=7','/reports?cohort=','/reports?after=1','/reports/cmp_'+'a'.repeat(32),'/report-exports/cmp_'+'a'.repeat(32),'/report-exports/crex_'+'a'.repeat(32)+'/history','/report-exports/crex_'+'a'.repeat(32)+'?limit=501'])assert.equal((await f.app.request(path(target),undefined,headers)).status,400,target);
  const r=await f.merchant(base+'/reports'),body={cohort:r.cohort,requestKey:key()};assert.equal((await f.app.request(path('/report-exports'),body,{...headers,'X-Ezkart-CSRF':'wrong'})).status,403);assert.equal((await f.app.request(path('/report-exports'),body,{...headers,Origin:'https://other.test'})).status,403);
  assert.equal((await f.app.request(path('/reports'),undefined,{...headers,'X-Ezkart-Marketing-Store':'seller_bob'})).status,409);
  f.control.afterResponse=async path=>{if(path!==base+'/report-exports')return;f.control.afterResponse=null;f.app.cli(`define('EZ_CUSTOMER_SESSION_BRIDGE', true); session_id('${f.cookie.value}'); require '${process.cwd()}/cart/admin/index.php'; $_SESSION['admin_user']=['id'=>'bob','email'=>'bob@example.test']; $_SESSION['csrf_token']='changed'; session_write_close();`);};
  let downloads=0;p.on('download',()=>downloads++);await panel(p).getByRole('button',{name:'Export complete CSV',exact:true}).click();await root(p).getByRole('link',{name:'Reload sign-in',exact:true}).waitFor();assert.equal(await root(p).locator('table,input,select').count(),0);assert.equal(downloads,0);assert.equal(await f.count('commerce_campaign_report_exports'),1);assert.equal((await saved(p)).receipt,null);
});
