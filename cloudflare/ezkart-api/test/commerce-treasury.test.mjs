import test from 'node:test';
import assert from 'node:assert/strict';
import {setupEarningsFixture,key} from './earnings-fixture.mjs';
import {setupCommerceFixture} from './commerce-fixture.mjs';
import {applyCommerceSchema} from './commerce-schema.mjs';
import {refundProcessingClaims as claims} from './refund-processing-fixture.mjs';
const bank={configurationId:'company-bank-v1',code:'CENAIDJA',accountNumber:'001234567890',channel:'BI_FAST',beneficiaryName:'Fixture Ezkart Company'};
const bindings={COMMERCE_TREASURY_OPERATORS:'bob',COMMERCE_TREASURY_BANK:JSON.stringify(bank)};
const base='/v1/treasury';
const ok=r=>{assert.equal(r.status,200,r.error);return r;};
async function setup(t,options={}){
  const f=await setupEarningsFixture(t,{...options,bindings:{...bindings,...options.bindings}});
  const permission=async(role='reviewer')=>ok(await f.call('/internal/commerce/support/access',{environment:f.environment,authUserId:'bob',role,requestKey:key(),operator:'Local fixture',reason:'Treasury authority test.'}));
  await permission();
  const api=(path,input,options={})=>f.merchant(base+path,input,{seller:'bob',claims:claims(),method:input===undefined?'GET':'POST',...options});
  const reserve=(input={})=>api('/intents',{requestKey:key(),amount:'1000',...input});
  return {...f,api,reserve,permission};
}
async function money(f){const p=await f.payment();await f.settle(p);return p;}
async function count(f,table){return (await f.db.prepare('SELECT COUNT(*) n FROM '+table).first()).n;}

test('settled commission alone is reservable; bank verification and execution stay unavailable',async t=>{
  const f=await setup(t),p=await money(f),result=ok(await f.api('/commissions'));
  assert.equal(result.funds.netCommission,'2000');assert.equal(result.funds.reservableCommission,'2000');
  assert(p.route.binding.platformAmount>2000);assert.equal(result.companyBank.verified,false);assert.equal(result.withdrawableCommission,null);
  assert.equal(result.executionAvailable,false);assert(!JSON.stringify(result).includes(bank.accountNumber));
  const before=await count(f,'commerce_financial_journals'),saved=ok(await f.reserve());
  assert.equal(saved.intent.amount,'1000');assert.equal(saved.intent.state,'reserved_pending_bank_verification');assert.equal(saved.intent.mayPay,false);
  assert.equal(saved.originalSources.captures[0].captureId,(await f.db.prepare('SELECT capture_id FROM commerce_treasury_commissions').first()).capture_id);
  assert.equal(saved.funds.reservableCommission,'1000');assert.equal(await count(f,'commerce_financial_journals'),before);assert.equal(await count(f,'commerce_withdrawals'),0);
  assert.deepEqual((await f.db.prepare('SELECT account,amount FROM commerce_treasury_entries ORDER BY account').all()).results,
    [{account:'commission_reserved',amount:1000},{account:'commission_unreserved',amount:-1000}]);
});
test('lost response lookup and concurrent replay retain one immutable intent and exact source',async t=>{
  const f=await setup(t);await money(f);const input={requestKey:key(),amount:'1500'};
  const responses=await Promise.all([f.reserve(input),f.reserve(input)]);responses.forEach(ok);
  assert.equal(responses.filter(r=>!r.replayed).length,1);assert.equal(await count(f,'commerce_treasury_intents'),1);assert.equal(await count(f,'commerce_treasury_entries'),2);
  const found=ok(await f.api('/intents/lookup',{requestKey:input.requestKey}));assert.equal(found.intent.id,responses[0].intent.id);
  assert.equal((await f.reserve({...input,amount:'1501'})).status,409);
  for(const sql of ["UPDATE commerce_treasury_intents SET amount=1","DELETE FROM commerce_treasury_intents","UPDATE commerce_treasury_entries SET amount=1"])
    await assert.rejects(f.db.prepare(sql).run(),/treasury_immutable/);
});
test('concurrent different reservations cannot overdraw the same commission',async t=>{
  const f=await setup(t);await money(f);const results=await Promise.all([f.reserve({amount:'1500'}),f.reserve({amount:'1500'})]);
  assert.deepEqual(results.map(x=>x.status).sort(),[200,409]);assert.equal(await count(f,'commerce_treasury_intents'),1);
  assert.equal(ok(await f.api('/commissions')).funds.reservableCommission,'500');
});
test('cancellation releases only the original reservation with balanced immutable entries',async t=>{
  const f=await setup(t);await money(f);const original=ok(await f.reserve()),body={requestKey:key()},path='/intents/'+original.intent.id+'/cancel';
  const cancel=ok(await f.api(path,body));assert.equal(cancel.intent.state,'cancelled');assert.equal(cancel.funds.reservableCommission,'2000');
  assert.equal(ok(await f.api(path,body)).replayed,true);assert.equal((await f.api(path,{requestKey:key()})).status,409);
  assert.equal((await f.db.prepare('SELECT SUM(amount) n FROM commerce_treasury_entries').first()).n,0);assert.equal(await count(f,'commerce_treasury_entries'),4);
});
test('pending, stale, corrected and voided settlements change availability without rewriting reservations',async t=>{
  const f=await setup(t),p=await f.payment();assert.equal(ok(await f.api('/commissions')).funds.reservableCommission,'0');
  assert.equal((await f.reserve()).status,409);const settled=await f.settle(p);const saved=ok(await f.reserve());
  const at=new Date().toISOString();await f.history([],{fromDateTime:settled.pair.from,toDateTime:settled.pair.to},{requestedAt:at,observedAt:at});
  let report=ok(await f.api('/commissions'));assert.equal(report.funds.reservableCommission,'0');assert.equal(report.funds.reservationShortfall,'1000');assert.equal((await f.reserve()).status,409);
  await f.settle(p,{fee:3000});report=ok(await f.api('/commissions'));assert.equal(report.funds.reservableCommission,'1000');
  await f.settle(p,{fee:3000,status:'VOID'});report=ok(await f.api('/commissions'));assert.equal(report.funds.eligibleCommission,'0');
  assert.equal(ok(await f.api('/intents/'+saved.intent.id)).intent.state,'reserved_pending_bank_verification');
});
test('open refunds freeze the company pool and never consume shipping/admin',async t=>{
  const f=await setup(t),p=await money(f);const saved=ok(await f.reserve());const refund=await f.refund(p,1000);
  let report=ok(await f.api('/commissions'));assert.equal(report.funds.refundHolds,1);assert.equal(report.funds.reservableCommission,'0');assert.equal((await f.reserve()).status,409);assert.equal(report.funds.reservedCommission,'1000');
  await f.refundAction(refund.id,'decline');report=ok(await f.api('/commissions'));assert.equal(report.funds.refundHolds,0);assert.equal(ok(await f.api('/intents/'+saved.intent.id)).intent.amount,'1000');
});
test('only configured operators with current reviewer permission and fresh TOTP can reserve',async t=>{
  const f=await setup(t);await money(f);
  assert.equal((await f.api('/commissions',undefined,{seller:'alice'})).status,403);assert.equal((await f.api('/commissions',undefined,{claims:{aal:'aal1'}})).status,401);
  assert.equal((await f.api('/commissions',undefined,{claims:claims(700)})).status,401);
  for(const role of ['viewer','revoked']){await f.permission(role);assert.equal((await f.reserve()).status,403);}
  assert.equal(await count(f,'commerce_treasury_intents'),0);assert.equal((await f.call(base+'/commissions')).status,401);
});
test('caller cannot supply company bank, source, verification, fees or environment',async t=>{
  const f=await setup(t);await money(f);
  for(const extra of [{bank},{verified:true},{seller:'seller_alice'},{environment:'production'},{platformEnrollmentId:'fake'},{fee:0}])assert.equal((await f.reserve(extra)).status,422);
  for(const amount of ['0','-1','1.0','1e3','9007199254740992',1000])assert.equal((await f.reserve({amount})).status,422);
  assert.equal((await f.api('/commissions?environment=production')).status,400);assert.equal((await f.api('/intents/try_'+'a'.repeat(40)+'/payment',{})).status,404);
});
test('missing company bank blocks creation without inventing verification',async t=>{
  const f=await setup(t,{bindings:{COMMERCE_TREASURY_BANK:''}});await money(f);
  assert.equal(ok(await f.api('/commissions')).companyBank,null);assert.equal((await f.reserve()).status,503);
});
test('schema upgrade preserves financial rows and starts without treasury activity',async t=>{
  const f=await setupCommerceFixture(t,{through:67});const before=(await f.db.prepare('SELECT * FROM commerce_financial_accounts ORDER BY code').all()).results;
  await applyCommerceSchema(f.db,67,70);assert.deepEqual((await f.db.prepare('SELECT * FROM commerce_financial_accounts ORDER BY code').all()).results,before);
  assert.equal(await count(f,'commerce_treasury_intents'),0);assert.equal(await count(f,'commerce_treasury_entries'),0);assert.deepEqual((await f.db.prepare('PRAGMA foreign_key_check').all()).results,[]);
});

test('two sellers contribute exact original commissions to one platform pool without seller or shipping reclassification',async t=>{
  const {seedRoutingWallets}=await import('./payment-routing-fixture.mjs');
  const f=await setup(t);
  await f.db.prepare("INSERT INTO sellers(id,slug,name,created_at,updated_at) VALUES('seller_charlie','charlie','charlie','now','now')").run();
  await f.db.prepare("INSERT INTO app_users(id,auth_user_id,created_at,updated_at) VALUES('charlie','charlie','now','now')").run();
  await f.db.prepare("INSERT INTO seller_memberships(seller_id,auth_user_id,role,created_at) VALUES('seller_charlie','charlie','owner','now')").run();
  await f.product('third',10,'seller_charlie',100000);
  await seedRoutingWallets(f,{wallets:[['charlie','3','BRN-fixture']]});
  const first=await f.payment(),second=await f.payment({sellerId:'seller_charlie',items:[{productId:'third',quantity:1,expectedPrice:100000,expectedWeightGrams:100}],shipping:{amount:0,skipped:true},checkout:{intentHash:'f'.repeat(64),paymentFlow:'snap_bca',shop:'charlie-shop'}});
  const a=f.legs(first),b=f.legs(second);a.platformCash.push(...b.platformCash);
  const pair=await f.collect(first,a),at=()=>new Date().toISOString();
  const record=(operation,request,response)=>f.record(operation,request,response,{seller:'seller_charlie',requestedAt:at(),observedAt:at()});
  const balance=()=>record('balance-inquiries',{profileId:'SAC-charlie'},{responseCode:'2000000',profileId:'SAC-charlie',accounts:[
    {type:'DOKU_MERCHANT_IDR',accountNo:'2010000003',currency:'IDR',balance:{available:'0',reserved:'0'}},
    {type:'DOKU_MERCHANT_PENDING_IDR',accountNo:'2030000003',currency:'IDR',balance:{available:'0',reserved:'0'}}]});
  const ids=[await balance()];
  for(const [accountNo,detailData] of [['2010000003',b.sellerCash],['2030000003',b.sellerPending]])ids.push(await record('transaction-history-list',
    {accountNo,fromDateTime:pair.from,toDateTime:pair.to,pageSize:'20',pageNumber:'0'},{responseCode:'2000000',detailData}));
  ids.push(await balance());
  const collection=ok(await f.call('/internal/commerce/finance/provider-collections',{seller:'seller_charlie',environment:f.environment,observationIds:ids})).collection;
  ok(await f.reconcile(first,pair));
  ok(await f.call('/internal/commerce/finance/settlement/reconcile',{seller:'seller_charlie',environment:f.environment,orderId:second.order.id,sellerCollectionId:collection.id,platformCollectionId:pair.platformCollectionId}));
  const report=ok(await f.api('/commissions'));assert.equal(report.funds.eligibleCommission,'7000');
  await f.db.prepare('UPDATE orders SET payment_review=1 WHERE id=?').bind(second.order.id).run();
  assert.equal(ok(await f.api('/commissions')).funds.eligibleCommission,'2000');
  assert.equal((await f.reserve({amount:'7000'})).status,409);
  await f.db.prepare('UPDATE orders SET payment_review=0 WHERE id=?').bind(second.order.id).run();
  const saved=ok(await f.reserve({amount:'7000'}));assert.equal(saved.originalSources.captures.length,2);
  assert.deepEqual(saved.originalSources.captures.map(c=>c.sellerId).sort(),['seller_alice','seller_charlie']);
  assert.equal(saved.funds.reservableCommission,'0');assert.equal(await count(f,'commerce_withdrawals'),0);
});

test('destination changes cannot retarget saved intent; revoked privilege prevents cancellation',async t=>{
  const {readTreasury}=await import('../src/commerce-treasury.js');
  const f=await setup(t);await money(f);const saved=ok(await f.reserve());
  const env={DB:f.db,APP_ENVIRONMENT:'test',COMMERCE_STORAGE:'d1',COMMERCE_PLATFORM_WALLET_SELLER:'seller_bob',...bindings,
    COMMERCE_TREASURY_BANK:JSON.stringify({...bank,configurationId:'company-bank-v2',accountNumber:'999999999999'})};
  const user={id:'bob',assurance:{...claims(),expiresAt:Math.floor(Date.now()/1000)+3600}};
  const detail=await readTreasury(env,user,saved.intent.id);assert.equal(detail.configurationChanged,true);
  assert.equal(detail.intent.companyBank.accountSuffix,'7890');assert.equal(detail.intent.destinationHash,saved.intent.destinationHash);
  await f.permission('revoked');assert.equal((await f.api('/intents/'+saved.intent.id+'/cancel',{requestKey:key()})).status,403);
  assert.equal(await count(f,'commerce_treasury_cancellations'),0);
});

test('entry failure rolls back intent and full reservation; original request can be retried locally',async t=>{
  const f=await setup(t);await money(f);const input={requestKey:key(),amount:'1000'};
  await f.db.prepare("CREATE TRIGGER fixture_treasury_failure BEFORE INSERT ON commerce_treasury_entries WHEN NEW.account='commission_reserved' BEGIN SELECT RAISE(ABORT,'fixture_failure'); END").run();
  assert.equal((await f.reserve(input)).status,500);assert.equal(await count(f,'commerce_treasury_intents'),0);assert.equal(await count(f,'commerce_treasury_entries'),0);
  await f.db.prepare('DROP TRIGGER fixture_treasury_failure').run();ok(await f.reserve(input));
});


test('balanced but misattributed financial entries cannot support a treasury reservation',async t=>{
  const f=await setup(t);await money(f);
  await f.db.prepare('DROP TRIGGER financial_entries_no_update').run(); // Isolated corruption fixture only.
  await f.db.prepare(`UPDATE commerce_financial_entries SET amount=amount+CASE account WHEN 'provider_cash_platform' THEN 1 WHEN 'provider_cash_seller' THEN -1 ELSE 0 END
    WHERE journal_sequence=(SELECT sequence FROM commerce_financial_journals WHERE kind='settlement')`).run();
  const result=ok(await f.api('/commissions'));assert.equal(result.funds.incompleteJournals,1);assert.equal(result.funds.reservableCommission,'0');
  assert.equal((await f.reserve()).status,409);
});

test('inactive configured platform cannot expose or reserve a company pool',async t=>{
  const f=await setup(t);await money(f);
  await f.db.prepare("UPDATE sellers SET status='suspended' WHERE id='seller_bob'").run();
  const result=ok(await f.api('/commissions'));assert.equal(result.platformConfigured,false);assert.equal(result.funds,null);
  assert.equal((await f.reserve()).status,409);
});

test('bounded source capacity is visible and cannot silently reserve an incomplete manifest',async t=>{
  const f=await setup(t);await money(f);
  // Isolated projection fixture exercises the 200 KB admission boundary without thousands of provider calls.
  {
    const row=await f.db.prepare("SELECT sql FROM sqlite_master WHERE name='commerce_treasury_fund_inputs'").first();
    await f.db.prepare('DROP VIEW commerce_treasury_fund_inputs').run();
    await f.db.prepare(row.sql.replace('CREATE VIEW commerce_treasury_fund_inputs','CREATE VIEW fixture_original_inputs')).run();
  }
  await f.db.prepare(`CREATE VIEW commerce_treasury_fund_inputs AS SELECT platform_enrollment_id,commerce_environment,net_commission,eligible_commission,
    reversed_commission,held_captures,unattributed_captures,refund_holds,reserved_commission,incomplete_journals,
    json_array(hex(zeroblob(100001))) AS captures_json FROM fixture_original_inputs`).run();
  const report=ok(await f.api('/commissions'));assert.equal(report.funds.sourceCapacityExceeded,1);assert.equal(report.funds.reservableCommission,'0');
  assert(report.blockers.includes('commission_source_capacity_exceeded'));assert.equal((await f.reserve()).status,409);
});
