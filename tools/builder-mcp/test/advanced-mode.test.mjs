import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { chromium } from 'playwright';
import { repoRoot } from '../workspace.mjs';

test('Advanced shows required deletions, blocks unsafe switches, and rechecks before enabling Basic', async t => {
  const browser = await chromium.launch();
  t.after(() => browser.close());
  const page = await browser.newPage({viewport:{width:1400,height:1200}});
  page.setDefaultTimeout(6000);
  const errors = [], writes = [];
  page.on('pageerror', error => errors.push(error.message));
  const partial = (await readFile(join(repoRoot,'cart/admin/advanced.php'),'utf8')).replace(/<\?[\s\S]*?\?>/g,'');
  const files = Object.fromEntries(await Promise.all(['admin.css','admin-ui.css','advanced.css','advanced.js'].map(async name => [name,await readFile(join(repoRoot,'cart/admin',name),'utf8')])));
  let enabled = true, canEdit = true, failLoad = false, failSave = false, rejectStale = false, omitUsage = false;
  let usage = {landingPages:9,products:12};
  function currentPlan() {
    const excess = {landingPages:Math.max(0,usage.landingPages-6),products:Math.max(0,usage.products-10)};
    return {enabled,canEdit,limits:enabled?{landingPages:24,products:50}:{landingPages:6,products:10},commissionPercent:enabled?6:5,
      ...(!omitUsage ? {downgrade:{allowed:!excess.landingPages&&!excess.products,limits:{landingPages:6,products:10},usage,excess}} : {})};
  }
  await page.route('**/*', async route => {
    const request = route.request(), url = new URL(request.url());
    if (url.searchParams.has('cloud')) {
      assert.equal(url.searchParams.get('cloud'),'/v1/advanced-mode');
      if (request.method() === 'PUT') {
        assert.equal(request.headers()['x-ezkart-csrf'],'fixture-csrf');
        const body = request.postDataJSON();
        writes.push(body);
        if (failSave) return route.fulfill({status:503,json:{ok:false,error:'Your plan could not be saved. Try again.'}});
        if (rejectStale) {
          usage = {landingPages:7,products:11};
          return route.fulfill({status:409,json:{ok:false,code:'basic_limits_exceeded',error:'Delete 1 landing page and 1 product before switching to Basic. Advanced Mode is still on. Nothing has been deleted.',plan:currentPlan()}});
        }
        assert.ok(body.enabled || currentPlan().downgrade.allowed,'The UI never knowingly submits an over-limit downgrade');
        enabled = body.enabled;
      }
      if (failLoad) return route.fulfill({status:503,json:{ok:false,error:'Store usage is unavailable. Try again.'}});
      return route.fulfill({json:{ok:true,plan:currentPlan()}});
    }
    const name = url.pathname.split('/').at(-1);
    if (files[name]) return route.fulfill({contentType:name.endsWith('.css')?'text/css; charset=utf-8':'text/javascript; charset=utf-8',body:files[name]});
    return route.fulfill({contentType:'text/html',body:`<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="admin.css"><link rel="stylesheet" href="admin-ui.css"><link rel="stylesheet" href="advanced.css"></head><body class="dashboard-page page-advanced" data-admin-advanced-mode="${enabled}" data-admin-cloud-enabled="true" data-admin-csrf-token="fixture-csrf"><main style="max-width:1180px;margin:24px auto;padding:20px"><h1>Advanced Mode</h1>${partial}<a href="?page=advanced" data-advanced-promo>Advanced</a></main><script src="advanced.js"></script></body></html>`});
  });
  const idle = () => page.waitForFunction(() => document.querySelector('[data-advanced-page]').getAttribute('aria-busy') === 'false');
  const refresh = async () => {
    await page.locator('[data-advanced-recheck]').click();
    await idle();
  };
  const toggle = page.locator('[data-advanced-toggle]');
  const panel = page.locator('[data-advanced-downgrade]');
  const status = page.locator('[data-advanced-status]');
  await page.goto('http://advanced.test/cart/admin/?page=advanced');
  await idle();
  assert.equal(await toggle.isChecked(),true);
  assert.equal(await toggle.isDisabled(),true);
  assert.match(await panel.innerText(),/Delete 3 landing pages to fit/);
  assert.match(await panel.innerText(),/Delete 2 products to fit/);
  assert.match(await status.innerText(),/Switching to Basic is blocked/);
  assert.equal(await panel.getByRole('link',{name:'Manage landing pages'}).getAttribute('href'),'?page=sites');
  assert.equal(await panel.getByRole('link',{name:'Manage products'}).getAttribute('href'),'?page=products');
  assert.equal(writes.length,0,'Loading and blocked controls never change the plan or delete content');
  for (const width of [1400,390]) {
    await page.setViewportSize({width,height:1200});
    const bounds = await panel.boundingBox();
    assert.ok(bounds.x>=0 && bounds.x+bounds.width<=width,`Usage fits the ${width}px screen`);
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),true);
    await page.screenshot({path:`/tmp/ezkart-advanced-limits-${width}.png`,fullPage:true});
  }
  // Fixing only one capacity leaves the other blocker visible.
  usage = {landingPages:6,products:11};
  await refresh();
  assert.equal(await toggle.isDisabled(),true);
  assert.match(await panel.innerText(),/Delete 1 product to fit/);
  assert.doesNotMatch(await panel.innerText(),/Delete \d+ landing/);
  usage = {landingPages:7,products:10};
  await refresh();
  assert.equal(await toggle.isDisabled(),true);
  assert.match(await panel.innerText(),/Delete 1 landing page to fit/);
  assert.doesNotMatch(await panel.innerText(),/Delete \d+ product/);
  usage = {landingPages:6,products:10};
  await refresh();
  assert.equal(await toggle.isDisabled(),false);
  assert.match(await panel.innerText(),/Ready for Basic/);
  // A newer server count overrides a previously eligible screen.
  rejectStale = true;
  await toggle.focus();
  await page.keyboard.press('Space');
  await idle();
  assert.equal(await toggle.isChecked(),true);
  assert.equal(await toggle.isDisabled(),true);
  assert.match(await panel.innerText(),/Delete 1 landing page to fit/);
  assert.match(await panel.innerText(),/Delete 1 product to fit/);
  assert.match(await status.innerText(),/Nothing has been deleted/);
  assert.equal(enabled,true);
  rejectStale = false;
  // Failed verification must not leave the switch enabled using stale counts.
  failLoad = true;
  await refresh();
  assert.equal(await toggle.isChecked(),true);
  assert.equal(await toggle.isDisabled(),true);
  assert.equal(await panel.isVisible(),false);
  failLoad = false;
  usage = {landingPages:6,products:10};
  await page.locator('[data-advanced-retry]').click();
  await idle();
  await toggle.click();
  await idle();
  assert.equal(enabled,false);
  assert.equal(await toggle.isChecked(),false);
  assert.equal(await panel.isVisible(),false);
  assert.match(await status.innerText(),/Your store is on Basic/);
  assert.equal(await page.locator('body').getAttribute('data-admin-landing-limit'),'6');
  assert.equal(await page.locator('[data-advanced-promo]').isVisible(),true);
  await page.reload();
  await idle();
  assert.equal(await toggle.isChecked(),false);
  await toggle.click();
  await idle();
  assert.deepEqual(writes.at(-1),{enabled:true,commissionPercent:6});
  assert.equal(await toggle.isChecked(),true);
  assert.equal(await page.locator('body').getAttribute('data-admin-landing-limit'),'24');
  failSave = true;
  await toggle.click();
  await idle();
  assert.equal(await toggle.isChecked(),true);
  assert.equal(await toggle.isDisabled(),true);
  assert.match(await status.innerText(),/could not be saved/);
  failSave = false;
  await page.locator('[data-advanced-retry]').click();
  await idle();
  // Nonowners can see counts, but cannot change either plan.
  canEdit = false;
  await refresh();
  assert.equal(await toggle.isDisabled(),true);
  assert.match(await status.innerText(),/Only the store owner/);
  canEdit = true;
  omitUsage = true;
  await refresh();
  assert.equal(await toggle.isDisabled(),true);
  assert.match(await status.innerText(),/limits could not be checked/);
  assert.deepEqual(errors,[]);
});
