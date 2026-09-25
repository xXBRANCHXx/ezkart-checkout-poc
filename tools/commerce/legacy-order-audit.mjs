import {createHash} from 'node:crypto';

export const sha256 = value => createHash('sha256').update(value).digest('hex');
const canonical = value => Array.isArray(value) ? value.map(canonical) : value && typeof value === 'object'
  ? Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])])) : value;
export const stableJson = value => JSON.stringify(canonical(value));
const fail = message => { throw new Error(message); };
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const id = value => typeof value === 'string' && /^[A-Za-z0-9][A-Za-z0-9_-]{2,95}$/.test(value);
const text = (value, name, maximum = 200, optional = false) => {
  if (optional && value === undefined) return '';
  if (typeof value !== 'string' || value.length > maximum || /[\u0000-\u001f]/.test(value)) fail(`${name} is invalid`);
  return value;
};
const amount = (value, name) => {
  if (!Number.isSafeInteger(value) || value < 0 || value > 1_000_000_000_000) fail(`${name} must be an exact nonnegative rupiah amount`);
  return value;
};
const date = (value, name, optional = false) => {
  if (optional && (value === undefined || value === '')) return '';
  if (typeof value !== 'string' || !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{1,3})?(?:Z|[+-]\d\d:\d\d)$/.test(value) || !Number.isFinite(Date.parse(value))) fail(`${name} must include a valid timestamp and timezone`);
  if (new Date(value.slice(0,10)+'T00:00:00Z').toISOString().slice(0,10)!==value.slice(0,10)
    || Number(value.slice(11,13))>23 || Number(value.slice(14,16))>59 || Number(value.slice(17,19))>59) fail(`${name} has an invalid calendar date or time`);
  return value;
};

// JSON.parse silently discards duplicate keys, including conflicting amounts.
// Check the original text before parsing; retain that text unchanged as evidence.
export function strictJson(source) {
  if (typeof source !== 'string' || Buffer.byteLength(source) > 1_000_000) fail('Source JSON is too large');
  let result;
  try { result = JSON.parse(source); } catch { fail('Source JSON is invalid'); }
  let cursor = 0;
  const space = () => { while (/\s/.test(source[cursor] || '') && cursor < source.length) cursor++; };
  const string = () => {
    const start = cursor++;
    while (cursor < source.length) {
      if (source[cursor++] === '"') return JSON.parse(source.slice(start, cursor));
      if (source[cursor - 1] === '\\') cursor++;
    }
    fail('Source JSON string is invalid');
  };
  const value = (depth = 0) => {
    if (depth > 40) fail('Source JSON nesting is too deep');
    space();
    if (source[cursor] === '{') {
      cursor++; space(); const keys = new Set();
      if (source[cursor] === '}') { cursor++; return; }
      while (cursor < source.length) {
        space(); const key = string();
        if (keys.has(key)) fail('Source JSON contains duplicate object keys');
        keys.add(key); space(); cursor++; value(depth + 1); space();
        if (source[cursor++] === '}') return;
      }
    } else if (source[cursor] === '[') {
      cursor++; space();
      if (source[cursor] === ']') { cursor++; return; }
      while (cursor < source.length) { value(depth + 1); space(); if (source[cursor++] === ']') return; }
    } else if (source[cursor] === '"') string();
    else while (cursor < source.length && !/[\s,}\]]/.test(source[cursor])) cursor++;
  };
  value(); return result;
}

function parseEntry(entry) {
  if (!object(entry) || !/^[a-f0-9]{64}\.json$/.test(entry.filename || '')) fail('Order source filename is invalid');
  const order = strictJson(entry.source);
  if (!object(order) || !/^EZK-[A-Z0-9-]{8,70}$/.test(order.order_id || '')) fail('Stored order reference is invalid');
  if (entry.filename !== sha256(order.order_id) + '.json') fail('Filename does not match its stored order reference');
  if (order.order_id.startsWith('EZK-P-') || order.commerce_environment !== 'sandbox') fail('Only explicitly identified sandbox orders may enter this TEST rehearsal');
  const subtotal = amount(order.subtotal, 'Subtotal'), shipping = amount(order.shipping_price, 'Shipping'), total = amount(order.total, 'Total');
  if (subtotal + shipping !== total) fail('Order total does not equal subtotal plus shipping');
  if (!Array.isArray(order.items) || !order.items.length || order.items.length > 200) fail('Order items are invalid');
  let productTotal = 0, shippingLines = 0;
  const items = [];
  for (const [line, item] of order.items.entries()) {
    if (!object(item) || !text(item.id, 'Item SKU') || !text(item.name, 'Item name', 500)) fail('Item identity is missing');
    const price = amount(item.price, 'Item price');
    if (!Number.isSafeInteger(item.quantity) || item.quantity < 1 || item.quantity > 10000) fail('Item quantity is invalid');
    if (item.id === 'EZK-SHIPPING') {
      if (++shippingLines > 1 || item.quantity !== 1 || price !== shipping) fail('Shipping line does not match its order');
    } else {
      productTotal = amount(productTotal + price * item.quantity, 'Item subtotal');
      items.push({line, sku: item.id, quantity: item.quantity, price});
    }
  }
  if (!items.length || productTotal !== subtotal) fail('Item subtotal does not match its order');
  if (!['CREATING','PENDING','PAID','FAILED','EXPIRED','CANCELLED','PARTIALLY_REFUNDED','REFUNDED'].includes(order.status)) fail('Stored order status is unsupported');
  const created = date(order.created_at, 'Created time'), updated = date(order.updated_at, 'Updated time');
  if (Date.parse(updated) < Date.parse(created)) fail('Order update predates creation');
  date(order.paid_at, 'Paid time', true);
  // Early hosted DOKU responses stored YYYYMMDDhhmmss without a timezone.
  // Preserve them as reported evidence; never invent an expiry instant.
  text(order.payment_expires_at, 'Payment expiry', 100, true);
  if (!object(order.customer)) fail('Customer snapshot is missing');
  for (const key of ['name','email','phone']) text(order.customer[key], 'Customer ' + key, 300);
  if (order.customer_auth_user_id && !id(order.customer_auth_user_id)) fail('Stored customer account is invalid');
  if (order.seller_id && order.seller_id !== 'demo' && !id(order.seller_id)) fail('Stored seller identity is invalid');
  text(order.shop, 'Shop reference', 100, true);
  if (!['doku','midtrans'].includes(order.payment_provider)) fail('Stored payment provider is unsupported');
  for (const key of ['payment_reference','payment_request_id','payment_notification_id','midtrans_transaction_id']) text(order[key], key, 200, true);
  if (typeof order.shipping_skipped !== 'boolean' || (order.shipping_skipped && shipping !== 0)) fail('Stored shipping selection is invalid');
  return {filename:entry.filename, source:entry.source, sourceHash:sha256(entry.source), order, items};
}

export function validateRegistry(registry) {
  if (!object(registry) || registry.deployment !== 'test' || registry.environment !== 'sandbox'
    || !Array.isArray(registry.sellers) || !Array.isArray(registry.memberships) || !Array.isArray(registry.products) || !Array.isArray(registry.variants)) fail('A TEST ownership registry is required');
  if (new Set(registry.sellers.map(s => s.id)).size !== registry.sellers.length) fail('Duplicate registry seller');
  for (const seller of registry.sellers) if (!id(seller.id)) fail('Invalid registry seller');
  for (const member of registry.memberships) if (!id(member.seller_id) || !id(member.auth_user_id) || !['owner','admin','editor','viewer'].includes(member.role) || typeof member.created_at!=='string') fail('Invalid registry membership');
  for (const product of registry.products) if (!id(product.id) || !id(product.seller_id)) fail('Invalid registry product');
  for (const variant of registry.variants) if (!id(variant.id) || !id(variant.product_id) || !id(variant.seller_id)) fail('Invalid registry variant');
}

function itemLinks(record, sellerId, registry) {
  return record.items.map(item => {
    const snapshot = record.order.product_snapshots?.[item.sku];
    const products = registry.products.filter(p => p.seller_id === sellerId);
    let matches;
    if (snapshot?.product_id) {
      const product = products.find(p => p.id === snapshot.product_id);
      const variant = snapshot.variant_id ? registry.variants.find(v => v.id === snapshot.variant_id && v.product_id === product?.id && v.seller_id === sellerId) : null;
      // A stored identity never silently falls back to a reused current SKU.
      matches = product && (!snapshot.variant_id || variant) ? [{productId:product.id, variantId:variant?.id || '', basis:'stored_identity'}] : [];
    } else {
      matches = [
        ...products.filter(p => p.sku === item.sku && !registry.variants.some(v => v.product_id === p.id)).map(p => ({productId:p.id, variantId:'', basis:'unique_sku'})),
        ...registry.variants.filter(v => v.seller_id === sellerId && v.sku === item.sku && products.some(p => p.id === v.product_id)).map(v => ({productId:v.product_id, variantId:v.id, basis:'unique_sku'})),
      ];
    }
    return {line:item.line, sku:item.sku, ...(matches.length === 1 ? matches[0] : {productId:'',variantId:'',basis:matches.length ? 'ambiguous' : 'missing'})};
  });
}

function assessment(record, records, registry) {
  const order = record.order, storedSeller = order.seller_id || '';
  let sellerId = '', disposition = 'unresolved', basis = 'unresolved', evidence = {};
  const issues = [];
  if (storedSeller && storedSeller !== 'demo') {
    if (registry.sellers.some(s => s.id === storedSeller)) { sellerId = storedSeller; disposition = 'seller'; basis = 'stored_seller'; }
    else issues.push('stored_seller_missing');
  } else if (order.shop === 'ezkart-demo' && record.items.every(i => ['EZK-DEMO-GRANOLA','EZK-DEMO-COFFEE','EZK-DEMO-SAMBAL'].includes(i.sku))) {
    disposition = 'demo'; basis = 'sandbox_demo';
  } else if (storedSeller !== 'demo' && order.shop) {
    // Current SKU ownership alone cannot assign a historical customer. Require
    // a matching stored seller in this source set, its still-current owner scope,
    // and unambiguous products belonging to that same seller.
    const anchors = records.filter(r => r.order.shop === order.shop && r.order.seller_id && r.order.seller_id !== 'demo');
    const sellerIds = [...new Set(anchors.map(r => r.order.seller_id))];
    if (sellerIds.length === 1 && registry.sellers.some(s => s.id === sellerIds[0])) {
      const candidate = sellerIds[0];
      const members = registry.memberships.filter(m => m.seller_id === candidate && m.role === 'owner')
        .sort((a,b) => a.created_at.localeCompare(b.created_at) || a.auth_user_id.localeCompare(b.auth_user_id));
      const owner = members[0], links = itemLinks(record, candidate, registry);
      const unambiguous = links.every(i => i.productId && (i.basis !== 'unique_sku'
        || registry.products.filter(p => p.sku===i.sku && !registry.variants.some(v=>v.product_id===p.id)).length
          + registry.variants.filter(v=>v.sku===i.sku).length === 1));
      if (owner && sha256('test|' + owner.auth_user_id).slice(0,24) === order.shop && unambiguous) {
        sellerId = candidate; disposition = 'seller'; basis = 'historical_shop';
        evidence = {anchorSourceHash:anchors.sort((a,b) => a.sourceHash.localeCompare(b.sourceHash))[0].sourceHash,
          authUserId:owner.auth_user_id, membershipCreatedAt:owner.created_at, shop:order.shop};
      }
    }
  }
  if (disposition === 'unresolved') issues.push('seller_unresolved');
  const links = sellerId ? itemLinks(record, sellerId, registry) : [];
  if (links.some(i => !i.productId)) issues.push('historical_product_unlinked');
  if (!order.customer_auth_user_id) issues.push('customer_account_not_recorded');
  if (['PAID','PARTIALLY_REFUNDED','REFUNDED'].includes(order.status)) issues.push('historical_payment_requires_reconciliation');
  if (order.status === 'PAID' && !order.paid_at) issues.push('paid_timestamp_not_recorded');
  if (['CREATING','PENDING'].includes(order.status) && !order.payment_expires_at) issues.push('payment_expiry_not_recorded');
  if (order.payment_expires_at) {
    try { date(order.payment_expires_at, 'Payment expiry'); }
    catch { issues.push(/^\d{14}$/.test(order.payment_expires_at) ? 'payment_expiry_timezone_unrecorded' : 'payment_expiry_unparsed'); }
  }
  if (!order.payment_flow) issues.push('payment_flow_not_recorded');
  if (order.shipping_skipped && order.biteship_order_id) issues.push('skipped_shipping_has_booking');
  return {orderId:order.order_id, disposition, sellerId, basis, evidence, itemLinks:links, issues:issues.sort(),
    status:order.status, subtotal:order.subtotal, shipping:order.shipping_price, total:order.total,
    customerAccountRecorded:Boolean(order.customer_auth_user_id), paymentProvider:order.payment_provider,
    paymentReferenceHash:order.payment_reference ? sha256(order.payment_provider + '|sandbox|' + order.payment_reference) : '',
    paymentRequestHash:order.payment_request_id ? sha256(order.payment_provider + '|sandbox|' + order.payment_request_id) : ''};
}

export function buildLegacyPlan(source, registry) {
  validateRegistry(registry);
  if (!object(source) || source.format !== 'ezkart-private-legacy-source-v1' || source.deployment !== 'test' || source.environment !== 'sandbox'
    || !Array.isArray(source.entries) || !source.entries.length || source.entries.length > 250
    || !/^[A-Za-z0-9][A-Za-z0-9_.-]{0,99}$/.test(source.sourceDirectory || '')) fail('A bounded private TEST source export is required');
  const records = source.entries.map(entry => {
    try { return parseEntry(entry); } catch (error) { fail(`${entry.filename || 'Unknown file'}: ${error.message}`); }
  }).sort((a,b) => a.order.order_id.localeCompare(b.order.order_id));
  if (new Set(records.map(r => r.order.order_id)).size !== records.length) fail('Duplicate order reference in source export');
  for (const field of ['payment_request_id','payment_reference','midtrans_transaction_id']) {
    const seen = new Set();
    for (const {order} of records) if (order[field]) {
      const key = order.payment_provider + '|' + order[field];
      if (seen.has(key)) fail(`Duplicate provider ${field} across orders`);
      seen.add(key);
    }
  }
  const entries = records.map(record => ({filename:record.filename, source:record.source, sourceHash:record.sourceHash,
    sourceId:'source_' + sha256('sandbox|' + record.order.order_id + '|' + record.sourceHash), assessment:assessment(record, records, registry)}));
  const summary = {orders:entries.length, subtotal:0, shipping:0, total:0, paidOrders:0, paidTotal:0,
    sellerOrders:0, demoOrders:0, unresolvedOrders:0, customerAccountsRecorded:0, providerReferences:0, providerRequests:0,
    owners:{}, statuses:{}, issues:{}};
  for (const {assessment:a} of entries) {
    for (const key of ['subtotal','shipping','total']) summary[key] = amount(summary[key] + a[key], 'Summary ' + key);
    if (a.status === 'PAID') { summary.paidOrders++; summary.paidTotal = amount(summary.paidTotal + a.total, 'Paid total'); }
    summary[a.disposition + 'Orders']++;
    summary.customerAccountsRecorded += Number(a.customerAccountRecorded);
    summary.providerReferences += Number(Boolean(a.paymentReferenceHash)); summary.providerRequests += Number(Boolean(a.paymentRequestHash));
    const owner = a.sellerId || a.disposition;
    summary.owners[owner] = (summary.owners[owner] || 0) + 1;
    summary.statuses[a.status] = (summary.statuses[a.status] || 0) + 1;
    for (const issue of a.issues) summary.issues[issue] = (summary.issues[issue] || 0) + 1;
  }
  const manifest = {schema:1, deployment:'test', environment:'sandbox', sourceDirectory:source.sourceDirectory, records:entries, summary};
  const json = stableJson(manifest);
  if (Buffer.byteLength(json) > 400_000) fail('Import batch exceeds 400 KB; split the private source export into reviewed batches');
  const hash = sha256(json);
  return {id:'legacy_' + hash, hash, manifest};
}

export function sourceFromPlan(plan) {
  return {format:'ezkart-private-legacy-source-v1', deployment:plan.manifest.deployment, environment:plan.manifest.environment,
    sourceDirectory:plan.manifest.sourceDirectory, entries:plan.manifest.records.map(r => ({filename:r.filename,source:r.source}))};
}

export function legacyImportStatement(plan, importedAt = new Date().toISOString()) {
  if (plan.hash !== sha256(stableJson(plan.manifest)) || plan.id !== 'legacy_' + plan.hash) fail('Import manifest digest does not match');
  date(importedAt, 'Import time');
  return {sql:'INSERT INTO commerce_legacy_import_batches (id,manifest_hash,manifest_json,created_at) VALUES (?,?,?,?) ON CONFLICT(id) DO NOTHING',
    params:[plan.id,plan.hash,stableJson(plan.manifest),importedAt]};
}

export function legacyImportSql(plan, importedAt) {
  const statement = legacyImportStatement(plan, importedAt);
  let index = 0;
  const sql = statement.sql.replace(/\?/g, () => "'" + statement.params[index++].replaceAll("'", "''") + "'") + ';\n';
  // D1 limits each SQL statement to 100,000 bytes, including escaped literals:
  // https://developers.cloudflare.com/d1/platform/limits/
  if (Buffer.byteLength(sql)>100_000) fail('Import SQL exceeds 100 KB; split into reviewed batches while retaining any required ownership anchors');
  return sql;
}
