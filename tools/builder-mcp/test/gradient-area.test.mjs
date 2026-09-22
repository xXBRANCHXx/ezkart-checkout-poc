import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { chromium } from 'playwright';
import { Workspace } from '../workspace.mjs';

test('section gradient position and height survive UI edits, native conversion, history, reopening and export', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'ezkart-gradient-area-'));
  const ws = await new Workspace(directory).init();
  await ws.create({id:'gradients',name:'Gradient controls'});
  await ws.start();
  const browser = await chromium.launch();
  const page = await browser.newPage({viewport:{width:1600,height:1000},reducedMotion:'reduce'});
  page.setDefaultTimeout(7000);
  const errors = [];
  page.on('pageerror',error=>errors.push(error.message));
  const invoke = (method,args={})=>page.evaluate(({method,args})=>EzkartBuilder[method](args),{method,args});
  const section = page.locator('.sq-page-preview > [data-section-id=blank]');
  const selectSection = async () => {
    await section.scrollIntoViewIfNeeded();
    const box = await section.boundingBox();
    await page.mouse.click(box.x+box.width/2,box.y+70);
    await invoke('settle');
  };
  const setRange = async (locator,value) => {
    await locator.focus();
    await page.keyboard.press('Home');
    for(let i=10;i<value;i++)await page.keyboard.press('ArrowRight');
  };
  const paint = locator => locator.evaluate(node=>{
    const css=getComputedStyle(node);
    return {image:css.backgroundImage.replaceAll(") 0%",")"),size:css.backgroundSize.split(", ")[0],position:css.backgroundPosition.split(", ")[0],repeat:css.backgroundRepeat.split(", ")[0]};
  });
  try {
    await page.goto(ws.url+'/cart/admin/?page=sites&edit=gradients.ezkart.site');
    await page.waitForFunction(()=>globalThis.EzkartBuilder);
    await selectSection();
    await page.locator('[data-sq-section-background-type=gradient]').click();
    await page.locator('[data-sq-gradient=kind]').selectOption('wash');
    const surface = section.locator('.sq-gradient-surface');
    assert.equal((await paint(surface)).size,'140% 210%','Existing soft blends keep the bottom placement');
    const initialHeight = await section.evaluate(node=>node.offsetHeight);
    const centered = page.locator('[data-sq-gradient=centered]');
    await centered.check();
    const height = page.locator('[data-sq-gradient=height]');
    await height.focus();
    await page.keyboard.press('Home');
    await page.keyboard.press('ArrowRight');
    assert.equal(await height.inputValue(),'11');
    assert.equal((await paint(surface)).size,'140% 11%');
    await setRange(height,65);
    await centered.focus();
    const centeredPaint = await paint(surface);
    assert.equal(centeredPaint.size,'140% 65%');
    assert.equal(centeredPaint.position,'50% 50%');
    assert.equal(await section.evaluate(node=>node.offsetHeight),initialHeight,'Gradient height does not resize the section');
    await invoke('undo');
    assert.equal((await paint(surface)).size,'140% 64%');
    await invoke('redo');
    assert.deepEqual(await paint(surface),centeredPaint);
    await page.locator('[data-sq-tab=add]').click();
    await page.locator('[data-sq-add-element=native-heading]').click();
    if(await page.locator('.sq-builder-sidebar.sq-panel-pinned').count())await page.locator('[data-sq-tab=add]').click();
    await invoke('settle');
    assert.equal(await section.locator('.sq-gradient-surface').count(),0);
    assert.deepEqual(await paint(section),centeredPaint,'Adding content preserves the actual gradient paint');
    await selectSection();
    const panel = page.locator('[data-sq-native-inspector]');
    assert.equal(await panel.locator('[data-native-gradient-centered]').isChecked(),true);
    assert.equal(await panel.locator('[data-native-gradient-height]').inputValue(),'65');
    await panel.locator('[data-native-gradient-centered]').uncheck();
    await setRange(panel.locator('[data-native-gradient-height]'),100);
    await panel.locator('[data-native-apply-fill]').click();
    const bottomPaint = await paint(section);
    assert.equal(bottomPaint.size,'140% 210%');
    await invoke('undo');
    assert.deepEqual(await paint(section),centeredPaint);
    await invoke('redo');
    assert.deepEqual(await paint(section),bottomPaint);
    await selectSection();
    await panel.locator('[data-native-gradient-centered]').check();
    await setRange(panel.locator('[data-native-gradient-height]'),65);
    await panel.locator('[data-native-apply-fill]').click();
    await invoke('save');
    await page.reload();
    await page.waitForFunction(()=>globalThis.EzkartBuilder);
    await invoke('settle');
    assert.deepEqual(await paint(section),centeredPaint);
    for(const width of [1600,941,390]) {
      await page.setViewportSize({width,height:1000});
      await selectSection();
      const slider=panel.locator('[data-native-gradient-height]');
      await slider.scrollIntoViewIfNeeded();
      const box=await slider.boundingBox();
      assert.ok(box.width>80 && box.x>=0 && box.x+box.width<=width,'Gradient control fits the editor');
      assert.equal(await slider.inputValue(),'65');
      if(width===1600)await page.screenshot({path:'/tmp/ezkart-gradient-centered-desktop.png'});
      if(width===390)await page.screenshot({path:'/tmp/ezkart-gradient-controls-mobile.png'});
    }
    const html=await invoke('previewHtml');
    await page.route('**/gradient-preview',route=>route.fulfill({body:html,contentType:'text/html'}));
    await page.goto(ws.url+'/gradient-preview');
    for(const width of [320,390,768,1440]) {
      await page.setViewportSize({width,height:1000});
      assert.deepEqual(await paint(page.locator('[data-ezkart-section=blank]')),centeredPaint);
      assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth),width);
    }
    await page.screenshot({path:'/tmp/ezkart-gradient-centered-preview.png'});
    assert.deepEqual(errors,[]);
  } finally {
    await browser.close();
    await ws.stop();
    await rm(directory,{recursive:true,force:true});
  }
});

test('bottom blends retain their geometry when converted and native API updates replace the gradient area', async () => {
  const directory=await mkdtemp(join(tmpdir(),'ezkart-bottom-blend-'));
  const ws=await new Workspace(directory).init();
  await ws.create({id:'bottom',name:'Bottom blend'});
  await ws.start();
  const browser=await chromium.launch();
  const page=await browser.newPage({viewport:{width:1600,height:1000}});
  const invoke=(method,args={})=>page.evaluate(({method,args})=>EzkartBuilder[method](args),{method,args});
  const section=page.locator('[data-section-id=blank][data-sq-block]');
  const geometry=locator=>locator.evaluate(node=>{
    const css=getComputedStyle(node);
    return [css.backgroundSize,css.backgroundPosition,css.backgroundRepeat];
  });
  try {
    await page.goto(ws.url+'/cart/admin/?page=sites&edit=bottom.ezkart.site');
    await page.waitForFunction(()=>globalThis.EzkartBuilder);
    await invoke('updateSection',{id:'blank',gradient:{kind:'wash',from:'#1800f0',opacity:75}});
    const before=await geometry(section.locator('.sq-gradient-surface'));
    await invoke('nativeInsert',{section:'blank',node:{id:'heading',type:'heading',text:'Bottom gradient'}});
    assert.deepEqual(await geometry(section),before);
    assert.deepEqual((await invoke('nativeInspect',{id:'blank'})).fill.area,{centered:false,height:100,wide:true});
    await invoke('updateSection',{id:'blank',gradient:{kind:'wash',centered:true,height:40}});
    assert.deepEqual((await invoke('nativeInspect',{id:'blank'})).fill.area,{centered:true,height:40,wide:true});
    await invoke('undo');
    assert.deepEqual(await geometry(section),before);
    await invoke('updateSection',{id:'blank',gradient:{kind:'linear'}});
    assert.equal((await geometry(section))[0],'auto','Changing away from a soft blend resets its size');
    const config=await invoke('nativeInspect',{id:'blank'});
    for(const height of [0,201,47.619]) {
      await assert.rejects(invoke('nativeUpdate',{id:'blank',fill:{...config.fill,area:{centered:false,height}}}),/Gradient height/);
    }
    assert.deepEqual(await invoke('nativeInspect',{id:'blank'}),config,'Invalid areas do not change the section');
  } finally {
    await browser.close();
    await ws.stop();
    await rm(directory,{recursive:true,force:true});
  }
});
