import {readFile} from 'node:fs/promises';
import {createHash, createHmac, randomBytes} from 'node:crypto';
import {build} from 'esbuild';
import {Miniflare, convertV4MiniflareOptions} from 'miniflare';

export const secret = 'commerce-service-fixture-secret-only-not-a-real-key';
export const customer = {name: 'Order Tester', email: 'orders@example.test', phone: '081234567890'};
export const digest = value => createHash('sha256').update(value).digest('hex');
export const shippingAddress={id:'addr_'+'a'.repeat(32),label:'Main warehouse',name:'Original Warehouse',phone:'081234567891',email:'',organization:'',address:'Jalan Saved Warehouse 18',location:'Jakarta',postalCode:'54321',note:''};
export const shippingConfiguration={addresses:[shippingAddress],pickupAddressId:shippingAddress.id,returnAddressId:shippingAddress.id,couriers:['jne','sicepat','jnt']};
export const fixtureShipping={amount:18000,skipped:false,courierCode:'jne',serviceCode:'reg',settingsRevision:1,pickupAddressId:shippingAddress.id,returnAddressId:shippingAddress.id,returnAddress:shippingAddress,
  origin:{origin_contact_name:shippingAddress.name,origin_contact_phone:shippingAddress.phone,origin_contact_email:'',origin_address:shippingAddress.address+', '+shippingAddress.location,origin_postal_code:shippingAddress.postalCode,origin_note:'',shipper_organization:''},
  destination:{location:'Jakarta',address:'Jalan Saved Destination 12',postalCode:'12345',coordinate:{latitude:-6.2,longitude:106.8}},quote:{courier:'JNE',service:'Regular',courier_company:'jne',courier_type:'reg',price:18000}};

export async function setupCommerceFixture(t) {
  const key = await crypto.subtle.generateKey({name: 'ECDSA', namedCurve: 'P-256'}, true, ['sign', 'verify']);
  const publicKey = {...await crypto.subtle.exportKey('jwk', key.publicKey), kid: 'catalog-fixture', alg: 'ES256'};
  const bundle = await build({entryPoints: [new URL('../src/index.js', import.meta.url).pathname], bundle: true, write: false, format: 'esm', platform: 'neutral'});
  const mf = new Miniflare(convertV4MiniflareOptions({modules: true, script: bundle.outputFiles[0].text,
    compatibilityDate: '2026-08-11', d1Databases: ['DB'], r2Buckets: ['PUBLIC_ASSETS', 'PRIVATE_ASSETS'],
    bindings: {APP_ENVIRONMENT: 'test', COMMERCE_STORAGE: 'd1', COMMERCE_SERVICE_SECRET: secret, SUPABASE_URL: 'https://auth.fixture.test'},
    outboundService: async () => Response.json({keys: [publicKey]})}));
  t.after(() => mf.dispose());
  const db = await mf.getD1Database('DB');
  for (const name of ['0001_core.sql', '0002_cloud_catalog.sql', '0003_subscription_plan_billing.sql', '0004_yearly_subscription_plans.sql', '0008_seller_page_addresses.sql', '0009_commerce_orders.sql', '0010_catalog_revisions.sql','0011_inventory_adjustments.sql','0012_stock_review_recovery.sql','0013_returns_and_inspection.sql','0014_checkout_payment_sessions.sql','0015_central_fulfillment.sql','0016_seller_shipping_settings.sql','0018_commerce_order_reads.sql','0019_analytics_exports.sql','0020_customer_workspace.sql','0021_customer_consents.sql']) {
    const source = (await readFile(new URL('../migrations/' + name, import.meta.url), 'utf8')).replace(/--[^\n]*/g, '');
    const triggers = [...source.matchAll(/CREATE TRIGGER[\s\S]*?END;/g)].map(match => match[0]);
    for (const statement of [...source.replace(/CREATE TRIGGER[\s\S]*?END;/g, '').split(';').filter(value => value.trim()), ...triggers]) await db.prepare(statement).run();
  }
  for (const seller of ['alice', 'bob']) {
    await db.prepare("INSERT INTO sellers(id,slug,name,created_at,updated_at) VALUES (?,?,?,'now','now')").bind('seller_' + seller, seller, seller).run();
    await db.prepare("INSERT INTO app_users(id,auth_user_id,created_at,updated_at) VALUES (?,?,'now','now')").bind(seller, seller).run();
    await db.prepare("INSERT INTO seller_memberships(seller_id,auth_user_id,role,created_at) VALUES (?,?,'owner','now')").bind('seller_' + seller, seller).run();
  }
  async function merchantToken(seller='alice',email) {
    const head = Buffer.from(JSON.stringify({alg: 'ES256', kid: publicKey.kid})).toString('base64url');
    const claims = Buffer.from(JSON.stringify({iss: 'https://auth.fixture.test/auth/v1', sub: seller, email, aud: 'authenticated', exp: Math.floor(Date.now() / 1000) + 3600})).toString('base64url');
    const sig = await crypto.subtle.sign({name: 'ECDSA', hash: 'SHA-256'}, key.privateKey, new TextEncoder().encode(`${head}.${claims}`));
    return `${head}.${claims}.${Buffer.from(sig).toString('base64url')}`;
  }
  async function merchant(path, input, {seller = 'alice', email, method = input === undefined ? 'GET' : 'PUT'} = {}) {
    const response = await mf.dispatchFetch('https://api.fixture.test' + path, {method,
      headers: {authorization: `Bearer ${await merchantToken(seller,email)}`, 'content-type': 'application/json'},
      ...(input !== undefined ? {body: JSON.stringify(input)} : {})});
    return {status: response.status, ...await response.json()};
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
      customer, items: [{productId: 'tea', quantity: 2, expectedPrice: 20000,expectedWeightGrams:100}],
      checkout:{intentHash:digest('fixture intent'),paymentFlow:'direct_bca',shop:'alice-shop'},
      shipping: {amount: 0, skipped: true}, expiresAt: new Date(Date.now() + 3600000).toISOString(), ...overrides};
  }
  const create = input => call('/internal/commerce/orders', input);
  const event = (order, type, data = {}, key = randomBytes(16).toString('hex')) => call(`/internal/commerce/orders/${order.id}/events`, {environment: 'sandbox', sellerId: order.sellerId, eventKey: key, type, data});
  const paid = (order, data = {}, key) => event(order, 'payment.succeeded', {provider: 'doku', verified: true, amount: order.total, currency: 'IDR', reference: 'payment-' + order.id, originalRequestId:order.paymentRequestId, channel:'VIRTUAL_ACCOUNT_BCA',accountNumber:'770011223344',...data}, key);
  const session=(order,data={})=>({provider:'doku',providerRequestId:order.paymentRequestId,amount:order.total,currency:'IDR',expiresAt:order.expiresAt,method:'VIRTUAL_ACCOUNT_BCA',accountNumber:'770011223344',...data});
  const stock = async (id = 'tea') => (await db.prepare('SELECT stock_quantity FROM products WHERE id = ?').bind(id).first()).stock_quantity;
  const shippingSetup=await merchant('/v1/shipping-settings',{revision:0,requestKey:randomBytes(16).toString('hex'),configuration:shippingConfiguration});
  if(shippingSetup.status!==200)throw Error('Fixture shipping setup failed: '+JSON.stringify(shippingSetup));
  return {mf, db, headers, call, product, input, create, event, paid, session, stock, merchant,merchantToken};
}
