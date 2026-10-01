import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {chromium} from 'playwright';
import {Workspace,repoRoot} from '../workspace.mjs';

test('Image Stack CTA follows the connected product in preview and publication, retaining its setting through extras and reload',async t=>{
 const dir=await mkdtemp(join(tmpdir(),'ezkart-image-cta-')),ws=await new Workspace(dir).init();
 await writeFile(join(dir,'catalog.json'),JSON.stringify({demoCheckout:true,products:[{id:'coffee',name:'House Blend',status:'active',type:'physical',price:79000,stock:8}]}));
 await ws.start();const browser=await chromium.launch(),page=await browser.newPage({viewport:{width:941,height:1000},reducedMotion:'reduce'});
 const errors=[];page.on('pageerror',e=>errors.push(e.message));page.setDefaultTimeout(10000);
 t.after(async()=>{await browser.close();await ws.stop();await rm(dir,{recursive:true,force:true});assert.deepEqual(errors,[]);});
 await page.goto(ws.url+'/cart/admin/?page=sites');await page.locator('[data-library-create-card]').click();await page.locator('[data-bc-choose=image]').click();await page.locator('[name=page_name]').fill('CTA diagnosis');await page.locator('[data-library-page-form] button[value=default]').click();
 await page.waitForURL('**edit=cta-diagnosis.ezkart.site');
 await page.locator('[data-image-page-upload]').setInputFiles(join(repoRoot,'cart/admin/assets/builder-choice/kopi-senja-01.webp'));
 await page.waitForFunction(()=>document.querySelectorAll('.ib-row').length===1&&!document.querySelector('.ib-controls').disabled);
 const product=page.locator('[data-image-page-product]'),nav=key=>page.locator(`[data-image-nav="${key}"]`),phone=page.frameLocator('.ib-phone');
 await page.locator('[data-image-settings=navigation] > summary').click();await nav('enabled').check();await nav('title').fill('Senja');await nav('title').blur();
 assert.equal(await nav('cta').isChecked(),true);
 await phone.locator('.ib-nav-title').waitFor();assert.equal(await phone.locator('.ib-nav-cta').count(),0);
 assert.equal(await page.getByText('Choose a product below to show this button.',{exact:true}).count(),1);
 await page.locator('.ib-phone').screenshot({path:'/tmp/ezkart-image-cta-unconnected.png'});
 await product.selectOption('coffee');await phone.locator('.ib-nav-cta').waitFor({state:'visible'});
 await page.locator('[data-image-settings=video] > summary').click();const video=page.locator('[data-image-extra=video-url]');await video.fill('https://youtu.be/dQw4w9WgXcQ');await video.blur();
 await page.locator('[data-image-settings=footer] > summary').click();await page.locator('[data-image-extra=footer-enabled]').check();const title=page.locator('[data-image-extra=footer-title]');await title.fill('Senja footer');await title.blur();
 await page.evaluate(()=>EzkartBuilder.save());await page.reload();await phone.locator('.ib-nav-cta').waitFor({state:'visible'});
 assert.equal(await product.inputValue(),'coffee');assert.equal(await phone.locator('[data-image-video]').count(),1);assert.equal(await phone.locator('[data-image-footer]').count(),1);
 await page.locator('[data-image-settings=navigation] > summary').click();assert.equal(await nav('cta').isChecked(),true);
 for(const width of [320,390,941,1440]){
  await page.setViewportSize({width,height:1000});const box=await phone.locator('.ib-nav-cta').boundingBox(),header=await phone.locator('.sq-image-navigation').boundingBox();
  assert.ok(box.width>0&&box.x>=header.x&&box.x+box.width<=header.x+header.width+1,'CTA stays inside the header');
  assert.ok(box.y>=header.y&&box.y+box.height<=header.y+header.height+1,'CTA is visible at the top rather than below the artwork');
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
 }
 await page.setViewportSize({width:941,height:1000});await page.locator('.ib-phone').screenshot({path:'/tmp/ezkart-image-cta-connected.png'});
 await phone.locator('.ib-nav-cta').click();await page.frames().find(frame=>frame.url().includes('/page-preview.php?image=')).waitForFunction(()=>document.querySelector('[data-product-card]').getBoundingClientRect().top<innerHeight);
 await nav('cta').uncheck();await phone.locator('.ib-nav-cta').waitFor({state:'detached'});await page.evaluate(()=>EzkartBuilder.save());await page.reload();await phone.locator('.sq-image-navigation').waitFor();assert.equal(await phone.locator('.ib-nav-cta').count(),0);
 await page.locator('[data-image-settings=navigation] > summary').click();assert.equal(await nav('cta').isChecked(),false);await nav('cta').check();await phone.locator('.ib-nav-cta').waitFor({state:'visible'});
 await product.selectOption('');await phone.locator('.ib-nav-cta').waitFor({state:'detached'});assert.equal(await nav('cta').isChecked(),true);await page.evaluate(()=>EzkartBuilder.save());await page.reload();await phone.locator('.sq-image-navigation').waitFor();assert.equal(await phone.locator('.ib-nav-cta').count(),0);
 await product.selectOption('coffee');await phone.locator('.ib-nav-cta').waitFor({state:'visible'});
 const publication=await page.evaluate(()=>EzkartBuilder.publish());assert.equal(publication.published,true);
 const live=await browser.newPage({viewport:{width:390,height:800},reducedMotion:'reduce'});live.on('pageerror',e=>errors.push(e.message));await live.goto(publication.url);
 const hosted=live.frameLocator('[data-hosted-page]');await hosted.locator('.ib-nav-cta').waitFor({state:'visible'});await hosted.locator('.ib-nav-cta').click();
 const frame=live.frames().find(frame=>frame!==live.mainFrame());await frame.waitForFunction(()=>document.querySelector('[data-product-card]').getBoundingClientRect().top<innerHeight);
 assert.equal(await hosted.locator('[data-image-video]').count(),1);assert.equal(await hosted.locator('[data-image-footer]').count(),1);
 await page.locator('[data-image-settings=navigation] > summary').click();await nav('cta').uncheck();const without=await page.evaluate(()=>EzkartBuilder.publish());assert.equal(without.published,true);await live.reload();await hosted.locator('.sq-image-navigation').waitFor();assert.equal(await hosted.locator('.ib-nav-cta').count(),0);
});
