import test from 'node:test';
import assert from 'node:assert/strict';
import {setupCommerceFixture} from './commerce-fixture.mjs';
import {applyCommerceSchema} from './commerce-schema.mjs';
import {seedRoutingWallets,splitEvidence} from './payment-routing-fixture.mjs';

const fingerprint='a'.repeat(64),clientId='MCH-FIXTURE-SNAP',workerId='routing_worker';
const path=o=>'/internal/commerce/snap-payments/'+o.id;
async function fixture(t,{seed=true,platformParent,...options}={}){
  const f=await setupCommerceFixture(t,{...options,bindings:{COMMERCE_PLATFORM_WALLET_SELLER:'seller_bob',...options.bindings}});
  const environment=options.bindings?.APP_ENVIRONMENT==='beta'?'production':'sandbox';
  if(seed)await seedRoutingWallets(f,{environment,fingerprint,clientId,platformParent});
  const create=async extra=>{const r=await f.create(f.input({checkout:{intentHash:'e'.repeat(64),paymentFlow:'snap_bca',shop:'alice-shop'},...extra}));assert.equal(r.status,200,r.error);return r.order;};
  const claim=async(order,mode='execute')=>{const r=await f.call('/internal/commerce/jobs/claim',{environment,workerId,kinds:['payment.create'],orderId:order.id,mode,limit:1,leaseSeconds:120});assert.equal(r.jobs.length,1,r.error);return r.jobs[0];};
  const input=job=>({environment,workerId,leaseToken:job.leaseToken,credentialFingerprint:fingerprint,clientId});
  const bind=(o,j,extra={})=>f.call(path(o)+'/route/bind',{...input(j),...extra});
  const receipt=(o,b,extra={})=>f.call(path(o)+'/route/receipt',{environment,evidence:splitEvidence(b),...extra});
  const payBind=(o,j)=>f.call(path(o)+'/bind',{...input(j),partnerServiceId:'   19008',customerPrefix:'0'});
  const finish=(j,outcome)=>f.call('/internal/commerce/jobs/'+j.id+'/finish',{environment,workerId,leaseToken:j.leaseToken,outcome,result:{noEffectConfirmed:outcome==='retry'}});
  const count=async table=>(await f.db.prepare('SELECT COUNT(*) AS n FROM '+table).first()).n;
  return {...f,environment,create,claim,input,bind,receipt,payBind,finish,count};
}

test('beta routes freeze confirmed same-parent wallets and original product commission, admin and shipping before VA dispatch',async t=>{
  const f=await fixture(t,{bindings:{APP_ENVIRONMENT:'beta'}}),o=await f.create(),j=await f.claim(o);
  assert.equal((await f.payBind(o,j)).status,409);
  await f.db.prepare("UPDATE sellers SET plan='advanced' WHERE id='seller_alice'").run();
  const binds=await Promise.all([f.bind(o,j),f.bind(o,j)]);assert.equal(binds.filter(b=>b.mayCreateRule===true).length,1);
  const b=binds.find(b=>b.mayCreateRule).binding;
  assert.deepEqual({seller:b.sellerProfileId,platform:b.platformCashAccount,gross:b.grossAmount,allocation:b.platformAmount},
    {seller:'SAC-alice',platform:'2010000002',gross:58000,allocation:21250});
  assert.match(b.externalId,/^[0-9]{32}$/);assert.notEqual(b.externalId,o.paymentRequestId);
  const body={environment:f.environment,evidence:splitEvidence(b)};
  const receipts=await Promise.all([f.call(path(o)+'/route/receipt',body),f.call(path(o)+'/route/receipt',body)]);
  assert(receipts.every(r=>r.status===200),JSON.stringify(receipts));assert.equal(await f.count('commerce_payment_route_receipts'),1);
  assert.equal(receipts.filter(r=>!r.replayed).length,1);assert.equal((await f.call(path(o)+'/route/receipt',body)).replayed,true);
  const payment=await f.payBind(o,j);assert.equal(payment.status,200,payment.error);assert.equal(payment.mayCreate,true);
  assert.deepEqual(payment.binding.routing,{profileId:'SAC-alice',splitRuleId:'split-'+o.id.slice(-24)});
  assert.equal((await f.bind(o,j)).mayCreateRule,false);assert.equal(await f.count('commerce_payment_captures'),0);assert.equal(await f.count('commerce_financial_journals'),0);
  for(const table of ['commerce_payment_route_bindings','commerce_payment_route_receipts','commerce_snap_payment_bindings']){
    await assert.rejects(f.db.prepare('DELETE FROM '+table).run(),/immutable/);
    await assert.rejects(f.db.prepare('INSERT OR REPLACE INTO '+table+' SELECT * FROM '+table).run(),/immutable|mismatch/);
  }
});

test('unknown split creation cannot be dispatched or retried; an original recovered receipt permits payment-only retry',async t=>{
  const f=await fixture(t),o=await f.create(),j=await f.claim(o),bound=await f.bind(o,j);assert.equal(bound.status,200,bound.error);
  assert.equal((await f.finish(j,'retry')).status,409);assert.equal((await f.finish(j,'uncertain')).status,200);
  await f.db.prepare("UPDATE commerce_jobs SET available_at='2000-01-01T00:00:00.000Z' WHERE id=?").bind(j.id).run();
  const recovery=await f.claim(o,'reconcile');assert.equal((await f.bind(o,recovery)).mayCreateRule,false);assert.equal((await f.payBind(o,recovery)).status,409);
  assert.equal((await f.receipt(o,bound.binding)).status,200);assert.equal((await f.finish(recovery,'retry')).status,200);
  assert.equal(await f.count('commerce_payment_route_bindings'),1);assert.equal(await f.count('commerce_payment_route_receipts'),1);
  assert.equal(await f.count('commerce_snap_payment_bindings'),0);assert.equal(await f.count('commerce_financial_journals'),0);
});

test('missing, unconfirmed, self-owned or foreign-parent destinations stop routing before any dispatch grant',async t=>{
  for(const options of [{seed:false},{bindings:{COMMERCE_PLATFORM_WALLET_SELLER:''}},{bindings:{COMMERCE_PLATFORM_WALLET_SELLER:'seller_alice'}},{platformParent:'BRN-foreign'}])await t.test(JSON.stringify(options),async t=>{
    const f=await fixture(t,options),o=await f.create(),j=await f.claim(o),result=await f.bind(o,j);
    assert([409,503].includes(result.status),JSON.stringify(result));assert.equal(await f.count('commerce_payment_route_bindings'),0);assert.equal(await f.count('commerce_snap_payment_bindings'),0);
  });
});

test('changed money, identity, response rules, original request and ambiguous number tokens cannot authorize payment',async t=>{
  const f=await fixture(t),o=await f.create(),j=await f.claim(o),bound=await f.bind(o,j),b=bound.binding;assert.equal(bound.status,200,bound.error);
  for(const mutate of [e=>e.credentialFingerprint='b'.repeat(64),e=>e.externalId='1'.repeat(32),e=>e.environment='production',
    e=>{const r=JSON.parse(e.responseBody);r.rules[0].value++;e.responseBody=JSON.stringify(r);},
    e=>{const r=JSON.parse(e.responseBody);r.rules[0].accountNumber=2010000001;e.responseBody=JSON.stringify(r);},
    e=>{const r=JSON.parse(e.responseBody);r.rules.push(r.rules[0]);e.responseBody=JSON.stringify(r);},
    e=>{const r=JSON.parse(e.responseBody);r.rules[0].type='PERCENTAGE';e.responseBody=JSON.stringify(r);},
    e=>e.requestBody=e.requestBody.replace('FLAT','PERCENTAGE'),e=>e.responseBody=e.responseBody.replace('"value":3250','"value":3.25e3'),
    e=>e.responseBody=e.responseBody.replace('"accountNumber":2010000002','"accountNumber":2010000002.0'),
    e=>e.responseBody=e.responseBody.replace('"transactionType":','"transactionType":"OTHER","transactionType":'),e=>e.observedAt='2026-02-30T12:00:00Z']){
    const evidence=splitEvidence(b);mutate(evidence);const r=await f.receipt(o,b,{evidence});assert(r.status>=400,JSON.stringify(evidence));assert.equal(await f.count('commerce_payment_route_receipts'),0);
  }
  assert.equal((await f.payBind(o,j)).status,409);
  const first=await f.receipt(o,b);assert.equal(first.status,200,first.error);
  const changed=splitEvidence(b);changed.responseBody=changed.responseBody.replace('split-','other-');assert.equal((await f.receipt(o,b,{evidence:changed})).status,409);
  assert.equal(await f.count('commerce_financial_journals'),0);
});

test('original negative seller allocations stay exact and split receipt failures cannot authorize a VA',async t=>{
  const f=await fixture(t);await f.product('tiny',10,'seller_alice',1000);
  const o=await f.create({items:[{productId:'tiny',quantity:1,expectedPrice:1000,expectedWeightGrams:100}]}),j=await f.claim(o),bound=await f.bind(o,j);
  assert.equal(bound.status,200,bound.error);assert.equal(bound.binding.grossAmount,1000);assert.equal(bound.binding.platformAmount,1300);
  await f.db.prepare("CREATE TRIGGER fail_route_receipt BEFORE INSERT ON commerce_payment_route_receipts BEGIN SELECT RAISE(ABORT,'fixture_route_outage'); END").run();
  const original=splitEvidence(bound.binding);
  assert.equal((await f.receipt(o,bound.binding,{evidence:original})).status,500);assert.equal((await f.payBind(o,j)).status,409);
  assert.equal((await f.bind(o,j)).mayCreateRule,false);assert.equal(await f.count('commerce_payment_route_bindings'),1);
  await f.db.prepare('DROP TRIGGER fail_route_receipt').run();assert.equal((await f.receipt(o,bound.binding,{evidence:original})).status,200);
  assert.equal((await f.payBind(o,j)).status,200);assert.equal(await f.count('commerce_financial_journals'),0);
});

test('routing requires service authority, current lease and exact store/environment scope',async t=>{
  const f=await fixture(t),o=await f.create(),j=await f.claim(o),url=path(o)+'/route/bind';
  assert.equal((await f.merchant(url,f.input(j),{method:'POST'})).status,401);
  for(const change of [{environment:'production'},{leaseToken:'foreign_token'},{workerId:'other_worker'},{platformAmount:1},{sellerProfileId:'SAC-other'},{credentialFingerprint:'b'.repeat(64)}]){
    const result=await f.bind(o,j,change);assert(result.status>=400,JSON.stringify(result));
  }
  assert.equal((await f.call(url+'?extra=1',f.input(j))).status,405);
  const raw=JSON.stringify(f.input(j)).replace('"environment":','"environment":"production","environment":');
  const response=await f.mf.dispatchFetch('https://api.fixture.test'+url,{method:'POST',headers:f.headers(url,'POST',raw),body:raw});assert.equal(response.status,422);
  assert.equal((await f.call(url,{...f.input(j),padding:'x'.repeat(3000)})).status,413);
  assert.equal(await f.count('commerce_payment_route_bindings'),0);
});

test('migration preserves existing unrouted SNAP evidence and callbacks but requires routing for every new binding',async t=>{
  const f=await fixture(t,{through:50,seed:false}),o=await f.create(),j=await f.claim(o);
  const b={environment:'sandbox',credentialFingerprint:fingerprint,externalId:o.paymentRequestId,orderId:o.id,partnerServiceId:'   19008',customerPrefix:'0',amount:o.total,
    name:o.customer.name,email:o.customer.email,expiresAt:o.expiresAt.replace('.000Z','Z')};
  await f.db.prepare(`INSERT INTO commerce_snap_payment_bindings(order_id,seller_id,commerce_environment,job_id,attempt_id,credential_fingerprint,client_id,external_id,binding_json,created_at)
    VALUES(?,?,?,?,?,?,?,?,?,?)`).bind(o.id,o.sellerId,'sandbox',j.id,j.id+':'+j.attempts,fingerprint,clientId,o.paymentRequestId,JSON.stringify(b),new Date().toISOString()).run();
  const tables=(await f.db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '_cf_%' ORDER BY name").all()).results.map(r=>r.name);
  const before={};for(const table of tables)before[table]=(await f.db.prepare('SELECT * FROM '+table).all()).results;
  await applyCommerceSchema(f.db,50,51);
  for(const table of tables)assert.deepEqual((await f.db.prepare('SELECT * FROM '+table).all()).results,before[table],table);
  assert.deepEqual((await f.db.prepare('PRAGMA foreign_key_check').all()).results,[]);
  const read=await f.call(path(o)+'?environment=sandbox');assert.equal(read.status,200,read.error);assert.equal(read.payment.route,null);assert.deepEqual(read.payment.binding,b);
  const evidence={environment:'sandbox',credentialFingerprint:fingerprint,operation:'bca-notification',externalId:'123456',sentAt:new Date().toISOString().replace(/\.\d{3}Z$/,'Z'),requestBody:null,
    body:JSON.stringify({partnerServiceId:'   19008',customerNo:'00000347140',virtualAccountNo:'   1900800000347140',virtualAccountName:b.name,trxId:o.id,
      paidAmount:{value:o.total+'.00',currency:'IDR'},paymentRequestId:'historic-charge',additionalInfo:{channel:'VIRTUAL_ACCOUNT_BCA'}})};
  evidence.observedAt=evidence.sentAt;
  const paid=await f.call(path(o)+'/receipt',evidence);assert.equal(paid.status,200,paid.error);assert.equal(paid.paymentConfirmed,true);
  assert.equal((await f.call(path(o)+'/receipt',evidence)).status,200);assert.equal(await f.count('commerce_payment_captures'),1);
  const next=await f.create(),job=await f.claim(next);assert.equal((await f.payBind(next,job)).status,409);assert.equal(await f.count('commerce_snap_payment_bindings'),1);
});
