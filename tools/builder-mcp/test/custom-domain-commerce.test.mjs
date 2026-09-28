import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,writeFile,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {chromium} from 'playwright';
import {Workspace,repoRoot} from '../workspace.mjs';
import {customDomainResponse} from '../../../cloudflare/ezkart-api/src/custom-domains.js';

test('real published commerce export loads on a custom origin and opens canonical checkout with the correct tenant and return URL',async t=>{
 const dir=await mkdtemp(join(tmpdir(),'ezkart-domain-commerce-')),ws=await new Workspace(dir).init();
 const canonical='https://checkout.fixture.com',media='https://media.fixture.com',vanity='https://shop.brand.com';
 await writeFile(join(dir,'catalog.json'),JSON.stringify({storageScope:'seller_alice',publicBase:canonical+'/cart/admin/',mediaBase:media,demoCheckout:false,products:[{id:'coffee',name:'House Blend',type:'physical',status:'active',price:79000,stock:12,media:[{id:'coffee_photo'}],variants:[{id:'small',name:'250 g',price:79000,stock:6,imageUploadId:'coffee_photo'},{id:'large',name:'500 g',price:129000,stock:6,imageUploadId:'coffee_large'}]}]}));
 await ws.create({id:'coffee-shop',name:'House Blend coffee',productIds:['coffee']});await ws.start();
 const browser=await chromium.launch(),editor=await browser.newPage({viewport:{width:1400,height:1000}});
 t.after(async()=>{await browser.close();await ws.stop();await rm(dir,{recursive:true,force:true});});
 const artwork=await readFile(join(repoRoot,'cart/admin/assets/builder-choice/kopi-senja-01.webp'));
 await editor.route(media+'/**',route=>route.fulfill({contentType:'image/webp',body:artwork,headers:{'access-control-allow-origin':'*'}}));
 await editor.goto(ws.url+'/cart/admin/?page=sites&edit=coffee-shop.ezkart.site');
 await editor.waitForFunction(()=>globalThis.EzkartBuilder);
 await editor.evaluate(async()=>{
  await EzkartBuilder.nativeInsert({section:'blank',node:{id:'coffee-layout',type:'container',props:{display:'grid',gap:'20px',paddingTop:'24px',paddingRight:'24px',paddingBottom:'24px',paddingLeft:'24px',backgroundColor:'#f1f4f2'},children:[
   {id:'coffee-heading',type:'heading',text:'Choose your House Blend',props:{fontFamily:'"Poppins", sans-serif',fontSize:'32px'}},
   {id:'coffee-image',type:'commerce',part:'image',group:'coffee',productId:'coffee',props:{width:'240px'}},
   {id:'coffee-options',type:'commerce',part:'options',group:'coffee',productId:'coffee'},
   {id:'coffee-price',type:'commerce',part:'price',group:'coffee',productId:'coffee'},
   {id:'coffee-add',type:'commerce',part:'add',group:'coffee',productId:'coffee',label:'Add coffee'},
  ]}});
  await EzkartBuilder.settle();
 });
 await editor.locator('[data-sq-publish]').click();await editor.locator('[data-favicon-publish]').click();
 await editor.locator('[data-sq-published-dialog]').waitFor({state:'visible'});
 const saved=await ws.read('coffee-shop');assert.equal(saved.status,'published');assert.match(saved.publishedHtml,/data-commerce-add/);assert.match(saved.publishedHtml,/@font-face/);assert.match(saved.publishedHtml,/checkout\.fixture\.com\/cart\//);
 const row={id:'dom_fixture',seller_id:'alice',hostname:'shop.brand.com',page_id:'coffee-shop',public_path:'/alice/shop/coffee-shop',cname_target:'shops.ezkart.site',zone_id:'a'.repeat(32),state:'active',provider_status:'active',tls_status:'active',ownership_verified_at:new Date().toISOString(),checked_at:new Date().toISOString()};
 const env={APP_ENVIRONMENT:'beta',CUSTOM_DOMAIN_ZONE_ID:row.zone_id,CUSTOM_DOMAIN_CNAME_TARGET:row.cname_target,CUSTOM_DOMAIN_API_HOSTS:'api.fixture.com',
  DB:{prepare(){return {bind(host){return {first:async()=>host===row.hostname?row:null};}};}},
  PRIVATE_ASSETS:{get:async key=>{assert.equal(key,'sellers/alice/landing-pages/coffee-shop.json');return {json:async()=>saved};}},
 };
 const visitor=await browser.newContext({viewport:{width:390,height:844},reducedMotion:'reduce'}),page=await visitor.newPage();
 const errors=[],violations=[],requests=[],checkoutURLs=[];
 page.on('pageerror',e=>errors.push(e.message));
 await page.addInitScript(()=>{window.policyViolations=[];addEventListener('securitypolicyviolation',e=>policyViolations.push({directive:e.effectiveDirective,url:e.blockedURI}));});
 await visitor.route('**/*',async route=>{
  const request=route.request(),url=new URL(request.url());requests.push(request.url());
  if(url.origin===vanity){const response=await customDomainResponse(new Request(request.url(),{method:request.method()}),env);return route.fulfill({status:response.status,headers:Object.fromEntries(response.headers),body:await response.text()});}
  if(url.origin===media)return route.fulfill({contentType:'image/webp',body:artwork,headers:{'access-control-allow-origin':'*'}});
  if(url.origin===canonical&&url.pathname==='/cart/'){checkoutURLs.push(url);return route.fulfill({contentType:'text/html',body:'<h1>Local checkout destination fixture</h1>'});}
  throw Error('Unexpected public asset or API request: '+request.url());
 });
 const response=await page.goto(vanity+'/');assert.equal(response.status(),200);assert.match(response.headers()['content-security-policy'],/sandbox allow-scripts/);assert.doesNotMatch(response.headers()['content-security-policy'],/allow-same-origin/);
 assert.equal(await page.evaluate(()=>window.origin),'null','Published scripts have an opaque origin');
 await page.locator('[data-native-id=coffee-image] img').evaluate(img=>img.decode());
 assert.equal(await page.locator('[data-native-id=coffee-layout]').evaluate(el=>getComputedStyle(el).display),'grid');
 assert.equal(await page.locator('[data-native-id=coffee-heading]').evaluate(el=>getComputedStyle(el).fontSize),'32px');
 await page.evaluate(()=>document.fonts.ready);
 const fonts=await page.evaluate(()=>[...document.fonts].map(font=>({family:font.family,status:font.status})));assert.ok(fonts.some(font=>font.family==='Poppins' && font.status==='loaded'),JSON.stringify(fonts));
 await page.locator('[data-native-id=coffee-options] input[value=large]').check();
 await page.locator('[data-native-id=coffee-add] [data-commerce-add]').click();
 await page.locator('[data-ezkart-cart-layer].is-open').waitFor();
 assert.match(await page.locator('.ezkart-cart-row').innerText(),/House Blend.*500 g/s);
 await page.locator('.ezkart-cart-row img').evaluate(img=>img.decode());assert.match(await page.locator('.ezkart-cart-row img').getAttribute('src'),/^https:\/\/media\.fixture\.com\//);
 assert.match(await page.locator('[data-ezkart-cart-subtotal]').innerText(),/129[.,]000/);
 const popupPromise=visitor.waitForEvent('page');await page.locator('[data-ezkart-cart-go]').click();const checkout=await popupPromise;await checkout.waitForLoadState();
 assert.equal(checkoutURLs.length,1);const url=checkoutURLs[0];assert.equal(url.searchParams.get('shop'),'seller_alice');assert.equal(url.searchParams.get('cart'),'coffee~large:1');assert.equal(url.searchParams.get('return'),vanity+'/');
 assert.equal(await checkout.evaluate(()=>window.opener),null);assert.ok(requests.some(url=>url.startsWith(media+'/v1/public/media/')));
 violations.push(...await page.evaluate(()=>policyViolations));assert.deepEqual(violations,[]);assert.deepEqual(errors,[]);
 for(const path of ['/v1/catalog','/cart/','/bob/shop/coffee-shop'])assert.equal((await customDomainResponse(new Request(vanity+path),env)).status,404);
 await page.screenshot({path:'/tmp/ezkart-custom-domain-commerce-390.png',fullPage:true});
});
