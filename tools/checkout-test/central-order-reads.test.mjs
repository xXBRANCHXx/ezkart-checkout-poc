import test from 'node:test';
import assert from 'node:assert/strict';
import {join} from 'node:path';
import {readdir} from 'node:fs/promises';
import {setupCentralFixture} from './central-fixture.mjs';

const base='/v1/commerce/orders';
async function fixture(t,count=28){
  const f=await setupCentralFixture(t);await f.db.prepare("UPDATE products SET stock_quantity=1000 WHERE id='tea'").run();
  const orders=[];
  for(let n=0;n<count;n++){
    const created=await f.create(f.input({customer:{name:n===0?'Buyer <img src=x onerror=alert(1)>':'Buyer '+n,email:'buyer'+n+'@example.test',phone:'081234567890'}}));assert.equal(created.status,200,created.error);orders.push(created.order);
  }
  const cookie=f.app.adminCookie({supabase_access_token:await f.merchantToken('alice','alice@example.test'),admin_user:{id:'alice',email:'alice@example.test'}});
  return {...f,orders,cookie};
}
async function loaded(page){await page.waitForFunction(()=>document.querySelector('[data-orders-count]')?.textContent.includes('matching orders'));}

test('merchant order manager pages all orders, preserves failed-page position, filters on the server and opens saved details at desktop/mobile widths',async t=>{
  const f=await fixture(t),{chromium}=await import('../builder-mcp/node_modules/playwright/index.mjs');
  const browser=await chromium.launch({headless:true});t.after(()=>browser.close());
  for(const width of [1360,390]){
    const context=await browser.newContext({viewport:{width,height:940}});await context.addCookies([f.cookie]);const page=await context.newPage(),errors=[];
    page.on('pageerror',e=>errors.push(e.message));let failNext=false;
    await page.route('**/cart/admin/?cloud=*',async route=>{
      const path=new URL(route.request().url()).searchParams.get('cloud');
      if(failNext&&path?.startsWith(base+'?')&&path.includes('cursor=')){failNext=false;await route.fulfill({status:503,json:{ok:false,error:'Read interrupted'}});return;}
      await route.continue();
    });
    await page.goto(f.app.base+'/cart/admin/?page=orders');await loaded(page);
    assert.equal(await page.locator('[data-orders-rows] tr').count(),25);assert.equal(await page.locator('[data-orders-total="total"]').textContent(),'28');
    const first=await page.locator('[data-order-open]').evaluateAll(es=>es.map(e=>e.dataset.orderOpen));
    await page.locator('[data-orders-filters] input[name=q]').fill('unapplied draft');
    failNext=true;await page.locator('[data-orders-next]').click();await page.waitForFunction(()=>document.querySelector('[data-orders-list-status]').textContent.includes('Read interrupted'));
    assert.deepEqual(await page.locator('[data-order-open]').evaluateAll(es=>es.map(e=>e.dataset.orderOpen)),first);
    await page.locator('[data-orders-next]').click();await page.waitForFunction(()=>document.querySelectorAll('[data-orders-rows] tr').length===3);
    const second=await page.locator('[data-order-open]').evaluateAll(es=>es.map(e=>e.dataset.orderOpen));assert.equal(new Set([...first,...second]).size,28);
    assert.equal(new URL(page.url()).searchParams.get('q'),null);
    await page.reload();await loaded(page);assert.deepEqual(await page.locator('[data-order-open]').evaluateAll(es=>es.map(e=>e.dataset.orderOpen)),second);
    assert.equal(await page.locator('[data-orders-previous]').isEnabled(),true);
    await page.locator('[data-orders-previous]').click();await page.waitForFunction(()=>document.querySelectorAll('[data-orders-rows] tr').length===25);
    assert.deepEqual(await page.locator('[data-order-open]').evaluateAll(es=>es.map(e=>e.dataset.orderOpen)),first);
    await page.locator('[data-orders-filters] input[name=q]').fill('buyer0@example.test');await page.getByRole('button',{name:'Apply filters',exact:true}).click();
    await page.waitForFunction(()=>document.querySelectorAll('[data-orders-rows] tr').length===1);assert.equal(await page.locator('[data-orders-total="total"]').textContent(),'28');
    await page.locator('[data-order-open]').click();await page.waitForFunction(()=>document.querySelector('[data-orders-detail-content]').textContent.includes('Ordered items'));
    assert.match(await page.locator('[data-orders-detail-content]').innerText(),/Buyer <img src=x onerror=alert\(1\)>/);assert.equal(await page.locator('[data-orders-detail-content] img').count(),0);
    assert.equal(await page.locator('[data-orders-detail-content] a').first().getAttribute('href'),'?page=fulfillment&order='+f.orders[0].id);
    await page.reload();await loaded(page);await page.waitForFunction(()=>document.querySelector('[data-orders-detail-content]').textContent.includes('Ordered items'));
    assert.match(await page.locator('[data-orders-reference]').textContent(),new RegExp(f.orders[0].id));
    assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
    assert.equal(await page.locator('select[name=state]').evaluate(e=>CSS.supports('appearance','base-select')||e.closest('.ezkart-select')!==null),true);
    await page.evaluate(()=>scrollTo(0,0));
    if(process.env.EZKART_TEST_SCREENSHOTS)await page.screenshot({path:join(process.env.EZKART_TEST_SCREENSHOTS,`central-orders-${width}.png`),fullPage:true,animations:'disabled'});
    await page.locator('[data-orders-detail-close]').click();assert.equal(await page.locator('[data-orders-detail]').isVisible(),false);
    await page.locator('select[name=state]').selectOption('pending');await page.getByRole('button',{name:'Apply filters',exact:true}).click();
    await page.waitForFunction(()=>document.querySelector('[data-orders-list-status]').textContent==='No orders match these filters.');
    assert.equal(await page.locator('[data-orders-rows] tr').count(),0);assert.equal(await page.locator('[data-orders-total="total"]').textContent(),'28');
    await page.locator('[data-orders-clear]').click();await page.waitForFunction(()=>document.querySelectorAll('[data-orders-rows] tr').length===25);
    await page.locator('#global-search').fill('buyer1@example.test');await page.locator('#global-search').press('Enter');
    await page.waitForFunction(()=>document.querySelectorAll('[data-orders-rows] tr').length===1);assert.equal(await page.locator('[data-order-open]').getAttribute('data-order-open'),f.orders[1].id);
    assert.deepEqual(errors,[]);await context.close();
  }
  assert.equal((await f.app.calls()).filter(c=>c.url.includes('doku.com')||c.url.includes('biteship.com')).length,0);
  assert.equal((await readdir(join(f.app.directory,'orders')).catch(()=>[])).length,0);
});

test('failed central reads stay explicit and never expose legacy files or another seller; proxy permits only bounded reads',async t=>{
  const f=await fixture(t,1),{chromium}=await import('../builder-mcp/node_modules/playwright/index.mjs');
  f.app.cli(`ez_save_order(['order_id'=>'EZK-S-${'1'.repeat(24)}','seller_id'=>'seller_alice','status'=>'PAID','customer'=>['name'=>'LEGACY_PRIVATE_SENTINEL']]);`,{EZKART_COMMERCE_STORAGE:'legacy'});
  const browser=await chromium.launch({headless:true});t.after(()=>browser.close());const context=await browser.newContext();await context.addCookies([f.cookie]);const page=await context.newPage();
  let failed=true;await page.route('**/cart/admin/?cloud=*',async route=>{const path=new URL(route.request().url()).searchParams.get('cloud');if(failed&&path?.startsWith(base)){await route.fulfill({status:503,json:{ok:false,error:'Orders unavailable'}});return;}await route.continue();});
  await page.goto(f.app.base+'/cart/admin/?page=orders');await page.waitForFunction(()=>document.querySelector('[data-orders-list-status]').textContent.includes('Orders unavailable'));
  assert.equal(await page.locator('[data-orders-rows] tr').count(),0);assert.equal(await page.locator('[data-orders-total="total"]').textContent(),'—');assert(!(await page.content()).includes('LEGACY_PRIVATE_SENTINEL'));
  failed=false;await page.locator('[data-orders-refresh]').click();await loaded(page);assert.equal(await page.locator('[data-orders-total="total"]').textContent(),'1');
  const cookieHeader={Cookie:f.cookie.name+'='+f.cookie.value};
  for(const path of [base+'?seller=seller_bob',base+'?limit=2&limit=3',base+'?cursor[]='+encodeURIComponent('anything')])assert.equal((await f.app.request('/cart/admin/?cloud='+encodeURIComponent(path),undefined,cookieHeader)).status,400);
  assert.equal((await f.app.request('/cart/admin/?cloud='+encodeURIComponent(base),{},cookieHeader)).status,403);
  const csrf=await page.evaluate(()=>document.body.dataset.adminCsrfToken);
  assert.equal((await f.app.request('/cart/admin/?cloud='+encodeURIComponent(base),{},{...cookieHeader,'X-Ezkart-Csrf':csrf})).status,405);
  const bob=f.app.adminCookie({supabase_access_token:await f.merchantToken('bob','bob@example.test'),admin_user:{id:'bob',email:'bob@example.test'}});
  const denied=await f.app.request('/cart/admin/?cloud='+encodeURIComponent(base+'/'+f.orders[0].id),undefined,{Cookie:bob.name+'='+bob.value});assert.equal(denied.status,404);assert(!JSON.stringify(denied.data).includes('Buyer'));
});

test('late list and detail responses cannot replace a newer merchant selection',async t=>{
  const f=await fixture(t,2),{chromium}=await import('../builder-mcp/node_modules/playwright/index.mjs');
  const browser=await chromium.launch({headless:true});t.after(()=>browser.close());const context=await browser.newContext();await context.addCookies([f.cookie]);const page=await context.newPage();
  let holdPath='',release,entered;const hold=path=>{holdPath=path;return new Promise(r=>entered=r);};
  await page.route('**/cart/admin/?cloud=*',async route=>{const path=new URL(route.request().url()).searchParams.get('cloud');if(holdPath&&path===holdPath){holdPath='';entered();await new Promise(r=>release=r);}await route.continue();});
  await page.goto(f.app.base+'/cart/admin/?page=orders');await loaded(page);
  const enteredPromise=hold(base+'/'+f.orders[0].id);await page.locator(`[data-order-open="${f.orders[0].id}"]`).click();await enteredPromise;
  await page.locator(`[data-order-open="${f.orders[1].id}"]`).click();await page.waitForFunction(()=>document.querySelector('[data-orders-detail-content]').textContent.includes('Ordered items'));
  const arrived=page.waitForResponse(r=>new URL(r.url()).searchParams.get('cloud')===base+'/'+f.orders[0].id);release();await arrived;
  assert.match(await page.locator('[data-orders-reference]').textContent(),new RegExp(f.orders[1].id));assert.match(await page.locator('#commerce-order-detail-title').textContent(),/Buyer 1/);
  const slow=base+'?'+new URLSearchParams({limit:'25',q:'buyer0@example.test',state:'all',queue:'all'}),listEntered=hold(slow);
  await page.locator('[data-orders-filters] input[name=q]').fill('buyer0@example.test');await page.getByRole('button',{name:'Apply filters',exact:true}).click();await listEntered;
  await page.locator('[data-orders-filters] input[name=q]').fill('buyer1@example.test');await page.getByRole('button',{name:'Apply filters',exact:true}).click();
  await page.waitForFunction(()=>document.querySelectorAll('[data-orders-rows] tr').length===1);
  const stale=page.waitForResponse(r=>new URL(r.url()).searchParams.get('cloud')===slow);release();await stale;
  assert.equal(await page.locator('[data-order-open]').getAttribute('data-order-open'),f.orders[1].id);
  assert.equal(new URL(page.url()).searchParams.get('q'),'buyer1@example.test');
  const initialEntered=hold(slow);
  await page.goto(f.app.base+'/cart/admin/?page=orders&q=buyer0%40example.test&order='+f.orders[0].id);await initialEntered;
  await page.waitForFunction(()=>document.querySelector('[data-orders-detail-content]').textContent.includes('Ordered items'));
  await page.locator('[data-orders-filters] input[name=q]').fill('buyer1@example.test');await page.getByRole('button',{name:'Apply filters',exact:true}).click();
  await page.waitForFunction(()=>document.querySelectorAll('[data-orders-rows] tr').length===1);
  const initialArrived=page.waitForResponse(r=>new URL(r.url()).searchParams.get('cloud')===slow);release();await (await initialArrived).finished();
  await page.waitForTimeout(100);
  assert.equal(await page.locator('[data-orders-detail]').isVisible(),false);
  assert.equal(new URL(page.url()).searchParams.get('order'),null);
  assert.equal(await page.locator('[data-order-open]').getAttribute('data-order-open'),f.orders[1].id);
});
