import test from 'node:test';
import assert from 'node:assert/strict';
import {writeFile, readFile, mkdir} from 'node:fs/promises';
import {join} from 'node:path';
import {setup} from './fixture.mjs';

const components = {address:'Jl. Teluk Betung No. 12',location:'Jakarta',postalCode:'10230'};
const query = Object.values(components).join(', ');
const point = {latitude:-6.1957601,longitude:106.8214547};
const feature = (properties={}, coordinate=point) => ({geometry:{type:'Point',coordinates:[coordinate.longitude,coordinate.latitude]},properties:{name:'Delivery building',type:'house',street:'Jalan Teluk Betung',housenumber:'12',city:'Jakarta',postcode:'10230',countrycode:'ID',...properties}});
async function fixture(t, overrides={}) {
  const app=await setup({EZKART_CLOUDFLARE_API_URL:'https://ezkart-api-test.fixture.workers.dev',...overrides});t.after(()=>app.close());
  const cookie=app.customerCookie(),auth={Cookie:`${cookie.name}=${cookie.value}`};
  const csrf=(await app.request('/cart/admin/customer-addresses.php',undefined,auth)).data.csrf;
  return {...app,search:(body)=>app.request('/cart/api/address-search.php',body,{...auth,'X-Ezkart-CSRF':csrf}),
    features:(features)=>writeFile(join(app.directory,'address-response.json'),JSON.stringify({features}))};
}

test('structured address search keeps street, house number, locality and postcode independent; rejects conflicting locations and ranks a complete building match first',async t=>{
  const f=await fixture(t);
  await f.features([
    feature({name:'District center',type:'city',street:'',housenumber:''}),
    feature({name:'Wrong house',housenumber:'120'}),
    feature({name:'Wrong city',city:'Surabaya'}),
    feature({name:'Wrong postcode',postcode:'60111'}),
    feature(),
  ]);
  const response=await f.search({address:query,components});
  assert.equal(response.status,200,JSON.stringify(response.data));
  assert.equal(response.data.results.length,3);
  assert.equal(response.data.results[0].name,'Delivery building');
  assert.equal(response.data.results[0].auto_select,true);
  assert.equal(response.data.results[1].auto_select,false);
  const url=new URL((await f.calls()).find(call=>/photon\.komoot\.io/.test(call.url)).url);
  assert.equal(url.pathname,'/structured');
  assert.equal(url.searchParams.get('street'),'Jalan Teluk Betung');
  assert.equal(url.searchParams.get('housenumber'),'12');
  assert.equal(url.searchParams.get('city'),'Jakarta');
  assert.equal(url.searchParams.get('postcode'),'10230');
  assert.equal(url.searchParams.get('q'),null);
  await f.search({address:query,components});assert.equal((await f.calls()).filter(call=>/photon\.komoot\.io/.test(call.url)).length,1);
  for(const invalid of [{address:[]},{postalCode:'12'},{location:'x'.repeat(121)},'Jakarta'])assert.equal((await f.search({address:query,components:invalid})).status,422);
});

test('duplicate precise candidates, missing house numbers and street centers never auto-select a delivery pin',async t=>{
  for(const features of [[feature(),feature({name:'Second entrance'},{latitude:-6.196,longitude:106.823})],
    [feature({type:'street',housenumber:''})],[feature({housenumber:''})],[feature({housenumber:'12-20'})]]) {
    const f=await fixture(t);await f.features(features);
    const response=await f.search({address:query,components});
    assert.equal(response.status,200);
    assert(response.data.results.every(p=>p.auto_select===false),JSON.stringify(response.data.results));
  }
});

test('desktop and phone address forms expose approximate results without creating a pin; an explicit building selection saves the selected coordinates',async t=>{
  const f=await fixture(t,{EZKART_CLOUDFLARE_API_URL:'https://ezkart-api-test.fixture.workers.dev'});
  const {chromium}=await import('../builder-mcp/node_modules/playwright/index.mjs');
  const browser=await chromium.launch({headless:true});t.after(()=>browser.close());
  for(const width of [1280,390]) {
    const page=await browser.newPage({viewport:{width,height:950}});t.after(()=>page.close());
    const errors=[];page.on('pageerror',e=>errors.push(e.message));
    await page.context().addCookies([f.customerCookie()]);
    await page.route('**/tracking-map-style.json?*',route=>route.fulfill({json:{version:8,sources:{},layers:[{id:'background',type:'background',paint:{'background-color':'#eef1f4'}}]}}));
    await page.addInitScript(()=>{window.__mapCaptured=false;});
    await page.route('**/vendor/maplibre/maplibre-gl.js?*',async route=>{
      const response=await route.fetch();await route.fulfill({response,body:await response.text()+'\n;const OriginalMap=maplibregl.Map;maplibregl.Map=class extends OriginalMap {constructor(...args){super(...args);window.testAddressMap=this;}};'});
    });
    const payloads=[];
    await page.route('**/api/address-search.php',async route=>{
      payloads.push(route.request().postDataJSON());
      await route.fulfill({json:{ok:true,results:[{name:'Area center',address:'Jakarta',precision:'area',kind:'Area match',auto_select:false,coordinate:point}]}});
    });
    await page.goto(f.base+'/cart/addresses.php?new=1');
    const editor=page.getByRole('dialog');
    await editor.getByLabel('Full address',{exact:true}).fill(components.address);
    await editor.getByLabel('District / city',{exact:true}).fill(components.location);
    await editor.getByLabel('Postcode',{exact:true}).fill(components.postalCode);
    await editor.locator('.address-picker-status').filter({hasText:'Only approximate locations'}).waitFor();
    await editor.locator('.address-picker-loading').waitFor({state:'hidden'});
    assert.deepEqual(payloads.at(-1).components,components);
    assert.equal(await editor.locator('.address-picker-pin').isVisible(),false);
    await editor.getByRole('button',{name:/Area center/}).click();
    await editor.locator('.address-picker-loading').waitFor({state:'hidden'});
    // Zooming an approximate center is not evidence of a selected entrance.
    await page.evaluate(()=>testAddressMap.setZoom(17));
    assert.equal(await editor.locator('.address-picker-pin').isVisible(),false);
    assert.equal(await editor.getByLabel('Full address',{exact:true}).inputValue(),components.address);
    await page.unroute('**/api/address-search.php');
    await page.route('**/api/address-search.php',route=>route.fulfill({json:{ok:true,results:[{name:'Building A',address_line:components.address,location:components.location,postalCode:components.postalCode,precision:'address',auto_select:false,coordinate:point},{name:'Building B',precision:'address',auto_select:false,coordinate:{latitude:-6.196,longitude:106.823}}]}}));
    await editor.getByRole('button',{name:'Find address',exact:true}).click();
    await editor.getByRole('button',{name:/Building A/}).waitFor();
    assert.equal(await editor.locator('.address-picker-pin').isVisible(),false);
    await editor.getByRole('button',{name:/Building B/}).click();
    await editor.locator('.address-picker-loading').waitFor({state:'hidden'});
    assert.equal(await editor.locator('.address-picker-pin').isVisible(),true);
    if(process.env.EZKART_TEST_SCREENSHOTS) {
      await mkdir(process.env.EZKART_TEST_SCREENSHOTS,{recursive:true});
      await page.screenshot({path:join(process.env.EZKART_TEST_SCREENSHOTS,`address-matching-${width}.png`),fullPage:true});
    }
    assert.deepEqual(errors,[]);
    await editor.getByLabel('Address name',{exact:true}).fill('Selected building '+width);
    await editor.getByRole('button',{name:'Save address',exact:true}).click();
    await editor.waitFor({state:'hidden'});
    const book=JSON.parse(await readFile(join(f.directory,'address-book.json'),'utf8'));
    assert.deepEqual(book.addresses.find(a=>a.label==='Selected building '+width).coordinate,{latitude:-6.196,longitude:106.823});
  }
});

test('a hidden tab can finish map loading after returning without a false unavailable state',async t=>{
  const f=await fixture(t);
  const {chromium}=await import('../builder-mcp/node_modules/playwright/index.mjs');
  const browser=await chromium.launch({headless:true});t.after(()=>browser.close());
  const page=await browser.newPage();await page.context().addCookies([f.customerCookie()]);
  await page.clock.install();
  await page.addInitScript(()=>{window.testHidden=true;Object.defineProperty(document,'hidden',{get:()=>window.testHidden});});
  let mapStyle;let announce;const requested=new Promise(resolve=>announce=resolve);
  await page.route('**/tracking-map-style.json?*',route=>{mapStyle=route;announce();});
  await page.goto(f.base+'/cart/addresses.php?new=1');await requested;
  await page.clock.fastForward(25000);
  const loading=page.getByRole('dialog').locator('.address-picker-loading');
  assert.equal(await loading.innerText(),'Loading map…');
  await page.evaluate(()=>{window.testHidden=false;document.dispatchEvent(new Event('visibilitychange'));});
  await mapStyle.fulfill({json:{version:8,sources:{},layers:[{id:'background',type:'background',paint:{'background-color':'#eef1f4'}}]}});
  await loading.waitFor({state:'hidden'});
  assert.equal(await page.getByRole('button',{name:'Retry map',exact:true}).count(),0);
});
