import test from 'node:test';
import assert from 'node:assert/strict';
import {setupRefundProcessingFixture,refundProcessingKey as key,refundProcessingClaims as claims} from './refund-processing-fixture.mjs';
import {setupEarningsFixture} from './earnings-fixture.mjs';
import {digitalFixtureFile} from './digital-commerce-fixture.mjs';
import {finalizeConfirmedRefund} from '../src/commerce-refund-finalization.js';
import {buyerDigitalFile} from '../src/commerce-digital.js';
import {applyCommerceSchema} from './commerce-schema.mjs';
const path='/internal/commerce/finance/refunds/finalize';
const ok=r=>{assert.equal(r.status,200,r.error);return r;};
const count=async(f,table)=>(await f.db.prepare('SELECT COUNT(*) n FROM '+table).first()).n;
const input=(f,r,evidenceId)=>({environment:f.environment,seller:'seller_alice',refundId:r.id,evidenceId});
// Only the isolated test database gets a synthetic evidence producer. There is
// no production writer, service payload, secret, or enable flag for this view.
async function evidenceBoundary(f){
  await f.db.prepare(`CREATE TABLE fixture_refund_outcomes(evidence_id TEXT,provider_request_id TEXT,provider TEXT,commerce_environment TEXT,credential_fingerprint TEXT,brand_id TEXT,payment_reference TEXT,capture_id TEXT,bank_id TEXT,amount INTEGER,currency TEXT,outcome_reference TEXT,returned_at TEXT,refund_fee_amount INTEGER,evidence_hash TEXT)`).run();
  await f.db.prepare('DROP VIEW commerce_refund_verified_outcomes').run();
  await f.db.prepare('CREATE VIEW commerce_refund_verified_outcomes AS SELECT * FROM fixture_refund_outcomes').run();
}
async function evidence(f,r,changes={}){
  const q=await f.db.prepare('SELECT * FROM commerce_refund_provider_requests WHERE refund_id=?').bind(r.id).first(),s=JSON.parse(q.snapshot_json);
  const row={evidence_id:'fixture_'+key(),provider_request_id:q.id,provider:'doku',commerce_environment:f.environment,
    credential_fingerprint:s.credentialFingerprint,brand_id:s.brandId,payment_reference:s.paymentReference,capture_id:s.captureId,bank_id:s.bankId,
    amount:s.refundAmount,currency:'IDR',outcome_reference:'returned_'+key(),returned_at:new Date().toISOString(),refund_fee_amount:null,evidence_hash:'d'.repeat(64),...changes};
  await f.db.prepare('INSERT INTO fixture_refund_outcomes('+Object.keys(row).join(',')+') VALUES('+Object.keys(row).map(()=>'?').join(',')+')').bind(...Object.values(row)).run();return row;
}
async function setup(t){
  const f=await setupEarningsFixture(t);
  ok(await f.call('/internal/commerce/support/access',{environment:f.environment,authUserId:'bob',role:'reviewer',requestKey:key(),operator:'Local fixture',reason:'Test refund finalization.'}));
  await evidenceBoundary(f);return f;
}
async function prepare(f,p,items,shippingAmount=0){
  const url='/v1/commerce/refunds/orders/'+p.order.id,d=ok(await f.merchant(url));
  const r=ok(await f.merchant(url,{requestKey:key(),orderRevision:d.order.revision,reason:'other',note:'Return this original allocation.',items,shippingAmount},{method:'POST'})).refund;
  await f.refundAction(r.id,'approve');
  const buyer='/v1/customer/orders/'+p.order.id+'/refunds/'+r.id,support='/v1/support/refunds/'+r.id;
  ok(await f.merchant(buyer+'/bank',{previousId:null,bankName:'Fixture bank',accountName:'Original buyer',accountNumber:'1234567890',confirmed:true},{seller:'earnings-buyer',method:'POST'}));
  const current=ok(await f.merchant(support,undefined,{seller:'bob',claims:claims()})).refund;
  ok(await f.merchant(support+'/processing',{kind:'prepare_provider_request',requestKey:key(),bankId:current.processing.bank.id,refundRevision:current.revision,orderRevision:current.orderRevision,evidenceVersion:current.evidenceVersion},{seller:'bob',claims:claims(),method:'POST'}));
  return r;
}
const post=(f,r,e)=>f.call(path,input(f,r,e.evidence_id));
async function balanced(f){
  const rows=(await f.db.prepare('SELECT j.id,SUM(e.amount) balance FROM commerce_financial_journals j JOIN commerce_financial_entries e ON e.journal_sequence=j.sequence GROUP BY j.id').all()).results;
  assert(rows.length);for(const r of rows)assert.equal(r.balance,0,r.id);
  assert.deepEqual((await f.db.prepare('PRAGMA foreign_key_check').all()).results,[]);
}

test('closed evidence boundary rejects HMAC numbers, support submission, and direct posting',async t=>{
  const f=await setupRefundProcessingFixture(t);ok(await f.bank());const q=ok(await f.prepare()).refund.processing.request;
  ok(await f.processing({kind:'record_provider_submission',requestKey:key(),providerRequestId:q.id,channel:'support_ticket',reference:'DOKU-FIXTURE-SUBMITTED',submittedAt:new Date().toISOString(),confirmed:true}));
  const before=await count(f,'commerce_financial_entries'),body=input(f,f.refund,'support-ticket-is-not-proof');
  assert.equal((await f.call(path,body)).status,409);
  assert.equal((await f.call(path,{...body,amount:10000,verified:true})).status,422);
  assert.equal((await f.merchant(path,body,{method:'POST'})).status,401);
  await assert.rejects(f.db.prepare("INSERT INTO commerce_refund_verified_outcomes(evidence_id) VALUES('forged')").run(),/view/);
  assert.equal(await count(f,'commerce_refund_finalizations'),0);assert.equal(await count(f,'commerce_financial_entries'),before);
  assert.equal((await f.view()).paymentConfirmed,false);
  const original=await f.db.prepare('SELECT * FROM commerce_refunds WHERE id=?').bind(f.refund.id).first();
  await assert.rejects(f.db.prepare(`INSERT INTO commerce_refund_finalizations(refund_id,provider_request_id,evidence_id,capture_id,seller_id,order_id,commerce_environment,credential_fingerprint,outcome_reference,product_amount,shipping_amount,commission_reversal,cumulative_product_amount,evidence_json,returned_at,posted_at)
    VALUES(?,?,?,?,?,?,?,?,?,10000,0,500,10000,'{}',?,strftime('%Y-%m-%dT%H:%M:%fZ','now'))`).bind(f.refund.id,q.id,'forged',original.capture_id,original.seller_id,original.order_id,original.commerce_environment,'a'.repeat(64),'forged',new Date().toISOString()).run(),/evidence_required/);
});

for(const plan of ['standard','advanced'])test(plan+' original commission uses cumulative rounding and full remainder; fees and holds remain',async t=>{
  const f=await setup(t);await f.db.prepare('UPDATE sellers SET plan=? WHERE id=\'seller_alice\'').bind(plan).run();
  await f.db.prepare('UPDATE products SET price_amount=10003 WHERE id=\'tea\'').run();
  const p=await f.payment({items:[{productId:'tea',quantity:2,expectedPrice:10003,expectedWeightGrams:100}]});await f.settle(p);await f.deliver(p);
  await f.db.prepare("UPDATE sellers SET plan='standard' WHERE id='seller_alice'").run();
  const commission=plan==='advanced'?1200:1000,parts=[3333,6667,10006];let cumulative=0,reversed=0;
  for(const [i,amount] of parts.entries()){
    const r=await prepare(f,p,[{orderItemId:p.order.items[0].id,amount}],i===2?18000:0),e=await evidence(f,r,i===2?{refund_fee_amount:750}:{});
    const out=ok(await post(f,r,e));cumulative+=amount;const target=Number((BigInt(cumulative)*BigInt(commission)*2n+20006n)/(40012n));
    assert.equal(out.commissionReversal,String(target-reversed));reversed=target;
    const detail=ok(await f.merchant('/v1/commerce/refunds/'+r.id)).refund;assert.equal(detail.state,'confirmed');assert.equal(detail.paymentConfirmed,true);assert.equal(detail.processing.paymentConfirmed,true);
    assert.equal(detail.processing.costs,null);
    const queue=ok(await f.merchant('/v1/support/refunds?state=processing',undefined,{seller:'bob',claims:claims()}));assert.equal(queue.refunds.find(x=>x.id===r.id).paymentConfirmed,true);
    const approved=ok(await f.merchant('/v1/commerce/refunds?state=approved'));assert(!approved.refunds.some(x=>x.id===r.id));
    const position=await f.position(p);assert.equal(position.status,200,position.error);
    const order=await f.db.prepare('SELECT checkout_state,status FROM orders WHERE id=?').bind(p.order.id).first();assert.equal(order.checkout_state,i===2?'refunded':'partially_refunded');
  }
  assert.equal(reversed,commission);
  const balances=Object.fromEntries((await f.db.prepare('SELECT e.account,SUM(e.amount) amount FROM commerce_financial_entries e JOIN commerce_financial_journals j ON j.sequence=e.journal_sequence WHERE j.order_id=? GROUP BY e.account').bind(p.order.id).all()).results.map(r=>[r.account,r.amount]));
  assert.equal(balances.platform_commission_pending,0);assert.equal(balances.platform_admin_pending,-1250);assert.equal(balances.seller_pending,3750);assert.equal(balances.seller_reserved,0);assert.equal(balances.refund_funding_unreconciled,-38006);
  const current=await f.db.prepare('SELECT * FROM commerce_earnings_positions WHERE order_id=?').bind(p.order.id).first();assert.equal(current.net_amount,-3750);assert.equal(current.available_amount,0);assert.equal(current.reconciled,1);assert(JSON.parse(current.holds_json).includes('refund_fee_unsettled'));
  await balanced(f);
});

test('concurrent replay, conflicting evidence, immutability and lost acknowledgement never double-post',async t=>{
  const f=await setup(t),p=await f.payment();await f.settle(p);const r=await prepare(f,p,[{orderItemId:p.order.items[0].id,amount:10000}]),e=await evidence(f,r);
  const results=await Promise.all([post(f,r,e),post(f,r,e),post(f,r,e)]);results.forEach(ok);assert.equal(await count(f,'commerce_refund_finalizations'),1);
  assert.equal((await f.call(path,input(f,r,'conflicting-evidence'))).status,409);
  const row=await f.db.prepare('SELECT * FROM commerce_refund_finalizations').first();
  for(const stmt of ['DELETE FROM commerce_refund_finalizations','UPDATE commerce_refund_finalizations SET commission_reversal=0','INSERT OR REPLACE INTO commerce_refund_finalizations SELECT * FROM commerce_refund_finalizations'])await assert.rejects(f.db.prepare(stmt).run(),/immutable/);
  await assert.rejects(f.db.prepare("UPDATE orders SET checkout_state='paid' WHERE id=?").bind(p.order.id).run(),/projection_mismatch/);
  const r2=await prepare(f,p,[{orderItemId:p.order.items[0].id,amount:10000}]),e2=await evidence(f,r2,{outcome_reference:e.outcome_reference});assert.equal((await post(f,r2,e2)).status,409);
  await f.db.prepare('UPDATE fixture_refund_outcomes SET outcome_reference=? WHERE evidence_id=?').bind('unique_'+key(),e2.evidence_id).run();
  const db=new Proxy(f.db,{get(target,prop){if(prop==='prepare')return sql=>{const s=target.prepare(sql);if(!sql.startsWith('INSERT INTO commerce_refund_finalizations'))return s;return {bind(...args){return {async run(){await s.bind(...args).run();throw Error('Lost committed reply');}};}};};const v=Reflect.get(target,prop);return typeof v==='function'?v.bind(target):v;}});
  const recovered=await finalizeConfirmedRefund({DB:db,APP_ENVIRONMENT:'test',COMMERCE_STORAGE:'d1'},input(f,r2,e2.evidence_id));assert.equal(recovered.paymentConfirmed,true);
  assert.equal(await count(f,'commerce_refund_finalizations'),2);assert.equal((await f.db.prepare('SELECT COUNT(*) n FROM commerce_financial_journals WHERE kind=\'refund\'').first()).n,2);assert.equal(row.product_amount,10000);await balanced(f);
});

test('entry failure rolls back finalization, projections and entitlement effects; original evidence retries',async t=>{
  const f=await setup(t),p=await f.payment();await f.settle(p);const r=await prepare(f,p,[{orderItemId:p.order.items[0].id,amount:10000}]),e=await evidence(f,r);
  const before=(await f.db.prepare('SELECT * FROM orders WHERE id=?').bind(p.order.id).first()),entries=await count(f,'commerce_financial_entries');
  await f.db.prepare("CREATE TRIGGER fixture_refund_failure BEFORE INSERT ON commerce_financial_entries WHEN NEW.account='refund_funding_unreconciled' BEGIN SELECT RAISE(ABORT,'fixture_entry_failure'); END").run();
  assert.equal((await post(f,r,e)).status,500);assert.equal(await count(f,'commerce_refund_finalizations'),0);assert.equal(await count(f,'commerce_financial_entries'),entries);assert.deepEqual(await f.db.prepare('SELECT * FROM orders WHERE id=?').bind(p.order.id).first(),before);
  await f.db.prepare('DROP TRIGGER fixture_refund_failure').run();ok(await post(f,r,e));await balanced(f);
});

test('mismatched original identities, amount, date and contradictory outcomes cannot be promoted to confirmation',async t=>{
  const f=await setup(t),p=await f.payment();await f.settle(p);const r=await prepare(f,p,[{orderItemId:p.order.items[0].id,amount:10000}]);
  for(const change of [{amount:9999},{currency:'USD'},{credential_fingerprint:'b'.repeat(64)},{commerce_environment:'production'},{bank_id:'foreign'},{capture_id:'foreign'},{payment_reference:'foreign'},{brand_id:'foreign'},{returned_at:'2000-01-01T00:00:00.000Z'},{refund_fee_amount:-1},{evidence_hash:'unverified'}]){
    const e=await evidence(f,r,change);assert.equal((await post(f,r,e)).status,409,JSON.stringify(change));await f.db.prepare('DELETE FROM fixture_refund_outcomes').run();
  }
  const e=await evidence(f,r);await evidence(f,r);assert.equal((await post(f,r,e)).status,409);assert.equal(await count(f,'commerce_refund_finalizations'),0);
});

test('allocated digital refunds revoke only their files, including outstanding grants and post-R2 checks',async t=>{
  const f=await setup(t),a=await digitalFixtureFile(f,{id:'guide_a',sku:'A'}),b=await digitalFixtureFile(f,{id:'guide_b',sku:'B'});
  const p=await f.payment({items:[a.item,b.item,{productId:'tea',quantity:1,expectedPrice:20000,expectedWeightGrams:100}]});await f.settle(p);
  const shipping=await prepare(f,p,[],18000);ok(await post(f,shipping,await evidence(f,shipping)));assert.equal(await count(f,'commerce_digital_refund_revocations'),0);
  const ia=p.order.items.find(i=>i.productId===a.id),ib=p.order.items.find(i=>i.productId===b.id),base='/v1/customer/orders/'+p.order.id+'/downloads',grant=async item=>ok(await f.merchant(base+'/'+item.id+'/grants',{requestKey:key()},{seller:'earnings-buyer',method:'POST'})).grant;
  const ga=await grant(ia),gb=await grant(ib),r=await prepare(f,p,[{orderItemId:ia.id,amount:12500}]),e=await evidence(f,r);
  await f.db.prepare("CREATE TRIGGER fixture_digital_rollback BEFORE INSERT ON commerce_financial_entries WHEN NEW.account='refund_funding_unreconciled' BEGIN SELECT RAISE(ABORT,'fixture_entry_failure'); END").run();
  assert.equal((await post(f,r,e)).status,500);assert.equal(await count(f,'commerce_digital_refund_revocations'),0);await grant(ia);
  await f.db.prepare('DROP TRIGGER fixture_digital_rollback').run();
  const env={DB:f.db,APP_ENVIRONMENT:'test',COMMERCE_STORAGE:'d1',PRIVATE_ASSETS:await f.mf.getR2Bucket('PRIVATE_ASSETS')};
  const raced={...env,PRIVATE_ASSETS:{async get(...args){const object=await env.PRIVATE_ASSETS.get(...args);ok(await post(f,r,e));return object;}}};
  await assert.rejects(buyerDigitalFile(raced,{id:'earnings-buyer'},p.order.id,ia.id,ga.id,new Request('https://fixture.test')),err=>err instanceof Response&&err.status===409);
  const purchases=ok(await f.merchant(base,undefined,{seller:'earnings-buyer'}));assert.equal(purchases.items.find(i=>i.orderItemId===ia.id).canDownload,false);assert.equal(purchases.items.find(i=>i.orderItemId===ib.id).canDownload,true);
  assert.equal(purchases.items.find(i=>i.orderItemId===ia.id).state,'refund_review');
  assert.equal(await count(f,'commerce_digital_refund_revocations'),1);assert.equal(await count(f,'commerce_digital_entitlements'),2);
  const downloaded=await buyerDigitalFile(env,{id:'earnings-buyer'},p.order.id,ib.id,gb.id,new Request('https://fixture.test'));assert.equal(downloaded.status,200);assert.deepEqual(Buffer.from(await downloaded.arrayBuffer()),b.bytes);await grant(ib);
  await assert.rejects(f.db.prepare('INSERT INTO commerce_digital_download_requests(id,grant_id,requested_range,authorized_at) VALUES(?,?,?,?)').bind('dreq_'+key(),ga.id,'',new Date().toISOString()).run(),/access_changed/);
  const remainder=await prepare(f,p,[{orderItemId:ia.id,amount:12500}]);ok(await post(f,remainder,await evidence(f,remainder)));
  const after=ok(await f.merchant(base,undefined,{seller:'earnings-buyer'}));assert.equal(after.items.find(i=>i.orderItemId===ia.id).state,'refunded');assert.equal(after.items.find(i=>i.orderItemId===ib.id).canDownload,true);
  await balanced(f);
});

test('0066 preserves populated original history and starts with no evidence or finalizations',async t=>{
  const f=await setupEarningsFixture(t,{through:65}),p=await f.payment();await f.settle(p);
  const now=new Date().toISOString();await f.db.prepare(`INSERT INTO commerce_refunds(id,seller_id,order_id,commerce_environment,capture_id,actor_kind,actor_auth_user_id,request_key,request_hash,order_revision,data_json,amount,shipping_amount,created_at,updated_at)
    SELECT ?,o.seller_id,o.id,o.commerce_environment,c.id,'merchant','alice',?,?,o.revision,?,10000,0,?,? FROM orders o JOIN commerce_payment_captures c ON c.order_id=o.id AND c.capture_kind='order_payment' WHERE o.id=?`)
    .bind('ref_'+key(),key(),key(),JSON.stringify({reason:'other',note:'Preserve original allocation.',items:[{orderItemId:p.order.items[0].id,amount:10000}],shippingAmount:0}),now,now,p.order.id).run();
  const tables=['orders','commerce_refunds','commerce_financial_journals','commerce_financial_entries','commerce_earnings_assessments'],before={};for(const table of tables)before[table]=(await f.db.prepare('SELECT * FROM '+table).all()).results;
  await applyCommerceSchema(f.db,65,66);for(const table of tables)assert.deepEqual((await f.db.prepare('SELECT * FROM '+table).all()).results,before[table],table);
  assert.equal(await count(f,'commerce_refund_finalizations'),0);assert.equal(await count(f,'commerce_refund_verified_outcomes'),0);await balanced(f);
});


test('maximum order arithmetic stays integer and distinct concurrent partial refunds conserve the original commission',async t=>{
  const f=await setup(t);await f.db.prepare("UPDATE sellers SET plan='advanced' WHERE id='seller_alice'").run();await f.product('large-refund',100,'seller_alice',1000000000);
  const p=await f.payment({items:[{productId:'large-refund',quantity:100,expectedPrice:1000000000,expectedWeightGrams:100}],shipping:{amount:0,skipped:true}});await f.settle(p);
  const amounts=[49999999991,50000000009],refunds=[];
  for(const amount of amounts){const r=await prepare(f,p,[{orderItemId:p.order.items[0].id,amount}]);refunds.push([r,await evidence(f,r)]);}
  (await Promise.all(refunds.map(([r,e])=>post(f,r,e)))).forEach(ok);
  const rows=(await f.db.prepare('SELECT * FROM commerce_refund_finalizations ORDER BY sequence').all()).results;let previous=0n;
  for(const row of rows){const target=(BigInt(row.cumulative_product_amount)*6000000000n*2n+100000000000n)/200000000000n;assert.equal(BigInt(row.commission_reversal),target-previous);previous=target;}
  assert.equal(previous,6000000000n);assert.equal((await f.db.prepare('SELECT checkout_state FROM orders WHERE id=?').bind(p.order.id).first()).checkout_state,'refunded');await balanced(f);
});
