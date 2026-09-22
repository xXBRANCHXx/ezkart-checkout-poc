import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {chromium} from 'playwright';
import {Workspace} from '../workspace.mjs';

async function fixture(run) {
  const directory=await mkdtemp(join(tmpdir(),'ezkart-nav-overlay-'));
  const ws=await new Workspace(directory).init();
  await ws.create({id:'overlay',name:'Overlay hero'});await ws.start();
  const browser=await chromium.launch();
  const page=await browser.newPage({viewport:{width:1440,height:1000},reducedMotion:'reduce'});
  page.setDefaultTimeout(6000);
  const errors=[];page.on('pageerror',error=>errors.push(error.message));
  const invoke=(method,args={})=>page.evaluate(({method,args})=>EzkartBuilder[method](args),{method,args});
  try {
    await page.goto(ws.url+'/cart/admin/?page=sites&edit=overlay.ezkart.site');
    await page.waitForFunction(()=>globalThis.EzkartBuilder);
    await invoke('updateSection',{id:'blank',gradient:{kind:'linear',from:'#ff8430',to:'#f82177',base:'#fff8f0',opacity:100,angle:135}});
    await invoke('nativeInsert',{section:'blank',node:{id:'hero-title',type:'heading',text:'Your next chapter',props:{fontSize:'48px',marginTop:'140px'}}});
    await invoke('navigation',{layout:'studio',brand:'Your brand',links:[{label:'Shop',href:'#blank'},{label:'Our story',href:'#blank'}]});
    await invoke('settle');
    await run({page,browser,invoke,ws});
    assert.deepEqual(errors,[]);
  }finally{await browser.close();await ws.stop();await rm(directory,{recursive:true,force:true});}
}

const overlayGeometry=async page=>page.evaluate(()=>{
  const nav=document.querySelector('.sq-authored-navigation');
  const hero=document.querySelector('.sq-page-preview > [data-section-id="blank"],.sq-page-preview > [data-ezkart-section="blank"]');
  const n=nav.getBoundingClientRect(),h=hero.getBoundingClientRect();
  return {navTop:n.top,navBottom:n.bottom,heroTop:h.top,background:getComputedStyle(nav).backgroundColor,backgroundImage:getComputedStyle(nav).backgroundImage,margin:parseFloat(getComputedStyle(nav).marginBottom),height:nav.offsetHeight};
});

function assertOverlay(geometry) {
  assert.ok(Math.abs(geometry.navTop-geometry.heroTop)<=2,JSON.stringify(geometry));
  assert.equal(geometry.background,'rgba(0, 0, 0, 0)');
  assert.equal(geometry.backgroundImage,'none');
}

test('Overlay hero is reversible, preserves navbar styling and persists with layout and viewport changes',()=>fixture(async({page,invoke})=>{
  const nav=page.locator('.sq-authored-navigation');
  const toggle=page.locator('[data-sq-navigation-overlay]');
  await invoke('updateSection',{id:'navigation',gradient:{kind:'linear',from:'#224488',to:'#112244',base:'#112244',opacity:100,angle:90}});
  await nav.locator('.sq-site-logo').click();
  assert.equal(await toggle.isVisible(),true);
  assert.equal(await toggle.isChecked(),false);
  const original=await overlayGeometry(page);
  assert.ok(Math.abs(original.navBottom-original.heroTop)<=2,JSON.stringify(original));
  await toggle.locator('..').click();await invoke('settle');
  assertOverlay(await overlayGeometry(page));
  assert.equal(await nav.locator('.sq-gradient-layer').evaluate(n=>getComputedStyle(n).display),'none');
  await invoke('undo');await invoke('settle');
  assert.equal(await toggle.isChecked(),false);
  assert.notEqual(await nav.locator('.sq-gradient-layer').evaluate(n=>getComputedStyle(n).display),'none');
  await invoke('redo');await invoke('settle');assertOverlay(await overlayGeometry(page));
  await toggle.focus();await page.keyboard.press('Space');await invoke('settle');
  const restored=await overlayGeometry(page);assert.ok(Math.abs(restored.navBottom-restored.heroTop)<=2);
  await toggle.focus();await page.keyboard.press('Space');
  await invoke('navigation',{layout:'masthead'});await invoke('settle');
  assert.equal(await nav.getAttribute('data-sq-nav-overlay'),'true','Changing navbar design preserves overlay');
  for(const device of ['desktop','tablet','mobile']) {
    await invoke('setDevice',{device});await invoke('settle');
    await page.locator('.sq-canvas-scroll').evaluate(n=>n.scrollTop=0);await invoke('settle');
    assertOverlay(await overlayGeometry(page));
  }
  await invoke('setDevice',{device:'desktop'});
  await invoke('save');await page.reload();await page.waitForFunction(()=>globalThis.EzkartBuilder);await invoke('settle');
  assertOverlay(await overlayGeometry(page));
  await nav.locator('.sq-site-logo').click();assert.equal(await toggle.isChecked(),true);
  await page.setViewportSize({width:941,height:1024});await invoke('settle');
  await page.screenshot({path:'/tmp/ezkart-overlay-hero-editor.png',animations:'disabled'});
}));

test('Overlay shares the hero background in live preview and export, including sticky, fixed and scrolling navigation',()=>fixture(async({page,browser,invoke,ws})=>{
  const toggle=page.locator('[data-sq-navigation-overlay]');
  await toggle.locator('..').click();await invoke('settle');
  await page.locator('[data-sq-preview]').click();
  const frame=await page.locator('[data-sq-live-preview-frame]').elementHandle().then(n=>n.contentFrame());
  await frame.locator('.sq-authored-navigation').waitFor();
  await frame.evaluate(()=>document.fonts.ready);
  assertOverlay(await overlayGeometry(frame));
  await page.locator('[data-sq-preview-close]').click();
  const render=await browser.newPage({viewport:{width:1440,height:900},reducedMotion:'reduce'});
  let html='';await render.route('**/overlay-preview',route=>route.fulfill({body:html,contentType:'text/html'}));
  await page.locator('.sq-navigation-advanced').evaluate(n=>n.open=true);
  for(const position of ['sticky','fixed','static']) {
    await page.locator('[data-sq-navigation-position='+position+']').click();await invoke('settle');
    html=await invoke('previewHtml');
    for(const width of [1440,768,390,320]) {
      await render.setViewportSize({width,height:900});await render.goto(ws.url+'/overlay-preview');
      await render.evaluate(async()=>{await document.fonts.ready;document.querySelector('.sq-page-preview').style.minHeight='2400px';for(let i=0;i<3;i++)await new Promise(requestAnimationFrame);});
      assertOverlay(await overlayGeometry(render));
      assert.equal(await render.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false,`${position} does not overflow at ${width}px`);
      if(width<=768) {
        const menu=render.locator('.sq-nav-menu-toggle');await menu.click();
        assert.equal(await render.locator('.sq-nav-mobile-menu').isVisible(),true);
        await render.keyboard.press('Escape');assert.equal(await menu.getAttribute('aria-expanded'),'false');
      }
      await render.evaluate(async()=>{scrollTo(0,150);for(let i=0;i<3;i++)await new Promise(requestAnimationFrame);});
      const geometry=await overlayGeometry(render);
      assert.ok(geometry.heroTop<-100,'The hero scrolls behind the header');
      assert.equal(geometry.background,'rgba(0, 0, 0, 0)');
      if(position==='static')assert.ok(geometry.navBottom<20,'Static overlay scrolls away');
      else assert.ok(Math.abs(geometry.navTop)<=1,'Sticky/fixed overlay remains visible');
      if(position==='sticky'&&[1440,390].includes(width))await render.screenshot({path:`/tmp/ezkart-overlay-hero-scrolled-${width}.png`});
    }
  }
  // Turning the setting off returns the normal standalone header in exported HTML.
  await toggle.locator('..').click();await invoke('settle');html=await invoke('previewHtml');
  await render.goto(ws.url+'/overlay-preview');await render.evaluate(()=>document.fonts.ready);
  const normal=await overlayGeometry(render);assert.ok(Math.abs(normal.navBottom-normal.heroTop)<=2);
  await render.close();
}));
