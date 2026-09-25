import test from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {createHash, createHmac, randomBytes} from 'node:crypto';
import {spawn} from 'node:child_process';
import {readdir, writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {setup} from './fixture.mjs';
import {setupCommerceFixture, secret} from '../../cloudflare/ezkart-api/test/commerce-fixture.mjs';

const input = changes => ({checkout_key: randomBytes(16).toString('hex'), cart: {tea: 2}, expected_prices: {tea: 20000},
  expected_total: 40000, shop: 'alice-shop', shipping_id: '',
  customer: {fullName: 'Checkout Tester', email: 'checkout@example.com', phone: '081234567890', location: 'Jakarta Selatan',
    address: 'Jalan Test Nomor 12', postalCode: '12345', note: 'Handle with care', coordinate: {latitude: -6.2, longitude: 106.8}}, ...changes});

async function fixture(t, overrides = {}) {
  const f = await setupCommerceFixture(t);
  const control = {drop: '', fail: '', calls: [], ageOrders: false};
  const relay = createServer(async (req, res) => {
    try {
      const chunks = []; for await (const chunk of req) chunks.push(chunk);
      const body = Buffer.concat(chunks).toString();
      control.calls.push({path: req.url, body: body ? JSON.parse(body) : null});
      if (control.fail && req.url === control.fail) { res.writeHead(503); res.end('{"ok":false}'); return; }
      const response = await f.mf.dispatchFetch('https://api.fixture.test' + req.url, {method: req.method, headers: req.headers,
        ...(body ? {body} : {})});
      let text = await response.text();
      // Simulate an elapsed minute for the PHP status-check guard without rewriting immutable database snapshots.
      if (control.ageOrders && req.method === 'GET' && req.url.startsWith('/internal/commerce/orders/')) {
        const data = JSON.parse(text); if (data.order) data.order.createdAt = new Date(Date.now() - 120000).toISOString(); text = JSON.stringify(data);
      }
      if (control.drop && req.url === control.drop) { control.drop = ''; res.writeHead(503); res.end('lost response'); return; }
      res.writeHead(response.status, {'content-type': 'application/json'}); res.end(text);
    } catch (error) { res.writeHead(500); res.end(JSON.stringify({ok: false, error: error.message})); }
  });
  await new Promise(resolve => relay.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => {relay.closeAllConnections(); relay.close(resolve);}));
  const app = await setup({EZKART_COMMERCE_STORAGE: 'd1', EZKART_COMMERCE_SERVICE_SECRET: secret,
    EZKART_TEST_COMMERCE_RELAY: `http://127.0.0.1:${relay.address().port}`,
    EZKART_CLOUDFLARE_API_URL: 'https://ezkart-api-test.fixture.workers.dev', EZKART_DOKU_SANDBOX_PAYMENT_FLOW: 'direct_bca', ...overrides});
  t.after(() => app.close());
  const record = async id => (await f.call('/internal/commerce/orders/' + id + '?environment=sandbox')).order;
  const count = async table => (await f.db.prepare(`SELECT COUNT(*) AS count FROM ${table}`).first()).count;
  const providerCalls = async () => (await app.calls()).filter(call => call.url.includes('/payment-code') || call.url.includes('/checkout/v1/payment'));
  return {...f, app, control, record, count, providerCalls};
}

function notification(order, changes = {}) {
  return {order: {invoice_number: order.id, amount: order.total, currency: 'IDR'},
    transaction: {status: 'SUCCESS', original_request_id: order.paymentRequestId, type: 'SALE'},
    channel: {id: 'VIRTUAL_ACCOUNT_BCA'}, virtual_account_info: {virtual_account_number: '1900800000999999'},
    virtual_account_payment: {identifer: [{name: 'REFERENCE', value: 'bank-charge-001'}]}, ...changes};
}
async function notify(app, data, invalid = false) {
  const body = JSON.stringify(data), target = '/cart/api/doku-webhook.php';
  const headers = {'Client-Id': 'MCH-SANDBOX-TEST', 'Request-Id': randomBytes(16).toString('hex'), 'Request-Timestamp': new Date().toISOString().replace(/\.\d{3}Z$/, 'Z')};
  const canonical = `Client-Id:${headers['Client-Id']}\nRequest-Id:${headers['Request-Id']}\nRequest-Timestamp:${headers['Request-Timestamp']}\nRequest-Target:${target}\nDigest:${createHash('sha256').update(body).digest('base64')}`;
  headers.Signature = 'HMACSHA256=' + createHmac('sha256', invalid ? 'wrong' : 'fixture-doku-sandbox-secret').update(canonical).digest('base64');
  return app.request(target, body, headers);
}

async function dispatch(app) {
  const child = spawn(process.env.PHP_BINARY || 'php', ['-n', '-d', 'auto_prepend_file=' + fileURLToPath(new URL('./provider-fixture.php', import.meta.url)),
    fileURLToPath(new URL('../commerce/payment-dispatch.php', import.meta.url)), '--once'], {env: app.env});
  let stdout = '', stderr = ''; child.stdout.on('data', chunk => stdout += chunk); child.stderr.on('data', chunk => stderr += chunk);
  const code = await new Promise((resolve, reject) => {child.on('error', reject); child.on('exit', resolve);});
  return {code, stdout, stderr};
}

test('central PHP checkout stores trusted options and customer snapshots, resumes original prices and publishes no private payment fields', async t => {
  const f = await fixture(t), request = input();
  const cookie = f.app.customerCookie();
  const start = await f.app.request('/cart/api/start.php', request, {Cookie: `${cookie.name}=${cookie.value}`});
  assert.equal(start.status, 201, JSON.stringify(start.data)); assert.equal(start.data.status, 'PENDING');
  const order = await f.record(start.data.order_id);
  assert.equal(order.customer.authUserId, 'fixture-google-customer');
  assert.equal(order.snapshot.shipping.destination.coordinate.latitude, -6.2);
  assert.equal(order.items[0].productId, 'tea'); assert.equal(order.payment.accountNumber, '1900800000999999');
  assert.equal(order.paymentJobState, 'succeeded');
  await f.db.prepare('UPDATE products SET price_amount=25000 WHERE id=?').bind('tea').run();
  const replay = await f.app.request('/cart/api/start.php', request);
  assert.equal(replay.status, 201, JSON.stringify(replay.data)); assert.equal(replay.data.order_id, order.id); assert.equal(replay.data.payment_total, 40000);
  assert.equal((await f.providerCalls()).length, 1); assert.equal(await f.count('orders'), 1);
  const changed = await f.app.request('/cart/api/start.php', {...request, customer: {...request.customer, address: 'A different address'}});
  assert.equal(changed.status, 409);
  const status = await f.app.request('/cart/api/status.php?order=' + order.id);
  assert.equal(status.status, 200); assert.equal(status.data.payment_details.account_number, '1900800000999999');
  assert(!JSON.stringify(status.data).match(/Checkout Tester|checkout@example|Jalan Test|106\.8|authUserId|paymentRequestId|leaseToken/));
  assert.equal((await f.app.request('/cart/api/status.php?tracking=1&order=' + order.id)).status, 401);
  assert.equal((await f.app.tracking(order.id, {cookie})).status, 200);
  assert.equal((await readdir(join(f.app.directory, 'orders')).catch(() => [])).length, 0);
});

test('lost order and instruction responses recover without new provider requests or replacing frozen delivery quotes', async t => {
  const f = await fixture(t), request = input({shipping_id: 'jne-reg', expected_total: 58000});
  f.control.drop = '/internal/commerce/orders';
  assert.equal((await f.app.request('/cart/api/start.php', request)).status, 503);
  assert.equal(await f.count('orders'), 1); assert.equal((await f.providerCalls()).length, 0);
  const existing = (await f.db.prepare('SELECT id FROM orders').first()).id;
  f.control.drop = '/internal/commerce/orders/' + existing + '/events';
  const retry = await f.app.request('/cart/api/start.php', request);
  assert.equal(retry.data.order_id, existing); assert.equal(retry.data.status, 'PENDING');
  const record = await f.record(existing); assert.equal(record.paymentJobState, 'uncertain');
  assert.equal(record.snapshot.shipping.origin.origin_postal_code, '12345');
  assert(!JSON.stringify(record.snapshot).includes('api_key'));
  assert.equal((await f.app.calls()).filter(c => c.url.endsWith('/rates/couriers')).length, 1);
  const replay = await f.app.request('/cart/api/start.php', request); assert.equal(replay.data.order_id, existing);
  assert.equal((await f.providerCalls()).length, 1);
});

test('unknown provider outcomes retain reservations and a stable waiting order even after repeated checkout retries', async t => {
  const f = await fixture(t, {EZKART_TEST_DOKU_FAILURE: '1'}), request = input();
  const first = await f.app.request('/cart/api/start.php', request);
  assert.equal(first.status, 202, JSON.stringify(first.data)); assert.equal(first.data.status, 'CREATING');
  const replay = await f.app.request('/cart/api/start.php', request);
  assert.equal(replay.data.order_id, first.data.order_id); assert.equal((await f.providerCalls()).length, 1);
  const order = await f.record(first.data.order_id); assert.equal(order.paymentJobState, 'uncertain');
  assert.equal(await f.stock(), 10); assert.equal((await f.db.prepare("SELECT COUNT(*) AS count FROM inventory_reservations WHERE state='reserved'").first()).count, 1);
  assert.equal(await f.count('commerce_payment_captures'), 0);
});

test('central signed callbacks deduplicate bank charges across notification IDs and retain distinct payments for review', async t => {
  const f = await fixture(t), created = await f.app.request('/cart/api/start.php', input()), order = await f.record(created.data.order_id);
  assert.equal((await notify(f.app, notification(order), true)).status, 400);
  assert.equal((await notify(f.app, notification(order, {transaction: {status: 'SUCCESS', original_request_id: 'another-request'}}))).status, 500);
  assert.equal((await notify(f.app, notification(order, {virtual_account_payment: {identifier: []}}))).status, 500);
  assert.equal(await f.count('commerce_payment_captures'), 0);
  assert.equal((await notify(f.app, notification(order))).status, 200);
  const repeat = notification(order); repeat.transaction.date = '2026-09-26T00:00:00Z';
  repeat.virtual_account_payment.identifier = repeat.virtual_account_payment.identifer; delete repeat.virtual_account_payment.identifer;
  assert.equal((await notify(f.app, repeat)).status, 200);
  assert.equal(await f.stock(), 8); assert.equal(await f.count('commerce_payment_captures'), 1);
  repeat.virtual_account_payment.identifier[0].value = 'bank-charge-002';
  assert.equal((await notify(f.app, repeat)).status, 200);
  assert.equal(await f.stock(), 8); assert.equal(await f.count('commerce_payment_captures'), 2);
  assert.equal((await f.record(order.id)).paymentReview, true);
});

test('hosted checkout stores its allowed link and WIB expiry while stale totals and central outages fail before provider creation', async t => {
  const f = await fixture(t, {EZKART_DOKU_SANDBOX_PAYMENT_FLOW: 'hosted'});
  assert.equal((await f.app.request('/cart/api/start.php', input({expected_total: 1}))).status, 422);
  assert.equal(await f.count('orders'), 0); assert.equal((await f.providerCalls()).length, 0);
  f.control.fail = '/internal/commerce/checkouts/resume';
  assert.equal((await f.app.request('/cart/api/start.php', input())).status, 503);
  assert.equal((await f.providerCalls()).length, 0); f.control.fail = '';
  const start = await f.app.request('/cart/api/start.php', input());
  assert.equal(start.status, 201, JSON.stringify(start.data));
  const order = await f.record(start.data.order_id);
  assert.equal(order.payment.paymentUrl, 'https://staging.doku.com/checkout-link-v2/fixture');
  assert(Math.abs(Date.parse(order.payment.expiresAt) - Date.now() - 3600000) < 15000);
  assert.equal(order.snapshot.checkout.paymentFlow, 'hosted');
});

test('a saved central checkout cannot create a legacy charge during a rollout rollback', async t => {
  const app = await setup({EZKART_COMMERCE_STORAGE: 'files'}); t.after(() => app.close());
  const result = await app.request('/cart/api/start.php', input({cart: {granola: 2}, expected_prices: {granola: 58000}, expected_total: 116000}));
  assert.equal(result.status, 503);
  assert.equal((await app.calls()).filter(c => c.url.includes('doku.com')).length, 0);
  assert.equal((await readdir(join(app.directory, 'orders')).catch(() => [])).length, 0);
});

test('payment dispatcher reconciles a lost provider response with signed status reads and never retries create after not-found', async t => {
  const f = await fixture(t, {EZKART_TEST_DOKU_FAILURE: '1'});
  const start = await f.app.request('/cart/api/start.php', input()); const order = await f.record(start.data.order_id);
  const due = async () => {
    await f.db.prepare("UPDATE commerce_jobs SET available_at='2020-01-01T00:00:00.000Z' WHERE kind='payment.create'").run();
    f.control.ageOrders = true;
  };
  await due(); let run = await dispatch(f.app);
  assert.equal(run.code, 2, run.stderr); assert.equal(JSON.parse(run.stdout).uncertain, 1);
  assert.equal((await f.record(order.id)).state, 'creating'); assert.equal((await f.providerCalls()).length, 1);
  const statusCall = (await f.app.calls()).find(c => c.url.includes('/orders/v1/status/'));
  assert.equal(statusCall.method, 'GET'); assert.equal(statusCall.body, '');
  const headers = Object.fromEntries(statusCall.headers.map(line => {const i = line.indexOf(':'); return [line.slice(0, i), line.slice(i + 1).trim()];}));
  const canonical = `Client-Id:${headers['Client-Id']}\nRequest-Id:${headers['Request-Id']}\nRequest-Timestamp:${headers['Request-Timestamp']}\nRequest-Target:/orders/v1/status/${order.id}`;
  assert.equal(headers.Signature, 'HMACSHA256=' + createHmac('sha256', 'fixture-doku-sandbox-secret').update(canonical).digest('base64'));
  await writeFile(join(f.app.directory, 'provider-status.json'), JSON.stringify(notification(order)));
  await due(); run = await dispatch(f.app);
  assert.equal(run.code, 0, run.stderr); assert.equal(JSON.parse(run.stdout).succeeded, 1);
  assert.equal((await f.record(order.id)).state, 'paid'); assert.equal((await f.record(order.id)).paymentJobState, 'succeeded');
  assert.equal(await f.stock(), 8); assert.equal((await f.providerCalls()).length, 1);
  assert.equal((await notify(f.app, notification(order))).status, 200); assert.equal(await f.count('commerce_payment_captures'), 1);
});

test('central checkout does not send a payment request when tab recovery storage is unavailable', async t => {
  const f = await fixture(t), {chromium} = await import('../builder-mcp/node_modules/playwright/index.mjs');
  const browser = await chromium.launch({headless: true}); t.after(() => browser.close());
  const page = await browser.newPage();
  await page.addInitScript(() => {const save = Storage.prototype.setItem; Storage.prototype.setItem = function(key, value) {
    if (key === 'ezkart.checkout.attempt.v1') throw new DOMException('Recovery storage is unavailable', 'QuotaExceededError');
    return save.call(this, key, value);
  };});
  await page.goto(f.app.base + '/cart/?shop=alice-shop&cart=tea:2'); await page.locator('#to-checkout').click();
  for (const [name, value] of Object.entries(input().customer)) if (typeof value === 'string') await page.locator(`#customer-form [name="${name}"]`).fill(value);
  await page.locator('#pay-button').click();
  await page.waitForFunction(() => document.querySelector('#toast').textContent.includes('Recovery storage'));
  assert.equal(await f.count('orders'), 0); assert.equal((await f.providerCalls()).length, 0);
});

test('checkout recovery survives a lost response, reload and later rejection even when the catalog becomes unavailable on desktop and mobile', async t => {
  const f = await fixture(t), {chromium} = await import('../builder-mcp/node_modules/playwright/index.mjs');
  const browser = await chromium.launch({headless: true}); t.after(() => browser.close());
  for (const width of [1360, 390]) {
    await f.db.prepare("UPDATE products SET status='active' WHERE id='tea'").run();
    const context = await browser.newContext({viewport: {width, height: 940}}), page = await context.newPage(), errors = [], attempts = [];
    page.on('pageerror', e => errors.push(e.message));
    let drop = true, reject = false, id = '';
    await page.route('**/api/start.php', async route => {
      attempts.push(route.request().postData());
      if (drop) { drop = false; const response = await route.fetch(); const data = await response.json(); id = data.order_id; assert(id, JSON.stringify(data)); await route.abort(); }
      else if (reject) { reject = false; await route.fulfill({status: 422, json: {ok: false, checkout_rejected: true, error: 'A temporary validation failure'}}); }
      else await route.continue();
    });
    await page.goto(f.app.base + '/cart/?shop=alice-shop&cart=tea:2');
    await page.locator('#to-checkout').click();
    for (const [name, value] of Object.entries(input().customer)) if (typeof value === 'string') await page.locator(`#customer-form [name="${name}"]`).fill(value);
    await page.locator('#pay-button').click();
    await page.waitForFunction(() => !document.querySelector('#recover-checkout').disabled && JSON.parse(sessionStorage.getItem('ezkart.checkout.attempt.v1') || '{}').uncertain);
    await f.db.prepare("UPDATE products SET status='archived' WHERE id='tea'").run();
    await page.reload(); await page.locator('#checkout-recovery').waitFor({state: 'visible'});
    reject = true; await page.locator('#recover-checkout').click();
    await page.waitForFunction(() => document.querySelector('#recovery-message').textContent.includes('temporary validation'));
    assert.equal(await page.evaluate(() => JSON.parse(sessionStorage.getItem('ezkart.checkout.attempt.v1')).uncertain), true);
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
    if (process.env.EZKART_TEST_SCREENSHOTS) await page.screenshot({path: join(process.env.EZKART_TEST_SCREENSHOTS, `checkout-recovery-${width}.png`), fullPage: true});
    await page.locator('#recover-checkout').click(); await page.waitForURL('**/payment.php?order=' + id);
    await page.locator('#transfer-details').waitFor({state: 'visible'});
    assert.equal(new Set(attempts).size, 1, 'Recovery sends the original bytes even after a reload and catalog change');
    assert.equal((await f.providerCalls()).length, width === 1360 ? 1 : 2);
    const order = await f.record(id); assert.equal((await notify(f.app, notification(order))).status, 200);
    await page.locator('#check-payment').click(); await page.getByRole('heading', {name: 'Payment confirmed', exact: true}).waitFor();
    assert.equal(await page.evaluate(() => sessionStorage.getItem('ezkart.checkout.attempt.v1')), null);
    assert.deepEqual(errors, []); await context.close();
  }
});

test('payment page shows a saved waiting order and offers hosted payment only with a valid provider link', async t => {
  const f = await fixture(t, {EZKART_TEST_DOKU_FAILURE: '1'}), {chromium} = await import('../builder-mcp/node_modules/playwright/index.mjs');
  const browser = await chromium.launch({headless: true}); t.after(() => browser.close());
  const start = await f.app.request('/cart/api/start.php', input()); assert.equal(start.status, 202);
  for (const width of [1360, 390]) {
    const page = await browser.newPage({viewport: {width, height: 940}});
    await page.goto(f.app.base + '/cart/payment.php?order=' + start.data.order_id);
    await page.getByRole('heading', {name: 'Preparing your payment', exact: true}).waitFor();
    assert.equal(await page.locator('#transfer-details').isVisible(), false); assert.equal(await page.locator('#payment-bank-logo').isVisible(), false);
    assert.equal(await page.locator('#provider-payment-link').isVisible(), false);
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
    if (process.env.EZKART_TEST_SCREENSHOTS) await page.screenshot({path: join(process.env.EZKART_TEST_SCREENSHOTS, `payment-waiting-${width}.png`), fullPage: true});
    const data = (await f.app.request('/cart/api/status.php?order=' + start.data.order_id)).data;
    data.status = 'PENDING'; data.payment_flow = 'hosted'; data.payment_expires_at = new Date(Date.now() + 3600000).toISOString();
    data.payment_url = 'https://staging.doku.com/checkout-link-v2/fixture';
    await page.route('**/api/status.php?*', route => route.fulfill({json: data}));
    await page.locator('#check-payment').click(); await page.locator('#provider-payment-link').waitFor({state: 'visible'});
    if (process.env.EZKART_TEST_SCREENSHOTS) await page.screenshot({path: join(process.env.EZKART_TEST_SCREENSHOTS, `payment-hosted-${width}.png`), fullPage: true});
    for (const malicious of ['https://staging.doku.com.attacker.test/checkout-link-v2/fixture', 'https://staging.doku.com/checkout-link-v2/fixture#spoof']) {
      data.payment_url = malicious; await page.locator('#check-payment').click();
      await page.locator('#provider-payment-link').waitFor({state: 'hidden'});
    }
    await page.close();
  }
});
