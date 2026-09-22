import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { chromium } from 'playwright';
import { Workspace } from '../workspace.mjs';

test('Takar purchase controls remain editable after selecting an existing text element', async () => {
  const directory=await mkdtemp(join(tmpdir(),'ezkart-inspector-selection-'));
  const ws=await new Workspace(directory).init();
  await writeFile(join(directory,'catalog.json'),JSON.stringify({products:[{
    id:'syrup',name:'Zero sugar syrup',type:'physical',status:'active',price:42500,stock:10,
    variants:[{id:'plain',name:'Plain · 250ml',price:42500,stock:10}],
  }]}));
  await ws.create({id:'takar',name:'Takar'});
  await ws.start();
  const browser=await chromium.launch();
  const page=await browser.newPage({viewport:{width:941,height:1024},reducedMotion:'reduce'});
  page.setDefaultTimeout(6000);
  const errors=[];
  page.on('pageerror',error=>errors.push(error.message));
  const invoke=(method,args={})=>page.evaluate(({method,args})=>EzkartBuilder[method](args),{method,args});
  const panel=page.locator('[data-sq-native-inspector]');
  try {
    await page.goto(ws.url+'/cart/admin/?page=sites&edit=takar.ezkart.site');
    await page.waitForFunction(()=>globalThis.EzkartBuilder);
    await invoke('applyTemplate',{templateId:'takar',productIds:['syrup'],brandName:'Takar'});
    await invoke('addSection',{component:'centered-showcase',id:'existing'});
    await page.locator('.ezm-hero h1 .ezm-gradient-text').click();
    assert.equal(await page.locator('[data-sq-element-panel=style]').isVisible(),true);
    assert.equal(await panel.locator('[data-native-word-controls]').isVisible(),true);
    await page.locator('[data-native-id=hero-add] button').click();
    assert.equal(await page.locator('[data-sq-inspector-title]').innerText(),'Hero add');
    
    assert.equal(await panel.isVisible(),true,'Hero add must display its editor after selecting existing text');
    assert.equal(await panel.locator('[data-native-product-controls]').isVisible(),true);
    assert.equal(await panel.locator('[data-native-commerce-controls]').isVisible(),true);
    assert.equal(await panel.locator('[data-commerce-setting=label]').inputValue(),'Tambah');
    const label=panel.locator('[data-commerce-setting=label]');
    await label.fill('Add syrup');
    await label.blur();
    const button=page.locator('[data-native-id=hero-add] button');
    assert.match(await button.innerText(),/Add syrup/);
    await invoke('undo');
    assert.match(await button.innerText(),/Tambah/);
    await invoke('redo');
    assert.match(await button.innerText(),/Add syrup/);
    await button.click();
    await panel.locator('[data-commerce-setting=showPrice]').uncheck();
    assert.equal((await invoke('nativeInspect',{id:'hero-add'})).showPrice,false);
    await panel.locator('[data-native-solid-color]').fill('#e6efdf');
    await panel.locator('[data-native-apply-fill]').click();
    assert.equal(await page.locator('[data-native-id=hero-add]').evaluate(node=>getComputedStyle(node).backgroundColor),'rgb(230, 239, 223)');
    for(const width of [1600,941]) {
      await page.setViewportSize({width,height:1024});
      await page.locator('.ezm-hero h1 .ezm-gradient-text').click();
      assert.equal(await panel.locator('[data-native-word-controls]').isVisible(),true,'Existing text can still open its word editor');
      await button.click();
      assert.equal(await panel.isVisible(),true);
      assert.equal(await label.inputValue(),'Add syrup');
      assert.equal(await panel.locator('[data-native-product-id]').inputValue(),'syrup');
      await label.scrollIntoViewIfNeeded();
      const bounds=await label.boundingBox();
      assert.ok(bounds.width>100 && bounds.x>=0 && bounds.x+bounds.width<=width,'Purchase controls fit beside the canvas');
    }
    await page.locator('[data-sq-grid-toggle]').first().click();
    await panel.locator('[data-native-product-controls]').scrollIntoViewIfNeeded();
    await page.screenshot({path:'/tmp/ezkart-hero-add-inspector-fixed.png'});
    await invoke('save');
    await page.reload();
    await page.waitForFunction(()=>globalThis.EzkartBuilder);
    await button.click();
    assert.equal(await panel.isVisible(),true);
    assert.equal(await label.inputValue(),'Add syrup');
    assert.equal((await invoke('nativeInspect',{id:'hero-add'})).showPrice,false);

    // Selecting a native section after a legacy element must also restore its panel.
    await page.locator('.ezm-hero h1 .ezm-gradient-text').click();
    const hero=page.locator('[data-native-id=hero-add]').locator('xpath=ancestor::*[@data-sq-block]');
    await hero.scrollIntoViewIfNeeded();
    const bounds=await hero.boundingBox();
    await page.mouse.click(bounds.x+5,bounds.y+55);
    await invoke('settle');
    assert.equal(await panel.isVisible(),true);
    assert.equal(await page.locator('[data-sq-inspector-context]').innerText(),'Selected section');
    assert.equal(await panel.locator('[data-native-fill-section]').isVisible(),true);
    assert.deepEqual(errors,[]);
  } finally {
    await browser.close();
    await ws.stop();
    await rm(directory,{recursive:true,force:true});
  }
});
