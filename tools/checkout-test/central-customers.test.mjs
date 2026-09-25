import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile,mkdir} from 'node:fs/promises';
import {setupCentralFixture} from './central-fixture.mjs';
import {randomBytes} from 'node:crypto';

const base='/v1/commerce/customers',screens='/tmp/ezkart-central-customers-ui-01a0d643';
const loaded=page=>page.waitForFunction(()=>document.querySelector('[data-customers-count]')?.textContent.includes('matching customers'));
const detailLoaded=page=>page.waitForFunction(()=>document.querySelector('[data-customers-detail-content]')?.textContent.includes('Purchase history'));
const saved=page=>page.waitForFunction(()=>document.querySelector('[data-customers-detail-status]')?.textContent.startsWith('Saved.'));
const ids=page=>page.locator('[data-customer-open]').evaluateAll(es=>es.map(e=>e.dataset.customerOpen));
async function fixture(t,count=28,overrides={}){
  const f=await setupCentralFixture(t,overrides);await f.db.prepare("UPDATE products SET stock_quantity=1000 WHERE id='tea'").run();
  const orders=[];
  for(let n=0;n<count;n++){
    const r=await f.create(f.input({customer:{name:n===0?'Buyer <img src=x onerror=alert(1)>':n===1?'=HYPERLINK("unsafe")':'Buyer '+n,email:'buyer'+n+'@example.test',phone:'081234567890'}}));assert.equal(r.status,200,r.error);orders.push(r.order);
    if(n<2)assert.equal((await f.paid(r.order)).status,200);
  }
  const cookie=f.app.adminCookie({supabase_access_token:await f.merchantToken('alice','alice@example.test'),admin_user:{id:'alice',email:'alice@example.test'}}),customers=(await f.merchant(base+'?limit=50')).items;
  return {...f,orders,cookie,customers};
}
async function browser(t){const {chromium}=await import('../builder-mcp/node_modules/playwright/index.mjs'),b=await chromium.launch({headless:true});t.after(()=>b.close());return b;}
async function pageFor(b,f,width=1360){const context=await b.newContext({viewport:{width,height:940},reducedMotion:'reduce',acceptDownloads:true});await context.addCookies([f.cookie]);return context.newPage();}
async function openFirst(page,f){await page.goto(f.app.base+'/cart/admin/?page=customers&q=buyer0%40example.test');await loaded(page);await page.locator('[data-customer-open]').click();await detailLoaded(page);}

test('customer directory and profiles page through real records, save notes and manage segments on desktop/mobile',async t=>{
  const f=await fixture(t),b=await browser(t);await mkdir(screens,{recursive:true});
  for(const width of [1360,390]){
    const page=await pageFor(b,f,width),errors=[];page.on('pageerror',error=>errors.push(error.message));let failNext=false;
    await page.route('**/cart/admin/?cloud=*',async route=>{const path=new URL(route.request().url()).searchParams.get('cloud');if(failNext&&path?.startsWith(base+'?')&&path.includes('cursor=')){failNext=false;await route.fulfill({status:503,json:{ok:false,error:'Read interrupted'}});return;}await route.continue();});
    await page.goto(f.app.base+'/cart/admin/?page=customers');await loaded(page);assert.equal(await page.locator('[data-customers-total=customers]').textContent(),'28');assert.equal(await page.locator('[data-customers-rows] tr').count(),25);
    await page.screenshot({path:screens+'/customers-'+width+'.png'});const first=await ids(page);await page.locator('input[name=q]').fill('unapplied');failNext=true;
    await page.locator('[data-customers-next]').click();await page.waitForFunction(()=>document.querySelector('[data-customers-list-status]').textContent.includes('Read interrupted'));assert.deepEqual(await ids(page),first);
    await page.locator('[data-customers-next]').click();await page.waitForFunction(()=>document.querySelectorAll('[data-customers-rows] tr').length===3);const second=await ids(page);assert.equal(new Set([...first,...second]).size,28);
    await page.reload();await loaded(page);assert.deepEqual(await ids(page),second);assert.equal(new URL(page.url()).searchParams.has('q'),false);
    await page.locator('[data-customers-previous]').click();await page.waitForFunction(()=>document.querySelectorAll('[data-customers-rows] tr').length===25);assert.deepEqual(await ids(page),first);
    await page.locator('#global-search').fill('buyer0@example.test');await page.locator('#global-search').press('Enter');await page.waitForFunction(()=>document.querySelectorAll('[data-customers-rows] tr').length===1);
    await page.locator('[data-customer-open]').click();await detailLoaded(page);
    const detail=page.locator('[data-customers-detail-content]');assert.match(await detail.innerText(),/Buyer <img src=x onerror=alert\(1\)>/);assert.equal(await detail.locator('img').count(),0);assert.match(await detail.innerText(),/Marketing consent is not recorded/);
    await detail.locator('textarea[name=note]').fill('Team note <b>text only</b> '+width);await detail.locator('textarea[name=tags]').fill('VIP\nRepeat');await page.getByRole('button',{name:'Save note and tags'}).click();await saved(page);
    await page.reload();await loaded(page);await detailLoaded(page);assert.equal(await detail.locator('textarea[name=note]').inputValue(),'Team note <b>text only</b> '+width);assert.equal(await detail.locator('textarea[name=tags]').inputValue(),'repeat\nvip');
    await page.locator('[data-customer-history=changes] summary').click();await page.waitForFunction(()=>document.querySelectorAll('[data-customer-history=changes] li').length>0);assert.match(await page.locator('[data-customer-history=changes]').innerText(),/You/);
    await page.locator('[data-customers-detail]').evaluate(e=>e.scrollIntoView({block:'start',behavior:'instant'}));await page.screenshot({path:screens+'/customer-profile-'+width+'.png'});
    assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);assert.equal(await page.locator('select[name=activity]').evaluate(e=>CSS.supports('appearance','base-select')||e.closest('.ezkart-select')!==null),true);
    await page.locator('[data-customers-detail-close]').click();await page.locator('input[name=tag]').fill('vip');await page.getByRole('button',{name:'Apply filters',exact:true}).click();await loaded(page);
    await page.locator('[data-customers-create-segment]').click();await page.locator('[data-customers-segment-form] input[name=name]').fill('VIP buyers '+width);await page.getByRole('button',{name:'Save segment',exact:true}).click();
    const segment=page.locator('[data-customer-segment]').filter({has:page.getByRole('heading',{name:'VIP buyers '+width,exact:true})});await segment.waitFor();
    await page.reload();await loaded(page);await segment.waitFor();await segment.getByRole('button',{name:'View customers'}).click();await loaded(page);assert.equal(await page.locator('[data-customers-rows] tr').count(),1);
    await segment.getByRole('button',{name:'Edit segment'}).click();await page.locator('[data-customers-segment-editor]').waitFor({state:'visible'});await page.locator('[data-customers-segment-form] input[name=name]').fill('Saved VIP '+width);
    await page.locator('input[name=minOrders]').fill('1');await page.getByRole('button',{name:'Apply filters',exact:true}).click();await loaded(page);await page.getByRole('button',{name:'Use directory filters',exact:true}).click();assert.match(await page.locator('[data-customers-segment-rules]').textContent(),/Minimum orders: 1/);await page.getByRole('button',{name:'Save segment',exact:true}).click();
    const updated=page.locator('[data-customer-segment]').filter({has:page.getByRole('heading',{name:'Saved VIP '+width,exact:true})});await updated.waitFor();await updated.getByRole('button',{name:'Archive',exact:true}).click();await updated.waitFor({state:'detached'});
    await page.locator('[data-customers-segment-state]').selectOption('archived');await updated.waitFor();await updated.getByRole('button',{name:'Restore',exact:true}).click();await updated.waitFor({state:'detached'});
    await page.locator('[data-customers-segment-state]').selectOption('active');await updated.waitFor();
    await page.locator('[data-customers-clear]').click();await loaded(page);await page.locator('[data-customers-group=no_paid]').click();await loaded(page);assert.match(await page.locator('[data-customers-count]').innerText(),/26 matching/);
    await page.getByRole('link',{name:'Reviews',exact:true}).click();assert.match(await page.locator('.customer-reviews-summary').innerText(),/published reviews/);
    assert.deepEqual(errors,[]);await page.context().close();
  }
  assert.equal((await f.app.calls()).filter(c=>c.url.includes('doku.com')||c.url.includes('biteship.com')).length,0);
});

test('customer exports recover a lost receipt, include every chunk and escape formula-like customer names',async t=>{
  const f=await fixture(t),b=await browser(t),page=await pageFor(b,f);await page.goto(f.app.base+'/cart/admin/?page=customers');await loaded(page);
  f.control.drop=base+'/exports';await page.locator('[data-customers-export]').click();await page.getByRole('button',{name:'Retry customer export',exact:true}).waitFor();assert.equal(await f.count('commerce_customer_exports'),1);
  let chunks=0;await page.route('**/cart/admin/?cloud=*',async route=>{const url=new URL(route.request().url()),cloud=url.searchParams.get('cloud');if(cloud?.includes('/exports/cex_')&&cloud.includes('limit=500')){chunks++;url.searchParams.set('cloud',cloud.replace('limit=500','limit=7'));await route.continue({url:String(url)});}else await route.continue();});
  const download=page.waitForEvent('download');await page.locator('[data-customers-export]').click();const csv=await readFile(await(await download).path(),'utf8');assert.equal((csv.match(/"customer_[a-f0-9-]+"/g)||[]).length,28);assert.equal(chunks,4);assert.match(csv,/"'=HYPERLINK\(""unsafe""\)"/);assert.equal(await f.count('commerce_customer_exports'),1);
  assert.match(await page.locator('[data-customers-export-status]').innerText(),/Downloaded 28/);
  await page.locator('input[name=q]').fill('buyer0@example.test');await page.getByRole('button',{name:'Apply filters',exact:true}).click();await loaded(page);const filtered=page.waitForEvent('download');await page.locator('[data-customers-export]').click();const small=await readFile(await(await filtered).path(),'utf8');assert.equal((small.match(/"customer_[a-f0-9-]+"/g)||[]).length,1);assert.equal(await f.count('commerce_customer_exports'),2);
});

test('two-tab note conflicts keep drafts, explicit reload permits review and a lost save reply does not duplicate changes',async t=>{
  const f=await fixture(t,1),b=await browser(t),a=await pageFor(b,f),other=await pageFor(b,f);await openFirst(a,f);await openFirst(other,f);
  await a.locator('textarea[name=note]').fill('Draft from first tab');await other.locator('textarea[name=note]').fill('Saved by second tab');await other.getByRole('button',{name:'Save note and tags'}).click();await saved(other);
  await a.getByRole('button',{name:'Save note and tags'}).click();await a.waitForFunction(()=>document.querySelector('[data-customer-save-status]').textContent.includes('changed in another session'));assert.equal(await a.locator('textarea[name=note]').inputValue(),'Draft from first tab');
  await a.locator('[data-customers-detail-reload]').click();await detailLoaded(a);assert.equal(await a.locator('textarea[name=note]').inputValue(),'Draft from first tab');assert.match(await a.locator('[data-customers-detail-content]').innerText(),/Saved by second tab/);
  f.control.drop=base+'/'+f.customers[0].id+'/profile';await a.getByRole('button',{name:'Save note and tags'}).click();await a.waitForFunction(()=>document.querySelector('[data-customer-save-status]').textContent.includes('Your draft is kept'));
  assert.equal(await f.count('commerce_customer_changes'),2);await a.getByRole('button',{name:'Save note and tags'}).click();await saved(a);assert.equal(await f.count('commerce_customer_changes'),2);assert.equal(await a.locator('textarea[name=note]').inputValue(),'Draft from first tab');
  await a.locator('[data-customer-history=changes] summary').click();await a.waitForFunction(()=>document.querySelectorAll('[data-customer-history=changes] li').length===2);
});

test('preview excludes legacy data, handles failed reads, preserves navigation and enforces proxy CSRF and viewer permissions',async t=>{
  const f=await fixture(t,1,{EZKART_COMMERCE_STORAGE:'legacy'}),b=await browser(t),page=await pageFor(b,f);
  f.app.cli("ez_save_order(['order_id'=>'EZK-S-AAAAAAAAAAAAAAAAAAAAAAAA','seller_id'=>'seller_alice','status'=>'PAID','customer'=>['name'=>'LEGACY_CUSTOMER_SENTINEL','email'=>'legacy@example.test']]);");
  let fail=true;await page.route('**/cart/admin/?cloud=*',async route=>{const path=new URL(route.request().url()).searchParams.get('cloud');if(fail&&path?.startsWith(base+'?')){await route.fulfill({status:503,json:{ok:false,error:'Customers unavailable'}});return;}await route.continue();});
  await page.goto(f.app.base+'/cart/admin/?page=customers&customer-preview=1');await page.waitForFunction(()=>document.querySelector('[data-customers-list-status]').textContent.includes('Customers unavailable'));assert.equal(await page.locator('[data-customers-total=customers]').textContent(),'—');assert(!(await page.content()).includes('LEGACY_CUSTOMER_SENTINEL'));
  fail=false;await page.locator('[data-customers-refresh]').click();await loaded(page);await page.locator('[data-customer-open]').click();await detailLoaded(page);assert.match(await page.locator('[data-customer-history=orders] a').first().getAttribute('href'),/order-preview=1/);
  assert.match(await page.getByRole('link',{name:'Reviews',exact:true}).getAttribute('href'),/customer-preview=1/);
  const headers={Cookie:f.cookie.name+'='+f.cookie.value},path=base+'/'+f.customers[0].id+'/profile';
  for(const query of ['seller=bob','q=a&q=b','q[]=a','cursor='+('x'.repeat(1001))])assert.equal((await f.app.request('/cart/admin/?cloud='+encodeURIComponent(base+'?'+query),undefined,headers)).status,400);
  assert.equal((await f.app.request('/cart/admin/?cloud='+encodeURIComponent(base+'/segments'),{},headers)).status,403);
  const csrf=await page.evaluate(()=>document.body.dataset.adminCsrfToken);assert.equal((await f.app.request('/cart/admin/?cloud='+encodeURIComponent(base),{},{...headers,'X-Ezkart-Csrf':csrf})).status,405);
  await f.db.prepare("UPDATE seller_memberships SET role='viewer' WHERE auth_user_id='alice'").run();await page.reload();await loaded(page);await detailLoaded(page);
  assert.equal(await page.getByRole('button',{name:'Save note and tags'}).isDisabled(),true);assert.equal(await page.locator('[data-customers-create-segment]').isDisabled(),true);
  assert.equal((await f.merchant(path,{revision:0,requestKey:'a'.repeat(32),note:'Unauthorized',tags:[]})).status,403);
  assert.equal((await fetch(f.app.base+'/cart/admin/commerce-customers.php')).status,404);
});

test('late customer and segment replies cannot replace a newer selection and a changed view cancels the old download',async t=>{
  const f=await fixture(t,2),b=await browser(t),page=await pageFor(b,f),segments=[];
  for(const name of ['First segment','Second segment']){const r=await f.merchant(base+'/segments',{name,filters:{},archived:false,revision:0,requestKey:randomBytes(16).toString('hex')},{method:'POST'});assert.equal(r.status,200,r.error);segments.push(r.change.id);}
  let predicate=null,entered,release;const hold=match=>{predicate=match;return new Promise(r=>entered=r);};
  await page.route('**/cart/admin/?cloud=*',async route=>{const path=new URL(route.request().url()).searchParams.get('cloud');if(predicate?.(path)){predicate=null;entered(path);await new Promise(r=>release=r);}await route.continue();});
  await page.goto(f.app.base+'/cart/admin/?page=customers');await loaded(page);
  const one=f.customers.find(c=>c.email==='buyer0@example.test').id,two=f.customers.find(c=>c.email==='buyer1@example.test').id;
  const waitDetail=hold(p=>p===base+'/'+one);await page.locator(`[data-customer-open="${one}"]`).click();await waitDetail;
  await page.locator(`[data-customer-open="${two}"]`).click();await detailLoaded(page);const arrived=page.waitForResponse(r=>new URL(r.url()).searchParams.get('cloud')===base+'/'+one);release();await(await arrived).finished();assert.equal(await page.locator('[data-customers-reference]').textContent(),two);
  const slow=base+'?'+new URLSearchParams({limit:'25',q:'buyer0@example.test',activity:'all'}),waitList=hold(p=>p===slow);
  await page.locator('input[name=q]').fill('buyer0@example.test');await page.getByRole('button',{name:'Apply filters',exact:true}).click();await waitList;
  await page.locator('input[name=q]').fill('buyer1@example.test');await page.getByRole('button',{name:'Apply filters',exact:true}).click();await loaded(page);
  const stale=page.waitForResponse(r=>new URL(r.url()).searchParams.get('cloud')===slow);release();await(await stale).finished();assert.deepEqual(await ids(page),[two]);
  const waitSegment=hold(p=>p===base+'/segments/'+segments[0]);await page.locator(`[data-customer-segment="${segments[0]}"]`).getByRole('button',{name:'Edit segment'}).click();await waitSegment;
  await page.locator(`[data-customer-segment="${segments[1]}"]`).getByRole('button',{name:'Edit segment'}).click();await page.waitForFunction(()=>document.querySelector('[data-customers-segment-form] input[name=name]').value==='Second segment');
  const old=page.waitForResponse(r=>new URL(r.url()).searchParams.get('cloud')===base+'/segments/'+segments[0]);release();await(await old).finished();assert.equal(await page.locator('[data-customers-segment-form] input[name=name]').inputValue(),'Second segment');await page.locator('[data-customers-segment-cancel]').click();
  let downloads=0;page.on('download',()=>downloads++);const waitExport=hold(p=>p?.includes('/exports/cex_'));await page.locator('[data-customers-export]').click();const chunkPath=await waitExport;
  await page.locator('[data-customers-clear]').click();await loaded(page);const chunk=page.waitForResponse(r=>new URL(r.url()).searchParams.get('cloud')===chunkPath);release();await(await chunk).finished();await page.waitForTimeout(100);assert.equal(downloads,0);assert.equal(await page.locator('[data-customers-export]').textContent(),'Export matching customers');
});

test('large customer values remain exact in mobile cards, profiles and downloaded CSV',async t=>{
  const f=await fixture(t,0),at=new Date().toISOString(),amount=Number.MAX_SAFE_INTEGER;
  await f.db.prepare("INSERT INTO customers(id,seller_id,email,name,created_at,updated_at) VALUES ('customer_exact','seller_alice','exact@example.test','Exact buyer',?,?)").bind(at,at).run();
  for(let n=1;n<=2;n++){
    const id='EZK-S-'+String(n).repeat(24),value=amount-(n-1);
    await f.db.batch([
      f.db.prepare(`INSERT INTO orders(id,seller_id,customer_id,commerce_version,commerce_environment,checkout_state,subtotal_amount,total_amount,customer_snapshot_json,snapshot_json,created_at,updated_at)
        VALUES (?,'seller_alice','customer_exact',1,'sandbox','paid',?,?,'{"name":"Exact buyer","email":"exact@example.test"}','{"fees":{"plan":"standard"},"shipping":{"skipped":true}}',?,?)`).bind(id,value,value,at,at),
      f.db.prepare(`INSERT INTO commerce_payment_captures(id,seller_id,order_id,provider,commerce_environment,provider_reference,amount,currency,capture_kind,verified_at)
        VALUES (?,'seller_alice',?,'doku','sandbox',?,?,'IDR','order_payment',?)`).bind('exact_capture_'+n,id,'exact_'+n,value,at),
    ]);
  }
  const b=await browser(t),page=await pageFor(b,f,390);await page.goto(f.app.base+'/cart/admin/?page=customers');await loaded(page);
  for(const total of ['gross','average'])assert.equal((await page.locator('[data-customers-total='+total+']').textContent()).replace(/\s/g,''),'Rp18.014.398.509.481.981');
  await mkdir(screens,{recursive:true});await page.screenshot({path:screens+'/customers-exact-390.png'});
  await page.locator('[data-customer-open]').click();await detailLoaded(page);assert.match((await page.locator('[data-customers-detail-content]').innerText()).replace(/\s/g,''),/Rp18\.014\.398\.509\.481\.981/);assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
  await page.locator('[data-customers-detail]').evaluate(e=>e.scrollIntoView({block:'start',behavior:'instant'}));await page.screenshot({path:screens+'/customer-profile-exact-390.png'});
  const download=page.waitForEvent('download');await page.locator('[data-customers-export]').click();assert.match(await readFile(await(await download).path(),'utf8'),/"18014398509481981"/);
});

test('saved segment pages retain earlier results on failure and clear obsolete navigation when the selected state changes',async t=>{
  const f=await fixture(t,0);
  for(let n=0;n<28;n++){const r=await f.merchant(base+'/segments',{revision:0,requestKey:randomBytes(16).toString('hex'),name:'Saved group '+n,filters:{minOrders:String(n)},archived:false},{method:'POST'});assert.equal(r.status,200,r.error);}
  const b=await browser(t),page=await pageFor(b,f);let failMore=false,failState=false;
  await page.route('**/cart/admin/?cloud=*',async route=>{const path=new URL(route.request().url()).searchParams.get('cloud');if((failMore&&path?.startsWith(base+'/segments?')&&path.includes('cursor='))||(failState&&path?.startsWith(base+'/segments?state=archived'))){failMore=false;failState=false;await route.fulfill({status:503,json:{ok:false,error:'Segments interrupted'}});return;}await route.continue();});
  await page.goto(f.app.base+'/cart/admin/?page=customers');await page.waitForFunction(()=>document.querySelectorAll('[data-customer-segment]').length===25);
  const first=await page.locator('[data-customer-segment]').evaluateAll(es=>es.map(e=>e.dataset.customerSegment));failMore=true;await page.locator('[data-customers-segments-more]').click();await page.waitForFunction(()=>document.querySelector('[data-customers-segments-status]').textContent.includes('Segments interrupted'));assert.deepEqual(await page.locator('[data-customer-segment]').evaluateAll(es=>es.map(e=>e.dataset.customerSegment)),first);
  await page.locator('[data-customers-segments-more]').click();await page.waitForFunction(()=>document.querySelectorAll('[data-customer-segment]').length===28);assert.equal(await page.locator('[data-customers-segments-more]').isVisible(),false);
  await page.locator('[data-customers-segments-refresh]').click();await page.waitForFunction(()=>document.querySelectorAll('[data-customer-segment]').length===25);assert.equal(await page.locator('[data-customers-segments-more]').isVisible(),true);
  failState=true;await page.locator('[data-customers-segment-state]').selectOption('archived');await page.waitForFunction(()=>document.querySelector('[data-customers-segments-status]').textContent.includes('Segments interrupted'));assert.equal(await page.locator('[data-customer-segment]').count(),0);assert.equal(await page.locator('[data-customers-segments-more]').isVisible(),false);
  await page.locator('[data-customers-segments-refresh]').click();await page.waitForFunction(()=>document.querySelector('[data-customers-segments-status]').textContent.includes('No archived segments'));
});
