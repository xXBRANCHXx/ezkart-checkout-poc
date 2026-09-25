import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdir,readdir} from 'node:fs/promises';
import {join} from 'node:path';
import {setupCentralFixture} from './central-fixture.mjs';

const base='/v1/commerce/payments',screens='/tmp/ezkart-central-payments-ui-01a0d643';
const loaded=page=>page.waitForFunction(()=>document.querySelector('[data-payments-count]')?.textContent.includes('matching orders'));
const detailLoaded=page=>page.waitForFunction(()=>document.querySelector('[data-payments-detail-content]')?.textContent.includes('Verified payment history'));
const ids=page=>page.locator('[data-payment-open]').evaluateAll(es=>es.map(e=>e.dataset.paymentOpen));
async function fixture(t,count=28,overrides={}){
  const f=await setupCentralFixture(t,overrides);await f.db.prepare("UPDATE products SET stock_quantity=1000 WHERE id='tea'").run();
  const orders=[];
  for(let n=0;n<count;n++){
    const result=await f.create(f.input({customer:{name:n===0?'Buyer <img src=x onerror=alert(1)>':'Buyer '+n,email:'buyer'+n+'@example.test',phone:'081234567890'}}));
    assert.equal(result.status,200,result.error);orders.push(result.order);
    if(n===0){assert.equal((await f.event(result.order,'payment.created',f.session(result.order))).status,200);assert.equal((await f.paid(result.order,{reference:'primary-payment-reference'})).status,200);}
  }
  const cookie=f.app.adminCookie({supabase_access_token:await f.merchantToken('alice','alice@example.test'),admin_user:{id:'alice',email:'alice@example.test'}});
  return {...f,orders,cookie};
}
async function browser(t){const {chromium}=await import('../builder-mcp/node_modules/playwright/index.mjs'),b=await chromium.launch({headless:true});t.after(()=>b.close());return b;}

test('payments preserve server paging and failed-page position, search provider references and expose complete histories on desktop/mobile',async t=>{
  const f=await fixture(t),b=await browser(t);await mkdir(screens,{recursive:true});
  for(let n=1;n<=22;n++)assert.equal((await f.paid(f.orders[0],{reference:'additional-reference-'+n})).status,200);
  const at='2026-01-20T01:00:00.000Z';
  for(let n=0;n<22;n++)await f.db.batch([
    f.db.prepare(`INSERT INTO commerce_jobs(id,seller_id,order_id,commerce_environment,job_key,kind,payload_json,state,attempts,available_at,created_at,updated_at)
      VALUES (?,'seller_alice',?,'sandbox',?,'payment.create','{}','uncertain',1,?,?,?)`).bind('history_job_'+n,f.orders[0].id,'history_key_'+n,at,at,at),
    f.db.prepare(`INSERT INTO commerce_job_attempts(id,job_id,attempt,lease_token,worker_id,mode,started_at,finished_at,outcome,error)
      VALUES (?,?,1,'PRIVATE_TOKEN','PRIVATE_WORKER','execute',?,?,'uncertain','PRIVATE_ERROR')`).bind('history_attempt_'+n,'history_job_'+n,at,at),
  ]);
  for(const width of [1360,390]){
    const context=await b.newContext({viewport:{width,height:940},reducedMotion:'reduce'});await context.addCookies([f.cookie]);const page=await context.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));
    let failNext=false,failHistory=false;
    await page.route('**/cart/admin/?cloud=*',async route=>{
      const path=new URL(route.request().url()).searchParams.get('cloud');
      if((failNext&&path?.startsWith(base+'?')&&path.includes('cursor='))||(failHistory&&path?.includes('/captures?'))){failNext=false;failHistory=false;await route.fulfill({status:503,json:{ok:false,error:'Read interrupted'}});return;}
      await route.continue();
    });
    await page.goto(f.app.base+'/cart/admin/?page=payments');await loaded(page);
    assert.equal(await page.locator('[data-payments-rows] tr').count(),25);assert.equal(await page.locator('[data-payments-total=paidOrders]').textContent(),'1');assert.equal(await page.locator('[data-payments-total=needsReview]').textContent(),'1');
    await page.screenshot({path:join(screens,`payments-${width}.png`)});
    const first=await ids(page);await page.locator('input[name=q]').fill('unapplied draft');
    failNext=true;await page.locator('[data-payments-next]').click();await page.waitForFunction(()=>document.querySelector('[data-payments-list-status]').textContent.includes('Read interrupted'));assert.deepEqual(await ids(page),first);
    await page.locator('[data-payments-next]').click();await page.waitForFunction(()=>document.querySelectorAll('[data-payments-rows] tr').length===3);
    const second=await ids(page);assert.equal(new Set([...first,...second]).size,28);assert.equal(new URL(page.url()).searchParams.has('q'),false);
    await page.reload();await loaded(page);assert.deepEqual(await ids(page),second);
    await page.locator('[data-payments-previous]').click();await page.waitForFunction(()=>document.querySelectorAll('[data-payments-rows] tr').length===25);assert.deepEqual(await ids(page),first);
    await page.locator('input[name=q]').fill('additional-reference-22');await page.getByRole('button',{name:'Apply filters',exact:true}).click();await page.waitForFunction(()=>document.querySelectorAll('[data-payments-rows] tr').length===1);
    assert.match(await page.locator('[data-payments-summary-detail=paidOrders]').innerText(),/1 of 28/);
    await page.locator('[data-payment-open]').click();await detailLoaded(page);
    const heading=await page.locator('#commerce-payment-detail-title').boundingBox();assert(heading.y>=70&&heading.y<850);
    const content=await page.locator('[data-payments-detail-content]').innerText();assert.match(content,/Buyer <img src=x onerror=alert\(1\)>/);assert(!/PRIVATE_|081234567890/.test(content));assert.equal(await page.locator('[data-payments-detail-content] img').count(),0);
    assert.equal(await page.getByRole('link',{name:'Open order',exact:true}).getAttribute('href'),'?page=orders&order='+f.orders[0].id);
    const captures=page.locator('[data-payment-history=captures]');assert.equal(await captures.locator('li').count(),20);
    failHistory=true;await captures.getByRole('button',{name:'Load older entries'}).click();await page.waitForFunction(()=>document.querySelector('[data-payment-history=captures] [role=status]').textContent.includes('Read interrupted'));assert.equal(await captures.locator('li').count(),20);
    await captures.getByRole('button',{name:'Load older entries'}).click();await page.waitForFunction(()=>document.querySelectorAll('[data-payment-history=captures] li').length===23);assert.equal(await captures.getByRole('button',{name:'Load older entries'}).isVisible(),false);
    const attempts=page.locator('[data-payment-history=attempts]');await attempts.getByRole('button',{name:'Load older entries'}).click();await page.waitForFunction(()=>document.querySelectorAll('[data-payment-history=attempts] li').length===22);
    const events=page.locator('[data-payment-history=events]');await events.getByRole('button',{name:'Load older entries'}).click();await page.waitForFunction(()=>document.querySelectorAll('[data-payment-history=events] li').length===24);
    await page.reload();await loaded(page);await detailLoaded(page);assert.match(await page.locator('[data-payments-reference]').textContent(),new RegExp(f.orders[0].id));
    await page.locator('[data-payments-detail]').evaluate(e=>e.scrollIntoView({block:'start',behavior:'instant'}));await page.screenshot({path:join(screens,`payment-detail-${width}.png`)});
    assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
    assert.equal(await page.locator('select[name=method]').evaluate(e=>CSS.supports('appearance','base-select')||e.closest('.ezkart-select')!==null),true);
    await page.locator('[data-payments-detail-close]').click();assert.equal(await page.locator('[data-payments-detail]').isVisible(),false);
    await page.locator('[data-payments-clear]').click();await loaded(page);
    await page.locator('select[name=evidence]').selectOption('additional');await page.getByRole('button',{name:'Apply filters',exact:true}).click();await page.waitForFunction(()=>document.querySelectorAll('[data-payments-rows] tr').length===1);
    await page.locator('select[name=review]').selectOption('no');await page.getByRole('button',{name:'Apply filters',exact:true}).click();await page.waitForFunction(()=>document.querySelector('[data-payments-list-status]').textContent==='No payments match these filters.');
    await page.locator('[data-payments-clear]').click();await loaded(page);
    await page.locator('#global-search').fill('virtual account bca');await page.locator('#global-search').press('Enter');await page.waitForFunction(()=>document.querySelectorAll('[data-payments-rows] tr').length===1);assert.deepEqual(await ids(page),[f.orders[0].id]);
    await page.locator('input[name=q]').fill('do not apply on refresh');await page.locator('[data-payments-refresh]').click();await loaded(page);assert.deepEqual(await ids(page),[f.orders[0].id]);assert.equal(new URL(page.url()).searchParams.get('q'),'virtual account bca');
    await page.locator('input[name=q]').fill('');await page.locator('input[name=from]').fill('2026-01-20');await page.locator('input[name=to]').fill('2026-01-20');await page.getByRole('button',{name:'Apply filters',exact:true}).click();await loaded(page);assert.match(await page.locator('[data-payments-report]').getAttribute('href'),/range=custom&from=2026-01-20&to=2026-01-20/);
    assert.equal(await page.getByRole('link',{name:'Payment reports',exact:true}).getAttribute('href'),await page.locator('[data-payments-report]').getAttribute('href'));
    assert.deepEqual(errors,[]);await context.close();
  }
  assert.equal((await f.app.calls()).filter(c=>c.url.includes('doku.com')||c.url.includes('biteship.com')).length,0);
  assert.equal((await readdir(join(f.app.directory,'orders')).catch(()=>[])).length,0);
});

test('payment preview excludes legacy files, recovers from read errors and enforces seller isolation and proxy guards',async t=>{
  const f=await fixture(t,1,{EZKART_COMMERCE_STORAGE:'legacy'}),b=await browser(t),context=await b.newContext();await context.addCookies([f.cookie]);const page=await context.newPage();
  f.app.cli("ez_save_order(['order_id'=>'EZK-S-AAAAAAAAAAAAAAAAAAAAAAAA','seller_id'=>'seller_alice','status'=>'PAID','customer'=>['name'=>'LEGACY_PAYMENT_SENTINEL']]);");
  let fail=true;await page.route('**/cart/admin/?cloud=*',async route=>{const path=new URL(route.request().url()).searchParams.get('cloud');if(fail&&path?.startsWith(base)){await route.fulfill({status:503,json:{ok:false,error:'Payments unavailable'}});return;}await route.continue();});
  await page.goto(f.app.base+'/cart/admin/?page=payments&payment-preview=1&order='+f.orders[0].id);await page.waitForFunction(()=>document.querySelector('[data-payments-list-status]').textContent.includes('Payments unavailable'));
  assert.equal(await page.locator('[data-payments-total=gross]').textContent(),'—');assert.equal(await page.locator('[data-payments-rows] tr').count(),0);assert(!(await page.content()).includes('LEGACY_PAYMENT_SENTINEL'));
  fail=false;await page.locator('[data-payments-refresh]').click();await loaded(page);await detailLoaded(page);
  assert.match(await page.getByRole('link',{name:'Open order',exact:true}).getAttribute('href'),/order-preview=1/);assert.match(await page.locator('[data-payments-report]').getAttribute('href'),/analytics-preview=1/);assert.equal(new URL(page.url()).searchParams.get('payment-preview'),'1');
  const headers={Cookie:f.cookie.name+'='+f.cookie.value};
  for(const suffix of ['?seller=seller_bob','?method=x&method=y','?q[]=x','?cursor='+('a'.repeat(1001))])assert.equal((await f.app.request('/cart/admin/?cloud='+encodeURIComponent(base+suffix),undefined,headers)).status,400);
  assert.equal((await f.app.request('/cart/admin/?cloud='+encodeURIComponent(base),{},headers)).status,403);
  const csrf=await page.evaluate(()=>document.body.dataset.adminCsrfToken);assert.equal((await f.app.request('/cart/admin/?cloud='+encodeURIComponent(base),{},{...headers,'X-Ezkart-Csrf':csrf})).status,405);
  const bob=f.app.adminCookie({supabase_access_token:await f.merchantToken('bob','bob@example.test'),admin_user:{id:'bob',email:'bob@example.test'}});
  for(const suffix of ['', '/captures','/attempts','/events'])assert.equal((await f.app.request('/cart/admin/?cloud='+encodeURIComponent(base+'/'+f.orders[0].id+suffix),undefined,{Cookie:bob.name+'='+bob.value})).status,404);
  const unauth=await fetch(f.app.base+'/cart/admin/commerce-payments.php');assert.equal(unauth.status,404);
});

test('late payment list and detail replies cannot overwrite a newer selection or reopen closed details',async t=>{
  const f=await fixture(t,2),b=await browser(t),context=await b.newContext();await context.addCookies([f.cookie]);const page=await context.newPage();
  let holdPath='',release,entered;const hold=path=>{holdPath=path;return new Promise(r=>entered=r);};
  await page.route('**/cart/admin/?cloud=*',async route=>{const path=new URL(route.request().url()).searchParams.get('cloud');if(holdPath===path){holdPath='';entered();await new Promise(r=>release=r);}await route.continue();});
  await page.goto(f.app.base+'/cart/admin/?page=payments');await loaded(page);
  const one=hold(base+'/'+f.orders[0].id);await page.locator(`[data-payment-open="${f.orders[0].id}"]`).click();await one;
  await page.locator(`[data-payment-open="${f.orders[1].id}"]`).click();await detailLoaded(page);
  const arrived=page.waitForResponse(r=>new URL(r.url()).searchParams.get('cloud')===base+'/'+f.orders[0].id);release();await(await arrived).finished();assert.match(await page.locator('#commerce-payment-detail-title').textContent(),/Buyer 1/);
  const slow=base+'?'+new URLSearchParams({limit:'25',q:'buyer0@example.test',state:'all',evidence:'all',review:'all'}),waitList=hold(slow);
  await page.locator('input[name=q]').fill('buyer0@example.test');await page.getByRole('button',{name:'Apply filters',exact:true}).click();await waitList;
  await page.locator('input[name=q]').fill('buyer1@example.test');await page.getByRole('button',{name:'Apply filters',exact:true}).click();await loaded(page);
  const stale=page.waitForResponse(r=>new URL(r.url()).searchParams.get('cloud')===slow);release();await(await stale).finished();assert.deepEqual(await ids(page),[f.orders[1].id]);assert.equal(new URL(page.url()).searchParams.get('q'),'buyer1@example.test');
  const waitDetail=hold(base+'/'+f.orders[1].id);await page.locator('[data-payment-open]').click();await waitDetail;
  await page.locator('[data-payments-detail-close]').click();const closed=page.waitForResponse(r=>new URL(r.url()).searchParams.get('cloud')===base+'/'+f.orders[1].id);release();await(await closed).finished();
  assert.equal(await page.locator('[data-payments-detail]').isVisible(),false);assert.equal(new URL(page.url()).searchParams.has('order'),false);
  await page.locator('input[name=q]').fill('all');await page.getByRole('button',{name:'Apply filters',exact:true}).click();await loaded(page);assert.equal(new URL(page.url()).searchParams.get('q'),'all');
});

test('payments render exact rupiah totals above the JavaScript safe integer range at mobile widths',async t=>{
  const f=await fixture(t,0),at=new Date().toISOString(),amount=Number.MAX_SAFE_INTEGER;
  for(let n=1;n<=2;n++){
    const id='EZK-S-'+String(n).repeat(24),value=amount-(n-1);
    await f.db.batch([
      f.db.prepare(`INSERT INTO orders(id,seller_id,commerce_version,commerce_environment,checkout_state,subtotal_amount,total_amount,customer_snapshot_json,snapshot_json,created_at,updated_at)
        VALUES (?,'seller_alice',1,'sandbox','paid',?,?,'{"name":"Exact amount buyer"}','{"fees":{"plan":"standard"},"shipping":{"skipped":true}}',?,?)`).bind(id,value,value,at,at),
      f.db.prepare(`INSERT INTO commerce_payment_captures(id,seller_id,order_id,provider,commerce_environment,provider_reference,amount,currency,capture_kind,verified_at)
        VALUES (?,'seller_alice',?,'doku','sandbox',?,?,'IDR','order_payment',?)`).bind('exact_capture_'+n,id,'exact_'+n,value,at),
    ]);
  }
  const b=await browser(t),context=await b.newContext({viewport:{width:390,height:940}});await context.addCookies([f.cookie]);const page=await context.newPage();await page.goto(f.app.base+'/cart/admin/?page=payments');await loaded(page);
  assert.equal((await page.locator('[data-payments-total=gross]').textContent()).replace(/\s/g,''),'Rp18.014.398.509.481.981');
  assert.equal((await page.locator('[data-payments-total=average]').textContent()).replace(/\s/g,''),'Rp9.007.199.254.740.991');
  await page.locator('[data-payment-open]').first().click();await detailLoaded(page);assert.match(await page.locator('[data-payments-detail-content]').innerText(),/9\.007\.199\.254\.740\.990/);
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);await page.evaluate(()=>scrollTo(0,0));await mkdir(screens,{recursive:true});await page.screenshot({path:join(screens,'payments-exact-390.png')});
});
