import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm,mkdir} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {chromium} from 'playwright';
import {Workspace,repoRoot} from '../workspace.mjs';

async function fixture(t) {
  const dir = await mkdtemp(join(tmpdir(),'ezkart-assets-'));
  const ws = await new Workspace(dir).init();
  await ws.create({id:'gallery',name:'Asset gallery'});
  await ws.start();
  const browser = await chromium.launch();
  const page = await browser.newPage({viewport:{width:1600,height:1100},reducedMotion:'reduce'});
  page.setDefaultTimeout(7000);
  const errors = [];
  page.on('pageerror',error => errors.push(error.message));
  t.after(async () => {await browser.close();await ws.stop();await rm(dir,{recursive:true,force:true});assert.deepEqual(errors,[]);});
  const call = (method,args={}) => page.evaluate(({method,args})=>EzkartBuilder[method](args),{method,args});
  await page.goto(ws.url+'/cart/admin/?page=sites&edit=gallery.ezkart.site');
  await page.waitForFunction(()=>globalThis.EzkartBuilder);
  await call('settle');
  const category = async (name,library='elements') => {
    if (!await page.locator('[data-sq-library-category=elements]').isVisible()) await page.locator('[data-sq-tab=add]').click();
    await page.locator(`[data-sq-library-category=${['elements','sections','uploads','saved'].includes(name)?name:library}]`).click();
    if (!['elements','sections','uploads','saved'].includes(name)) {
      const label=await page.locator(`[data-sq-asset-filter] option[value="${name}"]`).textContent();
      await page.locator('.sq-assets-filter-row .sq-builder-select-trigger').click();
      await page.getByRole('option',{name:label,exact:true}).click();
    }
  };
  const shot = async name => {
    if (!process.env.EZKART_ASSET_SCREENSHOTS) return;
    await mkdir(process.env.EZKART_ASSET_SCREENSHOTS,{recursive:true});
    await page.screenshot({path:join(process.env.EZKART_ASSET_SCREENSHOTS,name+'.png')});
  };
  return {ws,browser,page,call,category,shot};
}

test('asset families retain responsive editable starter designs and search the full collection',async t => {
  const {page,call,category,shot} = await fixture(t);
  const ids = await page.evaluate(()=>EzkartAssets.definitions);
  for (const cat of [...new Set(ids.map(item=>item.category))]) {
    await category(cat);
    assert.equal(await page.locator('[data-sq-asset]:visible').count(),ids.filter(item=>item.category===cat).length);
    await shot('gallery-'+cat);
    for (const item of ids.filter(item=>item.category===cat).slice(0,3)) {
      await page.locator(`[data-sq-asset=${item.id}]`).click();
      await call('settle');
      const inserted = (await call('nativeInspect')).find(node=>node.name===item.name);
      assert.ok(inserted,`${item.name} is an editable native group`);
      assert.ok((await call('nativeInspect')).length>2);
      assert.equal(await page.locator('.sq-page-preview iframe').count(),0,'Code artwork contains no executable embed');
      for (const device of ['desktop','mobile']) {
        await call('setDevice',{device});
        await call('settle');
        const overflow = await page.locator(`[data-native-id="${inserted.id}"]`).evaluate(node => [...node.querySelectorAll('.sq-native'),node].filter(n=>n.getClientRects().length && n.scrollWidth > n.clientWidth+2).map(n=>({text:n.textContent.slice(0,40),width:n.clientWidth,scroll:n.scrollWidth})));
        assert.deepEqual(overflow,[],`${item.name} fits on ${device}`);
      }
      await call('setDevice',{device:'desktop'});
      await call('undo');
      await category(cat);
    }
  }
  await category('sections');
  assert.ok(await page.locator('[data-sq-add-block]:visible').count()>=30);
  const search = page.locator('[data-sq-block-search]');
  await search.fill('terminal');
  assert.equal(await page.locator('[data-sq-asset]:visible').count(),ids.filter(item=>item.category==='code').length);
  await search.fill('no such asset xyz');
  assert.equal(await page.locator('[data-sq-library-search-empty]').isVisible(),true);
  await page.locator('[data-sq-clear-block-search]').click();
  for (const width of [941,390]) {
    await page.setViewportSize({width,height:904});
    await category('diagrams');
    await shot('gallery-'+width);
    const panel = page.locator('[data-sq-panel=add]');
    assert.ok(await panel.evaluate(n=>n.scrollWidth<=n.clientWidth+1));
    for (const button of await page.locator('[data-sq-library-category]').all()) {
      const rect = await button.boundingBox();
      assert.ok(rect && rect.x>=0 && rect.x+rect.width<=width,'All categories remain reachable');
    }
  }
});

test('asset and section dragging, nested edits, preview disclosures, history and reopening use the merchant UI',async t => {
  const {page,browser,call,category,shot} = await fixture(t);
  await category('bulletins');
  const section = page.locator('.sq-page-preview > [data-section-id=blank]');
  await page.locator('[data-sq-asset=bulletin-note]').dragTo(section,{targetPosition:{x:450,y:110}});
  await call('settle');
  let nodes = await call('nativeInspect');
  const note = nodes.find(n=>n.name==='Pinned note');
  assert.ok(note);
  assert.equal(note.parent,'blank');
  assert.ok(note.responsive?.some(rule=>rule.device==='desktop' && parseFloat(rule.props.left)>0),'Drop location is preserved');
  const beforeUndo = await call('nativeInspect');
  await page.locator('[data-sq-undo]').click();
  assert.equal((await call('nativeInspect')).length,0);
  await page.locator('[data-sq-redo]').click();
  assert.deepEqual(await call('nativeInspect'),beforeUndo);
  // Put a second asset into a different, existing preset section.
  await category('sections');
  await page.locator('[data-sq-add-block=story-split]').dragTo(section,{targetPosition:{x:500,y:200}});
  await call('settle');
  const legacy = page.locator('.sq-page-preview > [data-sq-composition=story-split]');
  assert.equal(await legacy.count(),1);
  await category('accordions');
  await page.locator('[data-sq-asset=accordion-cards]').dragTo(legacy,{targetPosition:{x:200,y:120}});
  await call('settle');
  const accordion = (await call('nativeInspect')).find(n=>n.name==='Soft cards');
  assert.ok(accordion);
  assert.equal(await legacy.locator(`[data-native-id="${accordion.id}"]`).count(),1,'The asset stays in the section where it was dropped');
  const answer = (await call('nativeInspect')).find(n=>n.type==='text' && n.text?.startsWith('Tell the story'));
  const leaf = page.locator(`[data-native-id="${answer.id}"]`);
  await leaf.click();
  await page.locator('[data-native-text]').fill('A clear answer, edited on the page.');
  await leaf.click();
  assert.equal((await call('nativeInspect',{id:answer.id})).text,'A clear answer, edited on the page.');
  await call('save');
  const saved = await call('nativeInspect');
  await page.reload();
  await page.waitForFunction(()=>globalThis.EzkartBuilder);
  await call('settle');
  assert.deepEqual(await call('nativeInspect'),saved);
  await shot('placed-assets');
  const html = await call('previewHtml');
  assert.ok(html.includes('A clear answer, edited on the page.'));
  const preview = await browser.newPage({viewport:{width:390,height:844}});
  await preview.setContent(html);
  const second = preview.locator(`[data-native-id="${accordion.id}"] details`).nth(1);
  await second.locator('summary').focus();
  await preview.keyboard.press('Enter');
  assert.equal(await second.getAttribute('open'),'');
  await preview.keyboard.press('Enter');
  assert.equal(await second.getAttribute('open'),null);
  await preview.close();
});

test('uploads are reusable across pages and sessions, with images embedded for preview and export',async t => {
  const {ws,page,call,category,shot} = await fixture(t);
  await category('uploads');
  await page.locator('[data-sq-asset-upload]').setInputFiles(join(repoRoot,'cart/admin/assets/products/kopi-susu.webp'));
  await page.locator('[data-sq-upload-asset]').waitFor();
  await page.locator('[data-sq-upload-asset]').click();
  await page.waitForFunction(()=>EzkartBuilder.nativeInspect().some(n=>n.type==='image'));
  const photo = (await call('nativeInspect')).find(n=>n.type==='image');
  assert.match(photo.src,/^data:image\/webp;base64,/);
  await page.locator(`[data-native-id="${photo.id}"]`).evaluate(n=>n.decode());
  await call('save');
  await ws.create({id:'second',name:'Another page'});
  await page.goto(ws.url+'/cart/admin/?page=sites&edit=second.ezkart.site');
  await page.waitForFunction(()=>globalThis.EzkartBuilder);
  await category('uploads');
  await page.locator('[data-sq-assets-upload-status]').filter({hasText:/file/}).waitFor();
  assert.equal(await page.locator('[data-sq-upload-asset]').count(),1,'A placed copy does not duplicate the original upload');
  await shot('uploads');
  await page.locator('[data-sq-upload-asset]').first().dragTo(page.locator('.sq-page-preview > [data-sq-block]'),{targetPosition:{x:300,y:100}});
  await page.waitForFunction(()=>EzkartBuilder.nativeInspect().some(n=>n.type==='image'));
  assert.equal((await call('nativeInspect')).find(n=>n.type==='image').src,photo.src);
  await call('save');
  await page.reload();
  await page.waitForFunction(()=>globalThis.EzkartBuilder);
  assert.equal((await call('nativeInspect')).find(n=>n.type==='image').src,photo.src);
  const html = await call('previewHtml');
  assert.ok(html.includes(photo.src));
});

test('sidebar resizing persists, stays within narrow screens, and adds whole editable sections with one undo',async t=>{
  const {page,call,category,shot}=await fixture(t);
  await category('elements');
  const panel=page.locator('[data-sq-panel=add]'),grip=page.getByRole('separator',{name:'Resize Assets sidebar'});
  assert.equal(await panel.isVisible(),true,'Assets opens by default');
  assert.equal(await page.locator('[data-sq-assets-expand]').count(),0,'Width is controlled by the edge, not a button');
  const before=(await panel.boundingBox()).width;
  const handle=await grip.boundingBox();
  await page.mouse.move(handle.x+handle.width/2,handle.y+handle.height/2);await page.mouse.down();
  await page.mouse.move(handle.x+handle.width/2+320,handle.y+handle.height/2,{steps:10});await page.mouse.up();
  const resized=(await panel.boundingBox()).width;
  assert.ok(resized>before+250);
  assert.equal(await page.locator('[data-sq-asset-catalog=text]').evaluate(n=>getComputedStyle(n).gridTemplateColumns.split(' ').length),3);
  await shot('resized-library');
  await page.locator('[data-sq-asset=code-recipe]').scrollIntoViewIfNeeded();
  assert.equal(await grip.isVisible(),true,'The edge remains reachable while browsing');
  await grip.focus();await page.keyboard.press('ArrowLeft');
  assert.equal(Number(await grip.getAttribute('aria-valuenow')),resized-16);
  await page.keyboard.press('ArrowRight');
  await page.reload();await page.waitForFunction(()=>globalThis.EzkartBuilder);
  await category('reviews','sections');
  assert.equal(Number(await grip.getAttribute('aria-valuenow')),resized,'The exact width survives reopening');
  assert.equal(await page.locator('[data-sq-add-block]:visible').count(),4,'Existing quote and new designs share one family');
  const target=page.locator('.sq-page-preview > [data-section-id=blank]'),bounds=await target.boundingBox();
  await page.locator('[data-sq-add-block=asset-section-review-editorial]').dragTo(target,{targetPosition:{x:bounds.width*.7,y:bounds.height*.6}});
  await call('settle');
  const inserted=page.locator('.sq-page-preview > [data-section-id^="asset-section-review-editorial-"]');
  assert.equal(await inserted.count(),1);
  await page.locator('[data-sq-undo]').click();assert.equal(await inserted.count(),0);
  await page.locator('[data-sq-redo]').click();assert.equal(await inserted.count(),1);
  // Clicking a section card also creates a whole section, independent of selection.
  for(const family of ['accordions','contact','invitations','pricing','footers']) {
    await category(family,'sections');
    await page.locator('[data-sq-add-block]:visible').last().click();
    await call('settle');
  }
  const sectionCount=await page.locator('.sq-page-preview > [data-sq-block]').count();
  assert.equal(sectionCount,7);
  const nodes=await call('nativeInspect');
  assert.ok(nodes.some(node=>node.name==='Conversation card'));
  await call('save');await page.reload();await page.waitForFunction(()=>globalThis.EzkartBuilder);await call('settle');
  assert.equal(await page.locator('.sq-page-preview > [data-sq-block]').count(),sectionCount);
  assert.deepEqual(await call('nativeInspect'),nodes);
  for(const width of [941,390]) {
    await page.setViewportSize({width,height:904});await category('contact','sections');
    const rect=await panel.boundingBox();assert.ok(rect.x>=0 && rect.x+rect.width<=width,'Expanded panel stays on screen');
    assert.equal(await panel.evaluate(n=>n.scrollWidth>n.clientWidth+1),false);
    assert.ok(await grip.isVisible());await shot(`expanded-${width}`);
  }
});
