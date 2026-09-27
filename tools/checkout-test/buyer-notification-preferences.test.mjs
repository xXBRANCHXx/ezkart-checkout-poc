import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdir,readFile,writeFile} from 'node:fs/promises';
import {randomBytes,randomUUID} from 'node:crypto';
import {setupCentralFixture} from './central-fixture.mjs';
import {browser,pageFor} from './review-workspace-fixture.mjs';
import {emailFixtureConfiguration,emailFixtureEvent,emailFixtureCallback} from '../../cloudflare/ezkart-api/test/email-fixture.mjs';
const buyer='fixture-google-customer',base='/v1/customer/notifications/preferences',screens='/tmp/ezkart-buyer-prefs-ui-01a0d643',key=()=>randomBytes(16).toString('hex');
const panel=p=>p.locator('[data-buyer-preferences]'),root=p=>p.locator('[data-notification-workspace]');
async function fixture(t,overrides={}){
  const mail=[],outbound=async request=>{const url=new URL(request.url);if(url.origin==='https://auth.fixture.test'&&url.pathname==='/auth/v1/admin/users/'+buyer)return Response.json({id:buyer,email:'checkout@example.com',email_confirmed_at:'2026-09-01T00:00:00Z'});
    assert.equal(url.href,'https://api.resend.com/emails');const payload=await request.json(),id=randomUUID();mail.push({payload,id});return Response.json({id});};
  const f=await setupCentralFixture(t,{EZKART_TEST_NOTIFICATIONS:'1',...overrides},{bindings:{...emailFixtureConfiguration(),COMMERCE_EMAIL_TEST_RECIPIENTS:'["checkout@example.com"]'},outbound});
  await f.db.prepare((await readFile(new URL('../../cloudflare/ezkart-api/migrations/0006_customer_addresses.sql',import.meta.url),'utf8')).replace(/--[^\n]*/g,'')).run();
  const cookie=f.app.customerCookie('checkout@example.com',buyer,3600,await f.merchantToken(buyer,'checkout@example.com'));
  const create=async()=>{const made=await f.create(f.input({customer:{name:'Buyer',email:'checkout-contact@example.test',phone:'081234567890',authUserId:buyer}}));assert.equal(made.status,200,made.error);assert.equal((await f.paid(made.order)).status,200);assert.equal((await f.call('/internal/commerce/notifications/drain',{environment:'sandbox'})).failed,0);return made.order;};
  return {...f,cookie,mail,create};
}
async function open(p,f){await p.goto(f.app.base+'/cart/notifications.php?view=preferences');await panel(p).getByText('Your saved preferences are shown.',{exact:true}).waitFor();}
test('buyer preferences and email history work through real PHP and Worker paths at desktop and phone widths',async t=>{
  const f=await fixture(t),b=await browser(t);await mkdir(screens,{recursive:true});
  for(const width of [1360,390]){
    const p=await pageFor(b,f,width),errors=[];p.on('pageerror',e=>errors.push(e.message));await open(p,f);
    assert.equal(await panel(p).getByRole('checkbox').count(),12);await panel(p).getByRole('checkbox',{name:'Email · Payment confirmed',exact:true}).check();await panel(p).getByRole('checkbox',{name:'In-app · Payment confirmed',exact:true}).uncheck();
    if(width===1360){await panel(p).getByRole('button',{name:'Save preferences',exact:true}).click();await panel(p).getByText('Notification preferences saved.',{exact:true}).waitFor();}
    assert.equal(await p.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);await p.screenshot({path:screens+'/preferences-'+width+'.png',fullPage:true});
    await root(p).getByRole('button',{name:'Your inbox',exact:true}).click();await root(p).getByText('0 notifications shown',{exact:true}).waitFor();await root(p).getByRole('button',{name:'Preferences',exact:true}).click();
    await panel(p).getByRole('button',{name:'Preference history',exact:true}).click();await panel(p).getByText('1 saved changes shown.',{exact:true}).waitFor();
    await p.goBack();await root(p).getByText('0 notifications shown',{exact:true}).waitFor();assert.equal(await panel(p).getByRole('dialog',{name:'Your preference history'}).isVisible(),false);await p.goForward();await panel(p).getByRole('button',{name:'Preference history',exact:true}).waitFor();
    if(width===1360){await f.create();const drained=await f.call('/internal/commerce/email/drain',{environment:'sandbox'});assert.equal(drained.failed,0,JSON.stringify(drained));assert.equal(f.mail.length,1);
      const request=emailFixtureCallback(emailFixtureEvent(f.mail[0].payload,f.mail[0].id));assert.equal((await f.mf.dispatchFetch(request.url,{method:'POST',headers:Object.fromEntries(request.headers),body:await request.text()})).status,200);}
    await root(p).getByRole('button',{name:'Your emails',exact:true}).click();await root(p).getByText('1 email update shown',{exact:true}).waitFor();await root(p).getByText('Email accepted by the recipient’s mail server',{exact:true}).waitFor();assert.equal(await root(p).getByRole('button',{name:'Mark as read',exact:true}).count(),0);
    await p.screenshot({path:screens+'/email-history-'+width+'.png',fullPage:true});await root(p).getByRole('button',{name:'Your inbox',exact:true}).click();await root(p).getByText('0 notifications shown',{exact:true}).waitFor();assert.deepEqual(errors,[]);await p.context().close();
  }
  assert.equal(await f.count('commerce_customer_consents'),0);assert.equal((await f.providerCalls()).length,0);
});
test('a lost preference-save acknowledgement survives reload and retries exactly once with the same request',async t=>{
  const f=await fixture(t),b=await browser(t),p=await pageFor(b,f,390);await open(p,f);await panel(p).getByRole('checkbox',{name:'Email · Store messages',exact:true}).check();f.control.drop=base;
  await panel(p).getByRole('button',{name:'Save preferences',exact:true}).click();await panel(p).getByRole('button',{name:'Retry original save',exact:true}).waitFor();assert.equal(await f.count('commerce_buyer_notification_changes'),1);
  const original=f.control.calls.filter(c=>c.path===base&&c.body).at(-1).body;await p.reload();await panel(p).getByRole('button',{name:'Retry original save',exact:true}).waitFor();assert.equal(await panel(p).getByRole('checkbox',{name:'Email · Store messages',exact:true}).isDisabled(),true);
  await panel(p).getByRole('button',{name:'Retry original save',exact:true}).click();await panel(p).getByText('Notification preferences saved.',{exact:true}).waitFor();assert.deepEqual(f.control.calls.filter(c=>c.path===base&&c.body).at(-1).body,original);assert.equal(await f.count('commerce_buyer_notification_changes'),1);
});
test('concurrent edits and a retry rejected by a newer revision require comparison and preserve both tabs choices',async t=>{
  const f=await fixture(t),b=await browser(t),p=await pageFor(b,f,390),other=await pageFor(b,f);await open(p,f);await open(other,f);
  await panel(p).getByRole('checkbox',{name:'Email · Returns and refunds',exact:true}).check();let reject=true;const attempted=[];
  await p.route('**/cart/admin/customer-notifications.php?*',async route=>{const request=route.request(),path=new URL(request.url()).searchParams.get('path');if(path==='/preferences'&&request.method()==='POST'){attempted.push(JSON.parse(request.postData()));if(reject){reject=false;await route.fulfill({status:503,json:{ok:false,error:'Fixture interrupted before reaching the server'}});return;}}await route.continue();});
  await panel(p).getByRole('button',{name:'Save preferences',exact:true}).click();await panel(p).getByRole('button',{name:'Retry original save',exact:true}).waitFor();assert.equal(await f.count('commerce_buyer_notification_changes'),0);
  await panel(other).getByRole('checkbox',{name:'Email · Shipping updates',exact:true}).check();await panel(other).getByRole('button',{name:'Save preferences',exact:true}).click();await panel(other).getByText('Notification preferences saved.',{exact:true}).waitFor();
  await panel(p).getByRole('button',{name:'Retry original save',exact:true}).click();const dialog=panel(p).getByRole('dialog',{name:'Compare your changes'});await dialog.waitFor();assert.deepEqual(attempted[0],attempted[1]);assert.equal(await f.count('commerce_buyer_notification_changes'),1);
  await dialog.getByRole('button',{name:'Use compared choices',exact:true}).click();assert.equal(await panel(p).getByRole('checkbox',{name:'Email · Shipping updates',exact:true}).isChecked(),true);assert.equal(await panel(p).getByRole('checkbox',{name:'Email · Returns and refunds',exact:true}).isChecked(),true);
  await panel(p).getByRole('button',{name:'Save preferences',exact:true}).click();await panel(p).getByText('Notification preferences saved.',{exact:true}).waitFor();assert.notEqual(attempted[2].requestKey,attempted[0].requestKey);assert.equal(attempted[2].revision,1);assert.equal(await f.count('commerce_buyer_notification_changes'),2);
});
test('held commerce permits preference choices while inboxes remain held, and PHP checks session, CSRF, origin and late identity changes',async t=>{
  const f=await fixture(t,{EZKART_COMMERCE_STORAGE:'legacy'}),b=await browser(t),p=await pageFor(b,f,390);await open(p,f);await root(p).getByText('Notifications are not available yet',{exact:true}).waitFor();assert.equal(await root(p).getByRole('button',{name:'Your inbox',exact:true}).isDisabled(),true);
  await panel(p).getByRole('checkbox',{name:'Email · Returns and refunds',exact:true}).check();await panel(p).getByRole('button',{name:'Save preferences',exact:true}).click();await panel(p).getByText('Notification preferences saved.',{exact:true}).waitFor();assert.equal(f.mail.length,0);
  const config=JSON.parse(await root(p).getAttribute('data-config')),headers={Cookie:'ezkart_customer='+f.cookie.value,'X-Ezkart-CSRF':config.csrf,'X-Ezkart-Customer-Session':config.version},url='/cart/admin/customer-notifications.php?path=';
  const prefs=await f.merchant(base,undefined,{seller:buyer}),body={revision:1,requestKey:key(),values:prefs.values};
  assert.equal((await f.app.request(url+encodeURIComponent('/preferences'),body,{...headers,'X-Ezkart-CSRF':'wrong'})).status,403);
  assert.equal((await f.app.request(url+encodeURIComponent('/preferences'),body,{...headers,Origin:'https://foreign.example'})).status,403);
  assert.equal((await f.app.request(url+encodeURIComponent('/preferences'),undefined,{...headers,'X-Ezkart-Customer-Session':'stale'})).status,401);
  assert.equal((await f.app.request(url+encodeURIComponent('/read'),{ids:[1]},headers)).status,503);
  assert.equal((await f.app.request(url+encodeURIComponent('/preferences/history?account=someone_else'),undefined,headers)).status,400);
  f.control.afterResponse=async path=>{if(path!==base)return;f.control.afterResponse=null;f.app.cli(`require '${process.cwd()}/cart/api/customer-auth.php'; session_id('${f.cookie.value}'); ez_customer_session(); $_SESSION['customer_auth']['version']='changed'; session_write_close();`);};
  await panel(p).getByRole('checkbox',{name:'Email · Store messages',exact:true}).check();await panel(p).getByRole('button',{name:'Save preferences',exact:true}).click();await root(p).getByRole('link',{name:'Reload sign-in',exact:true}).waitFor();assert.equal(await panel(p).count(),0);
});
test('history keeps its loaded page after an interrupted next page and saved drafts cannot cross accounts',async t=>{
  const f=await fixture(t),b=await browser(t);let result=await f.merchant(base,undefined,{seller:buyer});
  for(let revision=0;revision<22;revision++){result.values.messages.email=revision%2===0;result=await f.merchant(base,{values:result.values,revision,requestKey:key()},{seller:buyer,method:'POST'});assert.equal(result.status,200,result.error);}
  const p=await pageFor(b,f,390);await open(p,f);await panel(p).getByRole('button',{name:'Preference history',exact:true}).click();await panel(p).getByText('20 saved changes shown.',{exact:true}).waitFor();let fail=true;
  await p.route('**/cart/admin/customer-notifications.php?*',async route=>{const path=new URL(route.request().url()).searchParams.get('path');if(fail&&path?.startsWith('/preferences/history?cursor=')){fail=false;await route.fulfill({status:503,json:{ok:false,error:'History page interrupted'}});return;}await route.continue();});
  await panel(p).getByRole('button',{name:'Load older preferences',exact:true}).click();await panel(p).getByText('History page interrupted',{exact:true}).waitFor();assert.equal(await panel(p).locator('[data-buyer-pref-history-items]>li').count(),20);
  await panel(p).getByRole('button',{name:'Retry history',exact:true}).click();await panel(p).getByText('22 saved changes shown.',{exact:true}).waitFor();await panel(p).getByRole('button',{name:'Close history',exact:true}).click();
  await panel(p).getByRole('checkbox',{name:'Email · Returns and refunds',exact:true}).check();await p.reload();await panel(p).getByText('You have unsaved changes.',{exact:true}).waitFor();assert.equal(await panel(p).getByRole('checkbox',{name:'Email · Returns and refunds',exact:true}).isChecked(),true);
  const other=await f.merchant(base,undefined,{seller:'other_buyer'});assert.equal(other.revision,0);assert.equal(other.values.returns.email,false);
  const otherCookie=f.app.customerCookie('checkout@example.com','other_buyer',3600,await f.merchantToken('other_buyer','checkout@example.com'));
  await writeFile(f.app.directory+'/auth-response.json',JSON.stringify({user:{id:'other_buyer'}}));await p.context().addCookies([otherCookie]);await open(p,f);
  assert.equal(JSON.parse(await root(p).getAttribute('data-config')).account,'other_buyer');assert.equal(await panel(p).getByRole('checkbox',{name:'Email · Returns and refunds',exact:true}).isChecked(),false);
});
