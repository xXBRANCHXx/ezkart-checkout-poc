import test from 'node:test';
import assert from 'node:assert/strict';
import {join} from 'node:path';
import {readdir} from 'node:fs/promises';
import {setupCentralFixture as setupBaseFixture} from './central-fixture.mjs';
import {seedDeclaredOnboarding} from '../../cloudflare/ezkart-api/test/onboarding-fixture.mjs';
async function setupCentralFixture(...args){const f=await setupBaseFixture(...args);await seedDeclaredOnboarding(f.db);return f;}
import {fixtureShipping} from '../../cloudflare/ezkart-api/test/commerce-fixture.mjs';

const api='/v1/commerce/dashboard';
async function fixture(t,overrides){
  const f=await setupCentralFixture(t,overrides);await f.db.prepare("UPDATE products SET stock_quantity=1000 WHERE id='tea'").run();
  await f.db.prepare("INSERT INTO product_media(id,seller_id,product_id,r2_key,mime_type,size_bytes,sort_order,created_at) VALUES ('dashboard-photo','seller_alice','tea','dashboard/tea.png','image/png',68,1,'now')").run();
  const orders=[];
  for(let n=0;n<8;n++){
    const result=await f.create(f.input({customer:{name:n===0?'Buyer <img src=x onerror=alert(1)>':'Buyer '+n,email:'buyer'+n+'@example.test',phone:'081234567890'},...(n===1?{shipping:fixtureShipping}:{})}));assert.equal(result.status,200,result.error);orders.push(result.order);
    if(n<3)assert.equal((await f.paid(result.order)).status,200);
  }
  assert.equal((await f.paid(orders[0],{reference:'additional-payment'})).status,200);
  const id='EZK-S-'+'A'.repeat(24),at=new Date(Date.now()-400*86400000).toISOString();
  await f.db.batch([
    f.db.prepare(`INSERT INTO orders(id,seller_id,commerce_version,commerce_environment,checkout_state,subtotal_amount,total_amount,customer_snapshot_json,snapshot_json,created_at,updated_at)
      VALUES (?,'seller_alice',1,'sandbox','pending',1000,1000,'{"name":"Earlier buyer"}','{"fees":{"plan":"standard"},"shipping":{"skipped":true}}',?,?)`).bind(id,at,at),
    f.db.prepare(`INSERT INTO order_items(id,seller_id,order_id,product_id,product_type,title,sku,quantity,unit_price_amount,fulfillment_snapshot_json,created_at)
      VALUES ('older_dashboard_item','seller_alice',?,'tea','physical','Earlier tea','OLDER',1,1000,'{"variantId":"","weightGrams":100}',?)`).bind(id,at),
  ]);
  const cookie=f.app.adminCookie({supabase_access_token:await f.merchantToken('alice','alice@example.test'),admin_user:{id:'alice',email:'alice@example.test'}});
  return {...f,orders,cookie};
}
const loaded=page=>page.waitForFunction(()=>document.querySelector('[data-dashboard-report]')?.hidden===false&&document.querySelector('[data-commerce-dashboard]').getAttribute('aria-busy')==='false');

test('central dashboard renders complete reports, preserves periods and opens scoped order workflows on desktop and mobile',async t=>{
  const f=await fixture(t),{chromium}=await import('../builder-mcp/node_modules/playwright/index.mjs');
  const browser=await chromium.launch({headless:true});t.after(()=>browser.close());
  for(const width of [1360,390]){
    const context=await browser.newContext({viewport:{width,height:940}});await context.addCookies([f.cookie]);const page=await context.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));
    await page.route('**/cart/admin/?cloud=%2Fv1%2Fmedia%2Fdashboard-photo',route=>route.fulfill({contentType:'image/png',body:Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jQ1sAAAAASUVORK5CYII=','base64')}));
    await page.goto(f.app.base+'/cart/admin/?page=dashboard');await loaded(page);
    assert.equal(await page.locator('[data-dashboard-value=orders]').textContent(),'8');assert.match(await page.locator('[data-dashboard-value=confirmedAmount]').textContent(),/138\.000/);assert.match(await page.locator('[data-dashboard-value=additionalAmount]').textContent(),/40\.000/);
    assert.equal(await page.locator('[data-order-total]').textContent(),'9');assert.equal(await page.locator('[data-dashboard-queue=attention]').textContent(),'1');assert.equal(await page.locator('[data-dashboard-queue="needs-processing"]').textContent(),'1');
    assert.equal(await page.locator('[data-dashboard-recent] tr').count(),5);assert.equal(await page.locator('[data-dashboard-chart-values] tr').count(),30);assert.equal(await page.locator('[data-dashboard-states] li').count(),8);
    assert.match(await page.locator('[data-dashboard-products]').innerText(),/6 units/);assert.match(await page.locator('[data-dashboard-amounts]').innerText(),/18\.000/);
    assert.equal(await page.locator('[data-dashboard-products] img').count(),1,'The existing catalog photo is retained.');
    await page.locator('[data-dashboard-products] img').scrollIntoViewIfNeeded();await page.waitForFunction(()=>document.querySelector('[data-dashboard-products] img')?.naturalWidth===1);
    assert.equal(await page.locator('[data-dashboard-queue-link=attention]').getAttribute('href'),'?page=orders&queue=attention');
    await page.locator('select[name=range]').selectOption('all');await page.locator('[data-dashboard-refresh]').click();await loaded(page);
    assert.equal(await page.locator('[data-dashboard-value=orders]').textContent(),'8');assert.equal(new URL(page.url()).searchParams.get('range'),'30');
    await page.getByRole('button',{name:'Apply period',exact:true}).click();await page.waitForFunction(()=>document.querySelector('[data-dashboard-value=orders]').textContent==='9');
    assert.match(await page.locator('[data-dashboard-chart-note]').textContent(),/Monthly.*Grouped/);assert.equal(new URL(page.url()).searchParams.get('range'),'all');
    await page.reload();await loaded(page);assert.equal(await page.locator('select[name=range]').inputValue(),'all');assert.equal(await page.locator('[data-dashboard-value=orders]').textContent(),'9');
    await page.locator('.commerce-dashboard-chart-data summary').click();assert(await page.locator('[data-dashboard-chart-values]').isVisible());
    assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);assert((await page.locator('select[name=range]').boundingBox()).height>=40);
    const chart=await page.locator('[data-dashboard-chart] svg').evaluate(e=>({scale:e.getBoundingClientRect().width/e.viewBox.baseVal.width,font:parseFloat(getComputedStyle(e.querySelector('text')).fontSize)}));assert(chart.scale>.95&&chart.scale<1.05);assert(chart.font>=11);
    if(width===1360){await page.setViewportSize({width:390,height:940});await page.waitForFunction(()=>document.querySelector('[data-dashboard-chart] svg').viewBox.baseVal.width<400);await page.setViewportSize({width,height:940});await page.waitForFunction(()=>document.querySelector('[data-dashboard-chart] svg').viewBox.baseVal.width>800);}
    assert.equal(await page.locator('.kpi-grid p').first().evaluate(e=>getComputedStyle(e).whiteSpace),'normal');
    await page.evaluate(()=>scrollTo(0,0));if(process.env.EZKART_TEST_SCREENSHOTS){
      await page.screenshot({path:join(process.env.EZKART_TEST_SCREENSHOTS,`central-dashboard-${width}.png`),fullPage:true,animations:'disabled'});
      await page.screenshot({path:join(process.env.EZKART_TEST_SCREENSHOTS,`central-dashboard-top-${width}.png`),animations:'disabled'});
    }
    await page.locator('[data-dashboard-queue-link=attention]').click();await page.waitForFunction(()=>document.querySelector('[data-orders-count]')?.textContent.includes('matching orders'));
    assert.equal(await page.locator('[data-order-open]').count(),1);assert.equal(await page.locator('[data-order-open]').getAttribute('data-order-open'),f.orders[0].id);
    await page.locator('[data-order-open]').click();await page.waitForFunction(()=>document.querySelector('[data-orders-detail-content]').textContent.includes('Ordered items'));
    assert.equal(await page.locator('[data-orders-detail-content] img').count(),0);assert.match(await page.locator('#commerce-order-detail-title').textContent(),/Buyer <img/);
    await page.goto(f.app.base+'/cart/admin/?page=dashboard');await loaded(page);await page.locator('#global-search').fill('buyer1@example.test');await page.locator('#global-search').press('Enter');
    await page.waitForFunction(()=>document.querySelector('[data-orders-count]')?.textContent.includes('matching orders'));assert.equal(await page.locator('[data-order-open]').getAttribute('data-order-open'),f.orders[1].id);
    assert.deepEqual(errors,[]);await context.close();
  }
  assert.equal((await f.app.calls()).filter(c=>c.url.includes('doku.com')||c.url.includes('biteship.com')).length,0);
  assert.equal((await readdir(join(f.app.directory,'orders')).catch(()=>[])).length,0);
});

test('TEST preview excludes legacy files, failures remain explicit, and the proxy only accepts bounded authenticated reads',async t=>{
  const f=await fixture(t,{EZKART_COMMERCE_STORAGE:'legacy'}),{chromium}=await import('../builder-mcp/node_modules/playwright/index.mjs');
  f.app.cli(`ez_save_order(['order_id'=>'EZK-S-${'1'.repeat(24)}','seller_id'=>'seller_alice','status'=>'PAID','customer'=>['name'=>'LEGACY_DASHBOARD_SENTINEL']]);`);
  const browser=await chromium.launch({headless:true});t.after(()=>browser.close());const context=await browser.newContext();await context.addCookies([f.cookie]);const page=await context.newPage();
  let fail=true;await page.route('**/cart/admin/?cloud=*',async route=>{const p=new URL(route.request().url()).searchParams.get('cloud');if(fail&&p?.startsWith(api)){await route.fulfill({status:503,json:{ok:false,error:'Dashboard unavailable'}});return;}await route.continue();});
  await page.goto(f.app.base+'/cart/admin/?page=dashboard&dashboard-preview=1');await page.waitForFunction(()=>document.querySelector('[data-dashboard-status]').textContent.includes('Dashboard unavailable'));
  assert.equal(await page.locator('[data-dashboard-report]').isVisible(),false);assert.equal(await page.locator('[data-dashboard-queue=attention]').textContent(),'—');assert(!(await page.content()).includes('LEGACY_DASHBOARD_SENTINEL'));
  fail=false;await page.locator('[data-dashboard-refresh]').click();await loaded(page);assert.equal(await page.locator('[data-dashboard-value=orders]').textContent(),'8');
  assert.equal(await page.locator('[data-dashboard-availability]').isVisible(),true);
  assert.equal(await page.locator('[data-dashboard-queue-link=attention]').getAttribute('href'),'?page=orders&order-preview=1&queue=attention');
  const priorDate=await page.locator('[data-dashboard-period]').textContent();fail=true;
  await page.locator('select[name=range]').selectOption('all');await page.getByRole('button',{name:'Apply period',exact:true}).click();await page.waitForFunction(()=>document.querySelector('[data-dashboard-status]').textContent.includes('last loaded report'));
  assert.equal(await page.locator('[data-dashboard-value=orders]').textContent(),'8');assert.equal(await page.locator('[data-dashboard-period]').textContent(),priorDate);assert.equal(new URL(page.url()).searchParams.get('range'),'30');
  fail=false;await page.locator('[data-dashboard-refresh]').click();await page.waitForFunction(()=>document.querySelector('[data-dashboard-value=orders]').textContent==='9');
  const headers={Cookie:f.cookie.name+'='+f.cookie.value};
  for(const suffix of ['?seller=seller_bob','?range=7&range=30','?range[]=7','?cursor=bad'])assert.equal((await f.app.request('/cart/admin/?cloud='+encodeURIComponent(api+suffix),undefined,headers)).status,400);
  assert.equal((await f.app.request('/cart/admin/?cloud='+encodeURIComponent(api),{},headers)).status,403);
  const csrf=await page.evaluate(()=>document.body.dataset.adminCsrfToken);assert.equal((await f.app.request('/cart/admin/?cloud='+encodeURIComponent(api),{},{...headers,'X-Ezkart-Csrf':csrf})).status,405);
  assert.equal((await fetch(f.app.base+'/cart/admin/commerce-dashboard.php')).status,404);
});

test('a delayed dashboard response cannot replace a newer selected reporting period',async t=>{
  const f=await fixture(t),{chromium}=await import('../builder-mcp/node_modules/playwright/index.mjs');
  const browser=await chromium.launch({headless:true});t.after(()=>browser.close());const context=await browser.newContext();await context.addCookies([f.cookie]);const page=await context.newPage();
  let release,enter;const entered=new Promise(r=>enter=r);let held=false;
  await page.route('**/cart/admin/?cloud=*',async route=>{const p=new URL(route.request().url()).searchParams.get('cloud');if(!held&&p===api+'?range=all&group=daily'){held=true;enter();await new Promise(r=>release=r);}await route.continue();});
  await page.goto(f.app.base+'/cart/admin/?page=dashboard');await loaded(page);
  await page.locator('select[name=range]').selectOption('all');await page.getByRole('button',{name:'Apply period',exact:true}).click();await entered;
  await page.locator('select[name=range]').selectOption('7');await page.getByRole('button',{name:'Apply period',exact:true}).click();await page.waitForFunction(()=>document.querySelectorAll('[data-dashboard-chart-values] tr').length===7);
  const response=page.waitForResponse(r=>new URL(r.url()).searchParams.get('cloud')===api+'?range=all&group=daily');release();await (await response).finished();await page.waitForTimeout(100);
  assert.equal(await page.locator('[data-dashboard-value=orders]').textContent(),'8');assert.equal(new URL(page.url()).searchParams.get('range'),'7');assert.equal(await page.locator('[data-dashboard-chart-values] tr').count(),7);
  await page.goBack();await loaded(page);assert.equal(await page.locator('select[name=range]').inputValue(),'30');assert.equal(await page.locator('[data-dashboard-chart-values] tr').count(),30);
});
