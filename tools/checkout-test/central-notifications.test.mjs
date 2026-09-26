import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdir,readFile,writeFile} from 'node:fs/promises';
import {randomBytes} from 'node:crypto';
import {setupCentralFixture} from './central-fixture.mjs';
import {browser,pageFor,choose} from './review-workspace-fixture.mjs';
import {scheduleNotifications} from '../../cloudflare/ezkart-api/src/commerce-notification-dispatch.js';
const buyer='fixture-google-customer',key=()=>randomBytes(16).toString('hex'),base='/v1/commerce/notifications',screens='/tmp/ezkart-notices-ui-01a0d643';
const root=p=>p.locator('[data-notification-workspace]'),cards=p=>root(p).locator('[data-notice-list] [data-notification-id]');
async function fixture(t,overrides={}){
  const f=await setupCentralFixture(t,{EZKART_TEST_NOTIFICATIONS:'1',...overrides});
  await f.db.prepare((await readFile(new URL('../../cloudflare/ezkart-api/migrations/0006_customer_addresses.sql',import.meta.url),'utf8')).replace(/--[^\n]*/g,'')).run();
  const token=await f.merchantToken(buyer,'checkout@example.com'),buyerCookie=f.app.customerCookie('checkout@example.com',buyer,3600,token);
  const cookie=f.app.adminCookie({supabase_access_token:await f.merchantToken('alice','alice@example.test'),admin_user:{id:'alice',email:'alice@example.test'}});
  const made=await f.create(f.input({customer:{name:'A private buyer',email:'checkout@example.com',phone:'081234567890',authUserId:buyer}}));assert.equal(made.status,200,made.error);assert.equal((await f.paid(made.order)).status,200);
  const c=await f.merchant('/v1/customer/messages',{context:{kind:'order',id:made.order.id}},{seller:buyer,method:'POST'});assert.equal(c.status,200,c.error);
  const send=async (merchant=false)=>{const r=await f.merchant((merchant?'/v1/commerce':'/v1/customer')+'/messages/'+c.conversation.id,{kind:'message',body:'Private message <img src=x onerror=alert(1)>',photos:[],requestKey:key()},{seller:merchant?'alice':buyer,method:'POST'});assert.equal(r.status,200,r.error);};
  const drain=async()=>{let total=0;for(let n=0;n<20;n++){const r=await f.call('/internal/commerce/notifications/drain',{environment:'sandbox',limit:3});assert.equal(r.failed,0,JSON.stringify(r));total+=r.processed;if(r.processed<3)return total;}throw Error('Notification queue did not drain');};
  await send();await send(true);await drain();return {...f,cookie,buyerCookie,order:made.order,conversation:c.conversation,send,drain};
}
async function open(p,f,merchant=true){await p.goto(f.app.base+(merchant?'/cart/admin/?page=notifications':'/cart/notifications.php'));await root(p).getByText('2 notifications shown',{exact:true}).waitFor();await root(p).getByText('2 unread',{exact:true}).waitFor();}
test('real merchant and buyer inboxes work at desktop and phone widths with private content and meaningful deep links',async t=>{
  const f=await fixture(t),b=await browser(t);await mkdir(screens,{recursive:true});
  for(const width of [1360,390])for(const merchant of [true,false]){
    const p=await pageFor(b,f,width,merchant?f.cookie:f.buyerCookie),errors=[];p.on('pageerror',e=>errors.push(e.message));await open(p,f,merchant);
    assert.equal(await cards(p).count(),2);assert.equal(await root(p).getByText('Private message',{exact:false}).count(),0);assert.equal(await root(p).locator('img').count(),0);
    assert.equal(await root(p).getByRole('link',{name:'View order',exact:true}).getAttribute('href'),merchant?'/cart/admin/?page=orders&order='+f.order.id:'/cart/return.php?order='+f.order.id);
    assert.equal(await p.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);await p.screenshot({path:screens+'/'+(merchant?'merchant':'buyer')+'-'+width+'.png',fullPage:true});
    await choose(p,root(p),'category','Messages');await root(p).getByRole('button',{name:'Apply filters',exact:true}).click();await root(p).getByText('1 notification shown',{exact:true}).waitFor();assert.match(p.url(),/category=messages/);
    await root(p).getByRole('link',{name:'Open conversation',exact:true}).click();await p.locator('[data-message-workspace]').getByLabel('Message',{exact:true}).waitFor();assert.match(p.url(),new RegExp(f.conversation.id));await p.goBack();await root(p).getByText('1 notification shown',{exact:true}).waitFor();
    await root(p).getByLabel('Search updates').fill('does not exist');await root(p).getByRole('button',{name:'Apply filters',exact:true}).click();await root(p).getByText('0 notifications shown',{exact:true}).waitFor();await p.goBack();await root(p).getByText('1 notification shown',{exact:true}).waitFor();
    assert.deepEqual(errors,[]);await p.context().close();
  }
  assert.equal((await f.providerCalls()).length,0);
});
test('read acknowledgement loss retries the exact IDs once and reload shows the saved state and bell count',async t=>{
  const f=await fixture(t),b=await browser(t),p=await pageFor(b,f,390);await open(p,f);f.control.drop=base+'/read';
  await root(p).getByRole('button',{name:'Mark shown as read',exact:true}).click();await root(p).getByRole('button',{name:'Retry read confirmation',exact:true}).waitFor();assert.equal(await f.count('commerce_notification_reads'),2);
  const first=f.control.calls.filter(c=>c.path===base+'/read').at(-1).body;assert.equal(await cards(p).locator('[data-notice-read]').count(),2);
  await root(p).getByRole('button',{name:'Retry read confirmation',exact:true}).click();await root(p).getByText('0 unread',{exact:true}).waitFor();assert.deepEqual(f.control.calls.filter(c=>c.path===base+'/read').at(-1).body,first);assert.equal(await f.count('commerce_notification_reads'),2);
  await p.reload();await root(p).getByText('0 unread',{exact:true}).waitFor();assert.equal(await cards(p).locator('[data-notice-read]').count(),0);assert.equal(await p.locator('[data-notification-badge]').isHidden(),true);
  await f.send();await f.drain();await p.goto(f.app.base+'/cart/admin/?page=settings');await p.locator('[data-notification-badge]').getByText('1',{exact:true}).waitFor();await p.getByRole('link',{name:'Notifications, 1 unread',exact:true}).click();await root(p).getByText('1 unread',{exact:true}).waitFor();
  await choose(p,root(p).locator('[data-notice-inbox]'),'state','Unread');await root(p).getByRole('button',{name:'Apply filters',exact:true}).click();await root(p).getByText('1 notification shown',{exact:true}).waitFor();
  f.control.drop=base+'/read';await root(p).getByRole('button',{name:'Mark as read',exact:true}).click();await root(p).getByRole('button',{name:'Retry read confirmation',exact:true}).waitFor();await p.reload();await root(p).getByText('0 notifications shown',{exact:true}).waitFor();assert.equal(await f.count('commerce_notification_reads'),3);
});
test('paged history retains loaded notifications after interruption and excludes newly arrived updates until refresh',async t=>{
  const f=await fixture(t),b=await browser(t);for(let n=0;n<27;n++)await f.send();for(let n=0;n<3;n++)await f.drain();
  const p=await pageFor(b,f,390);await p.goto(f.app.base+'/cart/admin/?page=notifications');await root(p).getByText('25 notifications shown',{exact:true}).waitFor();
  await f.send();await f.drain();let interrupted=false;await p.route('**/cart/admin/?cloud=*',async route=>{const path=new URL(route.request().url()).searchParams.get('cloud');if(!interrupted&&path.startsWith(base+'?')&&path.includes('cursor=')){interrupted=true;await route.fulfill({status:503,json:{ok:false,error:'Older updates interrupted'}});return;}await route.continue();});
  await root(p).getByRole('button',{name:'Load older notifications',exact:true}).click();await root(p).getByText(/Older updates interrupted/).waitFor();assert.equal(await cards(p).count(),25);
  await root(p).getByRole('button',{name:'Load older notifications',exact:true}).click();await root(p).getByText('29 notifications shown',{exact:true}).waitFor();const ids=await cards(p).evaluateAll(elements=>elements.map(e=>e.dataset.notificationId));assert.equal(new Set(ids).size,29);
  await root(p).getByRole('button',{name:'Refresh',exact:true}).click();await root(p).getByText('25 notifications shown',{exact:true}).waitFor();await root(p).getByRole('button',{name:'Load older notifications',exact:true}).click();await root(p).getByText('30 notifications shown',{exact:true}).waitFor();
});
test('delivery activity shows actual processing and email intent, while PHP binds account, store, CSRF and query scope',async t=>{
  const f=await fixture(t),settings=await f.merchant('/v1/commerce/settings'),prefs=settings.notifications.values;prefs.messages.email=true;await f.merchant('/v1/commerce/settings',{kind:'notifications',values:prefs,revision:0,requestKey:key()},{method:'POST'});await f.send();await f.drain();
  const b=await browser(t),p=await pageFor(b,f,390);await p.goto(f.app.base+'/cart/admin/?page=notifications');await root(p).getByText('3 notifications shown',{exact:true}).waitFor();await root(p).getByText('Email requested · service not connected',{exact:true}).waitFor();
  await root(p).getByRole('button',{name:'Store delivery activity',exact:true}).click();await root(p).getByText('0 delivery updates shown',{exact:true}).waitFor();const activity=root(p).locator('[data-notice-processing]');await choose(p,activity,'state','Processed');await activity.getByRole('button',{name:'Apply delivery filter',exact:true}).click();await activity.getByText('4 delivery updates shown',{exact:true}).waitFor();await activity.getByText('1 in-app inbox reached · 1 email request awaiting a connected service',{exact:true}).waitFor();assert.equal(await p.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);await p.screenshot({path:screens+'/processing-390.png',fullPage:true});
  const headers=await p.evaluate(()=>{const c=JSON.parse(document.querySelector('[data-notification-workspace]').dataset.config);return {'X-Ezkart-CSRF':c.csrf,'X-Ezkart-Notification-Account':c.account,'X-Ezkart-Notification-Store':c.store};});headers.Cookie='ezkart_admin='+f.cookie.value;
  const url=path=>'/cart/admin/?cloud='+encodeURIComponent(base+path);
  assert.equal((await f.app.request(url(''),undefined,{...headers,'X-Ezkart-CSRF':'wrong'})).status,401);assert.equal((await f.app.request(url(''),undefined,{...headers,'X-Ezkart-Notification-Account':'bob'})).status,401);assert.equal((await f.app.request(url(''),undefined,{...headers,'X-Ezkart-Notification-Store':'seller_bob'})).status,409);
  assert.equal((await f.app.request(url('/read'),{ids:[1]},{...headers,Origin:'https://foreign.example'})).status,403);
  for(const path of ['?state=all&state=read','?seller=seller_bob','/processing?state=read','/stats?environment=production','/read','?q=private%00text','?cursor=x#fragment'])assert.equal((await f.app.request(url(path),undefined,headers)).status,400,path);
  assert.equal(await f.count('commerce_notification_reads'),0);
});
test('late merchant account changes clear private data and customer proxy rejects stale or mismatched verified sign-ins',async t=>{
  const f=await fixture(t),b=await browser(t),p=await pageFor(b,f);await open(p,f);
  f.control.afterResponse=async path=>{if(path!==base+'/read')return;f.control.afterResponse=null;f.app.cli(`define('EZ_CUSTOMER_SESSION_BRIDGE', true); session_id('${f.cookie.value}'); require '${process.cwd()}/cart/admin/index.php'; $_SESSION['admin_user']=['id'=>'bob','email'=>'bob@example.test']; $_SESSION['csrf_token']='changed'; session_write_close();`);};
  await root(p).getByRole('button',{name:'Mark shown as read',exact:true}).click();await root(p).getByRole('link',{name:'Reload sign-in',exact:true}).waitFor();assert.equal(await cards(p).count(),0);assert.equal(await f.count('commerce_notification_reads'),2);
  const customer=await pageFor(b,f,390,f.buyerCookie);await open(customer,f,false);const config=await root(customer).getAttribute('data-config'),c=JSON.parse(config),headers={Cookie:'ezkart_customer='+f.buyerCookie.value,'X-Ezkart-Customer-Session':c.version,'X-Ezkart-CSRF':c.csrf};
  const url='/cart/admin/customer-notifications.php?path=';assert.equal((await f.app.request(url,undefined,{...headers,'X-Ezkart-Customer-Session':'stale'})).status,401);assert.equal((await f.app.request(url+encodeURIComponent('/read'),{ids:[1]},{...headers,'X-Ezkart-CSRF':'wrong'})).status,403);assert.equal((await f.app.request(url+encodeURIComponent('/processing'),undefined,headers)).status,400);
  await writeFile(f.app.directory+'/auth-response.json',JSON.stringify({user:{id:'another-buyer'}}));
  const denied=await f.app.request(url,undefined,headers);assert.equal(denied.status,401);assert.equal(denied.data.code,'customer_session_changed');assert(!JSON.stringify(denied.data).includes(f.order.id));
});
test('central hold keeps historical merchant reads honest and buyer sign-in returns to the notification page',async t=>{
  const f=await fixture(t,{EZKART_COMMERCE_STORAGE:'legacy'}),b=await browser(t),p=await pageFor(b,f,390);await p.goto(f.app.base+'/cart/admin/?page=notifications');await root(p).getByText('2 notifications shown',{exact:true}).waitFor();await root(p).getByText(/New notification delivery is not enabled/).waitFor();assert.equal(await root(p).getByRole('button',{name:'Mark shown as read',exact:true}).isDisabled(),true);
  const buyerPage=await pageFor(b,f,390,f.buyerCookie);await buyerPage.goto(f.app.base+'/cart/notifications.php');await root(buyerPage).getByText('Notifications are not available yet',{exact:true}).waitFor();assert.equal(await cards(buyerPage).count(),0);
  const guest=await pageFor(b,f,390,null);await guest.goto(f.app.base+'/cart/notifications.php');await guest.getByRole('heading',{name:'Your order updates',level:1,exact:true}).waitFor();assert.equal(await guest.locator('input[name=next]').first().inputValue(),'/cart/notifications.php');
});

test('weekly catalog details use safe text and a return notification opens the actual authorized return',async t=>{
  const f=await fixture(t),b=await browser(t),settings=await f.merchant('/v1/commerce/settings'),prefs=settings.notifications.values;prefs.weekly_activity.inApp=true;
  await f.merchant('/v1/commerce/settings',{kind:'notifications',values:prefs,revision:0,requestKey:key()},{method:'POST'});
  await f.db.prepare("UPDATE sellers SET created_at='2020-01-01T00:00:00.000Z'").run();await f.db.prepare("UPDATE products SET title=? WHERE id='mug'").bind('Ceramic mug <img src=x onerror=alert(1)>').run();
  await scheduleNotifications({DB:f.db,APP_ENVIRONMENT:'test',COMMERCE_STORAGE:'d1',COMMERCE_NOTIFICATIONS:'scheduled'});await f.drain();
  const p=await pageFor(b,f,390);await p.goto(f.app.base+'/cart/admin/?page=notifications&category=weekly_activity');await root(p).getByText('1 notification shown',{exact:true}).waitFor();await root(p).getByText('Ceramic mug <img src=x onerror=alert(1)>',{exact:true}).waitFor();assert.equal(await root(p).locator('img').count(),0);
  // A delivered fixture permits return creation; this does not assert a live courier delivery.
  await f.db.prepare("UPDATE orders SET fulfillment_state='delivered' WHERE id=?").bind(f.order.id).run();
  const path='/v1/returns/orders/'+f.order.id,detail=await f.merchant(path),opened=await f.merchant(path,{requestKey:key(),orderRevision:detail.order.revision,reason:'damaged',note:'Inspect this particular return',items:detail.items.map(i=>({orderItemId:i.orderItemId,quantity:1}))},{method:'POST'});assert.equal(opened.status,200,opened.error);await f.drain();
  await p.goto(f.app.base+'/cart/admin/?page=notifications&category=returns');await root(p).getByRole('link',{name:'View return',exact:true}).click();await p.locator('[data-return-detail]').getByText('Inspect this particular return',{exact:true}).waitFor();assert.match(p.url(),new RegExp(opened.id));
  await p.goto(f.app.base+'/cart/admin/?page=returns&return=ret_'+'f'.repeat(32));await p.locator('[data-return-title]').getByText('Return could not be loaded',{exact:true}).waitFor();assert.equal(await p.locator('[data-return-detail]').getByText('Inspect this particular return',{exact:true}).count(),0);
});

test('buyer bridge discards an inbox response if the merchant session used for sign-in changes while it is loading',async t=>{
  const f=await fixture(t),b=await browser(t),admin=f.app.adminCookie({supabase_access_token:await f.merchantToken(buyer,'checkout@example.com'),admin_user:{id:buyer,email:'checkout@example.com'}});
  f.app.cli(`require '${process.cwd()}/cart/api/customer-auth.php'; session_id('${f.buyerCookie.value}'); ez_customer_session(); $_SESSION['customer_auth']['source']='existing_google'; session_write_close();`);
  const p=await pageFor(b,f,390,f.buyerCookie);await p.context().addCookies([admin]);await open(p,f,false);
  const c=JSON.parse(await root(p).getAttribute('data-config'));
  f.control.afterResponse=async path=>{if(path!=='/v1/customer/notifications/stats')return;f.control.afterResponse=null;f.app.cli(`define('EZ_CUSTOMER_SESSION_BRIDGE', true); session_id('${admin.value}'); require '${process.cwd()}/cart/admin/index.php'; $_SESSION['admin_user']=['id'=>'someone_else','email'=>'else@example.test']; $_SESSION['csrf_token']='changed'; session_write_close();`);};
  const result=await f.app.request('/cart/admin/customer-notifications.php?path='+encodeURIComponent('/stats'),undefined,{Cookie:'ezkart_customer='+f.buyerCookie.value+'; ezkart_admin='+admin.value,'X-Ezkart-Customer-Session':c.version});assert.equal(result.status,401);assert.equal(result.data.code,'customer_session_changed');assert.equal(result.data.unread,undefined);
});

test('an older inbox response cannot undo a read confirmation that arrives while refresh is loading',async t=>{
  const f=await fixture(t),b=await browser(t),p=await pageFor(b,f,390);await open(p,f);
  let releaseWrite,releaseList,loadedSnapshot;
  const writeGate=new Promise(resolve=>releaseWrite=resolve),listGate=new Promise(resolve=>releaseList=resolve),snapshot=new Promise(resolve=>loadedSnapshot=resolve);
  await p.route('**/cart/admin/?cloud=*',async route=>{
    const path=new URL(route.request().url()).searchParams.get('cloud');
    if(path===base+'/read'){await writeGate;await route.continue();return;}
    if(path.startsWith(base+'?')){const response=await route.fetch();const body=await response.body();loadedSnapshot();await listGate;await route.fulfill({response,body});return;}
    await route.continue();
  });
  await root(p).getByRole('button',{name:'Mark shown as read',exact:true}).click();await root(p).getByRole('button',{name:'Refresh',exact:true}).click();await snapshot;releaseWrite();await root(p).getByText('0 unread',{exact:true}).waitFor();releaseList();
  await p.waitForFunction(()=>document.querySelector('[data-notice-inbox]').getAttribute('aria-busy')==='false');assert.equal(await cards(p).locator('[data-notice-read]').count(),0);assert.equal(await cards(p).count(),2);
});
