import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdir,writeFile,readFile} from 'node:fs/promises';
import {join} from 'node:path';
import {randomBytes} from 'node:crypto';
import {setupCentralFixture as setupBaseFixture} from './central-fixture.mjs';
import {seedDeclaredOnboarding} from '../../cloudflare/ezkart-api/test/onboarding-fixture.mjs';
async function setupCentralFixture(...args){const f=await setupBaseFixture(...args);await seedDeclaredOnboarding(f.db);return f;}
import {browser,pageFor,choose} from './review-workspace-fixture.mjs';
const buyer='fixture-google-customer',key=()=>randomBytes(16).toString('hex'),screens='/tmp/ezkart-messages-ui-01a0d643';
const png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a8x8AAAAASUVORK5CYII=','base64');
const root=p=>p.locator('[data-message-workspace]'),loaded=p=>p.waitForFunction(()=>/conversations loaded|No conversations/.test(document.querySelector('[data-msg-list-status]')?.textContent||''));
async function fixture(t,overrides={}){
  const f=await setupCentralFixture(t,overrides),token=await f.merchantToken(buyer,'checkout@example.com');
  await f.db.prepare((await readFile(new URL('../../cloudflare/ezkart-api/migrations/0006_customer_addresses.sql',import.meta.url),'utf8')).replace(/--[^\n]*/g,'')).run();
  const buyerCookie=f.app.customerCookie('checkout@example.com',buyer,3600,token),cookie=f.app.adminCookie({supabase_access_token:await f.merchantToken('alice','alice@example.test'),admin_user:{id:'alice',email:'alice@example.test'}});
  const created=await f.create(f.input({customer:{name:'Jasmine Buyer',email:'checkout@example.com',phone:'081234567890',authUserId:buyer}}));assert.equal(created.status,200,created.error);
  const customer=(path,body)=>f.merchant('/v1/customer/messages'+path,body,{seller:buyer,method:body===undefined?'GET':'POST'});
  const r=await customer('',{context:{kind:'order',id:created.order.id}});assert.equal(r.status,200,r.error);
  const id=r.conversation.id,send=body=>customer('/'+id,{kind:'message',body,photos:[],requestKey:key()});
  const merchant=body=>f.merchant('/v1/commerce/messages/'+id,body,{method:body===undefined?'GET':'POST'});
  return {...f,cookie,buyerCookie,customer,id,send,thread:merchant,order:created.order};
}
async function openBuyer(p,f){await p.goto(f.app.base+'/cart/messages.php?conversation='+f.id);await root(p).getByLabel('Message',{exact:true}).waitFor();}
async function openStore(p,f){await p.goto(f.app.base+'/cart/admin/?page=messages&conversation='+f.id);await root(p).getByLabel('Message',{exact:true}).waitFor();}
async function send(p,text){await root(p).getByLabel('Message',{exact:true}).fill(text);await root(p).getByRole('button',{name:'Send message',exact:true}).click();await root(p).getByText('Message sent.',{exact:true}).waitFor();}
const refresh=async p=>{await root(p).getByRole('button',{name:'Refresh conversation',exact:true}).click();};
test('buyer and merchant exchange real messages and photos, use saved replies and resolve on desktop and mobile',async t=>{
  const f=await fixture(t),b=await browser(t);await mkdir(screens,{recursive:true});
  for(const width of [1360,390]){
    const buyerPage=await pageFor(b,f,width,f.buyerCookie),storePage=await pageFor(b,f,width),errors=[];
    for(const p of [buyerPage,storePage])p.on('pageerror',e=>errors.push(e.message));
    await openBuyer(buyerPage,f);await send(buyerPage,'Question about delivery '+width+' <img src=x onerror=alert(1)>');
    await root(buyerPage).locator('[data-msg-file]').setInputFiles({name:'photo.png',mimeType:'image/png',buffer:png});await root(buyerPage).getByText('Photo attached to your draft.',{exact:true}).waitFor();
    await send(buyerPage,'Here is the package '+width);await openStore(storePage,f);await root(storePage).locator('[data-msg-timeline]').getByText('Here is the package '+width,{exact:true}).waitFor();
    await root(storePage).getByRole('button',{name:'Open attached photo 1'}).last().click();await root(storePage).getByRole('dialog',{name:'Message photo'}).waitFor();await storePage.keyboard.press('Escape');
    await root(storePage).getByRole('button',{name:'Saved replies',exact:true}).first().click();const dialog=root(storePage).locator('[data-msg-reply-dialog]');
    await dialog.getByLabel('Reply title').fill('Delivery help '+width);await dialog.getByLabel('Reply text').fill('We can help with your delivery '+width+'.');await dialog.getByRole('button',{name:'Save reply',exact:true}).click();await dialog.getByText('Saved reply updated.',{exact:true}).waitFor();
    await dialog.locator('.msg-saved-reply').filter({hasText:'Delivery help '+width}).getByRole('button',{name:'Insert into draft'}).click();assert.equal(await root(storePage).getByLabel('Message',{exact:true}).inputValue(),'We can help with your delivery '+width+'.');
    await root(storePage).getByRole('button',{name:'Send message',exact:true}).click();await root(storePage).getByText('Message sent.',{exact:true}).waitFor();await refresh(buyerPage);await root(buyerPage).locator('[data-msg-timeline]').getByText('We can help with your delivery '+width+'.',{exact:true}).waitFor();
    await root(storePage).getByRole('button',{name:'Resolve',exact:true}).click();await root(storePage).getByText('Conversation updated.',{exact:true}).waitFor();await root(storePage).getByText('Resolved · a new message reopens this conversation',{exact:true}).waitFor();
    await send(buyerPage,'Another question '+width);await refresh(storePage);await root(storePage).locator('[data-msg-detail-state]').getByText('Open conversation',{exact:true}).waitFor();
    for(const [label,p] of [['buyer',buyerPage],['merchant',storePage]]){assert.equal(await p.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);await p.evaluate(()=>scrollTo(0,0));await p.screenshot({path:screens+'/'+label+'-'+width+'.png',fullPage:true});assert.equal(await root(p).locator('img[onerror]').count(),0);}
    if(width===390){await root(storePage).getByRole('button',{name:'← Inbox',exact:true}).click();await root(storePage).locator('[data-msg-thread]').waitFor();await storePage.evaluate(()=>scrollTo(0,0));await storePage.screenshot({path:screens+'/merchant-inbox-390.png',fullPage:true});}
    if(width===1360){
      await root(storePage).getByRole('button',{name:'Resolved',exact:true}).click();await loaded(storePage);
      assert.equal(new URL(storePage.url()).searchParams.get('state'),'resolved');assert.equal(await root(storePage).locator('[data-msg-thread]').count(),0);
      await root(storePage).getByRole('button',{name:'All conversations',exact:true}).click();await loaded(storePage);
      assert.equal(await root(storePage).locator('[data-msg-thread]').count(),1);
      await root(storePage).getByRole('button',{name:'Unread',exact:true}).click();await loaded(storePage);
      assert.equal(new URL(storePage.url()).searchParams.get('unread'),'1');assert.equal(await root(storePage).locator('[data-msg-thread]').count(),0);
    }
    assert.deepEqual(errors,[]);await buyerPage.context().close();await storePage.context().close();
  }
  assert.equal((await f.providerCalls()).length,0);
});
test('lost message and attachment acknowledgements survive reload and retry the exact original request',async t=>{
  const f=await fixture(t),b=await browser(t),p=await pageFor(b,f,390,f.buyerCookie);await openBuyer(p,f);
  const path='/v1/customer/messages/'+f.id;f.control.drop=path;await root(p).getByLabel('Message',{exact:true}).fill('My durable request');await root(p).getByRole('button',{name:'Send message',exact:true}).click();await root(p).getByRole('button',{name:'Retry confirmation',exact:true}).waitFor();assert.equal(await f.count('commerce_message_events'),1);
  const first=f.control.calls.filter(c=>c.path===path&&c.body?.kind==='message').at(-1).body;await p.reload();await root(p).getByRole('button',{name:'Retry confirmation',exact:true}).waitFor();assert.equal(await root(p).getByLabel('Message',{exact:true}).isDisabled(),true);
  await root(p).getByRole('button',{name:'Retry confirmation',exact:true}).click();await root(p).getByText('Message sent.',{exact:true}).waitFor();assert.equal(await f.count('commerce_message_events'),1);assert.deepEqual(f.control.calls.filter(c=>c.path===path&&c.body?.kind==='message').at(-1).body,first);
  f.control.drop=path+'/media';await root(p).locator('[data-msg-file]').setInputFiles({name:'photo.png',mimeType:'image/png',buffer:png});await root(p).getByRole('button',{name:'Retry photo upload',exact:true}).waitFor();await p.reload();await root(p).getByRole('button',{name:'Retry photo upload',exact:true}).click();await root(p).getByText('Photo attached to your draft.',{exact:true}).waitFor();assert.equal(await f.count('commerce_message_media'),1);
  await send(p,'Uploaded once');assert.equal(await f.count('commerce_message_media_links'),1);
  await root(p).getByLabel('Message',{exact:true}).fill('Retained unsent text');await p.reload();await root(p).getByLabel('Message',{exact:true}).waitFor();assert.equal(await root(p).getByLabel('Message',{exact:true}).inputValue(),'Retained unsent text');
});
test('PHP proxies validate CSRF, account, queries and verified identity; late account changes suppress saved data',async t=>{
  const f=await fixture(t),b=await browser(t),p=await pageFor(b,f,1360,f.buyerCookie);await openBuyer(p,f);
  const config=await root(p).evaluate(n=>JSON.parse(n.dataset.config)),headers={'Cookie':'ezkart_customer='+f.buyerCookie.value,'X-Ezkart-CSRF':config.csrf,'X-Ezkart-Customer-Session':config.version};
  const url='/cart/admin/customer-messages.php?path='+encodeURIComponent('/'+f.id),body={kind:'message',body:'Private',photos:[],requestKey:key()};
  assert.equal((await f.app.request(url,body,{})).status,401);assert.equal((await f.app.request(url,body,{...headers,'X-Ezkart-CSRF':'bad'})).status,403);
  for(const target of ['?q=a&q=b','?environment=production','/'+f.id+'/read?anything=1','/'+f.id+'/media/mphoto_'+'a'.repeat(32)+'?x=1'])assert.equal((await f.app.request('/cart/admin/customer-messages.php?path='+encodeURIComponent(target),undefined,headers)).status,400);
  await writeFile(join(f.app.directory,'auth-response.json'),JSON.stringify({user:{id:'different-user'}}));assert.equal((await f.app.request(url,body,headers)).status,401);assert.equal(await f.count('commerce_message_events'),0);await writeFile(join(f.app.directory,'auth-response.json'),'{}');
  f.control.afterResponse=async path=>{if(path!=='/v1/customer/messages/'+f.id)return;f.control.afterResponse=null;f.app.cli(`require '${process.cwd()}/cart/api/customer-auth.php'; session_id('${f.buyerCookie.value}'); ez_customer_session(); $_SESSION['customer_auth']['version']='changed'; session_write_close();`);};
  await root(p).getByLabel('Message',{exact:true}).fill('Changes during request');await root(p).getByRole('button',{name:'Send message',exact:true}).click();await root(p).getByRole('link',{name:'Reload sign-in'}).waitFor();assert.equal(await f.count('commerce_message_events'),1);assert.equal(await root(p).locator('[data-msg-timeline]').count(),0);
  const merchantPage=await pageFor(b,f);await openStore(merchantPage,f);const mc=await root(merchantPage).evaluate(n=>JSON.parse(n.dataset.config)),mh={'Cookie':'ezkart_admin='+f.cookie.value,'X-Ezkart-CSRF':mc.csrf,'X-Ezkart-Message-Account':mc.account,'X-Ezkart-Message-Store':mc.store};
  const mu='/cart/admin/?cloud='+encodeURIComponent('/v1/commerce/messages/'+f.id);
  assert.equal((await f.app.request(mu,undefined,{...mh,'X-Ezkart-Message-Account':'bob'})).status,401);assert.equal((await f.app.request(mu,undefined,{...mh,'X-Ezkart-Message-Store':'seller_bob'})).status,409);
  assert.equal((await f.app.request(mu,body,{...mh,Origin:'https://other.example'})).status,403);
});
test('pre-sale links, buyer order claims, merchant order start, empty inbox and central hold are honest',async t=>{
  const f=await fixture(t),b=await browser(t),p=await pageFor(b,f,390,f.buyerCookie);
  await p.goto(f.app.base+'/cart/messages.php?product=tea');await root(p).getByLabel('Message',{exact:true}).waitFor();assert.match(await root(p).locator('[data-msg-draft-context]').textContent(),/tea/);
  await send(p,'Pre-sale question');await p.goto(f.app.base+'/cart/messages.php?order='+f.order.id);await root(p).getByLabel('Message',{exact:true}).waitFor();assert.match(await root(p).locator('[data-msg-draft-context]').textContent(),new RegExp(f.order.id));
  const m=await pageFor(b,f,1360);await m.goto(f.app.base+'/cart/admin/?page=messages');await loaded(m);await root(m).getByRole('button',{name:'New conversation',exact:true}).click();const dialog=root(m).locator('[data-msg-new-dialog]');await dialog.getByLabel('Order reference').fill(f.order.id);await dialog.getByRole('button',{name:'Open conversation',exact:true}).click();await root(m).getByLabel('Message',{exact:true}).waitFor();
  await m.goto(f.app.base+'/cart/admin/?page=orders&order='+f.order.id);await m.getByRole('link',{name:'Message buyer',exact:true}).click();await root(m).getByLabel('Message',{exact:true}).waitFor();assert.match(await root(m).locator('[data-msg-draft-context]').textContent(),new RegExp(f.order.id));
  await root(m).getByRole('button',{name:'Block',exact:true}).click();await root(m).getByText('Blocked · reopen to continue messaging',{exact:true}).waitFor();await refresh(p);await p.waitForFunction(()=>document.querySelector('[data-msg-send]')?.disabled===true);
  assert.equal(await root(m).getByText('8 min',{exact:true}).count(),0);
});

test('saved reply retries survive reload, stale conversation actions require a new decision, and history retains failed pages',async t=>{
  const f=await fixture(t),b=await browser(t),p=await pageFor(b,f,390);for(let n=0;n<34;n++)assert.equal((await f.send('Earlier message '+n)).status,200);
  await openStore(p,f);let fail=true;await p.route('**/cart/admin/?cloud=*',async route=>{const target=new URL(route.request().url()).searchParams.get('cloud');if(fail&&target?.includes('/'+f.id+'?cursor=')){fail=false;await route.fulfill({status:503,json:{ok:false,error:'History interrupted'}});return;}await route.continue();});
  await root(p).getByRole('button',{name:'Load older messages'}).click();await root(p).getByText('History interrupted',{exact:true}).waitFor();assert.equal(await root(p).locator('[data-event-id]').count(),30);
  await root(p).getByRole('button',{name:'Load older messages'}).click();await p.waitForFunction(()=>document.querySelectorAll('[data-event-id]').length===34);
  await f.send('A new message before resolve');await root(p).getByRole('button',{name:'Resolve',exact:true}).click();await root(p).getByText('This conversation or saved reply changed. Reload it before saving again.',{exact:true}).waitFor();assert.equal((await f.thread()).conversation.state,'open');
  await root(p).getByRole('button',{name:'Saved replies',exact:true}).first().click();let dialog=root(p).locator('[data-msg-reply-dialog]');await dialog.getByLabel('Reply title').fill('Uncertain saved reply');await dialog.getByLabel('Reply text').fill('The exact original reply.');f.control.drop='/v1/commerce/messages/replies';
  await dialog.getByRole('button',{name:'Save reply',exact:true}).click();await dialog.getByRole('button',{name:'Retry confirmation',exact:true}).waitFor();await p.reload();dialog=root(p).locator('[data-msg-reply-dialog]');await dialog.getByRole('button',{name:'Retry confirmation',exact:true}).click();await dialog.getByText('Saved reply updated.',{exact:true}).waitFor();assert.equal(await f.count('commerce_saved_reply_changes'),1);
});

test('storage hold prevents all browser writes and viewer membership gives a read-only inbox',async t=>{
  const f=await fixture(t,{EZKART_COMMERCE_STORAGE:'legacy'}),b=await browser(t),p=await pageFor(b,f);
  await f.send('A previously stored conversation');await p.goto(f.app.base+'/cart/admin/?page=messages');await loaded(p);await root(p).getByText('Messaging is not enabled yet. Your inbox will be available when it opens.',{exact:true}).waitFor();await root(p).locator('[data-msg-thread]').click();await root(p).getByLabel('Message',{exact:true}).waitFor();assert.equal(await root(p).getByRole('button',{name:'Send message',exact:true}).isDisabled(),true);
  const c=await root(p).evaluate(n=>JSON.parse(n.dataset.config));const response=await p.request.post(f.app.base+'/cart/admin/?cloud='+encodeURIComponent('/v1/commerce/messages/'+f.id),{data:{kind:'message',body:'held',photos:[],requestKey:key()},headers:{'X-Ezkart-CSRF':c.csrf,'X-Ezkart-Message-Account':c.account,'X-Ezkart-Message-Store':c.store}});assert.equal(response.status(),503);assert.equal(await f.count('commerce_message_events'),1);
  const f2=await fixture(t);await f2.db.prepare("UPDATE seller_memberships SET role='viewer' WHERE auth_user_id='alice'").run();const viewer=await pageFor(b,f2);await openStore(viewer,f2);assert.equal(await root(viewer).getByRole('button',{name:'Send message',exact:true}).isDisabled(),true);assert.equal(await root(viewer).getByRole('button',{name:'New conversation',exact:true}).isDisabled(),true);
});

test('storefront and checkout message links preserve product context without disturbing shopping',async t=>{
  const f=await fixture(t),b=await browser(t),p=await pageFor(b,f,390,f.buyerCookie);
  const storeSaved=await f.merchant('/v1/storefront',{enabled:true,name:'Jasmine & Co',accent:'#334155',button:'#111827',background:'#f7f8fa',logoId:'',backgroundId:'',animation:'none'});assert.equal(storeSaved.status,200,storeSaved.error);
  const errors=[];p.on('pageerror',e=>errors.push(e.message));await p.goto(f.app.base+'/shop/?store=seller_alice');await p.waitForFunction(()=>!document.querySelector('#shop-loading')?.hidden===false);assert.deepEqual(errors,[]);assert.equal(await p.locator('#shop-error').isVisible(),false,await p.locator('#shop-error-message').textContent());await p.getByRole('link',{name:'Message store',exact:true}).waitFor();assert.equal(await p.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
  await p.getByRole('link',{name:'Ask about this product',exact:true}).first().click();await root(p).getByLabel('Message',{exact:true}).waitFor();assert.match(await root(p).locator('[data-msg-draft-context]').innerText(),/tea|mug/);
  await p.goto(f.app.base+'/cart/?product=tea');await p.getByRole('link',{name:'Message seller',exact:true}).waitFor();assert.equal(await p.getByRole('link',{name:'Message seller',exact:true}).getAttribute('href'),'/cart/messages.php?product=tea');assert.equal(await p.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
});
