import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { chromium } from 'playwright';
import { Workspace } from '../workspace.mjs';

async function fixture(run) {
  const dir = await mkdtemp(join(tmpdir(), 'ezkart-product-defaults-'));
  const ws = await new Workspace(dir).init();
  await writeFile(join(dir, 'catalog.json'), JSON.stringify({products: [
    { id: 'syrup', name: 'ZERO Syrup 50–550 ml — Better than ordinary syrup', type: 'physical', price: 42000, stock: 10,
      options: [{name:'Flavor',values:['Plain']},{name:'Size',values:['250ml']}],
      variants: [{id:'plain',price:42000,stock:10,options:[{option:'Flavor',value:'Plain'},{option:'Size',value:'250ml'}]}] },
    { id: 'coffee', name: 'Coffee beans', type: 'physical', price: 95000, stock: 10 },
  ]}));
  await ws.create({id:'unrelated-name',name:'An arbitrary page name'});
  await ws.start();
  const browser = await chromium.launch();
  const page = await browser.newPage({viewport:{width:1894,height:1200},reducedMotion:'reduce'});
  page.setDefaultTimeout(5000);
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  browser.on('page', opened => opened.on('pageerror', error => errors.push(error.message)));
  const invoke = (method,args={}) => page.evaluate(({method,args}) => EzkartBuilder[method](args), {method,args});
  try {
    await page.goto(ws.url+'/cart/admin/?page=sites&edit=unrelated-name.ezkart.site');
    await page.waitForFunction(() => globalThis.EzkartBuilder);
    await run({page,invoke,browser,ws});
    assert.deepEqual(errors, []);
  } finally {
    await browser.close(); await ws.stop(); await rm(dir,{recursive:true,force:true});
  }
}
const sizes = page => page.locator('.sq-page-preview [data-native-type=product]').evaluateAll(nodes => nodes.map(node => ({
  width:node.offsetWidth,height:node.offsetHeight,cardHeight:node.querySelector('article').offsetHeight,
  clipped:node.querySelector('footer').getBoundingClientRect().bottom>node.getBoundingClientRect().bottom+1,
})));
const equalSizes = async page => {
  const [a,b] = await sizes(page);
  assert.ok(Math.abs(a.width-b.width)<=1, 'Default card widths match');
  assert.ok(Math.abs(a.height-b.height)<=1, 'Default card heights match despite different titles and options');
  assert.equal(a.clipped||b.clipped,false);
};
async function addProducts(page,invoke) {
  await page.locator('[data-sq-tab=products]').click();
  await page.locator('[data-sq-place-product=syrup]').click();
  await page.locator('[data-sq-place-product=coffee]').click();
  await invoke('nativeUpdate',{id:'blank',props:{display:'flex',flexDirection:'row',flexWrap:'wrap',alignItems:'flex-start',gap:'40px'}});
  await invoke('settle');
}

test('catalog cards start at one size, allow independent pointer resizing, and retain it through history and reopening', () => fixture(async ({page,invoke,browser,ws}) => {
  await addProducts(page,invoke);
  await equalSizes(page);
  const html = await invoke('exportHtml');
  const render = await browser.newPage({viewport:{width:1440,height:1100},reducedMotion:'reduce'});
  await render.route('**/product-defaults',route=>route.fulfill({body:html,contentType:'text/html'}));
  await render.goto(ws.url+'/product-defaults');
  await render.evaluate(()=>document.fonts.ready);
  for (const width of [1440,768,390,320]) {
    await render.setViewportSize({width,height:1100});
    await render.evaluate(async()=>{for(let i=0;i<3;i++)await new Promise(requestAnimationFrame)});
    await equalSizes(render);
    assert.equal(await render.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
    if(width===1440)await render.screenshot({path:'/tmp/ezkart-products-default-desktop.png'});
    if(width===390)await render.screenshot({path:'/tmp/ezkart-products-default-mobile.png',fullPage:true});
  }
  const cards = page.locator('[data-native-type=product]');
  await cards.last().locator('h3').click(); await invoke('settle');
  const before = await sizes(page);
  const handle = page.locator('[data-sq-element-resize]');
  await handle.scrollIntoViewIfNeeded(); await invoke('settle');
  await handle.hover();
  const box = await handle.boundingBox();
  await page.mouse.move(box.x+box.width/2,box.y+box.height/2);
  await page.mouse.down();
  await page.mouse.move(box.x+box.width/2+65,box.y+box.height/2+35,{steps:8});
  await page.mouse.up();
  await invoke('settle');
  const after = await sizes(page);
  assert.equal(after[0].width,before[0].width);
  assert.equal(after[0].height,before[0].height);
  assert.ok(after[1].width>before[1].width+30,'The selected card can be resized');
  assert.ok(after[1].height>before[1].height+15,'The selected card can be made taller');
  assert.ok(Math.abs(after[1].cardHeight-after[1].height)<=1,'The visible card fills its resized height');
  await invoke('undo'); await invoke('settle'); await equalSizes(page);
  await invoke('redo'); await invoke('settle');
  await invoke('save'); await page.reload(); await page.waitForFunction(()=>globalThis.EzkartBuilder); await invoke('settle');
  assert.deepEqual((await sizes(page))[1],after[1],'Custom sizes persist');
  assert.equal((await sizes(page))[0].width,before[0].width);
  await page.screenshot({path:'/tmp/ezkart-products-resized-editor.png'});
}));

test('Shop now finds product elements on arbitrary pages in Preview and export, including saved default links', () => fixture(async ({page,invoke,browser,ws}) => {
  await page.locator('[data-sq-tab=add]').click();
  await page.locator('[data-sq-library-category=sections]').click();
  await page.locator('[data-sq-open-library=navigation]').click();
  await page.locator('[data-sq-add-navigation-template=studio]').click();
  // Selecting the existing empty section leaves its unrelated generated ID intact.
  await invoke('updateSection',{id:'blank',name:'Whatever this section is called'});
  await addProducts(page,invoke);
  await invoke('nativeUpdate',{id:'blank',props:{paddingTop:'1100px',paddingBottom:'1000px'},responsive:[]});
  const checkScroll = async frame => {
    await frame.getByRole('button',{name:'Shop now',exact:true}).click();
    await frame.waitForFunction(()=>scrollY>500,{},{timeout:5000});
    const geometry = await frame.evaluate(()=>{
      const product=document.querySelector('[data-native-type=product]:not([hidden])').getBoundingClientRect();
      const header=document.querySelector('.sq-authored-navigation').getBoundingClientRect();
      return {top:product.top,headerBottom:header.bottom,cartOpen:document.querySelector('.ezkart-cart')?.classList.contains('open')||false};
    });
    assert.ok(geometry.top>=geometry.headerBottom-1 && geometry.top<=geometry.headerBottom+24,JSON.stringify(geometry));
    assert.equal(geometry.cartOpen,false);
  };
  const response = page.waitForResponse(r=>new URL(r.url()).pathname==='/cart/admin/page-preview.php');
  await page.locator('[data-sq-preview]').click(); assert.equal((await response).status(),200);
  const frame = await page.locator('[data-sq-live-preview-frame]').elementHandle().then(el=>el.contentFrame());
  await checkScroll(frame);
  await page.locator('[data-sq-preview-close]').click();
  await invoke('save'); await page.reload(); await page.waitForFunction(()=>globalThis.EzkartBuilder);
  // Simulate the previously saved default button, which used a literal #products.
  await page.locator('.sq-authored-navigation [data-sq-link-type=products]').evaluateAll(nodes=>nodes.forEach(n=>{n.dataset.sqLinkType='section';n.dataset.sqLink='products'}));
  const html=await invoke('exportHtml');
  const render=await browser.newPage({viewport:{width:1440,height:1000},reducedMotion:'reduce'});
  await render.route('**/product-scroll',route=>route.fulfill({body:html,contentType:'text/html'}));
  for(const width of [1440,390]) {
    await render.setViewportSize({width,height:1000});
    await render.goto(ws.url+'/product-scroll');await render.evaluate(()=>document.fonts.ready);
    await checkScroll(render);
    // Hidden products are skipped, and mobile menu links use the same destination.
    await render.evaluate(()=>{document.querySelector('[data-native-type=product]').hidden=true;scrollTo(0,0)});
    if(width===390){await render.locator('.sq-nav-menu-toggle').click();await render.locator('.sq-nav-mobile-menu').getByRole('link',{name:'Shop',exact:true}).click();}
    else await render.locator('.sq-template-navigation').getByRole('link',{name:'Shop',exact:true}).click();
    await render.waitForFunction(()=>scrollY>500);
    assert.equal(await render.evaluate(()=>document.activeElement===document.querySelectorAll('[data-native-type=product]')[1]),true);
  }
}));
