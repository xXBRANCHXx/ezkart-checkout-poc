import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm,readFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {chromium} from 'playwright';
import {Workspace} from '../workspace.mjs';
import {chooseBasic} from './asset-helpers.mjs';
test('Studio YouTube and footer links use merchant controls, persist, undo and export safely', async()=>{
 const dir=await mkdtemp(join(tmpdir(),'ezkart-studio-media-'));
 const ws=await new Workspace(dir).init();await ws.create({id:'studio-media',name:'Studio media'});await ws.start();
 const browser=await chromium.launch(),page=await browser.newPage({viewport:{width:1440,height:1000},reducedMotion:'reduce'}),errors=[];
 page.on('pageerror',e=>errors.push(e.message));
 const call=(method,args={})=>page.evaluate(({method,args})=>EzkartBuilder[method](args),{method,args});
 try{
  await page.goto(ws.url+'/cart/admin/?page=sites&edit=studio-media.ezkart.site');await page.waitForFunction(()=>globalThis.EzkartBuilder);
  await chooseBasic(page,'native-youtube');
  const video=(await call('nativeInspect')).find(n=>n.type==='youtube');assert.ok(video);
  const panel=page.locator('[data-sq-native-inspector]');
  await page.locator(`[data-native-id="${video.id}"]`).click();
  await panel.locator('[data-native-youtube-url]').fill('https://youtu.be/dQw4w9WgXcQ?t=20s');
  await panel.locator('[data-native-youtube-title]').fill('Making our product');
  await panel.locator('[data-native-youtube-start]').fill('23');
  await panel.locator('[data-native-youtube-ratio]').selectOption('4 / 3');
  await panel.locator('[data-native-youtube-apply]').click();
  assert.equal((await call('nativeInspect',{id:video.id})).ratio,'4 / 3');
  assert.equal(await page.locator(`[data-native-id="${video.id}"] .sq-youtube-card`).getAttribute('data-youtube-start'),'23');
  await call('undo');assert.equal((await call('nativeInspect',{id:video.id})).src,'');await call('redo');
  await call('nativeUpdate',{id:video.id,props:{borderRadius:'24px'},responsive:[{max:600,props:{width:'100%'}}]});
  await chooseBasic(page,'native-social');
  const social=(await call('nativeInspect')).find(n=>n.type==='social');assert.ok(social);
  await page.locator(`[data-native-id="${social.id}"]`).click();
  await panel.locator('[data-native-social-label="0"]').fill('Instagram');
  await panel.locator('[data-native-social-url="0"]').fill('https://instagram.com/ourshop');
  await panel.locator('[data-native-social-label="1"]').fill('YouTube');
  await panel.locator('[data-native-social-url="1"]').fill('https://youtube.com/@ourshop');
  await panel.locator('[data-native-social-apply]').click();
  assert.equal((await call('nativeInspect',{id:social.id})).links.length,2);
  await panel.locator('[data-native-social-url="0"]').fill('javascript:alert(1)');await panel.locator('[data-native-social-apply]').click();
  assert.equal((await call('nativeInspect',{id:social.id})).links[0].url,'https://instagram.com/ourshop');
  await call('save');await page.reload();await page.waitForFunction(()=>globalThis.EzkartBuilder);
  assert.equal((await call('nativeInspect',{id:video.id})).label,'Making our product');
  assert.equal((await call('nativeInspect',{id:social.id})).links.length,2);
  const output=await call('previewHtml');
  assert.ok(output.includes('youtube-nocookie.com/embed/'));assert.ok(output.includes('.sq-youtube-card'));
  const view=await browser.newPage();await view.route('https://www.youtube-nocookie.com/**',route=>route.fulfill({body:'<!doctype html><title>Test player</title>',contentType:'text/html'}));
  await view.setContent(output);
  assert.equal(await view.locator('.sq-youtube-card iframe').count(),0);
  await view.setViewportSize({width:390,height:900});await view.screenshot({path:'/tmp/ezkart-studio-media-poster-mobile.png',fullPage:true});
  await view.locator('.sq-youtube-play').click();
  const iframe=view.locator('.sq-youtube-card iframe');assert.match(await iframe.getAttribute('src'),/start=23/);assert.equal(await iframe.getAttribute('title'),'Making our product');
  assert.equal(await view.locator(`[data-native-id="${social.id}"] a`).count(),2);
  for(const width of [320,390,768,1440,1920]){await view.setViewportSize({width,height:900});assert.ok(await view.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),'no export overflow at '+width);}
  await view.setViewportSize({width:390,height:900});await view.screenshot({path:'/tmp/ezkart-studio-media-mobile.png',fullPage:true});
  for(const width of [320,941,1440]){await page.setViewportSize({width,height:900});await call('settle');assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),'no editor overflow at '+width);}
  await page.setViewportSize({width:941,height:900});await page.locator(`[data-native-id="${video.id}"]`).click();await page.screenshot({path:'/tmp/ezkart-studio-media-editor-941.png',fullPage:true});
  assert.deepEqual(errors,[]);await view.close();
 }finally{await browser.close();await ws.stop();await rm(dir,{recursive:true,force:true});}
});
