import test from 'node:test';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {join,resolve} from 'node:path';
import {setupCentralFixture} from './central-fixture.mjs';
import {setupEarningsFixture,earningsPath} from '../../cloudflare/ezkart-api/test/earnings-fixture.mjs';
const root=resolve(import.meta.dirname,'../..');

test('private earnings reconciliation recovers a lost acknowledgement without duplicate entries or provider calls and rejects other deployments',async t=>{
  const bindings={APP_ENVIRONMENT:'beta',COMMERCE_PLATFORM_WALLET_SELLER:'seller_bob'};
  const base=await setupCentralFixture(t,{EZKART_DEPLOYMENT_ENVIRONMENT:'beta',EZKART_COMMERCE_ENVIRONMENT:'production',EZKART_CLOUDFLARE_API_URL:'https://ezkart-api-beta.fixture.workers.dev'},{bindings});
  const f=await setupEarningsFixture(t,{baseFixture:base,bindings}),p=await f.payment();await f.settle(p);await f.deliver(p);await f.collect(p,f.legs(p));
  const run=(changes={},overrides={})=>new Promise((resolve,reject)=>{
    const args=['reconcile-earnings.php',...Object.entries({environment:'production',seller:'seller_alice',order:p.order.id,limit:1,...changes}).map(([k,v])=>'--'+k+'='+v)];
    const code=`require ${JSON.stringify(join(root,'tools/checkout-test/provider-fixture.php'))}; $argv=json_decode(base64_decode('${Buffer.from(JSON.stringify(args)).toString('base64')}'),true); require ${JSON.stringify(join(root,'tools/commerce/reconcile-earnings.php'))};`;
    const proc=spawn(process.env.PHP_BINARY||'php',['-n','-r',code],{env:{...f.app.env,...overrides}});let output='',error='';
    proc.stdout.on('data',x=>output+=x);proc.stderr.on('data',x=>error+=x);proc.on('error',reject);proc.on('close',status=>resolve({status,output,error}));
  });
  f.control.drop=earningsPath+'/reconcile';const lost=await run();assert.equal(lost.status,1);assert.match(lost.error,/may have committed/);
  const held=await f.position(p);assert.equal(held.reconciled,true);assert.equal(held.state,'reserved');const originals=(await f.journals()).items;
  const retry=await run();assert.equal(retry.status,0,retry.error);assert.equal(JSON.parse(retry.output).recorded,0);assert.deepEqual((await f.journals()).items,originals);
  const calls=f.control.calls.length;
  for(const [changes,overrides] of [[{amount:250000},{}],[{environment:'sandbox'},{}],[{limit:101},{}],[{}, {EZKART_DEPLOYMENT_ENVIRONMENT:'production'}],[{}, {EZKART_CLOUDFLARE_API_URL:'https://ezkart-api-test.fixture.workers.dev'}]])assert.equal((await run(changes,overrides)).status,1);
  assert.equal(f.control.calls.length,calls);assert((await f.app.calls()).every(c=>!c.url.includes('doku.com')));
  assert(!/capture_|fobs_|fcol_|201000000|providerReference/.test(retry.output+retry.error));
  assert.equal((await fetch(f.app.base+'/tools/commerce/reconcile-earnings.php')).status,404);
});
