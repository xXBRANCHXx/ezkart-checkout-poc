import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdir} from 'node:fs/promises';
import {randomBytes} from 'node:crypto';
import {setupCentralFixture} from './central-fixture.mjs';
import {digitalFixtureFile} from '../../cloudflare/ezkart-api/test/digital-commerce-fixture.mjs';
import {fixtureShipping} from '../../cloudflare/ezkart-api/test/commerce-fixture.mjs';

const buyer='fixture-google-customer',key=()=>randomBytes(16).toString('hex'),root=p=>p.locator('[data-refunds]');
async function fixture(t){
  const f=await setupCentralFixture(t),file=await digitalFixtureFile(f);
  const order=async()=>{const created=await f.create(f.input({items:[file.item,{productId:'tea',quantity:2,expectedPrice:20000,expectedWeightGrams:100}],shipping:fixtureShipping,customer:{name:'Private buyer',email:'checkout@example.com',phone:'081234567890',authUserId:buyer}}));assert.equal(created.status,200,created.error);const paid=await f.paid(created.order);assert.equal(paid.status,200);return paid.order;};
  const customerCookie=f.app.customerCookie('checkout@example.com',buyer,3600,await f.merchantToken(buyer,'checkout@example.com'));
  const merchantCookie=f.app.adminCookie({supabase_access_token:await f.merchantToken('alice','alice@example.test'),admin_user:{id:'alice',email:'alice@example.test'}});
  const {chromium}=await import('../builder-mcp/node_modules/playwright/index.mjs'),b=await chromium.launch({headless:true});t.after(()=>b.close());
  const page=async(kind,width=1360)=>{const c=await b.newContext({viewport:{width,height:1000},reducedMotion:'reduce'});await c.addCookies([kind==='buyer'?customerCookie:merchantCookie]);const p=await c.newPage();p.setDefaultTimeout(15000);return p;};
  return {...f,order,page,customerCookie,merchantCookie};
}
async function openBuyer(p,f,order){await p.goto(f.app.base+'/cart/return.php?order='+order.id);await root(p).getByRole('button',{name:'Request a refund',exact:true}).waitFor();await p.waitForFunction(()=>/up to date|No refund requests yet/.test(document.querySelector('[data-refund-status]')?.textContent||''));}
async function fill(p,order){await root(p).getByRole('button',{name:'Request a refund',exact:true}).click();await root(p).locator('[name=note]').fill('The original file has <img src=x onerror=alert(1)> unreadable instructions.');await root(p).locator('[name=reason]').selectOption('file_problem');await root(p).locator('[data-refund-amount="'+order.items.find(i=>i.productType==='digital').id+'"]').fill('1000');}

test('buyer refund requests recover exact lost responses across reloads and merchant decisions stay distinct from payment on desktop and mobile',async t=>{
  const f=await fixture(t),screens='/tmp/ezkart-refunds-ui-01a0d643';await mkdir(screens,{recursive:true});
  for(const width of [1360,390]){
    const order=await f.order(),p=await f.page('buyer',width),errors=[];p.on('pageerror',e=>errors.push(e.message));await openBuyer(p,f,order);await fill(p,order);
    const path='/v1/customer/orders/'+order.id+'/refunds';f.control.drop=path;
    const lost=p.waitForResponse(r=>r.url().includes('/customer-refunds.php?')&&r.request().method()==='POST');await root(p).getByRole('button',{name:'Submit refund request',exact:true}).click();assert.equal((await lost).status(),503);
    await root(p).getByRole('button',{name:'Retry confirmation',exact:true}).waitFor();const sent=f.control.calls.filter(c=>c.path===path&&c.body).at(-1).body;
    await p.reload();await root(p).getByRole('button',{name:'Retry confirmation',exact:true}).click();await root(p).getByText('Your refund request was saved.',{exact:true}).waitFor();
    assert.deepEqual(f.control.calls.filter(c=>c.path===path&&c.body).at(-1).body,sent);const r=(await f.merchant(path,undefined,{seller:buyer})).refunds[0];assert.equal(await f.count('commerce_refunds'),width===1360?1:2);
    assert.equal(await root(p).locator('img[onerror]').count(),0);assert.equal(await p.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);await root(p).screenshot({path:screens+'/buyer-'+width+'.png'});
    const m=await f.page('merchant',width);m.on('pageerror',e=>errors.push(e.message));await m.goto(f.app.base+'/cart/admin/?page=orders');await m.getByRole('link',{name:'Refunds',exact:true}).click();
    await root(m).locator('[data-refund-case="'+r.id+'"]').click();await root(m).getByLabel('Message for the buyer',{exact:true}).fill('The original file issue is confirmed.');await root(m).getByRole('button',{name:'Approve request',exact:true}).click();await root(m).getByText('Your refund request was saved.',{exact:true}).waitFor();
    await root(m).getByText('This refund request is approved. The refund has not been paid. Refund processing is not available yet.',{exact:true}).waitFor();assert.equal(await m.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);await root(m).screenshot({path:screens+'/merchant-'+width+'.png'});
    await m.evaluate(()=>window.scrollTo(0,0));await m.screenshot({path:screens+'/merchant-page-'+width+'.png',fullPage:true});
    assert.equal((await f.db.prepare('SELECT checkout_state FROM orders WHERE id=?').bind(order.id).first()).checkout_state,'paid');assert.deepEqual(errors,[]);await p.context().close();await m.context().close();
  }
  assert.equal((await f.providerCalls()).length,0);assert.equal(await f.count('commerce_refund_actions'),2);
});

test('merchant-created partial requests retain their decisions across interrupted responses and stale decisions require reviewing the saved case',async t=>{
  const f=await fixture(t),order=await f.order(),p=await f.page('merchant',390);await p.goto(f.app.base+'/cart/admin/?page=refunds');
  await root(p).getByRole('button',{name:'Request a refund',exact:true}).click();await root(p).getByLabel('Order reference',{exact:true}).fill(order.id);await root(p).getByRole('button',{name:'Find order',exact:true}).click();
  await root(p).locator('[name=note]').fill('A partial price adjustment for the original purchase.');await root(p).locator('[data-refund-amount="'+order.items[0].id+'"]').fill('2000');await root(p).getByRole('button',{name:'Submit refund request',exact:true}).click();await root(p).getByText('Your refund request was saved.',{exact:true}).waitFor();
  const r=(await f.merchant('/v1/commerce/refunds')).refunds[0],path='/v1/commerce/refunds/'+r.id;
  await root(p).getByLabel('Message for the buyer',{exact:true}).fill('The partial request has been approved.');f.control.drop=path;
  const interrupted=p.waitForResponse(res=>res.request().method()==='POST'&&new URL(res.url()).searchParams.get('cloud')===path);await root(p).getByRole('button',{name:'Approve request',exact:true}).click();assert.equal((await interrupted).status(),503);
  const sent=f.control.calls.filter(c=>c.path===path&&c.body).at(-1).body;await p.reload();await root(p).getByRole('button',{name:'Retry confirmation',exact:true}).click();await root(p).getByText('Your refund request was saved.',{exact:true}).waitFor();assert.equal(await f.count('commerce_refund_actions'),1);assert.deepEqual(f.control.calls.filter(c=>c.path===path&&c.body).at(-1).body,sent);
  const next=await f.merchant('/v1/customer/orders/'+order.id+'/refunds',{requestKey:key(),orderRevision:order.revision,reason:'other',note:'Another portion needs review.',items:[{orderItemId:order.items[0].id,amount:1000}],shippingAmount:0},{seller:buyer,method:'POST'});assert.equal(next.status,200);const current=next.refund;
  await root(p).getByRole('button',{name:'Refresh refunds',exact:true}).click();await root(p).locator('[data-refund-case="'+current.id+'"]').click();await root(p).getByLabel('Message for the buyer',{exact:true}).fill('This decision is now stale.');
  assert.equal((await f.merchant('/v1/customer/orders/'+order.id+'/refunds/'+current.id,{requestKey:key(),revision:1,orderRevision:order.revision,kind:'withdraw',message:'The request is no longer needed.'},{seller:buyer,method:'POST'})).status,200);
  await root(p).getByRole('button',{name:'Approve request',exact:true}).click();await root(p).getByRole('button',{name:'Review changes',exact:true}).click();await root(p).locator('[data-refund-detail]').getByRole('heading',{name:'Withdrawn',exact:true}).waitFor();assert.equal(await root(p).getByRole('button',{name:'Approve request',exact:true}).count(),0);assert.equal(await f.count('commerce_refund_actions'),2);
});

test('blocked or damaged browser recovery prevents a new refund request before any write',async t=>{
  const f=await fixture(t),order=await f.order(),p=await f.page('buyer',390);await openBuyer(p,f,order);await fill(p,order);
  await p.evaluate(()=>{Storage.prototype.setItem=function(){throw Error('Browser storage blocked');};});
  await root(p).getByRole('button',{name:'Submit refund request',exact:true}).click();await root(p).locator('[data-refund-error]').getByText('Browser storage blocked',{exact:true}).waitFor();assert.equal(await f.count('commerce_refunds'),0);
  await root(p).getByRole('button',{name:'Cancel',exact:true}).click();await p.reload();await root(p).getByRole('button',{name:'Request a refund',exact:true}).waitFor();
  await p.evaluate(async order=>{const d=document.querySelector('[data-refunds]').dataset,scope=JSON.stringify([d.audience,d.account,d.store,d.order]);
    const record={v:1,scope,path:'/v1/customer/orders/'+order.id+'/refunds',body:JSON.stringify({requestKey:'a'.repeat(32),orderRevision:order.revision,reason:'other',note:'Original request.',items:[{orderItemId:order.items[0].id,amount:1000}],shippingAmount:0})};
    record.checksum=[...new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(JSON.stringify([record.v,record.scope,record.path,record.body]))))].map(n=>n.toString(16).padStart(2,'0')).join('');
    const altered=JSON.parse(record.body);altered.items[0].amount=2000;record.body=JSON.stringify(altered);localStorage.setItem('ezkart.refunds.pending.v1:'+scope,JSON.stringify(record));
  },order);
  await p.reload();await root(p).getByText('Saved retry data could not be read. Review your request history and contact support before submitting again.',{exact:true}).waitFor();assert.equal(await root(p).getByRole('button',{name:'Request a refund',exact:true}).isDisabled(),true);assert.equal(await f.count('commerce_refunds'),0);
});

test('refund proxies reject forged scope and suppress a committed buyer response after its session changes',async t=>{
  const f=await fixture(t),order=await f.order(),p=await f.page('buyer');await openBuyer(p,f,order);
  const headers={Cookie:f.customerCookie.name+'='+f.customerCookie.value,'X-Ezkart-Customer-Session':await root(p).getAttribute('data-version'),'X-Ezkart-CSRF':await root(p).getAttribute('data-csrf')},endpoint='/cart/admin/customer-refunds.php?order='+order.id;
  const body={requestKey:key(),orderRevision:order.revision,reason:'other',note:'A refund request for this purchase.',items:[{orderItemId:order.items[0].id,amount:1000}],shippingAmount:0};
  assert.equal((await f.app.request(endpoint,body,{})).status,401);assert.equal((await f.app.request(endpoint,body,{...headers,'X-Ezkart-CSRF':'bad'})).status,403);
  for(const suffix of ['&order='+order.id,'&environment=production','&refund[]=x','&cursor=broken!'])assert.equal((await f.app.request(endpoint+suffix,undefined,headers)).status,400);
  const path='/v1/customer/orders/'+order.id+'/refunds';f.control.afterResponse=async target=>{if(target!==path||!f.control.calls.at(-1)?.body)return;f.control.afterResponse=null;f.app.cli(`require '${process.cwd()}/cart/api/customer-auth.php'; session_id('${f.customerCookie.value}'); ez_customer_session(); $_SESSION['customer_auth']['version']='new-session'; session_write_close();`);};
  await fill(p,order);await root(p).getByRole('button',{name:'Submit refund request',exact:true}).click();await root(p).getByRole('button',{name:'Reload sign-in',exact:true}).waitFor();assert.equal(await f.count('commerce_refunds'),1);assert.equal(await root(p).locator('[data-refund-case]').count(),0);assert.equal(await root(p).locator('[data-refund-detail]').isVisible(),false);
});

test('the merchant refund proxy binds its current account and store, and hides late results after authentication changes',async t=>{
  const f=await fixture(t),order=await f.order(),p=await f.page('merchant');await p.goto(f.app.base+'/cart/admin/?page=refunds');await root(p).getByRole('button',{name:'Request a refund',exact:true}).waitFor();
  const headers={Cookie:f.merchantCookie.name+'='+f.merchantCookie.value,'X-Ezkart-Refund-Account':'alice','X-Ezkart-Refund-Store':'seller_alice','X-Ezkart-CSRF':await root(p).getAttribute('data-csrf')},base='/v1/commerce/refunds',path=base+'/orders/'+order.id,url=target=>'/cart/admin/?cloud='+encodeURIComponent(target);
  assert.equal((await f.app.request(url(base),undefined,{...headers,'X-Ezkart-Refund-Account':'bob'})).status,401);assert.equal((await f.app.request(url(base),undefined,{...headers,'X-Ezkart-Refund-Store':'seller_bob'})).status,409);
  for(const target of [base+'?state=all&state=open',base+'?environment=production',base+'/orders/'+order.id+'#fragment',base+'/fake'])assert.equal((await f.app.request(url(target),undefined,headers)).status,400);
  f.control.afterResponse=async target=>{if(target!==path||!f.control.calls.at(-1)?.body)return;f.control.afterResponse=null;f.app.cli(`define('EZ_CUSTOMER_SESSION_BRIDGE', true); session_id('${f.merchantCookie.value}'); require '${process.cwd()}/cart/admin/index.php'; $_SESSION['admin_user']=['id'=>'bob','email'=>'bob@example.test']; $_SESSION['csrf_token']='changed'; session_write_close();`);};
  await root(p).getByRole('button',{name:'Request a refund',exact:true}).click();await root(p).getByLabel('Order reference',{exact:true}).fill(order.id);await root(p).getByRole('button',{name:'Find order',exact:true}).click();
  await root(p).locator('[name=note]').fill('A saved request with a changed sign-in.');await root(p).locator('[data-refund-amount="'+order.items[0].id+'"]').fill('1000');await root(p).getByRole('button',{name:'Submit refund request',exact:true}).click();await root(p).getByRole('button',{name:'Reload sign-in',exact:true}).waitFor();
  assert.equal(await f.count('commerce_refunds'),1);assert.equal(await root(p).locator('[data-refund-case]').count(),0);assert.equal(await root(p).locator('[data-refund-detail]').isVisible(),false);
});
