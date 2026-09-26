import test from 'node:test';
import assert from 'node:assert/strict';
import {randomBytes,randomUUID} from 'node:crypto';
import {mkdir} from 'node:fs/promises';
import {setupCentralFixture} from './central-fixture.mjs';
import {browser,pageFor} from './review-workspace-fixture.mjs';
import {publicationFixtureOn} from '../../cloudflare/ezkart-api/test/campaign-publication-fixture.mjs';
import {campaignMailConfiguration} from '../../cloudflare/ezkart-api/test/campaign-email-fixture.mjs';
import {prepareAttributionCampaign} from '../../cloudflare/ezkart-api/test/campaign-attribution-fixture.mjs';
import {dispatchCampaignEmails} from '../../cloudflare/ezkart-api/src/campaign-email-delivery.js';
import {campaignVisitHash} from '../../cloudflare/ezkart-api/src/campaign-attribution.js';
const screens='/tmp/ezkart-campaign-attribution-ui-01a0d643';
const input=changes=>({checkout_key:randomBytes(16).toString('hex'),cart:{tea:1},expected_prices:{tea:20000},expected_total:20000,shop:'alice-shop',shipping_id:'',customer:{fullName:'Checkout Tester',email:'checkout@example.com',phone:'081234567890',location:'Jakarta Selatan',address:'Jalan Test Nomor 12',postalCode:'12345',note:'Handle with care',coordinate:{latitude:-6.2,longitude:106.8}},...changes});
async function fixture(t,overrides={}){
  const bindings={...campaignMailConfiguration(),COMMERCE_EMAIL_TEST_RECIPIENTS:'["buyer1@example.test"]'},f=await publicationFixtureOn(await setupCentralFixture(t,overrides,{bindings}),bindings),campaign=await prepareAttributionCampaign(f);
  const sent=await dispatchCampaignEmails(f.env,2,async(url,options)=>url.includes('/auth/v1/admin/users/')?Response.json({id:'campaign-buyer-1',email:'buyer1@example.test',email_confirmed_at:'2026-09-01T00:00:00Z'}):Response.json({id:randomUUID()}));
  assert.equal(sent.processed,1,JSON.stringify(sent));assert.equal(sent.failed,0);assert.equal(await f.count('commerce_campaign_email_starts'),1);return {...f,...campaign,url:f.app.base+'/cart/campaign.php?c='+campaign.link.code};
}
const source=(f,id)=>f.db.prepare('SELECT * FROM commerce_campaign_order_attributions WHERE order_id=?').bind(id).first();

test('anonymous campaign bridge pins its destination, sends no credentials, and HEAD creates no visit',async t=>{
  const f=await fixture(t,{EZKART_COMMERCE_STORAGE:'legacy'});
  const head=await fetch(f.url,{method:'HEAD',redirect:'manual'});assert.equal(head.status,302,JSON.stringify({url:f.url,calls:await f.app.calls(),sources:(await f.db.prepare('SELECT * FROM commerce_campaign_visit_sources').all()).results}));assert.equal(head.headers.get('location'),'/shop/?store=seller_alice');assert.equal(await head.text(),'');assert.equal(await f.count('commerce_campaign_visits'),0);
  const response=await fetch(f.url,{redirect:'manual',headers:{Cookie:'ezkart_customer=another-account; ezkart_admin=another-store'}});assert.equal(response.status,302);assert.equal(response.headers.get('set-cookie'),null);assert.equal(response.headers.get('referrer-policy'),'no-referrer');assert.equal(response.headers.get('cache-control'),'no-store');
  const location=new URL(response.headers.get('location'),f.app.base);assert.equal(location.origin,f.app.base);assert.equal(location.pathname,'/shop/');assert.equal(location.searchParams.get('store'),'seller_alice');assert.match(location.searchParams.get('campaign_visit'),/^[a-f0-9]{64}$/);assert.equal(await f.count('commerce_campaign_visits'),1);
  const calls=(await f.app.calls()).filter(c=>c.url.includes('/v1/public/campaign-link'));assert.equal(calls.length,2);assert.deepEqual(calls.map(c=>c.method),['HEAD','GET']);assert(calls.every(c=>c.headers.every(h=>! /^(authorization|cookie|x-ezkart-signature):/i.test(h))));
  for(const suffix of ['&next=https://example.test','&store=seller_bob','&c='+f.link.code])assert.equal((await fetch(f.url+suffix,{redirect:'manual'})).status,404);
  const post=await fetch(f.url,{method:'POST',redirect:'manual'});assert.equal(post.status,405);assert.equal(post.headers.get('allow'),'GET, HEAD');assert.equal(await f.count('commerce_campaign_visits'),1);
});

test('PHP checkout retains the original visit across lost acknowledgements and refuses changed attribution',async t=>{
  const f=await fixture(t),link=await fetch(f.url,{redirect:'manual'}),visit=new URL(link.headers.get('location'),f.app.base).searchParams.get('campaign_visit'),body=input({campaign_visit:visit});
  f.control.drop='/internal/commerce/orders';assert.equal((await f.app.request('/cart/api/start.php',body)).status,503);
  const attributed=await f.db.prepare('SELECT * FROM commerce_campaign_order_attributions').first();assert(attributed);assert.equal(attributed.visit_hash,await campaignVisitHash(visit,'sandbox'));assert.equal((await f.providerCalls()).length,0);
  const replay=await f.app.request('/cart/api/start.php',body);assert.equal(replay.status,201,JSON.stringify(replay.data));assert.equal(replay.data.order_id,attributed.order_id);assert.equal((await f.providerCalls()).length,1);
  assert.equal((await f.app.request('/cart/api/start.php',{...body,campaign_visit:'f'.repeat(64)})).status,409);const removed={...body};delete removed.campaign_visit;assert.equal((await f.app.request('/cart/api/start.php',removed)).status,409);
  for(const invalid of [null,[],{token:visit},'',visit+'0'])assert.equal((await f.app.request('/cart/api/start.php',input({campaign_visit:invalid}))).status,422);
  const unknown=await f.app.request('/cart/api/start.php',input({campaign_visit:'0'.repeat(64)}));assert.equal(unknown.status,201,JSON.stringify(unknown.data));assert.equal(await source(f,unknown.data.order_id),null);
  assert.equal(await f.count('commerce_campaign_order_attributions'),1);assert(!JSON.stringify(await f.record(attributed.order_id)).includes(visit));
});

test('desktop/mobile email visits survive storefront, cart and original checkout recovery without persistent visitor tracking',async t=>{
  const f=await fixture(t),b=await browser(t);await mkdir(screens,{recursive:true});
  for(const width of [1360,390]){
    const p=await pageFor(b,f,width,null),errors=[],attempts=[],requests=[];p.on('pageerror',e=>errors.push(e.message));p.on('request',r=>requests.push({url:r.url(),referer:r.headers().referer}));
    let drop=true,id='';await p.route('**/api/start.php',async route=>{attempts.push(route.request().postData());if(drop){drop=false;const response=await route.fetch(),data=await response.json();assert(data.order_id,JSON.stringify(data));id=data.order_id;await route.abort();}else await route.continue();});
    await p.goto(f.url);await p.locator('[data-product="tea"] [data-add]').waitFor();const visit=new URL(p.url()).searchParams.get('campaign_visit');assert.match(visit,/^[a-f0-9]{64}$/);
    await p.locator('[data-product="tea"] [data-add]').click();await p.locator('#shop-checkout').click();await p.locator('#to-checkout').waitFor();assert.equal(new URL(p.url()).searchParams.get('campaign_visit'),visit);
    assert(!await p.evaluate(token=>JSON.stringify({...localStorage}).includes(token),visit));assert(!await p.evaluate(token=>JSON.stringify({...sessionStorage}).includes(token),visit));assert(!(await p.context().cookies()).some(c=>c.value.includes(visit)));
    await p.locator('#to-checkout').click();for(const [name,value] of Object.entries(input().customer))if(typeof value==='string')await p.locator('#customer-form [name="'+name+'"]').fill(value);
    await p.locator('#pay-button').click();await p.waitForFunction(()=>!document.querySelector('#recover-checkout').disabled&&JSON.parse(sessionStorage.getItem('ezkart.checkout.attempt.v1')||'{}').uncertain);
    assert.equal(JSON.parse(attempts[0]).campaign_visit,visit);assert.equal((await source(f,id)).visit_hash,await campaignVisitHash(visit,'sandbox'));
    await p.evaluate(()=>{const url=new URL(location.href);url.searchParams.delete('campaign_visit');history.replaceState({},'',url);});await p.reload();await p.locator('#checkout-recovery').waitFor({state:'visible'});await p.screenshot({path:screens+'/recovery-'+width+'.png',fullPage:true});
    await p.locator('#recover-checkout').click();await p.waitForURL('**/payment.php?order='+id);await p.locator('#transfer-details').waitFor({state:'visible'});assert.equal(new Set(attempts).size,1);assert.equal((await f.providerCalls()).length,width===1360?1:2);
    assert(requests.every(r=>!r.referer?.includes('campaign_visit')),JSON.stringify(requests.filter(r=>r.referer?.includes('campaign_visit'))));assert.deepEqual(errors,[]);await p.context().close();
  }
  assert.equal(await f.count('commerce_campaign_order_attributions'),2);
});

test('store navigation strips malformed or cross-store references and a fresh direct visit has no remembered source',async t=>{
  const f=await fixture(t),b=await browser(t),p=await pageFor(b,f,390,null);await p.goto(f.url);await p.locator('#shop-content').waitFor();
  const token=new URL(p.url()).searchParams.get('campaign_visit');
  for(const search of ['?store=seller_bob&campaign_visit='+token,'?store=seller_alice&campaign_visit='+token+'&campaign_visit='+token,'?store=seller_alice&store=seller_alice&campaign_visit='+token,'?store=seller_alice&campaign_visit=invalid','?store=seller_alice']){
    const links=await p.evaluate(search=>{history.replaceState({},'',search);const store={id:'seller_alice',cartScope:'alice-shop'};return [EzkartStorefront.campaignVisit(store),EzkartStorefront.shopUrl(store),EzkartStorefront.checkoutUrl(store,{tea:1})];},search);
    assert.equal(links[0],'');assert(links.slice(1).every(link=>!link.includes('campaign_visit')));
  }
  await p.goto(f.app.base+'/shop/?store=seller_alice');await p.locator('#shop-content').waitFor();await p.locator('[data-product="tea"] [data-add]').click();await p.locator('#shop-checkout').click();await p.locator('#to-checkout').waitFor();assert.equal(new URL(p.url()).searchParams.get('campaign_visit'),null);
  await p.goto(f.app.base+'/cart/campaign.php?c='+'0'.repeat(64));await p.getByRole('heading',{name:'This store link is unavailable',exact:true}).waitFor();assert.equal(await p.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);await p.screenshot({path:screens+'/unavailable-390.png',fullPage:true});
});
