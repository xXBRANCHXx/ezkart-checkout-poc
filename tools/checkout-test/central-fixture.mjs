import {createServer} from 'node:http';
import {setup} from './fixture.mjs';
import {setupCommerceFixture, secret} from '../../cloudflare/ezkart-api/test/commerce-fixture.mjs';

export async function setupCentralFixture(t, overrides = {}) {
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
      let responseBody = Buffer.from(await response.arrayBuffer());
      if (control.afterResponse) await control.afterResponse(req.url);
      // Simulate an elapsed minute for the PHP status-check guard without rewriting immutable database snapshots.
      if (control.ageOrders && req.method === 'GET' && req.url.startsWith('/internal/commerce/orders/')) {
        const data = JSON.parse(responseBody.toString()); if (data.order) data.order.createdAt = new Date(Date.now() - 120000).toISOString(); responseBody = Buffer.from(JSON.stringify(data));
      }
      if (control.drop && req.url === control.drop) { control.drop = ''; res.writeHead(503); res.end('lost response'); return; }
      res.writeHead(response.status, {'content-type': response.headers.get('content-type') || 'application/json', 'cache-control': response.headers.get('cache-control') || 'no-store'}); res.end(responseBody);
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
