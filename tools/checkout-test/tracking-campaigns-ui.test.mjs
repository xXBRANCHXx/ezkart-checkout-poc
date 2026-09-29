import test from 'node:test';
import {randomBytes} from 'node:crypto';
import {trackingHash} from '../../cloudflare/ezkart-api/src/tracking-campaigns.js';
import assert from 'node:assert/strict';
import {mkdir,readFile} from 'node:fs/promises';
import {seedDeclaredOnboarding} from '../../cloudflare/ezkart-api/test/onboarding-fixture.mjs';
import {setupCentralFixture} from './central-fixture.mjs';
import {browser,pageFor} from './review-workspace-fixture.mjs';

test('Campaigns creates custom source links, compares, ends and keeps Analytics; responsive UI',async t=>{
 const f=await setupCentralFixture(t),b=await browser(t),cookie=f.app.adminCookie({supabase_access_token:await f.merchantToken('alice','alice@example.test'),admin_user:{id:'alice',email:'alice@example.test'}}),p=await pageFor(b,f,1360,cookie);
 await seedDeclaredOnboarding(f.db);
 const bucket=await f.mf.getR2Bucket('PRIVATE_ASSETS');for(const id of ['first','second'])await bucket.put('sellers/seller_alice/landing-pages/'+id+'.json',JSON.stringify({id,name:id,status:'published'}),{customMetadata:{name:id,status:'published',createdAt:new Date().toISOString(),updatedAt:new Date().toISOString()}});
 const errors=[];p.on('pageerror',e=>errors.push(e.message));
 await p.goto(f.app.base+'/cart/admin/?page=campaigns');await p.getByRole('button',{name:'New campaign',exact:true}).first().waitFor();
 await p.getByRole('button',{name:'New campaign',exact:true}).first().click();await p.getByLabel('Campaign name',{exact:true}).fill('September Launch');for(const checkbox of await p.locator('[data-page-options] input').all())await checkbox.check();
 await p.getByRole('button',{name:'Start campaign',exact:true}).click();await p.locator('[data-detail]').getByRole('heading',{name:'September Launch',exact:true}).waitFor();
 f.control.drop='/v1/commerce/campaigns/'+(await f.merchant('/v1/commerce/campaigns')).campaigns[0].id+'/sources';
 await p.getByLabel('Source name',{exact:true}).fill('Instagram Main');await p.getByRole('button',{name:'Create tracking URL',exact:true}).click();await p.locator('[data-pending]').waitFor();await p.reload();await p.getByRole('button',{name:'Retry original save',exact:true}).click();await p.locator('[data-detail] [data-copy]').first().waitFor();
 await p.getByLabel('Source name',{exact:true}).fill('Instagram Personal');await p.getByRole('button',{name:'Create tracking URL',exact:true}).click();await p.getByText('Tracking URL created for Instagram Personal. Use Copy URL to share it.',{exact:true}).waitFor();
 const first=(await f.merchant('/v1/commerce/campaigns')).campaigns[0];let detail=await f.merchant('/v1/commerce/campaigns/'+first.id);assert.equal(detail.sources.length,2);assert.notEqual(detail.sources[0].id,detail.sources[1].id);
 for(const width of [1360,390]){await p.setViewportSize({width,height:1000});await p.evaluate(()=>scrollTo(0,0));await p.waitForTimeout(350);assert.equal(await p.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);await mkdir('/tmp/ezkart-tracking-campaigns',{recursive:true});await p.screenshot({path:'/tmp/ezkart-tracking-campaigns/campaign-'+width+'.png',fullPage:true});}
 await p.getByRole('button',{name:'End campaign',exact:true}).click();await p.locator('[data-end-dialog]').getByRole('button',{name:'End campaign',exact:true}).click();await p.locator('[data-detail]').getByText(/This campaign has ended/).waitFor({state:'attached'});
 await p.getByRole('button',{name:'Ended Campaigns',exact:false}).click();await p.locator('[data-list]').getByRole('heading',{name:'September Launch',exact:true}).waitFor();await p.locator('[data-select]').check();
 await p.getByRole('button',{name:'New campaign',exact:true}).first().click();await p.getByLabel('Campaign name',{exact:true}).fill('October Sale');await p.locator('[data-page-options] input').first().check();await p.getByRole('button',{name:'Start campaign',exact:true}).click();await p.locator('[data-detail]').getByRole('heading',{name:'October Sale',exact:true}).waitFor();
 await p.getByRole('button',{name:'Active Campaigns',exact:false}).click();await p.locator('[data-select]').check();await p.locator('[data-compare]').click();await p.getByRole('heading',{name:'Compare campaigns',exact:true}).waitFor();assert.equal(await p.locator('[data-compare-table]').getByText('Sales per day',{exact:true}).count(),1);
 assert.equal(await p.getByRole('link',{name:'Analytics',exact:true}).count(),1);assert.deepEqual(errors,[]);
});

test('sandboxed landing page tracker sends anonymous events and checkout recovers attribution from return URL',async t=>{
 const b=await browser(t),context=await b.newContext(),p=await context.newPage();const events=[],token='a'.repeat(64),script=await readFile(new URL('../../cart/campaign-tracker.js',import.meta.url),'utf8');
 await p.route('https://tracking.fixture/**',async route=>{const url=new URL(route.request().url());if(url.pathname==='/cart/api/campaign-event.php'){events.push(JSON.parse(route.request().postData()));return route.fulfill({headers:{'access-control-allow-origin':'*'},json:{ok:true}});}if(url.pathname==='/cart/campaign-tracker.js')return route.fulfill({contentType:'text/javascript',body:script});return route.fulfill({contentType:'text/html',body:`<iframe sandbox="allow-scripts" srcdoc="&lt;body&gt;&lt;button data-product-card&gt;Product&lt;/button&gt;&lt;script src='/cart/campaign-tracker.js' data-phase='landing'&gt;&lt;/script&gt;&lt;/body&gt;"></iframe>`});});
 await p.goto('https://tracking.fixture/alice/shop/first?tracking_visit='+token);await p.frameLocator('iframe').getByRole('button',{name:'Product'}).click();await p.waitForFunction(()=>true);await new Promise(r=>setTimeout(r,100));assert(events.some(e=>e.kind==='page_view'));assert(events.some(e=>e.kind==='product_interaction'));assert(events.every(e=>e.visit===token));
 await p.route('https://tracking.fixture/cart/?**',route=>route.fulfill({contentType:'text/html',body:`<script src='/cart/campaign-tracker.js' data-phase='checkout'></script>`}));
 await p.goto('https://tracking.fixture/cart/?return='+encodeURIComponent('https://tracking.fixture/alice/shop/first?tracking_visit='+token));assert.equal(await p.evaluate(()=>window.EzkartCampaignTracker?.visit),token);await p.evaluate(()=>window.EzkartCampaignTracker.send('shipping_selected'));await new Promise(r=>setTimeout(r,100));assert(events.some(e=>e.kind==='checkout_start'));assert(events.some(e=>e.kind==='shipping_selected'));
});

test('PHP checkout preserves campaign attribution across immutable retries',async t=>{
 const f=await setupCentralFixture(t),key=()=>randomBytes(16).toString('hex'),hex=()=>randomBytes(32).toString('hex');
 const bucket=await f.mf.getR2Bucket('PRIVATE_ASSETS');await bucket.put('sellers/seller_alice/landing-pages/first.json',JSON.stringify({id:'first',name:'First',status:'published'}));
 const campaign=(await f.merchant('/v1/commerce/campaigns',{requestKey:key(),name:'PHP flow',pages:['first']},{method:'POST'})).campaign;
 const source=(await f.merchant('/v1/commerce/campaigns/'+campaign.id+'/sources',{requestKey:key(),pageId:'first',name:'WhatsApp Group 2'},{method:'POST'})).source;
 const visit=(await f.call('/internal/commerce/tracking/visit',{source:source.id,path:'/alice/shop/first',visitor:hex()})).visit;
 const event={visit,id:hex(),kind:'page_view',documentId:hex(),elapsedMs:0,properties:{email:'not retained'}};
 assert.equal((await f.app.request('/cart/api/campaign-event.php',event)).status,200);
 const body={checkout_key:key(),cart:{tea:2},expected_prices:{tea:20000},expected_total:40000,shop:'alice-shop',shipping_id:'',tracking_visit:visit,
 customer:{fullName:'Checkout Tester',email:'checkout@example.com',phone:'081234567890',location:'Jakarta',address:'Jalan Test 12',postalCode:'12345',coordinate:{latitude:-6.2,longitude:106.8}}};
 const response=await f.app.request('/cart/api/start.php',body);assert.equal(response.status,201,JSON.stringify(response));
 const attribution=await f.db.prepare('SELECT * FROM tracking_orders WHERE order_id=?').bind(response.data.order_id).first();assert.equal(attribution.visit_hash,await trackingHash(visit,{APP_ENVIRONMENT:'test'}));
 assert.equal((await f.app.request('/cart/api/start.php',body)).data.order_id,response.data.order_id);
 assert.equal((await f.app.request('/cart/api/start.php',{...body,tracking_visit:hex()})).status,409);
 assert.equal((await f.app.request('/cart/api/start.php',{...body,checkout_key:key(),tracking_visit:[]})).status,422);
 const order=await f.record(response.data.order_id);assert.equal((await f.paid(order,{accountNumber:order.payment.accountNumber})).status,200);const report=await f.merchant('/v1/commerce/campaigns/'+campaign.id);assert.equal(report.metrics.orders,1);assert.equal(report.metrics.totalSales,40000);assert.equal(report.metrics.visitors,1);
});
