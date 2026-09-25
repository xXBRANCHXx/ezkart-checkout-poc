import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdir} from 'node:fs/promises';
import {reviewFixture,browser,pageFor,choose,key} from './review-workspace-fixture.mjs';

const base='/v1/commerce/reviews',screens='/tmp/ezkart-review-workspace-01a0d643';
const root=p=>p.locator('[data-commerce-reviews]'),detail=p=>p.locator('[data-reviews-detail]');
const loaded=p=>p.waitForFunction(()=>document.querySelector('[data-reviews-list-status]')?.textContent==='Reviews are up to date.');
const saved=p=>p.waitForFunction(()=>document.querySelector('[data-reviews-detail-status]')?.textContent.startsWith('Saved.'));
async function open(p,f){await p.goto(f.app.base+'/cart/admin/?page=customers&tab=reviews');await loaded(p);}
async function show(p,f){await root(p).locator('[data-review-manage="'+f.review.id+'"]').click();await detail(p).getByRole('button',{name:'Save reply',exact:true}).waitFor();}
const headers=p=>p.evaluate(()=>({'X-Ezkart-Review-Account':document.body.dataset.adminReviewAccount,'X-Ezkart-Csrf':document.body.dataset.adminCsrfToken}));

test('merchants reply, moderate and restore review visibility with photos and history on desktop and mobile',async t=>{
  const f=await reviewFixture(t),b=await browser(t);await mkdir(screens,{recursive:true});
  for(const width of [1360,390]){
    const p=await pageFor(b,f,width),errors=[];p.on('pageerror',e=>errors.push(e.message));await open(p,f);await show(p,f);
    assert.equal(await detail(p).locator('.reviews-card img[onerror]').count(),0);
    await detail(p).getByLabel('Store reply',{exact:true}).fill('Thank you. We will use this feedback.');await detail(p).getByLabel('Explanation for the buyer',{exact:true}).fill('The photo contains a private phone number.');
    await detail(p).getByRole('button',{name:'Save reply',exact:true}).click();await saved(p);assert.equal(await detail(p).getByLabel('Explanation for the buyer',{exact:true}).inputValue(),'The photo contains a private phone number.','Saving a reply retains the separate moderation draft');
    await detail(p).getByRole('button',{name:'Hide review',exact:true}).click();await saved(p);await detail(p).getByText('Hidden by store',{exact:false}).first().waitFor();
    const publicRead=await p.request.get(f.app.base+'/cart/api/reviews.php?product='+f.review.productId);assert.equal((await publicRead.json()).summary.count,0);
    await detail(p).getByRole('button',{name:'Enlarge review photo 1',exact:true}).first().click();await detail(p).getByRole('dialog').waitFor();await p.waitForFunction(()=>document.querySelector('[data-reviews-detail] dialog[open] img')?.naturalWidth>0);await p.keyboard.press('Escape');
    await detail(p).getByRole('button',{name:'Restore visibility',exact:true}).click();await saved(p);assert.equal((await (await p.request.get(f.app.base+'/cart/api/reviews.php?product='+f.review.productId)).json()).summary.count,1);
    await detail(p).locator('.reviews-history li').first().waitFor();await detail(p).evaluate(n=>n.scrollIntoView({block:'start',behavior:'instant'}));await p.screenshot({path:screens+'/merchant-'+width+'.png'});assert.equal(await p.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);assert.deepEqual(errors,[]);
    await p.context().close();
  }
  assert.equal(await f.count('commerce_review_changes'),7);
});

test('review directory filters use the full cohort, retain failed pages and restore links on reload',async t=>{
  const f=await reviewFixture(t,{legacy:44}),b=await browser(t),p=await pageFor(b,f,390);await f.addLegacy('pending_review',2,'pending');await open(p,f);
  assert.equal(await root(p).locator('[data-reviews-list]>.reviews-card').count(),20);assert.match(await root(p).locator('[data-reviews-count]').textContent(),/20 of 46/);
  let fail=true;await p.route('**/cart/admin/?cloud=*',async route=>{const path=new URL(route.request().url()).searchParams.get('cloud');if(fail&&path?.startsWith(base+'?')&&path.includes('cursor=')){fail=false;await route.fulfill({status:503,json:{ok:false,error:'Page interrupted'}});return;}await route.continue();});
  await root(p).getByRole('button',{name:'Load more reviews',exact:true}).click();await root(p).getByRole('button',{name:'Retry more reviews',exact:true}).waitFor();assert.equal(await root(p).locator('[data-reviews-list]>.reviews-card').count(),20);
  await root(p).getByRole('button',{name:'Retry more reviews',exact:true}).click();await p.waitForFunction(()=>document.querySelectorAll('[data-reviews-list]>.reviews-card').length===40);await root(p).getByRole('button',{name:'Load more reviews',exact:true}).click();await p.waitForFunction(()=>document.querySelectorAll('[data-reviews-list]>.reviews-card').length===46);
  await choose(p,root(p),'state','Awaiting moderation');await root(p).getByRole('button',{name:'Apply filters',exact:true}).click();await loaded(p);assert.equal(await root(p).locator('[data-reviews-list]>.reviews-card').count(),1);assert.equal(new URL(p.url()).searchParams.get('state'),'pending');
  await p.reload();await loaded(p);assert.equal(await root(p).locator('[data-reviews-list]>.reviews-card').count(),1);await root(p).getByRole('button',{name:'Manage review'}).click();await detail(p).getByRole('button',{name:'Approve historical review'}).click();await saved(p);assert.match(await detail(p).innerText(),/Historical review/);
});

test('lost reply responses retain their request and conflicting buyer edits require a fresh comparison',async t=>{
  const f=await reviewFixture(t),b=await browser(t),p=await pageFor(b,f);await open(p,f);await show(p,f);await detail(p).getByLabel('Store reply',{exact:true}).fill('My retained reply.');
  f.control.drop=base+'/'+f.review.id;await detail(p).getByRole('button',{name:'Save reply',exact:true}).click();await detail(p).getByRole('button',{name:'Retry confirmation'}).waitFor();assert.equal(await detail(p).getByLabel('Store reply',{exact:true}).isDisabled(),true);assert.equal(await root(p).getByRole('button',{name:'Refresh reviews',exact:true}).isDisabled(),true);
  const first=f.control.calls.filter(c=>c.path===base+'/'+f.review.id&&c.body).at(-1).body;await detail(p).getByRole('button',{name:'Retry confirmation'}).click();await saved(p);assert.equal(await f.count('commerce_review_changes'),2);assert.deepEqual(f.control.calls.filter(c=>c.path===base+'/'+f.review.id&&c.body).at(-1).body,first);
  await detail(p).getByLabel('Store reply',{exact:true}).fill('Keep this newer draft.');assert.equal((await f.publish(2,{body:'The buyer updated their review.'})).status,200);
  await detail(p).getByRole('button',{name:'Save reply',exact:true}).click();await p.waitForFunction(()=>document.querySelector('[data-reviews-detail-status]').textContent.includes('Reload saved review'));
  await detail(p).getByRole('button',{name:'Reload saved review',exact:true}).click();await detail(p).getByRole('button',{name:'Use this saved review',exact:true}).waitFor();assert.equal(await detail(p).getByRole('button',{name:'Save reply',exact:true}).isDisabled(),true);assert.equal(await detail(p).getByLabel('Store reply',{exact:true}).inputValue(),'Keep this newer draft.');assert.match(await detail(p).locator('.reviews-card').innerText(),/buyer updated/);
  await detail(p).getByRole('button',{name:'Use this saved review',exact:true}).click();await detail(p).getByRole('button',{name:'Save reply',exact:true}).click();await saved(p);assert.equal(await f.count('commerce_review_changes'),4);
});

test('merchant review reads bind to the page account, enforce viewer access and hide a changed-login response',async t=>{
  const f=await reviewFixture(t),b=await browser(t),p=await pageFor(b,f);await open(p,f);const h=await headers(p);
  const proxy=path=>f.app.base+'/cart/admin/?cloud='+encodeURIComponent(path);
  assert.equal((await p.request.get(proxy(base))).status(),401);
  assert.equal((await p.request.get(proxy(base+'?q='+encodeURIComponent('茶'.repeat(60))),{headers:h})).status(),200);
  for(const path of [base+'?rating=1&rating=2',base+'?environment=production',base+'/'+f.review.id+'?cursor=abc',base+'?limit=51'])assert.equal((await p.request.get(proxy(path),{headers:h})).status(),400);
  assert.equal((await p.request.post(proxy(base+'/'+f.review.id),{headers:h,data:{body:'x'.repeat(24001)}})).status(),413);
  await f.db.prepare("UPDATE seller_memberships SET role='viewer' WHERE auth_user_id='alice'").run();await root(p).getByRole('button',{name:'Refresh reviews',exact:true}).click();await loaded(p);await show(p,f);assert.equal(await detail(p).getByRole('button',{name:'Save reply',exact:true}).isDisabled(),true);assert.equal(await detail(p).getByLabel('Store reply',{exact:true}).isDisabled(),true);
  assert.equal((await p.request.post(proxy(base+'/'+f.review.id),{headers:h,data:{kind:'reply',revision:1,requestKey:key(),body:'Forbidden'}})).status(),403);
  f.control.afterResponse=async path=>{if(path!==base+'/'+f.review.id)return;f.control.afterResponse=null;f.app.cli(`session_save_path(getenv('EZKART_ADMIN_SESSION_STORAGE')); session_name('ezkart_admin'); session_id('${f.cookie.value}'); session_start(); $_SESSION['admin_user']['id']='bob'; session_write_close();`);};
  await detail(p).getByRole('button',{name:'Reload saved review',exact:true}).click();await root(p).getByRole('button',{name:'Reload sign-in',exact:true}).waitFor();assert.equal(await root(p).locator('.reviews-card').count(),0);
});

test('held PHP rollout permits review evidence but blocks changes before calling the Worker',async t=>{
  const f=await reviewFixture(t,{EZKART_COMMERCE_STORAGE:'legacy'}),b=await browser(t),p=await pageFor(b,f);await open(p,f);await show(p,f);
  assert.match(await root(p).locator('[data-reviews-availability]').textContent(),/not enabled for this store yet/);assert.equal(await detail(p).getByRole('button',{name:'Save reply',exact:true}).isDisabled(),true);
  const h=await headers(p),before=f.control.calls.length;
  const response=await p.request.post(f.app.base+'/cart/admin/?cloud='+encodeURIComponent(base+'/'+f.review.id),{headers:h,data:{kind:'reply',revision:1,requestKey:key(),body:'Held change'}});
  assert.equal(response.status(),503);assert.equal(f.control.calls.slice(before).filter(c=>c.body).length,0);assert.equal(await f.count('commerce_review_changes'),1);
});

test('review drafts survive navigation, stale detail responses are ignored and history pages recover',async t=>{
  const f=await reviewFixture(t),b=await browser(t),p=await pageFor(b,f);await f.addLegacy('other_review');
  for(let revision=1;revision<=23;revision++)assert.equal((await f.change('reply',revision,{body:'Reply '+revision})).status,200);
  await open(p,f);await show(p,f);await detail(p).getByLabel('Store reply',{exact:true}).fill('Keep this draft across reviews.');
  await detail(p).getByRole('button',{name:'Close details'}).click();assert.equal(await root(p).locator('[data-review-manage="'+f.review.id+'"]').evaluate(n=>n===document.activeElement),true);
  const path=base+'/'+f.review.id;let release,entered;const intercepted=new Promise(resolve=>entered=resolve),snapshot=await f.merchant(path);
  await p.route('**/cart/admin/?cloud=*',async route=>{if(new URL(route.request().url()).searchParams.get('cloud')===path&&!release){release=()=>route.fulfill({json:snapshot});entered();return;}await route.continue();});
  await root(p).locator('[data-review-manage="'+f.review.id+'"]').click();await intercepted;await root(p).locator('[data-review-manage="other_review"]').click();await detail(p).getByText('Historical review',{exact:true}).waitFor();await release();
  assert.equal(await detail(p).locator('.reviews-card').getAttribute('data-review-id'),'other_review');await p.unroute('**/cart/admin/?cloud=*');
  await show(p,f);assert.equal(await detail(p).getByLabel('Store reply',{exact:true}).inputValue(),'Keep this draft across reviews.');
  await p.waitForFunction(()=>document.querySelectorAll('.reviews-history li').length===20);let fail=true;
  await p.route('**/cart/admin/?cloud=*',async route=>{if(fail&&new URL(route.request().url()).searchParams.get('cloud')?.startsWith(path+'/history?cursor=')){fail=false;await route.fulfill({status:503,json:{ok:false,error:'History unavailable'}});return;}await route.continue();});
  await detail(p).getByRole('button',{name:'Load older changes'}).click();await detail(p).getByRole('button',{name:'Retry older changes'}).waitFor();assert.equal(await detail(p).locator('.reviews-history li').count(),20);
  await detail(p).getByRole('button',{name:'Retry older changes'}).click();await p.waitForFunction(()=>document.querySelectorAll('.reviews-history li').length===24);
  await detail(p).getByRole('button',{name:'Discard unsaved changes'}).click();assert.equal(await detail(p).getByLabel('Store reply',{exact:true}).inputValue(),'Reply 23');assert.equal(await f.count('commerce_review_changes'),24);
});
