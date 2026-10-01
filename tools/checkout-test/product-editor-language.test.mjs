import {test} from 'node:test';
import assert from 'node:assert/strict';
import {writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {chromium} from '../builder-mcp/node_modules/playwright/index.mjs';
import {setup} from './fixture.mjs';

test('Indonesian product editor translates categories and physical, digital and subscription controls without changing stored values',async t=>{
 const app=await setup({EZKART_CLOUDFLARE_API_URL:'https://ezkart-api-test.fixture.workers.dev'});t.after(()=>app.close());
 await writeFile(join(app.directory,'storefront.json'),JSON.stringify({store:{sellerId:'seller_fixture'},products:[],catalog:[],drafts:[]}));
 const browser=await chromium.launch();t.after(()=>browser.close());const context=await browser.newContext({viewport:{width:941,height:904}});await context.addCookies([app.adminCookie()]);const errors=[],writes=[];
 await context.route('**/*',async route=>{
  const url=new URL(route.request().url()),cloud=url.searchParams.get('cloud');if(url.hostname!=='127.0.0.1')return route.abort();
  if(cloud?.startsWith('/v1/products')){writes.push(cloud);return route.abort();}
  if(cloud==='/v1/catalog')return route.fulfill({json:{ok:true,products:[],drafts:[]}});
  if(cloud==='/v1/admin-profile')return route.fulfill({json:{ok:true,profile:{logoId:'',canEdit:true}}});
  if(cloud)return route.fulfill({json:{ok:true,items:[],notifications:[],unreadCount:0}});
  if(url.pathname==='/cart/admin/') {const response=await route.fetch();return route.fulfill({response,body:(await response.text()).replace('<body class=','<body data-admin-language="id" class=')});}
  return route.continue();
 });
 const page=await context.newPage();page.on('pageerror',e=>errors.push(e.message));await page.goto(app.base+'/cart/admin/?page=product-new');
 await page.locator('[data-product-category-open]').click();const dialog=page.locator('[data-product-category-dialog]');
 await dialog.getByRole('button',{name:'Makanan & Minuman',exact:true}).click();await dialog.getByRole('button',{name:'Minuman',exact:true}).click();await dialog.getByRole('button',{name:'Kopi',exact:true}).click();
 assert.equal(await page.locator('[data-product-category-selection]').textContent(),'Makanan & Minuman > Minuman > Kopi');await page.locator('[data-product-category-confirm]').click();assert.equal(await page.locator('[name=category]').inputValue(),'Food & Beverages > Beverages > Coffee');assert.equal(await page.locator('[data-product-category-value]').textContent(),'Kopi');
 await page.locator('[name=name]').fill('Orders');assert.equal(await page.locator('[name=name]').inputValue(),'Orders');
 await page.locator('.product-variant-switch').click();await page.locator('[data-generate-variants]').click();await page.locator('.product-variant-row').nth(3).waitFor();assert.equal(await page.locator('[data-generate-variants-label]').textContent(),'Perbarui kombinasi');await page.locator('[data-select-all-variants]').check();await page.waitForFunction(()=>document.querySelector('[data-variant-selected-count]').textContent==='4 dipilih');assert.equal(await page.locator('[data-select-all-variants]').getAttribute('aria-label'),'Pilih semua varian');
 await page.locator('[data-product-type-trigger]').click();await page.locator('[data-product-type-option=subscription]').click();await page.waitForFunction(()=>document.querySelector('[data-variant-section-title]').textContent==='Paket langganan');assert.equal(await page.locator('[data-select-all-variants]').getAttribute('aria-label'),'Pilih semua paket');assert.equal(await page.locator('[data-product-create-type]').inputValue(),'subscription');
 await page.locator('[data-product-type-trigger]').click();await page.locator('[data-product-type-option=digital]').click();await page.locator('[data-digital-file-editor]').waitFor();assert.equal(await page.getByRole('button',{name:'Pilih berkas',exact:true}).count(),1);assert.equal(await page.locator('[data-product-create-type]').inputValue(),'digital');
 for(const width of [390,941,1440]){await page.setViewportSize({width,height:904});assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);}
 assert.deepEqual(writes,[]);assert.deepEqual(errors,[]);
});
