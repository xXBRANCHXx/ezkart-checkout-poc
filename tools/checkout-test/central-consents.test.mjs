import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdir,writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {randomBytes} from 'node:crypto';
import {setupCentralFixture} from './central-fixture.mjs';

const endpoint='/cart/admin/customer-consents.php',service='/internal/commerce/customer-consents',buyer={id:'fixture-google-customer',email:'checkout@example.com'},screens='/tmp/ezkart-consents-ui-01a0d643';
const loaded=page=>page.waitForFunction(()=>document.querySelector('[data-consent-status]')?.textContent==='Your preferences are up to date.');
const saved=page=>page.waitForFunction(()=>document.querySelector('[data-consent-save-status]')?.textContent.startsWith('Saved.'));
const key=()=>randomBytes(16).toString('hex');
async function fixture(t,overrides={}){
  const f=await setupCentralFixture(t,overrides),made=await f.create(f.input({customer:{name:'Buyer',email:buyer.email,phone:'081234567890'}}));assert.equal(made.status,200,made.error);
  return {...f,order:made.order,cookie:f.app.customerCookie()};
}
async function browser(t){const {chromium}=await import('../builder-mcp/node_modules/playwright/index.mjs'),b=await chromium.launch({headless:true});t.after(()=>b.close());return b;}
async function pageFor(b,f,width=1360,cookies=[f.cookie]){const context=await b.newContext({viewport:{width,height:960},reducedMotion:'reduce'});await context.addCookies(cookies);const p=await context.newPage();p.setDefaultTimeout(12000);return p;}
async function open(p,f){await p.goto(f.app.base+'/cart/preferences.php?order='+f.order.id);await loaded(p);}
const headers=async (p,f)=>({Cookie:f.cookie.name+'='+f.cookie.value,'X-Ezkart-Customer-Session':await p.locator('[data-customer-consents]').getAttribute('data-version'),'X-Ezkart-CSRF':await p.locator('[data-customer-consents]').getAttribute('data-csrf')});
const data=(action,fields={})=>({environment:'sandbox',customer:buyer,action,...fields});
async function choose(f,revision,allow){const book=await f.call(service,data('list')),item=book.items.find(i=>i.email===buyer.email);return f.call(service,data('save',{sellerId:item.sellerId,email:item.email,revision,allow,requestKey:key(),policyVersion:item.policyVersion,statement:item.statement}));}

test('buyers explicitly grant and withdraw store email permission with durable history on desktop and mobile',async t=>{
  const f=await fixture(t),b=await browser(t);await mkdir(screens,{recursive:true});
  await f.db.prepare("UPDATE sellers SET name=? WHERE id='seller_alice'").bind('Alice Tea <img src=x onerror=alert(1)>').run();
  for(const width of [1360,390]){
    const page=await pageFor(b,f,width),errors=[];page.on('pageerror',e=>errors.push(e.message));await open(page,f);
    assert.equal(await page.locator('input[name=allow]').isChecked(),false);assert.equal(await page.locator('[data-consent-card] img').count(),0);
    await page.getByRole('button',{name:'Save email preference',exact:true}).click();assert.equal(await f.count('commerce_customer_consent_changes'),width===1360?0:2);
    await page.locator('input[name=allow]').check();await page.getByRole('button',{name:'Save email preference',exact:true}).click();await saved(page);
    assert.equal(await page.locator('[data-state=granted]').count(),1);await page.reload();await loaded(page);await page.getByRole('button',{name:'Stop promotional emails'}).waitFor();
    const customer=(await f.merchant('/v1/commerce/customers')).items[0];assert.equal((await f.merchant('/v1/commerce/customers/'+customer.id)).customer.marketingConsent,'granted');
    await page.getByRole('button',{name:'Stop promotional emails'}).click();await saved(page);assert.equal(await page.locator('[data-state=withdrawn]').count(),1);
    await page.getByText('Preference history',{exact:true}).click();await page.waitForFunction(()=>document.querySelectorAll('.preference-history li').length>=2);
    assert.match(await page.locator('.preference-history').innerText(),/Email permission withdrawn/);assert.match(await page.locator('.preference-history').innerText(),/Email permission granted/);
    assert.equal((await f.merchant('/v1/commerce/customers/'+customer.id)).customer.marketingConsent,'withdrawn');
    assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);await page.screenshot({path:screens+'/preferences-'+width+'.png',fullPage:true});assert.deepEqual(errors,[]);await page.context().close();
  }
  assert.equal(await f.count('commerce_customer_consent_changes'),4);assert.equal((await f.providerCalls()).length,0);
});

test('lost save replies keep the original choice and two-tab conflicts require a fresh explicit choice',async t=>{
  const f=await fixture(t),b=await browser(t),a=await pageFor(b,f),other=await pageFor(b,f);await open(a,f);await open(other,f);
  f.control.drop=service;await a.locator('input[name=allow]').check();await a.getByRole('button',{name:'Save email preference',exact:true}).click();await a.getByRole('button',{name:'Retry confirmation'}).waitFor();
  assert.equal(await f.count('commerce_customer_consent_changes'),1);assert.equal(await a.locator('[data-consent-refresh]').isDisabled(),true);assert.equal(await a.locator('input[name=allow]').isDisabled(),true);
  await a.getByRole('button',{name:'Retry confirmation'}).click();await saved(a);assert.equal(await f.count('commerce_customer_consent_changes'),1);
  await other.locator('input[name=allow]').check();await other.getByRole('button',{name:'Save email preference',exact:true}).click();await other.getByRole('button',{name:'Reload saved preferences'}).waitFor();assert.match(await other.locator('[data-consent-save-status]').textContent(),/another session/);
  await other.getByRole('button',{name:'Reload saved preferences'}).click();await loaded(other);await other.getByRole('button',{name:'Stop promotional emails'}).click();await saved(other);
  await a.getByRole('button',{name:'Stop promotional emails'}).click();await a.getByRole('button',{name:'Reload saved preferences'}).waitFor();await a.getByRole('button',{name:'Reload saved preferences'}).click();await loaded(a);
  assert.equal(await a.locator('input[name=allow]').isChecked(),false);assert.equal(await f.count('commerce_customer_consent_changes'),2);
  f.control.fail=service;await a.locator('[data-consent-refresh]').click();await a.locator('[data-consent-error]').waitFor();assert.equal(await a.locator('[data-consent-card]').count(),1);
  f.control.fail='';await a.locator('[data-consent-refresh]').click();await loaded(a);assert.equal(await a.locator('[data-consent-error]').isVisible(),false);
});

test('proxy checks current verified identity, CSRF, origin, session version and strict request fields',async t=>{
  const f=await fixture(t),b=await browser(t),p=await pageFor(b,f);assert.equal((await f.app.request(endpoint)).status,401);await open(p,f);const h=await headers(p,f);
  const book=(await f.app.request(endpoint,undefined,h)).data,item=book.items[0],body={sellerId:item.sellerId,email:item.email,revision:0,allow:true,requestKey:key(),policyVersion:item.policyVersion,statement:item.statement};
  const {['X-Ezkart-CSRF']:unused,...noCsrf}=h;assert.equal((await f.app.request(endpoint,body,noCsrf)).status,403);
  assert.equal((await f.app.request(endpoint,body,{...h,Origin:'https://unrelated.example'})).status,403);
  assert.equal((await f.app.request(endpoint,body,{...h,'X-Ezkart-Customer-Session':'another-session'})).status,401);
  for(const patch of [{customer:{id:'attacker',email:buyer.email}},{environment:'production'},{actor:'alice'},{channel:'whatsapp'}])assert.equal((await f.app.request(endpoint,{...body,...patch},h)).status,422);
  for(const query of ['cursor=a&cursor=b','order[]=x','customer=someone','action=history','seller=bob'])assert.equal((await f.app.request(endpoint+'?'+query,undefined,h)).status,400);
  assert.equal((await f.app.request(endpoint+'?order=bad',body,h)).status,400);
  await writeFile(join(f.app.directory,'auth-response.json'),JSON.stringify({user:{email_confirmed_at:null}}));assert.equal((await f.app.request(endpoint,body,h)).status,401);
  await writeFile(join(f.app.directory,'auth-response.json'),JSON.stringify({user:{id:'other-account'}}));assert.equal((await f.app.request(endpoint,body,h)).status,401);
  await writeFile(join(f.app.directory,'auth-response.json'),JSON.stringify({user:{factors:[{status:'verified'}]}}));assert.equal((await f.app.request(endpoint,body,h)).status,401);
  await writeFile(join(f.app.directory,'auth-response.json'),JSON.stringify({user_error:true}));assert.equal((await f.app.request(endpoint,body,h)).status,503);
  assert.equal(await f.count('commerce_customer_consent_changes'),0);
  await writeFile(join(f.app.directory,'auth-response.json'),'{}');assert.equal((await f.app.request(endpoint,body,h)).status,200);
  assert(!JSON.stringify((await f.app.request(endpoint,undefined,h)).data).match(/access_token|auth_user_id|request_hash/));
  const signed=f.control.calls.filter(c=>c.path===service);assert(signed.every(c=>c.body.customer.id===buyer.id&&c.body.customer.email===buyer.email));
});

test('a changed login during a write hides the response and an old page cannot write as the new login',async t=>{
  const f=await fixture(t),b=await browser(t),p=await pageFor(b,f);await open(p,f);const h=await headers(p,f);
  f.control.afterResponse=async path=>{if(path!==service)return;f.control.afterResponse=null;
    f.app.cli(`require '${process.cwd()}/cart/api/customer-auth.php'; session_id('${f.cookie.value}'); ez_customer_session(); $_SESSION['customer_auth']['version']='changed-session'; session_write_close();`);};
  await p.locator('input[name=allow]').check();await p.getByRole('button',{name:'Save email preference',exact:true}).click();await p.getByRole('button',{name:'Reload sign-in'}).waitFor();
  assert.equal(await p.locator('[data-consent-card]').count(),0);assert.equal(await p.locator('[data-consent-account]').textContent(),'');assert.equal(await f.count('commerce_customer_consent_changes'),1);
  assert.equal((await f.app.request(endpoint,{},h)).status,401);
  await p.getByRole('button',{name:'Reload sign-in'}).click();await loaded(p);await p.getByRole('button',{name:'Stop promotional emails'}).waitFor();
});

test('history retries preserve pages, ignore late results after refresh and show previous email withdrawal',async t=>{
  const f=await fixture(t),b=await browser(t),p=await pageFor(b,f,390);await open(p,f);for(let n=0;n<43;n++)assert.equal((await choose(f,n,true)).status,200);
  await p.locator('[data-consent-refresh]').click();await loaded(p);let fail=true;
  await p.route('**/customer-consents.php?*',async route=>{const url=new URL(route.request().url());if(fail&&url.searchParams.get('action')==='history'){fail=false;await route.fulfill({status:503,json:{ok:false,error:'History interrupted'}});return;}await route.continue();});
  await p.getByText('Preference history',{exact:true}).click();await p.getByRole('button',{name:'Retry history',exact:true}).click();await p.waitForFunction(()=>document.querySelectorAll('.preference-history li').length===20);
  fail=true;await p.locator('.preference-history button').click();await p.getByRole('button',{name:'Retry older changes'}).waitFor();assert.equal(await p.locator('.preference-history li').count(),20);
  await p.getByRole('button',{name:'Retry older changes'}).click();await p.waitForFunction(()=>document.querySelectorAll('.preference-history li').length===40);await p.locator('.preference-history button').click();await p.waitForFunction(()=>document.querySelectorAll('.preference-history li').length===43);
  let release;const hold=new Promise(resolve=>{release=resolve;});let seen;const waiting=new Promise(resolve=>{seen=resolve;});
  await p.unroute('**/customer-consents.php?*');await p.locator('[data-consent-refresh]').click();await loaded(p);
  await p.route('**/customer-consents.php?*',async route=>{if(new URL(route.request().url()).searchParams.get('action')==='history'){const response=await route.fetch();seen();await hold;await route.fulfill({response});}else await route.continue();});
  await p.getByText('Preference history',{exact:true}).click();await waiting;await p.locator('[data-consent-refresh]').click();await loaded(p);release();await p.waitForTimeout(80);assert.equal(await p.locator('.preference-history li').count(),0);
  await p.unroute('**/customer-consents.php?*');await writeFile(join(f.app.directory,'auth-response.json'),JSON.stringify({user:{email:'new@example.com'}}));await p.locator('[data-consent-refresh]').click();await loaded(p);
  assert.equal(await p.locator('[data-consent-card]').count(),2);const old=p.locator('[data-consent-card]').filter({has:p.getByText(buyer.email,{exact:true})});
  assert.equal(await old.locator('input').count(),0);await old.getByRole('button',{name:'Stop promotional emails'}).click();await old.getByText('Saved. Promotional emails are stopped.',{exact:true}).waitFor();
  assert.equal(await old.getByRole('button',{name:'Save email preference',exact:true}).count(),0);assert.equal(await p.locator('input[name=allow]').isChecked(),false);
});

test('preferences reuse the existing verified Google session, retain a safe redirect and respect the central rollout flag',async t=>{
  const f=await fixture(t),b=await browser(t),p=await pageFor(b,f,1360,[f.app.adminCookie()]);await open(p,f);
  const cookie=(await p.context().cookies()).find(c=>c.name==='ezkart_customer');assert(cookie);
  assert.equal(f.app.cli(`require '${process.cwd()}/cart/api/customer-auth.php'; session_id('${cookie.value}'); ez_customer_session(); echo isset($_SESSION['customer_auth']['access_token']) ? 'token' : 'no-token'; session_write_close();`),'no-token');
  await p.context().addCookies([f.app.adminCookie({admin_user:{id:'other-account',email:'other@example.com'}})]);await p.locator('[data-consent-refresh]').click();await p.getByRole('button',{name:'Reload sign-in'}).waitFor();assert.equal(await p.locator('[data-consent-card]').count(),0);
  const anonymous=await pageFor(b,f,390,[]);await anonymous.goto(f.app.base+'/cart/preferences.php?order='+f.order.id+'&seller=attacker');await anonymous.getByRole('button',{name:'Sign in to continue',exact:true}).waitFor();
  assert.match(await anonymous.locator('#auth-description').textContent(),/promotional emails/);assert.equal(await anonymous.locator('#tracking-signin input[name=next]').inputValue(),'/cart/preferences.php?order='+f.order.id);
  const disabled=await fixture(t,{EZKART_COMMERCE_STORAGE:'legacy'}),d=await pageFor(b,disabled);await d.goto(disabled.app.base+'/cart/preferences.php');assert.match(await d.locator('main').innerText(),/not available/);assert.equal(await d.locator('[data-consent-card]').count(),0);assert.equal(disabled.control.calls.filter(c=>c.path===service).length,0);
});

test('store pagination retains its cursor after a failed page and refresh returns to the current first page',async t=>{
  const f=await fixture(t),b=await browser(t),p=await pageFor(b,f,390);
  for(let n=0;n<26;n++){
    const seller='seller_store'+String(n).padStart(2,'0');await f.db.prepare("INSERT INTO sellers(id,slug,name,created_at,updated_at) VALUES(?,?,?,'now','now')").bind(seller,'store'+n,'Store '+n).run();await f.product('product'+n,10,seller);
    const created=await f.create(f.input({sellerId:seller,customer:{name:'Buyer',email:buyer.email,phone:'081234567890',authUserId:buyer.id},items:[{productId:'product'+n,quantity:1,expectedPrice:20000,expectedWeightGrams:100}]}));assert.equal(created.status,200,created.error);
  }
  await open(p,f);assert.equal(await p.locator('[data-consent-card]').count(),25);let fail=true;
  await p.route('**/customer-consents.php?*',async route=>{if(fail&&new URL(route.request().url()).searchParams.has('cursor')){fail=false;await route.fulfill({status:503,json:{ok:false,error:'Page interrupted'}});}else await route.continue();});
  await p.getByRole('button',{name:'Load more stores',exact:true}).click();await p.locator('[data-consent-error]').waitFor();assert.equal(await p.locator('[data-consent-card]').count(),25);
  await p.getByRole('button',{name:'Load more stores',exact:true}).click();await p.waitForFunction(()=>document.querySelectorAll('[data-consent-card]').length===27);assert.equal(await p.locator('[data-consent-more]').isVisible(),false);
  assert.equal(new Set(await p.locator('[data-consent-card]').evaluateAll(nodes=>nodes.map(n=>n.dataset.seller))).size,27);
  await p.locator('[data-consent-refresh]').click();await loaded(p);assert.equal(await p.locator('[data-consent-card]').count(),25);assert.equal(await p.locator('[data-consent-more]').isVisible(),true);
  assert.equal(await p.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);assert.equal(await f.count('commerce_customer_consent_changes'),0);
});
