import test from 'node:test';
import assert from 'node:assert/strict';
import {randomBytes} from 'node:crypto';
import {mkdir,readFile} from 'node:fs/promises';
import {spawn} from 'node:child_process';
import {setupCentralFixture} from './central-fixture.mjs';
import {digitalFixtureFile} from '../../cloudflare/ezkart-api/test/digital-commerce-fixture.mjs';

const key=()=>randomBytes(16).toString('hex');
const customer={fullName:'Digital Buyer',email:'checkout@example.com',phone:'081234567890'};
const physicalAddress={location:'Jakarta Selatan',address:'Jalan Original 12',postalCode:'12345'};
const input=(file,changes={})=>({checkout_key:key(),cart:{[file.id]:1},expected_prices:{[file.id]:25000},
  expected_file_versions:{[file.id]:file.version},expected_total:25000,shop:'alice-shop',shipping_id:'',customer,...changes});
async function fixture(t,overrides={}){
  const f=await setupCentralFixture(t,overrides),file=await digitalFixtureFile(f);
  await f.db.prepare(`UPDATE sellers SET settings_json=json_set(settings_json,'$.storefront',json(?)) WHERE id='seller_alice'`)
    .bind(JSON.stringify({enabled:true,name:'Digital Studio'})).run();
  return {...f,file};
}
const publicCall=async(f,path)=>{const r=await f.mf.dispatchFetch('https://api.fixture.test'+path);return {status:r.status,...await r.json()};};
async function variants(f){
  for(const [position,[id,hidden]] of [['basic',false],['extended',false],['hidden',true]].entries())await f.db.prepare(`INSERT INTO product_variants(id,seller_id,product_id,name,options_json,sku,price_amount,stock_quantity,weight_grams,sort_order,created_at,updated_at)
    VALUES (?,'seller_alice','guide',?,?,?,25000,NULL,NULL,?,'now','now')`).bind(id,id,JSON.stringify({hidden,values:[{option:'Edition',value:id}]}),'BOOK-'+id,position+1).run();
}

test('public digital catalog exposes only current purchasable file metadata, with real options and no private storage details',async t=>{
  const f=await fixture(t);await variants(f);
  await f.db.prepare(`INSERT INTO products(id,seller_id,type,status,title,price_amount,digital_filename,created_at,updated_at)
    VALUES ('empty-digital','seller_alice','digital','active','Unfinished upload',12000,'a-filename-is-not-a-file.pdf','now','now')`).run();
  const catalog=await publicCall(f,'/v1/storefront/products?ids=guide~extended,empty-digital,guide~hidden');assert.equal(catalog.status,200);
  assert.deepEqual(catalog.products.map(p=>p.id),['guide~extended','empty-digital']);
  assert.deepEqual(catalog.products[0].digitalFile,{id:f.file.version,version:1,size:f.file.bytes.length});
  assert.equal(catalog.products[0].stock,null);assert.equal(catalog.products[0].weightGrams,0);assert.equal(catalog.products[1].digitalFile,null);
  const shop=await publicCall(f,'/v1/storefront/view?store=seller_alice'),digital=shop.products.find(p=>p.id==='guide');
  assert.deepEqual(digital.choices.map(c=>[c.id,c.stock,c.available]),[['guide~basic',null,true],['guide~extended',null,true]]);
  assert.equal(shop.products.find(p=>p.id==='empty-digital').choices[0].available,false);
  assert(!JSON.stringify([catalog,shop]).match(/Panduan|r2_key|upload_id|dupl_|manifest|retained_at|a-filename-is-not/));
  const php=await f.app.request('/cart/api/catalog.php?products=guide~extended');assert.equal(php.status,200,JSON.stringify(php.data));
  assert.equal(php.data.products[0].digital_file.id,f.file.version);assert.equal(php.data.products[0].stock,null);
  assert.equal((await f.app.request('/cart/api/catalog.php?products=empty-digital')).status,422);
  await f.db.prepare("UPDATE products SET status='archived' WHERE id='guide'").run();
  assert.equal((await publicCall(f,'/v1/storefront/products?ids=guide')).products.length,0);
  assert.equal((await f.app.request('/cart/api/storefront.php?product=guide')).status,404);
});

test('PHP digital checkout binds the original file, takes no address or quote, and exposes owned download status separately from shipping',async t=>{
  const f=await fixture(t,{EZKART_BITESHIP_SANDBOX_API_KEY:''}),request=input(f.file),cookie=f.app.customerCookie('checkout@example.com','fixture-google-customer',3600,await f.merchantToken('fixture-google-customer','checkout@example.com'));
  const started=await f.app.request('/cart/api/start.php',request,{Cookie:cookie.name+'='+cookie.value});assert.equal(started.status,201,JSON.stringify(started.data));
  const order=await f.record(started.data.order_id);assert.deepEqual(order.snapshot.shipping,{kind:'none',amount:0,skipped:false});
  assert.equal(order.items[0].fulfillment.digitalFile.id,f.file.version);assert.equal(order.items[0].productType,'digital');
  assert.equal(await f.count('inventory_reservations'),0);assert.equal((await f.app.calls()).filter(c=>c.url.includes('biteship')).length,0);
  let status=await f.app.tracking(order.id,{cookie});assert.equal(status.status,200,JSON.stringify(status.data));assert.equal(status.data.tracking.stage,'awaiting_payment');assert.equal(status.data.tracking.kind,'digital');
  const paid=await f.paid(order,{accountNumber:order.payment.accountNumber});assert.equal(paid.status,200,JSON.stringify(paid));status=await f.app.tracking(order.id,{cookie});assert.equal(status.data.tracking.stage,'digital_ready');assert.equal(status.data.downloads.verifiedCount,0);
  assert.equal(status.data.tracking.courier,'');assert.deepEqual(status.data.tracking.locations,{origin:null,destination:null});assert.equal(status.data.shipping_skipped,false);
  const publicStatus=await f.app.request('/cart/api/status.php?order='+order.id);assert.equal(publicStatus.data.shipping_kind,'none');assert(!publicStatus.data.downloads&&!publicStatus.data.tracking);
  assert.equal((await f.app.tracking(order.id,{cookie:f.app.customerCookie('other@example.com','other-buyer')})).status,404);
  // Presentation of an already-refunded order; this does not simulate a provider refund lifecycle.
  await f.db.prepare("UPDATE orders SET checkout_state='refunded' WHERE id=?").bind(order.id).run();
  status=await f.app.tracking(order.id,{cookie});assert.equal(status.data.tracking.stage,'digital_refunded');
});

test('stale or missing file consent fails before a charge, while a lost checkout response recovers the frozen file after replacement',async t=>{
  const f=await fixture(t),request=input(f.file);
  for(const changed of [{expected_file_versions:undefined},{expected_file_versions:{}},{expected_file_versions:{guide:'dfile_'+'0'.repeat(32)}},{expected_file_versions:{other:f.file.version}},{shipping_id:'jne-reg'}]){
    const result=await f.app.request('/cart/api/start.php',{...request,checkout_key:key(),...changed});assert.equal(result.status,422,JSON.stringify(result.data));
  }
  assert.equal(await f.count('orders'),0);assert.equal((await f.providerCalls()).length,0);
  f.control.drop='/internal/commerce/orders';assert.equal((await f.app.request('/cart/api/start.php',request)).status,503);assert.equal(await f.count('orders'),1);
  const replacement=await digitalFixtureFile(f,{replace:true,bytes:Buffer.from('New edition bytes')});
  const stale=await f.app.request('/cart/api/start.php',{...request,checkout_key:key()});assert.equal(stale.status,422);assert.equal((await f.providerCalls()).length,0);
  const recovered=await f.app.request('/cart/api/start.php',request);assert.equal(recovered.status,201,JSON.stringify(recovered.data));
  assert.equal((await f.record(recovered.data.order_id)).items[0].fulfillment.digitalFile.id,f.file.version);assert.equal((await f.providerCalls()).length,1);
  assert.equal((await f.app.request('/cart/api/start.php',{...request,expected_file_versions:{guide:replacement.version}})).status,409);
  const current=await f.app.request('/cart/api/start.php',input(replacement));assert.equal(current.status,201);assert.equal((await f.record(current.data.order_id)).items[0].fulfillment.digitalFile.id,replacement.version);
});

test('mixed checkout quotes and reserves only physical lines, and digital-only rate requests never call a courier',async t=>{
  const f=await fixture(t),request=input(f.file,{cart:{guide:2,tea:3},expected_prices:{guide:25000,tea:20000},expected_total:128000,shipping_id:'jne-reg',customer:{...customer,...physicalAddress}});
  const invalid=await f.app.request('/cart/api/rates.php',{cart:{guide:1},postal_code:'12345'});assert.equal(invalid.status,422);assert.equal((await f.app.calls()).filter(c=>c.url.includes('biteship')).length,0);
  const started=await f.app.request('/cart/api/start.php',request);assert.equal(started.status,201,JSON.stringify(started.data));
  const order=await f.record(started.data.order_id),rates=(await f.app.calls()).filter(c=>c.url.endsWith('/rates/couriers'));
  assert.equal(rates.length,1);const quote=JSON.parse(rates[0].body);assert.equal(quote.items.length,1);assert.equal(quote.items[0].quantity,3);assert.equal(quote.items[0].weight,100);
  assert.equal(order.items.length,2);assert.equal(order.shippingAmount,18000);assert.equal(await f.count('inventory_reservations'),1);
  const reservation=await f.db.prepare('SELECT product_id,quantity FROM inventory_reservations').first();assert.equal(reservation.product_id,'tea');assert.equal(reservation.quantity,3);
  const paid=await f.paid(order,{accountNumber:order.payment.accountNumber});assert.equal(paid.status,200,JSON.stringify(paid));
  const tracking=await f.app.tracking(order.id);assert.equal(tracking.status,200);assert.equal(tracking.data.tracking.stage,'processing');assert.equal(tracking.data.downloads.itemCount,1);assert.equal(tracking.data.downloads.verifiedCount,0);
});

test('the PHP central hold prevents digital storefront availability and legacy file-order fallback',async t=>{
  const f=await fixture(t,{EZKART_COMMERCE_STORAGE:'files'});
  assert.equal((await f.app.request('/cart/api/catalog.php?products=guide')).status,422);
  const storefront=await f.app.request('/cart/api/storefront.php?product=guide');assert.equal(storefront.data.products[0].choices[0].available,false);assert.equal(storefront.data.products[0].digitalFile,null);
  const {checkout_key,expected_prices,expected_total,expected_file_versions,...legacy}=input(f.file);
  assert.equal((await f.app.request('/cart/api/start.php',legacy)).status,422);assert.equal((await f.providerCalls()).length,0);assert.equal(await f.count('orders'),0);
});

async function browser(t){const {chromium}=await import('../builder-mcp/node_modules/playwright/index.mjs'),b=await chromium.launch({headless:true});t.after(()=>b.close());return b;}
test('buyers shop for digital options and complete checkout, payment, download and verified order status at desktop and phone widths',async t=>{
  const f=await fixture(t);await variants(f);const b=await browser(t),screens='/tmp/ezkart-digital-checkout-ui-01a0d643';await mkdir(screens,{recursive:true});
  for(const width of [1360,390]){
    const context=await b.newContext({viewport:{width,height:1000},reducedMotion:'reduce'}),cookie=f.app.customerCookie('checkout@example.com','fixture-google-customer',3600,await f.merchantToken('fixture-google-customer','checkout@example.com'));
    await context.addCookies([cookie]);const p=await context.newPage();p.setDefaultTimeout(20000);const errors=[];p.on('pageerror',e=>errors.push(e.message));
    await p.goto(f.app.base+'/shop/?store=seller_alice');const card=p.locator('[data-product="guide"]');await card.getByRole('button',{name:'Add to cart',exact:true}).waitFor();
    assert.equal(await card.getByText('Digital download · Version 1',{exact:true}).isVisible(),true);
    await card.getByRole('button',{name:'Add to cart',exact:true}).click();await card.getByRole('button',{name:'Add to cart',exact:true}).click();assert.equal(await p.locator('#shop-cart output').textContent(),'2');
    await p.locator('#shop-checkout').click();await p.waitForURL('**/cart/**');await p.locator('#to-checkout').click();
    assert.equal(await p.locator('#checkout-address-section').isVisible(),false);assert.equal(await p.locator('#delivery-method').isVisible(),false);assert.equal(await p.locator('#digital-download-note').isVisible(),true);assert.equal(await p.locator('#shipping-total').textContent(),'No shipping needed');
    await p.locator('#customer-form [name=fullName]').fill(customer.fullName);await p.locator('#customer-form [name=email]').fill(customer.email);await p.locator('#customer-form [name=phone]').fill(customer.phone);
    await p.screenshot({path:screens+'/checkout-'+width+'.png',fullPage:true});assert.equal(await p.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
    const sent=p.waitForRequest(r=>r.url().endsWith('/cart/api/start.php'));await p.locator('#pay-button').click();const body=(await sent).postDataJSON();assert.equal(body.expected_file_versions['guide~basic'],f.file.version);assert.equal(body.customer.address,undefined);assert.equal(body.shipping_id,'');
    await p.waitForURL('**/cart/payment.php?**');const id=new URL(p.url()).searchParams.get('order'),order=await f.record(id);assert.equal(order.items[0].quantity,2);
    await p.locator('#order-shipping').getByText('No shipping needed',{exact:true}).waitFor();const paid=await f.paid(order,{accountNumber:order.payment.accountNumber});assert.equal(paid.status,200,JSON.stringify(paid));
    await p.goto(f.app.base+'/cart/return.php?order='+id);await p.locator('#return-title').getByText('Your files are ready to download',{exact:true}).waitFor();
    assert.equal(await p.locator('#tracking-steps').isVisible(),false);assert.equal(await p.locator('#delivery-map-section').isVisible(),false);await p.getByRole('link',{name:'Open downloads',exact:true}).click();
    await p.getByRole('button',{name:'Download file',exact:true}).click();await p.getByText('Download verified. Save your file below.',{exact:true}).waitFor();
    const [download]=await Promise.all([p.waitForEvent('download'),p.getByRole('link',{name:'Save file',exact:true}).click()]);assert.deepEqual(await readFile(await download.path()),f.file.bytes);
    await p.getByRole('link',{name:'Back to your order',exact:true}).click();await p.locator('#return-title').getByText('Your digital download is verified',{exact:true}).waitFor();
    assert.match(await p.locator('#order-download-state').textContent(),/1 of 1 files received and verified/);await p.screenshot({path:screens+'/verified-'+width+'.png',fullPage:true});
    assert.equal(await p.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);assert.deepEqual(errors,[]);await context.close();
  }
  assert.equal((await f.app.calls()).filter(c=>c.url.includes('biteship')).length,0);assert.equal(await f.count('commerce_digital_deliveries'),2);
});

test('production-shaped PHP validation needs no digital address or shipping bypass, while physical carts still require delivery',async t=>{
  const f=await fixture(t,{EZKART_COMMERCE_ENVIRONMENT:'production',EZKART_BITESHIP_PRODUCTION_API_KEY:''}),request=input(f.file);
  const cli=code=>new Promise((resolve,reject)=>{const child=spawn(process.env.PHP_BINARY||'php',['-n','-r',`require '${process.cwd()}/tools/checkout-test/provider-fixture.php';require '${process.cwd()}/cart/api/bootstrap.php';`+code],{env:f.app.env});let out='',errors='';child.stdout.on('data',chunk=>out+=chunk);child.stderr.on('data',chunk=>errors+=chunk);child.on('error',reject);child.on('exit',code=>code===0?resolve(out.trim()):reject(Error(errors+out)));});
  const result=JSON.parse(await cli(`$input=json_decode(base64_decode('${Buffer.from(JSON.stringify(request)).toString('base64')}'),true);echo ez_json_encode(ez_checkout_request($input));`));
  assert.equal(result.shipping_kind,'none');assert.equal(result.shipping_skipped,false);assert.equal(result.shipping_price,0);assert.deepEqual(result.shipping_items,[]);assert.equal(result.customer.address,'');
  const physical={...request,cart:{tea:1},expected_prices:{tea:20000},expected_file_versions:undefined,expected_total:20000};
  const error=await cli(`try{ez_checkout_request(json_decode(base64_decode('${Buffer.from(JSON.stringify(physical)).toString('base64')}'),true));}catch(InvalidArgumentException $e){echo $e->getMessage();}`);assert.match(error,/valid delivery location/);
  assert.equal((await f.app.calls()).filter(c=>c.url.includes('biteship')).length,0);assert.equal((await f.providerCalls()).length,0);
});

test('a held Worker advertises no downloadable product even when a real published file is present',async t=>{
  const f=await setupCentralFixture(t,{}, {bindings:{COMMERCE_STORAGE:'off'}});await digitalFixtureFile(f);
  const product=await publicCall(f,'/v1/storefront/view?product=guide');assert.equal(product.status,200);assert.equal(product.products[0].digitalFile,null);assert.equal(product.products[0].choices[0].available,false);
  assert.equal((await publicCall(f,'/v1/storefront/products?ids=guide')).products[0].digitalFile,null);
});

test('a file replacement between the PHP catalog read and order transaction cannot charge for an unreviewed edition',async t=>{
  const f=await fixture(t),request=input(f.file);
  f.control.afterResponse=async path=>{if(!path.startsWith('/v1/storefront/products?'))return;f.control.afterResponse=null;await digitalFixtureFile(f,{replace:true,bytes:Buffer.from('Concurrent new edition')});};
  const result=await f.app.request('/cart/api/start.php',request);assert.equal(result.status,422,JSON.stringify(result.data));assert.match(result.data.error,/file changed/);
  assert.equal(await f.count('orders'),0);assert.equal((await f.providerCalls()).length,0);
});

test('digital option changes keep quantity, and removing or adding the last physical item restores the correct delivery requirements',async t=>{
  const f=await fixture(t);await variants(f);const b=await browser(t),p=await b.newPage({viewport:{width:390,height:1000},reducedMotion:'reduce'});p.setDefaultTimeout(20000);
  await p.goto(f.app.base+'/cart/?product=guide');await p.locator('[data-product-options]').waitFor();await p.locator('[data-quantity=plus]').click();await p.locator('[data-product-options]').click();
  const dialog=p.getByRole('dialog');assert.equal(await dialog.getByRole('radio',{name:/extended/}).isDisabled(),false);
  await dialog.getByRole('radio',{name:/extended/}).check();await dialog.getByRole('button',{name:'Update item',exact:true}).click();await dialog.waitFor({state:'hidden'});
  assert.equal(await p.locator('[data-cart-id="guide~extended"] output').textContent(),'2');assert.equal(await p.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
  await p.route('**/api/checkout-config.php',route=>route.fulfill({json:{environment:'production',shipping_required:true,durable_checkout:true}}));
  const mixed=f.app.base+'/cart/?store=seller_alice&cart='+encodeURIComponent('guide~extended:1,tea:1');
  await p.goto(mixed);await p.locator('#to-checkout').click();assert.equal(await p.locator('#checkout-address-section').isVisible(),true);assert.equal(await p.locator('#get-rates').isVisible(),true);assert.equal(await p.locator('#pay-button').isDisabled(),true);
  await p.locator('[data-go=confirm]').click();await p.locator('[data-cart-id=tea] [data-remove]').click();await p.locator('#to-checkout').click();
  assert.equal(await p.locator('#checkout-address-section').isVisible(),false);assert.equal(await p.locator('#customer-form [name=address]').isDisabled(),true);assert.equal(await p.locator('#shipping-total').textContent(),'No shipping needed');assert.equal(await p.locator('#pay-button').isDisabled(),false);
  await p.goto(mixed);await p.locator('#to-checkout').click();assert.equal(await p.locator('#checkout-address-section').isVisible(),true);assert.equal(await p.locator('#customer-form [name=address]').isDisabled(),false);assert.equal(await p.locator('#pay-button').isDisabled(),true);
  assert.equal((await f.app.calls()).filter(c=>c.url.includes('biteship')).length,0);assert.equal((await f.providerCalls()).length,0);
});
