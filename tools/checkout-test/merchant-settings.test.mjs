import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdir} from 'node:fs/promises';
import {randomBytes} from 'node:crypto';
import {setupCentralFixture} from './central-fixture.mjs';
import {browser,pageFor,choose} from './review-workspace-fixture.mjs';
const base='/v1/commerce/settings',key=()=>randomBytes(16).toString('hex'),screens='/tmp/ezkart-settings-ui-01a0d643';
const root=p=>p.locator('[data-merchant-settings]'),form=(p,kind='profile')=>root(p).locator(`[data-settings-form="${kind}"]`);
async function fixture(t,overrides={}){
  const f=await setupCentralFixture(t,overrides),cookie=f.app.adminCookie({supabase_access_token:await f.merchantToken('alice','alice@example.test'),admin_user:{id:'alice',email:'alice@example.test'}});
  const read=()=>f.merchant(base),save=(kind,values,revision)=>f.merchant(base,{kind,values,revision,requestKey:key()},{method:'POST'});
  return {...f,cookie,read,save};
}
async function open(p,f){await p.goto(f.app.base+'/cart/admin/?page=settings');await root(p).getByText('Store details and personal notification choices save separately.',{exact:true}).waitFor();}
async function save(p,kind='profile'){
  await form(p,kind).getByRole('button',{name:kind==='profile'?'Save store details':'Save notification preferences',exact:true}).click();
  await form(p,kind).getByText(kind==='profile'?'Store details saved.':'Notification preferences saved.',{exact:true}).waitFor();
}
test('merchant saves real store details, sees public support and saved timezone formatting on desktop and narrow screens',async t=>{
  const f=await fixture(t),b=await browser(t);await mkdir(screens,{recursive:true});
  await f.merchant('/v1/storefront',{enabled:true,name:'Jasmine & Co',accent:'#334155',button:'#111827',background:'#f7f8fa',logoId:'',backgroundId:'',animation:'none'});
  for(const width of [1360,390]){
    const p=await pageFor(b,f,width),errors=[];p.on('pageerror',e=>errors.push(e.message));await open(p,f);
    const profile=form(p);await profile.getByLabel(/^Store name/).fill('Jasmine operations '+width);await profile.getByLabel(/^Support email/).fill('help'+width+'@example.test');await profile.getByLabel(/^Support phone/).fill('0812 3456 7890');await profile.getByLabel(/^Store description/).fill('Everyday tea <img src=x onerror=alert(1)>\nPacked with care.');
    await choose(p,profile,'businessType','Retailer');await choose(p,profile,'timezone','Asia/Jayapura (WIT)');await choose(p,profile,'dateFormat','2026-08-11');await save(p);
    assert.equal(await profile.getByLabel(/^Support phone/).inputValue(),'+6281234567890');await p.reload();await root(p).getByText('Store details and personal notification choices save separately.',{exact:true}).waitFor();assert.equal(await profile.getByLabel(/^Store name/).inputValue(),'Jasmine operations '+width);
    assert.equal(await p.evaluate(()=>window.EzkartAdminFormat.date('2026-09-26T16:30:00Z')),'2026-09-27 01:30 WIT');assert.equal(await p.evaluate(()=>window.EzkartAdminFormat.date('2026-09-26',{time:false,calendar:true})),'2026-09-26');
    assert.equal(await p.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);await p.evaluate(()=>scrollTo(0,0));await p.screenshot({path:screens+'/settings-'+width+'.png',fullPage:true});
    await p.goto(f.app.base+'/shop/?store=seller_alice');await p.locator('#shop-support').getByRole('link',{name:'help'+width+'@example.test',exact:true}).waitFor();assert.equal(await p.locator('#shop-name').textContent(),'Jasmine & Co');assert.equal(await p.locator('#shop-support img').count(),0);assert.equal(await p.locator('#shop-support').getByText('Everyday tea <img src=x onerror=alert(1)>\nPacked with care.',{exact:true}).count(),1);assert.equal(await p.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
    await p.screenshot({path:screens+'/shop-'+width+'.png',fullPage:true});await p.goto(f.app.base+'/cart/?product=tea');const support=p.locator('#store-support');await support.getByRole('link',{name:'help'+width+'@example.test',exact:true}).waitFor();assert.equal(await support.getByRole('link',{name:'+6281234567890',exact:true}).getAttribute('href'),'tel:+6281234567890');assert.equal(await p.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);assert.deepEqual(errors,[]);await p.context().close();
  }
  assert.equal((await f.providerCalls()).length,0);
});

test('lost save responses recover once after reload while the other form retains its unsaved choices',async t=>{
  const f=await fixture(t),b=await browser(t),p=await pageFor(b,f,390);await open(p,f);
  await form(p).getByLabel(/^Store name/).fill('A durable store change');await form(p,'notifications').getByLabel('Buyer messages: in-app',{exact:true}).uncheck();f.control.drop=base;
  await form(p).getByRole('button',{name:'Save store details',exact:true}).click();await form(p).getByRole('button',{name:'Retry original save'}).waitFor();assert.equal(await f.count('commerce_settings_changes'),1);
  const first=f.control.calls.filter(c=>c.path===base&&c.body?.kind==='profile').at(-1).body;await p.reload();await form(p).getByRole('button',{name:'Retry original save'}).waitFor();assert.equal(await form(p).getByLabel(/^Store name/).isDisabled(),true);assert.equal(await form(p,'notifications').getByLabel('Buyer messages: in-app',{exact:true}).isChecked(),false);
  await form(p).getByRole('button',{name:'Retry original save'}).click();await form(p).getByText('Store details saved.',{exact:true}).waitFor();assert.equal(await f.count('commerce_settings_changes'),1);assert.deepEqual(f.control.calls.filter(c=>c.path===base&&c.body?.kind==='profile').at(-1).body,first);
  assert.equal(await form(p,'notifications').getByLabel('Buyer messages: in-app',{exact:true}).isChecked(),false);await save(p,'notifications');assert.equal(await f.count('commerce_settings_changes'),2);assert.equal((await f.read()).notifications.values.messages.inApp,false);
  await form(p).getByLabel(/^Store description/).fill('Unsent description');await p.reload();await root(p).getByText('Store details and personal notification choices save separately.',{exact:true}).waitFor();assert.equal(await form(p).getByLabel(/^Store description/).inputValue(),'Unsent description');
});

test('concurrent edits require comparison and preserve independently changed fields from both tabs',async t=>{
  const f=await fixture(t),b=await browser(t),a=await pageFor(b,f,390),other=await pageFor(b,f,1360);await open(a,f);await open(other,f);
  await form(a).getByLabel(/^Store name/).fill('My chosen name');await form(a).getByLabel(/^Store description/).fill('Description from my draft');
  await form(other).getByLabel(/^Store name/).fill('Another staff name');await form(other).getByLabel(/^Support email/).fill('new-support@example.test');await save(other);
  await form(a).getByRole('button',{name:'Save store details',exact:true}).click();const dialog=root(a).getByRole('dialog',{name:'Compare your changes',exact:true});await dialog.waitFor();
  await choose(a,dialog,'merge-name','My draft value');await a.screenshot({path:screens+'/comparison-390.png',fullPage:true});await dialog.getByRole('button',{name:'Use compared changes',exact:true}).click();
  assert.equal(await form(a).getByLabel(/^Support email/).inputValue(),'new-support@example.test');await save(a);const result=await f.read();assert.equal(result.profile.revision,2);assert.equal(result.profile.values.name,'My chosen name');assert.equal(result.profile.values.supportEmail,'new-support@example.test');assert.equal(result.profile.values.description,'Description from my draft');
  await form(a).getByRole('button',{name:'Review saved details',exact:true}).click();await dialog.getByRole('button',{name:'Use saved version',exact:true}).click();assert.equal(await form(a).getByRole('button',{name:'Save store details',exact:true}).isDisabled(),true);
});

test('private settings proxy binds account, store and CSRF and suppresses a late response after the account changes',async t=>{
  const f=await fixture(t),b=await browser(t),p=await pageFor(b,f);await open(p,f);
  const headers=await p.evaluate(()=>({'X-Ezkart-CSRF':document.body.dataset.adminCsrfToken,'X-Ezkart-Settings-Account':document.body.dataset.adminReviewAccount,'X-Ezkart-Settings-Store':document.querySelector('[data-merchant-settings]').dataset.store}));headers.Cookie='ezkart_admin='+f.cookie.value;
  const url='/cart/admin/?cloud='+encodeURIComponent(base),body={kind:'profile',values:(await f.read()).profile.values,revision:0,requestKey:key()};
  assert.equal((await f.app.request(url,undefined,{...headers,'X-Ezkart-CSRF':'wrong'})).status,401);assert.equal((await f.app.request(url,undefined,{...headers,'X-Ezkart-Settings-Account':'bob'})).status,401);assert.equal((await f.app.request(url,undefined,{...headers,'X-Ezkart-Settings-Store':'seller_bob'})).status,409);assert.equal((await f.app.request(url,body,{...headers,Origin:'https://other.example'})).status,403);
  for(const target of [base+'/history?kind=profile&kind=notifications',base+'/history?kind=profile&environment=production',base+'?seller=seller_bob',base+'/history?kind=profile&cursor=x#part'])assert.equal((await f.app.request('/cart/admin/?cloud='+encodeURIComponent(target),undefined,headers)).status,400);
  assert.equal(await f.count('commerce_settings_changes'),0);
  f.control.afterResponse=async path=>{if(path!==base||!f.control.calls.at(-1)?.body)return;f.control.afterResponse=null;f.app.cli(`define('EZ_CUSTOMER_SESSION_BRIDGE', true); session_id('${f.cookie.value}'); require '${process.cwd()}/cart/admin/index.php'; $_SESSION['admin_user']=['id'=>'bob','email'=>'bob@example.test']; $_SESSION['csrf_token']='changed'; session_write_close();`);};
  await form(p).getByLabel(/^Store name/).fill('Confirmed before sign-in changed');await form(p).getByRole('button',{name:'Save store details',exact:true}).click();await root(p).getByRole('link',{name:'Reload sign-in',exact:true}).waitFor();assert.equal(await root(p).locator('input').count(),0);assert.equal(await f.count('commerce_settings_changes'),1);
});

test('viewer can save personal preferences during the commerce hold, and historical reads retain pages after a failure',async t=>{
  const f=await fixture(t,{EZKART_COMMERCE_STORAGE:'legacy'}),b=await browser(t);const initial=(await f.read()).profile.values;
  for(let revision=0;revision<23;revision++)assert.equal((await f.save('profile',{...initial,name:'Store '+revision},revision)).status,200);
  await f.db.prepare("UPDATE seller_memberships SET role='viewer' WHERE auth_user_id='alice'").run();const p=await pageFor(b,f,390);await open(p,f);assert.equal(await form(p).getByLabel(/^Store name/).isDisabled(),true);
  await form(p,'notifications').getByLabel('Payment confirmed: in-app',{exact:true}).uncheck();await save(p,'notifications');assert.equal((await f.read()).notifications.values.payment_confirmed.inApp,false);
  await form(p).getByRole('button',{name:'View store history',exact:true}).click();const dialog=root(p).getByRole('dialog',{name:'Store details history',exact:true});await dialog.getByText('20 saved changes shown.',{exact:true}).waitFor();let fail=true;
  await p.route('**/cart/admin/?cloud=*',async route=>{const path=new URL(route.request().url()).searchParams.get('cloud');if(fail&&path?.includes('/settings/history?')&&path.includes('cursor=')){fail=false;await route.fulfill({status:503,json:{ok:false,error:'History interrupted'}});return;}await route.continue();});
  await dialog.getByRole('button',{name:'Load older changes'}).click();await dialog.getByText('History interrupted',{exact:true}).waitFor();assert.equal(await dialog.locator('li').count(),20);await dialog.getByRole('button',{name:'Try history again'}).click();await dialog.getByText('23 saved changes shown.',{exact:true}).waitFor();assert.equal(await dialog.locator('li').count(),23);await dialog.locator('summary').first().click();assert.equal(await dialog.getByText('Store 22',{exact:true}).count(),1);
});

test('settings storage failure prevents writes and saved date preferences are used in the order workspace',async t=>{
  const f=await fixture(t),b=await browser(t),p=await pageFor(b,f);await p.addInitScript(()=>{Storage.prototype.setItem=()=>{throw new Error('Storage unavailable');};});await open(p,f);
  await form(p).getByLabel(/^Store name/).fill('Cannot safely save');assert.equal(await form(p).getByRole('button',{name:'Save store details',exact:true}).isDisabled(),true);assert.equal(await f.count('commerce_settings_changes'),0);await p.context().close();
  const values=(await f.read()).profile.values;assert.equal((await f.save('profile',{...values,timezone:'Asia/Makassar',dateFormat:'numeric'},0)).status,200);
  const made=await f.create(f.input());assert.equal(made.status,200,made.error);const order=await pageFor(b,f,390);await order.goto(f.app.base+'/cart/admin/?page=orders&order='+made.order.id);
  const expected=await order.evaluate(value=>window.EzkartAdminFormat.date(value),made.order.createdAt);assert.match(expected,/^\d{2}\/\d{2}\/\d{4} \d{2}:\d{2} WITA$/);await order.getByText(expected,{exact:true}).first().waitFor();assert.equal(await order.evaluate(()=>window.EzkartAdminFormat.date('2026-09-26T16:30:00Z')),'27/09/2026 00:30 WITA');
});
