import test from 'node:test';
import assert from 'node:assert/strict';
import {randomBytes} from 'node:crypto';
import {setupCommerceFixture,shippingConfiguration,shippingAddress,fixtureShipping} from './commerce-fixture.mjs';
import {createCommerceOrder} from '../src/commerce-orders.js';

const key=()=>randomBytes(16).toString('hex');
const save=(f,configuration=shippingConfiguration,revision=1,requestKey=key(),options)=>f.merchant('/v1/shipping-settings',{configuration,revision,requestKey},options);
const read=f=>f.merchant('/v1/shipping-settings');
const context=async f=>(await f.call('/internal/commerce/shipping-settings/seller_alice?environment=sandbox')).shipping;
const count=async(f,table)=>(await f.db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).first()).n;

test('shipping settings commit one immutable revision, replay across later edits, and reject competing stale changes',async t=>{
  const f=await setupCommerceFixture(t),second={...shippingAddress,id:'addr_'+'b'.repeat(32),label:'Returns desk',address:'Jalan Returns 20'};
  const configuration={...shippingConfiguration,addresses:[shippingAddress,second],returnAddressId:second.id},requestKey=key();
  const responses=await Promise.all([save(f,configuration,1,requestKey),save(f,configuration,1,requestKey)]);
  assert.deepEqual(responses.map(r=>r.status),[200,200]);assert.deepEqual(responses[0].receipt,responses[1].receipt);
  assert.equal(await count(f,'seller_shipping_changes'),2);assert.equal((await read(f)).settings.configuration.addresses.length,2);
  const racing=await Promise.all([save(f,configuration,2),save(f,{...configuration,couriers:['jne']},2)]);assert.deepEqual(racing.map(r=>r.status).sort(),[200,409]);
  assert.deepEqual((await save(f,configuration,1,requestKey)).receipt,responses[0].receipt);
  assert.equal((await save(f,shippingConfiguration,1,requestKey)).status,409);
  const before=await read(f);assert.equal(before.settings.revision,3);assert.equal(before.recentChanges.length,3);
  await assert.rejects(f.db.prepare("UPDATE seller_shipping_changes SET actor_auth_user_id='bob'").run(),/immutable_shipping_change/);
  await assert.rejects(f.db.prepare("DELETE FROM seller_shipping_settings WHERE seller_id='seller_alice'").run(),/shipping_receipt_required/);
  await assert.rejects(f.db.prepare("UPDATE seller_shipping_settings SET configuration_json='{}' WHERE seller_id='seller_alice'").run(),/shipping_receipt_required/);
  assert.deepEqual((await read(f)).settings,before.settings);
});

test('shipping settings validate complete Indonesian locations and pin requirements and isolate merchant roles and private addresses',async t=>{
  const f=await setupCommerceFixture(t);
  for(const configuration of [
    {...shippingConfiguration,couriers:[]},{...shippingConfiguration,couriers:['jne','jne']},{...shippingConfiguration,couriers:['unknown']},
    {...shippingConfiguration,couriers:['grab']},{...shippingConfiguration,pickupAddressId:'missing'},
    {...shippingConfiguration,addresses:[shippingAddress,shippingAddress]},
    ...[{phone:'123'}, {postalCode:'00000'}, {email:'invalid'}, {address:'\nBad street'}, {coordinate:{latitude:-30,longitude:150}}].map(fields=>({...shippingConfiguration,addresses:[{...shippingAddress,...fields}]})),
  ])assert.equal((await save(f,configuration)).status,422,JSON.stringify(configuration));
  const bob=await f.merchant('/v1/shipping-settings',undefined,{seller:'bob'});assert.equal(bob.settings.revision,0);assert.deepEqual(bob.settings.configuration.addresses,[]);assert.equal(bob.recentChanges.length,0);
  assert.equal((await f.call('/internal/commerce/shipping-settings/seller_bob?environment=sandbox')).status,409);
  assert.equal((await f.call('/internal/commerce/shipping-settings/seller_alice?environment=production')).status,403);
  assert.equal((await f.mf.dispatchFetch('https://api.fixture.test/internal/commerce/shipping-settings/seller_alice?environment=sandbox')).status,401);
  await f.db.prepare("UPDATE seller_memberships SET role='viewer' WHERE auth_user_id='alice'").run();
  assert.equal((await read(f)).canWrite,false);assert.equal((await save(f)).status,403);
  assert.equal(await count(f,'seller_shipping_changes'),1);
});

test('new checkout binds selected addresses and courier settings, preserves original snapshots on replay, and refuses stale quotes or weights',async t=>{
  const f=await setupCommerceFixture(t),input=f.input({shipping:fixtureShipping});
  for(const shipping of [{...fixtureShipping,courierCode:'grab'},{...fixtureShipping,origin:{...fixtureShipping.origin,origin_postal_code:'54322'}},{...fixtureShipping,returnAddress:shippingAddress,pickupAddressId:'foreign'}])assert.equal((await f.create({...input,shipping})).status,409);
  assert.equal(await count(f,'orders'),0);
  const created=await f.create(input);assert.equal(created.status,200,created.error);
  assert.equal((await save(f,{...shippingConfiguration,addresses:[],pickupAddressId:'',returnAddressId:''})).status,200);
  const replay=await f.create(input);assert.equal(replay.status,200);assert.deepEqual(replay.order.snapshot.shipping,created.order.snapshot.shipping);
  assert.equal((await f.create({...input,checkoutKey:key()})).status,409);
  assert.equal((await save(f,shippingConfiguration,2)).status,200);
  const shipping={...fixtureShipping,...await context(f)};delete shipping.couriers;
  await f.db.prepare("UPDATE products SET weight_grams=250 WHERE id='tea'").run();
  assert.equal((await f.create(f.input({shipping}))).status,409);
  const updated=await f.create(f.input({shipping,items:[{productId:'tea',quantity:1,expectedPrice:20000,expectedWeightGrams:250}]}));assert.equal(updated.status,200,updated.error);
  assert.equal(updated.order.items[0].fulfillment.weightGrams,250);
});

test('settings and package-weight changes between preflight and reservation roll back the entire checkout transaction',async t=>{
  const f=await setupCommerceFixture(t);
  for(const kind of ['settings','weight']){
    const shipping={...fixtureShipping,...await context(f)};delete shipping.couriers;
    let injected=false;
    const db=new Proxy(f.db,{get(target,property){if(property==='batch')return async statements=>{
      if(!injected&&statements.some(s=>s.statement.includes('INSERT INTO orders'))){injected=true;
        if(kind==='settings'){const current=await read(f);assert.equal((await save(f,{...shippingConfiguration,couriers:['jne']},current.settings.revision)).status,200);}
        else await f.db.prepare("UPDATE products SET weight_grams=900 WHERE id='tea'").run();
      }return target.batch(statements);
    };const value=Reflect.get(target,property);return typeof value==='function'?value.bind(target):value;}});
    await assert.rejects(createCommerceOrder({DB:db,APP_ENVIRONMENT:'test',COMMERCE_STORAGE:'d1'},f.input({shipping})),error=>error instanceof Response&&error.status===409);
    assert(injected);for(const table of ['orders','customers','order_items','inventory_reservations','commerce_jobs'])assert.equal(await count(f,table),0,table);
  }
});
