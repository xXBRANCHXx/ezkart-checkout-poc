import test from 'node:test';
import assert from 'node:assert/strict';
import {setupCentralFixture} from './central-fixture.mjs';
import {browser,pageFor} from './review-workspace-fixture.mjs';
import {campaignMailConfiguration} from '../../cloudflare/ezkart-api/test/campaign-email-fixture.mjs';
import {publicationFixtureOn,publicationKey} from '../../cloudflare/ezkart-api/test/campaign-publication-fixture.mjs';
const url=path=>'/cart/admin/?cloud='+encodeURIComponent(path);
async function fixture(t){
  const bindings=campaignMailConfiguration(),base=await setupCentralFixture(t,{}, {bindings}),f=await publicationFixtureOn(base,bindings);
  const cookie=f.app.adminCookie({supabase_access_token:await f.merchantToken('alice','alice@example.test'),admin_user:{id:'alice',email:'alice@example.test'}}),b=await browser(t),p=await pageFor(b,{...f,cookie},390);
  await p.goto(f.app.base+'/cart/admin/?page=marketing');await p.getByText('Drafts and your planning calendar are ready.',{exact:true}).waitFor();
  const headers=await p.evaluate(()=>({'X-Ezkart-CSRF':document.body.dataset.adminCsrfToken,'X-Ezkart-Marketing-Account':document.body.dataset.adminReviewAccount,'X-Ezkart-Marketing-Store':document.querySelector('[data-marketing]').dataset.store}));
  headers.Cookie='ezkart_admin='+cookie.value;headers.Origin=f.app.base;
  return {...f,cookie,p,headers,proxy:(path,body,extra={})=>f.app.request(url(path),body,{...headers,...extra})};
}

test('the real private PHP proxy preserves publication and schedule/cancel intents after lost acknowledgements and serves the frozen audience/history',async t=>{
  const f=await fixture(t);await f.addBuyer(1);assert.equal((await f.proxy(f.path+'/publication')).data.publication,null);
  const input=f.intent();f.control.drop=f.path+'/publish';assert.equal((await f.proxy(f.path+'/publish',input)).status,503);assert.equal(await f.count('commerce_campaign_publications'),1);
  await f.p.reload();await f.p.getByText('Drafts and your planning calendar are ready.',{exact:true}).waitFor();
  const replay=await f.proxy(f.path+'/publish',input);assert.equal(replay.status,200,JSON.stringify(replay));assert.equal(replay.data.receipt.replayed,true);assert.equal(await f.count('commerce_campaign_publications'),1);
  const action={kind:'reschedule',revision:0,requestKey:publicationKey(),scheduledAt:new Date(Date.now()+3600000).toISOString()};f.control.drop=f.path+'/publication-action';assert.equal((await f.proxy(f.path+'/publication-action',action)).status,503);
  const retried=await f.proxy(f.path+'/publication-action',action);assert.equal(retried.status,200);assert.equal(retried.data.receipt.replayed,true);assert.equal(retried.data.publication.scheduledAt,action.scheduledAt);
  const cancel={kind:'cancel',revision:1,requestKey:publicationKey(),scheduledAt:null};assert.equal((await f.proxy(f.path+'/publication-action',cancel)).status,200);
  const recipients=await f.proxy(f.path+'/recipients'),history=await f.proxy(f.path+'/publication-history');assert.equal(recipients.status,200);assert.equal(recipients.data.items[0].state,'cancelled');assert.deepEqual(history.data.items.map(r=>r.kind),['cancel','reschedule','publish']);
  assert.equal(await f.count('commerce_unsubscribe_tokens'),0);assert.equal(await f.count('commerce_email_requests'),0);
});

test('publication proxy routes require the current account/store/CSRF, valid methods, strict parameters and bounded JSON',async t=>{
  const f=await fixture(t);await f.addBuyer(1);const input=f.intent();
  assert.equal((await f.proxy(f.path+'/publish',input,{'X-Ezkart-CSRF':'wrong'})).status,403);
  assert.equal((await f.proxy(f.path+'/publish',input,{'X-Ezkart-Marketing-Account':'bob'})).status,401);
  assert.equal((await f.proxy(f.path+'/publish',input,{'X-Ezkart-Marketing-Store':'seller_bob'})).status,409);
  assert.equal((await f.proxy(f.path+'/publish',input,{Origin:'https://other.example'})).status,403);
  assert.equal((await f.proxy(f.path+'/publish',input,{'Content-Type':'text/plain'})).status,415);
  assert.equal((await f.proxy(f.path+'/publish','x'.repeat(3001))).status,413);assert.equal((await f.proxy(f.path+'/publish','{"revision":1,"revision":1}')).status,400);
  for(const target of [f.path+'/publication?cursor=x',f.path+'/recipients?cursor=x&cursor=y',f.path+'/publication-history?environment=production',f.path+'/publication/extra'])assert.equal((await f.proxy(target)).status,400,target);
  assert.equal((await f.proxy(f.path+'/publish?extra=1',input)).status,400);
  assert.equal((await f.proxy(f.path+'/publish')).status,405);assert.equal((await f.proxy(f.path+'/publication',input)).status,405);assert.equal((await f.proxy(f.path+'/publication-action')).status,405);
  assert.equal(await f.count('commerce_campaign_publications'),0);
});

test('a completed publication cannot return private data into a replaced PHP sign-in session',async t=>{
  const f=await fixture(t);await f.addBuyer(1);
  f.control.afterResponse=async path=>{
    if(path!==f.path+'/publish')return;f.control.afterResponse=null;
    f.app.cli(`define('EZ_CUSTOMER_SESSION_BRIDGE', true); session_id('${f.cookie.value}'); require '${process.cwd()}/cart/admin/index.php'; $_SESSION['admin_user']=['id'=>'bob','email'=>'bob@example.test']; $_SESSION['csrf_token']='changed'; session_write_close();`);
  };
  const result=await f.proxy(f.path+'/publish',f.intent());assert.equal(result.status,401);assert.equal(result.data.code,'marketing_session_changed');assert.equal(result.data.publication,undefined);assert.equal(await f.count('commerce_campaign_publications'),1);
});
