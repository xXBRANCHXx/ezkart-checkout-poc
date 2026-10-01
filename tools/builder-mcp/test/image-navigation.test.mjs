import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {chromium} from 'playwright';
import {Workspace,repoRoot} from '../workspace.mjs';

test('Image Stack navigation settings persist and its menu, product link, surfaces and scroll modes work',async t=>{
  const dir=await mkdtemp(join(tmpdir(),'ezkart-image-navigation-')),ws=await new Workspace(dir).init();
  await writeFile(join(dir,'catalog.json'),JSON.stringify({demoCheckout:true,products:[{id:'coffee',name:'House Blend',status:'active',type:'physical',price:89000,stock:8}]}));
  await ws.start();const browser=await chromium.launch(),page=await browser.newPage({viewport:{width:1440,height:1000},reducedMotion:'reduce'});
  page.setDefaultTimeout(8000);const errors=[];page.on('pageerror',e=>errors.push(e.message));
  t.after(async()=>{await browser.close();await ws.stop();await rm(dir,{recursive:true,force:true});assert.deepEqual(errors,[]);});
  await page.goto(ws.url+'/cart/admin/?page=sites');await page.locator('[data-library-create-card]').click();await page.locator('[data-bc-choose=image]').click();await page.locator('[name=page_name]').fill('Image navigation');await page.locator('[data-library-page-form] button[value=default]').click();
  await page.waitForURL('**edit=image-navigation.ezkart.site');
  await page.locator('[data-image-page-upload]').setInputFiles([1,2,3,4].map(i=>join(repoRoot,`cart/admin/assets/builder-choice/kopi-senja-0${i}.webp`)));
  await page.waitForFunction(()=>document.querySelectorAll('.ib-row').length===4&&!document.querySelector('.ib-controls').disabled);
  await page.locator('[data-image-page-product]').selectOption('coffee');
  const field=key=>page.locator(`[data-image-nav="${key}"]`);
  const set=async(key,value)=>{await field(key).fill(String(value));await field(key).blur();};
  await page.locator('[data-image-settings=navigation] > summary').click();
  await field('enabled').check();await set('title','Kopi Senja');await set('height',72);await set('color','#e7eee9');await set('transparency',35);await set('blur',16);
  for(const label of ['Our coffee','The details']){await page.locator('[data-image-nav-add]').click();await page.locator('.ib-nav-link input').last().fill(label);await page.locator('.ib-nav-link input').last().blur();}
  await set('ctaLabel','Shop coffee');
  const target=await page.locator('.ib-nav-link select').nth(1).inputValue();
  await page.locator('[data-sq-undo]').click();assert.equal(await field('ctaLabel').inputValue(),'Shop now');await page.locator('[data-sq-redo]').click();
  // Targets follow the image identity, including after reordering and disabling the bar.
  await page.locator('.ib-row').nth(1).locator('[data-image-drag]').focus();await page.keyboard.press('Space');await page.keyboard.press('ArrowUp');await page.keyboard.press('Space');assert.equal(await page.locator('.ib-nav-link select').nth(1).inputValue(),target);
  await field('enabled').uncheck();await field('enabled').check();assert.equal(await field('title').inputValue(),'Kopi Senja');
  await page.evaluate(()=>EzkartBuilder.save());await page.reload();await page.locator('[data-image-settings=navigation] > summary').click();await field('enabled').waitFor();assert.equal(await field('enabled').isChecked(),true);assert.equal(await field('height').inputValue(),'72');assert.equal(await page.locator('.ib-nav-link').count(),2);
  const frame=page.frameLocator('.ib-phone');await frame.locator('.sq-image-navigation').waitFor();assert.equal(await frame.locator('.ib-nav-title').textContent(),'Kopi Senja');
  const output=await browser.newPage({viewport:{width:390,height:800},reducedMotion:'reduce'});output.on('pageerror',e=>errors.push(e.message));
  const load=async()=>{await output.setContent(await page.evaluate(()=>EzkartBuilder.exportHtml()));await output.locator('.sq-image-navigation').waitFor();};
  await load();
  for(const width of [320,390,768,1440]){
    await output.setViewportSize({width,height:800});await output.evaluate(()=>scrollTo({top:0,behavior:'instant'}));
    const bar=output.locator('.sq-image-navigation'),bounds=await bar.boundingBox();assert.equal(Math.round(bounds.height),72);assert.equal(Math.round(bounds.width),Math.min(480,width));
    assert.equal(await output.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
    assert.equal(await bar.evaluate(n=>getComputedStyle(n).backdropFilter),'blur(16px) saturate(1.15)');
    assert.match(await bar.evaluate(n=>getComputedStyle(n).backgroundColor),/0\.65/);
    assert.equal(Math.round((await output.locator('[data-image-upload]').first().boundingBox()).y),72);
    await bar.locator('.sq-nav-menu-toggle').click();await output.getByRole('link',{name:'The details',exact:true}).click();
    await output.waitForFunction(id=>Math.abs(document.getElementById('native-'+id).getBoundingClientRect().top-72)<3,target);
    assert.equal(await bar.locator('.sq-nav-menu-toggle').getAttribute('aria-expanded'),'false');
    await bar.locator('.sq-nav-menu-toggle').click();await output.keyboard.press('Escape');assert.equal(await bar.locator('.sq-nav-menu-toggle').evaluate(n=>n===document.activeElement),true);
    await bar.locator('.ib-nav-cta').click();await output.waitForFunction(()=>document.querySelector('[data-product-card]').getBoundingClientRect().top<innerHeight);
  }
  await field('sticky').selectOption('up');await load();
  await output.evaluate(()=>scrollTo({top:500,behavior:'instant'}));await output.waitForFunction(()=>document.querySelector('.sq-image-navigation').classList.contains('sq-nav-hidden'));
  await output.evaluate(()=>scrollTo({top:400,behavior:'instant'}));await output.waitForFunction(()=>!document.querySelector('.sq-image-navigation').classList.contains('sq-nav-hidden'));
  await field('sticky').selectOption('off');await load();await output.evaluate(()=>scrollTo({top:500,behavior:'instant'}));assert.ok((await output.locator('.sq-image-navigation').boundingBox()).y<-400);
  await field('sticky').selectOption('on');await set('height',48);await load();assert.equal(Math.round((await output.locator('.sq-image-navigation').boundingBox()).height),48);
  await field('cta').uncheck();await load();assert.equal(await output.locator('.ib-nav-cta').count(),0);
  // Removing an image removes its broken jump; Undo restores both together.
  await page.locator('.ib-row').first().locator('[data-image-remove]').click();assert.equal(await page.locator('.ib-nav-link').count(),1);await page.locator('[data-sq-undo]').click();assert.equal(await page.locator('.ib-nav-link').count(),2);
  for(const width of [390,941,1440]){await page.setViewportSize({width,height:1000});await field('title').scrollIntoViewIfNeeded();assert.equal(Math.round((await page.locator('.sq-commandbar').boundingBox()).y),0);assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);}
});
