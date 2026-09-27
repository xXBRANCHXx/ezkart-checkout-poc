import test from 'node:test';
import assert from 'node:assert/strict';
import {setupEarningsFixture,earningsPath} from './earnings-fixture.mjs';
import {randomBytes} from 'node:crypto';
import {digitalFixtureFile} from './digital-commerce-fixture.mjs';
import {digitalDownloadProof} from '../src/commerce-digital.js';
import {digitalPartBytes} from '../src/digital-files.js';
import {applyCommerceSchema} from './commerce-schema.mjs';
import {fixtureShipping} from './commerce-fixture.mjs';
import {earningsHousekeeping} from '../src/commerce-earnings.js';
const key=()=>randomBytes(16).toString('hex');

test('settlement and actual delivery in either order release only original net seller earnings once',async t=>{
  for(const deliveryFirst of [true,false]){
    const f=await setupEarningsFixture(t),p=await f.payment(),net=p.order.total-p.route.binding.platformAmount-2500;
    assert.equal((await f.position(p)).state,'pending');
    if(deliveryFirst)await f.deliver(p);else await f.settle(p);
    assert.equal((await f.position(p)).availableEarnings,'0');
    if(deliveryFirst)await f.settle(p);else await f.deliver(p);
    const position=await f.position(p);assert.equal(position.status,200,position.error);assert.equal(position.state,'available');assert.equal(position.availableEarnings,String(net));assert.equal(position.reconciled,true);assert.deepEqual(position.holds,[]);
    const summary=await f.summary();assert.equal(summary.accounts.seller_available,String(-net));assert.equal(summary.accounts.seller_pending,'0');assert.equal(summary.accounts.shipping_reserve,'-18000');assert.equal(summary.balanced,true);
    const before=(await f.journals()).items;assert.equal(before.filter(j=>j.kind==='earnings').length,1);
    const replay=await f.catchUp();assert.equal(replay.recorded,0);assert.deepEqual((await f.journals()).items,before);
    assert.equal((await f.earnings()).availableEarnings,String(net));assert.equal(position.availableToWithdraw,null);
  }
});

test('whole digital delivery is required alongside settled funds and a physical line in a mixed order',async t=>{
  const f=await setupEarningsFixture(t),file=await digitalFixtureFile(f,{bytes:randomBytes(digitalPartBytes+3)});
  const p=await f.payment({items:[{productId:'tea',quantity:1,expectedPrice:20000,expectedWeightGrams:100},file.item]});
  await f.settle(p);await f.deliver(p);assert.equal((await f.position(p)).availableEarnings,'0');
  const item=p.order.items.find(i=>i.productId===file.id),url='/v1/customer/orders/'+p.order.id+'/downloads/'+item.id+'/grants';
  const made=await f.merchant(url,{requestKey:key()},{seller:'earnings-buyer',method:'POST'});assert.equal(made.status,200,made.error);const prefix=url+'/'+made.grant.id;
  for(let part=1;part<=2;part++){
    const response=await f.mf.dispatchFetch('https://api.fixture.test'+prefix+'/parts/'+part,{headers:{authorization:'Bearer '+await f.merchantToken('earnings-buyer')}});assert.equal(response.status,200);
    const proof=await digitalDownloadProof(made.grant.id,part,response.headers.get('x-ezkart-file-challenge'),new Uint8Array(await response.arrayBuffer()));
    const receipt=await f.merchant(prefix+'/parts/'+part+'/receipt',{proof},{seller:'earnings-buyer',method:'POST'});assert.equal(receipt.status,200,receipt.error);
    assert.equal((await f.position(p)).state,part===1?'pending':'available');
  }
  assert.equal((await f.journals()).items.filter(x=>x.kind==='earnings').length,1);
});

test('physical return intake holds earnings independently of historical delivery and closing intake does not release money',async t=>{
  const f=await setupEarningsFixture(t),p=await f.payment();await f.settle(p);await f.deliver(p);const original=await f.position(p);
  const base='/v1/returns/orders/'+p.order.id,d=await f.merchant(base);
  const opened=await f.merchant(base,{requestKey:key(),orderRevision:d.order.revision,reason:'damaged',note:'Inspect the original items.',items:[{orderItemId:p.order.items[0].id,quantity:1}]},{method:'POST'});assert.equal(opened.status,200,opened.error);
  assert.equal((await f.position(p)).state,'reserved');
  const path='/v1/returns/'+opened.id;
  for(const kind of ['approve','close']){const detail=await f.merchant(path),r=await f.merchant(path,{requestKey:key(),revision:detail.revision,orderRevision:detail.order.revision,kind,message:'Physical intake was reviewed.'},{method:'POST'});assert.equal(r.status,200,r.error);}
  const held=await f.position(p);assert.equal(held.state,'reserved');assert.equal(held.reservedEarnings,original.availableEarnings);assert(held.holds.includes('return_requires_reconciliation'));
  assert.equal((await f.summary()).balanced,true);
});

test('payment review, uncertain provider jobs and additional captures reserve existing earnings immediately',async t=>{
  const f=await setupEarningsFixture(t),p=await f.payment();await f.settle(p);await f.deliver(p);const original=await f.position(p);
  await f.db.prepare('UPDATE orders SET payment_review=1 WHERE id=?').bind(p.order.id).run();assert.equal((await f.position(p)).state,'reserved');
  await f.db.prepare('UPDATE orders SET payment_review=0 WHERE id=?').bind(p.order.id).run();assert.equal((await f.position(p)).availableEarnings,original.availableEarnings);
  const job=await f.db.prepare("SELECT id,state FROM commerce_jobs WHERE order_id=? AND kind='shipment.create'").bind(p.order.id).first();assert(job);
  await f.db.prepare("UPDATE commerce_jobs SET state='uncertain' WHERE id=?").bind(job.id).run();assert((await f.position(p)).holds.includes('provider_job_unresolved'));
  await f.db.prepare('UPDATE commerce_jobs SET state=? WHERE id=?').bind(job.state,job.id).run();assert.equal((await f.position(p)).availableEarnings,original.availableEarnings);
  const body=JSON.parse(p.receipt.body);body.paymentRequestId='PJP-additional-earnings';
  const additional=await f.call('/internal/commerce/snap-payments/'+p.order.id+'/receipt',{...p.receipt,externalId:'998811',body:JSON.stringify(body)});assert.equal(additional.status,200,additional.error);
  const held=await f.position(p);assert.equal(held.availableEarnings,'0');assert.equal(held.reservedEarnings,original.availableEarnings);assert(held.holds.includes('payment_review'));
  assert.equal((await f.summary()).accounts.unallocated_receipts,String(-p.order.total));assert.equal((await f.summary()).balanced,true);
});

test('zero earnings and maximum orders remain exact under their original fee policy after a plan change',async t=>{
  const f=await setupEarningsFixture(t),p=await f.payment();await f.db.prepare("UPDATE sellers SET plan='advanced' WHERE id='seller_alice'").run();await f.deliver(p);
  await f.settle(p,{fee:p.order.total-p.route.binding.platformAmount});let position=await f.position(p);assert.equal(position.state,'available');assert.equal(position.availableEarnings,'0');assert.equal(position.netAmount,'0');
  assert.equal(position.source.originalSellerAmount,'36750');assert.equal((await f.journals()).items.filter(j=>j.kind==='earnings').length,0);
  await f.product('large-earnings',100,'seller_alice',1000000000);
  const large=await f.payment({items:[{productId:'large-earnings',quantity:100,expectedPrice:1000000000,expectedWeightGrams:100}],shipping:{...fixtureShipping,amount:0,quote:{...fixtureShipping.quote,price:0}}});
  await f.deliver(large);await f.settle(large,{fee:10001});position=await f.position(large);assert.equal(position.netAmount,'93999988749');assert.equal(position.availableEarnings,'93999988749');
  assert.equal((await f.summary()).balanced,true);
});

test('upgrade preserves historical records and bounded catch-up releases original completed evidence exactly once',async t=>{
  const f=await setupEarningsFixture(t,{through:53}),p=await f.payment();await f.deliver(p);const pair=await f.collect(p,f.legs(p));
  await f.db.prepare(`INSERT INTO commerce_settlement_assessments(id,version,seller_id,order_id,capture_id,commerce_environment,seller_collection_sequence,platform_collection_sequence,previous_id,recorded_at)
    SELECT ?,1,c.seller_id,c.order_id,c.id,c.commerce_environment,sc.sequence,pc.sequence,NULL,? FROM commerce_payment_captures c
      JOIN commerce_provider_financial_collections sc ON sc.id=? JOIN commerce_provider_financial_collections pc ON pc.id=? WHERE c.order_id=? AND c.capture_kind='order_payment'`)
    .bind('stlm_'+randomBytes(20).toString('hex'),new Date().toISOString(),pair.sellerCollectionId,pair.platformCollectionId,p.order.id).run();
  const tables=['orders','commerce_payment_captures','commerce_settlement_assessments','commerce_settlement_results','commerce_order_delivery_receipts','commerce_financial_journals','commerce_financial_entries'];
  const before=await Promise.all(tables.map(table=>f.db.prepare('SELECT * FROM '+table).all()));
  await applyCommerceSchema(f.db,53);
  for(const [i,table] of tables.entries())assert.deepEqual((await f.db.prepare('SELECT * FROM '+table).all()).results,before[i].results);
  let position=await f.position(p);assert.equal(position.reconciled,false);assert.equal(position.availableEarnings,'0');assert.equal(position.pendingEarnings,'34250');
  const attempts=await Promise.all([f.catchUp(),f.catchUp()]);assert.equal(attempts.reduce((total,r)=>total+r.recorded,0),1);
  position=await f.position(p);assert.equal(position.availableEarnings,'34250');assert.equal(position.reconciled,true);
  assert.deepEqual((await f.db.prepare('PRAGMA foreign_key_check').all()).results,[]);
});

test('bounded reconciliation and housekeeping finish shared-wallet holds without provider calls or main execution',async t=>{
  const f=await setupEarningsFixture(t,{bindings:{APP_ENVIRONMENT:'beta'}}),payments=[];
  for(let i=0;i<3;i++)payments.push(await f.payment());
  const rows={sellerCash:[],sellerPending:[],platformCash:[],platformPending:[]};
  for(const p of payments){const legs=f.legs(p);for(const name of Object.keys(rows))rows[name].push(...legs[name]);}
  for(const entries of Object.values(rows))entries.sort((a,b)=>b.dateTime.localeCompare(a.dateTime));
  const pair=await f.collect(payments[0],rows);
  for(const p of payments){assert.equal((await f.reconcile(p,pair)).status,200);await f.deliver(p);}
  await f.history([],{fromDateTime:pair.from,toDateTime:pair.to},{requestedAt:new Date().toISOString(),observedAt:new Date().toISOString()});
  assert.equal((await f.earnings()).unreconciledOrders,3);
  const first=await f.catchUp({limit:2});assert.equal(first.recorded,2);assert.equal(first.remaining,1);assert.equal(first.caughtUp,false);
  const env={DB:f.db,APP_ENVIRONMENT:'beta',COMMERCE_STORAGE:'d1'};
  assert.deepEqual(await earningsHousekeeping({...env,APP_ENVIRONMENT:'production'}),{skipped:true});
  assert.deepEqual(await earningsHousekeeping({...env,COMMERCE_STORAGE:'held'}),{skipped:true});
  const swept=await earningsHousekeeping(env);assert.equal(swept.recorded,1);assert.equal(swept.remaining,0);
  assert.equal((await f.earnings()).availableEarnings,'0');assert.equal((await f.earnings()).unreconciledOrders,0);
  assert.equal((await earningsHousekeeping(env)).recorded,0);assert.equal((await f.summary()).balanced,true);
});

test('negative original allocations offset other available earnings without being clipped or charged twice',async t=>{
  const f=await setupEarningsFixture(t),p=await f.payment();await f.settle(p);await f.deliver(p);const earned=await f.earnings();
  await f.product('tiny',10,'seller_alice',1000);const small=await f.payment({items:[{productId:'tiny',quantity:1,expectedPrice:1000,expectedWeightGrams:100}]});
  const tiny=await f.position(small);assert.equal(tiny.netAmount,'-300');assert.equal(tiny.pendingEarnings,'-300');assert.equal(tiny.availableEarnings,'0');
  const summary=await f.earnings();assert.equal(summary.negativeAllocations,'300');assert.equal(summary.availableEarnings,String(BigInt(earned.availableEarnings)-300n));
  const accounts=(await f.summary()).accounts;assert.equal(accounts.seller_pending,'300');assert.equal(accounts.seller_available,String(-BigInt(earned.availableEarnings)));
  assert.equal((await f.catchUp()).recorded,0);assert.equal((await f.earnings()).negativeAllocations,'300');
});

test('history retains a fixed cohort and omits private provider sources while later adjustments are appended',async t=>{
  const f=await setupEarningsFixture(t),p=await f.payment();await f.settle(p);await f.deliver(p);
  for(let i=0;i<3;i++){const r=await f.refund(p);await f.refundAction(r.id,'decline');}
  const base=earningsPath+'/history?seller=seller_alice&environment=sandbox&limit=2',first=await f.call(base);assert.equal(first.status,200,first.error);assert.equal(first.items.length,2);assert(first.nextBefore);
  const newRequest=await f.refund(p);await f.refundAction(newRequest.id,'decline');
  const items=[...first.items];let before=first.nextBefore;
  while(before){const next=await f.call(base+'&cap='+first.cap+'&before='+before);assert.equal(next.status,200,next.error);items.push(...next.items);before=next.nextBefore;}
  assert.equal(items.length,7);assert.equal(new Set(items.map(i=>i.id)).size,7);assert(items.every(i=>i.sequence<=first.cap));
  assert(!/providerReference|fobs_|fcol_|SAC-|201000000|credentialFingerprint/.test(JSON.stringify(items)));
  assert.deepEqual((await f.call(base.replace('seller_alice','seller_bob'))).items,[]);
});

test('refund requests reserve released earnings atomically and only a valid decline or withdrawal restores them',async t=>{
  const f=await setupEarningsFixture(t),p=await f.payment();await f.settle(p);await f.deliver(p);
  const original=await f.position(p),request=await f.refund(p);
  let held=await f.position(p);assert.equal(held.state,'reserved');assert.equal(held.availableEarnings,'0');assert.equal(held.reservedEarnings,original.availableEarnings);assert(held.holds.includes('refund_requires_reconciliation'));
  assert.equal((await f.summary()).accounts.seller_available,'0');
  await f.refundAction(request.id,'decline');assert.equal((await f.position(p)).availableEarnings,original.availableEarnings);
  const second=await f.refund(p);await f.refundAction(second.id,'withdraw');assert.equal((await f.position(p)).availableEarnings,original.availableEarnings);
  const third=await f.refund(p);await f.refundAction(third.id,'approve');held=await f.position(p);assert.equal(held.availableEarnings,'0');assert.equal(held.state,'reserved');assert.equal(held.reconciled,true);
  const summary=await f.summary();assert.equal(summary.balanced,true);assert.equal(summary.accounts.seller_reserved,String(-Number(original.availableEarnings)));
  assert.equal(summary.accounts.platform_commission_pending,'-2000');assert.equal(summary.accounts.platform_admin_pending,'-1250');
});

test('new provider history immediately excludes stale availability and bounded reconciliation records the reserve once',async t=>{
  const f=await setupEarningsFixture(t),p=await f.payment();const first=await f.settle(p);await f.deliver(p);
  const original=await f.position(p);
  const next=await f.collect(p,f.legs(p));
  let position=await f.position(p);assert.equal(position.reconciled,false);assert.equal(position.availableEarnings,'0');assert.equal(position.recordedAvailable,original.availableEarnings);
  assert(position.holds.includes('provider_history_changed'));assert.equal((await f.earnings()).availableEarnings,'0');
  const attempts=await Promise.all([f.catchUp(),f.catchUp()]);assert.equal(attempts.reduce((n,x)=>n+x.recorded,0),1);
  position=await f.position(p);assert.equal(position.reconciled,true);assert.equal(position.state,'reserved');assert.equal(position.recordedAvailable,'0');
  await f.reconcile(p,first.pair);assert.equal((await f.position(p)).availableEarnings,'0');
  const restored=await f.reconcile(p,next);assert.equal(restored.status,200,restored.error);assert.equal((await f.position(p)).availableEarnings,original.availableEarnings);
  assert.equal((await f.summary()).balanced,true);
});

test('fee corrections and provider voids adjust released liabilities without rewriting earnings or charging platform fees twice',async t=>{
  const f=await setupEarningsFixture(t),p=await f.payment();await f.deliver(p);await f.settle(p);
  const original=await f.position(p),initial=(await f.journals()).items;
  await f.settle(p,{fee:3000});let position=await f.position(p);assert.equal(position.availableEarnings,String(Number(original.availableEarnings)-500));
  assert.equal((await f.summary()).accounts.seller_pending,'0');
  await f.settle(p,{fee:3000,status:'VOID'});position=await f.position(p);assert.equal(position.state,'pending');assert.equal(position.availableEarnings,'0');assert.equal(position.reservedEarnings,'0');
  let summary=await f.summary();assert.equal(summary.accounts.seller_available,'0');assert.equal(summary.accounts.seller_pending,'-36750');assert.equal(summary.accounts.provider_cash_seller,'0');
  await f.settle(p,{fee:2000});position=await f.position(p);assert.equal(position.availableEarnings,String(Number(original.availableEarnings)+500));
  summary=await f.summary();assert.equal(summary.accounts.seller_pending,'0');assert.equal(summary.accounts.platform_admin_pending,'-1250');assert.equal(summary.accounts.platform_commission_pending,'-2000');assert.equal(summary.balanced,true);
  const later=(await f.journals()).items;for(const journal of initial)assert.deepEqual(later.find(x=>x.id===journal.id),journal);
});

test('an earnings posting failure rolls delivery and its source receipt back for the original retry',async t=>{
  const f=await setupEarningsFixture(t),p=await f.payment();await f.settle(p);const shipment=await f.pickup(p);
  const original=(await f.journals()).items;
  await f.db.prepare("CREATE TRIGGER fixture_fail_earnings BEFORE INSERT ON commerce_financial_entries WHEN NEW.account='seller_available' BEGIN SELECT RAISE(ABORT,'fixture_earnings_failure'); END").run();
  const failed=await f.bind(shipment);assert.equal(failed.status,500);
  assert.equal((await f.db.prepare('SELECT COUNT(*) AS n FROM commerce_order_delivery_receipts').first()).n,0);
  assert.deepEqual((await f.journals()).items,original);assert.equal((await f.position(p)).availableEarnings,'0');
  await f.db.prepare('DROP TRIGGER fixture_fail_earnings').run();const retry=await f.bind(shipment);assert.equal(retry.status,200,retry.error);
  assert.equal((await f.position(p)).state,'available');assert.equal((await f.journals()).items.filter(x=>x.kind==='earnings').length,1);
});

test('a failed reserve posting cannot commit a refund request beside spendable earnings',async t=>{
  const f=await setupEarningsFixture(t),p=await f.payment();await f.settle(p);await f.deliver(p);
  const original=await f.position(p),path='/v1/commerce/refunds/orders/'+p.order.id,detail=await f.merchant(path);
  const input={requestKey:key(),orderRevision:detail.order.revision,reason:'damaged',note:'Review this original purchase.',items:[{orderItemId:p.order.items[0].id,amount:1000}],shippingAmount:0};
  await f.db.prepare("CREATE TRIGGER fixture_fail_reserve BEFORE INSERT ON commerce_financial_entries WHEN NEW.account='seller_reserved' BEGIN SELECT RAISE(ABORT,'fixture_reserve_failure'); END").run();
  const failed=await f.merchant(path,input,{method:'POST'});assert.equal(failed.status,500);
  assert.equal((await f.db.prepare('SELECT COUNT(*) AS n FROM commerce_refunds').first()).n,0);assert.equal((await f.db.prepare('SELECT COUNT(*) AS n FROM commerce_refund_items').first()).n,0);
  assert.equal((await f.position(p)).availableEarnings,original.availableEarnings);
  await f.db.prepare('DROP TRIGGER fixture_fail_reserve').run();const retried=await f.merchant(path,input,{method:'POST'});assert.equal(retried.status,200,retried.error);
  assert.equal((await f.position(p)).availableEarnings,'0');assert.equal((await f.position(p)).reservedEarnings,original.availableEarnings);
  const entries=(await f.journals()).items;const replay=await f.merchant(path,input,{method:'POST'});assert.equal(replay.status,200,replay.error);assert.deepEqual((await f.journals()).items,entries);
});

test('earnings service scope, strict requests and immutable source guards prevent amount or eligibility overrides',async t=>{
  const f=await setupEarningsFixture(t),p=await f.payment();await f.settle(p);await f.deliver(p);
  const path=earningsPath+'?seller=seller_alice&environment=sandbox&orderId='+p.order.id;
  assert.equal((await f.merchant(path)).status,401);assert.equal((await f.call(path.replace('seller_alice','seller_bob'))).status,404);
  assert.equal((await f.call(path.replace('sandbox','production'))).status,403);
  for(const suffix of ['&seller=seller_bob','&amount=100000','&available=true'])assert.equal((await f.call(path+suffix)).status,422);
  for(const extra of [{amount:100000},{available:true},{limit:101},{orderId:'foreign'},{seller:'bad\n'}])assert.equal((await f.catchUp(extra)).status,422);
  for(const sql of ['DELETE FROM commerce_earnings_assessments',"UPDATE commerce_earnings_assessments SET available_amount=0",'INSERT OR REPLACE INTO commerce_earnings_assessments SELECT * FROM commerce_earnings_assessments LIMIT 1'])await assert.rejects(f.db.prepare(sql).run(),/earnings_immutable/);
  await assert.rejects(f.db.prepare(`INSERT INTO commerce_earnings_assessments(id,version,seller_id,order_id,capture_id,commerce_environment,previous_id,state,net_amount,available_amount,reserved_amount,source_json,recorded_at)
    SELECT 'earn_'||lower(hex(randomblob(20))),1,seller_id,order_id,capture_id,commerce_environment,assessment_id,'available',net_amount,net_amount,0,source_json,strftime('%Y-%m-%dT%H:%M:%fZ','now') FROM commerce_earnings_positions`).run(),/earnings_source_mismatch/);
  assert.equal((await f.summary()).balanced,true);
});
