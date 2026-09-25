import assert from 'node:assert/strict';
import {randomBytes} from 'node:crypto';
import {setupCentralFixture} from './central-fixture.mjs';
import {fixtureShipping} from '../../cloudflare/ezkart-api/test/commerce-fixture.mjs';

export const key=()=>randomBytes(16).toString('hex'),productId='custom-reviewtea',buyer='fixture-google-customer';
export async function reviewFixture(t,{legacy=0,...overrides}={}){
  const f=await setupCentralFixture(t,overrides);await f.product(productId,1000);await f.db.prepare('UPDATE products SET title=? WHERE id=?').bind('Everyday jasmine tea',productId).run();
  const made=await f.create(f.input({shipping:fixtureShipping,items:[{productId,quantity:1,expectedPrice:20000,expectedWeightGrams:100}],customer:{name:'Private Buyer',email:'checkout@example.com',phone:'081234567890',authUserId:buyer}}));assert.equal(made.status,200,made.error);const order=made.order;assert.equal((await f.paid(order)).status,200);
  let shipment;
  for(const kind of ['accept','pickup']){const d=await f.merchant('/v1/fulfillment/'+order.id),r=await f.merchant('/v1/fulfillment/'+order.id,{kind,revision:d.order.revision,requestKey:key()},{method:'POST'});assert.equal(r.status,200,r.error);if(kind==='pickup')shipment=r.receipt.shipmentId;}
  await f.call(`/internal/commerce/shipments/${shipment}/account`,{environment:'sandbox',accountHash:'a'.repeat(64)});
  const s=(await f.call(`/internal/commerce/shipments/${shipment}?environment=sandbox`)).shipment;
  const bound=await f.call(`/internal/commerce/shipments/${shipment}/bind`,{environment:'sandbox',verified:true,providerId:'courier_'+shipment,reference:s.reference,data:{kind:'status',status:'delivered',updatedAt:new Date().toISOString()}});assert.equal(bound.status,200,bound.error);
  const buyerPath=`/v1/customer/orders/${order.id}/reviews`,item=(await f.merchant(buyerPath,undefined,{seller:buyer})).items[0];
  const upload=await f.merchant(`/v1/customer/orders/${order.id}/review-media`,{orderItemId:item.orderItemId,requestKey:key(),dataUrl:'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a8x8AAAAASUVORK5CYII='},{seller:buyer,method:'POST'});assert.equal(upload.status,200,upload.error);
  const publish=(revision,extra={})=>f.merchant(buyerPath,{kind:'publish',orderItemId:item.orderItemId,revision,requestKey:key(),rating:2,title:'After a week of use',body:'A useful review <img src=x onerror=alert(1)> with specific feedback.',publicName:'Tea fan',photos:[upload.photo.id],...extra},{seller:buyer,method:'POST'});
  const published=await publish(0);assert.equal(published.status,200,published.error);const review=published.review;
  const customer=(await f.db.prepare('SELECT customer_id FROM orders WHERE id=?').bind(order.id).first()).customer_id;
  const addLegacy=(id,rating=4,state='published')=>f.db.prepare(`INSERT INTO product_reviews(id,seller_id,product_id,customer_id,rating,title,body,status,created_at,updated_at,public_name,moderation_state)
    VALUES(?,'seller_alice',?,?,?,'A past experience','Historical review text',?,'2026-01-01T00:00:00.000Z','2026-01-01T00:00:00.000Z','Past customer',?)`).bind(id,productId,customer,rating,state,state==='published'?'visible':state==='pending'?'pending':'hidden').run();
  for(let n=0;n<legacy;n++)await addLegacy('old_review_'+String(n).padStart(3,'0'),n%5+1);
  await f.merchant('/v1/storefront',{enabled:true,name:'Jasmine & Co',accent:'#334155',button:'#111827',background:'#f7f8fa',logoId:'',backgroundId:'',animation:'none'});
  const cookie=f.app.adminCookie({supabase_access_token:await f.merchantToken('alice','alice@example.test'),admin_user:{id:'alice',email:'alice@example.test'}});
  const change=(kind,revision,extra={})=>f.merchant('/v1/commerce/reviews/'+review.id,{kind,revision,requestKey:key(),...extra},{method:'POST'});
  return {...f,order,review,item,cookie,publish,change,addLegacy,photoId:upload.photo.id,buyerPath};
}
export async function browser(t){const {chromium}=await import('../builder-mcp/node_modules/playwright/index.mjs'),b=await chromium.launch({headless:true});t.after(()=>b.close());return b;}
export async function pageFor(b,f,width=1360,cookie=f.cookie){const context=await b.newContext({viewport:{width,height:1000},reducedMotion:'reduce'});if(cookie)await context.addCookies([cookie]);const p=await context.newPage();p.setDefaultTimeout(12000);return p;}
export async function choose(page,container,name,label){
  const source=container.locator('select[name='+name+']');
  if(await source.evaluate(()=>CSS.supports('appearance','base-select')))await source.click();
  else await source.locator('xpath=..').locator('.ezkart-select-trigger').click();
  await page.getByRole('option',{name:label,exact:true}).click();
}
