import test from 'node:test';
import assert from 'node:assert/strict';
import {setup} from './fixture.mjs';
import {setupCentralFixture} from './central-fixture.mjs';

const beta={EZKART_DEPLOYMENT_ENVIRONMENT:'beta',EZKART_COMMERCE_ENVIRONMENT:'production',EZKART_CLOUDFLARE_API_URL:'https://ezkart-api-beta.fixture.workers.dev'};
const phpString=value=>`base64_decode('${Buffer.from(value).toString('base64')}')`;

test('PHP beta data accepts only its own HTTPS origin and workbench request host',async t=>{
  const f=await setup(beta);t.after(()=>f.close());
  const check=(url,host='test.ezkart.id',deployment='beta',remote='127.0.0.1')=>JSON.parse(f.cli(`require_once ${phpString(new URL('../../cart/api/database.php',import.meta.url).pathname)};$_SERVER['HTTP_HOST']=${phpString(host)};$_SERVER['REMOTE_ADDR']=${phpString(remote)};try{echo json_encode(['ok'=>true,'database'=>ez_database_configuration()]);}catch(Throwable $e){echo json_encode(['ok'=>false]);}`,
    {EZKART_CLOUDFLARE_API_URL:url,EZKART_DEPLOYMENT_ENVIRONMENT:deployment}));
  for(const url of ['https://api-beta.ezkart.id','https://ezkart-api-beta.fixture.workers.dev/'])assert.equal(check(url).ok,true);
  for(const url of ['http://api-beta.ezkart.id','https://api-test.ezkart.id','https://api.ezkart.id','https://ezkart-api-test.fixture.workers.dev',
    'https://api-beta.ezkart.id.attacker.test','https://user:pass@api-beta.ezkart.id','https://api-beta.ezkart.id:443','https://api-beta.ezkart.id/path',
    'https://api-beta.ezkart.id/?q=private','https://api-beta.ezkart.id/#x'])assert.equal(check(url).ok,false,url);
  for(const host of ['ezkart.id','www.ezkart.id','attacker.test'])assert.equal(check(beta.EZKART_CLOUDFLARE_API_URL,host).ok,false);
  assert.equal(check(beta.EZKART_CLOUDFLARE_API_URL,'127.0.0.1:4173').ok,true);
  assert.equal(check(beta.EZKART_CLOUDFLARE_API_URL,'127.0.0.1:4173','beta','203.0.113.4').ok,false);
  for(const deployment of ['test','production','unknown'])assert.equal(check(beta.EZKART_CLOUDFLARE_API_URL,'test.ezkart.id',deployment).ok,false);
});

test('beta pins live providers, keeps order files separate and ignores the legacy workbench mode switch',async t=>{
  const f=await setup(beta);t.after(()=>f.close());
  const result=JSON.parse(f.cli(`require_once ${phpString(new URL('../../cart/api/executive-bridge.php',import.meta.url).pathname)};require_once ${phpString(new URL('../../cart/api/commerce-checkout.php',import.meta.url).pathname)};file_put_contents(ez_executive_directory().'/mode.json','{"mode":"sandbox"}');echo json_encode(['mode'=>ez_commerce_environment(),'central'=>ez_central_commerce_environment(),'url'=>ez_checkout_public_url(),'directory'=>ez_order_directory(null,false)]);`));
  assert.equal(result.mode,'production');assert.equal(result.central,'production');assert.equal(result.url,'https://test.ezkart.id');assert.equal(result.directory,f.directory+'/orders/beta/production');
  for(const code of ["ez_provider_config('doku','secret_key','sandbox')","ez_central_commerce_environment('sandbox')"]){
    assert.equal(f.cli(`require_once ${phpString(new URL('../../cart/api/commerce-checkout.php',import.meta.url).pathname)};try{${code};echo 'accepted';}catch(Throwable $e){echo 'rejected';}`),'rejected');
  }
  assert.equal(f.cli("try{ez_commerce_environment();echo 'accepted';}catch(Throwable $e){echo 'rejected';}",{EZKART_COMMERCE_ENVIRONMENT:'sandbox'}),'rejected');
  assert.equal(f.cli("try{ez_provider_config('doku','secret_key','sandbox');echo 'accepted';}catch(Throwable $e){echo 'rejected';}",{EZKART_DEPLOYMENT_ENVIRONMENT:'BETA'}),'rejected');
  assert.equal(f.cli("echo ez_order_directory('production',false);",{EZKART_DEPLOYMENT_ENVIRONMENT:'BETA'}),result.directory);
});

test('PHP beta signatures reach only the beta Worker and health requires the matching deployment',async t=>{
  const f=await setupCentralFixture(t,beta,{bindings:{APP_ENVIRONMENT:'beta'}});
  const health=await f.app.request('/cart/api/health.php');assert.equal(health.status,200);assert.equal(health.data.environment,'beta');assert.equal(health.data.database.connected,true);
  const created=await f.create(f.input());assert.equal(created.status,200,created.error);
  const path='/internal/commerce/orders/'+created.order.id+'?environment=production';
  const headers=JSON.parse(f.app.cli(`require_once ${phpString(new URL('../../cart/api/commerce-client.php',import.meta.url).pathname)};echo json_encode(ez_commerce_request_headers('GET',${phpString(path)},'','beta',ez_config('commerce_service_secret')));`));
  const headerObject=Object.fromEntries(headers.map(value=>{const at=value.indexOf(': ');return [value.slice(0,at),value.slice(at+2)];}));
  const read=await f.mf.dispatchFetch('https://fixture.test'+path,{headers:headerObject});assert.equal(read.status,200);assert.equal((await read.json()).order.id,created.order.id);
  const wrong=await setupCentralFixture(t,beta);const wrongHealth=await wrong.app.request('/cart/api/health.php');assert.equal(wrongHealth.data.database.configured,true);assert.equal(wrongHealth.data.database.connected,false);
});
