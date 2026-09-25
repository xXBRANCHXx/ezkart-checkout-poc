import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createHash, createHmac, randomBytes} from 'node:crypto';
import {build} from 'esbuild';
import {Miniflare, convertV4MiniflareOptions} from 'miniflare';
import {expireCommerceOrders} from '../src/commerce-orders.js';

const secret = 'commerce-service-fixture-secret-only-not-a-real-key';
const customer = {name: 'Order Tester', email: 'orders@example.test', phone: '081234567890'};
const digest = value => createHash('sha256').update(value).digest('hex');

async function setup(t) {
  const bundle = await build({entryPoints: [new URL('../src/index.js', import.meta.url).pathname], bundle: true, write: false, format: 'esm', platform: 'neutral'});
  const mf = new Miniflare(convertV4MiniflareOptions({modules: true, script: bundle.outputFiles[0].text,
    compatibilityDate: '2026-08-11', d1Databases: ['DB'], r2Buckets: ['PUBLIC_ASSETS', 'PRIVATE_ASSETS'],
    bindings: {APP_ENVIRONMENT: 'test', COMMERCE_STORAGE: 'd1', COMMERCE_SERVICE_SECRET: secret}}));
  t.after(() => mf.dispose());
  const db = await mf.getD1Database('DB');
  for (const name of ['0001_core.sql', '0002_cloud_catalog.sql', '0009_commerce_orders.sql']) {
    const source = (await readFile(new URL('../migrations/' + name, import.meta.url), 'utf8')).replace(/--[^\n]*/g, '');
    const triggers = [...source.matchAll(/CREATE TRIGGER[\s\S]*?END;/g)].map(match => match[0]);
    for (const statement of [...source.replace(/CREATE TRIGGER[\s\S]*?END;/g, '').split(';').filter(value => value.trim()), ...triggers]) await db.prepare(statement).run();
  }
  for (const seller of ['alice', 'bob']) {
    await db.prepare("INSERT INTO sellers(id,slug,name,created_at,updated_at) VALUES (?,?,?,'now','now')").bind('seller_' + seller, seller, seller).run();
  }
  async function product(id, stock = 10, seller = 'seller_alice', price = 20000) {
    await db.prepare("INSERT INTO products(id,seller_id,type,status,title,sku,price_amount,stock_quantity,weight_grams,created_at,updated_at) VALUES (?,?,'physical','active',?,?,?, ?,100,'now','now')")
      .bind(id, seller, id, 'SKU-' + id, price, stock).run();
  }
  await product('tea'); await product('mug'); await product('private', 10, 'seller_bob');
  function headers(path, method, body, extra = {}) {
    const timestamp = String(Math.floor(Date.now() / 1000));
    const nonce = randomBytes(16).toString('hex');
    const canonical = ['v1', 'test', method, path, timestamp, nonce, digest(body)].join('\n');
    return {'content-type': 'application/json', 'x-ezkart-timestamp': timestamp, 'x-ezkart-request-id': nonce,
      'x-ezkart-environment': 'test', 'x-ezkart-signature': createHmac('sha256', secret).update(canonical).digest('hex'), ...extra};
  }
  async function call(path, input, extra) {
    const method = input === undefined ? 'GET' : 'POST', body = input === undefined ? '' : JSON.stringify(input);
    const response = await mf.dispatchFetch('https://api.fixture.test' + path, {method, headers: headers(path, method, body, extra), ...(method === 'POST' ? {body} : {})});
    return {status: response.status, ...await response.json()};
  }
  function input(overrides = {}) {
    return {environment: 'sandbox', sellerId: 'seller_alice', checkoutKey: randomBytes(16).toString('hex'),
      customer, items: [{productId: 'tea', quantity: 2, expectedPrice: 20000}],
      shipping: {amount: 0, skipped: true}, expiresAt: new Date(Date.now() + 3600000).toISOString(), ...overrides};
  }
  const create = input => call('/internal/commerce/orders', input);
  const event = (order, type, data = {}, key = randomBytes(16).toString('hex')) => call(`/internal/commerce/orders/${order.id}/events`, {environment: 'sandbox', sellerId: order.sellerId, eventKey: key, type, data});
  const paid = (order, data = {}, key) => event(order, 'payment.succeeded', {provider: 'doku', verified: true, amount: order.total, currency: 'IDR', reference: 'payment-' + order.id, ...data}, key);
  const stock = async (id = 'tea') => (await db.prepare('SELECT stock_quantity FROM products WHERE id = ?').bind(id).first()).stock_quantity;
  return {mf, db, headers, call, product, input, create, event, paid, stock};
}

test('commerce service authenticates body, target, time and deployment before accessing private orders', async t => {
  const f = await setup(t);
  const path = '/internal/commerce/orders', body = JSON.stringify(f.input());
  for (const extra of [{'x-ezkart-signature': '0'.repeat(64)}, {'x-ezkart-environment': 'production'}, {'x-ezkart-timestamp': '1000000000'}, {'x-ezkart-request-id': 'bad'}]) {
    assert.equal((await f.call(path, f.input(), extra)).status, 401);
  }
  assert.equal((await f.mf.dispatchFetch('https://api.fixture.test' + path, {method: 'POST', body, headers: f.headers(path, 'POST', body + ' ')})).status, 401);
  assert.equal((await f.mf.dispatchFetch('https://api.fixture.test' + path + '?tampered=1', {method: 'POST', body, headers: f.headers(path, 'POST', body)})).status, 401);
  assert.equal((await f.create(f.input({environment: 'production'}))).status, 403);
  assert.equal((await f.call(path, {large: 'x'.repeat(65000)})).status, 413);
  const request = f.input();
  const created = await f.create(request);
  assert.equal(created.status, 200, created.error);
  assert.equal((await f.call(`/internal/commerce/orders/${created.order.id}?seller=seller_bob&environment=sandbox`)).status, 404);
  assert.equal((await f.create(f.input({items: [{productId: 'private', quantity: 1, expectedPrice: 20000}]}))).status, 409);
  assert.equal((await f.create(f.input({items: [{productId: 'tea', quantity: 1, expectedPrice: 1}]}))).status, 409);
  assert.equal((await f.create(f.input({items: [{productId: 'tea', quantity: 1.5, expectedPrice: 20000}]}))).status, 422);
});

test('atomic reservations prevent overselling and roll back every line and customer on failure', async t => {
  const f = await setup(t);
  await f.db.prepare("UPDATE products SET stock_quantity = 3 WHERE id = 'tea'").run();
  const attempts = await Promise.all(Array.from({length: 8}, () => f.create(f.input())));
  assert.equal(attempts.filter(result => result.status === 200).length, 1, JSON.stringify(attempts));
  assert.equal(attempts.filter(result => result.status === 409).length, 7);
  assert.equal(await f.stock(), 3, 'Reservations hold on-hand stock rather than reporting it as sold');
  assert.equal((await f.db.prepare("SELECT SUM(quantity) AS n FROM inventory_reservations WHERE state = 'reserved'").first()).n, 2);
  const multi = f.input({customer: {...customer, email: 'rollback@example.test'}, items: [
    {productId: 'mug', quantity: 2, expectedPrice: 20000}, {productId: 'tea', quantity: 3, expectedPrice: 20000},
  ]});
  assert.equal((await f.create(multi)).status, 409);
  assert.equal((await f.db.prepare("SELECT COUNT(*) AS n FROM inventory_reservations WHERE product_id='mug'").first()).n, 0);
  assert.equal((await f.db.prepare("SELECT COUNT(*) AS n FROM customers WHERE email='rollback@example.test'").first()).n, 0);
  assert.equal((await f.db.prepare('SELECT COUNT(*) AS n FROM orders').first()).n, 1);
  await assert.rejects(f.db.prepare("UPDATE products SET stock_quantity = 1 WHERE id = 'tea'").run(), /commerce_reserved_stock/);
  await assert.rejects(f.db.prepare('DELETE FROM inventory_reservations').run(), /commerce_immutable_reservation/);
});

test('checkout retries and concurrent callbacks consume stock exactly once and retain fee snapshots', async t => {
  const f = await setup(t), request = f.input();
  const attempts = await Promise.all(Array.from({length: 5}, () => f.create(request)));
  assert(attempts.every(result => result.status === 200), JSON.stringify(attempts));
  assert.equal(new Set(attempts.map(result => result.order.id)).size, 1);
  const order = attempts[0].order;
  assert.equal(order.total, 40000);
  assert.equal(order.snapshot.fees.commissionAmount, 2000);
  assert.equal((await f.create({...request, items: [{productId: 'tea', quantity: 3, expectedPrice: 20000}]})).status, 409);
  assert.equal((await f.paid(order, {amount: 1})).status, 409);
  assert.equal((await f.paid(order, {currency: 'USD'})).status, 409);
  assert.equal((await f.paid(order, {verified: false})).status, 409);
  const eventKey = 'one-callback';
  const paid = await Promise.all(Array.from({length: 5}, () => f.paid(order, {}, eventKey)));
  assert(paid.every(result => result.status === 200), JSON.stringify(paid));
  assert.equal(await f.stock(), 8);
  assert.equal((await f.db.prepare('SELECT COUNT(*) AS n FROM commerce_payment_captures').first()).n, 1);
  assert.equal(paid[0].order.state, 'paid');
  assert.equal(paid[0].order.fulfillmentState, 'not_required');
  assert.equal((await f.paid(order, {amount: 1}, eventKey)).status, 409);
  await f.db.prepare("UPDATE sellers SET plan='advanced' WHERE id='seller_alice'").run();
  const late = await f.event(order, 'payment.expired', {verified: true});
  assert.equal(late.order.state, 'paid'); assert.equal(late.order.snapshot.fees.commissionBasisPoints, 500);
  assert.equal(await f.stock(), 8);
  const other = (await f.create(f.input())).order;
  assert.equal(other.snapshot.fees.commissionBasisPoints, 600);
  assert.equal((await f.paid(other, {reference: 'payment-' + order.id})).status, 409);
  const overpaid = await f.paid(order, {reference: 'second-real-payment'});
  assert.equal(overpaid.status, 200, overpaid.error);
  assert.equal(overpaid.order.paymentReview, true, 'A second real charge must be recorded for refund/reconciliation');
  assert.equal(await f.stock(), 8, 'An overpayment does not consume more inventory');
  assert.equal((await f.db.prepare("SELECT COUNT(*) AS n FROM commerce_payment_captures WHERE capture_kind='duplicate_payment'").first()).n, 1);
  await assert.rejects(f.db.prepare("UPDATE orders SET total_amount=1, subtotal_amount=1 WHERE id=?").bind(order.id).run(), /commerce_immutable_order/);
  await assert.rejects(f.db.prepare('DELETE FROM commerce_order_events').run(), /commerce_immutable_event/);
});

test('expiry releases holds while late success records payment with a stock-review hold', async t => {
  const f = await setup(t);
  await f.db.prepare("UPDATE products SET stock_quantity=2 WHERE id='tea'").run();
  const order = (await f.create(f.input())).order;
  assert.equal((await f.event(order, 'payment.expired')).status, 409, 'A timer may not expire a still-valid payment');
  assert.equal((await f.event(order, 'payment.created')).order.state, 'pending');
  assert.equal((await f.event(order, 'payment.failed', {reason: 'bank attempt failed'})).order.state, 'pending');
  const expired = await f.event(order, 'payment.expired', {verified: true});
  assert.equal(expired.order.state, 'expired');
  const next = await f.create(f.input()); assert.equal(next.status, 200);
  assert.equal((await f.paid(next.order)).order.fulfillmentState, 'not_required');
  assert.equal(await f.stock(), 0);
  const late = await f.paid(order);
  assert.equal(late.order.state, 'paid'); assert.equal(late.order.fulfillmentState, 'stock_review');
  assert.equal(await f.stock(), 0, 'Late payment cannot consume another buyer’s stock');
  assert.equal((await f.db.prepare('SELECT COUNT(*) AS n FROM commerce_payment_captures').first()).n, 2);
});

test('variants reserve independently; cancellation and failed creation release exactly once', async t => {
  const f = await setup(t);
  for (const [id, hidden, index] of [['green', false, 1], ['black', false, 2], ['secret', true, 3]]) {
    await f.db.prepare("INSERT INTO product_variants(id,seller_id,product_id,name,options_json,sku,price_amount,stock_quantity,weight_grams,sort_order,created_at,updated_at) VALUES (?,'seller_alice','tea',?,?,?,25000,2,100,?,'now','now')")
      .bind(id, id, JSON.stringify({hidden, values: []}), 'SKU-' + id, index).run();
  }
  const variant = id => f.input({items: [{productId: 'tea', variantId: id, quantity: 2, expectedPrice: 25000}]});
  assert.equal((await f.create(f.input())).status, 409, 'Variant products require an explicit choice');
  assert.equal((await f.create(variant('secret'))).status, 409);
  const green = (await f.create(variant('green'))).order;
  const black = (await f.create(variant('black'))).order;
  await assert.rejects(f.db.prepare("DELETE FROM product_variants WHERE id='green'").run(), /commerce_reserved_stock/);
  await assert.rejects(f.db.prepare("UPDATE product_variants SET stock_quantity=1 WHERE id='green'").run(), /commerce_reserved_stock/);
  assert.equal((await f.event(green, 'checkout.cancelled')).order.state, 'cancelled');
  assert.equal((await f.event(green, 'checkout.cancelled')).order.state, 'cancelled');
  assert.equal((await f.event(black, 'payment.create_failed')).order.state, 'failed');
  const reopened = await f.create(variant('green')); assert.equal(reopened.status, 200);
  await f.paid(reopened.order);
  assert.equal((await f.db.prepare("SELECT stock_quantity FROM product_variants WHERE id='green'").first()).stock_quantity, 0);
  assert.equal((await f.db.prepare("SELECT stock_quantity FROM product_variants WHERE id='black'").first()).stock_quantity, 2);
});

test('available storefront stock reflects reservations and the scheduled expiry pass releases them', async t => {
  const f = await setup(t);
  const order = (await f.create(f.input())).order;
  const available = async () => (await (await f.mf.dispatchFetch('https://api.fixture.test/v1/storefront/products?ids=tea')).json()).products;
  assert.equal((await available())[0].stock, 8);
  await f.db.prepare("UPDATE orders SET expires_at = '2026-01-01T00:00:00.000Z' WHERE id=?").bind(order.id).run();
  const env = {DB: f.db, APP_ENVIRONMENT: 'test', COMMERCE_STORAGE: 'd1'};
  assert.equal((await expireCommerceOrders(env)).expired, 1);
  assert.equal((await expireCommerceOrders(env)).expired, 0);
  assert.equal((await available())[0].stock, 10);
  const jobs = (await f.db.prepare('SELECT kind, state FROM commerce_jobs WHERE order_id=?').bind(order.id).all()).results;
  assert.deepEqual(jobs.map(row => [row.kind, row.state]).sort(), [['notification.order_state', 'queued'], ['payment.create', 'dead']]);
});

test('transactional jobs have exclusive leases, immutable retry keys and durable completion receipts', async t => {
  const f = await setup(t);
  const order = (await f.create(f.input())).order;
  const claim = workerId => f.call('/internal/commerce/jobs/claim', {environment: 'sandbox', workerId, kinds: ['payment.create']});
  const attempts = await Promise.all(['worker_one', 'worker_two', 'worker_three'].map(claim));
  assert(attempts.every(result => result.status === 200), JSON.stringify(attempts));
  assert.equal(attempts.reduce((count, result) => count + result.jobs.length, 0), 1);
  const index = attempts.findIndex(result => result.jobs.length), job = attempts[index].jobs[0];
  const workerId = ['worker_one', 'worker_two', 'worker_three'][index];
  const finish = (extra = {}) => f.call(`/internal/commerce/jobs/${job.id}/finish`, {environment: 'sandbox', workerId,
    leaseToken: job.leaseToken, outcome: 'succeeded', result: {reference: 'created-provider-session'}, ...extra});
  assert.equal((await finish({workerId: 'intruder'})).status, 409);
  assert.equal((await finish()).status, 409, 'Provider results must reach the order before acknowledging the job');
  await f.event(order, 'payment.created', {reference: 'created-provider-session'});
  const completions = await Promise.all([finish(), finish(), finish()]);
  assert(completions.every(result => result.status === 200), JSON.stringify(completions));
  assert.equal((await finish({result: {reference: 'different'}})).status, 409);
  assert.equal((await claim('worker_four')).jobs.length, 0);
  const audit = (await f.db.prepare('SELECT * FROM commerce_job_attempts WHERE job_id=?').bind(job.id).all()).results;
  assert.equal(audit.length, 1); assert.equal(audit[0].outcome, 'succeeded'); assert(audit[0].finished_at);
  await assert.rejects(f.db.prepare('UPDATE commerce_jobs SET payload_json=? WHERE id=?').bind('{"providerRequestId":"changed"}', job.id).run(), /commerce_immutable_job/);
});

test('lost provider responses require reconciliation; failed retries back off and stop at their limit', async t => {
  const f = await setup(t);
  const order = (await f.create(f.input())).order;
  const claim = (mode = 'execute') => f.call('/internal/commerce/jobs/claim', {environment: 'sandbox', workerId: 'payments_worker', kinds: ['payment.create'], mode});
  const job = (await claim()).jobs[0];
  const finish = (held, outcome, result = {}) => f.call(`/internal/commerce/jobs/${held.id}/finish`, {
    environment: 'sandbox', workerId: 'payments_worker', leaseToken: held.leaseToken, outcome, result,
  });
  assert.equal((await finish(job, 'retry')).status, 409);
  await f.db.prepare("UPDATE commerce_jobs SET lease_until='2026-01-01T00:00:00.000Z', maximum_attempts=2 WHERE id=?").bind(job.id).run();
  assert.equal((await claim()).jobs.length, 0, 'A crashed provider call cannot be executed again blindly');
  assert.equal((await finish(job, 'succeeded')).status, 409, 'Old lease cannot complete after recovery');
  const reconcile = (await claim('reconcile')).jobs[0];
  assert.equal(reconcile.data.providerRequestId, job.data.providerRequestId);
  assert.equal(reconcile.mode, 'reconcile');
  assert.equal((await finish(reconcile, 'retry', {noEffectConfirmed: true})).job.state, 'dead');
  assert.equal((await claim()).jobs.length, 0);
  const rows = (await f.db.prepare('SELECT outcome FROM commerce_job_attempts WHERE job_id=? ORDER BY attempt').bind(job.id).all()).results;
  assert.deepEqual(rows.map(row => row.outcome), ['uncertain', 'dead']);
  const second = (await f.create(f.input())).order;
  const retryJob = (await claim()).jobs[0];
  assert.equal(retryJob.orderId, second.id);
  const retry = await finish(retryJob, 'retry', {noEffectConfirmed: true});
  assert.equal(retry.job.state, 'retry');
  const row = await f.db.prepare('SELECT available_at FROM commerce_jobs WHERE id=?').bind(retryJob.id).first();
  assert(Date.parse(row.available_at) > Date.now() + 13000);
  assert.equal((await claim()).jobs.length, 0);
  assert.equal((await f.call(`/internal/commerce/orders/${order.id}?seller=seller_alice&environment=sandbox`)).order.state, 'creating');
});
