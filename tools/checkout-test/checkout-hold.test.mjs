import test from 'node:test';
import assert from 'node:assert/strict';
import {randomBytes} from 'node:crypto';
import {readdir} from 'node:fs/promises';
import {join} from 'node:path';
import {setup} from './fixture.mjs';
import {setupCentralFixture} from './central-fixture.mjs';
import {createCommerceOrder} from '../../cloudflare/ezkart-api/src/commerce-orders.js';

const beta={EZKART_DEPLOYMENT_ENVIRONMENT:'beta',EZKART_COMMERCE_ENVIRONMENT:'production',
  EZKART_CLOUDFLARE_API_URL:'https://ezkart-api-beta.fixture.workers.dev',EZKART_COMMERCE_CHECKOUT:'held'};
const input=()=>({checkout_key:randomBytes(16).toString('hex'),cart:{tea:2},expected_prices:{tea:20000},
  expected_total:58000,shop:'alice-shop',shipping_id:'jne-reg',
  customer:{fullName:'Checkout Tester',email:'checkout@example.com',phone:'081234567890',location:'Jakarta Selatan',
    address:'Jalan Test Nomor 12',postalCode:'12345',note:'Handle with care',coordinate:{latitude:-6.2,longitude:106.8}}});
const phpString=value=>`base64_decode('${Buffer.from(value).toString('base64')}')`;

test('PHP checkout activation defaults agree with Worker beta policy and cannot be bypassed through legacy checkout',async t=>{
  const app=await setup({...beta,EZKART_COMMERCE_STORAGE:'legacy'});t.after(()=>app.close());
  for(const deployment of ['test','beta','production'])for(const setting of ['','held','enabled','true','Enabled']){
    assert.equal(app.cli(`require_once ${phpString(new URL('../../cart/api/commerce-client.php',import.meta.url).pathname)};echo ez_new_checkout_enabled()?'yes':'no';`,
      {EZKART_DEPLOYMENT_ENVIRONMENT:deployment,EZKART_COMMERCE_CHECKOUT:setting}),
      setting==='enabled'||(deployment!=='beta'&&setting==='')?'yes':'no');
  }
  const request=input();delete request.checkout_key;
  const result=await app.request('/cart/api/start.php',request);assert.equal(result.status,503);assert.match(result.data.error,/temporarily paused/);
  assert.equal((await app.calls()).length,0);
  assert.deepEqual(await readdir(join(app.directory,'orders')).catch(()=>[]),[]);
});

test('beta hold stops checkout before shipping or payment calls while existing paid recovery stays available on desktop and mobile',async t=>{
  const f=await setupCentralFixture(t,beta,{bindings:{APP_ENVIRONMENT:'beta',COMMERCE_CHECKOUT:'held'}});
  const config=await fetch(f.app.base+'/cart/api/checkout-config.php');assert.equal(config.status,503);assert.equal(config.headers.get('retry-after'),'300');
  const heldConfig=await config.json();assert.match(heldConfig.error,/temporarily paused/);assert.equal(heldConfig.code,'checkout_paused');
  const request=input(),start=await f.app.request('/cart/api/start.php',request);assert.equal(start.status,503);assert.match(start.data.error,/temporarily paused/);
  assert.equal(start.data.retry_same_checkout,true);
  assert.equal(await f.count('orders'),0);assert.equal(await f.count('inventory_reservations'),0);
  const providerCalls=async()=>(await f.app.calls()).filter(call=>/doku\.com|biteship\.com/.test(new URL(call.url).hostname));
  assert.deepEqual(await providerCalls(),[]);
  const intent=JSON.parse(f.app.cli(`require_once ${phpString(new URL('../../cart/api/commerce-checkout.php',import.meta.url).pathname)};echo json_encode(ez_checkout_intent(json_decode(${phpString(JSON.stringify(request))},true)));`));
  const seed=f.input({checkoutKey:request.checkout_key,checkout:{intentHash:intent.hash,paymentFlow:'hosted',shop:'alice-shop'}});
  const order=await createCommerceOrder({APP_ENVIRONMENT:'beta',COMMERCE_CHECKOUT:'enabled',DB:f.db},seed);
  assert.equal((await f.paid(order)).status,200);
  const resumed=await f.app.request('/cart/api/start.php',request);assert.equal(resumed.status,201,JSON.stringify(resumed.data));assert.equal(resumed.data.order_id,order.id);assert.equal(resumed.data.status,'PAID');
  const {chromium}=await import('../builder-mcp/node_modules/playwright/index.mjs');
  const browser=await chromium.launch({headless:true});t.after(()=>browser.close());
  for(const width of [1360,390]){
    const page=await browser.newPage({viewport:{width,height:940}}),errors=[];page.on('pageerror',e=>errors.push(e.message));
    await page.goto(f.app.base+'/cart/?shop=alice-shop&cart=tea:2');
    await page.locator('#catalog-error').waitFor({state:'visible'});
    assert.match(await page.locator('#catalog-error-message').innerText(),/temporarily paused/);
    assert.equal(await page.locator('#catalog-error-title').innerText(),'Checkout is paused');
    assert.equal(await page.locator('.order-summary').isVisible(),false);
    assert.equal(await page.locator('#back-to-store').isVisible(),true);
    assert.equal(await page.locator('#to-checkout').isDisabled(),true);
    assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
    if(process.env.EZKART_TEST_SCREENSHOTS)await page.screenshot({path:join(process.env.EZKART_TEST_SCREENSHOTS,`checkout-held-${width}.png`),fullPage:true,animations:'disabled'});
    // An existing uncertain browser attempt bypasses the unavailable new-checkout config.
    await page.evaluate(attempt=>sessionStorage.setItem('ezkart.checkout.attempt.v1',JSON.stringify(attempt)),
      {version:1,body:JSON.stringify(request),uncertain:true});
    await page.reload();await page.locator('#checkout-recovery').waitFor({state:'visible'});
    await page.locator('#recover-checkout').click();await page.waitForURL('**/payment.php?order='+order.id);
    await page.getByRole('heading',{name:'Payment confirmed',exact:true}).waitFor();
    assert.deepEqual(errors,[]);await page.close();
  }
  assert.deepEqual(await providerCalls(),[]);assert.equal(await f.count('orders'),1);assert.equal(await f.count('commerce_payment_captures'),1);
});
