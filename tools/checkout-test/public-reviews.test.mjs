import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdir} from 'node:fs/promises';
import {reviewFixture,browser,pageFor,choose,productId} from './review-workspace-fixture.mjs';

const screens='/tmp/ezkart-review-workspace-01a0d643',dialog=p=>p.locator('.reviews-dialog'),cards=p=>dialog(p).locator('.reviews-card');
const card=p=>p.locator('[data-product="'+productId+'"]');
async function shop(p,f){await p.goto(f.app.base+'/shop/?store=seller_alice');await card(p).waitFor();}
async function open(p){await card(p).locator('[data-reviews]').click();await dialog(p).getByRole('status').filter({hasText:/matching reviews/}).waitFor();}

test('public reviews show real ratings, replies and photos with usable desktop/mobile controls and an intact cart',async t=>{
  const f=await reviewFixture(t,{legacy:2}),b=await browser(t);assert.equal((await f.change('reply',1,{body:'Thank you for your detailed feedback.'})).status,200);await mkdir(screens,{recursive:true});
  for(const width of [1360,390]){
    const p=await pageFor(b,f,width,null),errors=[];p.on('pageerror',e=>errors.push(e.message));
    if(width===390)await p.addInitScript(()=>{const supports=CSS.supports.bind(CSS);CSS.supports=(property,value)=>property==='appearance'&&value==='base-select'?false:supports(property,value);});
    await shop(p,f);
    assert.equal(await card(p).locator('[data-reviews]').textContent(),'1.7 / 5 · 3 reviews');await open(p);assert.equal(await cards(p).count(),3);
    assert.equal(await dialog(p).getByText('Verified purchase',{exact:true}).count(),1);assert.equal(await dialog(p).getByText('Historical review',{exact:true}).count(),2);assert.equal(await dialog(p).locator('img[onerror]').count(),0);
    assert.match(await dialog(p).innerText(),/Thank you for your detailed feedback/);assert.doesNotMatch(await dialog(p).innerText(),/Private Buyer|checkout@example.com|081234567890|EZK-S-/);
    await dialog(p).getByRole('button',{name:'Enlarge review photo 1',exact:true}).click();await p.waitForFunction(()=>document.querySelector('.reviews-photo-dialog[open] img')?.naturalWidth>0);await p.keyboard.press('Escape');
    await choose(p,dialog(p),'photos','With photos');await dialog(p).getByRole('button',{name:'Apply filters',exact:true}).click();await p.waitForFunction(()=>document.querySelector('.reviews-dialog [role=status]')?.textContent==='1 of 1 matching reviews');assert.match(await dialog(p).locator('.reviews-average').innerText(),/3 published reviews/);
    await dialog(p).screenshot({path:screens+'/public-'+width+'.png'});assert.equal(await dialog(p).evaluate(n=>n.scrollWidth<=n.clientWidth),true);assert.equal(await p.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
    await p.keyboard.press('Escape');await dialog(p).waitFor({state:'detached'});assert.equal(await card(p).locator('[data-reviews]').evaluate(n=>n===document.activeElement),true);assert.equal(new URL(p.url()).searchParams.has('review-product'),false);
    await card(p).getByRole('button',{name:'Add to cart',exact:true}).click();assert.equal(await p.locator('#shop-count').textContent(),'1');assert.equal(await p.locator('#shop-checkout').isDisabled(),false);
    await p.reload();await card(p).waitFor();assert.equal(await p.locator('#shop-count').textContent(),'1');assert.deepEqual(errors,[]);await p.context().close();
  }
});

test('public paging and filters recover interrupted requests and reload shareable review links',async t=>{
  const f=await reviewFixture(t,{legacy:44}),b=await browser(t),p=await pageFor(b,f,390,null);await shop(p,f);await open(p);assert.equal(await cards(p).count(),20);
  let failMore=true,failFilter=true;
  await p.route('**/cart/api/reviews.php?*',async route=>{const q=new URL(route.request().url()).searchParams;if(q.has('cursor')&&failMore){failMore=false;await route.fulfill({status:503,json:{ok:false,error:'Interrupted page'}});return;}if(q.get('rating')==='5'&&failFilter){failFilter=false;await route.fulfill({status:503,json:{ok:false,error:'Interrupted filter'}});return;}await route.continue();});
  await dialog(p).getByRole('button',{name:'Load more reviews'}).click();await dialog(p).getByRole('button',{name:'Retry more reviews'}).waitFor();assert.equal(await cards(p).count(),20);
  await dialog(p).getByRole('button',{name:'Retry more reviews'}).click();await p.waitForFunction(()=>document.querySelectorAll('.reviews-dialog .reviews-card').length===40);await dialog(p).getByRole('button',{name:'Load more reviews'}).click();await p.waitForFunction(()=>document.querySelectorAll('.reviews-dialog .reviews-card').length===45);
  await choose(p,dialog(p),'rating','5 stars');await dialog(p).getByRole('button',{name:'Apply filters'}).click();await dialog(p).getByRole('button',{name:'Retry reviews',exact:true}).waitFor();assert.equal(await cards(p).count(),45);
  await dialog(p).getByRole('button',{name:'Retry reviews',exact:true}).click();await p.waitForFunction(()=>document.querySelector('.reviews-dialog [role=status]')?.textContent==='8 of 8 matching reviews');assert.equal(new URL(p.url()).searchParams.get('review-rating'),'5');assert.equal(new URL(p.url()).searchParams.get('review-product'),productId);
  await p.reload();await dialog(p).getByRole('status').filter({hasText:'8 of 8 matching reviews'}).waitFor();assert.equal(await dialog(p).locator('select[name=rating]').inputValue(),'5');assert.match(await dialog(p).locator('.reviews-average').innerText(),/45 published reviews/);
});

test('public photos recheck live visibility and the proxy rejects ambiguous input without disclosing private fields',async t=>{
  const f=await reviewFixture(t),b=await browser(t),p=await pageFor(b,f,1360,null);await shop(p,f);await open(p);await dialog(p).getByRole('button',{name:'Enlarge review photo 1',exact:true}).waitFor();
  const endpoint=f.app.base+'/cart/api/reviews.php?',photo=endpoint+new URLSearchParams({review:f.review.id,photo:f.photoId});
  const image=await p.request.get(photo);assert.equal(image.status(),200);assert.equal(image.headers()['cache-control'],'no-store');assert.equal(image.headers()['x-content-type-options'],'nosniff');assert.equal(image.headers()['content-type'],'image/png');
  const result=await p.request.get(endpoint+'product='+productId),text=await result.text();assert.doesNotMatch(text,/orderId|customerId|authUserId|moderationNote|Private Buyer|checkout@example.com/);
  for(const query of ['product='+productId+'&product='+productId,'product[]=x','product='+productId+'&environment=production','product='+productId+'&limit=51','review='+f.review.id,'product='+productId+'&cursor=%00'])assert.equal((await p.request.get(endpoint+query)).status(),400);
  assert.equal((await p.request.post(endpoint+'product='+productId,{data:{}})).status(),405);
  assert.equal((await f.change('hide',1,{reason:'personal_information',note:'Private details are present in the photo.'})).status,200);
  await dialog(p).getByRole('button',{name:'Enlarge review photo 1',exact:true}).click();await dialog(p).locator('.reviews-photo-dialog[open]').getByText('This review photo is unavailable.',{exact:true}).waitFor();assert.equal(await dialog(p).locator('.reviews-photo-dialog[open] img').isVisible(),false);assert.equal((await p.request.get(photo)).status(),404);
  await p.keyboard.press('Escape');await dialog(p).getByRole('button',{name:'Refresh reviews'}).click();await dialog(p).getByText('No reviews match these filters.',{exact:true}).waitFor();assert.equal(await cards(p).count(),0);assert.equal(await card(p).locator('[data-reviews]').textContent(),'No reviews yet');
});

test('closed or replaced review dialogs discard late reads and release photos',async t=>{
  const f=await reviewFixture(t),b=await browser(t),p=await pageFor(b,f,1360,null);await shop(p,f);
  let release,entered;const reached=new Promise(resolve=>entered=resolve);
  await p.route('**/cart/api/reviews.php?*',async route=>{if(new URL(route.request().url()).searchParams.get('product')===productId&&!release){release=()=>route.continue();entered();return;}await route.continue();});
  await card(p).locator('[data-reviews]').click();await reached;await dialog(p).getByRole('button',{name:'Close reviews'}).click();await release();await p.unroute('**/cart/api/reviews.php?*');
  await p.locator('[data-product=mug] [data-reviews]').click();await dialog(p).getByText('No reviews match these filters.',{exact:true}).waitFor();assert.equal(new URL(p.url()).searchParams.get('review-product'),'mug');assert.equal(await cards(p).count(),0);
  await dialog(p).getByRole('button',{name:'Close reviews'}).click();await open(p);await dialog(p).getByRole('button',{name:'Enlarge review photo 1'}).click();await p.waitForFunction(()=>document.querySelector('.reviews-photo-dialog[open] img')?.naturalWidth>0);
  await p.keyboard.press('Escape');await p.waitForFunction(()=>!document.querySelector('.reviews-photo-dialog img')?.getAttribute('src'));await p.keyboard.press('Escape');await dialog(p).waitFor({state:'detached'});
});

test('product editor uses actual per-product ratings, handles failures and retains archived review evidence',async t=>{
  const f=await reviewFixture(t),b=await browser(t),p=await pageFor(b,f);await mkdir(screens,{recursive:true});
  const rating=p.locator('[data-product-live-rating]'),reviews=p.locator('[data-product-live-reviews]'),edit=f.app.base+'/cart/admin/?page=product-new&product='+productId;
  await p.goto(f.app.base+'/cart/admin/?page=product-new');assert.equal(await rating.locator('b').textContent(),'—');assert.match(await reviews.innerText(),/No reviews yet/);
  await p.goto(edit);await reviews.getByRole('button',{name:'Read product reviews'}).waitFor();assert.equal(await rating.locator('b').textContent(),'2.0');await reviews.getByRole('button',{name:'Read product reviews'}).click();await dialog(p).getByRole('status').filter({hasText:'1 of 1 matching reviews'}).waitFor();assert.equal(await cards(p).count(),1);await dialog(p).getByRole('button',{name:'Close reviews'}).click();
  await f.db.prepare("UPDATE products SET status='archived' WHERE id=?").bind(productId).run();await p.reload();await reviews.getByText('This product is archived. These reviews remain in its history.',{exact:true}).waitFor();assert.equal(await rating.locator('b').textContent(),'2.0');await reviews.screenshot({path:screens+'/product-preview.png'});
  for(const width of [1360,390]){await p.setViewportSize({width,height:1000});await p.locator('[data-product-preview-device=mobile]').click();await reviews.screenshot({path:screens+'/product-mobile-preview-'+width+'.png'});assert.equal(await p.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);await reviews.getByRole('button',{name:'Read product reviews'}).click();await dialog(p).getByRole('status').filter({hasText:'1 of 1 matching reviews'}).waitFor();await dialog(p).getByRole('button',{name:'Close reviews'}).click();}
  let fail=true;await p.route('**/cart/admin/?cloud=*',async route=>{if(fail&&new URL(route.request().url()).searchParams.get('cloud')?.startsWith('/v1/commerce/reviews?')){await route.fulfill({status:503,json:{ok:false,error:'Review service unavailable'}});return;}await route.continue();});
  await p.reload();await reviews.getByRole('button',{name:'Retry product reviews'}).waitFor();assert.equal(await rating.locator('b').textContent(),'—');assert.match(await reviews.innerText(),/Reviews unavailable/);fail=false;await reviews.getByRole('button',{name:'Retry product reviews'}).click();await reviews.getByRole('button',{name:'Read product reviews'}).waitFor();assert.equal(await rating.locator('b').textContent(),'2.0');
  await reviews.getByRole('button',{name:'Read product reviews'}).click();await dialog(p).getByRole('status').filter({hasText:'1 of 1 matching reviews'}).waitFor();await p.waitForFunction(()=>document.querySelector('.reviews-dialog .reviews-photo-open img')?.naturalWidth>0);
  f.app.cli(`session_save_path(getenv('EZKART_ADMIN_SESSION_STORAGE')); session_name('ezkart_admin'); session_id('${f.cookie.value}'); session_start(); $_SESSION['admin_user']['id']='bob'; session_write_close();`);
  await dialog(p).getByRole('button',{name:'Refresh reviews'}).click();await dialog(p).waitFor({state:'detached'});assert.equal(await rating.locator('b').textContent(),'—');assert.match(await reviews.innerText(),/sign-in changed/);
});
