import test from 'node:test';
import assert from 'node:assert/strict';
import {randomBytes} from 'node:crypto';
import {readFile,mkdir} from 'node:fs/promises';
import {runInNewContext} from 'node:vm';
import {setupCentralFixture} from './central-fixture.mjs';
import {browser,pageFor} from './review-workspace-fixture.mjs';
import {seedDeclaredOnboarding} from '../../cloudflare/ezkart-api/test/onboarding-fixture.mjs';
import {mountMessageOrigin} from '../../cart/message-origin.js';
import {landingPageFrame} from '../../cloudflare/ezkart-api/src/landing-page-hosting.js';
const buyer='fixture-google-customer',key=()=>randomBytes(16).toString('hex');
async function settings(){const p=await crypto.subtle.generateKey({name:'ECDSA',namedCurve:'P-256'},true,['sign','verify']),j=await crypto.subtle.exportKey('jwk',p.privateKey);return {CUSTOMER_WEB_PUSH:'enabled',WEB_PUSH_VAPID_PUBLIC_KEY:Buffer.from(await crypto.subtle.exportKey('raw',p.publicKey)).toString('base64url'),WEB_PUSH_VAPID_PRIVATE_KEY:j.d,WEB_PUSH_VAPID_SUBJECT:'mailto:fixture@example.test'};}
async function fixture(t){const f=await setupCentralFixture(t,{EZKART_TEST_NOTIFICATIONS:'1'},{bindings:await settings()}),token=await f.merchantToken(buyer,'checkout@example.com');
 await seedDeclaredOnboarding(f.db);
 const buyerCookie=f.app.customerCookie('checkout@example.com',buyer,3600,token),cookie=f.app.adminCookie({supabase_access_token:await f.merchantToken('alice','alice@example.test'),admin_user:{id:'alice',email:'alice@example.test'}});
 const pair=await crypto.subtle.generateKey({name:'ECDH',namedCurve:'P-256'},true,['deriveBits']),sub={endpoint:'https://fcm.googleapis.com/fcm/send/'+key(),expirationTime:null,keys:{p256dh:Buffer.from(await crypto.subtle.exportKey('raw',pair.publicKey)).toString('base64url'),auth:randomBytes(16).toString('base64url')}};
 return {...f,buyerCookie,cookie,sub,publicKey:(await f.merchant('/v1/customer/messages/push',undefined,{seller:buyer})).publicKey};}
async function mock(p,sub,publicKey,permission='default'){
 await p.addInitScript(({sub,publicKey,permission})=>{
  window.pushFixture={permission:sessionStorage.getItem('pushFixture-permission')||permission,requests:0,subscriptions:0,unsubscriptions:0,current:null};
  const subscription=()=>({endpoint:sub.endpoint,options:{applicationServerKey:Uint8Array.from(atob(publicKey.replace(/-/g,'+').replace(/_/g,'/')),c=>c.charCodeAt(0)).buffer},toJSON:()=>sub,unsubscribe:async()=>{pushFixture.unsubscriptions++;pushFixture.current=null;sessionStorage.removeItem('pushFixture-subscribed');return true;}});
  const registration={pushManager:{getSubscription:async()=>pushFixture.current,subscribe:async()=>{pushFixture.subscriptions++;sessionStorage.setItem('pushFixture-subscribed','1');return pushFixture.current=subscription();}}};
  if(sessionStorage.getItem('pushFixture-subscribed'))pushFixture.current=subscription();
  Object.defineProperty(window,'Notification',{value:class{static get permission(){return pushFixture.permission;}static async requestPermission(){pushFixture.requests++;sessionStorage.setItem('pushFixture-permission','granted');return pushFixture.permission='granted';}}});
  Object.defineProperty(window,'PushManager',{value:class{}});Object.defineProperty(navigator,'serviceWorker',{value:{getRegistration:async()=>registration,register:async()=>registration,ready:Promise.resolve(registration)}});
 },{sub,publicKey,permission});
}
test('customer CTA asks only on click, saves authenticated browser subscription, revokes it, and shows denied/unsupported states on mobile',async t=>{
 const f=await fixture(t),b=await browser(t),p=await pageFor(b,f,390,f.buyerCookie);await mock(p,f.sub,f.publicKey);await p.goto(f.app.base+'/cart/messages.php?product=tea');
 const action=p.getByRole('button',{name:'Enable notifications',exact:true}),status=p.locator('[data-msg-push-status]');await action.waitFor();await p.waitForFunction(()=>document.querySelector('[data-msg-push]')?.disabled===false);
 assert.equal(await p.evaluate(()=>pushFixture.requests),0);await action.click();await status.getByText('Notifications are enabled for this browser.',{exact:true}).waitFor();assert.equal(await p.evaluate(()=>pushFixture.requests),1);assert.equal(await p.locator('[data-msg-push] use').getAttribute('href'),'#msg-icon-bell');
 assert.equal((await f.db.prepare('SELECT actor_id FROM customer_push_subscriptions').first()).actor_id,buyer);
 await p.reload();await p.getByRole('button',{name:'Disable notifications',exact:true}).waitFor();assert.equal(await p.evaluate(()=>pushFixture.requests),0);
 await p.getByRole('button',{name:'Disable notifications',exact:true}).click();await status.getByText('Notifications are disabled for this browser.',{exact:true}).waitFor();assert.equal((await f.db.prepare('SELECT active FROM customer_push_subscriptions').first()).active,0);assert.equal(await p.evaluate(()=>pushFixture.unsubscriptions),1);
 const config=await p.locator('[data-message-workspace]').evaluate(n=>JSON.parse(n.dataset.config));const url=f.app.base+'/cart/admin/customer-messages.php?path=%2Fpush';
 assert.equal((await p.request.post(url,{data:{action:'subscribe',subscription:f.sub},headers:{'X-Ezkart-CSRF':'wrong','X-Ezkart-Customer-Session':config.version}})).status(),403);
 assert.equal(await p.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
 await mkdir('/tmp/ezkart-message-push-evidence',{recursive:true});await p.screenshot({path:'/tmp/ezkart-message-push-evidence/customer-mobile.png',fullPage:true});
 const denied=await pageFor(b,f,390,f.buyerCookie);await mock(denied,f.sub,f.publicKey,'denied');await denied.goto(f.app.base+'/cart/messages.php');await denied.getByText('Notifications are blocked. Allow them in your browser’s site settings.',{exact:true}).waitFor();assert.equal(await denied.getByRole('button',{name:'Enable notifications'}).isDisabled(),true);assert.equal(await denied.evaluate(()=>pushFixture.requests),0);
 const unsupported=await pageFor(b,f,390,f.buyerCookie);await unsupported.addInitScript(()=>Object.defineProperty(window,'PushManager',{value:undefined}));await unsupported.goto(f.app.base+'/cart/messages.php');
 // A missing constructor is treated as unsupported, even on a secure origin.
 await unsupported.getByText(/Browser notifications are unavailable here/).waitFor();
});
test('seller sees saved landing page name after reload; published opaque frame carries references without copying caller labels',async t=>{
 const f=await fixture(t),bucket=await f.mf.getR2Bucket('PRIVATE_ASSETS');await bucket.put('sellers/seller_alice/landing-pages/zero-syrup.json',JSON.stringify({id:'zero-syrup',name:'Zero Syrup',status:'published',publishedHtml:'<html></html>'}));
 const b=await browser(t),p=await pageFor(b,f,1360,f.buyerCookie);await p.goto(f.app.base+'/cart/messages.php?product=tea&page=zero-syrup');await p.getByLabel('Message',{exact:true}).waitFor();await p.reload();await p.getByLabel('Message',{exact:true}).waitFor();
 const store=await pageFor(b,f,1360);await store.goto(f.app.base+'/cart/admin/?page=messages');await store.locator('.msg-origin').filter({hasText:'Zero Syrup'}).waitFor();await store.reload();await store.locator('.msg-origin').filter({hasText:'Zero Syrup'}).waitFor();
 const id=(await f.db.prepare('SELECT id FROM commerce_conversations').first()).id;await store.goto(f.app.base+'/cart/admin/?page=messages&conversation='+id);await store.locator('.msg-conversation-head .msg-origin').filter({hasText:'Zero Syrup'}).waitFor();
 await store.screenshot({path:'/tmp/ezkart-message-push-evidence/seller-desktop.png',fullPage:true});
 const visit='a'.repeat(64),frame=landingPageFrame(`<html><body><div data-ezkart-contact-url="https://test.ezkart.id/cart/messages.php?product=tea"><a href="https://test.ezkart.id/cart/messages.php?product=tea">Ask</a></div></body></html>`);
 await p.route('https://test.ezkart.id/alice/shop/zero-syrup?tracking_visit='+visit,r=>r.fulfill({contentType:'text/html',body:frame}));await p.goto('https://test.ezkart.id/alice/shop/zero-syrup?tracking_visit='+visit);const inner=p.frameLocator('[data-hosted-page]');await inner.getByRole('link',{name:'Ask'}).waitFor();
 const href=await inner.getByRole('link',{name:'Ask'}).getAttribute('href');assert.equal(new URL(href).searchParams.get('page'),'zero-syrup');assert.equal(new URL(href).searchParams.get('tracking_visit'),visit);assert.equal(new URL(href).searchParams.has('platform'),false);
 assert.equal(await inner.locator('body').evaluate(()=>{try{return parent.document.body!==null;}catch{return false;}}),false);
 // API and custom-domain paths use host-owned identity and the exact canonical
 // customer origin. Arbitrary authored external links are never decorated.
 for(const url of ['https://worker.fixture.test/v1/public/landing-pages/alice/zero-syrup','https://merchant-vanity.example/']){
  const html=landingPageFrame('<html><body><a href="https://test.ezkart.id/cart/messages.php?product=tea">Canonical contact</a><a href="https://attacker.example/cart/messages.php?product=tea">External contact</a></body></html>',{pageId:'zero-syrup',contactOrigin:'https://test.ezkart.id'});
  await p.route(url,r=>r.fulfill({contentType:'text/html',body:html}));await p.goto(url);const frame=p.frameLocator('[data-hosted-page]');
  assert.equal(new URL(await frame.getByRole('link',{name:'Canonical contact'}).getAttribute('href')).searchParams.get('page'),'zero-syrup');
  assert.equal(new URL(await frame.getByRole('link',{name:'External contact'}).getAttribute('href')).searchParams.has('page'),false);
 }
 assert.equal(typeof mountMessageOrigin,'function');
});
test('service-worker fixture shows generic notifications and clicks only same-origin authorized conversation destinations',async()=>{
 const handlers={},shown=[],opened=[],focused=[],source=await readFile(new URL('../../cart/customer-push-sw.js',import.meta.url),'utf8');
 const self={location:{origin:'https://test.ezkart.id'},addEventListener:(name,fn)=>handlers[name]=fn,registration:{showNotification:async(title,options)=>shown.push({title,options})},clients:{matchAll:async()=>[],openWindow:async url=>opened.push(url)}};
 runInNewContext(source,{self,URL});const valid='https://test.ezkart.id/cart/messages.php?conversation=conv_'+'a'.repeat(32),wait=[];
 handlers.push({data:{json:()=>({title:'Fake private title',body:'Private text',url:valid,tag:'notice_'+'b'.repeat(32)})},waitUntil:p=>wait.push(p)});await Promise.all(wait);assert.equal(shown[0].title,'New message from your store');assert.equal(shown[0].options.body,'Open Messages to read your reply.');
 for(const url of ['https://attacker.test/cart/messages.php?conversation=conv_'+'a'.repeat(32),'https://test.ezkart.id/cart/admin/','https://test.ezkart.id/cart/messages.php?conversation=conv_'+'a'.repeat(32)+'&redirect=evil'])handlers.push({data:{json:()=>({url})},waitUntil:p=>wait.push(p)});assert.equal(shown.length,1);
 handlers.notificationclick({notification:{data:{url:valid},close:()=>{}},waitUntil:p=>wait.push(p)});await Promise.all(wait);assert.deepEqual(opened,[valid]);
 self.clients.matchAll=async()=>[{url:'https://test.ezkart.id/cart/messages.php',navigate:async u=>focused.push(u),focus:async()=>focused.push('focused')}];handlers.notificationclick({notification:{data:{url:valid},close:()=>{}},waitUntil:p=>wait.push(p)});await Promise.all(wait);assert.deepEqual(focused,[valid,'focused']);
});
