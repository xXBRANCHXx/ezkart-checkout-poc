import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,writeFile,rm,readFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {chromium} from 'playwright';
import {Workspace,repoRoot} from '../workspace.mjs';
import {chooseBasic} from './asset-helpers.mjs';

test('compact Image Stack groups are keyboard accessible, retain edits and protect merchant data in Indonesian',async t=>{
 const dir=await mkdtemp(join(tmpdir(),'ezkart-sidebar-language-')),ws=await new Workspace(dir).init();
 await writeFile(join(dir,'catalog.json'),JSON.stringify({language:'id',products:[{id:'orders',name:'Orders',status:'active',type:'physical',price:89000,stock:8}],demoCheckout:true}));
 await ws.start();const browser=await chromium.launch(),page=await browser.newPage({viewport:{width:941,height:904},reducedMotion:'reduce'}),errors=[];
 page.on('pageerror',e=>errors.push(e.message));page.setDefaultTimeout(8000);
 t.after(async()=>{await browser.close();await ws.stop();await rm(dir,{recursive:true,force:true});assert.deepEqual(errors,[]);});
 // Exercise the shared fallback dropdown, including copied merchant labels.
 await page.addInitScript(()=>{const supports=CSS.supports.bind(CSS);CSS.supports=(...args)=>args[1]==='base-select'?false:supports(...args);});
 await page.goto(ws.url+'/cart/admin/?page=sites');await page.locator('[data-library-create-card]').click();await page.locator('[data-bc-choose=image]').click();await page.locator('[name=page_name]').fill('Compact sidebar');await page.locator('[data-library-page-form] button[value=default]').click();await page.waitForURL('**edit=compact-sidebar.ezkart.site');
 const group=key=>page.locator(`[data-image-settings=${key}]`),summary=key=>group(key).locator(':scope > summary');
 await summary('product').waitFor();
 assert.deepEqual(await page.locator('[data-image-settings]').evaluateAll(nodes=>nodes.map(n=>n.dataset.imageSettings)),['product','video','navigation','footer']);
 assert.deepEqual(await page.locator('[data-image-settings]').evaluateAll(nodes=>nodes.map(n=>n.open)),[true,false,false,false]);
 assert.match(await summary('video').textContent(),/Video YouTube/);assert.match(await summary('footer').textContent(),/Footer & tautan sosial/);
 await page.locator('[data-image-page-upload]').setInputFiles({name:'Orders.png',mimeType:'image/webp',buffer:await readFile(join(repoRoot,'cart/admin/assets/builder-choice/sambal.webp'))});
 await page.waitForFunction(()=>document.querySelectorAll('.ib-row').length===1&&!document.querySelector('.ib-controls').disabled);
 assert.match(await page.locator('.ib-row strong').textContent(),/Orders.png/);
 const source=page.locator('[data-image-page-product]'),combo=group('product').getByRole('combobox');
 await combo.click();const menu=page.locator('.ezkart-select-menu:not([hidden])');await menu.locator('[role=option]').filter({hasText:'Orders'}).click();assert.equal(await source.inputValue(),'orders');
 assert.equal(await combo.locator('span').textContent(),'Orders');assert.equal(await source.locator('option[value=orders]').textContent(),'Orders');
 const edit=async(key,value)=>{const field=page.locator(`[data-image-extra=${key}]`);await field.fill(value);await field.blur();};
 await summary('video').focus();await page.keyboard.press('Enter');assert.equal(await group('video').getAttribute('open'),'');
 await edit('video-url','https://youtu.be/dQw4w9WgXcQ');await edit('video-title','Orders');assert.match(await summary('video').textContent(),/Ditambahkan/);
 await summary('video').focus();await page.keyboard.press('Space');assert.equal(await group('video').getAttribute('open'),null);
 await summary('footer').click();await page.locator('[data-image-extra=footer-enabled]').check();await edit('footer-title','Orders');await page.locator('[data-image-social-add]').click();
 const social=page.locator('.ib-social-link input');assert.equal(await social.nth(0).getAttribute('aria-label'),'Nama tautan sosial 1');await social.nth(0).fill('Orders');await social.nth(0).blur();await social.nth(1).fill('javascript:alert(1)');await social.nth(1).blur();assert.match(await page.locator('.ib-status').textContent(),/alamat web lengkap/);await social.nth(1).fill('https://example.test/orders');await social.nth(1).blur();
 await page.locator('[data-sq-undo]').click();assert.equal(await page.locator('[data-image-footer] a').count(),0);await page.locator('[data-sq-redo]').click();assert.equal(await page.locator('[data-image-footer] a').count(),1);
 await summary('footer').click();assert.match(await summary('footer').textContent(),/Aktif/);
 for(const width of [320,390,941,1440]){await page.setViewportSize({width,height:904});await summary('product').scrollIntoViewIfNeeded();assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);for(const key of ['product','video','navigation','footer'])assert.ok((await summary(key).boundingBox()).height>=48);if([390,941].includes(width))await page.screenshot({path:`/tmp/ezkart-beta-sidebar-${width}.png`});}
 await page.evaluate(()=>EzkartBuilder.save());await page.reload();await summary('product').waitFor();assert.equal(await combo.locator('span').textContent(),'Orders');assert.deepEqual(await page.locator('[data-image-settings]').evaluateAll(nodes=>nodes.map(n=>n.open)),[true,false,false,false]);
 await summary('video').click();assert.equal(await page.locator('[data-image-extra=video-title]').inputValue(),'Orders');await summary('footer').click();assert.equal(await page.locator('[data-image-extra=footer-title]').inputValue(),'Orders');assert.equal(await social.nth(0).inputValue(),'Orders');
 const html=await page.evaluate(()=>EzkartBuilder.exportHtml());assert.match(html,/Orders/);assert.ok(!html.includes('ib-setting-summary'),'editor grouping is not exported');
});

test('Studio media inspector translates every media field while preserving authored title and social names',async t=>{
 const dir=await mkdtemp(join(tmpdir(),'ezkart-studio-language-')),ws=await new Workspace(dir).init();await writeFile(join(dir,'catalog.json'),JSON.stringify({language:'id',products:[]}));await ws.create({id:'studio-language',name:'Orders'});await ws.start();
 const browser=await chromium.launch(),page=await browser.newPage({viewport:{width:1440,height:1000}});
 t.after(async()=>{await browser.close();await ws.stop();await rm(dir,{recursive:true,force:true});});
 await page.goto(ws.url+'/cart/admin/?page=sites&edit=studio-language.ezkart.site');await page.waitForFunction(()=>globalThis.EzkartBuilder);await chooseBasic(page,'native-youtube');
 const id=await page.evaluate(()=>EzkartBuilder.nativeInspect().find(n=>n.type==='youtube').id);await page.locator(`[data-native-id="${id}"]`).click();const panel=page.locator('[data-sq-native-inspector]');
 assert.equal(await panel.getByRole('button',{name:'Terapkan video',exact:true}).count(),1);assert.equal(await panel.locator('[data-native-youtube-title]').getAttribute('placeholder'),'Jelaskan video ini');assert.equal(await panel.locator('[data-native-youtube-ratio] option[value="4 / 3"]').textContent(),'Klasik · 4:3');
 await panel.locator('[data-native-youtube-url]').fill('https://youtu.be/dQw4w9WgXcQ');await panel.locator('[data-native-youtube-title]').fill('Orders');await panel.locator('[data-native-youtube-apply]').click();assert.equal(await page.evaluate(id=>EzkartBuilder.nativeInspect({id}).label,id),'Orders');
 await chooseBasic(page,'native-social');const social=await page.evaluate(()=>EzkartBuilder.nativeInspect().find(n=>n.type==='social').id);await page.locator(`[data-native-id="${social}"]`).click();await panel.getByRole('button',{name:'Terapkan tautan sosial',exact:true}).waitFor();assert.equal(await panel.getByText('Nama tautan 1',{exact:true}).count(),1);assert.equal(await panel.getByText('Alamat web',{exact:true}).count(),8);
 await panel.locator('[data-native-social-label="0"]').fill('Orders');await panel.locator('[data-native-social-url="0"]').fill('https://example.test/orders');await panel.locator('[data-native-social-apply]').click();assert.equal(await page.locator(`[data-native-id="${social}"] a`).textContent(),'Orders');
});
