import test from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {createHash, createHmac} from 'node:crypto';
import {fileURLToPath} from 'node:url';

const php = process.env.PHP_BINARY || 'php';
const client = fileURLToPath(new URL('../../cart/api/commerce-client.php', import.meta.url));
const secret = 'fixture-commerce-signing-key-never-used-remotely';
function run(source) {
  const process = spawnSync(php, ['-r', `require ${JSON.stringify(client)}; ${source}`], {encoding: 'utf8'});
  assert.equal(process.status, 0, process.stderr);
  return process.stdout;
}

test('PHP and Worker signing agree on UTF-8 payloads and exact path/query bytes', () => {
  for (const [method, target, body] of [
    ['POST', '/internal/commerce/orders', JSON.stringify({customer: {name: 'Pelanggan ☕'}, amount: 40000})],
    ['GET', '/internal/commerce/orders/EZK-S-AAAAAAAAAAAAAAAAAAAAAAAA?environment=sandbox&seller=seller_alice', ''],
  ]) {
    const timestamp = 1790290000, nonce = 'a'.repeat(32);
    const encode = value => Buffer.from(value).toString('base64');
    const headers = JSON.parse(run(`echo json_encode(ez_commerce_request_headers('${method}', base64_decode('${encode(target)}'), base64_decode('${encode(body)}'), 'test', '${secret}', ${timestamp}, '${nonce}'));`));
    const canonical = ['v1', 'test', method, target, String(timestamp), nonce, createHash('sha256').update(body).digest('hex')].join('\n');
    assert(headers.includes('X-Ezkart-Signature: ' + createHmac('sha256', secret).update(canonical).digest('hex')));
    assert(headers.includes('X-Ezkart-Environment: test'));
  }
});

test('commerce signing rejects secret leakage through malformed targets and unsupported methods', () => {
  for (const [method, target, key] of [
    ['POST', 'https://other.test/internal/commerce/orders', secret],
    ['POST', '/internal/commerce/orders\r\nX-Injected: yes', secret],
    ['POST', '/v1/catalog', secret],
    ['DELETE', '/internal/commerce/orders', secret],
    ['POST', '/internal/commerce/orders', 'short'],
  ]) {
    const encoded = Buffer.from(target).toString('base64');
    assert.equal(run(`try { ez_commerce_request_headers('${method}', base64_decode('${encoded}'), '{}', 'test', '${key}'); echo 'accepted'; } catch (InvalidArgumentException $error) { echo 'rejected'; }`), 'rejected');
  }
});
