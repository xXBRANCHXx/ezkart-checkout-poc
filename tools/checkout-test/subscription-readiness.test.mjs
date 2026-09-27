import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdir} from 'node:fs/promises';
import {setupCentralFixture} from './central-fixture.mjs';
import {browser,pageFor} from './review-workspace-fixture.mjs';

async function fixture(t){
  const f=await setupCentralFixture(t);
  await f.db.prepare(`INSERT INTO products(id,seller_id,type,status,title,price_amount,billing_interval,billing_interval_count,metadata_json,created_at,updated_at)
    VALUES ('membership','seller_alice','subscription','active','Membership',12000,'month',3,'{}','2026-01-01','2026-01-01')`).run();
  for(const [id,name,price,unit,count] of [['quarterly','Quarterly',12000,'month',3],['annual','Annual',40000,'year',1]]){
    await f.db.prepare(`INSERT INTO product_variants(id,seller_id,product_id,name,options_json,sku,price_amount,billing_interval,billing_interval_count,sort_order,created_at,updated_at)
      VALUES (?,'seller_alice','membership',?,'{}',?,?,?,?,?,'2026-01-01','2026-01-01')`).bind(id,name,id,price,unit,count,id==='quarterly'?1:2).run();
  }
  assert.equal((await f.merchant('/v1/storefront',{enabled:true,name:'Subscription fixture',accent:'#334155',button:'#111827',background:'#f7f8fa',logoId:'',backgroundId:'',animation:'none'})).status,200);
  return f;
}

test('subscription plans retain their original public cadence and cannot become a one-time BCA charge',async t=>{
  const f=await fixture(t),response=await f.mf.dispatchFetch('https://api.fixture.test/v1/storefront/view?product=membership'),data=await response.json();assert.equal(response.status,200);
  assert.deepEqual(data.products[0].choices.map(c=>({billing:c.billing,stock:c.stock,available:c.available})),[
    {billing:{unit:'month',interval:3},stock:null,available:false},{billing:{unit:'year',interval:1},stock:null,available:false}]);
  const result=await f.create(f.input({items:[{productId:'membership',variantId:'annual',quantity:1,expectedPrice:40000}],shipping:{kind:'none',amount:0,skipped:false}}));assert.equal(result.status,409,JSON.stringify(result));
  const publicItems=await f.mf.dispatchFetch('https://api.fixture.test/v1/storefront/products?ids=membership~annual');const catalog=(await publicItems.json()).products;assert.equal(catalog.length,1);assert.equal(catalog[0].type,'subscription');
  const input={checkout_key:'e'.repeat(32),cart:{'membership~annual':1},expected_prices:{'membership~annual':40000},expected_total:40000,shop:'alice-shop',shipping_id:'',
    customer:{fullName:'Subscription Buyer',email:'checkout@example.com',phone:'081234567890'}};
  const php=await f.app.request('/cart/api/start.php',input);assert.equal(php.status,422,JSON.stringify(php.data));assert.match(php.data.error,/subscription|unavailable|cannot be purchased/i);
  assert.equal(await f.count('orders'),0);assert.equal(await f.count('commerce_payment_captures'),0);assert.equal(await f.count('inventory_reservations'),0);assert.equal((await f.providerCalls()).length,0);
});

test('subscription shop prices show the selected month/year cadence at desktop and mobile without enabling checkout',async t=>{
  const f=await fixture(t),b=await browser(t),p=await pageFor(b,f,1360,null),errors=[];p.on('pageerror',e=>errors.push(e.message));
  await p.goto(f.app.base+'/shop/?store=seller_alice');const card=p.locator('[data-product=membership]');await card.waitFor();
  assert.match(await card.locator('[data-price]').innerText(),/\/ 3 months$/);
  await card.getByLabel('Plan for Membership',{exact:true}).selectOption('membership~annual');assert.match(await card.locator('[data-price]').innerText(),/\/ year$/);
  assert.equal(await card.locator('[data-add]').isDisabled(),true);await card.getByText('Subscription billing is not available yet.',{exact:true}).waitFor();
  await p.setViewportSize({width:390,height:844});assert.equal(await p.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
  await mkdir('/tmp/ezkart-subscriptions-01a0d643',{recursive:true});await card.screenshot({path:'/tmp/ezkart-subscriptions-01a0d643/plan-mobile.png'});
  assert.deepEqual(errors,[]);assert.equal(await f.count('orders'),0);
});
