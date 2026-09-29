import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile,mkdir} from 'node:fs/promises';
import {seedDeclaredOnboarding} from '../../cloudflare/ezkart-api/test/onboarding-fixture.mjs';
import {setupCentralFixture} from './central-fixture.mjs';

const api='/v1/commerce/analytics';
async function fixture(t,overrides){
  const f=await setupCentralFixture(t,overrides);await seedDeclaredOnboarding(f.db);
  await f.db.prepare("UPDATE products SET stock_quantity=1000,title='=HYPERLINK(\"unsafe\")' WHERE id='tea'").run();
  const orders=[];
  for(let n=0;n<23;n++){
    const a=await f.create(f.input({customer:{name:'Buyer '+n,email:'buyer'+n+'@example.test',phone:'081234567890'}}));assert.equal(a.status,200,a.error);orders.push(a.order);
    if(n<3){assert.equal((await f.event(a.order,'payment.created',f.session(a.order))).status,200);assert.equal((await f.paid(a.order)).status,200);}
  }
  const cookie=f.app.adminCookie({supabase_access_token:await f.merchantToken('alice','alice@example.test'),admin_user:{id:'alice',email:'alice@example.test'}});
  return {...f,orders,cookie};
}
async function browserPage(t,f,width=1360){
  const {chromium}=await import('../builder-mcp/node_modules/playwright/index.mjs'),browser=await chromium.launch({headless:true});t.after(()=>browser.close());
  const context=await browser.newContext({viewport:{width,height:940},acceptDownloads:true});await context.addCookies([f.cookie]);return context.newPage();
}
const loaded=page=>page.waitForFunction(()=>document.querySelector('[data-commerce-analytics]')?.dataset.mounted==='1');

test('central analytics retains all reports, filters, pagination, comparisons and chart inspection on desktop/mobile',async t=>{
  const f=await fixture(t);await mkdir('/tmp/ezkart-central-analytics-ui-01a0d643',{recursive:true});
  for(const width of [1360,390]){
    const page=await browserPage(t,f,width),errors=[];page.on('pageerror',e=>errors.push(e.message));
    await page.goto(f.app.base+'/cart/admin/?page=analytics');await loaded(page);
    assert.equal(await page.locator('[data-metric=orders] strong').textContent(),'23');assert.equal(await page.locator('[data-metric=revenue] strong').textContent(),'Rp120.000');
    assert.equal(await page.locator('.an-navigation a').count(),5);assert.equal(await page.locator('.an-chart-data tbody tr').count(),30);
    await page.getByRole('slider',{name:'Inspect chart period'}).fill('0');assert.match(await page.locator('.an-chart-inspector output').innerText(),/Previous/);
    await page.locator('.an-navigation').getByRole('link',{name:'Orders',exact:true}).click();await loaded(page);
    assert.equal(await page.locator('.an-report-table tbody tr').count(),20);assert.match(await page.locator('.an-pagination').innerText(),/1–20 of 23/);
    await page.getByRole('link',{name:'Next',exact:true}).click();await loaded(page);assert.equal(await page.locator('.an-report-table tbody tr').count(),3);
    await page.reload();await loaded(page);assert.match(await page.locator('.an-pagination').innerText(),/Page 2 of 2/);
    await page.getByRole('link',{name:'Previous',exact:true}).click();await loaded(page);
    await page.locator('select[name=status]').selectOption('PAID');await page.getByRole('button',{name:'Filter',exact:true}).click();await loaded(page);
    assert.equal(await page.locator('.an-report-table tbody tr').count(),3);assert.equal(await page.locator('[data-metric=orders] strong').textContent(),'23');
    await page.locator('.an-navigation').getByRole('link',{name:'Payments',exact:true}).click();await loaded(page);
    assert.match(await page.locator('.an-report-table').innerText(),/VIRTUAL_ACCOUNT_BCA/);assert.match(await page.locator('[data-metric=payment_seconds]').innerText(),/Time to verified payment/);
    await page.locator('.an-report-table').getByRole('link',{name:'VIRTUAL_ACCOUNT_BCA'}).click();await loaded(page);assert.equal(await page.locator('.an-report-table tbody tr').count(),3);
    await page.locator('.an-navigation').getByRole('link',{name:'Products',exact:true}).click();await loaded(page);
    assert.match(await page.locator('.an-report-table').innerText(),/=HYPERLINK/);assert.equal(await page.locator('.an-report-table tbody tr').count(),1);
    await page.locator('.an-navigation').getByRole('link',{name:'Revenue',exact:true}).click();await loaded(page);assert.equal(await page.locator('.an-report-table tbody tr').count(),3);
    assert.match(await page.locator('.an-report-table tbody a').first().getAttribute('href'),/^\?page=orders&order=EZK-S-/);
    await page.locator('select[name=range]').selectOption('7');await page.getByRole('button',{name:'Apply',exact:true}).click();await loaded(page);
    assert.equal(await page.locator('.an-chart-data tbody tr').count(),7);assert.equal(new URL(page.url()).searchParams.has('cohort'),false);
    await page.locator('select[name=range]').selectOption('all');await page.getByRole('button',{name:'Apply',exact:true}).click();await loaded(page);assert.match(await page.locator('.an-period-context').innerText(),/no previous period/);
    assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),true);
    await page.screenshot({path:'/tmp/ezkart-central-analytics-ui-01a0d643/central-analytics-'+width+'.png',fullPage:true});
    assert.deepEqual(errors,[]);await page.close();
  }
});

test('CSV retries a lost creation receipt, downloads every immutable chunk and neutralizes formula-like product names',async t=>{
  const f=await fixture(t),page=await browserPage(t,f);await page.goto(f.app.base+'/cart/admin/?page=analytics&report=orders&q=Buyer%201');await loaded(page);
  f.control.drop=api+'/exports';await page.getByRole('button',{name:'Export CSV',exact:true}).click();await page.getByRole('button',{name:'Retry export',exact:true}).waitFor();
  assert.equal(await f.count('commerce_analytics_exports'),1);assert.match(await page.locator('[data-commerce-analytics] [role=status]').innerText(),/No partial file/);
  // Use genuine smaller server pages to exercise multiple chunks without a huge browser fixture.
  await page.route('**/cart/admin/?cloud=*',async route=>{
    const url=new URL(route.request().url()),cloud=url.searchParams.get('cloud');
    if(cloud?.includes('/exports/aex_')&&cloud.includes('limit=500')){url.searchParams.set('cloud',cloud.replace('limit=500','limit=10'));await route.continue({url:String(url)});}
    else await route.continue();
  });
  const downloadPromise=page.waitForEvent('download');await page.getByRole('button',{name:'Retry export',exact:true}).click();const download=await downloadPromise;
  const csv=await readFile(await download.path(),'utf8');assert.equal((csv.match(/"EZK-S-/g)||[]).length,23);assert.equal(await f.count('commerce_analytics_exports'),1);
  assert.match(await page.locator('[data-commerce-analytics] [role=status]').innerText(),/Downloaded all 23/);
  const posts=f.control.calls.filter(c=>c.path===api+'/exports');assert.equal(posts[0].body.requestKey,posts[1].body.requestKey);
  await page.locator('.an-navigation').getByRole('link',{name:'Products',exact:true}).click();await loaded(page);
  const productDownload=page.waitForEvent('download');await page.getByRole('button',{name:'Export CSV',exact:true}).click();
  assert.match(await readFile(await (await productDownload).path(),'utf8'),/"'=HYPERLINK\(""unsafe""\)"/);
});

test('central preview excludes legacy files, errors stay explicit and export proxy requires CSRF and strict paths',async t=>{
  const f=await fixture(t,{EZKART_COMMERCE_STORAGE:'legacy'}),page=await browserPage(t,f);
  await f.app.cli("ez_save_order(['order_id'=>'EZK-S-AAAAAAAAAAAAAAAAAAAAAAAA','customer'=>['name'=>'LEGACY_ANALYTICS_SENTINEL'],'seller_id'=>'seller_alice','created_at'=>gmdate('c'),'status'=>'PAID','total'=>999999]);");
  f.control.fail=api+'?range=30';await page.goto(f.app.base+'/cart/admin/?page=analytics&analytics-preview=1&range=30');
  assert.match(await page.locator('[role=alert]').last().innerText(),/central report could not be loaded/);assert.equal(await page.locator('.an-metrics').count(),0);assert(!(await page.content()).includes('LEGACY_ANALYTICS_SENTINEL'));
  f.control.fail='';await page.getByRole('link',{name:'Reset and reload analytics'}).click();await loaded(page);assert.match(await page.locator('.an-notice').first().innerText(),/preview/);
  await page.locator('.an-navigation').getByRole('link',{name:'Revenue',exact:true}).click();await loaded(page);assert.equal(new URL(page.url()).searchParams.get('analytics-preview'),'1');
  assert.match(await page.locator('.an-report-table tbody a').first().getAttribute('href'),/order-preview=1/);
  const headers={Cookie:f.cookie.name+'='+f.cookie.value};
  for(const suffix of ['?seller=seller_bob','?range=7&range=30','?range[]=7','?cohort='+('a'.repeat(1601))])assert.equal((await f.app.request('/cart/admin/?cloud='+encodeURIComponent(api+suffix),undefined,headers)).status,400);
  assert.equal((await f.app.request('/cart/admin/?cloud='+encodeURIComponent(api+'/exports'),{},headers)).status,403);
  const csrf=await page.evaluate(()=>document.body.dataset.adminCsrfToken);
  assert.equal((await f.app.request('/cart/admin/?cloud='+encodeURIComponent(api),{},{...headers,'X-Ezkart-Csrf':csrf})).status,405);
  assert.equal((await f.app.request('/cart/admin/?cloud='+encodeURIComponent(api+'/exports?seller=seller_bob'),{},{...headers,'X-Ezkart-Csrf':csrf})).status,400);
  assert.equal((await fetch(f.app.base+'/cart/admin/?page=analytics&analytics-preview=1&export=csv',{headers})).status,405);
});

test('large monetary totals remain exact in rendered cards, chart tables and downloadable CSV',async t=>{
  const f=await setupCentralFixture(t);await seedDeclaredOnboarding(f.db);const at=new Date(Date.now()-60000).toISOString(),amount=Number.MAX_SAFE_INTEGER;
  for(let n=1;n<=2;n++){
    const id='EZK-S-'+String(n).repeat(24),value=amount-(n-1);
    await f.db.batch([
      f.db.prepare(`INSERT INTO orders(id,seller_id,commerce_version,commerce_environment,checkout_state,subtotal_amount,total_amount,customer_snapshot_json,snapshot_json,created_at,updated_at)
        VALUES (?,'seller_alice',1,'sandbox','paid',?,?,'{"name":"Exact amount buyer"}','{"fees":{"plan":"standard"},"shipping":{"skipped":true}}',?,?)`).bind(id,value,value,at,at),
      f.db.prepare(`INSERT INTO order_items(id,seller_id,order_id,product_id,product_type,title,sku,quantity,unit_price_amount,fulfillment_snapshot_json,created_at)
        VALUES (?,'seller_alice',?,'tea','physical','Saved tea','TEA',1,?,'{"variantId":"","weightGrams":100}',?)`).bind('exact_item_'+n,id,value,at),
      f.db.prepare(`INSERT INTO commerce_payment_captures(id,seller_id,order_id,provider,commerce_environment,provider_reference,amount,currency,capture_kind,verified_at)
        VALUES (?,'seller_alice',?,'doku','sandbox',?,?,'IDR','order_payment',?)`).bind('exact_capture_'+n,id,'exact_'+n,value,at),
    ]);
  }
  f.cookie=f.app.adminCookie({supabase_access_token:await f.merchantToken('alice','alice@example.test'),admin_user:{id:'alice',email:'alice@example.test'}});
  const page=await browserPage(t,f,390);await page.goto(f.app.base+'/cart/admin/?page=analytics');await loaded(page);
  const exact=(2n*BigInt(amount)-1n).toString(),formatted='Rp'+exact.replace(/\B(?=(\d{3})+(?!\d))/g,'.');
  assert.equal(await page.locator('[data-metric=revenue] strong').textContent(),formatted);
  assert.match(await page.locator('.an-chart-data').textContent(),new RegExp(formatted.replaceAll('.','\\.')));
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),true);
  const promise=page.waitForEvent('download');await page.getByRole('button',{name:'Export CSV',exact:true}).click();
  assert((await readFile(await (await promise).path(),'utf8')).includes('"'+exact+'"'));
  await page.screenshot({path:'/tmp/ezkart-central-analytics-ui-01a0d643/central-analytics-exact-390.png',fullPage:true});
});

test('analytics charts start higher, use purple selection and keep empty charts honest',async t=>{
  const f=await fixture(t);await mkdir('/tmp/ezkart-analytics-refresh',{recursive:true});
  for(const width of [1360,390]){
    const page=await browserPage(t,f,width);await page.goto(f.app.base+'/cart/admin/?page=analytics&report=revenue');await loaded(page);
    assert.equal(await page.locator('.an-metric [role=img]').count(),4);
    assert.equal(await page.locator('.an-navigation [aria-current]').evaluate(e=>getComputedStyle(e).color),'rgb(112, 68, 189)');
    const path=await page.locator('[data-metric=revenue] .an-mini-line').getAttribute('d');assert.match(path,/L/);
    assert.equal(await page.locator('[data-commerce-analytics]').evaluate(e=>!!e.closest('.an-toolbar')),true);
    if(width===1360){
      assert.ok((await page.locator('.an-metrics').boundingBox()).y<440);
      assert.ok((await page.locator('.an-main-grid').boundingBox()).y<660);
    }
    assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
    await page.screenshot({path:'/tmp/ezkart-analytics-refresh/revenue-'+width+'.png'});
    await page.goto(f.app.base+'/cart/admin/?page=analytics&report=revenue&range=custom&from=1970-01-01&to=1970-01-07');await loaded(page);
    assert.equal(await page.locator('.an-chart-empty').textContent(),'No orders in this period');
    assert.equal(await page.locator('[data-metric=revenue] .an-mini-chart circle').evaluateAll(es=>es.every(e=>e.getAttribute('cy')==='52')),true);
    assert.equal(await page.locator('[data-metric=aov] strong').textContent(),'—');
    await page.screenshot({path:'/tmp/ezkart-analytics-refresh/empty-'+width+'.png'});await page.close();
  }
});
