import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { chromium } from 'playwright';
import { createHash } from 'node:crypto';
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
    const dialog=page.locator('[data-sq-font-dialog]');await page.waitForFunction(()=>EzkartFonts.families.length===200);
    assert.equal(await dialog.locator('[data-font-list] [role=option]').count(),200);
    assert.ok((await dialog.boundingBox()).width>=600,'The comparison window is wider');
    assert.deepEqual(await dialog.locator('[data-font-list] [role=option]').evaluateAll(rows=>rows.slice(0,3).map(row=>row.dataset.fontId)),['bebas-neue','dm-serif-display','pacifico']);
    assert.ok(new Set(requests.filter(url=>url.includes('/assets/fonts/'))).size<45,'Opening 200 choices only requests visible samples and category fonts');await page.screenshot({path:'/tmp/ezkart-fonts-desktop.png'});
    await dialog.locator('[data-font-preview]').fill('Make something yours');await page.evaluate(()=>document.fonts.ready);
    const clipped=await dialog.locator('.sq-font-option').evaluateAll(rows=>rows.slice(0,8).filter(row=>{const sample=row.querySelector('.sq-font-sample');return sample.scrollHeight>sample.clientHeight+2;} ).map(row=>row.dataset.fontId));
    assert.deepEqual(clipped,[],'Two-line preview text is not squeezed inside its card');
    await dialog.locator('[data-font-preview]').fill('Make it yours');await dialog.locator('[data-font-search]').fill('Playfair');assert.equal(await dialog.locator('[role=option]').count(),1);
    const choice=dialog.locator('[data-font-id="playfair-display"]');await page.waitForFunction(()=>document.fonts.check('25px "Playfair Display"'));
    assert.match(await choice.locator('.sq-font-sample').evaluate(el=>getComputedStyle(el).fontFamily),/Playfair Display/);await choice.click();await call('settle');
    assert.match((await call('nativeInspect',{id:heading.id})).props.fontFamily,/Playfair Display/);assert.match(await node.evaluate(el=>getComputedStyle(el).fontFamily),/Playfair Display/);
    await call('undo');assert.doesNotMatch((await call('nativeInspect',{id:heading.id})).props.fontFamily||'',/Playfair Display/);await call('redo');assert.match((await call('nativeInspect',{id:heading.id})).props.fontFamily,/Playfair Display/);
    await node.click();await picker.click();await dialog.locator('[data-font-category]').selectOption('mono');assert.equal(await dialog.locator('[data-font-list] [role=option]').count(),20);
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
    assert.ok(faces.some(face=>face.includes('Caveat')&&face.includes('data:')),'Applied font is embedded');assert.ok(!faces.some(face=>/Playfair Display|Pacifico|Montserrat|Bebas Neue|Bungee|JetBrains Mono/.test(face)),'Previewed and unused families are not exported');assert.match(html,/SIL OPEN FONT LICENSE/,'Exports retain font licenses');
    const rendered=await browser.newPage();await rendered.setContent(html);await rendered.evaluate(()=>document.fonts.ready);assert.match(await rendered.locator(`[data-native-id="${heading.id}"]`).evaluate(el=>getComputedStyle(el).fontFamily),/Caveat/);await rendered.close();
    await page.setViewportSize({width:390,height:844});await node.click();if(!await typography.evaluate(el=>el.open))await typography.locator(':scope > summary').click();await picker.click();const box=await dialog.boundingBox();
    await page.screenshot({path:'/tmp/ezkart-fonts-mobile.png'});
    assert.ok(box.x>=0&&box.x+box.width<=390&&box.y>=0&&box.y+box.height<=844,'Font browser fits narrow editor');await dialog.locator('[data-font-search]').fill('Pacifico');await dialog.locator('[data-font-id=pacifico]').click();await call('settle');assert.match((await call('nativeInspect',{id:heading.id})).props.fontFamily,/Pacifico/);
    await page.setViewportSize({width:1600,height:1000});await page.locator('[data-sq-tab=brand]').click();
    const brand=page.locator('[data-sq-brand-font=heading]').locator('..').locator('[data-sq-font-picker]');await brand.click();await dialog.locator('[data-font-search]').fill('Montserrat');await dialog.locator('[data-font-id=montserrat]').click();await call('settle');
    const brandValue=()=>page.locator('[data-sq-preview-root]').evaluate(el=>el.style.getPropertyValue('--site-heading-font'));
    assert.match(await brandValue(),/Montserrat/);await call('undo');assert.doesNotMatch(await brandValue(),/Montserrat/);await call('redo');assert.match(await brandValue(),/Montserrat/);
    assert.deepEqual(errors,[]);
  }finally{await browser.close();await ws.stop();await rm(dir,{recursive:true,force:true});}
});

test('every bundled family has a compressed file and its OFL license',async()=>{
  const base=join(repoRoot,'cart/admin/assets/fonts'),{families}=JSON.parse(await readFile(join(base,'builder-fonts.json'),'utf8'));
  assert.equal(families.length,200);assert.equal(new Set(families.map(font=>font.name)).size,families.length);
  for(const font of families){assert.match(await readFile(join(base,font.license),'utf8'),/SIL OPEN FONT LICENSE/i);for(const face of font.faces){const file=await readFile(join(base,face.file));assert.equal(file.subarray(0,4).toString(),'wOF2');assert.equal(createHash('sha256').update(file).digest('hex'),face.sha256,face.file);}}
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
    assert.match(html,/@font-face\{font-family:"Caveat";src:url\('data:/);assert.equal(await page.evaluate(()=>EzkartFonts.families.length),200);
  }finally{await browser.close();await ws.stop();await rm(dir,{recursive:true,force:true});}
});

test('every bundled font can be decoded and rendered by the browser',async()=>{
  const dir=await mkdtemp(join(tmpdir(),'ezkart-font-decode-')),ws=await new Workspace(dir).init();await ws.start();
  const browser=await chromium.launch(),page=await browser.newPage();
  try{
    await page.route('**/font-proof',route=>route.fulfill({contentType:'text/html',body:'<!doctype html><meta charset="utf-8"><link rel="stylesheet" href="/cart/admin/builder-font-faces.css">'}));
    await page.goto(ws.url+'/font-proof');
    const failed=await page.evaluate(async()=>{
      const {families}=await fetch('/cart/admin/assets/fonts/builder-fonts.json').then(r=>r.json());
      return (await Promise.all(families.map(async font=>{
        try {const faces=await document.fonts.load(`32px "${font.name}"`,'Make something yours');return faces.length&&faces.every(face=>face.status==='loaded')?null:font.name;}
        catch(_){return font.name;}
      }))).filter(Boolean);
    });
    assert.deepEqual(failed,[],'All 200 families have working browser font data');
  }finally{await browser.close();await ws.stop();await rm(dir,{recursive:true,force:true});}
});

for(const fallback of [false,true])test(`font styles are visual and keyboard accessible with ${fallback?'fallback':'native'} dropdowns`,async()=>{
  const dir=await mkdtemp(join(tmpdir(),'ezkart-font-styles-')),ws=await new Workspace(dir).init();await ws.create({id:'styles',name:'Font styles'});await ws.start();
  const browser=await chromium.launch(),page=await browser.newPage({viewport:{width:941,height:904},reducedMotion:'reduce'});
  if(fallback)await page.addInitScript(()=>{const supports=CSS.supports.bind(CSS);CSS.supports=(...args)=>args[0]==='appearance'&&args[1]==='base-select'?false:supports(...args);});
  try{
    await page.goto(ws.url+'/cart/admin/?page=sites&edit=styles.ezkart.site');await page.waitForFunction(()=>globalThis.EzkartBuilder);
    await page.locator('[data-sq-tab=brand]').click();await page.locator('[data-sq-brand-font=heading]').locator('..').locator('[data-sq-font-picker]').click();
    const dialog=page.locator('[data-sq-font-dialog]'),list=dialog.locator('[data-font-list]'),combo=dialog.getByRole('combobox',{name:'Font style',exact:true});
    await page.waitForFunction(()=>EzkartFonts.families.length===200);
    await combo.click();await page.screenshot({path:`/tmp/ezkart-font-expansion/categories-${fallback?'fallback':'native'}.png`});
    const styles={sans:['Sans serif','DM Sans',50],serif:['Serif','DM Serif Display',40],display:['Display','Bebas Neue',50],handwriting:['Handwriting','Caveat',40],mono:['Monospace','Space Mono',20]};
    for(const [id,[label,font,total]] of Object.entries(styles)){
      const option=dialog.getByRole('option',{name:label,exact:true});
      assert.ok((await option.evaluate(el=>getComputedStyle(el).fontFamily)).includes(font),`${label} is shown in its representative typeface`);
      await option.click();assert.equal(await list.locator('[role=option]').count(),total);
      assert.ok((await combo.evaluate(el=>getComputedStyle(el).fontFamily)).includes(font),`${label} keeps ${font} after selection`);
      await combo.click();
    }
    await page.keyboard.press('Escape');assert.equal(await dialog.isVisible(),true,'Escape closes the category menu first');
    await combo.click();await dialog.getByRole('option',{name:'All fonts',exact:true}).click();
    await dialog.locator('[data-font-search]').focus();await page.keyboard.press('ArrowDown');
    assert.equal(await page.locator(':focus').getAttribute('data-font-id'),'bebas-neue');
    await page.keyboard.press('ArrowRight');assert.equal(await page.locator(':focus').getAttribute('data-font-id'),'dm-serif-display');
    await page.keyboard.press('ArrowDown');assert.equal(await page.locator(':focus').getAttribute('data-font-id'),'space-grotesk');
    await page.keyboard.press('Home');assert.equal(await page.locator(':focus').getAttribute('data-font-id'),'bebas-neue');
    await page.keyboard.press('End');assert.equal(await page.locator(':focus').getAttribute('data-font-id'),await list.locator('[role=option]').last().getAttribute('data-font-id'));
    for(const width of [390,320]){
      await page.setViewportSize({width,height:844});await dialog.locator('[data-font-search]').fill('');await dialog.locator('[data-font-search]').press('ArrowDown');
      const bounds=await dialog.boundingBox();assert.ok(bounds.x>=0&&bounds.x+bounds.width<=width&&bounds.y>=0&&bounds.y+bounds.height<=844);
      assert.equal(await list.evaluate(el=>getComputedStyle(el).gridTemplateColumns.split(' ').length),1);
      await combo.click();const menu=fallback?dialog.locator('.ezkart-select-menu[aria-label="Font style"]'):combo;
      const box=await menu.boundingBox();assert.ok(box.x>=0&&box.x+box.width<=width,'Category control stays within the screen');
      const optionBounds=await dialog.getByRole('option',{name:'Handwriting',exact:true}).boundingBox();assert.ok(optionBounds.x>=0&&optionBounds.x+optionBounds.width<=width,'Visual category names stay fully on screen');
      const lines=await dialog.getByRole('option',{name:'Handwriting',exact:true}).evaluate(el=>{const range=document.createRange();range.selectNodeContents(el);return new Set([...range.getClientRects()].map(rect=>Math.round(rect.top))).size;});assert.equal(lines,1,'Category names never break into separate lines');
      await page.screenshot({path:`/tmp/ezkart-font-expansion/categories-${width}-${fallback?'fallback':'native'}.png`});
      await dialog.getByRole('option',{name:'Handwriting',exact:true}).click();assert.equal(await list.locator('[role=option]').count(),40);
      await combo.click();await dialog.getByRole('option',{name:'All fonts',exact:true}).click();
    }
  }finally{await browser.close();await ws.stop();await rm(dir,{recursive:true,force:true});}
});
