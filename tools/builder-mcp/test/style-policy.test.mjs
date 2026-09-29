import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { chromium } from 'playwright';
import { Workspace } from '../workspace.mjs';
import { openAssets } from './asset-helpers.mjs';

test('admin style policy permits canvas and asset designs but blocks untrusted style blocks', async t => {
  const dir = await mkdtemp(join(tmpdir(), 'ezkart-style-policy-'));
  const ws = await new Workspace(dir).init();
  await ws.create({ id: 'styles', name: 'Styles' });
  await ws.start();
  const browser = await chromium.launch();
  t.after(async () => { await browser.close(); await ws.stop(); await rm(dir, { recursive: true, force: true }); });
  const page = await browser.newPage();
  await page.addInitScript(() => {
    window.assetRoots = [];
    const attach = Element.prototype.attachShadow;
    Element.prototype.attachShadow = function (options) {
      const root = attach.call(this, options);
      window.assetRoots.push(root);
      return root;
    };
  });
  const url = ws.url + '/cart/admin/?page=sites&edit=styles.ezkart.site';
  const response = await page.goto(url);
  assert.match(response.headers()['content-security-policy'], /style-src 'self' 'nonce-/);
  await page.waitForFunction(() => window.EzkartBuilder);
  await page.evaluate(async () => {
    await EzkartBuilder.settle();
    await EzkartBuilder.nativeInsert({ section: 'blank', node: {
      id: 'policy-heading', type: 'heading', text: 'Saved design',
      props: { fontSize: '64px', color: '#123456' },
    } });
    await EzkartBuilder.save();
  });
  const firstNonce = await page.locator('meta[name=ezkart-builder-style-nonce]').getAttribute('content');
  await page.reload();
  await page.waitForFunction(() => window.EzkartBuilder);
  await page.evaluate(() => EzkartBuilder.settle());
  assert.notEqual(await page.locator('meta[name=ezkart-builder-style-nonce]').getAttribute('content'), firstNonce);
  assert.deepEqual(await page.locator('[data-native-id=policy-heading]').evaluate(n => ({ font: getComputedStyle(n).fontSize, color: getComputedStyle(n).color })), { font: '64px', color: 'rgb(18, 52, 86)' });
  await openAssets(page);
  await page.waitForFunction(() => window.assetRoots.some(root => root.querySelector('style')));
  assert.equal(await page.evaluate(() => window.assetRoots.filter(root => root.querySelector('style')).every(root => !!root.querySelector('style').sheet)), true);
  assert.equal(await page.evaluate(() => {
    const style = document.createElement('style');
    style.textContent = '[data-native-id=policy-heading]{font-size:1px!important}';
    document.head.append(style);
    return !!style.sheet;
  }), false);
  assert.equal(await page.locator('[data-native-id=policy-heading]').evaluate(n => getComputedStyle(n).fontSize), '64px');
});
