import assert from 'node:assert/strict';
import {test} from 'node:test';
import {mkdir, writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {chromium} from '../builder-mcp/node_modules/playwright/index.mjs';
import {setup} from './fixture.mjs';

test('product variant columns stay contained and batch edits, preview modes and drafts survive narrow layouts', async t => {
  const app = await setup({EZKART_CLOUDFLARE_API_URL:'https://ezkart-api-test.fixture.workers.dev'});
  t.after(() => app.close());
  const fixture = {store:{sellerId:'seller_fixture'}, products:[], selections:[], catalog:[], drafts:[]};
  const persist = () => writeFile(join(app.directory,'storefront.json'), JSON.stringify(fixture));
  await persist();
  const browser = await chromium.launch();
  t.after(() => browser.close());
  const context = await browser.newContext({viewport:{width:941,height:904}});
  await context.addCookies([app.adminCookie()]);
  const productWrites = [], errors = [];
  await context.route('**/*', async route => {
    const url = new URL(route.request().url()), cloud = url.searchParams.get('cloud');
    // These checks use fixture data exclusively, including draft persistence.
    if (url.hostname !== '127.0.0.1') return route.abort();
    if (cloud === '/v1/admin-profile') return route.fulfill({json:{ok:true,profile:{logoId:'',canEdit:true}}});
    if (cloud === '/v1/catalog') return route.fulfill({json:{ok:true,products:[],drafts:fixture.drafts}});
    if (cloud?.startsWith('/v1/drafts/')) {
      const id = cloud.split('/').at(-1), payload = route.request().postDataJSON();
      fixture.drafts = [...fixture.drafts.filter(draft => draft.id !== id), {...payload.snapshot,id}];
      await persist();
      return route.fulfill({json:{ok:true,draft:{id}}});
    }
    if (cloud?.startsWith('/v1/products')) { productWrites.push(cloud); return route.abort(); }
    if (cloud) return route.fulfill({json:{ok:true,items:[],notifications:[],unreadCount:0}});
    return route.continue();
  });
  const page = await context.newPage();
  page.on('pageerror', error => errors.push(error.message));
  page.setDefaultTimeout(7000);
  await page.goto(app.base+'/cart/admin/?page=product-new');
  await page.locator('.product-variant-switch').click();
  await page.locator('[data-generate-variants]').click();
  await page.locator('.product-variant-row').nth(3).waitFor();
  const rows = page.locator('.product-variant-row');
  const fields = selector => rows.locator(selector).evaluateAll(inputs => inputs.map(input => input.value));
  await page.locator('[data-variant-filter-chips] button[data-option-value="Peach"]').click();
  await page.locator('[data-batch-price]').fill('81000');
  await page.locator('[data-batch-stock]').fill('12');
  await page.locator('[data-apply-variant-batch]').click();
  assert.deepEqual(await fields('[data-variant-price]'), ['81000','81000','75000','75000']);
  await page.locator('[data-clear-variant-selection]').click();
  await page.locator('[data-variant-filter-chips] button[data-option-value="250 ml"]').click();
  await page.locator('[data-batch-price]').fill('');
  await page.locator('[data-batch-stock]').fill('');
  await page.locator('[data-batch-weight]').fill('725');
  await page.locator('[data-apply-variant-batch]').click();
  assert.deepEqual(await fields('[data-variant-weight]'), ['500','725','500','725']);
  await page.locator('[data-clear-variant-selection]').click();
  await page.locator('[data-select-all-variants]').check();
  assert.match(await page.locator('[data-variant-selected-count]').textContent(), /4 selected/);
  await page.locator('[data-clear-variant-selection]').click();
  await page.locator('[data-variant-group-select]').first().check();
  assert.match(await page.locator('[data-variant-selected-count]').textContent(), /2 selected/);
  await page.locator('[data-clear-variant-selection]').click();

  const screenDir = process.env.EZKART_LAYOUT_SCREENSHOTS;
  if (screenDir) await mkdir(screenDir,{recursive:true});
  for (const width of [941,390,680,900,1180,1181,1440,1920]) {
    await page.setViewportSize({width,height:904});
    const geometry = await page.evaluate(() => {
      const box = selector => {const el=document.querySelector(selector) || document.querySelector('.product-variant-table');const r=el.getBoundingClientRect();return {left:r.left,right:r.right,top:r.top,bottom:r.bottom};};
      const scroll = document.querySelector('.product-variant-scroll') || document.querySelector('.product-variant-table');
      const batch = document.querySelector('.product-variant-batch');
      return {width:innerWidth,document:document.documentElement.scrollWidth,main:box('.product-editor-main'),preview:box('.product-preview-sidebar'),table:box('.product-variant-table'),scroll:box('.product-variant-scroll'),batch:box('.product-variant-batch'),scrollWidth:scroll.scrollWidth,clientWidth:scroll.clientWidth,batchOverflow:batch.scrollWidth > batch.clientWidth+1};
    });
    if (screenDir && width===941) {
      await page.locator('.product-variant-batch').scrollIntoViewIfNeeded();
      await page.screenshot({path:join(screenDir,'first-check-941.png')});
    }
    assert.ok(geometry.document <= width, `${width}: page overflow ${JSON.stringify(geometry)}`);
    assert.ok(geometry.scroll.right <= geometry.table.right+1, `${width}: scroller contained`);
    assert.equal(geometry.batchOverflow,false,`${width}: batch controls wrap`);
    if (width<=1180) assert.ok(geometry.preview.top>=geometry.main.bottom,`${width}: preview below form`);
    else assert.ok(geometry.preview.left>=geometry.main.right,`${width}: preview beside form`);
    if (width===390 || width===1440) assert.ok(geometry.scrollWidth>geometry.clientWidth,`${width}: overflowing columns scroll`);
    await page.locator('[data-variant-sku]').last().fill('ORIGINAL-LARGE');
    // Playwright brings far-right controls into view through the local scroller.
    await page.locator('[data-variant-visibility]').last().click();
    assert.equal(await rows.last().getAttribute('class'), 'product-variant-row is-hidden');
    await page.locator('[data-variant-visibility]').last().click();
    await page.locator('[data-product-preview-device="mobile"]').click();
    assert.match(await page.locator('[data-product-preview-viewport]').getAttribute('class'), /preview-mobile/);
    await page.locator('[data-product-live-variant] button[data-live-option-value="Original"]').click();
    await page.locator('[data-product-preview-device="desktop"]').click();
    assert.match(await page.locator('[data-product-preview-viewport]').getAttribute('class'), /preview-desktop/);
    await page.locator('.product-variant-scroll').evaluate(el => {el.scrollLeft=0;});
    if (screenDir && [941,390,1440,1920].includes(width)) {
      await page.locator('.product-variant-batch').scrollIntoViewIfNeeded();
      await page.screenshot({path:join(screenDir,'variants-'+width+'.png')});
      await page.locator('.product-preview-sidebar').scrollIntoViewIfNeeded();
      await page.screenshot({path:join(screenDir,'preview-'+width+'.png')});
    }
  }
  await page.locator('[data-product-preview-device="mobile"]').click();
  await page.locator('[data-save-product-draft]').click();
  await page.waitForFunction(() => document.querySelector('[data-product-draft-status]').textContent.includes('Saved'));
  const draft = fixture.drafts.at(-1);
  assert.equal(draft.previewDevice,'mobile');
  assert.equal(draft.variants.at(-1).sku,'ORIGINAL-LARGE');
  await page.reload();
  await page.locator('.product-variant-row').nth(3).waitFor();
  assert.deepEqual(await fields('[data-variant-price]'), ['81000','81000','75000','75000']);
  assert.deepEqual(await fields('[data-variant-weight]'), ['500','725','500','725']);
  assert.match(await page.locator('[data-product-preview-viewport]').getAttribute('class'), /preview-mobile/);
  // A separate editor tab also restores the same saved draft.
  const second = await context.newPage();
  await second.goto(page.url());
  await second.locator('.product-variant-row').nth(3).waitFor();
  assert.equal(await second.locator('[data-variant-sku]').last().inputValue(),'ORIGINAL-LARGE');
  assert.equal(await second.locator('[data-variant-price]').first().inputValue(),'81000');
  // Alternative product types retain their own columns and remain contained.
  for (const type of ['digital','subscription','physical']) {
    await page.setViewportSize({width:390,height:904});
    await page.locator('[data-product-type-trigger]').click();
    await page.locator(`[data-product-type-option="${type}"]`).click();
    await page.locator('[data-variant-sku]').last().fill(type+'-large');
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth<=innerWidth),true,type);
    if (type==='subscription') {
      await page.locator('[data-variant-billing-interval]').last().fill('3');
      assert.equal(await page.locator('[data-variant-billing-interval]').last().inputValue(),'3');
    }
    await page.locator('.product-variant-scroll').evaluate(el => {el.scrollLeft=0;});
    await page.locator('.product-variant-scroll').focus();
    await page.keyboard.press('ArrowRight');
    await page.waitForFunction(() => document.querySelector('.product-variant-scroll').scrollLeft>0);
    // Photo-source controls also remain reachable inside the scrolling region.
    await page.locator('.product-variant-main-picker summary').last().click();
    assert.equal(await page.locator('.product-variant-main-picker[open]').count(),1);
    await page.locator('.product-variant-main-picker summary').last().click();
  }
  assert.deepEqual(productWrites,[]);
  assert.deepEqual(errors,[]);
});
