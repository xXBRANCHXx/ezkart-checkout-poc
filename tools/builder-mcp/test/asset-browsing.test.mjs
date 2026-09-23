import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { chromium } from 'playwright';
import { Workspace } from '../workspace.mjs';
import { openAssets } from './asset-helpers.mjs';

test('three-preview overview opens a focused collection with scoped search, back navigation and editable insertion', async () => {
  const dir=await mkdtemp(join(tmpdir(),'ezkart-browse-'));
  const ws=await new Workspace(dir).init();
  await ws.create({id:'browse',name:'Asset browser'});await ws.start();
  const browser=await chromium.launch();
  const page=await browser.newPage({viewport:{width:1440,height:1000},reducedMotion:'reduce'});
  const errors=[];page.on('pageerror',e=>errors.push(e.message));page.setDefaultTimeout(7000);
  const call=(method,args={})=>page.evaluate(({method,args})=>EzkartBuilder[method](args),{method,args});
  const artifacts=process.env.EZKART_BROWSING_SCREENSHOTS;
  if(artifacts)await mkdir(artifacts,{recursive:true});
  try {
    await page.goto(ws.url+'/cart/admin/?page=sites&edit=browse.ezkart.site');
    await page.waitForFunction(()=>globalThis.EzkartBuilder);await openAssets(page);
    const definitions=await page.evaluate(()=>EzkartAssets.definitions);
    const categories=await page.evaluate(()=>EzkartAssets.categories);
    const root=page.locator('[data-sq-panel="add"]');
    const before=await call('nativeInspect');
    for(const category of categories) {
      const group=root.locator(`.sq-asset-group[data-sq-asset-purpose="${category.id}"]`);
      assert.equal(await group.locator('[data-sq-asset]:visible').count(),3);
      assert.equal(await group.locator('[data-sq-view-category]').isVisible(),true);
      assert.equal((await group.locator('h3 > span').textContent()),`${definitions.filter(d=>d.category===category.id).length} designs`);
    }
    // Hidden designs do not build large nested preview trees on initial load.
    if(definitions.length>42) assert.equal(await root.locator('.sq-asset-group [data-sq-asset][hidden] .sq-asset-preview > *').count(),0);
    const more=root.getByRole('button',{name:'View more Text & typography',exact:true});
    await more.scrollIntoViewIfNeeded();
    if(artifacts)await page.screenshot({path:join(artifacts,'overview.png')});
    await more.click();
    assert.equal(await root.locator('[data-sq-category-title]').textContent(),'Text & typography');
    assert.equal(await root.locator('[data-sq-asset]:visible').count(),definitions.filter(d=>d.category==='text').length);
    assert.equal(await root.locator('[data-sq-asset-filter-row]').isVisible(),false);
    assert.equal(await root.locator('.sq-asset-basics').isVisible(),false);
    if(artifacts)await page.screenshot({path:join(artifacts,'text-collection.png')});
    const search=root.locator('[data-sq-block-search]');
    await search.fill('terminal');
    assert.equal(await root.locator('[data-sq-asset]:visible').count(),0,'Category search does not leak code artwork');
    assert.equal(await root.locator('[data-sq-library-search-empty]').isVisible(),true);
    await root.getByRole('button',{name:'Clear search',exact:true}).click();
    await search.fill('editorial');
    assert.ok(await root.locator('[data-sq-asset]:visible').count()>0);
    assert.equal(await root.locator('[data-sq-asset]:visible').evaluateAll(nodes=>nodes.every(n=>n.dataset.sqAssetPurpose==='text')),true);
    await page.keyboard.press('Escape');
    assert.equal(await root.locator('[data-sq-category-title]').isVisible(),false);
    assert.equal(await more.evaluate(n=>n===document.activeElement),true);
    assert.deepEqual(await call('nativeInspect'),before,'Browsing never edits the page');

    await more.click();await root.locator('[data-sq-asset="text-editorial"]').click();
    await call('settle');
    const inserted=(await call('nativeInspect')).find(n=>n.name==='Editorial title');
    assert.ok(inserted);
    await call('undo');assert.deepEqual(await call('nativeInspect'),before);
    await call('redo');assert.ok((await call('nativeInspect')).find(n=>n.id===inserted.id));
    await call('save');const saved=await call('nativeInspect');await page.reload();
    await page.waitForFunction(()=>globalThis.EzkartBuilder);assert.deepEqual(await call('nativeInspect'),saved);
    await openAssets(page);
    for(const width of [941,390,320]) {
      await page.setViewportSize({width,height:904});await call('settle');await openAssets(page);
      await root.locator('[data-sq-library-category="elements"]').click();
      await more.click();
      assert.equal(await root.evaluate(n=>n.scrollWidth<=n.clientWidth+1),true,`Collection fits ${width}px`);
      const back=root.getByRole('button',{name:'Back to all elements',exact:true});
      const box=await back.boundingBox();assert.ok(box.x>=0&&box.x+box.width<=width);
      if(artifacts)await page.screenshot({path:join(artifacts,`collection-${width}.png`)});
      await back.click();assert.equal(await more.isVisible(),true);
    }
    await root.locator('[data-sq-library-category="sections"]').click();
    const sectionMore=root.locator('[data-sq-view-category="accordions"][data-sq-view-library="sections"]');
    await sectionMore.click();
    assert.equal(await root.locator('[data-sq-category-title]').textContent(),'FAQ & accordions');
    assert.equal(await root.locator('[data-sq-add-block]:visible').evaluateAll(nodes=>nodes.every(n=>n.dataset.sqAssetPurpose==='accordions')),true);
    assert.deepEqual(errors,[]);
  } finally {await browser.close();await ws.stop();await rm(dir,{recursive:true,force:true});}
});
