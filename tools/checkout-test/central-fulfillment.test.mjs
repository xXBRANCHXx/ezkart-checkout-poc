import test from 'node:test';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {randomBytes} from 'node:crypto';
import {readFile,writeFile,readdir} from 'node:fs/promises';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {setupCentralFixture} from './central-fixture.mjs';
import {fixtureShipping as shipping} from '../../cloudflare/ezkart-api/test/commerce-fixture.mjs';
import {digitalFixtureFile} from '../../cloudflare/ezkart-api/test/digital-commerce-fixture.mjs';

const key=()=>randomBytes(16).toString('hex');
async function fixture(t,arrange=true,mixed=false,bindings={}){
  const f=await setupCentralFixture(t,{EZKART_TEST_CENTRAL_COURIER:'1'},{bindings});
  const items=f.input().items;if(mixed)items.push((await digitalFixtureFile(f)).item);
  const create=await f.create(f.input({shipping,items,customer:{name:'Shipment Buyer',email:'checkout@example.com',phone:'081234567892',authUserId:'fixture-google-customer'}}));assert.equal(create.status,200,create.error);
  const paid=await f.paid(create.order);assert.equal(paid.status,200,paid.error);const order=paid.order;
  const detail=()=>f.merchant('/v1/fulfillment/'+order.id);
  const action=async(kind,note='')=>{const view=await detail();const r=await f.merchant('/v1/fulfillment/'+order.id,{kind,note,revision:view.order.revision,requestKey:key()},{method:'POST'});assert.equal(r.status,200,r.error);return r.receipt;};
  let pickup=null;if(arrange){await action('accept');pickup=await action('pickup');}
  const dispatch=async(overrides={})=>{
    const child=spawn(process.env.PHP_BINARY||'php',['-n','-d','auto_prepend_file='+fileURLToPath(new URL('./provider-fixture.php',import.meta.url)),fileURLToPath(new URL('../commerce/fulfillment-dispatch.php',import.meta.url)),'--once'],{env:{...f.app.env,...overrides}});
    let stdout='',stderr='';child.stdout.on('data',d=>stdout+=d);child.stderr.on('data',d=>stderr+=d);
    const code=await new Promise((resolve,reject)=>{child.on('error',reject);child.on('exit',resolve);});return {code,stdout,stderr,summary:stdout.trim()?JSON.parse(stdout):null};
  };
  const configureCourier=value=>writeFile(join(f.app.directory,'courier-control.json'),JSON.stringify(value));
  const providerOrders=async()=>JSON.parse(await readFile(join(f.app.directory,'courier-orders.json'),'utf8'));
  const calls=async()=> (await f.app.calls()).filter(c=>c.url.startsWith('https://api.biteship.com/v1/orders'));
  const available=()=>f.db.prepare("UPDATE commerce_jobs SET available_at='2000-01-01T00:00:00.000Z' WHERE kind LIKE 'shipment.%' AND state='uncertain'").run();
  const webhook=(data,headers={})=>f.app.request('/cart/api/biteship-webhook.php',data,{'X-Ezkart-Webhook-Token':'sandbox-webhook-fixture-32-characters',...headers});
  return {...f,order,pickup,detail,action,dispatch,configureCourier,providerOrders,calls,available,webhook};
}

test('central courier dispatch uses frozen addresses and package data, persists early delivery, and creates no JSON orders',async t=>{
  const f=await fixture(t);
  await f.configureCourier({omitReference:true,earlyEvent:{status:'delivered',updated_at:new Date().toISOString(),courier_waybill_id:'EARLY-WB'}});
  const run=await f.dispatch();assert.equal(run.code,0,run.stderr+run.stdout);assert.equal(run.summary.succeeded,1);
  const calls=await f.calls(),payload=JSON.parse(calls[0].body);
  assert.equal(payload.origin_address,shipping.origin.origin_address);assert.equal(payload.origin_postal_code,54321);assert.equal(payload.origin_contact_phone,'081234567891');
  assert.equal(payload.destination_address,'Jalan Saved Destination 12, Jakarta');assert.equal(payload.items[0].weight,100);assert.equal(payload.items[0].quantity,2);assert.equal(payload.items[0].value,20000);
  assert.equal(payload.origin_collection_method,'pickup');assert.equal(calls[1].method,'GET');
  const view=await f.detail();assert.equal(view.order.fulfillmentState,'delivered');assert.equal(view.shipments[0].tracking.waybillId,'EARLY-WB');
  assert.equal((await f.dispatch()).summary.processed,0);assert.equal((await f.calls()).length,2);
  assert.equal((await readdir(join(f.app.directory,'orders')).catch(()=>[])).length,0);
});

test('a lost create response reconciles the same unique reference and verifies duplicate provider ownership',async t=>{
  const f=await fixture(t);await f.configureCourier({loseCreate:true});
  assert.equal((await f.dispatch()).code,2);assert.equal((await f.detail()).shipments[0].providerId,'');
  assert.equal(Object.keys(await f.providerOrders()).length,1);await f.configureCourier({wrongReference:true});await f.available();
  assert.equal((await f.dispatch()).code,2);assert.equal((await f.detail()).shipments[0].providerId,'');
  await f.configureCourier({});await f.available();const run=await f.dispatch();assert.equal(run.code,0,run.stderr+run.stdout);
  assert.equal(Object.keys(await f.providerOrders()).length,1);assert((await f.detail()).shipments[0].providerId);
  const creates=(await f.calls()).filter(c=>c.method==='POST');assert.equal(new Set(creates.map(c=>JSON.parse(c.body).reference_id)).size,1);
  assert.equal(await f.stock(),8);
});

test('lost storage acknowledgment recovers without recreating the courier shipment and held unknown pickups stay unresolved',async t=>{
  const f=await fixture(t);f.control.drop='/internal/commerce/shipments/'+f.pickup.shipmentId+'/bind';
  assert.equal((await f.dispatch()).code,2);assert((await f.detail()).shipments[0].providerId);
  await f.available();assert.equal((await f.dispatch()).code,0);assert.equal((await f.calls()).filter(c=>c.method==='POST').length,1);
  // A separate paid order enters review after an uncertain creation; reconciliation is read-only while held.
  const other=await f.create(f.input({shipping}));await f.paid(other.order);
  for(const kind of ['accept','pickup']){const v=await f.merchant('/v1/fulfillment/'+other.order.id);assert.equal((await f.merchant('/v1/fulfillment/'+other.order.id,{kind,revision:v.order.revision,requestKey:key()},{method:'POST'})).status,200);}
  await f.configureCourier({loseCreate:true});assert.equal((await f.dispatch()).code,2);
  await f.db.prepare('UPDATE orders SET payment_review=1 WHERE id=?').bind(other.order.id).run();await f.available();const before=(await f.calls()).length;
  assert.equal((await f.dispatch()).code,2);assert.equal((await f.calls()).length,before);
});

test('lost cancellation response reconciles with a read and never refunds or restores inventory',async t=>{
  const f=await fixture(t);assert.equal((await f.dispatch()).code,0);await f.action('cancel_pickup','Customer asked to delay dispatch');
  await f.configureCourier({loseCancel:true});assert.equal((await f.dispatch()).code,2);assert.equal((await f.detail()).order.fulfillmentState,'confirmed');
  await f.available();assert.equal((await f.dispatch()).code,0);const view=await f.detail();assert.equal(view.order.fulfillmentState,'cancelled');assert.equal(view.order.state,'paid');assert.equal(view.canPickup,true);assert.equal(await f.stock(),8);
  const cancel=(await f.calls()).filter(c=>c.url.endsWith('/cancel'));assert.equal(cancel.length,1);assert.equal(cancel[0].method,'POST');assert.equal(JSON.parse(cancel[0].body).cancellation_reason_code,'others');
  await f.action('pickup');assert.equal((await f.dispatch()).code,0);assert.equal(Object.keys(await f.providerOrders()).length,2);
});

test('a callback during tracking refresh wins over the stale courier read and subsequent reconciliation records the current response',async t=>{
  const f=await fixture(t);await f.dispatch();await f.action('refresh');
  await f.configureCourier({concurrentEvent:{status:'delivered',updated_at:new Date().toISOString()}});
  assert.equal((await f.dispatch()).code,2);assert.equal((await f.detail()).order.fulfillmentState,'delivered');
  await f.available();assert.equal((await f.dispatch()).code,0);assert.equal((await f.detail()).order.fulfillmentState,'delivered');
  assert.equal((await f.calls()).filter(c=>c.method==='POST').length,1);
});

test('central courier callback authentication and environment guards retain unknown orders and reject malformed fees',async t=>{
  const f=await fixture(t),data={event:'order.status',order_id:'early_provider',status:'picked'};
  const invalid=await f.webhook(data,{'X-Ezkart-Webhook-Token':'invalid'});assert.equal(invalid.status,401);
  const unknown=await f.webhook(data);assert.equal(unknown.status,200,JSON.stringify(unknown));assert.equal(unknown.data.matched,false);
  assert.equal((await f.db.prepare('SELECT COUNT(*) AS n FROM commerce_shipping_inbox').first()).n,1);
  assert.equal((await f.webhook({event:'order.price',order_id:'early_provider',shippment_fee:10000})).status,400);
  const wrong=await f.app.request('/cart/api/biteship-webhook.php?environment=production',data,{'X-Ezkart-Webhook-Token':'production-webhook-fixture-32-characters'});assert.equal(wrong.status,500);
  assert.equal((await fetch(f.app.base+'/tools/commerce/fulfillment-dispatch.php')).status,404);
});

test('customer tracking uses the owned central shipment, preserves received-only times, and keeps public payment polling private',async t=>{
  const f=await fixture(t);await f.dispatch();const view=await f.detail(),provider=view.shipments[0].providerId;
  const stamp=new Date().toISOString();
  assert.equal((await f.webhook({event:'order.status',order_id:provider,status:'in_transit',updated_at:stamp,coordinate:{latitude:-6.21,longitude:106.81},location_name:'Jakarta sorting center',courier_link:'https://tracking.example.test/order'})).status,200);
  assert.equal((await f.webhook({event:'order.status',order_id:provider,status:'delivered'})).status,200);
  const tracking=await f.app.tracking(f.order.id);assert.equal(tracking.status,200,JSON.stringify(tracking));assert.equal(tracking.data.tracking.shipment_status,'delivered');
  assert.equal(tracking.data.tracking.latest_location.source,'courier_scan');assert.equal(tracking.data.tracking.latest_location.updated_at,stamp);
  const delivered=tracking.data.tracking.history.find(e=>e.status==='delivered');assert.equal(delivered.updated_at,'');assert(delivered.received_at);
  const saved=await f.providerOrders();saved[provider].status='delivered';saved[provider].destination={proof_of_delivery:{link:'https://tracking.example.test/delivery-proof'}};
  saved[provider].courier.history=[{status:'in_transit',updated_at:stamp,note:'Arrived at sorting center',coordinate:{latitude:-6.21,longitude:106.81}}];
  await writeFile(join(f.app.directory,'courier-orders.json'),JSON.stringify(saved));await f.action('refresh');assert.equal((await f.dispatch()).code,0);
  const refreshed=(await f.app.tracking(f.order.id)).data.tracking;assert.equal(refreshed.proof_link,'https://tracking.example.test/delivery-proof');assert.equal(refreshed.history.filter(e=>e.status==='delivered').length,1);assert.equal(refreshed.history.filter(e=>e.status==='in_transit').length,1);
  assert.equal((await f.app.tracking(f.order.id,{cookie:f.app.customerCookie('checkout@example.com','another-buyer')})).status,404);
  const publicStatus=await f.app.request('/cart/api/status.php?order='+f.order.id);assert(!JSON.stringify(publicStatus.data).includes(provider));assert(!JSON.stringify(publicStatus.data).includes('106.81'));
  const direct=await f.call('/internal/commerce/orders/'+f.order.id+'/tracking',{environment:'sandbox',customerId:'another-buyer'});assert.equal(direct.status,404);
  const {chromium}=await import('../builder-mcp/node_modules/playwright/index.mjs');const browser=await chromium.launch({headless:true});t.after(()=>browser.close());const page=await browser.newPage({viewport:{width:390,height:940}});
  await page.route('**/tracking-map-style.json?*',route=>route.fulfill({json:{version:8,sources:{},layers:[{id:'background',type:'background',paint:{'background-color':'#eef1f4'}}]}}));
  await page.context().addCookies([f.app.customerCookie('checkout@example.com','fixture-google-customer',3600,await f.merchantToken('fixture-google-customer','checkout@example.com'))]);await page.goto(f.app.base+'/cart/return.php?order='+f.order.id);
  await page.getByRole('heading',{name:'Your order has been delivered',exact:true}).waitFor();assert.equal(await page.locator('#delivery-proof-link').getAttribute('href'),'https://tracking.example.test/delivery-proof');
  assert.match(await page.locator('#tracking-history').innerText(),/Courier time unavailable/);assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
  await page.waitForFunction(()=>!document.querySelector('#map-loading')||document.querySelector('#map-loading').hidden||!document.querySelector('#map-notice').hidden,null,{timeout:25000});
  await page.locator('.shipment-pin-label').filter({hasText:/^Last reported$/}).waitFor();assert.equal(await page.locator('.shipment-pin-label').filter({hasText:/^Delivered$/}).count(),0);
  if(process.env.EZKART_TEST_SCREENSHOTS)await page.screenshot({path:join(process.env.EZKART_TEST_SCREENSHOTS,'fulfillment-customer-390.png'),fullPage:true,animations:'disabled'});
});

test('merchant fulfillment recovery survives reload and a later rejection, with original addresses and accessible controls on desktop and mobile',async t=>{
  const f=await fixture(t,false),{chromium}=await import('../builder-mcp/node_modules/playwright/index.mjs');
  const browser=await chromium.launch({headless:true});t.after(()=>browser.close());
  const cookie=f.app.adminCookie({supabase_access_token:await f.merchantToken('alice','alice@example.test'),admin_user:{id:'alice',email:'alice@example.test'}});
  const context=await browser.newContext({viewport:{width:1360,height:940}});await context.addCookies([cookie]);const page=await context.newPage(),errors=[],bodies=[];page.on('pageerror',e=>errors.push(e.message));
  let drop=true,reject=false;
  await page.route('**/cart/admin/?cloud=*',async route=>{
    const path=new URL(route.request().url()).searchParams.get('cloud');
    if(route.request().method()==='POST'&&path==='/v1/fulfillment/'+f.order.id){bodies.push(route.request().postData());
      if(drop){drop=false;const response=await route.fetch();assert.equal(response.status(),200,await response.text());await route.abort();return;}
      if(reject){reject=false;await route.fulfill({status:409,json:{ok:false,error:'Order temporarily changed'}});return;}
    }await route.continue();
  });
  await page.goto(f.app.base+'/cart/admin/?page=fulfillment&order='+f.order.id);
  await page.locator('[data-fulfillment-action="accept"]').click();await page.locator('[data-fulfillment-confirm]').click();
  await page.waitForFunction(()=>document.querySelector('[data-fulfillment-form-error]').textContent.includes('could not be confirmed'));
  await page.reload();await page.locator('[data-fulfillment-action="recover"]').click();reject=true;await page.locator('[data-fulfillment-confirm]').click();
  await page.waitForFunction(()=>document.querySelector('[data-fulfillment-form-error]').textContent.includes('could not be confirmed'));
  assert.equal(await page.evaluate(()=>Object.keys(JSON.parse(sessionStorage.getItem('ezkart.fulfillment.pending.seller_alice'))).length),1);
  await page.locator('[data-fulfillment-confirm]').click();await page.locator('[data-fulfillment-action="pickup"]').waitFor();
  assert.equal(new Set(bodies).size,1);assert.equal((await f.db.prepare("SELECT COUNT(*) AS n FROM commerce_fulfillment_actions WHERE kind='accept'").first()).n,1);
  await page.locator('[data-fulfillment-action="pickup"]').click();assert.match(await page.locator('[data-fulfillment-preview]').innerText(),/Jalan Saved Warehouse 18/);
  for(const width of [1360,390]){await page.setViewportSize({width,height:940});await page.evaluate(()=>scrollTo(0,0));if(width===390)await page.waitForFunction(()=>document.querySelector('.sidebar').getBoundingClientRect().right<=1);assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);assert.equal(await page.locator('[data-fulfillment-dialog]').evaluate(e=>e.scrollWidth<=e.clientWidth+1),true);if(process.env.EZKART_TEST_SCREENSHOTS)await page.screenshot({path:join(process.env.EZKART_TEST_SCREENSHOTS,`fulfillment-review-${width}.png`),fullPage:true,animations:'disabled'});}
  await page.locator('[data-fulfillment-confirm]').click();await page.waitForFunction(()=>!document.querySelector('[data-fulfillment-dialog]').open);
  assert.equal((await f.dispatch()).code,0);await page.locator('[data-fulfillment-reload]').click();await page.locator('[data-fulfillment-action="cancel_pickup"]').waitFor();
  assert.equal((await f.calls()).filter(c=>c.method==='POST').length,1);
  for(const width of [1360,390]){await page.setViewportSize({width,height:940});await page.evaluate(()=>scrollTo(0,0));if(width===390)await page.waitForFunction(()=>document.querySelector('.sidebar').getBoundingClientRect().right<=1);assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);if(process.env.EZKART_TEST_SCREENSHOTS)await page.screenshot({path:join(process.env.EZKART_TEST_SCREENSHOTS,`fulfillment-confirmed-${width}.png`),fullPage:true,animations:'disabled'});}
  assert.equal(await page.locator('[data-fulfillment-filter]').evaluate(e=>CSS.supports('appearance','base-select')||e.closest('.ezkart-select')!==null),true);
  await page.locator('[data-fulfillment-action="cancel_pickup"]').click();assert.equal(await page.locator('[data-fulfillment-confirm]').isDisabled(),true);await page.locator('[data-fulfillment-form] textarea').fill('Customer asked us to delay pickup');assert.equal(await page.locator('[data-fulfillment-confirm]').isEnabled(),true);
  await page.keyboard.press('Escape');await page.locator('[data-fulfillment-dialog]').waitFor({state:'hidden'});assert.deepEqual(errors,[]);
});

test('merchant fulfillment sends no action when browser request recovery storage is unavailable',async t=>{
  const f=await fixture(t,false),{chromium}=await import('../builder-mcp/node_modules/playwright/index.mjs');
  const browser=await chromium.launch({headless:true});t.after(()=>browser.close());const page=await browser.newPage();
  await page.context().addCookies([f.app.adminCookie({supabase_access_token:await f.merchantToken(),admin_user:{id:'alice',email:'alice@example.test'}})]);
  await page.addInitScript(()=>{const save=Storage.prototype.setItem;Storage.prototype.setItem=function(key,value){if(key.startsWith('ezkart.fulfillment.pending.'))throw new DOMException('Blocked','QuotaExceededError');return save.call(this,key,value);};});
  await page.goto(f.app.base+'/cart/admin/?page=fulfillment&order='+f.order.id);await page.locator('[data-fulfillment-action="accept"]').click();await page.locator('[data-fulfillment-confirm]').click();
  await page.waitForFunction(()=>document.querySelector('[data-fulfillment-form-error]').textContent.includes('session storage'));
  assert.equal((await f.detail()).order.fulfillmentState,'awaiting_acceptance');assert.equal(await f.count('commerce_fulfillment_actions'),0);
});

test('a crash after courier binding recovers the missing creation event through a verified read',async t=>{
  const f=await fixture(t);await f.configureCourier({loseCreate:true});assert.equal((await f.dispatch()).code,2);
  const [provider]=Object.keys(await f.providerOrders());
  // This is the durable state if the Worker stops after binding and before its inbox insert.
  await f.db.prepare('UPDATE commerce_shipments SET provider_id=?,bound_at=? WHERE id=?').bind(provider,new Date().toISOString(),f.pickup.shipmentId).run();
  await f.configureCourier({});await f.available();const run=await f.dispatch();assert.equal(run.code,0,run.stderr+run.stdout);
  assert.equal((await f.detail()).shipments[0].state,'confirmed');assert.equal((await f.calls()).filter(c=>c.method==='POST').length,1);
});

test('courier recovery cannot resend an uncertain pickup under a different API credential',async t=>{
  const f=await fixture(t);await f.configureCourier({loseCreate:true});assert.equal((await f.dispatch()).code,2);await f.available();
  const original=f.app.env.EZKART_BITESHIP_SANDBOX_API_KEY;f.app.env.EZKART_BITESHIP_SANDBOX_API_KEY='biteship_test.different_account';
  const count=(await f.calls()).length;assert.equal((await f.dispatch()).code,2);assert.equal((await f.calls()).length,count);
  assert.match((await f.detail()).jobs[0].error,/credentials changed/);
  f.app.env.EZKART_BITESHIP_SANDBOX_API_KEY=original;await f.available();await f.configureCourier({});assert.equal((await f.dispatch()).code,0);assert.equal(Object.keys(await f.providerOrders()).length,1);
});

test('a mixed purchase sends only physical units to the courier and preserves digital access',async t=>{
  const f=await fixture(t,true,true),run=await f.dispatch();assert.equal(run.code,0,run.stderr+run.stdout);
  const calls=await f.calls(),payload=JSON.parse(calls[0].body);assert.equal(payload.items.length,1);
  assert.equal(payload.items[0].weight,100);assert.equal(payload.items[0].quantity,2);assert.equal(payload.items[0].value,20000);
  const purchases=await f.merchant('/v1/customer/orders/'+f.order.id+'/downloads',undefined,{seller:'fixture-google-customer'});
  assert.equal(purchases.status,200,purchases.error);assert.equal(purchases.items.length,1);assert.equal(purchases.items[0].canDownload,true);
  assert.equal(purchases.items[0].deliveryConfirmed,false);assert.equal(await f.stock(),8);
});


test('held courier dispatch consumes no booking attempts, keeps owned tracking active and resumes the original reference',async t=>{
 const f=await fixture(t),before=(await f.db.prepare("SELECT attempts FROM commerce_jobs WHERE kind='shipment.create'").first()).attempts;
 const held=await f.dispatch({EZKART_COMMERCE_FULFILLMENT:'held'});assert.equal(held.code,0,held.stderr);assert.equal(held.summary.dispatch,'held');assert.equal(held.summary.processed,0);assert.equal((await f.calls()).length,0);
 assert.equal((await f.db.prepare("SELECT attempts FROM commerce_jobs WHERE kind='shipment.create'").first()).attempts,before);
 assert.equal((await f.dispatch({EZKART_COMMERCE_FULFILLMENT:'enabled'})).code,0);const original=(await f.detail()).shipments[0];
 await f.action('refresh');const tracked=await f.dispatch({EZKART_COMMERCE_FULFILLMENT:'held'});assert.equal(tracked.code,0,tracked.stderr);assert.equal(tracked.summary.succeeded,1);
 assert.equal((await f.calls()).filter(c=>c.method==='POST').length,1);assert.equal((await f.detail()).shipments[0].reference,original.reference);
});

test('merchant held-shipping view keeps acceptance and tracking reads while refusing new pickup writes',async t=>{
 const f=await fixture(t,false,false,{COMMERCE_FULFILLMENT:'held'});await f.action('accept');const detail=await f.detail();assert.equal(detail.courierWritesEnabled,false);assert.equal(detail.canPickup,false);
 const denied=await f.merchant('/v1/fulfillment/'+f.order.id,{kind:'pickup',revision:detail.order.revision,requestKey:key()},{method:'POST'});assert.equal(denied.status,503);assert.equal(await f.count('commerce_shipments'),0);
 const {chromium}=await import('../builder-mcp/node_modules/playwright/index.mjs'),browser=await chromium.launch({headless:true});t.after(()=>browser.close());const page=await browser.newPage({viewport:{width:390,height:940}});
 await page.context().addCookies([f.app.adminCookie({supabase_access_token:await f.merchantToken('alice','alice@example.test'),admin_user:{id:'alice',email:'alice@example.test'}})]);
 await page.goto(f.app.base+'/cart/admin/?page=fulfillment&order='+f.order.id);await page.locator('[data-fulfillment-detail]').filter({hasText:'Courier booking and cancellation are paused.'}).waitFor();
 assert.equal(await page.locator('[data-fulfillment-action=pickup]').count(),0);assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);assert.equal((await f.calls()).length,0);
});
