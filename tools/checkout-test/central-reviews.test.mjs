import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdir,writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {randomBytes} from 'node:crypto';
import {setupCentralFixture} from './central-fixture.mjs';
import {fixtureShipping} from '../../cloudflare/ezkart-api/test/commerce-fixture.mjs';

const buyer='fixture-google-customer',key=()=>randomBytes(16).toString('hex'),endpoint='/cart/admin/customer-reviews.php',screens='/tmp/ezkart-reviews-ui-01a0d643';
async function fixture(t){
  const f=await setupCentralFixture(t),created=await f.create(f.input({shipping:fixtureShipping,customer:{name:'Private Buyer',email:'checkout@example.com',phone:'081234567890',authUserId:buyer}}));
  assert.equal(created.status,200,created.error);const order=created.order;assert.equal((await f.paid(order)).status,200);
  let shipment;
  for(const kind of ['accept','pickup']){const d=await f.merchant('/v1/fulfillment/'+order.id),r=await f.merchant('/v1/fulfillment/'+order.id,{kind,revision:d.order.revision,requestKey:key()},{method:'POST'});assert.equal(r.status,200,r.error);if(kind==='pickup')shipment=r.receipt.shipmentId;}
  await f.call(`/internal/commerce/shipments/${shipment}/account`,{environment:'sandbox',accountHash:'a'.repeat(64)});
  const s=(await f.call(`/internal/commerce/shipments/${shipment}?environment=sandbox`)).shipment;
  const bound=await f.call(`/internal/commerce/shipments/${shipment}/bind`,{environment:'sandbox',verified:true,providerId:'courier_'+shipment,reference:s.reference,data:{kind:'status',status:'delivered',updatedAt:new Date().toISOString()}});assert.equal(bound.status,200,bound.error);
  const token=await f.merchantToken(buyer,'checkout@example.com'),cookie=f.app.customerCookie('checkout@example.com',buyer,3600,token);
  const path=`/v1/customer/orders/${order.id}/reviews`,items=(await f.merchant(path,undefined,{seller:buyer})).items;
  const publish=(revision,extra={})=>f.merchant(path,{kind:'publish',orderItemId:items[0].orderItemId,revision,requestKey:key(),rating:2,title:'Another session',body:'A saved review from another session.',publicName:'Buyer',photos:[],...extra},{seller:buyer,method:'POST'});
  return {...f,order,cookie,path,items,publish};
}
async function browser(t){const {chromium}=await import('../builder-mcp/node_modules/playwright/index.mjs'),b=await chromium.launch({headless:true});t.after(()=>b.close());return b;}
async function pageFor(b,f,width=1360){const context=await b.newContext({viewport:{width,height:1000},reducedMotion:'reduce'});await context.addCookies([f.cookie]);const p=await context.newPage();p.setDefaultTimeout(12000);return p;}
const root=p=>p.locator('[data-customer-reviews]');
async function open(p,f){await p.goto(f.app.base+'/cart/return.php?order='+f.order.id);await p.waitForFunction(()=>document.querySelector('[data-review-status]')?.textContent==='Your reviews are up to date.');await root(p).waitFor({state:'visible'});}
async function edit(p){await root(p).getByRole('button',{name:/^(Write a review|Edit review)$/}).click();}
async function fill(p,text='The stitching could be stronger.'){
  await root(p).locator('[name=rating][value="2"]').check();await root(p).getByLabel('Public name',{exact:true}).fill('Tea fan');await root(p).getByLabel('Title (optional)',{exact:true}).fill('After trying it');await root(p).getByLabel('Your experience (optional)',{exact:true}).fill(text);
}
const headers=async(p,f)=>({Cookie:f.cookie.name+'='+f.cookie.value,'X-Ezkart-Customer-Session':await root(p).getAttribute('data-version'),'X-Ezkart-CSRF':await root(p).getAttribute('data-csrf')});

test('buyers publish photos, edit and withdraw real reviews through PHP on desktop and mobile',async t=>{
  const f=await fixture(t),b=await browser(t);await mkdir(screens,{recursive:true});
  for(const width of [1360,390]){
    const p=await pageFor(b,f,width),errors=[];p.on('pageerror',e=>errors.push(e.message));await open(p,f);await edit(p);await fill(p,'The stitching <img src=x onerror=alert(1)> could be stronger.');
    const image=await p.evaluate(()=>{const c=document.createElement('canvas');c.width=300;c.height=200;const x=c.getContext('2d');x.fillStyle='#eaa35b';x.fillRect(0,0,300,200);return c.toDataURL('image/png').split(',')[1];});
    await root(p).locator('input[type=file]').setInputFiles({name:'review.png',mimeType:'image/png',buffer:Buffer.from(image,'base64')});await root(p).getByText('Photo uploaded. Publish the review to make it visible to shoppers.',{exact:true}).waitFor();
    await root(p).getByRole('button',{name:'Publish review',exact:true}).click();await root(p).getByText('Your review was saved.',{exact:true}).waitFor();
    await p.waitForFunction(()=>document.querySelector('.review-saved img')?.naturalWidth>0);assert.equal(await root(p).locator('.review-saved .review-photo-open img').count(),width===1360?1:2);
    await root(p).getByRole('button',{name:'Enlarge review photo'}).first().click();await root(p).getByRole('dialog').waitFor();assert.equal(await root(p).getByRole('dialog').locator('img').evaluate(img=>img.naturalWidth),300);await p.keyboard.press('Escape');assert.equal(await root(p).getByRole('dialog').count(),0);
    assert.equal(await root(p).locator('.review-saved img[onerror]').count(),0);
    await root(p).getByText('Review history',{exact:true}).click();await root(p).locator('.review-history li').first().waitFor();
    assert.equal(await p.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);await root(p).screenshot({path:screens+'/buyer-'+width+'.png'});
    await root(p).getByRole('button',{name:'Withdraw review',exact:true}).click();await root(p).getByRole('button',{name:'Confirm withdrawal',exact:true}).click();await root(p).getByText('Your review is withdrawn. It is no longer visible to shoppers.',{exact:true}).waitFor();
    const response=await f.mf.dispatchFetch('https://api.fixture.test/v1/public/reviews?product=tea');assert.equal((await response.json()).summary.count,0);
    assert.deepEqual(errors,[]);await p.context().close();
  }
  assert.equal(await f.count('commerce_review_changes'),4);assert.equal((await f.providerCalls()).length,0);
});

test('uncertain review writes retain the exact request and stale drafts require comparing the saved review',async t=>{
  const f=await fixture(t),b=await browser(t),p=await pageFor(b,f,390);await open(p,f);await edit(p);await fill(p);
  f.control.drop=f.path;await root(p).getByRole('button',{name:'Publish review',exact:true}).click();await root(p).getByRole('button',{name:'Retry confirmation',exact:true}).waitFor();
  assert.equal(await root(p).getByLabel('Your experience (optional)',{exact:true}).isDisabled(),true);assert.equal(await root(p).getByRole('button',{name:'Refresh reviews'}).isDisabled(),true);assert.equal(await f.count('commerce_review_changes'),1);
  const first=f.control.calls.filter(c=>c.path===f.path&&c.body).at(-1).body;
  await root(p).getByRole('button',{name:'Retry confirmation',exact:true}).click();await root(p).getByText('Your review was saved.',{exact:true}).waitFor();assert.equal(await f.count('commerce_review_changes'),1);assert.deepEqual(f.control.calls.filter(c=>c.path===f.path&&c.body).at(-1).body,first);
  await edit(p);await fill(p,'My retained draft.');assert.equal((await f.publish(1)).status,200);
  await root(p).getByRole('button',{name:'Publish review',exact:true}).click();await root(p).getByRole('button',{name:'Check saved review',exact:true}).click();await root(p).getByRole('button',{name:'Use this saved revision',exact:true}).waitFor();
  assert.match(await root(p).locator('.review-saved').first().innerText(),/Another session/);assert.equal(await root(p).getByLabel('Your experience (optional)',{exact:true}).inputValue(),'My retained draft.');assert.equal(await root(p).getByRole('button',{name:'Publish review',exact:true}).isDisabled(),true);
  await root(p).getByRole('button',{name:'Use this saved revision',exact:true}).click();await root(p).getByRole('button',{name:'Publish review',exact:true}).click();await root(p).getByText('Your review was saved.',{exact:true}).waitFor();assert.equal(await f.count('commerce_review_changes'),3);
});

test('the review proxy revalidates login, rejects stale identities and hides responses after a concurrent account change',async t=>{
  const f=await fixture(t),b=await browser(t),p=await pageFor(b,f);await open(p,f);const h=await headers(p,f),body={kind:'publish',orderItemId:f.items[0].orderItemId,revision:0,requestKey:key(),rating:1,title:'',body:'Honest',publicName:'Buyer',photos:[]};
  assert.equal((await f.app.request(endpoint+'?order='+f.order.id,body,{})).status,401);
  assert.equal((await f.app.request(endpoint+'?order='+f.order.id,body,{...h,'X-Ezkart-Customer-Session':'stale'})).status,401);
  assert.equal((await f.app.request(endpoint+'?order='+f.order.id,body,{...h,'X-Ezkart-CSRF':'bad'})).status,403);
  for(const suffix of ['&order='+f.order.id,'&environment=production','&cursor=invalid','&review[]=x'])assert.equal((await f.app.request(endpoint+'?order='+f.order.id+suffix,null,h)).status,400);
  await writeFile(join(f.app.directory,'auth-response.json'),JSON.stringify({user:{id:'new-account'}}));assert.equal((await f.app.request(endpoint+'?order='+f.order.id,body,h)).status,401);assert.equal(await f.count('commerce_review_changes'),0);
  await writeFile(join(f.app.directory,'auth-response.json'),JSON.stringify({}));
  f.control.afterResponse=async path=>{if(path!==f.path)return;f.control.afterResponse=null;f.app.cli(`require '${process.cwd()}/cart/api/customer-auth.php'; session_id('${f.cookie.value}'); ez_customer_session(); $_SESSION['customer_auth']['version']='changed-session'; session_write_close();`);};
  await edit(p);await fill(p);await root(p).getByRole('button',{name:'Publish review',exact:true}).click();await root(p).getByRole('button',{name:'Reload sign-in',exact:true}).waitFor();assert.equal(await root(p).locator('.review-card').count(),0);assert.equal(await f.count('commerce_review_changes'),1);
});

test('history retries retain pages and discard draft resets inputs without publishing',async t=>{
  const f=await fixture(t);for(let n=0;n<23;n++)assert.equal((await f.publish(n,{body:'Revision '+n})).status,200);
  const b=await browser(t),p=await pageFor(b,f,390);await open(p,f);await root(p).getByText('Review history',{exact:true}).click();await p.waitForFunction(()=>document.querySelectorAll('.review-history li').length===20);
  let fail=true;await p.route('**/customer-reviews.php?*',async route=>{if(fail&&new URL(route.request().url()).searchParams.has('cursor')){fail=false;await route.fulfill({status:503,json:{ok:false,error:'History interrupted'}});return;}await route.continue();});
  await root(p).getByRole('button',{name:'Load older changes'}).click();await root(p).getByRole('button',{name:'Retry older changes'}).waitFor();assert.equal(await root(p).locator('.review-history li').count(),20);
  await root(p).getByRole('button',{name:'Retry older changes'}).click();await p.waitForFunction(()=>document.querySelectorAll('.review-history li').length===23);
  await edit(p);await fill(p,'Discard this text');await root(p).getByRole('button',{name:'Discard draft'}).click();await edit(p);assert.equal(await root(p).getByLabel('Your experience (optional)',{exact:true}).inputValue(),'Revision 22');assert.equal(await f.count('commerce_review_changes'),23);
});
