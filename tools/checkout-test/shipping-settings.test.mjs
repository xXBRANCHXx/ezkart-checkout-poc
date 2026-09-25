import test from 'node:test';
import assert from 'node:assert/strict';
import {randomBytes} from 'node:crypto';
import {writeFile,mkdir} from 'node:fs/promises';
import {join} from 'node:path';
import {setupCentralFixture} from './central-fixture.mjs';
import {shippingConfiguration,shippingAddress} from '../../cloudflare/ezkart-api/test/commerce-fixture.mjs';

const key=()=>randomBytes(16).toString('hex'),path='/v1/shipping-settings';
const read=async f=>(await f.merchant(path)).settings;
const save=async(f,configuration,revision)=>(await f.merchant(path,{configuration,revision:revision??(await read(f)).revision,requestKey:key()}));
const input=()=>({checkout_key:key(),cart:{tea:2},expected_prices:{tea:20000},expected_total:58000,shipping_id:'jne-reg',shop:'alice-shop',customer:{fullName:'Shipping Buyer',email:'buyer@example.test',phone:'081234567890',location:'Jakarta',address:'Jalan Buyer House 10',postalCode:'12345',coordinate:{latitude:-6.21,longitude:106.81}}});
const rates=async f=>(await f.app.calls()).filter(c=>c.url.endsWith('/rates/couriers'));

test('PHP quotes use the seller origin without global pickup configuration, hide contacts, and fail closed on missing settings',async t=>{
  const f=await setupCentralFixture(t,{EZKART_BITESHIP_ORIGIN_POSTAL_CODE:'',EZKART_BITESHIP_ORIGIN_ADDRESS:'',EZKART_BITESHIP_ORIGIN_CONTACT_NAME:''});
  const quoted=await f.app.request('/cart/api/rates.php',{cart:{tea:2},postal_code:'12345',seller_id:'seller_bob',origin_postal_code:'99999'});
  assert.equal(quoted.status,200,JSON.stringify(quoted.data));assert.equal(quoted.data.quotes[0].price,18000);
  assert(!JSON.stringify(quoted.data).match(/Original Warehouse|Jalan Saved|081234567891|addr_|settingsRevision/));
  const quote=JSON.parse((await rates(f))[0].body);assert.equal(quote.origin_postal_code,54321);assert.equal(quote.items[0].weight,100);assert.equal(quote.items[0].value,20000);
  assert.equal((await f.app.request('/cart/api/rates.php',{cart:{tea:1,private:1},postal_code:'12345'})).status,422);
  assert.equal((await f.app.request('/cart/api/rates.php',{cart:{private:1},postal_code:'12345'})).status,503);assert.equal((await rates(f)).length,1);
  f.control.fail='/internal/commerce/shipping-settings/seller_alice?environment=sandbox';
  assert.equal((await f.app.request('/cart/api/start.php',input())).status,503);assert.equal((await rates(f)).length,1);assert.equal(await f.count('orders'),0);assert.equal((await f.providerCalls()).length,0);
});

test('a seller move during a quote refuses checkout; accepted orders retain their origin and return address after later edits',async t=>{
  const f=await setupCentralFixture(t),request=input();let changed=false;
  f.control.afterResponse=async target=>{if(!changed&&target.startsWith('/internal/commerce/shipping-settings/')){changed=true;const configuration={...shippingConfiguration,addresses:[{...shippingAddress,address:'Jalan New Pickup 70',postalCode:'12340'}]};assert.equal((await save(f,configuration)).status,200);}};
  const conflict=await f.app.request('/cart/api/start.php',request);assert.equal(conflict.status,422,JSON.stringify(conflict.data));assert.equal(await f.count('orders'),0);assert.equal((await f.providerCalls()).length,0);
  f.control.afterResponse=null;const created=await f.app.request('/cart/api/start.php',request);assert.equal(created.status,201,JSON.stringify(created.data));
  const order=await f.record(created.data.order_id);assert.equal(order.snapshot.shipping.settingsRevision,2);assert.match(order.snapshot.shipping.origin.origin_address,/Jalan New Pickup 70/);assert.equal(order.snapshot.shipping.returnAddress.postalCode,'12340');
  await save(f,{...shippingConfiguration,addresses:[],pickupAddressId:'',returnAddressId:''});const calls=(await rates(f)).length;
  const replay=await f.app.request('/cart/api/start.php',request);assert.equal(replay.data.order_id,order.id);assert.equal((await rates(f)).length,calls);assert.equal((await f.providerCalls()).length,1);assert.deepEqual((await f.record(order.id)).snapshot.shipping,order.snapshot.shipping);
});

test('instant rates require both pins, query their saved coordinates, and filter disabled couriers and malformed provider prices',async t=>{
  const f=await setupCentralFixture(t),coordinate={latitude:-6.2,longitude:106.8};
  await save(f,{...shippingConfiguration,addresses:[{...shippingAddress,coordinate}],couriers:['jne','grab']});
  const rate=(company,type,price)=>({courier_code:company,courier_service_code:type,courier_name:company,courier_service_name:type,price});
  await writeFile(join(f.app.directory,'rates-control.json'),JSON.stringify({jne:[rate('jne','reg',18000),rate('jnt','ez',4000),rate('jne','yes',1.5),rate('jne','same_day',19000)],grab:[rate('grab','instant',25000)]}));
  const without=await f.app.request('/cart/api/rates.php',{cart:{tea:2},postal_code:'12345'});assert.equal(without.status,200);assert.deepEqual(without.data.quotes.map(q=>q.id),['jne-reg']);assert.equal((await rates(f)).length,1);
  const destination={latitude:-6.21,longitude:106.81},withPin=await f.app.request('/cart/api/rates.php',{cart:{tea:2},postal_code:'12345',coordinate:destination});assert.equal(withPin.status,200);assert.deepEqual(withPin.data.quotes.map(q=>q.id),['jne-reg','jne-same-day','grab-instant']);
  const payload=JSON.parse((await rates(f)).at(-1).body);assert.equal(payload.origin_latitude,coordinate.latitude);assert.equal(payload.destination_longitude,destination.longitude);assert(!('origin_postal_code' in payload));
  const checkout=input();checkout.shipping_id='grab-instant';checkout.expected_total=65000;assert.equal((await f.app.request('/cart/api/start.php',checkout)).status,201);
  await save(f,{...shippingConfiguration,addresses:[{...shippingAddress,coordinate}],couriers:['grab']});
  assert.equal((await f.app.request('/cart/api/rates.php',{cart:{tea:1},postal_code:'12345'})).status,422);
});

async function browserFixture(t,overrides={}){
  const f=await setupCentralFixture(t,overrides),{chromium}=await import('../builder-mcp/node_modules/playwright/index.mjs'),browser=await chromium.launch({headless:true});t.after(()=>browser.close());
  const page=await browser.newPage({viewport:{width:1360,height:980}}),errors=[];page.on('pageerror',error=>errors.push(error.message));page.on('console',message=>{if(/violates.*Content Security Policy/.test(message.text()))errors.push(message.text());});
  await page.context().addCookies([f.app.adminCookie({supabase_access_token:await f.merchantToken('alice','alice@example.test'),admin_user:{id:'alice',email:'alice@example.test'}})]);
  await page.route('**/tracking-map-style.json?*',route=>route.fulfill({json:{version:8,sources:{},layers:[{id:'background',type:'background',paint:{'background-color':'#eef1f4'}}]}}));
  const open=async()=>{const response=await page.goto(f.app.base+'/cart/admin/?page=shipping-settings');assert.match(response.headers()['content-security-policy'],/connect-src 'self' https:\/\/tiles.openfreemap.org; worker-src 'self' blob:/);await page.locator('[data-shipping-edit]').first().waitFor();};
  const shot=async name=>{if(process.env.EZKART_TEST_SCREENSHOTS){await mkdir(process.env.EZKART_TEST_SCREENSHOTS,{recursive:true});await page.screenshot({path:join(process.env.EZKART_TEST_SCREENSHOTS,name+'.png'),fullPage:true,animations:'disabled'});}};
  return {...f,page,errors,open,shot};
}

test('merchant shipping saves addresses and courier choices with mobile review and exact recovery after a lost save and reload',async t=>{
  const f=await browserFixture(t),{page}=f,bodies=[];let lose=false,reject=false;
  await page.route('**/cart/admin/?cloud=*',async route=>{const target=new URL(route.request().url()).searchParams.get('cloud');
    if(target==='/v1/shipping-address-search'){await route.fulfill({json:{ok:true,results:[{name:'Returns desk',address:'Jakarta, Indonesia',coordinate:{latitude:-6.2,longitude:106.8}}]}});return;}
    if(target===path&&route.request().method()==='PUT'){bodies.push(route.request().postData());if(lose){lose=false;const response=await route.fetch();assert.equal(response.status(),200,await response.text());await route.abort();return;}if(reject){reject=false;await route.fulfill({status:409,json:{ok:false,error:'Settings could not be confirmed'}});return;}}
    await route.continue();});
  await f.open();await page.locator('[data-shipping-add]').click();
  const fields={label:'Returns desk',name:'Return Contact',phone:'081234567899',email:'returns@example.test',organization:'Return Company',address:'Jalan Return Warehouse 21',location:'Jakarta Selatan',postalCode:'12345',note:'Use the rear entrance'};
  for(const [name,value] of Object.entries(fields))await page.locator(`[data-shipping-address-form] [name="${name}"]`).fill(value);
  await page.locator('.address-picker-query').fill('-6.2, 106.8');await page.locator('[data-find]').click();await page.waitForFunction(()=>document.querySelector('.address-picker-status').textContent.includes('Suggested location')&&document.querySelector('.address-picker-loading').hidden);
  await page.locator('[data-shipping-confirm-pin]').click();await page.waitForFunction(()=>document.querySelector('.address-picker-status').textContent.includes('Entrance confirmed'));
  await f.shot('shipping-address-1360');await page.setViewportSize({width:390,height:940});await page.waitForFunction(()=>document.querySelector('.sidebar').getBoundingClientRect().right<=1);assert.equal(await page.locator('[data-shipping-address-dialog]').evaluate(e=>e.scrollWidth<=e.clientWidth+1),true);await f.shot('shipping-address-390');await page.setViewportSize({width:1360,height:980});
  await page.getByRole('button',{name:'Use this address',exact:true}).click();assert.equal(await page.locator('[data-shipping-edit]').count(),2);
  const id=await page.locator('[data-shipping-edit]').last().getAttribute('data-shipping-edit');await page.locator('[data-shipping-return]').selectOption(id,{force:true});
  await page.locator('[data-shipping-couriers] input[value="grab"]').check();
  // The pickup location needs its own pin before enabling instant service.
  await page.locator('[data-shipping-pickup]').selectOption(id,{force:true});
  await page.locator('[data-shipping-save]').click();assert.match(await page.locator('[data-shipping-preview]').innerText(),/Returns desk/);
  await f.shot('shipping-review-1360');await page.setViewportSize({width:390,height:940});await page.waitForFunction(()=>document.querySelector('.sidebar').getBoundingClientRect().right<=1);assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);assert.equal(await page.locator('[data-shipping-review]').evaluate(e=>e.scrollWidth<=e.clientWidth+1),true);await f.shot('shipping-review-390');
  lose=true;await page.locator('[data-shipping-confirm]').click();await page.waitForFunction(()=>!document.querySelector('[data-shipping-review-error]').hidden);assert.equal((await read(f)).revision,2);
  await page.reload();await page.locator('[data-shipping-retry]').waitFor();await page.locator('[data-shipping-retry]').click();reject=true;await page.locator('[data-shipping-confirm]').click();await page.waitForFunction(()=>document.querySelector('[data-shipping-review-error]').textContent.includes('could not be confirmed'));
  assert(await page.evaluate(()=>Boolean(sessionStorage.getItem('ezkart.shipping.pending.seller_alice'))));
  await page.locator('[data-shipping-confirm]').click();await page.waitForFunction(()=>!document.querySelector('[data-shipping-review]').open);assert.equal(new Set(bodies).size,1);assert.equal((await read(f)).revision,2);
  const saved=await read(f);assert.equal(saved.configuration.returnAddressId,id);assert.equal(saved.configuration.addresses[1].coordinate.latitude,-6.2);assert(saved.configuration.couriers.includes('grab'));
  assert.equal(await page.evaluate(()=>sessionStorage.getItem('ezkart.shipping.pending.seller_alice')),null);await f.shot('shipping-saved-390');
  assert.equal(await page.locator('[data-shipping-pickup]').evaluate(e=>CSS.supports('appearance','base-select')||!!e.closest('.ezkart-select')),true);
  await page.setViewportSize({width:1360,height:980});await f.shot('shipping-saved-1360');
  await page.locator('[data-shipping-edit]').last().click();await page.locator('[data-shipping-address-form] [name="label"]').fill('Pickup and returns');await page.getByRole('button',{name:'Use this address',exact:true}).click();
  await page.locator('[data-shipping-remove]').first().click();await page.locator('[data-shipping-confirm]').click();await page.locator('[data-shipping-save]').click();await page.locator('[data-shipping-confirm]').click();await page.waitForFunction(()=>!document.querySelector('[data-shipping-review]').open);
  const edited=await read(f);assert.equal(edited.revision,3);assert.equal(edited.configuration.addresses.length,1);assert.equal(edited.configuration.addresses[0].label,'Pickup and returns');assert.equal(edited.configuration.addresses[0].coordinate.latitude,-6.2);assert.deepEqual(f.errors,[]);
});

test('shipping editor retains stale edits, rejects unauthorized search and prevents writes without request recovery storage',async t=>{
  const f=await browserFixture(t),{page}=f;await f.open();
  const url=f.app.base+'/cart/admin/?cloud='+encodeURIComponent('/v1/shipping-address-search');assert.equal((await fetch(url,{method:'POST',body:'{}'})).status,401);
  assert.equal(await page.evaluate(async url=>(await fetch(url,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({address:'Jakarta'})})).status,url),403);
  await page.locator('[data-shipping-couriers] input[value="tiki"]').check();await save(f,{...shippingConfiguration,couriers:['jne']});
  await page.locator('[data-shipping-save]').click();await page.locator('[data-shipping-confirm]').click();await page.waitForFunction(()=>document.querySelector('[data-shipping-review-error]').textContent.includes('another session'));
  assert.equal((await read(f)).revision,2);assert.equal(await page.locator('[data-shipping-couriers] input[value="tiki"]').isChecked(),true);assert.equal(await page.evaluate(()=>sessionStorage.getItem('ezkart.shipping.pending.seller_alice')),null);
  await page.keyboard.press('Escape');await page.locator('[data-shipping-reload]').click();await page.locator('[data-shipping-confirm]').click();await page.waitForFunction(()=>document.querySelector('[data-shipping-couriers] input[value="tiki"]').checked===false);
  await page.evaluate(()=>{const original=Storage.prototype.setItem;Storage.prototype.setItem=function(key,value){if(key.startsWith('ezkart.shipping.pending.'))throw Error('Session storage is blocked');return original.call(this,key,value);};});
  await page.locator('[data-shipping-couriers] input[value="tiki"]').check();await page.locator('[data-shipping-save]').click();await page.locator('[data-shipping-confirm]').click();await page.waitForFunction(()=>document.querySelector('[data-shipping-review-error]').textContent.includes('storage'));
  assert.equal((await read(f)).revision,2);await page.keyboard.press('Escape');
  page.on('dialog',dialog=>dialog.accept());await f.db.prepare("UPDATE seller_memberships SET role='viewer' WHERE auth_user_id='alice'").run();await page.reload();await page.waitForFunction(()=>document.querySelector('[data-shipping-status]').textContent.includes('cannot change'));
  assert.equal(await page.locator('[data-shipping-add]').isDisabled(),true);assert.equal(await page.locator('[data-shipping-edit]').first().isDisabled(),true);assert.deepEqual(f.errors,[]);
});

test('unavailable map data cannot confirm a suggested pin and still permits a standard-courier address',async t=>{
  const f=await browserFixture(t),{page}=f;
  await page.route('**/tracking-map-style.json?*',route=>route.abort());
  await page.route('**/cart/admin/?cloud=*',async route=>{
    if(new URL(route.request().url()).searchParams.get('cloud')==='/v1/shipping-address-search')await route.fulfill({json:{ok:true,results:[{name:'Map unavailable',address:'Jakarta',coordinate:{latitude:-6.2,longitude:106.8}}]}});
    else await route.continue();
  });
  await f.open();await page.locator('[data-shipping-add]').click();
  for(const [name,value] of Object.entries({label:'Standard pickup',name:'Warehouse Contact',phone:'081234567891',address:'Jalan Standard Warehouse 1',location:'Jakarta',postalCode:'12345'}))await page.locator(`[data-shipping-address-form] [name="${name}"]`).fill(value);
  await page.locator('.address-picker-query').fill('-6.2,106.8');await page.locator('[data-find]').click();
  await page.waitForFunction(()=>document.querySelector('.address-picker-loading').textContent.includes('unavailable'));
  await page.locator('[data-shipping-confirm-pin]').click();assert.equal(await page.locator('[data-shipping-address-error]').isVisible(),true);
  await page.getByRole('button',{name:'Use this address',exact:true}).click();await page.locator('[data-shipping-save]').click();await page.locator('[data-shipping-confirm]').click();await page.waitForFunction(()=>!document.querySelector('[data-shipping-review]').open);
  const saved=await read(f);assert.equal(saved.configuration.addresses.length,2);assert.equal(saved.configuration.addresses[1].coordinate,undefined);assert.deepEqual(f.errors,[]);
  const ordinary=await fetch(f.app.base+'/cart/admin/?page=settings');assert.match(ordinary.headers.get('content-security-policy'),/connect-src 'self';/);assert(!ordinary.headers.get('content-security-policy').includes('worker-src'));
});
