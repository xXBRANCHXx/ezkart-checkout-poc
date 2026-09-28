import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdir} from 'node:fs/promises';
import {setup} from './fixture.mjs';
import {chromium} from '../builder-mcp/node_modules/playwright/index.mjs';
const order='EZK-S-1234567890ABCDEF12345678';
async function fixture(t,width){
 const f=await setup();t.after(()=>f.close());const browser=await chromium.launch({headless:true});t.after(()=>browser.close());
 const page=await browser.newPage({viewport:{width,height:940}});page.setDefaultTimeout(7000);
 const state={choices:['bca_va','doku_checkout'],methods:['QRIS','CREDIT_CARD'],attempts:[],lost:true};
 await page.route('**/*',async route=>{
  const target=new URL(route.request().url());
  if(target.origin!==f.base)return route.abort();
  if(target.pathname==='/cart/api/catalog.php')return route.fulfill({json:{products:[{id:'tea',name:'Tea',price:20000,stock:10,weight:50,seller_id:'fixture-seller'}]}});
  if(target.pathname==='/cart/api/checkout-config.php')return route.fulfill({json:{ok:true,environment:'sandbox',shipping_required:false,durable_checkout:true,payment_choices:state.choices,hosted_payment_methods:state.methods}});
  if(target.pathname==='/cart/api/start.php'){
   state.attempts.push(route.request().postData());
   if(state.lost){state.lost=false;return route.abort();}
   return route.fulfill({status:202,json:{ok:true,provider:'doku',environment:'sandbox',durable_checkout:true,order_id:order,status:'CREATING'}});
  }
  if(target.pathname==='/cart/api/status.php')return route.fulfill({json:{ok:true,order_id:order,status:'CREATING',environment:'sandbox',total:40000,subtotal:40000,shipping_price:0,shipping_skipped:true,items:[{name:'Tea',quantity:2,price:20000}]}});
  return route.continue();
 });
 await page.goto(f.base+'/cart/?shop=alice-shop&cart=tea:2');await page.locator('#to-checkout').click();
 return{f,page,state};
}
for(const [width,choice]of[[1360,'bca_va'],[390,'doku_checkout']])test(`shopper ${width}px chooses configured ${choice}; lost response and reload retain exact method and intent`,async t=>{
 const {f,page,state}=await fixture(t,width);
 await page.locator('#payment-choice-section').waitFor({state:'visible'});
 assert.equal(await page.locator('input[name=paymentChoice]:checked').inputValue(),'bca_va');
 await page.locator(`input[value=${choice}]`).check();
 for(const [name,value]of Object.entries({fullName:'Checkout Tester',phone:'081234567890',email:'checkout@example.com',location:'Jakarta Selatan',address:'Jalan Test Nomor 12',postalCode:'12345'}))await page.locator(`#customer-form [name=${name}]`).fill(value);
 await mkdir('/tmp/ezkart-hosted-payment-ui',{recursive:true});await page.locator('#payment-choice-section').screenshot({path:`/tmp/ezkart-hosted-payment-ui/choice-${width}.png`});
 assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
 await page.locator('#pay-button').click();await page.locator('#checkout-recovery').waitFor({state:'visible'});await page.locator('#recover-checkout:not([disabled])').waitFor();
 assert.equal(state.attempts.length,1);assert.equal(JSON.parse(state.attempts[0]).payment_choice,choice);assert.equal(JSON.parse(state.attempts[0]).customer.paymentChoice,undefined);
 const original=state.attempts[0];state.choices=['bca_va'];state.methods=[];
 await page.reload();await page.locator('#recover-checkout:not([disabled])').waitFor();await page.locator('#recover-checkout').click();await page.waitForURL('**/payment.php?order='+order);
 assert.deepEqual(state.attempts,[original,original]);assert.equal(JSON.parse(await page.evaluate(()=>sessionStorage.getItem('ezkart.checkout.attempt.v1'))).body,original);
 assert.deepEqual(await f.calls(),[]);
});
test('checkout shows only configured payment options and rejects unknown public options',async t=>{
 const {page,state}=await fixture(t,390);state.choices=['doku_checkout'];state.methods=['QRIS'];
 await page.reload();await page.locator('#to-checkout').click();await page.locator('#payment-choice-section').waitFor({state:'visible'});
 assert.equal(await page.locator('input[name=paymentChoice]').count(),1);assert.equal(await page.locator('input[name=paymentChoice]:checked').inputValue(),'doku_checkout');assert.match(await page.locator('#payment-choices').innerText(),/QRIS/);assert.doesNotMatch(await page.locator('#payment-choices').innerText(),/credit card/);
 state.choices=['unsupported'];await page.reload();await page.locator('#catalog-error').waitFor({state:'visible'});assert.equal(await page.locator('#to-checkout').isEnabled(),false);assert.equal(state.attempts.length,0);
});
