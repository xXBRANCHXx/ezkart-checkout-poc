import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {chromium} from 'playwright';
import {Workspace,repoRoot} from '../workspace.mjs';

async function fixture(t){
 const dir=await mkdtemp(join(tmpdir(),'ezkart-image-preview-')),ws=await new Workspace(dir).init();
 await writeFile(join(dir,'catalog.json'),JSON.stringify({demoCheckout:true,products:[{id:'coffee',name:'House Blend',status:'active',type:'physical',price:79000,stock:20,variants:[{id:'small',name:'250 g',price:79000,stock:10},{id:'large',name:'500 g',price:129000,stock:10}]}]}));
 await ws.start();const browser=await chromium.launch(),page=await browser.newPage({viewport:{width:1440,height:1000},reducedMotion:'reduce'}),errors=[];
 page.on('pageerror',e=>errors.push(e.message));page.setDefaultTimeout(10000);
 t.after(async()=>{await browser.close();await ws.stop();await rm(dir,{recursive:true,force:true});assert.deepEqual(errors,[]);});
 await page.goto(ws.url+'/cart/admin/?page=sites');await page.locator('[data-library-create-card]').click();await page.locator('[data-bc-choose=image]').click();await page.locator('[name=page_name]').fill('Fast preview');await page.locator('[data-library-page-form] button[value=default]').click();await page.waitForURL('**edit=fast-preview.ezkart.site');
 await page.locator('[data-image-page-upload]').setInputFiles([1,2,3,4].map(i=>join(repoRoot,`cart/admin/assets/builder-choice/kopi-senja-0${i}.webp`)));
 await page.waitForFunction(()=>document.querySelectorAll('.ib-row').length===4&&!document.querySelector('.ib-controls').disabled);
 await page.locator('[data-image-page-product]').selectOption('coffee');await page.locator('[data-image-nav=enabled]').check();
 await page.frameLocator('.ib-phone').locator('.sq-image-navigation').waitFor();
 return {ws,browser,page,errors};
}
const navValue=(page,key)=>page.evaluate(key=>JSON.parse(document.querySelector('[data-image-page]').dataset.imageNavigation)[key],key);

test('navbar colors preview immediately without rebuilding the page; apply, cancel, history and checkout state remain correct',async t=>{
 const {page,browser}=await fixture(t),phone=page.frameLocator('.ib-phone');
 await phone.locator('[data-product-card] select').selectOption('500 g');await phone.locator('[data-ezkart-add]').click();await phone.locator('.ezkart-cart-layer.is-open').waitFor();await phone.locator('.ezkart-cart-close').click();await phone.locator('[data-ezkart-cart-layer]').waitFor({state:'hidden'});
 const frame=page.frames().find(f=>f.url()==='about:srcdoc');
 await frame.evaluate(()=>{window.previewInstance=crypto.randomUUID();scrollTo({top:400,behavior:'instant'});});
 const instance=await frame.evaluate(()=>window.previewInstance),scroll=await frame.evaluate(()=>scrollY);
 await page.evaluate(()=>{window.previewReloads=0;document.querySelector('.ib-phone').addEventListener('load',()=>window.previewReloads++);window.artworkBefore=document.querySelector('[data-image-upload]');window.cardBefore=document.querySelector('[data-product-card]');});
 const color=page.locator('[data-image-nav=color]'),hex=page.locator('[data-sq-color-hex]');
 await color.click();await hex.fill('#ff0000');
 await frame.waitForFunction(()=>document.querySelector('.sq-image-navigation').style.getPropertyValue('--ib-nav-color')==='#ff0000');
 assert.equal(await navValue(page,'color'),'#ffffff','The picker previews without saving an uncommitted color');
 await page.locator('[data-sq-color-apply]').click();assert.equal(await navValue(page,'color'),'#ff0000');
 assert.equal(await frame.evaluate(()=>window.previewInstance),instance);assert.equal(await frame.evaluate(()=>scrollY),scroll);
 assert.equal(await phone.locator('[data-product-card] select').inputValue(),'500 g');assert.equal(await phone.locator('[data-ezkart-cart-count]').first().innerText(),'1');
 await color.click();await hex.fill('#0000ff');await frame.waitForFunction(()=>document.querySelector('.sq-image-navigation').style.getPropertyValue('--ib-nav-color')==='#0000ff');await page.locator('[data-sq-color-cancel]').click();
 await frame.waitForFunction(()=>document.querySelector('.sq-image-navigation').style.getPropertyValue('--ib-nav-color')==='#ff0000');assert.equal(await navValue(page,'color'),'#ff0000');
 for(const [key,value] of [['textColor','#ffffff'],['height','80'],['blur','0'],['transparency','35'],['title','Coffee time'],['ctaLabel','Choose coffee']]){
  const input=page.locator(`[data-image-nav=${key}]`);await input.fill(value);await input.blur();
 }
 await frame.waitForFunction(()=>document.querySelector('.ib-nav-title').textContent==='Coffee time');
 assert.equal(await phone.locator('.sq-image-navigation').evaluate(n=>n.offsetHeight),80);
 assert.equal(await phone.locator('.sq-image-navigation').evaluate(n=>getComputedStyle(n).backdropFilter),'none');
 assert.equal(await page.evaluate(()=>previewReloads),0);
 assert.equal(await page.evaluate(()=>artworkBefore===document.querySelector('[data-image-upload]')&&cardBefore===document.querySelector('[data-product-card]')),true);
 // Returning to the original picker value makes Cancel a no-op in history.
 await color.click();await hex.fill('#00ff00');await page.keyboard.press('Escape');await page.locator('[data-sq-undo]').click();assert.equal(await page.locator('[data-image-nav=ctaLabel]').inputValue(),'Shop now');await page.locator('[data-sq-redo]').click();assert.equal(await page.locator('[data-image-nav=ctaLabel]').inputValue(),'Choose coffee');
 await page.evaluate(()=>EzkartBuilder.save());await page.reload();await page.locator('[data-image-nav=color]').waitFor();assert.equal(await navValue(page,'color'),'#ff0000');assert.equal(await navValue(page,'height'),80);
 const html=await page.evaluate(()=>EzkartBuilder.exportHtml());assert.doesNotMatch(html,/ezkart:image-navigation|ezkart:image-preview-ready/);
 const out=await browser.newPage();await out.setContent(html);assert.equal(await out.locator('.sq-image-navigation').evaluate(n=>n.style.getPropertyValue('--ib-nav-color')),'#ff0000');assert.equal(await out.locator('.sq-image-navigation').evaluate(n=>n.offsetHeight),80);
});

test('startup shows a neutral loader before scripts and page data arrive, then reveals only the saved builder',async t=>{
 const {ws,browser,page,errors}=await fixture(t);await page.evaluate(()=>EzkartBuilder.save());await ws.create({id:'visual-page',name:'Visual page'});
 for(const [id,imageMode] of [['fast-preview',true],['visual-page',false]]){
  const opening=await browser.newPage({viewport:{width:941,height:900}});opening.on('pageerror',e=>errors.push(e.message));
  let releaseScript,releaseData;const scriptGate=new Promise(r=>releaseScript=r),dataGate=new Promise(r=>releaseData=r);
  await opening.route(url=>url.searchParams.get('bundle')==='editor.js',async route=>{await scriptGate;await route.continue();});
  await opening.route(url=>url.searchParams.get('cloud')===`/v1/landing-pages/${id}/editor`,async route=>{await dataGate;await route.continue();});
  try{
   await opening.goto(ws.url+`/cart/admin/?page=sites&edit=${id}.ezkart.site`,{waitUntil:'commit'});
   await opening.locator('.sq-site-loader').waitFor({state:'visible'});
   assert.equal(await opening.locator('.sq-commandbar').isVisible(),false);assert.equal(await opening.locator('.sq-builder-sidebar').isVisible(),false);assert.equal(await opening.locator('.sq-editor-grid').isVisible(),false);
   releaseScript();await opening.waitForTimeout(150);
   assert.equal(await opening.locator('.sq-editor-grid').isVisible(),false);
   assert.equal(await opening.locator('.sq-site-loader').isVisible(),true);
   await opening.screenshot({path:`/tmp/ezkart-opening-${id}.png`});
   releaseData();await opening.locator('.sq-studio:not(.sq-site-loading)').waitFor();
   assert.equal(await opening.locator('.ib-editor').isVisible(),imageMode);assert.equal(await opening.locator('.sq-editor-grid').isVisible(),!imageMode);
   assert.equal(await opening.locator('.sq-commandbar').isVisible(),true);
  }finally{releaseScript();releaseData();await opening.close();}
 }
});

test('Image Stack opens while the project list and component library are still pending', async t => {
 const {ws,browser,page,errors}=await fixture(t);
 await page.evaluate(()=>EzkartBuilder.save());
 const opening=await browser.newPage({viewport:{width:941,height:900}});
 opening.on('pageerror',error=>errors.push(error.message));
 let release;
 const gate=new Promise(resolve=>release=resolve),started=new Set();
 const documentRequests=[];
 opening.on('request',request=>{
  if(request.method()==='GET'&&new URL(request.url()).searchParams.get('cloud')==='/v1/landing-pages/fast-preview/editor')documentRequests.push(request.url());
 });
 await opening.route(url=>['/v1/landing-pages','/v1/components'].includes(url.searchParams.get('cloud')),async route=>{
  started.add(new URL(route.request().url()).searchParams.get('cloud'));
  const response=await route.fetch();await gate;await route.fulfill({response});
 });
 try {
  await opening.goto(ws.url+'/cart/admin/?page=sites&edit=fast-preview.ezkart.site');
  await opening.locator('.sq-studio:not(.sq-site-loading)').waitFor({timeout:5000});
  await opening.locator('.ib-editor:not([hidden])').waitFor({timeout:5000});
  await opening.locator('.sq-site-loader').waitFor({state:'hidden',timeout:5000});
  assert.equal(await opening.locator('.ib-row').count(),4);
  assert.equal(documentRequests.length,1,'The early request is consumed instead of downloading the page again');
  assert.deepEqual([...started].sort(),['/v1/components','/v1/landing-pages']);
  await opening.locator('[data-image-nav=title]').fill('Ready before the list');
  await opening.locator('[data-image-nav=title]').blur();
  await opening.evaluate(()=>EzkartBuilder.save());
  const saved=(await ws.read('fast-preview')).updatedAt;
  release();
  await opening.waitForResponse(response=>new URL(response.url()).searchParams.get('cloud')==='/v1/landing-pages');
  assert.equal(await opening.locator('[data-image-nav=title]').inputValue(),'Ready before the list');
  assert.equal((await ws.read('fast-preview')).updatedAt,saved);
  await opening.screenshot({path:'/tmp/ezkart-fast-startup-941.png'});
 } finally {release();await opening.close();}
});

test('the selected document starts downloading while builder styles and scripts are blocked',async t=>{
 const dir=await mkdtemp(join(tmpdir(),'ezkart-early-page-')),ws=await new Workspace(dir).init();
 await ws.create({id:'early-page',name:'Early page'});await ws.start();
 const browser=await chromium.launch(),page=await browser.newPage();
 let release;const gate=new Promise(resolve=>release=resolve);
 t.after(async()=>{release();await browser.close();await ws.stop();await rm(dir,{recursive:true,force:true});});
 await page.route(url=>url.pathname.endsWith('/builder-bundle.php'),async route=>{await gate;await route.continue();});
 const documentRequest=page.waitForRequest(request=>new URL(request.url()).searchParams.get('cloud')==='/v1/landing-pages/early-page/editor',{timeout:5000});
 await page.goto(ws.url+'/cart/admin/?page=sites&edit=early-page.ezkart.site',{waitUntil:'commit'});
 await documentRequest;
 assert.equal(await page.evaluate(()=>typeof globalThis.EzkartBuilder),'undefined');
 release();await page.locator('.sq-studio:not(.sq-site-loading)').waitFor();
 await page.locator('.sq-commandbar').waitFor({state:'visible'});
});
