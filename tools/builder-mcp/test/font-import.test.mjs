import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm,readFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {chromium} from 'playwright';
import {Workspace,repoRoot} from '../workspace.mjs';
import {openAssets,chooseBasic} from './asset-helpers.mjs';

test('import fonts through the picker, retain them across pages and sessions, and embed only used fonts',async()=>{
  const dir=await mkdtemp(join(tmpdir(),'ezkart-import-font-')),ws=await new Workspace(dir).init();await ws.create({id:'fonts',name:'Fonts'});await ws.create({id:'second',name:'Second page'});await ws.start();
  const browser=await chromium.launch(),context=await browser.newContext({viewport:{width:1200,height:950},reducedMotion:'reduce'}),page=await context.newPage();
  page.setDefaultTimeout(10000);
  const errors=[];page.on('pageerror',error=>errors.push(error.message));
  const call=(method,args={})=>page.evaluate(({method,args})=>EzkartBuilder[method](args),{method,args});
  const dialog=page.locator('[data-sq-font-dialog]'),file=dialog.locator('[data-font-file]'),status=dialog.locator('[data-font-upload-status]');
  const type=await readFile(join(repoRoot,'cart/admin/assets/fonts/pacifico.woff2'));
  try{
    await page.goto(ws.url+'/cart/admin/?page=sites&edit=fonts.ezkart.site');await page.waitForFunction(()=>globalThis.EzkartBuilder);await call('settle');
    await openAssets(page);await chooseBasic(page,'native-heading');
    const heading=(await call('nativeInspect')).filter(node=>node.type==='heading').at(-1),node=page.locator(`[data-native-id="${heading.id}"]`);
    if(await page.locator('.sq-builder-sidebar.sq-panel-pinned').count())await page.locator('[data-sq-tab=add]').click();await node.click();
    const typography=page.locator('[data-sq-native-inspector] details').filter({has:page.locator(':scope > summary',{hasText:'Font & text alignment'})});
    if(!await typography.evaluate(el=>el.open))await typography.locator(':scope > summary').click();
    const picker=typography.locator('[data-sq-font-picker]');await picker.click();
    await dialog.locator('[data-font-category]').selectOption('uploaded');assert.match(await dialog.locator('[data-font-list]').innerText(),/Upload a font/);
    const chooser=page.waitForEvent('filechooser');await dialog.getByRole('button',{name:'Upload a font',exact:true}).click();
    await (await chooser).setFiles({name:'My Studio.woff2',mimeType:'',buffer:type});
    await page.waitForFunction(()=>document.querySelector('[data-font-upload-status]').textContent.includes('is ready'));
    assert.equal(await dialog.locator('[data-font-category]').inputValue(),'uploaded');
    const choice=dialog.locator('[data-font-list] [role=option]');assert.equal(await choice.count(),1);assert.match(await choice.innerText(),/My Studio/);
    const id=await choice.getAttribute('data-font-id'),family=await choice.getAttribute('data-font-family');assert.match(family,/Ezkart_font_/);
    await page.screenshot({path:'/tmp/ezkart-font-expansion/import-desktop.png'});
    await choice.click();await call('settle');assert.equal((await call('nativeInspect',{id:heading.id})).props.fontFamily,family);
    await call('undo');assert.notEqual((await call('nativeInspect',{id:heading.id})).props.fontFamily,family);await call('redo');assert.equal((await call('nativeInspect',{id:heading.id})).props.fontFamily,family);
    await call('save');await page.reload();await page.waitForFunction(()=>globalThis.EzkartBuilder);await call('settle');
    assert.equal((await call('nativeInspect',{id:heading.id})).props.fontFamily,family);
    assert.equal(await page.evaluate(id=>[...document.fonts].some(font=>font.family===`Ezkart_${id}`&&font.status==='loaded'),id),true,'Saved text loads its private font after reopening');
    await node.click();if(!await typography.evaluate(el=>el.open))await typography.locator(':scope > summary').click();assert.match(await picker.innerText(),/My Studio/);await picker.click();
    await file.setInputFiles({name:'Duplicate.woff2',mimeType:'font/woff2',buffer:type});await page.waitForFunction(()=>document.querySelector('[data-font-upload-status]').textContent.includes('is ready'));
    assert.equal(await choice.count(),1,'Importing the same font twice does not duplicate it');
    await file.setInputFiles({name:'broken.woff2',mimeType:'font/woff2',buffer:Buffer.from('this is not a font')});await page.waitForFunction(()=>document.querySelector('[data-font-upload-status]').classList.contains('is-error'));assert.match(await status.innerText(),/Choose a WOFF2/);assert.equal(await choice.count(),1);
    const corrupt=Buffer.alloc(100);corrupt.write('wOF2');await file.setInputFiles({name:'broken.woff2',mimeType:'font/woff2',buffer:corrupt});await page.waitForFunction(()=>document.querySelector('[data-font-upload-status]').textContent.includes('could not be read'));
    await file.setInputFiles({name:'too-large.ttf',mimeType:'font/ttf',buffer:Buffer.alloc(5*1024*1024+1)});await page.waitForFunction(()=>document.querySelector('[data-font-upload-status]').textContent.includes('up to 5 MB'));
    let failUpload=true;
    await page.route('**/*',async route=>{const request=route.request(),url=new URL(request.url());if(failUpload&&request.method()==='POST'&&url.searchParams.get('cloud')==='/v1/fonts')return route.fulfill({status:503,contentType:'application/json',body:JSON.stringify({ok:false,error:'Upload unavailable. Please try again.'})});return route.continue();});
    await file.setInputFiles({name:'Retry.woff2',mimeType:'font/woff2',buffer:type});await page.waitForFunction(()=>document.querySelector('[data-font-upload-status]').textContent.includes('Upload unavailable'));assert.equal(await choice.count(),1);failUpload=false;
    for(const format of ['woff2','woff','ttf','otf']){
      await file.setInputFiles({name:`Own ${format}.${format}`,mimeType:'',buffer:await readFile(join(repoRoot,`cloudflare/ezkart-api/test/fixtures/fonts/sample.${format}`))});
      await page.waitForFunction(()=>document.querySelector('[data-font-upload-status]').textContent.includes('is ready'));assert.equal(await status.evaluate(el=>el.classList.contains('is-error')),false,`${format} loads in the browser`);
    }
    assert.equal(await choice.count(),5);await page.setViewportSize({width:320,height:844});await page.screenshot({path:'/tmp/ezkart-font-expansion/import-mobile.png'});
    for(const element of [dialog,dialog.locator('[data-font-upload]'),dialog.locator('[data-font-custom-apply]')]){
      if(!await element.isVisible())continue;const box=await element.boundingBox();assert.ok(box.x>=0&&box.x+box.width<=321&&box.y>=0&&box.y+box.height<=844,'Import controls remain on screen');
    }
    await page.setViewportSize({width:640,height:420});await dialog.locator('[data-font-upload]').scrollIntoViewIfNeeded();
    const uploadBox=await dialog.locator('[data-font-upload]').boundingBox();assert.ok(uploadBox.y>=0&&uploadBox.y+uploadBox.height<=420,'Import remains reachable in a short window');
    await dialog.locator('[data-font-close]').click();await page.setViewportSize({width:1200,height:950});
    await page.locator('[data-sq-preview]').click();await page.locator('[data-sq-preview-close]').waitFor();
    const live=await page.locator('[data-sq-live-preview-frame]').elementHandle().then(el=>el.contentFrame());await live.locator(`[data-native-id="${heading.id}"]`).waitFor();await live.evaluate(()=>document.fonts.ready);
    assert.ok(await live.evaluate(id=>[...document.fonts].some(font=>font.family.includes(id)&&font.status==='loaded'),id),'Interactive preview loads the embedded upload');await page.locator('[data-sq-preview-close]').click();
    const html=await call('previewHtml'),faces=[...html.matchAll(/@font-face\{[^}]+\}/g)].map(match=>match[0]);
    assert.equal(faces.filter(face=>face.includes('Ezkart_font_')).length,1,'Unused uploads stay out of exports');assert.ok(faces.some(face=>face.includes(id)&&face.includes('data:font/woff2;base64,')));
    const offline=await browser.newContext({offline:true}),rendered=await offline.newPage();await rendered.setContent(html);await rendered.evaluate(()=>document.fonts.ready);assert.ok(await rendered.evaluate(id=>[...document.fonts].some(font=>font.family.includes(id)&&font.status==='loaded'),id),'Exported font loads without network access');await offline.close();
    const fresh=await browser.newContext(),second=await fresh.newPage();await second.goto(ws.url+'/cart/admin/?page=sites&edit=second.ezkart.site');await second.waitForFunction(()=>globalThis.EzkartBuilder);await second.evaluate(()=>EzkartBuilder.settle());
    await second.locator('[data-sq-tab=brand]').click();await second.locator('[data-sq-brand-font=heading]').locator('..').locator('[data-sq-font-picker]').click();await second.locator('[data-font-category]').selectOption('uploaded');assert.equal(await second.locator('[data-font-list] [role=option]').count(),5,'A new session and another page use the account library');
    await second.locator(`[data-font-id="${id}"]`).click();await second.evaluate(()=>EzkartBuilder.settle());assert.match(await second.locator('[data-sq-preview-root]').getAttribute('style'),new RegExp(id));await fresh.close();
    assert.deepEqual(errors,[]);
  }finally{await browser.close();await ws.stop();await rm(dir,{recursive:true,force:true});}
});
