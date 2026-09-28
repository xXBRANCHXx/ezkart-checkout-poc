import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdir} from 'node:fs/promises';
import {setup} from './fixture.mjs';
import {chromium} from '../builder-mcp/node_modules/playwright/index.mjs';
const order='EZK-P-1234567890ABCDEF12345678';
const url='https://jokul.doku.com/checkout/link/original_session';
const sdk=`window.loadJokulCheckout=url=>{window.openedSessions=(window.openedSessions||[]).concat(url);const modal=document.createElement('div');modal.id='jokul_checkout_modal';modal.className='jokul-modal';modal.style.display='block';const content=document.createElement('div');content.className='jokul-content';const frame=document.createElement('iframe');frame.src=url+'?view=iframe';content.append(frame);modal.append(content);document.body.append(modal);};window.addEventListener('message',event=>{if(event.origin==='https://jokul.doku.com'&&event.data?.func==='closeJokul')document.getElementById('jokul_checkout_modal').style.display='none';});`;
const style='.jokul-modal{position:fixed;inset:0;z-index:999999;background:#0009;width:100%;height:100%;}.jokul-content{height:100%;width:100%;}';
async function fixture(t,width=1360){
 const f=await setup();t.after(()=>f.close());const browser=await chromium.launch({headless:true});t.after(()=>browser.close());
 const context=await browser.newContext({viewport:{width,height:900}}),page=await context.newPage();page.setDefaultTimeout(6000);
 const state={data:{ok:true,order_id:order,status:'PENDING',payment_flow:'routed_hosted',payment_url:url,payment_expires_at:new Date(Date.now()+3600000).toISOString(),environment:'production',total:105000,subtotal:100000,shipping_price:5000,shipping_kind:'physical',items:[{name:'Handmade notebook',quantity:1,price:100000}],shop:'fixture-shop'},sdkFail:false,external:[],errors:[]};
 page.on('pageerror',error=>state.errors.push(error.message));
 await page.route('**/*',async route=>{
  const req=route.request(),target=new URL(req.url());
  if(target.pathname==='/cart/api/status.php')return route.fulfill({json:state.data});
  if(target.origin===f.base)return route.continue();
  state.external.push(req.url());
  if(req.url()==='https://jokul.doku.com/jokul-checkout-js/v1/jokul-checkout-1.0.0.js')return state.sdkFail?route.abort():route.fulfill({contentType:'text/javascript',body:`const css=document.createElement('link');css.rel='stylesheet';css.href='https://jokul.doku.com/jokul-checkout-js/v1/jokul-checkout-1.0.0.css';document.head.append(css);`+sdk});
  if(req.url().endsWith('/jokul-checkout-1.0.0.css'))return state.cssFail?route.abort():route.fulfill({contentType:'text/css',body:style});
  if(req.url()===url+'?view=iframe')return route.fulfill({contentType:'text/html',body:'<!doctype html><title>Fixture DOKU payment</title><h1>Payment window fixture</h1><p>Complete payment here.</p><button onclick="parent.postMessage({func:\'closeJokul\'},\'*\')">Return to order</button><button onclick="parent.postMessage({status:\'PAID\'},\'*\')">Untrusted browser success</button>'});
  return route.abort();
 });
 const open=async()=>{await page.goto(f.base+'/cart/payment.php?order='+order);await page.locator('#payment-layout').waitFor({state:'visible'});};await open();
 return{f,page,state,open};
}
for(const width of[1360,390])test(`routed payment window ${width}px preserves original session through close, reload and provider return; only server confirms payment`,async t=>{
 const {f,page,state,open}=await fixture(t,width);
 assert.deepEqual(state.external,[],'No provider resource before deliberate click');
 await page.locator('#open-hosted-payment').click();await page.locator('#jokul_checkout_modal iframe').waitFor();
 await page.frameLocator('#jokul_checkout_modal iframe').getByRole('button',{name:'Untrusted browser success'}).click();
 assert.equal(await page.locator('#payment').getAttribute('data-state'),'PENDING');
 await page.frameLocator('#jokul_checkout_modal iframe').getByRole('button',{name:'Return to order'}).click();
 await page.locator('#jokul_checkout_modal').waitFor({state:'hidden'});assert.equal(await page.locator('#payment').getAttribute('data-state'),'PENDING');
 await page.locator('#open-hosted-payment').click();await page.locator('#jokul_checkout_modal iframe').waitFor();
 assert.deepEqual(await page.evaluate(()=>openedSessions),[url,url]);
 await page.frameLocator('#jokul_checkout_modal iframe').getByRole('heading',{name:'Payment window fixture'}).waitFor();
 await mkdir('/tmp/ezkart-hosted-payment-ui',{recursive:true});await page.screenshot({path:`/tmp/ezkart-hosted-payment-ui/modal-${width}.png`});
 assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
 await page.locator('.hosted-payment-close').click();assert.equal(await page.locator('#payment').evaluate(n=>n.inert),false);
 await open();await page.locator('#open-hosted-payment').click();await page.locator('#jokul_checkout_modal iframe').waitFor();assert.deepEqual(await page.evaluate(()=>openedSessions),[url]);
 await page.locator('.hosted-payment-close').click();state.data.status='PAID';await page.locator('#check-payment').click();
 await page.getByRole('heading',{name:'Payment confirmed',exact:true}).waitFor();assert.equal(await page.locator('#open-hosted-payment').isVisible(),false);
 assert.deepEqual(await f.calls(),[]);assert.deepEqual(state.errors,[]);
});
test('SDK failure retries same session and expired or untrusted hosted URLs never load a provider window',async t=>{
 const {f,page,state,open}=await fixture(t);state.sdkFail=true;
 await page.locator('#open-hosted-payment').click();await page.getByText(/We couldn’t open the payment window/).waitFor();
 state.sdkFail=false;await page.locator('#open-hosted-payment').click();await page.locator('#jokul_checkout_modal iframe').waitFor();
 assert.deepEqual(await page.evaluate(()=>openedSessions),[url]);await page.locator('.hosted-payment-close').click();
 for(const bad of['https://jokul.doku.com.evil.test/checkout/link/token','https://user@jokul.doku.com/checkout/link/token','https://jokul.doku.com/checkout/link/token?next=evil','https://jokul.doku.com/checkout/link/token#x','javascript:alert(1)','https://sandbox.doku.com/checkout/link/token']){
  state.data.payment_url=bad;await open();assert.equal(await page.locator('#open-hosted-payment').isVisible(),false,bad);
 }
 state.data.payment_url=url;state.data.payment_expires_at=new Date(Date.now()-1000).toISOString();await open();assert.equal(await page.locator('#open-hosted-payment').isVisible(),false);
 state.data.payment_expires_at=new Date(Date.now()+3600000).toISOString();state.data.status='CREATING';await open();assert.equal(await page.locator('#open-hosted-payment').isVisible(),false);
 state.data.status='FAILED';await open();assert.equal(await page.locator('#open-hosted-payment').isVisible(),false);
 assert.deepEqual(await f.calls(),[]);
});
test('legacy hosted and BCA native remain distinct from the routed popup with strict page CSP',async t=>{
 const {f,page,state,open}=await fixture(t);state.data.payment_flow='hosted';await open();assert.equal(await page.locator('#provider-payment-link').getAttribute('href'),url);assert.equal(await page.locator('#open-hosted-payment').isVisible(),false);
 state.data.payment_flow='direct';state.data.payment_details={method:'VIRTUAL_ACCOUNT_BCA',account_number:'1234567890123456',account_name:'Merchant',expires_at:state.data.payment_expires_at};await open();await page.locator('#transfer-details').waitFor({state:'visible'});assert.equal(await page.locator('#provider-payment-link').isVisible(),false);assert.equal(await page.locator('#open-hosted-payment').isVisible(),false);
 const headers=(await fetch(f.base+'/cart/payment.php?order='+order)).headers;assert.match(headers.get('content-security-policy'),/script-src 'self' https:\/\/jokul.doku.com\/jokul-checkout-js\/v1\/jokul-checkout-1.0.0.js/);assert.doesNotMatch(headers.get('content-security-policy'),/unsafe-inline|unsafe-eval|\*/);assert.equal(headers.get('referrer-policy'),'no-referrer');assert.deepEqual(await f.calls(),[]);
});

test('payment modal stays visible and closable when the provider stylesheet fails',async t=>{
 const {page,state}=await fixture(t,390);state.cssFail=true;
 await page.locator('#open-hosted-payment').click();await page.frameLocator('#jokul_checkout_modal iframe').getByRole('heading',{name:'Payment window fixture'}).waitFor();
 const box=await page.locator('#jokul_checkout_modal').boundingBox();assert.equal(box.x,0);assert.equal(box.y,0);assert.equal(box.width,390);assert.equal(box.height,900);
 assert.equal(await page.locator('#jokul_checkout_modal').evaluate(n=>getComputedStyle(n).position),'fixed');
 await page.locator('.hosted-payment-close').click();assert.equal(await page.locator('#payment').evaluate(n=>n.inert),false);assert.equal(await page.locator('#open-hosted-payment').isEnabled(),true);
});
