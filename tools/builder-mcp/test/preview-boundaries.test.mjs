import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp, readFile, writeFile, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {chromium} from 'playwright';
import {Workspace, repoRoot} from '../workspace.mjs';

async function fixture(t) {
  const directory = await mkdtemp(join(tmpdir(), 'ezkart-preview-boundaries-'));
  const ws = await new Workspace(directory).init();
  await writeFile(join(directory,'catalog.json'),JSON.stringify({products:[{id:'granola',name:'Granola Madu Nusantara',price:58000,stock:46,type:'physical',currency:'IDR'}]}));
  await ws.create({id:'boundaries', name:'Page boundaries', productIds:['granola']});
  await ws.start();
  const browser = await chromium.launch();
  const page = await browser.newPage({viewport:{width:1440,height:1000}, reducedMotion:'reduce'});
  page.setDefaultTimeout(8000);
  t.after(async () => { await browser.close(); await ws.stop(); await rm(directory,{recursive:true,force:true}); });
  const call = (method,args={}) => page.evaluate(({method,args}) => EzkartBuilder[method](args),{method,args});
  await page.goto(ws.url+'/cart/admin/?page=sites&edit=boundaries.ezkart.site');
  await page.waitForFunction(() => globalThis.EzkartBuilder);
  await call('settle');
  const preview = async () => {
    await page.locator('[data-sq-preview]').click();
    const frame = await page.locator('[data-sq-live-preview-frame]').elementHandle().then(n=>n.contentFrame());
    await frame.locator('body > .sq-page-preview').waitFor();
    return frame;
  };
  return {page,browser,ws,call,preview};
}

test('Preview crops oversized content to the screen by default and its toggle preserves dimensions, history, saves and exported output', async t => {
  const {page,call,preview,browser} = await fixture(t);
  await call('nativeInsert',{section:'blank',node:{id:'wide-image',type:'image',autoLayout:false,src:'/cart/admin/assets/products/kopi-susu.webp',props:{position:'relative',width:'700px',maxWidth:'none',height:'auto',left:'-100px'}}});
  let frame = await preview();
  await page.locator('[data-sq-preview-device=mobile]').click();
  await frame.waitForFunction(() => innerWidth===390);
  const cropped = () => frame.evaluate(() => document.documentElement.scrollWidth<=innerWidth);
  const toggle = page.getByRole('checkbox',{name:'Crop to screen'});
  assert.equal(await toggle.isChecked(),true);
  assert.equal(await cropped(),true,'Oversized images do not widen the mobile page');
  assert.equal(await frame.locator('#native-wide-image').evaluate(n=>n.offsetWidth),700,'Cropping keeps the authored image size');
  if(process.env.EZKART_PREVIEW_SCREENSHOTS)await page.screenshot({path:join(process.env.EZKART_PREVIEW_SCREENSHOTS,'cropped-mobile.png')});
  await toggle.uncheck();
  await frame.waitForFunction(() => document.documentElement.scrollWidth>innerWidth);
  if(process.env.EZKART_PREVIEW_SCREENSHOTS)await page.screenshot({path:join(process.env.EZKART_PREVIEW_SCREENSHOTS,'uncropped-mobile.png')});
  assert.equal(await frame.locator('#native-wide-image').evaluate(n=>n.offsetWidth),700);
  await page.locator('[data-sq-preview-close]').click();
  await call('undo');
  assert.equal(await page.locator('.sq-page-preview').evaluate(n=>n.classList.contains('sq-overflow-visible')),false);
  await call('redo');
  await call('save');
  await page.reload(); await page.waitForFunction(() => globalThis.EzkartBuilder); await call('settle');
  frame=await preview();
  assert.equal(await toggle.isChecked(),false,'The crop preference is saved with this page');
  await page.locator('[data-sq-preview-device=mobile]').click();
  await frame.waitForFunction(() => innerWidth===390 && document.documentElement.scrollWidth>innerWidth);
  await toggle.check();
  await frame.waitForFunction(() => document.documentElement.scrollWidth===innerWidth);
  for (const width of [941,768,390]) {
    await page.setViewportSize({width,height:1000});
    const control=await toggle.boundingBox(),close=await page.locator('[data-sq-preview-close]').boundingBox();
    assert.ok(control.x>=0 && control.x+control.width<=width,'The crop control fits narrow Preview headers');
    assert.ok(close.x>=0 && close.x+close.width<=width,'Close remains reachable');
  }
  if(process.env.EZKART_PREVIEW_SCREENSHOTS)await page.screenshot({path:join(process.env.EZKART_PREVIEW_SCREENSHOTS,'narrow-preview.png')});
  const exported=await browser.newPage({viewport:{width:390,height:900},isMobile:true});
  await exported.setContent(await call('previewHtml'));
  assert.equal(await exported.evaluate(() => innerWidth),390,'Mobile browsers keep the screen viewport instead of zooming out to fit oversized content');
  assert.equal(await exported.evaluate(() => document.documentElement.scrollWidth<=innerWidth),true);
  assert.equal(await exported.locator('#native-wide-image').evaluate(n=>n.offsetWidth),700);
  await exported.close();
});

test('checkout from the isolated builder Preview opens a normal tab and loads the real cart UI without CORS failures', async t => {
  const {page,call,preview,ws} = await fixture(t);
  const context=page.context(), failures=[];
  context.on('requestfailed',request=>{if(/\/cart\/api\/(catalog|checkout-config)\.php/.test(request.url()))failures.push(request.failure()?.errorText);});
  await context.route(url => url.pathname==='/cart/' || /^\/cart\/[a-z-]+\.(js|css)$/.test(url.pathname), async route => {
    const path=new URL(route.request().url()).pathname;
    const file=path==='/cart/'?'cart/index.html':path.slice(1);
    await route.fulfill({body:await readFile(join(repoRoot,file)),contentType:file.endsWith('.js')?'text/javascript':file.endsWith('.css')?'text/css':'text/html'});
  });
  await context.route('**/cart/api/checkout-config.php', route => route.fulfill({json:{ok:true,environment:'sandbox',shipping_required:false}}));
  await context.route('**/cart/api/catalog.php?*', route => route.fulfill({json:{ok:true,products:[{id:'granola',name:'Granola Madu Nusantara',price:58000,stock:46,weight:320,seller_id:'demo',type:'physical'}]}}));
  await context.route('**/cart/admin/customer-addresses.php*', route => route.fulfill({json:{ok:true,authenticated:false,addresses:[]}}));
  await call('nativeInsert',{section:'blank',node:{id:'buy-granola',type:'commerce',part:'add',productId:'granola',props:{width:'240px'}}});
  const frame=await preview();
  assert.equal(await frame.evaluate(() => window.origin),'null','Preview remains isolated');
  assert.equal(await frame.evaluate(() => {try{return Boolean(parent.document)}catch{return false}}),false);
  await frame.locator('#native-buy-granola button').click();
  const popupPromise=context.waitForEvent('page');
  await frame.locator('[data-ezkart-cart-go]').click();
  const checkout=await popupPromise;
  await checkout.locator('[data-cart-id=granola]').waitFor();
  assert.equal(await checkout.evaluate(() => window.origin),ws.url);
  assert.equal(await checkout.evaluate(() => window.opener),null);
  assert.equal(await checkout.locator('#catalog-error').isVisible(),false);
  assert.equal(await checkout.locator('[data-cart-id=granola] output').innerText(),'1');
  assert.deepEqual(failures,[]);
  if(process.env.EZKART_PREVIEW_SCREENSHOTS)await checkout.screenshot({path:join(process.env.EZKART_PREVIEW_SCREENSHOTS,'checkout.png')});
  assert.ok(await page.locator('#landing-preview-dialog').isVisible(),'The editor and preview remain open');
  await checkout.close();
});
