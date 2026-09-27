import test from 'node:test';
import assert from 'node:assert/strict';
import {createCommerceOrder,newCheckoutEnabled} from '../src/commerce-orders.js';
import {setupCommerceFixture} from './commerce-fixture.mjs';

test('beta requires explicit checkout activation; other deployments retain their existing default',()=>{
  for(const APP_ENVIRONMENT of ['test','beta','production']){
    for(const COMMERCE_CHECKOUT of [undefined,'','held','enabled','true','Enabled']){
      assert.equal(newCheckoutEnabled({APP_ENVIRONMENT,COMMERCE_CHECKOUT}),
        COMMERCE_CHECKOUT==='enabled'||(APP_ENVIRONMENT!=='beta'&&[undefined,''].includes(COMMERCE_CHECKOUT)));
    }
  }
});

test('a held beta rejects new orders but preserves merchant access, original checkout recovery and deduplicated payment events',async t=>{
  const f=await setupCommerceFixture(t,{bindings:{APP_ENVIRONMENT:'beta',COMMERCE_CHECKOUT:'held'}});
  const count=async table=>(await f.db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).first()).n;
  const input=f.input();
  const rejected=await f.create(input);assert.equal(rejected.status,503);assert.match(rejected.error,/temporarily paused/);
  for(const table of ['orders','customers','inventory_reservations','commerce_jobs','commerce_payment_captures'])assert.equal(await count(table),0,table);
  assert.equal(await f.stock(),10);
  assert.equal((await f.merchant('/v1/commerce/marketing/workspace')).status,200);
  assert.equal((await f.merchant('/v1/shipping-settings')).status,200);
  // Model an order accepted before the hold against the same database and guards.
  const existing=await createCommerceOrder({APP_ENVIRONMENT:'beta',COMMERCE_CHECKOUT:'enabled',DB:f.db},input);
  const replay=await f.create(input);assert.equal(replay.status,200,replay.error);assert.equal(replay.order.id,existing.id);
  assert.equal((await f.create({...input,customer:{...input.customer,name:'Changed'}})).status,409);
  assert.equal((await f.create(f.input())).status,503);
  assert.equal((await f.paid(existing)).status,200);assert.equal((await f.paid(existing)).status,200);
  assert.equal(await count('orders'),1);assert.equal(await count('commerce_payment_captures'),1);assert.equal(await f.stock(),8);
});
