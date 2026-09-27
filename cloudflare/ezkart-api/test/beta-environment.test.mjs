import test from 'node:test';
import assert from 'node:assert/strict';
import {createHmac} from 'node:crypto';
import {deploymentProfile} from '../src/deployment.js';
import {commerceEnvironment} from '../src/commerce-orders.js';
import {campaignLinkUrl} from '../src/campaign-attribution.js';
import {prepareCampaignUnsubscribe} from '../src/campaign-unsubscribe.js';
import {campaignEmailConfiguration,campaignUnsubscribeHeaders,emailCredentialHash} from '../src/email-provider.js';
import {campaignEmailPayload} from '../src/campaign-email-template.js';
import {campaignMailConfiguration,campaignMailSource,campaignMailId} from './campaign-email-fixture.mjs';
import {setupCommerceFixture,secret,digest} from './commerce-fixture.mjs';

test('beta has a fixed live provider mode and a workbench origin, while unknown deployment names fail closed',()=>{
  for(const [name,mode,origin] of [['test','sandbox','https://test.ezkart.id'],['beta','production','https://test.ezkart.id'],['production','production','https://ezkart.id']]){
    const env={APP_ENVIRONMENT:name};assert.equal(commerceEnvironment(env,mode),mode);assert.equal(deploymentProfile(env).origin,origin);
    assert.throws(()=>commerceEnvironment(env,mode==='sandbox'?'production':'sandbox'),e=>e.status===403);
    assert.throws(()=>{deploymentProfile(env).origin='https://elsewhere.test';},TypeError);
  }
  for(const name of [undefined,'sandbox','Beta','constructor','__proto__',{}]){
    assert.equal(deploymentProfile({APP_ENVIRONMENT:name}),null);assert.throws(()=>commerceEnvironment({APP_ENVIRONMENT:name},'production'),e=>e.status===403);
  }
});

test('beta records live orders and captures, rejects sandbox payloads and signatures from either other deployment',async t=>{
  const f=await setupCommerceFixture(t,{bindings:{APP_ENVIRONMENT:'beta'}});
  const health=await (await f.mf.dispatchFetch('https://fixture.test/health')).json();assert.equal(health.environment,'beta');assert.equal(health.ok,true);
  const input=f.input(),created=await f.create(input);assert.equal(created.status,200,created.error);assert.equal(created.order.environment,'production');assert.match(created.order.id,/^EZK-P-/);
  assert.equal((await f.create({...input,environment:'sandbox'})).status,403);
  const path='/internal/commerce/orders/'+created.order.id+'?environment=production';
  for(const environment of ['test','production']){
    const headers=f.headers(path,'GET','');headers['x-ezkart-environment']=environment;
    const canonical=['v1',environment,'GET',path,headers['x-ezkart-timestamp'],headers['x-ezkart-request-id'],digest('')].join('\n');
    headers['x-ezkart-signature']=createHmac('sha256',secret).update(canonical).digest('hex');
    assert.equal((await f.mf.dispatchFetch('https://fixture.test'+path,{headers})).status,401);
  }
  assert.equal((await f.call(path)).status,200);
  assert.equal((await f.paid(created.order)).status,200);assert.equal((await f.paid(created.order)).status,200);
  const captures=await f.db.prepare('SELECT commerce_environment,amount FROM commerce_payment_captures').all();assert.deepEqual(captures.results,[{commerce_environment:'production',amount:58000}]);
  assert.equal(await f.stock(),8);
  const workspace=await f.merchant('/v1/commerce/marketing/workspace');assert.equal(workspace.status,200,workspace.error);assert.equal(workspace.shopUrl,'https://test.ezkart.id/shop/?store=seller_alice');
});

test('beta campaign, unsubscribe and email destinations stay on workbench and never relax destination validation',async()=>{
  const env={...campaignMailConfiguration(),APP_ENVIRONMENT:'beta'},configuration=campaignEmailConfiguration(env);
  assert.equal(configuration.ready,true);assert.equal(configuration.environment,'production');assert.equal(configuration.origin,'https://test.ezkart.id');
  const code='c'.repeat(64),url=campaignLinkUrl(env,code);assert.equal(url,'https://test.ezkart.id/cart/campaign.php?c='+code);
  let statement;
  const unsubscribe=await prepareCampaignUnsubscribe({...env,DB:{prepare(sql){return {bind(...args){statement={sql,args};return statement;}};}}},
    {sellerId:'seller_alice',authUserId:'buyer',email:'alice@example.test',reference:'fixture-mail',consentRevision:1});
  assert.match(unsubscribe.url,/^https:\/\/test\.ezkart\.id\/cart\/unsubscribe\.php\?t=[a-f0-9]{64}$/);assert.equal(statement.args[2],'production');
  const body=JSON.parse(campaignEmailPayload(configuration,campaignMailSource(),'alice@example.test',campaignMailId,unsubscribe.url,url));
  assert(!body.subject.startsWith('[Sandbox]'));assert(body.html.includes(url));assert(body.text.includes(unsubscribe.url));assert.equal(body.tags[0].value,'production');
  for(const bad of [unsubscribe.url.replace('test.ezkart.id','ezkart.id'),unsubscribe.url.replace('test.ezkart.id','test.ezkart.id.attacker.test'),unsubscribe.url+'#fragment']){
    assert.throws(()=>campaignUnsubscribeHeaders(configuration,bad),e=>e.code==='email_request_invalid');
  }
  assert.throws(()=>campaignUnsubscribeHeaders({...configuration,deployment:'production'},unsubscribe.url),e=>e.code==='email_request_invalid');
  assert.throws(()=>campaignUnsubscribeHeaders({},unsubscribe.url),e=>e.code==='email_request_invalid');
  assert.notEqual(await emailCredentialHash(env),await emailCredentialHash({...env,APP_ENVIRONMENT:'production'}));
});
