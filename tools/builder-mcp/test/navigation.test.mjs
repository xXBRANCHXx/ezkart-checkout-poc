import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { chromium } from 'playwright';
import { Workspace } from '../workspace.mjs';

async function fixture(run) {
  const dir = await mkdtemp(join(tmpdir(), 'ezkart-navigation-'));
  const ws = await new Workspace(dir).init();
  await ws.create({ id: 'navigation', name: 'Navigation review' });
  await ws.start();
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1894, height: 1024 }, reducedMotion: 'reduce' });
  page.setDefaultTimeout(5000);
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  const invoke = (method, args = {}) => page.evaluate(({ method, args }) => EzkartBuilder[method](args), { method, args });
  try {
    await page.goto(ws.url + '/cart/admin/?page=sites&edit=navigation.ezkart.site');
    await page.waitForFunction(() => globalThis.EzkartBuilder);
    await run({ page, invoke, ws, browser });
    assert.deepEqual(errors, []);
  } finally {
    await browser.close();
    await ws.stop();
    await rm(dir, { recursive: true, force: true });
  }
}

const addFromLibrary = async (page, layout) => {
  await page.locator('[data-sq-tab=add]').click();
  await page.locator('[data-sq-library-category=sections]').click();
  await page.locator('[data-sq-open-library=navigation]').click();
  await page.locator(`[data-sq-add-navigation-template=${layout}]`).click();
};

test('navigation sticky switch is visible for the section and logo, with history, layout replacement and persistence', () => fixture(async ({ page, invoke }) => {
  await addFromLibrary(page, 'split');
  const header = page.locator('.sq-authored-navigation');
  const sticky = page.locator('[data-sq-navigation-sticky]');
  assert.equal(await header.getAttribute('data-sq-nav-position'), 'sticky');
  await page.locator('[data-sq-select-section]').click();
  assert.equal(await sticky.isVisible(), true);
  assert.equal(await sticky.isChecked(), true);
  // The visual switch is the merchant's pointer target; the input stays keyboard accessible.
  await sticky.locator('..').click();
  assert.equal(await header.getAttribute('data-sq-nav-position'), 'static');
  await invoke('undo');
  assert.equal(await header.getAttribute('data-sq-nav-position'), 'sticky');
  await invoke('redo');
  assert.equal(await header.getAttribute('data-sq-nav-position'), 'static');
  await addFromLibrary(page, 'shop');
  assert.equal(await header.getAttribute('data-sq-nav-position'), 'static', 'Changing layout preserves an explicit opt out');
  await header.locator('.sq-site-logo').click();
  assert.equal(await sticky.isVisible(), true);
  await sticky.focus();
  await page.keyboard.press('Space');
  assert.equal(await header.getAttribute('data-sq-nav-position'), 'sticky');
  await page.screenshot({ path: '/tmp/ezkart-navigation-editor.png' });
  await sticky.focus();
  await page.keyboard.press('Space');
  await invoke('save');
  await page.reload();
  await page.waitForFunction(() => globalThis.EzkartBuilder);
  assert.equal(await header.getAttribute('data-sq-nav-position'), 'static');
  const html = await invoke('previewHtml');
  await page.route('**/nav-static', route => route.fulfill({ body: html, contentType: 'text/html' }));
  await page.goto('http://localhost/nav-static');
  await page.evaluate(() => { document.querySelector('.sq-page-preview').style.minHeight = '2200px'; scrollTo(0, 450); });
  assert.ok((await header.boundingBox()).y < -100, 'Opted-out header scrolls with the page');
}));

test('all five navigation layouts fit, stay pinned and expose working menus in canvas and storefront', () => fixture(async ({ page, invoke, ws, browser }) => {
  const out = '/tmp/ezkart-navigation-review';
  await mkdir(out, { recursive: true });
  const render = await browser.newPage({ viewport: { width: 1440, height: 900 }, reducedMotion: 'reduce' });
  let html = '';
  await render.route('**/nav-preview', route => route.fulfill({ body: html, contentType: 'text/html' }));
  await invoke('updateSection', { id: 'blank', background: '#e9eee9' });
  await invoke('nativeInsert', { section: 'blank', node: { id: 'page-title', type: 'heading', text: 'A page worth exploring', props: { fontSize: '56px', marginTop: '160px' } } });
  const links = [{ label: 'Shop', href: '#blank' }, { label: 'Our story', href: '#blank' }, { label: 'Contact', href: '#blank' }];
  for (const layout of ['studio', 'masthead', 'split', 'shop', 'compact']) {
    await invoke('setDevice', { device: 'desktop' });
    await invoke('navigation', { layout, brand: 'Your brand', links, actionLabel: 'Shop now', actionTarget: 'blank' });
    assert.equal(await page.locator('.sq-authored-navigation').getAttribute('data-sq-nav-position'), 'sticky');
    await invoke('setDevice', { device: 'tablet' });
    await invoke('settle');
    const toggle = page.locator('.sq-authored-navigation .sq-nav-menu-toggle');
    await toggle.click();
    assert.deepEqual(await page.locator('.sq-nav-mobile-menu>a').allTextContents(), links.map(link => link.label));
    await page.keyboard.press('Escape');
    assert.equal(await toggle.getAttribute('aria-expanded'), 'false');
    await invoke('setDevice', { device: 'desktop' });
    html = await invoke('previewHtml');
    await render.goto(ws.url + '/nav-preview');
    await render.evaluate(() => document.fonts.ready);
    for (const width of [320, 390, 768, 900, 1024, 1440, 1920]) {
      await render.setViewportSize({ width, height: 900 });
      await render.evaluate(async () => { document.querySelector('.sq-page-preview').style.minHeight = '2200px'; scrollTo(0, 450); for (let i = 0; i < 3; i++) await new Promise(requestAnimationFrame); });
      const bounds = await render.locator('.sq-authored-navigation').evaluate(nav => {
        const r = nav.getBoundingClientRect();
        const children = [...nav.querySelectorAll(':scope>.sq-site-logo,:scope>.sq-template-navigation>*')].filter(n => n.getClientRects().length);
        return { top: r.top, overflow: document.documentElement.scrollWidth > innerWidth, escaped: children.filter(n => { const c = n.getBoundingClientRect(); return c.left < r.left - 1 || c.right > r.right + 1 || c.bottom > r.bottom + 1; }).map(n => n.outerHTML), logoWidth: nav.querySelector('.sq-site-logo').clientWidth };
      });
      assert.ok(Math.abs(bounds.top) <= 1, `${layout} is pinned at ${width}`);
      assert.equal(bounds.overflow, false, `${layout} doesn't overflow at ${width}`);
      assert.deepEqual(bounds.escaped, [], `${layout} keeps controls inside at ${width}`);
      assert.ok(bounds.logoWidth >= 60, `${layout} leaves space for the brand at ${width}`);
      if (width <= 900) {
        const toggle = render.locator('.sq-nav-menu-toggle');
        await toggle.click();
        assert.equal(await toggle.getAttribute('aria-expanded'), 'true');
        assert.equal(await render.locator('.sq-nav-mobile-menu>a').count(), 3);
        if (width === 390) await render.screenshot({ path: join(out, `${layout}-mobile.png`) });
        await render.keyboard.press('Escape');
        assert.equal(await render.locator('.sq-nav-mobile-menu').isVisible(), false);
        assert.equal(await toggle.evaluate(n => n === document.activeElement), true);
        await toggle.click();
        await render.locator('.sq-nav-mobile-menu>a').first().click();
        assert.equal(await render.locator('.sq-nav-mobile-menu').isVisible(), false);
      }
      if (width === 1440) await render.screenshot({ path: join(out, `${layout}-desktop.png`) });
    }
  }
  // Longer translated links trigger the same usable menu before they overlap.
  await invoke('navigation', { layout: 'split', brand: 'A longer merchant brand', links: Array.from({length:6}, (_, i) => ({ label: `Explore collection number ${i + 1}`, href: '#blank' })) });
  html = await invoke('previewHtml');
  await render.setViewportSize({ width: 1024, height: 900 });
  await render.goto(ws.url + '/nav-preview');
  await render.evaluate(() => document.fonts.ready);
  assert.equal(await render.locator('.sq-nav-menu-toggle').isVisible(), true);
  await render.locator('.sq-nav-menu-toggle').click();
  assert.equal(await render.locator('.sq-nav-mobile-menu>a').count(), 6);
}));
