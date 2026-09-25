import test from 'node:test';
import assert from 'node:assert/strict';
import {setupCommerceFixture,fixtureShipping} from './commerce-fixture.mjs';

const path='/v1/commerce/orders';
async function seedReadOrders(f,count=225,start=0,step=2){
  const ids=[];
  for(let n=0;n<count;n++){
    const number=start+n*step,id='EZK-S-'+number.toString(16).toUpperCase().padStart(24,'0');ids.push(id);
    const createdAt='2026-09-25T02:00:00.000Z',name=number===0?'Saved product 50% "special"':'Saved tea '+number;
    await f.db.batch([
      f.db.prepare(`INSERT INTO orders(id,seller_id,commerce_version,commerce_environment,checkout_state,subtotal_amount,total_amount,customer_snapshot_json,snapshot_json,created_at,updated_at)
        VALUES (?,'seller_alice',1,'sandbox','pending',20000,20000,?, ?,?,?)`).bind(id,JSON.stringify({name:'Buyer '+number,email:'buyer'+number+'@example.test',phone:'081234567890'}),JSON.stringify({fees:{plan:'standard'},shipping:{skipped:true}}),createdAt,createdAt),
      f.db.prepare(`INSERT INTO order_items(id,seller_id,order_id,product_id,product_type,title,sku,quantity,unit_price_amount,fulfillment_snapshot_json,created_at)
        VALUES (?,'seller_alice',?,'tea','physical',?, ?,1,20000,'{"variantId":"","variantName":"Original size","weightGrams":100}',?)`).bind('read_item_'+id,id,name,'SAVED-'+number,createdAt),
    ]);
  }
  return ids;
}

test('order reads require merchant identity, isolate sellers, allow viewers and reject writes and invalid filters',async t=>{
  const f=await setupCommerceFixture(t),created=await f.create(f.input());assert.equal(created.status,200);
  const id=created.order.id;
  assert.equal((await f.mf.dispatchFetch('https://api.fixture.test'+path)).status,401);
  for(const suffix of ['','/captures','/activity'])assert.equal((await f.merchant(path+'/'+id+suffix,undefined,{seller:'bob'})).status,404);
  const bob=await f.merchant(path,undefined,{seller:'bob'});assert.equal(bob.summary.total,0);assert.deepEqual(bob.items,[]);
  await f.db.prepare("UPDATE seller_memberships SET role='viewer' WHERE auth_user_id='alice'").run();
  assert.equal((await f.merchant(path)).items.length,1);assert.equal((await f.merchant(path+'/'+id)).order.id,id);
  assert.equal((await f.merchant(path,{}, {method:'POST'})).status,405);
  for(const query of ['seller=seller_bob','environment=production','limit=0','limit=51','limit=1.2','limit=2&limit=3','queue=fake','state=PAID','from=2026-02-30','from=2026-09-25&to=2026-09-24','cursor=bad','q=%00']) {
    assert.equal((await f.merchant(path+'?'+query)).status,422,query);
  }
});

test('all records beyond 200 remain reachable with tied dates, fixed insertion watermark and full database totals',async t=>{
  const f=await setupCommerceFixture(t),ids=await seedReadOrders(f);let page=await f.merchant(path+'?limit=37');
  assert.equal(page.status,200,page.error);assert.equal(page.summary.total,225);assert.equal(page.matching,225);
  const seen=page.items.map(i=>i.id),firstCursor=page.nextCursor;
  // A newly inserted order has the same timestamp and an ID in a later page.
  await seedReadOrders(f,1,1,1);
  while(page.nextCursor){page=await f.merchant(path+'?limit=37&cursor='+page.nextCursor);assert.equal(page.status,200,page.error);seen.push(...page.items.map(i=>i.id));assert.equal(page.summary.total,225);}
  assert.equal(seen.length,225);assert.equal(new Set(seen).size,225);assert.deepEqual(new Set(seen),new Set(ids));
  const priorPage=await f.merchant(path+'?limit=37&cursor='+page.previousCursor);assert.equal(priorPage.items.length,37);assert.equal(priorPage.summary.total,225);
  const returnPage=await f.merchant(path+'?limit=37&cursor='+priorPage.nextCursor);assert.deepEqual(returnPage.items.map(i=>i.id),page.items.map(i=>i.id));
  assert.equal((await f.merchant(path+'?limit=37')).summary.total,226);
  assert.equal((await f.merchant(path+'?state=paid&cursor='+firstCursor)).status,422);
  assert.equal((await f.merchant(path+'?cursor='+firstCursor,undefined,{seller:'bob'})).status,422);
  assert.equal((await f.merchant(path+'?q='+encodeURIComponent('50% "special"'))).matching,1);
  const sku=await f.merchant(path+'?q=SAVED-0');assert.deepEqual(sku.items.map(i=>i.id),[ids[0]]);
  assert.equal((await f.merchant(path+'?from=2026-09-25&to=2026-09-25')).matching,226);
  assert.equal((await f.merchant(path+'?from=2026-09-24&to=2026-09-24')).matching,0);
});

test('confirmed totals count each order once, additional captures require review and details retain original prices and addresses',async t=>{
  const f=await setupCommerceFixture(t),created=await f.create(f.input({shipping:fixtureShipping,customer:{name:'Snapshot Buyer',email:'saved@example.test',phone:'081234567891',authUserId:'private-auth-identity'}}));
  assert.equal(created.status,200,created.error);const o=created.order;
  assert.equal((await f.paid(o)).status,200);
  assert.equal((await f.paid(o,{reference:'second-payment'})).status,200);
  const stock=await f.stock();await f.db.prepare("UPDATE products SET title='Renamed today',price_amount=90000 WHERE id='tea'").run();
  const list=await f.merchant(path);assert.equal(list.status,200,list.error);
  assert.equal(list.summary.total,1);assert.equal(list.summary.paid,1);assert.equal(list.summary.confirmedAmount,String(o.total));assert.equal(list.summary.additionalAmount,String(o.total));
  assert.equal(list.queues.attention,1);assert.equal((await f.merchant(path+'?queue=attention')).matching,1);
  const detail=await f.merchant(path+'/'+o.id);assert.equal(detail.status,200,detail.error);
  assert.equal(detail.order.items[0].title,'tea');assert.equal(detail.order.items[0].price,20000);assert.equal(detail.order.snapshot.destination.address,fixtureShipping.destination.address);
  assert.equal(detail.order.snapshot.origin.address,fixtureShipping.origin.origin_address);
  assert.equal(detail.captures.items.length,2);assert.equal(detail.order.paymentReview,true);assert.equal(detail.inventory[0].state,'committed');
  assert(!JSON.stringify(detail).match(/private-auth-identity|providerRequestId|intentHash|accountNumber|lease_token|request_hash|payload_json/));
  assert.equal(await f.stock(),stock);
});

test('capture and activity histories page independently and retain a fixed insertion watermark',async t=>{
  const f=await setupCommerceFixture(t),o=(await f.create(f.input())).order;
  for(let n=0;n<26;n++)assert.equal((await f.paid(o,{reference:'capture-'+n})).status,200);
  const detail=await f.merchant(path+'/'+o.id);assert.equal(detail.status,200,detail.error);
  assert.equal(detail.captures.items.length,20);assert(detail.captures.nextCursor);assert(detail.activity.nextCursor);
  await f.paid(o,{reference:'after-first-page'});
  const more=await f.merchant(path+'/'+o.id+'/captures?limit=5&cursor='+detail.captures.nextCursor);
  assert.equal(more.status,200,more.error);assert.equal(more.items.length,5);assert(more.nextCursor);
  const last=await f.merchant(path+'/'+o.id+'/captures?cursor='+more.nextCursor);assert.equal(last.items.length,1);assert.equal(last.nextCursor,null);
  const all=[...detail.captures.items,...more.items,...last.items];assert.equal(new Set(all.map(i=>i.id)).size,26);assert(!all.some(i=>i.reference==='after-first-page'));
  assert.equal((await f.merchant(path+'/'+o.id+'/activity?cursor='+detail.captures.nextCursor)).status,422);
  const activities=await f.merchant(path+'/'+o.id+'/activity?cursor='+detail.activity.nextCursor);assert.equal(activities.status,200,activities.error);assert(activities.items.length>0);
  assert(!JSON.stringify(activities).match(/providerRequestId|payload|authUserId/));
});

test('Jakarta date boundaries, terminal payment states and physical fulfillment queues are explicit',async t=>{
  const f=await setupCommerceFixture(t);await seedReadOrders(f,2);
  // Fixture-only historical insert avoids rewriting an immutable order timestamp.
  await f.db.prepare(`INSERT INTO orders(id,seller_id,commerce_version,commerce_environment,checkout_state,subtotal_amount,total_amount,customer_snapshot_json,snapshot_json,created_at,updated_at)
    VALUES (?,'seller_alice',1,'sandbox','expired',1,1,'{}','{"fees":{"plan":"standard"},"shipping":{"skipped":true}}','2026-09-24T16:59:59.999Z','2026-09-24T16:59:59.999Z')`).bind('EZK-S-'+'F'.repeat(24)).run();
  assert.equal((await f.merchant(path+'?from=2026-09-24&to=2026-09-24')).matching,1);
  assert.equal((await f.merchant(path+'?state=expired')).matching,1);
  const o=(await f.create(f.input({shipping:fixtureShipping}))).order,payment=await f.paid(o);assert.equal(payment.status,200,payment.error);
  const queue=await f.merchant(path+'?queue=needs-processing');assert.equal(queue.matching,1,JSON.stringify(queue));
  const current=await f.merchant('/v1/fulfillment/'+o.id);
  assert.equal((await f.merchant('/v1/fulfillment/'+o.id,{kind:'accept',revision:current.order.revision,requestKey:'a'.repeat(32)},{method:'POST'})).status,200);
  assert.equal((await f.merchant(path+'?queue=processing')).matching,1);
  assert.equal((await f.merchant(path+'?queue=needs-processing')).matching,0);
});

test('aggregate rupiah totals stay exact beyond JavaScript safe integer range',async t=>{
  const f=await setupCommerceFixture(t),amount=Number.MAX_SAFE_INTEGER;
  // Two individually exact historical-sized rows exercise integer aggregation
  // without manufacturing millions of fixtures. Normal checkout caps are lower.
  for(let n=0;n<2;n++){
    const id='EZK-S-'+String(n+1).padStart(24,'A');
    await f.db.prepare(`INSERT INTO orders(id,seller_id,commerce_version,commerce_environment,checkout_state,subtotal_amount,total_amount,customer_snapshot_json,snapshot_json,created_at,updated_at)
      VALUES (?,'seller_alice',1,'sandbox','paid',?,?,'{}','{"fees":{"plan":"standard"},"shipping":{"skipped":true}}','2026-09-25T02:00:00.000Z','2026-09-25T02:00:00.000Z')`).bind(id,amount,amount).run();
    await f.db.prepare(`INSERT INTO commerce_payment_captures(id,seller_id,order_id,provider,commerce_environment,provider_reference,amount,currency,capture_kind,verified_at)
      VALUES (?,'seller_alice',?,'doku','sandbox',?,?,'IDR','order_payment','2026-09-25T02:00:00.000Z')`).bind('large_'+n,id,'large_reference_'+n,amount).run();
  }
  const result=await f.merchant(path);assert.equal(result.status,200,result.error);assert.equal(result.summary.confirmedAmount,(BigInt(amount)*2n).toString());
  assert.equal(result.summary.paid,2);assert.equal(result.summary.additionalAmount,'0');
});
