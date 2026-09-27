import {createServer} from 'node:http';
import {setup} from './fixture.mjs';
import {setupCommerceFixture, secret} from '../../cloudflare/ezkart-api/test/commerce-fixture.mjs';

export async function setupCentralFixture(t, overrides = {}, commerce = {}) {
  const f = await setupCommerceFixture(t,{notifications:overrides.EZKART_TEST_NOTIFICATIONS==='1'?'scheduled':'off',...commerce});
  const control = {drop: '', fail: '', calls: [], ageOrders: false};
  const relay = createServer(async (req, res) => {
    try {
      const chunks = []; for await (const chunk of req) chunks.push(chunk);
      const bytes = Buffer.concat(chunks), body = bytes.toString();
      control.calls.push({path: req.url, body: body ? (/^application\/json(?:;|$)/i.test(req.headers['content-type']||'') ? JSON.parse(body) : body) : null});
      if (control.fail && req.url === control.fail) { res.writeHead(503); res.end('{"ok":false}'); return; }
      const response = await f.mf.dispatchFetch('https://api.fixture.test' + req.url, {method: req.method, headers: req.headers,
        ...(bytes.length ? {body:bytes} : {})});
      let responseBody = Buffer.from(await response.arrayBuffer());
      if (control.afterResponse) await control.afterResponse(req.url);
      // Simulate an elapsed minute for the PHP status-check guard without rewriting immutable database snapshots.
      if (control.ageOrders && req.method === 'GET' && req.url.startsWith('/internal/commerce/orders/')) {
        const data = JSON.parse(responseBody.toString()); if (data.order) data.order.createdAt = new Date(Date.now() - 120000).toISOString(); responseBody = Buffer.from(JSON.stringify(data));
      }
      if (control.drop && req.url === control.drop) { control.drop = ''; res.writeHead(503); res.end('lost response'); return; }
      const responseHeaders={'content-type':response.headers.get('content-type')||'application/json','cache-control':response.headers.get('cache-control')||'no-store'};
      for(const name of ['x-ezkart-campaign-store','x-ezkart-campaign-environment','x-ezkart-file-part','x-ezkart-file-challenge','x-ezkart-file-sha256','content-disposition','content-length','content-range','accept-ranges'])if(response.headers.has(name))responseHeaders[name]=response.headers.get(name);
      if(req.method!=='HEAD'&&responseHeaders['content-length'])responseHeaders['content-length']=String(responseBody.length);
      res.writeHead(response.status,responseHeaders); res.end(responseBody);
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
