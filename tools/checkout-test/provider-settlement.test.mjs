import test from 'node:test';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {join,resolve} from 'node:path';
import {setupCentralFixture} from './central-fixture.mjs';
import {setupSettlementFixture,settlementPath} from '../../cloudflare/ezkart-api/test/settlement-fixture.mjs';

const root=resolve(import.meta.dirname,'../..');
async function fixture(t,{beta=false}={}){
  const bindings={COMMERCE_PLATFORM_WALLET_SELLER:'seller_bob',...(beta?{APP_ENVIRONMENT:'beta'}:{})};
  const base=await setupCentralFixture(t,beta?{EZKART_DEPLOYMENT_ENVIRONMENT:'beta',EZKART_COMMERCE_ENVIRONMENT:'production',EZKART_CLOUDFLARE_API_URL:'https://ezkart-api-beta.fixture.workers.dev'}:{},{bindings});
  const f=await setupSettlementFixture(t,{baseFixture:base,bindings});
  const run=(p,pair,changes={},overrides={})=>new Promise((resolve,reject)=>{
    const args=['reconcile-provider-settlement.php',...Object.entries({environment:f.environment,seller:'seller_alice',order:p.order.id,'seller-collection':pair.sellerCollectionId,'platform-collection':pair.platformCollectionId,...changes}).map(([k,v])=>'--'+k+'='+v)];
    const code=`require ${JSON.stringify(join(root,'tools/checkout-test/provider-fixture.php'))}; $argv=json_decode(base64_decode('${Buffer.from(JSON.stringify(args)).toString('base64')}'),true); require ${JSON.stringify(join(root,'tools/commerce/reconcile-provider-settlement.php'))};`;
    const proc=spawn(process.env.PHP_BINARY||'php',['-n','-r',code],{env:{...f.app.env,...overrides}});let output='',error='';
    proc.stdout.on('data',x=>output+=x);proc.stderr.on('data',x=>error+=x);proc.on('error',reject);proc.on('close',status=>resolve({status,output,error}));
  });
  return {...f,run};
}

test('private settlement command retries a lost storage acknowledgement without contacting DOKU or duplicating money',async t=>{
  const f=await fixture(t,{beta:true}),p=await f.payment(),pair=await f.collect(p,f.legs(p));f.control.drop=settlementPath+'/reconcile';
  const result=await f.run(p,pair);assert.equal(result.status,0,result.error+result.output);const report=JSON.parse(result.output);assert.equal(report.state,'settled');assert.equal(report.replayed,true);assert.equal(report.earningsReleased,false);assert.equal(report.availableToWithdraw,null);
  assert.equal((await f.journals()).items.length,2);const requests=f.control.calls.filter(c=>c.path===settlementPath+'/reconcile');assert.equal(requests.length,2);assert.deepEqual(requests[0].body,requests[1].body);
  assert((await f.app.calls()).every(c=>!c.url.includes('doku.com')));assert(!result.output.includes('2010000001'));assert(!result.output.includes('providerReference'));
  const calls=f.control.calls.length;
  for(const [changes,overrides] of [[{environment:'sandbox'},{}],[{}, {EZKART_DEPLOYMENT_ENVIRONMENT:'production'}],[{}, {EZKART_CLOUDFLARE_API_URL:'https://ezkart-api-test.fixture.workers.dev'}],[{fee:'0'},{}]])assert.equal((await f.run(p,pair,changes,overrides)).status,1);
  assert.equal(f.control.calls.length,calls);assert.equal((await fetch(f.app.base+'/tools/commerce/reconcile-provider-settlement.php')).status,404);
});

test('an unresolved provider collection exits for review and a storage outage preserves the original source IDs',async t=>{
  const f=await fixture(t),p=await f.payment(),rows=f.legs(p);rows.sellerPending=rows.sellerPending.filter(r=>r.transactionType!=='SETTLEMENT_FEE');
  const pair=await f.collect(p,rows),result=await f.run(p,pair);assert.equal(result.status,2,result.error);assert.equal(JSON.parse(result.output).state,'unresolved');assert.equal((await f.journals()).items.length,1);
  f.control.fail=settlementPath+'/reconcile';const failed=await f.run(p,pair);assert.equal(failed.status,1);assert.match(failed.error,/original collection IDs/);assert.equal((await f.journals()).items.length,1);
  const requests=f.control.calls.filter(c=>c.path===settlementPath+'/reconcile');assert.equal(requests.length,3);assert.deepEqual(requests[1].body,requests[2].body);
  assert((await f.app.calls()).every(c=>!c.url.includes('doku.com')));
});
