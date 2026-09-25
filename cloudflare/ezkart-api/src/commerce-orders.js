import {checkoutContext,paymentSession,paymentSessionStatements,paymentAccountStatement} from './commerce-payments.js';

const encoder = new TextEncoder();
const idPattern = /^[A-Za-z0-9][A-Za-z0-9_-]{2,95}$/;
const orderPattern = /^EZK-[SP]-[A-F0-9]{24}$/;
const fail = (message, status = 422) => { throw new Response(message, {status}); };
const integer = (value, maximum, label, minimum = 0) => {
  if (!Number.isSafeInteger(value) || value < minimum || value > maximum) fail(`${label} is invalid`);
  return value;
};
const text = (value, maximum, label, required = true) => {
  if (typeof value !== 'string' || value.length > maximum || /[\u0000-\u001f]/.test(value) || (required && !value.trim())) fail(`${label} is invalid`);
  return value.trim();
};
const identifier = (value, label) => {
  if (typeof value !== 'string' || !idPattern.test(value)) fail(`${label} is invalid`);
  return value;
};
const parse = value => JSON.parse(value || '{}');
const stable = value => Array.isArray(value) ? value.map(stable) : value && typeof value === 'object'
  ? Object.fromEntries(Object.keys(value).sort().map(key => [key, stable(value[key])])) : value;
const hex = bytes => [...new Uint8Array(bytes)].map(byte => byte.toString(16).padStart(2, '0')).join('');
export const commerceHash = async value => hex(await crypto.subtle.digest('SHA-256', encoder.encode(typeof value === 'string' ? value : JSON.stringify(stable(value)))));

export function commerceEnvironment(env, value) {
  const expected = env.APP_ENVIRONMENT === 'test' ? 'sandbox' : env.APP_ENVIRONMENT === 'production' ? 'production' : '';
  if (!expected || value !== expected) fail('Commerce environment does not match this deployment', 403);
  return expected;
}

export const commerceStorageEnabled = env => env.COMMERCE_STORAGE === 'd1';

// Aliases are fixed by callers in source, never taken from a request.
export function reservedStockSql(env, variant = false) {
  if (!commerceStorageEnabled(env)) return '0';
  return variant
    ? "COALESCE((SELECT SUM(h.quantity) FROM inventory_reservations h WHERE h.seller_id = v.seller_id AND h.product_id = v.product_id AND h.variant_id = v.id AND h.state = 'reserved'), 0)"
    : "COALESCE((SELECT SUM(h.quantity) FROM inventory_reservations h WHERE h.seller_id = p.seller_id AND h.product_id = p.id AND h.variant_id = '' AND h.state = 'reserved'), 0)";
}

// This API is for the PHP commerce service, never a browser session. The body,
// target (including query), deployment and short validity period are signed.
// Individual operations also have durable idempotency keys in D1.
export async function authenticateCommerceService(request, env) {
  if (!commerceStorageEnabled(env)) fail('Central commerce storage is not enabled', 503);
  const secret = env.COMMERCE_SERVICE_SECRET;
  if (typeof secret !== 'string' || secret.length < 32) fail('Commerce service is not configured', 503);
  const timestamp = request.headers.get('x-ezkart-timestamp') || '';
  const nonce = request.headers.get('x-ezkart-request-id') || '';
  const signature = request.headers.get('x-ezkart-signature') || '';
  const environment = request.headers.get('x-ezkart-environment') || '';
  if (!/^\d{10}$/.test(timestamp) || Math.abs(Date.now() / 1000 - Number(timestamp)) > 120
    || !/^[a-f0-9]{32}$/.test(nonce) || !/^[a-f0-9]{64}$/.test(signature)
    || environment !== env.APP_ENVIRONMENT) fail('Invalid commerce authorization', 401);
  if (Number(request.headers.get('content-length') || 0) > 64000) fail('Commerce request is too large', 413);
  // Count streamed bytes as well: Content-Length is not a trustworthy limit.
  const reader = request.body?.getReader();
  const chunks = [];
  let size = 0;
  if (reader) {
    while (true) {
      const {done, value} = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > 64000) { await reader.cancel(); fail('Commerce request is too large', 413); }
      chunks.push(value);
    }
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
  const body = new TextDecoder().decode(bytes);
  const url = new URL(request.url);
  const canonical = ['v1', environment, request.method, url.pathname + url.search, timestamp, nonce,
    hex(await crypto.subtle.digest('SHA-256', bytes))].join('\n');
  const key = await crypto.subtle.importKey('raw', encoder.encode(secret), {name: 'HMAC', hash: 'SHA-256'}, false, ['verify']);
  const valid = await crypto.subtle.verify('HMAC', key, Uint8Array.from(signature.match(/../g), value => parseInt(value, 16)), encoder.encode(canonical));
  if (!valid) fail('Invalid commerce authorization', 401);
  if (!body) return {};
  let payload;
  try { payload = JSON.parse(body); } catch { fail('Invalid commerce JSON'); }
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) fail('Invalid commerce JSON');
  return payload;
}

function customerInput(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail('Customer is required');
  const email = text(value.email, 120, 'Customer email').toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) fail('Customer email is invalid');
  const phone = text(value.phone, 20, 'Customer phone');
  if (!/^\+?\d{8,15}$/.test(phone)) fail('Customer phone is invalid');
  const authUserId = value.authUserId ? identifier(value.authUserId, 'Customer account') : '';
  return {name: text(value.name, 100, 'Customer name'), email, phone, authUserId};
}

function checkoutInput(env, input) {
  const environment = commerceEnvironment(env, input.environment);
  const sellerId = identifier(input.sellerId, 'Seller');
  const checkoutKey = text(input.checkoutKey, 100, 'Checkout key');
  if (!/^[A-Za-z0-9_-]{16,100}$/.test(checkoutKey)) fail('Checkout key is invalid');
  if (!Array.isArray(input.items) || input.items.length < 1 || input.items.length > 50) fail('Choose between 1 and 50 product options');
  const items = input.items.map(item => ({
    productId: identifier(item?.productId, 'Product'),
    variantId: item.variantId ? identifier(item.variantId, 'Option') : '',
    quantity: integer(item.quantity, 10000, 'Quantity', 1),
    expectedPrice: integer(item.expectedPrice, 1000000000, 'Expected price', 1),
  })).sort((a, b) => `${a.productId}~${a.variantId}`.localeCompare(`${b.productId}~${b.variantId}`));
  if (new Set(items.map(item => `${item.productId}~${item.variantId}`)).size !== items.length) fail('Combine duplicate product options');
  const customer = customerInput(input.customer);
  const shipping = input.shipping;
  if (!shipping || typeof shipping !== 'object' || Array.isArray(shipping)) fail('Shipping details are required');
  const amount = integer(shipping.amount, 100000000, 'Shipping amount');
  if (typeof shipping.skipped !== 'boolean') fail('Shipping selection is invalid');
  if (shipping.skipped && (environment !== 'sandbox' || amount !== 0)) fail('Only sandbox orders may skip shipping');
  if (!shipping.skipped && (!shipping.courierCode || !shipping.serviceCode || !shipping.origin || !shipping.destination)) fail('A delivery quote and its addresses are required');
  if (JSON.stringify(shipping).length > 8000) fail('Shipping details are too large');
  const expiresAt = new Date(input.expiresAt);
  if (!Number.isFinite(expiresAt.getTime())) fail('Checkout expiry is invalid');
  return {environment, sellerId, checkoutKey, checkout:checkoutContext(input.checkout,environment), items, customer, shipping: {...shipping, amount}, expiresAt: expiresAt.toISOString()};
}

function orderView(row, items = []) {
  return {
    id: row.id, sellerId: row.seller_id, environment: row.commerce_environment,
    state: row.checkout_state, revision: row.revision, currency: row.currency,
    subtotal: row.subtotal_amount, shippingAmount: row.shipping_amount, total: row.total_amount,
    customer: parse(row.customer_snapshot_json), snapshot: parse(row.snapshot_json),
    fulfillmentState: row.fulfillment_state, paymentReview: row.payment_review === 1, expiresAt: row.expires_at, paidAt: row.paid_at,
    createdAt: row.created_at, updatedAt: row.updated_at,
    items: items.map(item => ({id: item.id, productId: item.product_id, title: item.title,
      sku: item.sku, quantity: item.quantity, price: item.unit_price_amount,
      fulfillment: parse(item.fulfillment_snapshot_json)})),
  };
}

export async function commerceOrder(env, sellerId, orderId, environment) {
  commerceEnvironment(env, environment);
  identifier(sellerId, 'Seller');
  if (!orderPattern.test(orderId || '')) fail('Order not found', 404);
  const result = await env.DB.batch([
    env.DB.prepare('SELECT * FROM orders WHERE id = ? AND seller_id = ? AND commerce_environment = ? AND commerce_version = 1').bind(orderId, sellerId, environment),
    env.DB.prepare('SELECT * FROM order_items WHERE order_id = ? AND seller_id = ? ORDER BY id').bind(orderId, sellerId),
    env.DB.prepare('SELECT details_json FROM commerce_payment_sessions WHERE order_id=? AND seller_id=?').bind(orderId,sellerId),
    env.DB.prepare("SELECT payload_json,state,last_error FROM commerce_jobs WHERE order_id=? AND seller_id=? AND kind='payment.create'").bind(orderId,sellerId),
  ]);
  const row = result[0].results[0];
  if (!row) fail('Order not found', 404);
  const paymentJob=result[3].results[0];
  return {...orderView(row, result[1].results),payment:result[2].results[0]?parse(result[2].results[0].details_json):null,
    paymentRequestId:paymentJob?parse(paymentJob.payload_json).providerRequestId:'',paymentJobState:paymentJob?.state||'',paymentJobError:paymentJob?.last_error||''};
}

function databaseFailure(error) {
  const message = `${error?.message || ''} ${error?.cause?.message || ''}`;
  if (/commerce_insufficient_stock|commerce_reserved_stock/.test(message)) fail('There is not enough available stock for this checkout', 409);
  if (/commerce_product_changed/.test(message)) fail('A product changed. Refresh its price and availability', 409);
  if (/commerce_revision_conflict/.test(message)) fail('The order changed. Reload and retry this operation', 409);
  if (/commerce_payment_mismatch/.test(message)) fail('The payment does not match this order', 409);
  if (/commerce_payment_binding_mismatch/.test(message)) fail('Provider payment instructions do not match this order',409);
  throw error;
}

export async function createCommerceOrder(env, payload) {
  const input = checkoutInput(env, payload);
  // Expiry is chosen by the service for a new attempt and does not change the
  // commercial intent of a retry after a lost response.
  const hash = await commerceHash({...input, expiresAt: undefined});
  const findExisting = () => env.DB.prepare('SELECT id,seller_id,request_hash FROM orders WHERE commerce_environment = ? AND checkout_key = ?')
    .bind(input.environment, input.checkoutKey).first();
  const replay = async row => {
    if (row.seller_id!==input.sellerId||row.request_hash !== hash) fail('This checkout key was already used for different order details', 409);
    return commerceOrder(env, input.sellerId, row.id, input.environment);
  };
  const existing = await findExisting();
  if (existing) return replay(existing);
  if (Date.parse(input.expiresAt) <= Date.now() || Date.parse(input.expiresAt) > Date.now() + 86400000) fail('Checkout expiry is invalid');
  const seller = await env.DB.prepare("SELECT id, plan FROM sellers WHERE id = ? AND status = 'active'").bind(input.sellerId).first();
  if (!seller) fail('Store is unavailable', 404);
  const productIds = [...new Set(input.items.map(item => item.productId))];
  const [products, variants] = await env.DB.batch([
    env.DB.prepare("SELECT * FROM products WHERE seller_id = ? AND id IN (SELECT value FROM json_each(?)) AND status = 'active'").bind(seller.id, JSON.stringify(productIds)),
    env.DB.prepare('SELECT * FROM product_variants WHERE seller_id = ? AND product_id IN (SELECT value FROM json_each(?))').bind(seller.id, JSON.stringify(productIds)),
  ]);
  const now = new Date().toISOString();
  const orderId = `EZK-${input.environment === 'sandbox' ? 'S' : 'P'}-${hex(crypto.getRandomValues(new Uint8Array(12))).toUpperCase()}`;
  const items = input.items.map(item => {
    const product = products.results.find(row => row.id === item.productId);
    const options = variants.results.filter(row => row.product_id === item.productId);
    const option = item.variantId ? options.find(row => row.id === item.variantId) : product;
    if (!product || product.type !== 'physical' || !option || (!item.variantId && options.length)
      || (item.variantId && parse(option.options_json).hidden)) fail('A selected product option is unavailable', 409);
    if (option.price_amount !== item.expectedPrice) fail('A product price changed. Review the new total', 409);
    if (!Number.isSafeInteger(option.weight_grams) || option.weight_grams < 1) fail('Product shipping weight is unavailable', 409);
    return {...item, id: `item_${crypto.randomUUID()}`, type: product.type, title: product.title,
      sku: option.sku || product.sku || product.id, price: option.price_amount,
      fulfillment: {variantId: item.variantId, variantName: item.variantId ? option.name : '', weightGrams: option.weight_grams}};
  });
  const subtotal = integer(items.reduce((total, item) => total + item.price * item.quantity, 0), 100000000000, 'Order subtotal', 1);
  const total = integer(subtotal + input.shipping.amount, 100000000000, 'Order total', 1);
  const snapshot = {checkout:input.checkout,shipping: input.shipping, fees: {version: 1, plan: seller.plan,
    commissionBasisPoints: seller.plan === 'advanced' ? 600 : 500, adminAmount: 1250,
    commissionAmount: Math.round(subtotal * (seller.plan === 'advanced' ? 600 : 500) / 10000),
    processingFeePolicy: 'actual_provider_fee', withdrawalMinimum: 250000, sellerWithdrawalFee: 0}};
  const statements = [
    env.DB.prepare(`INSERT INTO customers (id, seller_id, auth_user_id, email, name, phone, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT(seller_id, email) DO UPDATE SET
      name = excluded.name, phone = excluded.phone, updated_at = excluded.updated_at`)
      .bind(`customer_${crypto.randomUUID()}`, seller.id, input.customer.authUserId || null, input.customer.email, input.customer.name, input.customer.phone, now, now),
    env.DB.prepare(`INSERT INTO orders (id, seller_id, customer_id, status, currency, subtotal_amount, shipping_amount,
      total_amount, customer_snapshot_json, shipping_address_json, created_at, updated_at, commerce_version,
      commerce_environment, checkout_state, revision, checkout_key, request_hash, snapshot_json, expires_at)
      VALUES (?, ?, (SELECT id FROM customers WHERE seller_id = ? AND email = ?), 'pending', 'IDR', ?, ?, ?, ?, ?, ?, ?, 1, ?, 'creating', 0, ?, ?, ?, ?)`)
      .bind(orderId, seller.id, seller.id, input.customer.email, subtotal, input.shipping.amount, total,
        JSON.stringify(input.customer), JSON.stringify(input.shipping.destination || {}), now, now, input.environment,
        input.checkoutKey, hash, JSON.stringify(snapshot), input.expiresAt),
    env.DB.prepare(`INSERT INTO order_items (id, seller_id, order_id, product_id, product_type, title, sku, quantity,
      unit_price_amount, fulfillment_snapshot_json, created_at)
      SELECT json_extract(value, '$.id'), ?, ?, json_extract(value, '$.productId'), json_extract(value, '$.type'),
        json_extract(value, '$.title'), json_extract(value, '$.sku'), json_extract(value, '$.quantity'),
        json_extract(value, '$.price'), json_extract(value, '$.fulfillment'), ? FROM json_each(?)`)
      .bind(seller.id, orderId, now, JSON.stringify(items)),
    env.DB.prepare(`INSERT INTO inventory_reservations (id, seller_id, order_id, order_item_id, product_id, variant_id,
      quantity, unit_price_amount, state, created_at, updated_at)
      SELECT 'hold_' || id, seller_id, order_id, id, product_id, json_extract(fulfillment_snapshot_json, '$.variantId'),
        quantity, unit_price_amount, 'reserved', ?, ? FROM order_items WHERE order_id = ? AND seller_id = ?`)
      .bind(now, now, orderId, seller.id),
    env.DB.prepare(`INSERT INTO commerce_order_events (id, seller_id, order_id, event_key, event_type, payload_hash,
      previous_revision, data_json, created_at) VALUES (?, ?, ?, 'created', 'checkout.created', ?, 0, '{}', ?)`)
      .bind(`event_${crypto.randomUUID()}`, seller.id, orderId, hash, now),
    env.DB.prepare('UPDATE orders SET revision = 1 WHERE id = ? AND seller_id = ?').bind(orderId, seller.id),
    commerceJobStatement(env, {sellerId: seller.id, orderId, environment: input.environment,
      kind: 'payment.create', key: `payment.create:${orderId}`, data: {orderId, providerRequestId: crypto.randomUUID()}}, now),
  ];
  try { await env.DB.batch(statements); }
  catch (error) {
    const concurrent = await findExisting();
    if (concurrent) return replay(concurrent);
    databaseFailure(error);
  }
  return commerceOrder(env, seller.id, orderId, input.environment);
}

export async function applyCommerceEvent(env, orderId, input) {
  const environment = commerceEnvironment(env, input.environment);
  const sellerId = identifier(input.sellerId, 'Seller');
  const eventKey = text(input.eventKey, 160, 'Event key');
  const types = ['payment.created', 'payment.create_failed', 'payment.failed', 'payment.expired', 'payment.succeeded', 'checkout.cancelled'];
  if (!types.includes(input.type)) fail('Unsupported order event');
  const data = input.data || {};
  if (typeof data !== 'object' || Array.isArray(data) || JSON.stringify(data).length > 12000) fail('Invalid event details');
  const hash = await commerceHash({type: input.type, data, sellerId, environment});
  for (let attempt = 0; attempt < 4; attempt++) {
    const order = await commerceOrder(env, sellerId, orderId, environment);
    const previous = await env.DB.prepare('SELECT payload_hash FROM commerce_order_events WHERE order_id = ? AND event_key = ?').bind(orderId, eventKey).first();
    if (previous) {
      if (previous.payload_hash !== hash) fail('This event key was already used for different event details', 409);
      return commerceOrder(env, sellerId, orderId, environment);
    }
    const now = new Date().toISOString();
    const paid = ['paid', 'partially_refunded', 'refunded'].includes(order.state);
    let next = order.state, fulfillment = order.fulfillmentState, reservation = '', paidAt = order.paidAt, expiresAt = order.expiresAt;
    let paymentReview = order.paymentReview;
    const statements = [env.DB.prepare(`INSERT INTO commerce_order_events
      (id, seller_id, order_id, event_key, event_type, payload_hash, previous_revision, data_json, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`).bind(`event_${crypto.randomUUID()}`, sellerId, orderId, eventKey, input.type,
        hash, order.revision, JSON.stringify(data), now)];
    let session=null;
    if(input.type==='payment.created'){
      session=paymentSession(order,data);statements.push(...paymentSessionStatements(env,order,session,now));
    }
    if(input.type==='payment.create_failed'&&data.noEffectConfirmed!==true)fail('Confirm no provider payment was created before releasing this order',409);
    if (input.type === 'payment.succeeded') {
      if (data.verified !== true || data.provider !== 'doku' || data.currency !== 'IDR' || data.amount !== order.total) fail('The verified payment must match the order amount, currency and provider', 409);
      const reference = text(data.reference, 160, 'Payment reference');
      const binding=paymentAccountStatement(env,order,data,now);if(binding)statements.push(binding);
      const existingCapture = await env.DB.prepare('SELECT order_id, provider_reference FROM commerce_payment_captures WHERE order_id = ? OR (provider = ? AND commerce_environment = ? AND provider_reference = ?)')
        .bind(orderId, 'doku', environment, reference).all();
      if (existingCapture.results.some(row => row.order_id !== orderId)) fail('Payment reference is already associated with another order', 409);
      const alreadyRecorded = existingCapture.results.some(row => row.provider_reference === reference);
      if (!alreadyRecorded) {
        statements.push(env.DB.prepare(`INSERT INTO commerce_payment_captures
          (id, seller_id, order_id, provider, commerce_environment, provider_reference, amount, currency, capture_kind, verified_at)
          VALUES (?, ?, ?, 'doku', ?, ?, ?, 'IDR', ?, ?)`).bind(`capture_${crypto.randomUUID()}`, sellerId, orderId, environment, reference, order.total, paid ? 'duplicate_payment' : 'order_payment', now));
        if (paid) {
          paymentReview = true;
          statements.push(commerceJobStatement(env, {sellerId, orderId, environment, kind: 'notification.payment_review',
            key: `duplicate_payment:${reference}`, data: {orderId, reference, amount: order.total}}, now));
        }
      }
      if (!paid) {
        next = 'paid'; paidAt = now;
        // Expired/cancelled stock may already have been sold. Keep the payment
        // evidence and put fulfillment on hold; never silently oversell or lose
        // a customer's paid transaction by rejecting its notification.
        const holds = await env.DB.prepare("SELECT COUNT(*) AS count FROM inventory_reservations WHERE order_id = ? AND state = 'reserved'").bind(orderId).first();
        if (holds.count !== order.items.length) fulfillment = 'stock_review';
        else { reservation = 'committed'; fulfillment = order.snapshot.shipping.skipped ? 'not_required' : 'awaiting_acceptance'; }
      }
    } else if (!paid) {
      if (input.type === 'payment.created' && order.state === 'creating') {
        expiresAt=session.expiresAt;
        if(Date.parse(expiresAt)<=Date.now()){next='expired';reservation='released';}else next='pending';
      }
      if (input.type === 'payment.create_failed' && order.state === 'creating') { next = 'failed'; reservation = 'released'; }
      if (input.type === 'payment.expired' && ['creating', 'pending'].includes(order.state)) {
        if (data.verified !== true && Date.parse(order.expiresAt) > Date.now()) fail('This payment has not expired', 409);
        next = 'expired'; reservation = 'released';
      }
      if (input.type === 'checkout.cancelled' && ['creating', 'pending'].includes(order.state)) { next = 'cancelled'; reservation = 'released'; }
      // A failed attempt is recorded but does not prevent payment using another
      // method on the same still-valid provider session.
    }
    if (reservation) statements.push(env.DB.prepare("UPDATE inventory_reservations SET state = ?, updated_at = ? WHERE order_id = ? AND seller_id = ? AND state = 'reserved'").bind(reservation, now, orderId, sellerId));
    const normalized = ['paid', 'partially_refunded'].includes(next) ? 'paid' : next === 'cancelled' ? 'cancelled' : ['failed', 'expired'].includes(next) ? 'failed' : next === 'refunded' ? 'refunded' : 'pending';
    statements.push(env.DB.prepare(`UPDATE orders SET checkout_state = ?, status = ?, fulfillment_state = ?, payment_review = ?, paid_at = ?, expires_at = ?, revision = revision + 1, updated_at = ?
      WHERE id = ? AND seller_id = ? AND revision = ?`).bind(next, normalized, fulfillment, Number(paymentReview), paidAt, expiresAt, now, orderId, sellerId, order.revision));
    if (next !== order.state) statements.push(commerceJobStatement(env, {sellerId, orderId, environment,
      kind: 'notification.order_state', key: `order_state:${orderId}:${next}`, data: {orderId, state: next}}, now));
    if (next !== 'creating') statements.push(env.DB.prepare(`UPDATE commerce_jobs SET state = 'dead',
      last_error = 'Order no longer awaits payment creation', updated_at = ? WHERE order_id = ?
      AND kind = 'payment.create' AND state IN ('queued', 'retry')`).bind(now, orderId));
    try { await env.DB.batch(statements); return commerceOrder(env, sellerId, orderId, environment); }
    catch (error) {
      const failure = `${error?.message || ''} ${error?.cause?.message || ''}`;
      if (/commerce_revision_conflict|UNIQUE constraint failed/.test(failure) && attempt < 3) continue;
      databaseFailure(error);
    }
  }
}

export function commerceJobStatement(env, job, now = new Date().toISOString()) {
  return env.DB.prepare(`INSERT INTO commerce_jobs
    (id, seller_id, order_id, commerce_environment, job_key, kind, payload_json, available_at, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).bind(`job_${crypto.randomUUID().replaceAll('-', '')}`, job.sellerId,
      job.orderId || null, job.environment, job.key, job.kind, JSON.stringify(job.data), now, now, now);
}

// One bounded scheduled pass; ordinary reads never expire or change an order.
export async function expireCommerceOrders(env, limit = 50) {
  if (!commerceStorageEnabled(env)) return {expired: 0};
  const environment = commerceEnvironment(env, env.APP_ENVIRONMENT === 'test' ? 'sandbox' : 'production');
  const now = new Date().toISOString();
  // Set-based work keeps query count constant as the batch grows. The event
  // rows select and lock the eligible set in the same transaction that releases
  // inventory and queues notifications. A racing payment can never be expired.
  const prefix = `expire-${crypto.randomUUID()}:`, upper = prefix + '~';
  const selected = 'SELECT order_id FROM commerce_order_events WHERE id >= ? AND id < ?';
  const hash = await commerceHash({type: 'payment.expired', reason: 'payment_deadline', batch: prefix});
  const result = await env.DB.batch([
    env.DB.prepare(`INSERT INTO commerce_order_events
      (id, seller_id, order_id, event_key, event_type, payload_hash, previous_revision, data_json, created_at)
      SELECT ? || id, seller_id, id, 'expiry:' || expires_at, 'payment.expired', ?, revision,
        '{"reason":"payment_deadline"}', ? FROM orders WHERE commerce_version = 1 AND commerce_environment = ?
        AND checkout_state IN ('creating', 'pending') AND expires_at <= ? ORDER BY expires_at, id LIMIT ?`)
      .bind(prefix, hash, now, environment, now, Math.max(1, Math.min(500, limit))),
    env.DB.prepare(`UPDATE inventory_reservations SET state = 'released', updated_at = ?
      WHERE state = 'reserved' AND order_id IN (${selected})`).bind(now, prefix, upper),
    env.DB.prepare(`UPDATE orders SET checkout_state = 'expired', status = 'failed', revision = revision + 1,
      updated_at = ? WHERE id IN (${selected}) RETURNING id`).bind(now, prefix, upper),
    env.DB.prepare(`INSERT INTO commerce_jobs
      (id, seller_id, order_id, commerce_environment, job_key, kind, payload_json, available_at, created_at, updated_at)
      SELECT 'job_' || lower(hex(randomblob(16))), seller_id, id, commerce_environment, 'order_state:' || id || ':expired',
        'notification.order_state', json_object('orderId', id, 'state', 'expired'), ?, ?, ? FROM orders
      WHERE id IN (${selected})`).bind(now, now, now, prefix, upper),
    env.DB.prepare(`UPDATE commerce_jobs SET state = 'dead', last_error = 'Order no longer awaits payment creation',
      updated_at = ? WHERE kind = 'payment.create' AND state IN ('queued', 'retry') AND order_id IN (${selected})`)
      .bind(now, prefix, upper),
  ]);
  return {expired: result[2].results.length};
}

export async function commerceServiceRoute(request, env) {
  const payload = await authenticateCommerceService(request, env);
  const url = new URL(request.url);
  if (request.method === 'POST' && url.pathname === '/internal/commerce/orders') {
    return {order: await createCommerceOrder(env, payload)};
  }
  if(request.method==='POST'&&url.pathname==='/internal/commerce/checkouts/resume'){
    const environment=commerceEnvironment(env,payload.environment);
    if(typeof payload.checkoutKey!=='string'||!/^[A-Za-z0-9_-]{16,100}$/.test(payload.checkoutKey)||!/^[a-f0-9]{64}$/.test(payload.intentHash||''))fail('Checkout identity is invalid');
    const row=await env.DB.prepare('SELECT id,seller_id,snapshot_json FROM orders WHERE commerce_environment=? AND checkout_key=? AND commerce_version=1').bind(environment,payload.checkoutKey).first();
    if(!row)return {order:null};
    if(parse(row.snapshot_json).checkout?.intentHash!==payload.intentHash)fail('This checkout request changed. Recover the original payment before starting another one.',409);
    return {order:await commerceOrder(env,row.seller_id,row.id,environment)};
  }
  const match = /^\/internal\/commerce\/orders\/(EZK-[SP]-[A-F0-9]{24})(\/events)?$/.exec(url.pathname);
  if (match && !match[2] && request.method === 'GET') {
    const environment=commerceEnvironment(env,url.searchParams.get('environment'));
    const sellerId=url.searchParams.get('seller')||(await env.DB.prepare('SELECT seller_id FROM orders WHERE id=? AND commerce_environment=? AND commerce_version=1').bind(match[1],environment).first())?.seller_id;
    if(!sellerId)fail('Order not found',404);
    return {order: await commerceOrder(env, sellerId, match[1], environment)};
  }
  if (match && match[2] && request.method === 'POST') return {order: await applyCommerceEvent(env, match[1], payload)};
  fail('Commerce route not found', 404);
}
