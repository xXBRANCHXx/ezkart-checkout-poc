import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { chromium } from 'playwright';
import { Workspace, repoRoot } from '../workspace.mjs';

test('dropdown fallback preserves keyboard selection, form values, validation, and dynamic options', async t => {
  const browser = await chromium.launch();
  t.after(() => browser.close());
  const page = await browser.newPage({ viewport: { width: 390, height: 700 }, hasTouch: true });
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.setContent(`<style>${await readFile(join(repoRoot, 'cart/select.css'), 'utf8')}</style>
    <style>body { font: 14px Arial; padding: 15px } select { width:100%; height:44px } dialog { width:280px } </style>
    <form><label for="variant">Product option</label><select id="variant" name="variant" required>
    <option value="">Choose an option</option><option value="small">Small</option><option value="sold" disabled>Sold out</option><option value="large">Large</option></select>
    <button id="next">Continue</button></form><dialog><label>Inside dialog<select name="dialog-option"><option>One</option><option>Two</option></select></label></dialog>`);
  await page.evaluate(() => {
    const supports = CSS.supports.bind(CSS);
    CSS.supports = (...args) => args[1] === 'base-select' ? false : supports(...args);
    window.changes = [];
    document.querySelector('#variant').addEventListener('change', e => changes.push(e.target.value));
  });
  await page.addScriptTag({ path: join(repoRoot, 'cart/select.js') });
  const combo = page.getByRole('combobox', { name: 'Product option', exact: true });
  const source = page.locator('#variant');
  await combo.focus();
  await page.keyboard.press('Space');
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('Escape');
  assert.equal(await source.inputValue(), '');
  assert.equal(await combo.getAttribute('aria-expanded'), 'false');
  await page.keyboard.press('Space');
  await page.keyboard.press('End');
  await page.keyboard.press('Enter');
  assert.equal(await source.inputValue(), 'large');
  assert.deepEqual(await page.evaluate(() => changes), ['large']);
  assert.equal(await page.evaluate(() => new FormData(document.querySelector('form')).get('variant')), 'large');
  await page.keyboard.press('s');
  await page.keyboard.press('Enter');
  assert.equal(await source.inputValue(), 'small');
  await combo.click();
  await page.getByRole('option', { name: 'Large', exact: true }).tap();
  assert.equal(await source.inputValue(), 'large');
  await page.evaluate(() => document.querySelector('form').reset());
  await page.waitForFunction(() => document.querySelector('.ezkart-select-trigger span').textContent === 'Choose an option');
  await page.locator('#next').click();
  assert.equal(await combo.getAttribute('aria-invalid'), 'true');
  assert.ok(await page.getByRole('alert').first().innerText());
  await combo.click();
  await page.getByRole('option', { name: 'Small', exact: true }).click();
  assert.equal(await combo.getAttribute('aria-invalid'), null);
  await source.evaluate(select => { select.append(new Option('Extra large', 'xl')); select.value = 'xl'; select.dispatchEvent(new Event('change', { bubbles: true })); });
  assert.equal(await combo.innerText(), 'Extra large');
  await source.evaluate(select => select.disabled = true);
  await page.waitForFunction(() => document.querySelector('.ezkart-select-trigger').disabled);
  await source.evaluate(select => select.disabled = false);
  await page.waitForFunction(() => !document.querySelector('.ezkart-select-trigger').disabled);
  await combo.click();
  await page.keyboard.press('Home');
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('Tab');
  assert.equal(await source.inputValue(), 'small');
  assert.equal(await page.evaluate(() => document.activeElement.id), 'next');
  await page.evaluate(() => document.querySelector('dialog').showModal());
  const dialogCombo = page.getByRole('combobox', { name: 'Inside dialog' });
  await dialogCombo.click();
  await page.getByRole('option', { name: 'Two', exact: true }).click();
  assert.equal(await page.locator('select[name="dialog-option"]').inputValue(), 'Two');
  await dialogCombo.click();
  await page.keyboard.press('Escape');
  assert.equal(await page.locator('dialog').evaluate(d => d.open), true);
  await page.evaluate(() => document.querySelector('dialog').close());
  await source.evaluate(select => select.replaceChildren(...Array.from({ length: 40 }, (_, i) => new Option(`Option ${i + 1}`, `option-${i}`))));
  await combo.click();
  await page.keyboard.press('End');
  const menu = page.getByRole('listbox', { name: 'Product option' });
  const rect = await menu.boundingBox();
  assert.ok(rect.height <= 320 && rect.x >= 0 && rect.x + rect.width <= 390 && rect.y >= 0 && rect.y + rect.height <= 700);
  assert.ok(await menu.evaluate(el => el.scrollTop > 0));
  await page.screenshot({ path: '/tmp/ezkart-dropdown-fallback.png' });
  await page.keyboard.press('Enter');
  assert.equal(await source.inputValue(), 'option-39');
  await source.evaluate(select => select.closest('.ezkart-select').remove());
  await page.waitForFunction(() => !document.querySelector('.ezkart-select-menu[aria-label="Product option"]'));
  assert.deepEqual(errors, []);
});

test('standalone landing pages include the dropdown fallback and update the selected product price', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'ezkart-select-export-'));
  const ws = await new Workspace(directory).init();
  await writeFile(join(directory, 'catalog.json'), JSON.stringify({ demoCheckout: true, products: [{
    id: 'syrup', name: 'Syrup', type: 'physical', status: 'active', price: 42500, stock: 10,
    variants: [{ id: 'small', name: '250 ml', price: 42500, stock: 10 }, { id: 'large', name: '550 ml', price: 65000, stock: 5 }],
  }] }));
  await ws.create({ id: 'dropdown', name: 'Dropdown', productIds: ['syrup'] });
  await ws.start();
  const browser = await chromium.launch();
  t.after(async () => { await browser.close(); await ws.stop(); await rm(directory, { recursive: true, force: true }); });
  const editor = await browser.newPage();
  await editor.goto(ws.url + '/cart/admin/?page=sites&edit=dropdown.ezkart.site');
  await editor.waitForFunction(() => globalThis.EzkartBuilder && globalThis.EzkartSelect);
  await editor.evaluate(async () => {
    for (const part of ['options', 'price', 'add']) await EzkartBuilder.nativeInsert({ section: 'blank', node: {
      id: 'syrup-' + part, type: 'commerce', part, productId: 'syrup', group: 'purchase', optionLayout: 'select', label: part === 'options' ? 'Size' : '',
    } });
  });
  const html = await editor.evaluate(() => EzkartBuilder.previewHtml());
  const page = await browser.newPage({ viewport: { width: 390, height: 800 } });
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  await page.addInitScript(() => {
    const supports = CSS.supports.bind(CSS);
    CSS.supports = (...args) => args[1] === 'base-select' ? false : supports(...args);
  });
  await page.route('https://dropdown.example.test/', route => route.fulfill({ body: html, contentType: 'text/html' }));
  await page.goto('https://dropdown.example.test/');
  const combo = page.getByRole('combobox', { name: 'Size', exact: true });
  assert.equal(await page.locator('#native-syrup-price').innerText(), 'Rp42.500');
  await combo.click();
  await page.getByRole('option', { name: '550 ml', exact: true }).click();
  assert.equal(await page.locator('#native-syrup-price').innerText(), 'Rp65.000');
  assert.equal(await page.locator('#native-syrup-options select').inputValue(), 'large');
  await page.locator('#native-syrup-add button').click();
  assert.match(await page.locator('[data-ezkart-cart-items]').innerText(), /550 ml/);
  assert.equal(await page.locator('[data-ezkart-cart-subtotal]').innerText(), 'Rp65.000');
  assert.deepEqual(errors, []);
});
