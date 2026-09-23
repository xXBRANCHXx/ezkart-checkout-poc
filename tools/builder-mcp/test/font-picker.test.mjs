import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { chromium } from 'playwright';
import { Workspace, repoRoot } from '../workspace.mjs';
import { openAssets, chooseBasic } from './asset-helpers.mjs';

test('visual fonts search, keyboard selection, undo, persistence, narrow layout and used-family export', async () => {
  const dir=await mkdtemp(join(tmpdir(),'ezkart-fonts-')),ws=await new Workspace(dir).init();await ws.start();
  const browser=await chromium.launch(),page=await browser.newPage({viewport:{width:1600,height:1000},reducedMotion:'reduce'});
  page.setDefaultTimeout(10000);
  const errors=[],requests=[];page.on('pageerror',error=>errors.push(error.message));page.on('request',request=>{if(/\.woff2/.test(request.url()))requests.push(request.url());});
  const call=(method,args={})=>page.evaluate(({method,args})=>EzkartBuilder[method](args),{method,args});
  try{
    await page.goto(ws.url+'/cart/admin/?page=sites');await page.locator('[data-library-create-card]').click();
    const form=page.locator('[data-library-page-form]');await form.locator('[name=page_name]').fill('Font choices');await form.locator('button[value=default]').click();
    await page.waitForURL('**edit=font-choices.ezkart.site');await page.waitForFunction(()=>globalThis.EzkartBuilder);await call('settle');
    assert.ok(!requests.some(url=>url.includes('pacifico.woff2')),'Unseen fonts do not load when editor opens');
    await openAssets(page);await chooseBasic(page,'native-heading');
    const heading=(await call('nativeInspect')).filter(node=>node.type==='heading').at(-1),node=page.locator(`[data-native-id="${heading.id}"]`);
    if(await page.locator('.sq-builder-sidebar.sq-panel-pinned').count())await page.locator('[data-sq-tab=add]').click();await node.click();
    const inspector=page.locator('[data-sq-native-inspector]');
    const typography=inspector.locator('details').filter({has:page.locator(':scope > summary',{hasText:'Font & text alignment'})});
    if(!await typography.evaluate(el=>el.open))await typography.locator(':scope > summary').click();
    const picker=inspector.locator('[data-native-prop="fontFamily"]').locator('..').locator('[data-sq-font-picker]');await picker.click();
    const dialog=page.locator('[data-sq-font-dialog]');await page.waitForFunction(()=>EzkartFonts.families.length>=30);
    assert.equal(await dialog.locator('[role=option]').count(),36);await page.screenshot({path:'/tmp/ezkart-fonts-desktop.png'});await dialog.locator('[data-font-search]').fill('Playfair');assert.equal(await dialog.locator('[role=option]').count(),1);
    const choice=dialog.locator('[data-font-id="playfair-display"]');await page.waitForFunction(()=>document.fonts.check('25px "Playfair Display"'));
    assert.match(await choice.locator('.sq-font-sample').evaluate(el=>getComputedStyle(el).fontFamily),/Playfair Display/);await choice.click();await call('settle');
    assert.match((await call('nativeInspect',{id:heading.id})).props.fontFamily,/Playfair Display/);assert.match(await node.evaluate(el=>getComputedStyle(el).fontFamily),/Playfair Display/);
    await call('undo');assert.doesNotMatch((await call('nativeInspect',{id:heading.id})).props.fontFamily||'',/Playfair Display/);await call('redo');assert.match((await call('nativeInspect',{id:heading.id})).props.fontFamily,/Playfair Display/);
    await node.click();await picker.click();await dialog.locator('[data-font-category]').selectOption('mono');assert.equal(await dialog.locator('[role=option]').count(),2);
    await dialog.locator('[data-font-search]').fill('nothing matches this');assert.match(await dialog.locator('[data-font-list]').innerText(),/No fonts found/);
    await page.keyboard.press('Escape');assert.equal(await dialog.isVisible(),false);assert.equal(await picker.evaluate(el=>el===document.activeElement),true,'Escape restores focus');
    await picker.click();await dialog.locator('[data-font-search]').fill('Caveat');await page.keyboard.press('ArrowDown');await page.keyboard.press('Enter');await call('settle');
    assert.match((await call('nativeInspect',{id:heading.id})).props.fontFamily,/Caveat/);await call('save');await page.reload();await page.waitForFunction(()=>globalThis.EzkartBuilder);await call('settle');
    assert.match((await call('nativeInspect',{id:heading.id})).props.fontFamily,/Caveat/);
    await page.locator('[data-sq-preview]').click();await page.locator('[data-sq-preview-close]').waitFor();
    const live=await page.locator('[data-sq-live-preview-frame]').elementHandle().then(el=>el.contentFrame());
    await live.locator(`[data-native-id="${heading.id}"]`).waitFor();await live.evaluate(()=>document.fonts.ready);assert.match(await live.locator(`[data-native-id="${heading.id}"]`).evaluate(el=>getComputedStyle(el).fontFamily),/Caveat/);
    await page.locator('[data-sq-preview-close]').click();
    const html=await call('previewHtml'),faces=[...html.matchAll(/@font-face\{[^}]+\}/g)].map(match=>match[0]);
    assert.ok(faces.some(face=>face.includes('Caveat')&&face.includes('data:')),'Applied font is embedded');assert.ok(!faces.some(face=>/Playfair Display|Pacifico|Montserrat/.test(face)),'Previewed and unused families are not exported');assert.match(html,/SIL OPEN FONT LICENSE/,'Exports retain font licenses');
    const rendered=await browser.newPage();await rendered.setContent(html);await rendered.evaluate(()=>document.fonts.ready);assert.match(await rendered.locator(`[data-native-id="${heading.id}"]`).evaluate(el=>getComputedStyle(el).fontFamily),/Caveat/);await rendered.close();
    await page.setViewportSize({width:390,height:844});await node.click();if(!await typography.evaluate(el=>el.open))await typography.locator(':scope > summary').click();await picker.click();const box=await dialog.boundingBox();
    await page.screenshot({path:'/tmp/ezkart-fonts-mobile.png'});
    assert.ok(box.x>=0&&box.x+box.width<=390&&box.y>=0&&box.y+box.height<=844,'Font browser fits narrow editor');await dialog.locator('[data-font-search]').fill('Pacifico');await dialog.locator('[data-font-id=pacifico]').click();await call('settle');assert.match((await call('nativeInspect',{id:heading.id})).props.fontFamily,/Pacifico/);
    await page.setViewportSize({width:1600,height:1000});await page.locator('[data-sq-tab=brand]').click();
    const brand=page.locator('[data-sq-brand-font=heading]').locator('..').locator('[data-sq-font-picker]');await brand.click();await dialog.locator('[data-font-search]').fill('Montserrat');await dialog.locator('[data-font-id=montserrat]').click();await call('settle');
    const brandValue=()=>page.locator('.sq-page-preview').evaluate(el=>el.style.getPropertyValue('--site-heading-font'));
    assert.match(await brandValue(),/Montserrat/);await call('undo');assert.doesNotMatch(await brandValue(),/Montserrat/);await call('redo');assert.match(await brandValue(),/Montserrat/);
    assert.deepEqual(errors,[]);
  }finally{await browser.close();await ws.stop();await rm(dir,{recursive:true,force:true});}
});

test('every bundled family has a compressed file and its OFL license',async()=>{
  const base=join(repoRoot,'cart/admin/assets/fonts'),{families}=JSON.parse(await readFile(join(base,'builder-fonts.json'),'utf8'));
  assert.ok(families.length>=30);assert.equal(new Set(families.map(font=>font.name)).size,families.length);
  for(const font of families){assert.match(await readFile(join(base,font.license),'utf8'),/SIL OPEN FONT LICENSE/);for(const face of font.faces)assert.equal((await readFile(join(base,face.file))).subarray(0,4).toString(),'wOF2');}
});

test('a temporary font catalog outage leaves editing available and exports retry before embedding',async()=>{
  const dir=await mkdtemp(join(tmpdir(),'ezkart-font-retry-')),ws=await new Workspace(dir).init();await ws.create({id:'font-retry',name:'Font retry'});await ws.start();
  const browser=await chromium.launch(),page=await browser.newPage();let unavailable=true;
  try{
    await page.route('**/assets/fonts/builder-fonts.json',route=>unavailable?route.fulfill({status:503,body:'Unavailable'}):route.continue());
    await page.goto(ws.url+'/cart/admin/?page=sites&edit=font-retry.ezkart.site');await page.waitForFunction(()=>globalThis.EzkartBuilder);
    await page.evaluate(()=>EzkartBuilder.theme({headingFont:'"Caveat", cursive'}));
    await page.evaluate(()=>EzkartBuilder.settle());
    assert.equal(await page.evaluate(()=>EzkartFonts.families.length),1,'Existing default stays available during catalog failure');
    await assert.rejects(page.evaluate(()=>EzkartBuilder.previewHtml()),/font library could not load/,'Export cannot silently lose a chosen bundled font');
    unavailable=false;
    const html=await page.evaluate(()=>EzkartBuilder.previewHtml());
    assert.match(html,/@font-face\{font-family:"Caveat";src:url\('data:/);assert.equal(await page.evaluate(()=>EzkartFonts.families.length),36);
  }finally{await browser.close();await ws.stop();await rm(dir,{recursive:true,force:true});}
});
