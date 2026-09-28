import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdir} from 'node:fs/promises';
import {setupCentralFixture} from './central-fixture.mjs';
import {browser,pageFor} from './review-workspace-fixture.mjs';
test('customer request survives a lost acknowledgement/reload; merchant sees frozen terms and cancellation',async t=>{
 const f=await setupCentralFixture(t);await f.db.prepare("INSERT INTO products(id,seller_id,type,status,title,price_amount,created_at,updated_at) VALUES('membership','seller_alice','subscription','active','Membership',12000,'now','now')").run();
 await f.db.prepare("INSERT INTO product_variants(id,seller_id,product_id,name,sku,price_amount,billing_interval,billing_interval_count,sort_order,created_at,updated_at) VALUES('monthly','seller_alice','membership','Monthly','MEM-1',12000,'month',1,1,'now','now')").run();
 await f.merchant('/v1/storefront',{enabled:true,name:'Subscription store',accent:'#334155',button:'#111827',background:'#f7f8fa',logoId:'',backgroundId:'',animation:'none'});
 const b=await browser(t),p=await pageFor(b,f,390,f.app.customerCookie()),errors=[];p.on('pageerror',e=>errors.push(e.message));
 await p.goto(f.app.base+'/shop/?store=seller_alice');await p.getByRole('link',{name:'Review subscription request'}).click();await p.getByRole('button',{name:'Save subscription request'}).waitFor();
 await p.locator('[data-subscription-offer] input').check();f.control.drop='/internal/commerce/customer-subscriptions';await p.getByRole('button',{name:'Save subscription request'}).click();await p.getByRole('button',{name:'Retry saved request'}).waitFor();
 assert.equal(await f.count('commerce_subscriptions'),1);await p.reload();await p.getByRole('button',{name:'Retry saved request'}).click();await p.getByText('Request saved. No charge was authorized.',{exact:true}).waitFor();assert.equal(await f.count('commerce_subscriptions'),1);
 await p.getByRole('button',{name:'Cancel future renewals'}).click();await p.getByRole('button',{name:'Keep subscription'}).click();assert.equal(await p.getByRole('button',{name:'Confirm cancellation'}).count(),0);
 assert.equal(await p.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);await mkdir('/tmp/ezkart-subscriptions-wave2',{recursive:true});await p.screenshot({path:'/tmp/ezkart-subscriptions-wave2/customer.png',fullPage:true});
 const merchant=await pageFor(b,f,1360,f.app.adminCookie({supabase_access_token:await f.merchantToken('alice','alice@example.test'),admin_user:{id:'alice',email:'alice@example.test'}}));merchant.on('pageerror',e=>errors.push(e.message));await merchant.goto(f.app.base+'/cart/admin/?page=customers&tab=subscriptions');await merchant.getByRole('button',{name:'Cancel future renewals'}).click();await merchant.getByRole('button',{name:'Confirm cancellation'}).click();await merchant.getByText(/^Cancelled /).waitFor();await merchant.screenshot({path:'/tmp/ezkart-subscriptions-wave2/merchant.png',fullPage:true});
 await p.reload();await p.getByText(/^Cancelled /).waitFor();assert.deepEqual(errors,[]);assert.equal((await f.providerCalls()).length,0);
});
