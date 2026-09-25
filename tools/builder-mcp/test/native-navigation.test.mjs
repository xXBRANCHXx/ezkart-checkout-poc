import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {chromium} from 'playwright';
import {Workspace} from '../workspace.mjs';

test('Sela native navbar exposes shared effects without changing its design, with history and preview persistence', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'ezkart-native-navigation-'));
  const ws = await new Workspace(directory).init();
  await ws.create({id:'sela', name:'Sela navigation'}); await ws.start();
  const browser = await chromium.launch();
  const page = await browser.newPage({viewport:{width:1600,height:1000}, reducedMotion:'reduce'});
  page.setDefaultTimeout(6000);
  const errors=[]; page.on('pageerror', e=>errors.push(e.message));
  const invoke=(method,args={})=>page.evaluate(({method,args})=>EzkartBuilder[method](args),{method,args});
  const selector='.sq-page-preview > [data-native-id="sela-navigation"]';
  const nav=page.locator(selector);
  const effects=async target=>target.locator(selector).evaluate(n=>{
    const s=getComputedStyle(n),r=n.getBoundingClientRect();
    return {position:s.position,background:s.backgroundColor,blur:s.backdropFilter,shadow:s.boxShadow,top:r.top,bottom:r.bottom,height:n.offsetHeight};
  });
  const slider=async(name,value)=>{
    const input=page.locator(`[data-sq-navigation-${name}]`);
    await input.focus(); await input.fill(String(value)); await input.dispatchEvent('input'); await input.dispatchEvent('change'); await invoke('settle');
  };
  const select=async()=>{
    await page.locator('.sq-canvas-scroll').evaluate(n=>n.scrollTop=0);
    await nav.locator('[data-native-id="nav-brand-name"]').click(); await invoke('settle');
  };
  try {
    await page.goto(ws.url+'/cart/admin/?page=sites&edit=sela.ezkart.site');
    await page.waitForFunction(()=>globalThis.EzkartBuilder);
    await invoke('applyTemplate',{templateId:'sela',brandName:'Sela test',productIds:[]});
    await invoke('settle');
    const original=await effects(page);
    const originalConfig=await nav.getAttribute('data-sq-native');
    const originalOrder=await page.locator('.sq-page-preview > [data-sq-block]').evaluateAll(nodes=>nodes.map(n=>n.dataset.sectionId));
    await select();
    assert.equal(await page.locator('[data-sq-navigation-sticky]').isVisible(),true,'Native navbar children expose the effects panel');
    assert.equal(await page.locator('[data-sq-navigation-sticky]').isChecked(),true,'The controls read the existing native sticky position');
    const selected=await effects(page);
    for(const key of ['position','background','blur','shadow','height']) assert.equal(selected[key],original[key],'Selection alone leaves the header unchanged');
    assert.equal(await nav.getAttribute('data-sq-nav-position'),null);
    await nav.click({position:{x:4,y:(await nav.boundingBox()).height/2}});
    assert.equal(await page.locator('[data-sq-navigation-overlay]').isVisible(),true,'Section selection exposes the same controls');
    await page.locator('.sq-navigation-advanced > summary').click();
    await page.locator('[data-sq-navigation-surface="blur"]').click();
    await slider('blur',24); await slider('opacity',20);
    assert.match((await effects(page)).blur,/blur\(24px\)/);
    assert.match((await effects(page)).background,/0\.2\)/);
    assert.equal((await effects(page)).height,original.height);
    assert.equal(await nav.getAttribute('data-sq-native'),originalConfig,'Behavior settings preserve native layout and content');
    assert.deepEqual(await page.locator('.sq-page-preview > [data-sq-block]').evaluateAll(nodes=>nodes.map(n=>n.dataset.sectionId)),originalOrder,'Effects preserve the announcement and section order');
    await page.locator('[data-sq-navigation-sticky]').focus(); await page.keyboard.press('Space');
    assert.equal((await effects(page)).position,'relative');
    await invoke('undo'); assert.equal((await effects(page)).position,'sticky');
    await invoke('redo'); assert.equal((await effects(page)).position,'relative');
    await page.locator('[data-sq-navigation-sticky]').focus(); await page.keyboard.press('Space');
    await page.locator('[data-sq-navigation-overlay]').locator('..').click(); await invoke('settle');
    const heroTop=await page.locator('[data-native-id="sela-hero"]').evaluate(n=>n.getBoundingClientRect().top);
    assert.ok(Math.abs((await effects(page)).top-heroTop)<2,'Overlay shares the hero bounds');
    await page.locator('[data-sq-navigation-overlay]').locator('..').click();
    await page.locator('[data-sq-navigation-hide-scroll]').locator('..').click();
    await page.locator('[data-sq-navigation-stuck-shadow]').locator('..').click();
    await invoke('save'); await page.reload(); await page.waitForFunction(()=>globalThis.EzkartBuilder); await invoke('settle');
    assert.match((await effects(page)).blur,/blur\(24px\)/);
    await select();
    await page.locator('.sq-navigation-advanced > summary').click();
    await page.setViewportSize({width:941,height:1000}); await invoke('settle');
    await select();
    if(!await page.locator('.sq-navigation-advanced').evaluate(n=>n.open)) await page.locator('.sq-navigation-advanced > summary').click();
    assert.equal(await page.locator('[data-sq-navigation-surface="blur"]').isVisible(),true);
    await page.locator('.sq-inspector-scroll').evaluate(n=>n.scrollTop=0);
    assert.equal(await page.locator('[data-sq-navigation-overlay]').evaluate(n=>{
      const label=n.parentElement,r=label.getBoundingClientRect();
      return label.contains(document.elementFromPoint(r.x+r.width/2,r.y+r.height/2));
    }),true,'The navigation controls are at the top of the inspector, not below the native settings');
    await page.screenshot({path:'/tmp/ezkart-native-navigation-941.png'});
    await page.setViewportSize({width:1600,height:1000}); await invoke('settle');
    await page.screenshot({path:'/tmp/ezkart-native-navigation-1600.png'});
    await page.locator('[data-sq-preview]').click();
    const frame=await page.locator('[data-sq-live-preview-frame]').elementHandle().then(n=>n.contentFrame());
    await frame.locator(selector).waitFor();
    assert.match((await effects(frame)).blur,/blur\(24px\)/,'The merchant Preview retains effects');
    await page.locator('[data-sq-preview-close]').click();
    const render=await browser.newPage({viewport:{width:1440,height:800},reducedMotion:'reduce'});
    let html=''; await render.route('**/navigation-preview',route=>route.fulfill({body:html,contentType:'text/html'}));
    for(const position of ['sticky','fixed','static']) {
      await page.locator(`[data-sq-navigation-position="${position}"]`).click(); await invoke('settle');
      html=await invoke('previewHtml');
      for(const width of [1440,390]) {
        await render.setViewportSize({width,height:800}); await render.goto(ws.url+'/navigation-preview');
        await render.evaluate(async()=>{await document.fonts.ready;for(let i=0;i<3;i++)await new Promise(requestAnimationFrame)});
        assert.match((await effects(render)).blur,/blur\(24px\)/);
        assert.equal(await render.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
        await render.evaluate(()=>scrollTo(0,300));
        if(position==='static') assert.ok((await effects(render)).bottom<0);
        else {
          await render.waitForFunction(s=>document.querySelector(s).getBoundingClientRect().bottom<=1,selector);
          await render.evaluate(()=>scrollTo(0,150));
          await render.waitForFunction(s=>Math.abs(document.querySelector(s).getBoundingClientRect().top)<1,selector);
          assert.notEqual((await effects(render)).shadow,'none');
        }
        if(position==='sticky') await render.screenshot({path:`/tmp/ezkart-native-navigation-preview-${width}.png`});
      }
    }
    await render.close();
    assert.deepEqual(errors,[]);
  } catch(error) {await page.screenshot({path:'/tmp/ezkart-native-navigation-failure.png'});throw error;}
  finally {await browser.close();await ws.stop();await rm(directory,{recursive:true,force:true});}
});

test('Native header controls preserve authored blur, colors and responsive backgrounds', async () => {
  const directory=await mkdtemp(join(tmpdir(),'ezkart-authored-navigation-'));
  const ws=await new Workspace(directory).init();
  await ws.create({id:'authored',name:'Authored header'}); await ws.start();
  const browser=await chromium.launch();
  const page=await browser.newPage({viewport:{width:1600,height:1000}});
  const invoke=(method,args={})=>page.evaluate(({method,args})=>EzkartBuilder[method](args),{method,args});
  try {
    await page.goto(ws.url+'/cart/admin/?page=sites&edit=authored.ezkart.site');
    await page.waitForFunction(()=>globalThis.EzkartBuilder);
    await invoke('nativeInsert',{section:'blank',node:{id:'blank',type:'container',tag:'header',props:{position:'sticky',top:'18px',backgroundColor:'#173650',backdropFilter:'blur(12px)',height:'100px'},responsive:[{max:600,props:{backgroundColor:'#5c2233'}}],children:[{id:'brand',type:'text',text:'An authored header',props:{color:'#ffffff'}}]}});
    await invoke('settle');
    const header=page.locator('.sq-page-preview > [data-native-id="blank"]');
    await header.locator('[data-native-id="brand"]').click();
    await page.locator('.sq-navigation-advanced > summary').click();
    assert.equal(await page.locator('[data-sq-navigation-surface="blur"]').getAttribute('aria-pressed'),'true');
    assert.equal(await page.locator('[data-sq-navigation-blur]').inputValue(),'12');
    assert.equal(await page.locator('[data-sq-navigation-offset]').inputValue(),'18');
    const color=()=>header.evaluate(n=>{
      const c=document.createElement('canvas'); c.width=c.height=1;
      const ctx=c.getContext('2d');ctx.fillStyle=getComputedStyle(n).backgroundColor;ctx.fillRect(0,0,1,1);
      return [...ctx.getImageData(0,0,1,1).data];
    });
    const original=await color();
    await page.locator('[data-sq-navigation-sticky]').locator('..').click();
    await invoke('settle');
    assert.deepEqual(await color(),original,'Changing position preserves the authored surface color');
    assert.match(await header.evaluate(n=>getComputedStyle(n).backdropFilter),/blur\(12px\)/);
    await invoke('setDevice',{device:'mobile'}); await invoke('settle');
    assert.deepEqual(await color(),[92,34,51,255],'The native responsive color still applies');
    await invoke('setDevice',{device:'desktop'}); await invoke('settle');
    assert.deepEqual(await color(),original);
  } finally {await browser.close();await ws.stop();await rm(directory,{recursive:true,force:true});}
});
