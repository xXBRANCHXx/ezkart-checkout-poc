import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,writeFile,rm,mkdir} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {chromium} from 'playwright';
import {Workspace,repoRoot} from '../workspace.mjs';

test('Image Stack adds safe YouTube cards and social footers through the UI, persists and exports at phone and desktop widths',async t=>{
 const dir=await mkdtemp(join(tmpdir(),'ezkart-image-media-')),ws=await new Workspace(dir).init();
 await writeFile(join(dir,'catalog.json'),JSON.stringify({demoCheckout:true,products:[{id:'coffee',name:'House Blend',status:'active',type:'physical',price:89000,stock:8}]}));
 await ws.start();const browser=await chromium.launch(),page=await browser.newPage({viewport:{width:1440,height:1000},reducedMotion:'reduce'});
 const errors=[];page.on('pageerror',e=>errors.push(e.message));page.setDefaultTimeout(10000);
 t.after(async()=>{await browser.close();await ws.stop();await rm(dir,{recursive:true,force:true});assert.deepEqual(errors,[]);});
 await page.goto(ws.url+'/cart/admin/?page=sites');await page.locator('[data-library-create-card]').click();await page.locator('[data-bc-choose=image]').click();await page.locator('[name=page_name]').fill('Image media');await page.locator('[data-library-page-form] button[value=default]').click();
 await page.waitForURL('**edit=image-media.ezkart.site');
 await page.locator('[data-image-page-upload]').setInputFiles(join(repoRoot,'cart/admin/assets/builder-choice/sambal.webp'));
 await page.waitForFunction(()=>document.querySelectorAll('.ib-row').length===1&&!document.querySelector('.ib-controls').disabled);
 await page.locator('[data-image-page-product]').selectOption('coffee');
 const field=key=>page.locator(`[data-image-extra="${key}"]`),set=async(key,value)=>{await field(key).fill(value);await field(key).blur();};
 assert.equal(await page.locator('[data-image-video]').count(),0);assert.equal(await page.locator('[data-image-footer]').count(),0);
 await page.locator('[data-image-settings=video] > summary').click();
 await set('video-url','https://youtu.be/dQw4w9WgXcQ?t=1m30s');await set('video-title','How we make coffee');
 assert.equal(await page.locator('[data-image-video] [data-ezkart-youtube]').getAttribute('data-youtube-start'),'90');
 await set('video-url','https://youtube.com.evil.example/watch?v=dQw4w9WgXcQ');assert.equal(await field('video-url').getAttribute('aria-invalid'),'true');
 assert.equal(await page.locator('[data-ezkart-youtube]').getAttribute('data-ezkart-youtube'),'dQw4w9WgXcQ');
 await set('video-url','https://youtube.com/shorts/dQw4w9WgXcQ?t=90');
 await page.locator('[data-image-settings=footer] > summary').click();
 await field('footer-enabled').check();await set('footer-title','Kopi Senja');await set('footer-note','Find us here <img src=x onerror=alert(1)>');
 await page.locator('[data-image-social-add]').click();
 const social=page.locator('.ib-social-link');await social.locator('input').nth(0).fill('Instagram');await social.locator('input').nth(0).blur();await social.locator('input').nth(1).fill('https://instagram.com/kopi_senja');await social.locator('input').nth(1).blur();
 await page.locator('[data-image-social-add]').click();const second=social.nth(1);await second.locator('input').nth(0).fill('TikTok');await second.locator('input').nth(0).blur();await second.locator('select').selectOption('tiktok');await second.locator('input').nth(1).fill('javascript:alert(1)');await second.locator('input').nth(1).blur();
 assert.equal(await second.locator('input').nth(1).getAttribute('aria-invalid'),'true');assert.equal(await page.locator('[data-image-footer] a').count(),1);
 await second.locator('input').nth(1).fill('https://tiktok.com/@kopi_senja');await second.locator('input').nth(1).blur();
 await page.locator('[data-sq-undo]').click();assert.equal(await page.locator('[data-image-footer] a').count(),1);await page.locator('[data-sq-redo]').click();assert.equal(await page.locator('[data-image-footer] a').count(),2);
 // Other edits rebuild the image document; the extras must remain intact.
 await page.locator('[data-image-settings=navigation] > summary').click();
 await page.locator('[data-image-nav=enabled]').check();await page.locator('[data-image-nav=title]').fill('Kopi Senja');await page.locator('[data-image-nav=title]').blur();
 await page.evaluate(()=>EzkartBuilder.save());await page.reload();await page.locator('[data-image-settings=video] > summary').click();await page.locator('[data-image-settings=footer] > summary').click();await field('video-url').waitFor();assert.equal(await field('video-title').inputValue(),'How we make coffee');assert.equal(await field('footer-enabled').isChecked(),true);assert.equal(await social.count(),2);
 await page.frameLocator('.ib-phone').locator('[data-image-footer] a').first().waitFor();
 await page.route('https://www.youtube-nocookie.com/**',route=>route.fulfill({contentType:'text/html',body:'<body>Editor fixture player</body>'}));
 await page.frameLocator('.ib-phone').getByRole('button',{name:'Play How we make coffee'}).click();await page.locator('[data-youtube-host-player]').frameLocator('iframe').getByText('Editor fixture player').waitFor();await page.keyboard.press('Escape');assert.equal(await page.locator('[data-youtube-host-player]').count(),0);

 const parsers=await page.evaluate(()=>({
  good:['https://youtube.com/watch?v=dQw4w9WgXcQ','https://m.youtube.com/watch?v=dQw4w9WgXcQ','https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ'].map(EzkartMedia.youtube),
  bad:['javascript:alert(1)','https://youtube.com.evil.test/watch?v=dQw4w9WgXcQ','https://user@youtube.com/watch?v=dQw4w9WgXcQ','https://youtube.com/watch?v=too-short','data:text/html,<iframe>'].map(EzkartMedia.youtube),
  links:['javascript:alert(1)','data:text/html,x','//evil.test','https://user:password@example.com','https://instagram.com/me'].map(EzkartMedia.webUrl)
 }));assert.ok(parsers.good.every(Boolean));assert.ok(parsers.bad.every(v=>v===null));assert.deepEqual(parsers.links.slice(0,4),['','','','']);
 const output=await browser.newPage({reducedMotion:'reduce'});output.on('pageerror',e=>errors.push(e.message));let embeds=0;
 await output.route('https://www.youtube-nocookie.com/**',route=>{embeds++;return route.fulfill({contentType:'text/html',body:'<html><body>Fixture video player</body></html>'});});
 const html=await page.evaluate(()=>EzkartBuilder.exportHtml());await output.setContent(html);
 assert.equal(embeds,0);assert.equal(await output.locator('[data-image-footer] img').count(),0);assert.match(await output.locator('[data-image-footer]').textContent(),/<img src=x/);
 const card=output.locator('[data-ezkart-youtube]'),footer=output.locator('[data-image-footer]');assert.equal(await footer.getAttribute('role'),'contentinfo');
 for(const width of [320,390,768,941,1440]){
  await output.setViewportSize({width,height:1000});assert.equal(await output.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
  const bounds=await card.boundingBox();assert.ok(bounds.width>250&&bounds.width<=440);assert.ok(Math.abs(bounds.height-Math.max(200,bounds.width*9/16))<1);
  assert.ok((await footer.boundingBox()).y>=(await output.locator('[data-native-id=image-checkout]').boundingBox()).y);
  await page.setViewportSize({width,height:1000});await field('footer-title').scrollIntoViewIfNeeded();assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
 }
 const link=footer.getByRole('link',{name:'Instagram'});assert.equal(await link.getAttribute('rel'),'noopener noreferrer');assert.equal(await link.getAttribute('target'),'_blank');
 await mkdir(join(repoRoot,'test-evidence'),{recursive:true});await output.setViewportSize({width:390,height:700});await card.evaluate(n=>scrollTo({top:n.getBoundingClientRect().top+scrollY-100,behavior:'instant'}));await output.screenshot({path:join(repoRoot,'test-evidence/image-youtube-mobile.png')});
 await card.getByRole('button',{name:'Play How we make coffee'}).focus();await output.keyboard.press('Enter');await card.locator('iframe').waitFor();assert.equal(await card.locator('iframe').getAttribute('title'),'How we make coffee');assert.match(await card.locator('iframe').getAttribute('src'),/^https:\/\/www.youtube-nocookie.com\/embed\/dQw4w9WgXcQ\?.*start=90/);await output.waitForFunction(()=>document.querySelector('[data-ezkart-youtube] iframe')?.contentWindow);assert.equal(embeds,1);await card.frameLocator('iframe').getByText('Fixture video player').waitFor();
 const publication=await page.evaluate(()=>EzkartBuilder.publish());assert.equal(publication.published,true);
 const live=await browser.newPage({viewport:{width:390,height:1000},reducedMotion:'reduce'});let referer='';
 await live.route('https://www.youtube-nocookie.com/**',route=>{referer=route.request().headers().referer||'';return route.fulfill({contentType:'text/html',body:'<body>Published fixture player</body>'});});
 await live.goto(publication.url);const hosted=live.frameLocator('[data-hosted-page]');await hosted.locator('[data-image-footer] a').first().waitFor();assert.equal(await hosted.locator('[data-image-footer] a').count(),2);
 await hosted.getByRole('button',{name:'Play How we make coffee'}).click();const player=live.locator('[data-youtube-host-player]');await player.frameLocator('iframe').getByText('Published fixture player').waitFor();assert.equal(new URL(await player.locator('iframe').getAttribute('src')).searchParams.get('origin'),ws.url);assert.ok(referer.startsWith(ws.url),'Trusted host supplies its referrer');await live.keyboard.press('Escape');assert.equal(await player.count(),0);assert.equal(await hosted.getByRole('button',{name:'Play How we make coffee'}).evaluate(n=>n===document.activeElement),true);
 await mkdir(join(repoRoot,'test-evidence'),{recursive:true});await page.setViewportSize({width:941,height:1000});await field('video-url').scrollIntoViewIfNeeded();await page.screenshot({path:join(repoRoot,'test-evidence/image-builder-941.png')});await output.setViewportSize({width:390,height:1000});await footer.scrollIntoViewIfNeeded();await output.screenshot({path:join(repoRoot,'test-evidence/image-footer-mobile.png')});
 await set('video-url','');assert.equal(await page.locator('[data-image-video]').count(),0);await field('footer-enabled').uncheck();assert.equal(await page.locator('[data-image-footer]').count(),0);await field('footer-enabled').check();assert.equal(await page.locator('[data-image-footer] a').count(),2);
});
