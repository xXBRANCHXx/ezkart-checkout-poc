import test from 'node:test';
import assert from 'node:assert/strict';
import {randomBytes} from 'node:crypto';
import {setupCommerceFixture,fixtureShipping} from './commerce-fixture.mjs';
import {applyCommerceSchema} from './commerce-schema.mjs';
import {digitalFixtureFile} from './digital-commerce-fixture.mjs';
import {digitalDownloadProof} from '../src/commerce-digital.js';
import {digitalPartBytes} from '../src/digital-files.js';

const base='/internal/commerce/finance/delivery',key=()=>randomBytes(16).toString('hex');
const count=async(f,table)=>(await f.db.prepare('SELECT COUNT(*) AS n FROM '+table).first()).n;
async function fixture(t,{digital=0,physical=true,skipped=false,bytes,through=Infinity,bindings={}}={}){
  const f=await setupCommerceFixture(t,{through,bindings}),buyer='delivery-buyer',environment=bindings.APP_ENVIRONMENT==='beta'?'production':'sandbox',items=[],files=[];
  if(physical)items.push({productId:'tea',quantity:2,expectedPrice:20000,expectedWeightGrams:100});
  for(let n=0;n<digital;n++){const file=await digitalFixtureFile(f,{id:'guide_'+n,sku:'GUIDE'+n,bytes});files.push(file);items.push(file.item);}
  const created=await f.create(f.input({items,customer:{name:'Buyer',email:'buyer@example.test',phone:'081234567890',authUserId:buyer},
    shipping:physical?(skipped?{amount:0,skipped:true}:fixtureShipping):{amount:0,skipped:false,kind:'none'}}));assert.equal(created.status,200,created.error);
  const paid=await f.paid(created.order);assert.equal(paid.status,200,paid.error);const order=paid.order;
  const status=(seller='seller_alice',suffix='')=>f.call(base+'?seller='+seller+'&environment='+environment+'&orderId='+order.id+suffix);
  const reconcile=(extra={})=>f.call(base+'/reconcile',{seller:'seller_alice',environment,...extra});
  const pickup=async()=>{
    let shipmentId;
    for(const kind of ['accept','pickup']){const d=await f.merchant('/v1/fulfillment/'+order.id),r=await f.merchant('/v1/fulfillment/'+order.id,{requestKey:key(),revision:d.order.revision,kind},{method:'POST'});assert.equal(r.status,200,r.error);shipmentId=r.receipt.shipmentId||shipmentId;}
    assert.equal((await f.call('/internal/commerce/shipments/'+shipmentId+'/account',{environment,accountHash:'a'.repeat(64)})).status,200);
    const detail=await f.call('/internal/commerce/shipments/'+shipmentId+'?environment='+environment);
    return {id:shipmentId,reference:detail.shipment.reference,provider:'fixture_'+shipmentId};
  };
  const bind=(shipment,data={kind:'status',status:'delivered',updatedAt:new Date().toISOString()})=>f.call('/internal/commerce/shipments/'+shipment.id+'/bind',
    {environment,verified:true,providerId:shipment.provider,reference:shipment.reference,data});
  const deliver=async data=>{const shipment=await pickup(),result=await bind(shipment,data);assert.equal(result.status,200,result.error);return shipment;};
  const callback=(shipment,data)=>f.call('/internal/commerce/shipping-events',{environment,providerId:shipment.provider,data});
  const grant=async(n=0)=>{const item=order.items.find(i=>i.productId===files[n].id),prefix='/v1/customer/orders/'+order.id+'/downloads/'+item.id+'/grants';
    const r=await f.merchant(prefix,{requestKey:key()},{seller:buyer,method:'POST'});assert.equal(r.status,200,r.error);return prefix+'/'+r.grant.id;};
  const part=async(prefix,n)=>{
    const r=await f.mf.dispatchFetch('https://api.fixture.test'+prefix+'/parts/'+n,{headers:{authorization:'Bearer '+await f.merchantToken(buyer)}});assert.equal(r.status,200);
    const proof=await digitalDownloadProof(prefix.split('/').at(-1),n,r.headers.get('x-ezkart-file-challenge'),new Uint8Array(await r.arrayBuffer()));
    return f.merchant(prefix+'/parts/'+n+'/receipt',{proof},{seller:buyer,method:'POST'});
  };
  const download=async(n=0)=>{const prefix=await grant(n);for(let p=1;p<=Math.ceil(files[n].bytes.length/digitalPartBytes);p++){const r=await part(prefix,p);assert.equal(r.status,200,r.error);}return prefix;};
  return {...f,order,buyer,environment,files,status,reconcile,pickup,bind,deliver,callback,grant,part,download};
}

test('actual applied courier delivery creates one original capture receipt and replays leave money unchanged',async t=>{
  const f=await fixture(t),before=(await f.db.prepare('SELECT * FROM commerce_financial_entries').all()).results;
  assert.equal((await f.status()).deliveryConfirmed,false);
  const shipment=await f.pickup(),data={kind:'status',status:'delivered',updatedAt:new Date().toISOString()};
  assert.equal((await f.callback(shipment,data)).matched,false);assert.equal((await f.status()).deliveryConfirmed,false,'unbound callback is not proof');
  assert.equal((await f.bind(shipment,data)).status,200);const first=await f.status();assert.equal(first.status,200,first.error);
  assert.equal(first.deliveryConfirmed,true);assert.equal(first.receipt.source.items.length,1);const item=first.receipt.source.items[0];
  assert.equal(item.quantity,2);assert.equal(item.shipmentId,shipment.id);assert.equal(item.eventIndex,-1);assert.equal(item.deliveredAt,data.updatedAt);
  assert.equal(first.releaseReady,false);assert.equal(first.settlementVerified,false);assert.equal(first.availableToWithdraw,null);
  assert.equal((await f.callback(shipment,data)).status,200);assert.equal((await f.bind(shipment,data)).status,200);
  assert.equal(await count(f,'commerce_order_delivery_receipts'),1);assert.deepEqual((await f.status()).receipt,first.receipt);
  assert.deepEqual((await f.db.prepare('SELECT * FROM commerce_financial_entries').all()).results,before);
  assert.deepEqual(await f.reconcile(),{status:200,ok:true,recorded:0,remainingEligible:0,caughtUp:true,earningsReleased:false});
});

test('native and partial digital downloads do not count; a complete original purchase does even after catalog replacement',async t=>{
  const f=await fixture(t,{physical:false,digital:1,bytes:randomBytes(digitalPartBytes+9)}),prefix=await f.grant();
  const native=await f.mf.dispatchFetch('https://api.fixture.test'+prefix+'/file',{headers:{authorization:'Bearer '+await f.merchantToken(f.buyer)}});assert.equal(native.status,200);await native.arrayBuffer();
  assert.equal((await f.status()).deliveryConfirmed,false);assert.equal((await f.part(prefix,1)).status,200);assert.equal((await f.status()).deliveryConfirmed,false);
  assert.equal((await f.part(prefix,2)).status,200);const original=await f.status();assert.equal(original.deliveryConfirmed,true);
  assert.equal(original.receipt.source.items[0].versionId,f.files[0].version);assert.equal(original.receipt.source.items[0].parts,2);
  await digitalFixtureFile(f,{id:f.files[0].id,replace:true,bytes:Buffer.from('A later edition')});await f.db.prepare('UPDATE products SET status=? WHERE id=?').bind('archived',f.files[0].id).run();
  assert.deepEqual((await f.status()).receipt,original.receipt);assert.equal((await f.part(prefix,2)).status,200);assert.equal(await count(f,'commerce_order_delivery_receipts'),1);
});

test('mixed orders require every original file and courier delivery regardless of completion order',async t=>{
  for(const physicalFirst of [true,false]){
    const f=await fixture(t,{digital:2});
    if(physicalFirst)await f.deliver();
    await f.download(0);assert.equal((await f.status()).deliveryConfirmed,false);await f.download(1);
    if(!physicalFirst){assert.equal((await f.status()).deliveryConfirmed,false);await f.deliver();}
    const result=await f.status();assert.equal(result.deliveryConfirmed,true);assert.equal(result.receipt.source.items.length,3);
    assert.equal(new Set(result.receipt.source.items.map(i=>i.orderItemId)).size,3);assert.equal(await count(f,'commerce_order_delivery_receipts'),1);
    assert.equal(result.releaseReady,false);
  }
});

test('shipping skips, mutable labels and stale delivered callbacks cannot manufacture receipts',async t=>{
  const skipped=await fixture(t,{skipped:true});await skipped.db.prepare("UPDATE orders SET fulfillment_state='delivered' WHERE id=?").bind(skipped.order.id).run();
  assert.equal((await skipped.reconcile()).recorded,0);assert.equal((await skipped.status()).deliveryConfirmed,false);
  const f=await fixture(t),shipment=await f.pickup(),at=new Date().toISOString();
  assert.equal((await f.bind(shipment,{kind:'status',status:'cancelled',updatedAt:at})).status,200);
  assert.equal((await f.callback(shipment,{kind:'status',status:'delivered',updatedAt:at})).status,200);
  assert.equal((await f.status()).deliveryConfirmed,false);assert.equal(await count(f,'commerce_order_delivery_receipts'),0);
});

test('verified courier history retains delivery while return and refund holds remain current',async t=>{
  const f=await fixture(t),at=new Date(Date.now()-1000).toISOString();
  await f.deliver({kind:'status',status:'returned',updatedAt:new Date().toISOString(),history:[{kind:'status',status:'delivered',updatedAt:at}]});
  let status=await f.status();assert.equal(status.deliveryConfirmed,true);assert.equal(status.receipt.source.items[0].eventIndex,0);assert(status.holds.includes('courier_return'));
  const path='/v1/commerce/refunds/orders/'+f.order.id;
  // The merchant refund route is shared with the existing purchase-bound flow.
  const overview=await f.merchant(path);assert.equal(overview.status,200,overview.error);
  const requested=await f.merchant(path,{requestKey:key(),orderRevision:overview.order.revision,reason:'not_received',note:'The courier returned the purchase.',items:[{orderItemId:f.order.items[0].id,amount:1000}]},{method:'POST'});assert.equal(requested.status,200,requested.error);
  status=await f.status();assert(status.holds.includes('refund_requires_reconciliation'));const receipt=status.receipt;
  await f.paid(f.order,{reference:'second-capture'});status=await f.status();assert(status.holds.includes('payment_review'));assert.deepEqual(status.receipt,receipt);assert.equal(status.releaseReady,false);
});

test('digital completion and financial delivery evidence roll back together and recover the original download',async t=>{
  const f=await fixture(t,{physical:false,digital:1}),prefix=await f.grant();
  await f.db.prepare("CREATE TRIGGER fail_delivery BEFORE INSERT ON commerce_order_delivery_receipts BEGIN SELECT RAISE(ABORT,'fixture_delivery_failure'); END").run();
  assert.equal((await f.part(prefix,1)).status,500);assert.equal(await count(f,'commerce_digital_deliveries'),0);assert.equal(await count(f,'commerce_digital_part_receipts'),0);
  assert.equal(await count(f,'commerce_order_delivery_receipts'),0);assert.equal(await count(f,'commerce_financial_journals'),1);
  await f.db.prepare('DROP TRIGGER fail_delivery').run();assert.equal((await f.part(prefix,1)).status,200);assert.equal((await f.status()).deliveryConfirmed,true);
});

test('courier receipt failure leaves its original event unapplied until the same callback recovers',async t=>{
  const f=await fixture(t),shipment=await f.pickup(),data={kind:'status',status:'delivered',updatedAt:new Date().toISOString()};
  await f.db.prepare("CREATE TRIGGER fail_delivery BEFORE INSERT ON commerce_order_delivery_receipts BEGIN SELECT RAISE(ABORT,'fixture_delivery_failure'); END").run();
  assert.equal((await f.bind(shipment,data)).status,500);assert.equal(await count(f,'commerce_order_delivery_receipts'),0);
  assert.equal((await f.db.prepare('SELECT delivered_at FROM commerce_shipments WHERE id=?').bind(shipment.id).first()).delivered_at,null);
  assert.equal((await f.db.prepare('SELECT applied_at FROM commerce_shipping_inbox WHERE provider_id=?').bind(shipment.provider).first()).applied_at,null);
  await f.db.prepare('DROP TRIGGER fail_delivery').run();assert.equal((await f.bind(shipment,data)).status,200);assert.equal((await f.status()).deliveryConfirmed,true);
  assert.equal(await count(f,'commerce_shipping_inbox'),1);assert.equal(await count(f,'commerce_order_delivery_receipts'),1);
});

test('migration catch-up uses existing complete sources, rejects forged receipts and converges under concurrent batches',async t=>{
  const f=await fixture(t,{digital:1,through:49});await f.deliver();await f.download();
  await applyCommerceSchema(f.db,49);assert.equal((await f.status()).deliveryConfirmed,false);
  const a=await f.db.prepare('SELECT * FROM commerce_order_delivery_accounting').first();assert(a);
  const record=changes=>{const r={id:'delivery_'+a.capture_id,...a,recorded_at:new Date().toISOString(),...changes};return f.db.prepare(`INSERT INTO commerce_order_delivery_receipts
    (id,seller_id,order_id,commerce_environment,capture_id,item_count,source_json,confirmed_at,recorded_at) VALUES(?,?,?,?,?,?,?,?,?)`)
    .bind(...['id','seller_id','order_id','commerce_environment','capture_id','item_count','source_json','confirmed_at','recorded_at'].map(k=>r[k])).run();};
  for(const changes of [{seller_id:'seller_bob'},{commerce_environment:'production'},{item_count:1},{source_json:'{}'},{confirmed_at:'made up'},{id:'invented'}])await assert.rejects(record(changes),/delivery_source_mismatch/);
  const results=await Promise.all([f.reconcile({limit:1}),f.reconcile({limit:1})]);assert(results.every(r=>r.status===200),JSON.stringify(results));assert.equal(results.reduce((n,r)=>n+r.recorded,0),1);
  assert.equal((await f.status()).deliveryConfirmed,true);assert.equal((await f.reconcile()).recorded,0);
  for(const sql of ['DELETE FROM commerce_order_delivery_receipts',"UPDATE commerce_order_delivery_receipts SET source_json='{}'",'INSERT OR REPLACE INTO commerce_order_delivery_receipts SELECT * FROM commerce_order_delivery_receipts'])await assert.rejects(f.db.prepare(sql).run(),/delivery_immutable/);
  for(const table of ['commerce_shipping_inbox','commerce_digital_purchases','commerce_digital_entitlements','commerce_digital_download_grants','commerce_digital_part_challenges','commerce_digital_part_receipts','commerce_digital_deliveries']){
    await assert.rejects(f.db.prepare('INSERT OR REPLACE INTO '+table+' SELECT * FROM '+table+' LIMIT 1').run(),/immutable/);
  }
});

test('service authentication and exact store, order, environment and parameter scopes protect delivery evidence',async t=>{
  const f=await fixture(t);await f.deliver();const path=base+'?seller=seller_alice&environment=sandbox&orderId='+f.order.id;
  assert.equal((await f.merchant(path)).status,401);assert.equal((await f.status('seller_bob')).status,404);
  for(const suffix of ['&seller=seller_bob','&amount=250000','&orderId='+f.order.id])assert.equal((await f.status('seller_alice',suffix)).status,422);
  assert.equal((await f.call(path.replace('sandbox','production'))).status,403);
  for(const extra of [{environment:'production'},{delivered:true},{amount:250000},{limit:101},{orderId:'foreign'},{seller:'bad\n'}])assert([403,422].includes((await f.reconcile(extra)).status));
  assert.equal((await f.call(base+'/reconcile?override=true',{seller:'seller_alice',environment:'sandbox'})).status,404);
  for(const body of ['{"seller":"seller_alice","environment":"sandbox","limit":1,"limit":2}',JSON.stringify({seller:'seller_alice',environment:'sandbox',padding:'x'.repeat(3000)})]){
    const path=base+'/reconcile',r=await f.mf.dispatchFetch('https://api.fixture.test'+path,{method:'POST',headers:f.headers(path,'POST',body),body});
    assert([413,422].includes(r.status),await r.text());
  }
  const beta=await fixture(t,{bindings:{APP_ENVIRONMENT:'beta'}});await beta.deliver();const live=await beta.status();assert.equal(live.status,200,live.error);assert.equal(live.deliveryConfirmed,true);assert.equal(live.releaseReady,false);
});
