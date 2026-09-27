import test from 'node:test';
import assert from 'node:assert/strict';
import {setupSettlementFixture,settlementPath} from './settlement-fixture.mjs';
import {applyCommerceSchema} from './commerce-schema.mjs';
import {fixtureShipping} from './commerce-fixture.mjs';

const accountBalances=async f=>(await f.summary()).accounts;
const balanced=j=>assert.equal(j.entries.reduce((sum,line)=>sum+BigInt(line.amount),0n),0n);

test('original routed payment, fee and both cash credits post exact balanced settlement without releasing earnings',async t=>{
  const f=await setupSettlementFixture(t),p=await f.payment(),pair=await f.collect(p,f.legs(p));
  const before=await accountBalances(f),result=await f.reconcile(p,pair);assert.equal(result.status,200,result.error);
  assert.equal(result.assessment.state,'settled');assert.equal(result.settlementVerified,true);assert.equal(result.assessment.feeAmount,'2500');assert.equal(result.availableToWithdraw,null);assert.equal(result.earningsReleased,false);
  const entries=await accountBalances(f);assert.equal(entries.provider_receivable,'0');assert.equal(entries.provider_cash_seller,String(p.order.total-2500-p.route.binding.platformAmount));assert.equal(entries.provider_cash_platform,String(p.route.binding.platformAmount));
  assert.equal(BigInt(entries.seller_pending),BigInt(before.seller_pending)+2500n);assert.equal(entries.platform_commission_pending,before.platform_commission_pending);assert.equal(entries.platform_admin_pending,before.platform_admin_pending);
  const list=await f.journals();assert.equal(list.items.length,2);list.items.forEach(balanced);assert.equal(list.items[0].kind,'settlement');
  const again=await f.reconcile(p,pair);assert.equal(again.replayed,true);assert.deepEqual(await accountBalances(f),entries);assert.equal((await f.journals()).items.length,2);
  assert.equal((await f.summary()).settlementConnected,true);assert.equal((await f.summary()).settlementAccounting.settled,1);
  const delivery=await f.call('/internal/commerce/finance/delivery?seller=seller_alice&environment=sandbox&orderId='+p.order.id);
  assert.equal(delivery.settlementVerified,true);assert.equal(delivery.deliveryConfirmed,false);assert.equal(delivery.releaseReady,false);
});

test('new fee evidence posts only the correction and voids reverse actual recognition without rewriting captures',async t=>{
  const f=await setupSettlementFixture(t),p=await f.payment();
  const a=await f.reconcile(p,await f.collect(p,f.legs(p,{fee:2500})));assert.equal(a.status,200,a.error);
  const b=await f.reconcile(p,await f.collect(p,f.legs(p,{fee:3000})));assert.equal(b.status,200,b.error);assert.equal(b.assessment.state,'settled');
  let list=await f.journals();assert.equal(list.items.length,3);assert.equal(list.items[0].kind,'settlement_correction');assert.deepEqual(list.items[0].entries,[{account:'provider_cash_seller',amount:'-500'},{account:'seller_pending',amount:'500'}]);
  const c=await f.reconcile(p,await f.collect(p,f.legs(p,{fee:3000,status:'VOID'})));assert.equal(c.status,200,c.error);assert.equal(c.assessment.state,'voided');assert.equal(c.settlementVerified,false);
  const balances=await accountBalances(f);assert.equal(balances.provider_receivable,String(p.order.total));assert.equal(balances.provider_cash_seller,'0');assert.equal(balances.provider_cash_platform,'0');
  list=await f.journals();assert.equal(list.items[0].kind,'settlement_reversal');list.items.forEach(balanced);assert.equal(list.items.filter(j=>j.kind==='capture').length,1);
  const d=await f.reconcile(p,await f.collect(p,f.legs(p,{fee:3000})));assert.equal(d.status,200,d.error);assert.equal(d.settlementVerified,true);assert.equal((await f.journals()).items[0].kind,'settlement_correction');
});

test('missing fees and mixed statuses retain the last recognized money with an explicit hold',async t=>{
  const f=await setupSettlementFixture(t),p=await f.payment();
  const a=await f.reconcile(p,await f.collect(p,f.legs(p)));assert.equal(a.status,200,a.error);const balances=await accountBalances(f);
  const rows=f.legs(p);rows.sellerPending=rows.sellerPending.filter(x=>x.transactionType!=='SETTLEMENT_FEE');
  const missing=await f.reconcile(p,await f.collect(p,rows));assert.equal(missing.status,200,missing.error);assert.equal(missing.assessment.state,'unresolved');assert.equal(missing.settlementVerified,false);assert.equal(missing.recognized.assessmentId,a.assessment.id);assert.deepEqual(await accountBalances(f),balances);
  const mixed=f.legs(p);mixed.platformCash[0].status='PENDING';
  const pending=await f.reconcile(p,await f.collect(p,mixed));assert.equal(pending.status,200,pending.error);assert.equal(pending.assessment.reason,'provider_status_unresolved');assert.deepEqual(await accountBalances(f),balances);assert.equal((await f.journals()).items.length,2);
});

test('later partial history invalidates current verification and cannot be bypassed by replaying old collections',async t=>{
  const f=await setupSettlementFixture(t),p=await f.payment(),pair=await f.collect(p,f.legs(p));
  assert.equal((await f.reconcile(p,pair)).status,200);
  const at=new Date().toISOString();await f.history([],{fromDateTime:pair.from,toDateTime:pair.to},{requestedAt:at,observedAt:at});
  const read=await f.read(p);assert.equal(read.settlementVerified,false);assert(read.holds.includes('provider_history_changed'));assert.equal(read.recognized.state,'settled');
  const replay=await f.reconcile(p,pair);assert.equal(replay.status,200,replay.error);assert.equal(replay.replayed,true);assert.equal(replay.settlementVerified,false);assert.equal((await f.journals()).items.length,2);
  const next=await f.reconcile(p,await f.collect(p,f.legs(p)));assert.equal(next.status,200,next.error);assert.equal(next.settlementVerified,true);assert.equal(next.assessment.journalId,null);assert.equal((await f.journals()).items.length,2);
});

test('service and database bind settlement to its original store, environment, capture and account collections',async t=>{
  const f=await setupSettlementFixture(t),p=await f.payment(),pair=await f.collect(p,f.legs(p));
  const input={seller:'seller_alice',environment:f.environment,orderId:p.order.id,sellerCollectionId:pair.sellerCollectionId,platformCollectionId:pair.platformCollectionId};
  assert.equal((await f.merchant(settlementPath+'/reconcile',input,{method:'POST'})).status,401);
  for(const [change,status] of [[{seller:'seller_bob'},404],[{environment:'production'},403],[{actualFee:0},422],[{settled:true},422],
    [{sellerCollectionId:pair.platformCollectionId,platformCollectionId:pair.sellerCollectionId},409],
    [{sellerCollectionId:pair.platformCollectionId},409],[{platformCollectionId:'fcol_'+'f'.repeat(40)},409]])assert.equal((await f.reconcile(p,pair,change)).status,status);
  const target=settlementPath+'/reconcile',body=JSON.stringify(input).replace('"seller":','"seller":"seller_bob","seller":');
  assert.equal((await f.mf.dispatchFetch('https://api.fixture.test'+target,{method:'POST',headers:f.headers(target,'POST',body),body})).status,422);
  assert.equal((await f.call(settlementPath+'?seller=seller_alice&environment=sandbox&orderId='+p.order.id+'&actualFee=0')).status,422);
  assert.equal((await f.journals()).items.length,1);
  assert.equal((await f.db.prepare('SELECT COUNT(*) AS n FROM commerce_settlement_assessments').first()).n,0);
});

test('duplicate, foreign, unsupported and inexactly allocated provider legs remain unresolved without money changes',async t=>{
  const f=await setupSettlementFixture(t),p=await f.payment(),before=await accountBalances(f);
  const cases=[
    [r=>r.sellerPending.push({...r.sellerPending[1]}),'incomplete_or_duplicate_legs'],
    [r=>r.sellerPending.push({...r.sellerPending[0],referenceNo:'second-group'}),'payment_group_ambiguous'],
    [r=>{r.sellerPending[1].partnerReferenceNo='somebody-else';},'provider_reference_mismatch'],
    [r=>{r.platformCash[0].amount=String(Number(r.platformCash[0].amount)+1);},'allocation_mismatch'],
    [r=>{r.sellerCash[0].mutationType='DEBIT';},'unsupported_provider_rows'],
    [r=>r.sellerCash.push({...r.sellerCash[0],transactionType:'REFUND_PAYMENT'}),'unsupported_provider_rows'],
    [r=>{r.sellerPending[1].amount='9007199254740993';},'provider_amount_mismatch'],
    [r=>{r.sellerPending[2].amount='1';},'pending_outflow_mismatch'],
    [r=>r.platformCash.push({...r.platformCash[0]}),'incomplete_or_duplicate_legs'],
  ];
  for(const [change,reason] of cases){
    const rows=f.legs(p);change(rows);const result=await f.reconcile(p,await f.collect(p,rows));assert.equal(result.status,200,result.error);
    assert.equal(result.assessment.state,'unresolved');assert.equal(result.assessment.reason,reason);assert.equal(result.settlementVerified,false);
    if(rows.sellerPending[1]?.amount==='9007199254740993')assert.equal(result.assessment.source.observedFee,'9007199254740993');
    assert.deepEqual(await accountBalances(f),before);
  }
  assert.equal((await f.journals()).items.length,1);assert.equal((await f.db.prepare('SELECT COUNT(*) AS n FROM commerce_settlement_group_bindings').first()).n,0);
});

test('explicit zero fees, zero net and identical genuine pending debit legs conserve the original allocation',async t=>{
  const f=await setupSettlementFixture(t),p=await f.payment();
  const free=await f.reconcile(p,await f.collect(p,f.legs(p,{fee:0,pendingOutflows:false})));assert.equal(free.status,200,free.error);assert.equal(free.settlementVerified,true);assert.equal(free.assessment.feeAmount,'0');
  const zero=await f.reconcile(p,await f.collect(p,f.legs(p,{fee:p.order.total-p.route.binding.platformAmount})));assert.equal(zero.status,200,zero.error);assert.equal(zero.settlementVerified,true);assert.equal(zero.assessment.sellerCashAmount,'0');
  const equalFee=p.order.total-2*p.route.binding.platformAmount,rows=f.legs(p,{fee:equalFee});assert.deepEqual(rows.sellerPending[2],rows.sellerPending[3]);
  const equal=await f.reconcile(p,await f.collect(p,rows));assert.equal(equal.status,200,equal.error);assert.equal(equal.settlementVerified,true);assert.equal(equal.assessment.sellerCashAmount,equal.assessment.platformCashAmount);
  (await f.journals()).items.forEach(balanced);
  await f.product('tiny',10,'seller_alice',1000);const small=await f.payment({items:[{productId:'tiny',quantity:1,expectedPrice:1000,expectedWeightGrams:100}]});
  const before=await accountBalances(f),negative=await f.reconcile(small,await f.collect(small,f.legs(small,{fee:0})));
  assert.equal(negative.status,200,negative.error);assert.equal(negative.assessment.state,'unresolved');assert.deepEqual(await accountBalances(f),before);
  const capture=(await f.journals()).items.find(j=>j.captureId===negative.captureId&&j.kind==='capture');assert.equal(capture.entries.find(e=>e.account==='seller_pending').amount,'300');
});

test('concurrent reconciliation posts once and ledger failure rolls back assessment, result and group claim together',async t=>{
  const f=await setupSettlementFixture(t),p=await f.payment(),pair=await f.collect(p,f.legs(p));
  await f.db.prepare("CREATE TRIGGER fail_settlement_entry BEFORE INSERT ON commerce_financial_entries WHEN NEW.account='provider_cash_seller' BEGIN SELECT RAISE(ABORT,'fixture_settlement_failure'); END").run();
  assert.equal((await f.reconcile(p,pair)).status,500);
  for(const table of ['commerce_settlement_assessments','commerce_settlement_results','commerce_settlement_group_bindings'])assert.equal((await f.db.prepare('SELECT COUNT(*) AS n FROM '+table).first()).n,0);
  assert.equal((await f.journals()).items.length,1);
  await f.db.prepare('DROP TRIGGER fail_settlement_entry').run();
  const results=await Promise.all([f.reconcile(p,pair),f.reconcile(p,pair)]);assert(results.every(r=>r.status===200),JSON.stringify(results));assert.equal(results.filter(r=>r.replayed).length,1);
  assert.equal((await f.journals()).items.length,2);assert.equal(results[0].recorded.id,results[1].recorded.id);
  for(const table of ['commerce_settlement_assessments','commerce_settlement_results','commerce_settlement_group_bindings']){
    await assert.rejects(f.db.prepare('DELETE FROM '+table).run(),/settlement_immutable/);
    await assert.rejects(f.db.prepare('INSERT OR REPLACE INTO '+table+' SELECT * FROM '+table).run(),/settlement_immutable/);
  }
  await assert.rejects(f.db.prepare("UPDATE commerce_settlement_results SET fee_amount=1").run(),/settlement_immutable/);
  await assert.rejects(f.db.prepare("UPDATE commerce_settlement_assessments SET recorded_at='changed'").run(),/settlement_immutable/);
  await assert.rejects(f.db.prepare("UPDATE commerce_settlement_group_bindings SET provider_reference='changed'").run(),/settlement_immutable/);
  await assert.rejects(f.db.prepare("INSERT INTO commerce_financial_journals(id,seller_id,order_id,capture_id,commerce_environment,currency,kind,allocation_state,source_json,lines_json,occurred_at,posted_at) SELECT 'invented',seller_id,order_id,capture_id,commerce_environment,currency,kind,allocation_state,source_json,lines_json,occurred_at,posted_at FROM commerce_financial_journals WHERE kind='settlement'").run(),/financial_source_mismatch/);
});

test('a newer unfinished collection before initial reconciliation cannot create settlement or claim the group',async t=>{
  const f=await setupSettlementFixture(t),p=await f.payment(),pair=await f.collect(p,f.legs(p));
  const at=new Date().toISOString();await f.history([],{fromDateTime:pair.from,toDateTime:pair.to},{requestedAt:at,observedAt:at});
  const result=await f.reconcile(p,pair);assert.equal(result.status,409,result.error);assert.equal((await f.journals()).items.length,1);
  assert.equal((await f.db.prepare('SELECT COUNT(*) AS n FROM commerce_settlement_group_bindings').first()).n,0);
  assert.equal((await f.db.prepare('SELECT COUNT(*) AS n FROM commerce_settlement_assessments').first()).n,0);
});

test('later corrections outside the original history window suspend verification while unrelated reads do not',async t=>{
  const f=await setupSettlementFixture(t),p=await f.payment(),pair=await f.collect(p,f.legs(p));
  assert.equal((await f.reconcile(p,pair)).status,200);
  const from=new Date(Date.parse(pair.to)+1).toISOString(),to=new Date().toISOString(),at=new Date().toISOString();
  await f.history([],{fromDateTime:from,toDateTime:to},{requestedAt:at,observedAt:at});assert.equal((await f.read(p)).settlementVerified,true);
  const rows=f.legs(p,{status:'VOID'}).sellerCash.map(row=>({...row,dateTime:from})),stamp=new Date().toISOString();
  await f.history(rows,{fromDateTime:from,toDateTime:to},{requestedAt:stamp,observedAt:stamp});
  assert.equal((await f.read(p)).settlementVerified,false);assert.equal((await f.journals()).items.length,2);
});

test('a provider group cannot be claimed by a second capture or replaced on the original capture',async t=>{
  const f=await setupSettlementFixture(t),p=await f.payment();
  const first=await f.reconcile(p,await f.collect(p,f.legs(p,{reference:'provider-shared'})));assert.equal(first.status,200,first.error);
  const q=await f.payment(),pair=await f.collect(q,f.legs(q,{reference:'provider-shared'}));
  assert.equal((await f.reconcile(q,pair)).status,409);assert.equal((await f.journals()).items.length,3);
  assert.equal((await f.reconcile(p,await f.collect(p,f.legs(p,{reference:'different-group'})))).status,409);
  assert.equal((await f.db.prepare('SELECT COUNT(*) AS n FROM commerce_settlement_group_bindings').first()).n,1);
});

test('populated beta migration preserves captures and originals, then reconciles the original provider collections',async t=>{
  const f=await setupSettlementFixture(t,{through:52,bindings:{APP_ENVIRONMENT:'beta'}}),p=await f.payment(),pair=await f.collect(p,f.legs(p));
  const tables=['orders','order_items','commerce_payment_captures','commerce_financial_journals','commerce_financial_entries','commerce_payment_route_bindings','commerce_payment_route_receipts','commerce_provider_financial_collections','commerce_provider_financial_observations'];
  const snapshots=await Promise.all(tables.map(name=>f.db.prepare('SELECT * FROM '+name).all()));
  await applyCommerceSchema(f.db,52,53);
  for(const [i,table] of tables.entries())assert.deepEqual((await f.db.prepare('SELECT * FROM '+table).all()).results,snapshots[i].results);
  // The current settlement read also reports earnings from the current schema.
  await applyCommerceSchema(f.db,53);
  assert.equal((await f.journals()).items.length,1);const result=await f.reconcile(p,pair);assert.equal(result.status,200,result.error);assert.equal(result.settlementVerified,true);assert.equal(result.availableToWithdraw,null);
  assert.deepEqual((await f.db.prepare('PRAGMA foreign_key_check').all()).results,[]);
});

test('partial or differently scoped windows cannot be substituted for complete settlement sources',async t=>{
  const f=await setupSettlementFixture(t),p=await f.payment(),rows=f.legs(p);
  while(rows.sellerCash.length<20)rows.sellerCash.push({...rows.sellerCash[0],referenceNo:'unrelated-'+rows.sellerCash.length,partnerReferenceNo:null});
  const partial=await f.collect(p,rows,{maxPages:1});assert.equal(partial.collections[0].pagesExhausted,false);
  assert.equal((await f.reconcile(p,partial)).status,409);assert.equal((await f.journals()).items.length,1);
  const first=await f.collect(p,f.legs(p)),second=await f.collect(p,f.legs(p),{from:new Date(Date.parse(first.from)+1000).toISOString()});
  const pair={sellerCollectionId:first.sellerCollectionId,platformCollectionId:second.platformCollectionId};
  assert.equal((await f.reconcile(p,pair)).status,409);
  const capture=await f.db.prepare('SELECT id FROM commerce_payment_captures WHERE order_id=?').bind(p.order.id).first();
  await assert.rejects(f.db.prepare(`INSERT INTO commerce_settlement_assessments(id,version,seller_id,order_id,capture_id,commerce_environment,seller_collection_sequence,platform_collection_sequence,previous_id,recorded_at)
    SELECT ?,1,?,?,?,'sandbox',s.sequence,p.sequence,NULL,? FROM commerce_provider_financial_collections s,commerce_provider_financial_collections p WHERE s.id=? AND p.id=?`)
    .bind('stlm_'+'1'.repeat(40),'seller_alice',p.order.id,capture.id,new Date().toISOString(),pair.sellerCollectionId,pair.platformCollectionId).run(),/settlement_complete_window_required/);
  assert.equal((await f.db.prepare('SELECT COUNT(*) AS n FROM commerce_settlement_assessments').first()).n,0);
});

test('fee snapshots, shipping and the maximum order amount remain exact after merchant plan changes',async t=>{
  const f=await setupSettlementFixture(t),p=await f.payment({shipping:fixtureShipping});
  await f.db.prepare("UPDATE sellers SET plan='advanced' WHERE id='seller_alice'").run();
  const first=await f.reconcile(p,await f.collect(p,f.legs(p)));assert.equal(first.status,200,first.error);assert.equal(first.assessment.platformCashAmount,'21250');
  const balances=await accountBalances(f);assert.equal(balances.shipping_reserve,'-18000');assert.equal(balances.platform_commission_pending,'-2000');assert.equal(balances.platform_admin_pending,'-1250');
  await f.product('large-settlement',100,'seller_alice',1000000000);const large=await f.payment({items:[{productId:'large-settlement',quantity:100,expectedPrice:1000000000,expectedWeightGrams:100}]});
  const result=await f.reconcile(large,await f.collect(large,f.legs(large,{fee:10001})));assert.equal(result.status,200,result.error);assert.equal(result.settlementVerified,true);
  assert.equal(result.assessment.sellerCashAmount,'93999988749');assert.equal(result.assessment.platformCashAmount,'6000001250');assert.equal(result.assessment.source.grossAmount,'100000000000');
  (await f.journals()).items.forEach(balanced);
});

test('an additional captured payment blocks attribution and preserves the original settlement and separate suspense',async t=>{
  const f=await setupSettlementFixture(t),p=await f.payment(),pair=await f.collect(p,f.legs(p));assert.equal((await f.reconcile(p,pair)).status,200);
  const before=await accountBalances(f),body=JSON.parse(p.receipt.body);body.paymentRequestId='PJP-additional';
  const receipt=await f.call('/internal/commerce/snap-payments/'+p.order.id+'/receipt',{...p.receipt,externalId:'998877',body:JSON.stringify(body)});assert.equal(receipt.status,200,receipt.error);
  const state=await f.read(p);assert.equal(state.settlementVerified,false);assert(state.holds.includes('additional_payment_review'));assert.equal((await f.reconcile(p,pair)).status,409);
  const after=await accountBalances(f);assert.equal(after.seller_pending,before.seller_pending);assert.equal(after.provider_cash_seller,before.provider_cash_seller);assert.equal(after.unallocated_receipts,String(-p.order.total));
  assert.equal((await f.journals()).items.length,3);
});

test('maximum complete provider windows reconcile the original group without counting unrelated money', {timeout:30000},async t=>{
  const f=await setupSettlementFixture(t),p=await f.payment(),rows=f.legs(p),stamp=rows.sellerCash[0].dateTime;
  for(const [pocket,items] of Object.entries(rows))while(items.length<799)items.push({referenceNo:'unrelated-'+pocket+'-'+items.length,
    transactionType:'TOPUP',mutationType:'CREDIT',amount:'1',currency:'IDR',status:'SUCCESS',dateTime:stamp,channel:'SAC_TRANSFER'});
  const pair=await f.collect(p,rows);assert(pair.collections.every(c=>c.pagesExhausted&&c.observationIds.length===82));
  const result=await f.reconcile(p,pair);assert.equal(result.status,200,result.error);assert.equal(result.settlementVerified,true);
  assert.equal(result.assessment.source.legs.length,6);assert.equal(result.assessment.feeAmount,'2500');assert.equal((await f.journals()).items.length,2);
  const query=await f.db.prepare(`EXPLAIN QUERY PLAN SELECT sequence FROM commerce_provider_financial_observations INDEXED BY idx_provider_history_account
    WHERE enrollment_id=? AND operation='transaction-history-list' AND json_extract(normalized_json,'$.accountNo')=? AND sequence>?`)
    .bind(f.enrollments.alice,'2010000001',1).all();assert(query.results.some(row=>/SEARCH.*idx_provider_history_account/.test(row.detail)),JSON.stringify(query.results));
});
