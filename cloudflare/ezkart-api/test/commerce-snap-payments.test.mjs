import test from 'node:test';
import assert from 'node:assert/strict';
import {randomBytes} from 'node:crypto';
import {setupCommerceFixture} from './commerce-fixture.mjs';
import {applyCommerceSchema} from './commerce-schema.mjs';
import {recordSnapPaymentReceipt} from '../src/commerce-snap-payments.js';
import {seedRoutingWallets,prepareFixtureRoute} from './payment-routing-fixture.mjs';

const fingerprint='a'.repeat(64),clientId='MCH-FIXTURE-SNAP',account='1900800000347140',workerId='fixture_snap_worker';
const iso=()=>new Date().toISOString().replace(/\.\d{3}Z$/,'Z');
const path=order=>'/internal/commerce/snap-payments/'+order.id;
async function fixture(t,options={}){
  const f=await setupCommerceFixture(t,{...options,bindings:{COMMERCE_PLATFORM_WALLET_SELLER:'seller_bob',...options.bindings}}),environment=options.bindings?.APP_ENVIRONMENT==='beta'?'production':'sandbox';
  await seedRoutingWallets(f,{environment,fingerprint,clientId});
  const create=async()=>{const r=await f.create(f.input({checkout:{intentHash:'f'.repeat(64),paymentFlow:'snap_bca',shop:'alice-shop'}}));assert.equal(r.status,200,r.error);return r.order;};
  const claim=async(order,mode='execute')=>{const r=await f.call('/internal/commerce/jobs/claim',{environment,workerId,kinds:['payment.create'],orderId:order.id,mode,limit:1,leaseSeconds:120});assert.equal(r.status,200,r.error);assert.equal(r.jobs.length,1);return r.jobs[0];};
  const bind=(order,job,overrides={})=>f.call(path(order)+'/bind',{environment,workerId,leaseToken:job.leaseToken,credentialFingerprint:fingerprint,clientId,partnerServiceId:'   19008',customerPrefix:'0',...overrides});
  const route=(order,job)=>prepareFixtureRoute(f,order,job,{environment,workerId,fingerprint,clientId});
  const start=async()=>{const order=await create(),job=await claim(order);await route(order,job);const r=await bind(order,job);assert.equal(r.status,200,r.error);assert.equal(r.mayCreate,true);return {order,job,binding:r.binding};};
  const read=async order=>(await f.call(path(order)+'?environment='+environment)).payment;
  const counts=async()=>{const tables=['commerce_snap_payment_receipts','commerce_payment_accounts','commerce_payment_sessions','commerce_payment_captures','commerce_order_events','commerce_financial_journals'];
    const values={};for(const table of tables)values[table]=(await f.db.prepare('SELECT COUNT(*) AS n FROM '+table).first()).n;return values;};
  return {...f,environment,create,claim,bind,start,read,counts,route,receipt:(order,input)=>f.call(path(order)+'/receipt',input)};
}
function createBody(b){return {partnerServiceId:b.partnerServiceId,customerNo:b.customerPrefix,virtualAccountNo:b.partnerServiceId+b.customerPrefix,
  virtualAccountName:b.name,virtualAccountEmail:b.email,trxId:b.orderId,totalAmount:{value:b.amount+'.00',currency:'IDR'},
  virtualAccountTrxType:'C',expiredDate:b.expiresAt,additionalInfo:{channel:'VIRTUAL_ACCOUNT_BCA',virtualAccountConfig:{reusableStatus:false},
    ...(b.routing?{account:{id:b.routing.profileId,split_rule_id:b.routing.splitRuleId}}:{})}};}
function created(b){return {responseCode:'2002700',responseMessage:'Successful',virtualAccountData:{...createBody(b),customerNo:account.slice(5),virtualAccountNo:'   '+account}};}
function notice(b){const {totalAmount,expiredDate,...data}=created(b).virtualAccountData;return {...data,paidAmount:totalAmount,paymentRequestId:'PJP-one',trxDateTime:iso()};}
const evidence=(b,operation,body,requestBody=null)=>({environment:b.environment,credentialFingerprint:b.credentialFingerprint,operation,
  externalId:operation==='bca-create'?b.externalId:'123456789',sentAt:iso(),observedAt:iso(),body:JSON.stringify(body),requestBody:requestBody===null?null:JSON.stringify(requestBody)});
const createReceipt=b=>evidence(b,'bca-create',created(b),createBody(b));
const notification=b=>evidence(b,'bca-notification',notice(b));
async function finish(f,job,outcome='uncertain'){return f.call('/internal/commerce/jobs/'+job.id+'/finish',{environment:f.environment,workerId,leaseToken:job.leaseToken,outcome,result:{noEffectConfirmed:outcome==='retry'},error:''});}

test('SNAP binds the exact leased original order once, freezes provider identity and denies unsafe retries',async t=>{
  const f=await fixture(t),order=await f.create(),job=await f.claim(order);
  await f.route(order,job);
  assert.match(order.paymentRequestId,/^[0-9]{32}$/);assert.match(order.expiresAt,/\.000Z$/);
  assert.equal((await f.bind(order,job,{leaseToken:'foreign_token'})).status,409);
  const results=await Promise.all([f.bind(order,job),f.bind(order,job)]);assert.equal(results.filter(r=>r.mayCreate===true).length,1);
  const original=(await f.read(order)).binding;
  assert.equal(original.amount,order.total);assert.equal(original.externalId,order.paymentRequestId);assert.equal(original.name,order.customer.name);
  assert.equal((await f.bind(order,job)).mayCreate,false);
  for(const change of [{credentialFingerprint:'b'.repeat(64)},{clientId:'different-client'},{partnerServiceId:'   19009'},{customerPrefix:'1'}])assert.equal((await f.bind(order,job,change)).status,409);
  assert.equal((await finish(f,job,'retry')).status,409);assert.equal((await finish(f,job)).status,200);
  await assert.rejects(f.db.prepare("UPDATE commerce_jobs SET state='retry' WHERE id=?").bind(job.id).run(),/commerce_snap_reconcile_required/);
  for(const table of ['commerce_snap_payment_bindings']){
    await assert.rejects(f.db.prepare('UPDATE '+table+" SET client_id='changed'").run(),/commerce_immutable_snap/);
    await assert.rejects(f.db.prepare('DELETE FROM '+table).run(),/commerce_immutable_snap/);
  }
  const unsigned=await f.mf.dispatchFetch('https://api.fixture.test'+path(order)+'?environment=sandbox');assert.equal(unsigned.status,401);
  assert.equal((await f.call(path(order)+'?environment=production')).status,403);
});

test('beta SNAP instructions retain the workbench origin, persist the original receipt and never imply settlement',async t=>{
  const f=await fixture(t,{bindings:{APP_ENVIRONMENT:'beta'}}),{order,job,binding}=await f.start(),payload=createReceipt(binding);
  const result=await f.receipt(order,payload);assert.equal(result.status,200,result.error);assert.equal(result.recorded,true);assert.equal(result.paymentConfirmed,false);assert.equal(result.settlementVerified,false);
  assert.equal(result.order.state,'pending');assert.equal(result.order.payment.flow,'snap_bca');assert.equal(result.order.payment.accountNumber,account);
  assert.equal(result.order.payment.paymentUrl,'https://test.ezkart.id/cart/payment.php?order='+order.id);
  const stored=await f.db.prepare('SELECT body_json,request_json FROM commerce_snap_payment_receipts').first();assert.equal(stored.body_json,payload.body);assert.equal(stored.request_json,payload.requestBody);
  const before=await f.counts();assert.equal((await f.receipt(order,payload)).receiptId,result.receiptId);assert.deepEqual(await f.counts(),before);
  assert.equal((await finish(f,job,'succeeded')).status,200);assert.equal(await f.stock(),10);
  assert.equal((await f.event(order,'payment.created',f.session(order,{accountNumber:account}))).status,409);
  const replacement=createReceipt(binding);const changed=JSON.parse(replacement.body);changed.virtualAccountData.virtualAccountNo='   1900800000347141';changed.virtualAccountData.customerNo='00000347141';replacement.body=JSON.stringify(changed);
  assert.equal((await f.receipt(order,replacement)).status,409);assert.deepEqual(await f.counts(),before);
});

test('a callback before the create reply captures once; redelivery preserves each receipt without repeated stock or accounting',async t=>{
  const f=await fixture(t),{order,binding}=await f.start(),input=notification(binding),first=await f.receipt(order,input);
  assert.equal(first.status,200,first.error);assert.equal(first.paymentConfirmed,true);assert.equal(first.order.state,'paid');assert.equal(first.order.payment,null);assert.equal(await f.stock(),8);
  const counts=await f.counts();assert.equal(counts.commerce_payment_captures,1);
  assert.equal((await f.receipt(order,input)).receiptId,first.receiptId);assert.deepEqual(await f.counts(),counts);
  const changed=JSON.parse(input.body);changed.virtualAccountNo=account;delete changed.trxDateTime;
  const retry=await f.receipt(order,{...input,externalId:'987654321',body:JSON.stringify(changed,null,2)});
  assert.equal(retry.status,200,retry.error);assert.notEqual(retry.receiptId,first.receiptId);assert.equal(await f.stock(),8);
  const after=await f.counts();assert.equal(after.commerce_payment_captures,1);assert.equal(after.commerce_order_events,counts.commerce_order_events);assert.equal(after.commerce_financial_journals,counts.commerce_financial_journals);assert.equal(after.commerce_snap_payment_receipts,2);
  const reply=await f.receipt(order,createReceipt(binding));assert.equal(reply.status,200,reply.error);assert.equal(reply.order.state,'paid');assert.equal(reply.order.payment.accountNumber,account);assert.equal(await f.stock(),8);
  assert.equal((await f.paid(order)).status,409);
  const publicDetail=await f.merchant('/v1/commerce/payments/'+order.id);assert.equal(publicDetail.status,200);assert(!JSON.stringify(publicDetail).includes(fingerprint));assert(!JSON.stringify(publicDetail).includes('body_json'));
});

test('mismatched or ambiguous original receipts cannot change money, order, account or inventory',async t=>{
  const f=await fixture(t),{order,binding}=await f.start(),before=await f.counts();
  for(const mutation of [data=>data.trxId='EZK-S-'+'F'.repeat(24),data=>data.paidAmount.value='40000.01',data=>data.paidAmount.value=40000,
    data=>data.paidAmount.currency='USD',data=>data.partnerServiceId='   19009',data=>data.customerNo='foreign',data=>data.additionalInfo.channel='VIRTUAL_ACCOUNT_BNI',data=>data.paymentRequestId='',data=>data.trxDateTime='2026-02-30T10:00:00Z']){
    const body=notice(binding);mutation(body);const r=await f.receipt(order,evidence(binding,'bca-notification',body));assert(r.status>=400,JSON.stringify(body));assert.deepEqual(await f.counts(),before);
  }
  const duplicate=notification(binding);duplicate.body=duplicate.body.replace('"trxId":','"trxId":"other","trxId":');assert.equal((await f.receipt(order,duplicate)).status,422);
  const changedRequest=createReceipt(binding);const req=JSON.parse(changedRequest.requestBody);req.totalAmount.value='1.00';changedRequest.requestBody=JSON.stringify(req);assert.equal((await f.receipt(order,changedRequest)).status,409);
  for(const routing of [{id:'SAC-other',split_rule_id:binding.routing.splitRuleId},{id:binding.routing.profileId,split_rule_id:'different-rule'}]){
    const changed=createReceipt(binding),response=JSON.parse(changed.body);response.virtualAccountData.additionalInfo.account=routing;changed.body=JSON.stringify(response);
    assert.equal((await f.receipt(order,changed)).status,409);assert.deepEqual(await f.counts(),before);
  }
  assert.equal((await f.receipt(order,{...notification(binding),credentialFingerprint:'f'.repeat(64)})).status,409);
  assert.deepEqual(await f.counts(),before);assert.equal(await f.stock(),10);
});

test('capture failures roll back their receipt and account; redelivery can commit after storage recovers',async t=>{
  const f=await fixture(t),{order,binding}=await f.start(),before=await f.counts();
  await f.db.prepare("CREATE TRIGGER fixture_capture_outage BEFORE INSERT ON commerce_payment_captures BEGIN SELECT RAISE(ABORT,'fixture_storage_outage'); END").run();
  const failed=await f.receipt(order,notification(binding));assert.equal(failed.status,500);assert.deepEqual(await f.counts(),before);assert.equal((await f.read(order)).accountNumber,null);assert.equal(await f.stock(),10);
  await f.db.prepare('DROP TRIGGER fixture_capture_outage').run();
  assert.equal((await f.receipt(order,notification(binding))).status,200);assert.equal(await f.stock(),8);
});

test('late payments keep financial evidence without overselling; additional charges require review and cannot attach to another order',async t=>{
  const f=await fixture(t),first=await f.start();assert.equal((await f.event(first.order,'checkout.cancelled')).status,200);
  const paid=await f.receipt(first.order,notification(first.binding));assert.equal(paid.status,200,paid.error);assert.equal(paid.order.fulfillmentState,'stock_review');assert.equal(await f.stock(),10);
  const secondCharge=notice(first.binding);secondCharge.paymentRequestId='PJP-two';
  const second=await f.receipt(first.order,evidence(first.binding,'bca-notification',secondCharge));assert.equal(second.status,200,second.error);assert.equal(second.order.paymentReview,true);
  const captures=(await f.db.prepare('SELECT capture_kind FROM commerce_payment_captures ORDER BY capture_kind').all()).results;assert.deepEqual(captures.map(r=>r.capture_kind),['duplicate_payment','order_payment']);
  const another=await f.start(),before=await f.counts();assert.equal((await f.receipt(another.order,notification(another.binding))).status,409);assert.deepEqual(await f.counts(),before);
});

test('status evidence waits sixty seconds and HTTP success with paidAmount never becomes capture or safe retry',async t=>{
  const f=await fixture(t),{order,binding}=await f.start();assert.equal((await f.receipt(order,createReceipt(binding))).status,200);
  const body={responseCode:'2002600',virtualAccountData:[notice(binding)],additionalInfo:{trxId:order.id,transactionStatus:'Pending'}},request={partnerServiceId:binding.partnerServiceId,customerNo:account.slice(5),virtualAccountNo:'   '+account};
  const input=evidence(binding,'bca-status',body,request);assert.equal((await f.receipt(order,input)).status,409);
  const later=Date.now()+120000;t.mock.method(Date,'now',()=>later);input.sentAt=input.observedAt=new Date(later).toISOString().replace(/\.\d{3}Z$/,'Z');
  const env={APP_ENVIRONMENT:'test',DB:f.db},result=await recordSnapPaymentReceipt(env,order.id,input);
  assert.equal(result.recorded,true);assert.equal(result.paymentConfirmed,false);assert.equal(result.settlementVerified,false);assert.equal(result.order.state,'pending');assert.equal((await f.counts()).commerce_payment_captures,0);
  const empty={...input,externalId:'9876',body:JSON.stringify({...body,virtualAccountData:[]})};assert.equal((await recordSnapPaymentReceipt(env,order.id,empty)).paymentConfirmed,false);
});

test('large signed provider receipts stay bounded and do not enlarge ordinary service routes',async t=>{
  const f=await fixture(t),{order,binding}=await f.start(),input=notification(binding),body=JSON.parse(input.body);body.additionalInfo.originalDetail='x'.repeat(70000);input.body=JSON.stringify(body);
  assert.equal((await f.receipt(order,input)).status,200);assert.equal((await f.call('/internal/commerce/orders/'+order.id+'/events',{...input})).status,413);
  body.additionalInfo.originalDetail='x'.repeat(262145);assert.equal((await f.receipt(order,{...input,body:JSON.stringify(body)})).status,422);
  assert.equal((await f.receipt(order,{...input,authorization:'Bearer never-accepted'})).status,422);
});

test('migration 0048 preserves populated legacy direct payments, orders, fees and journal rows',async t=>{
  const f=await setupCommerceFixture(t,{through:47}),r=await f.create(f.input());assert.equal(r.status,200,r.error);
  assert.equal((await f.event(r.order,'payment.created',f.session(r.order))).status,200);assert.equal((await f.paid(r.order)).status,200);
  const tables=(await f.db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '_cf_%' ORDER BY name").all()).results.map(r=>r.name);
  const before={};for(const table of tables)before[table]=(await f.db.prepare('SELECT * FROM '+table).all()).results;
  await applyCommerceSchema(f.db,47,48);
  for(const table of tables)assert.deepEqual((await f.db.prepare('SELECT * FROM '+table).all()).results,before[table],table);
  assert.deepEqual((await f.db.prepare('PRAGMA foreign_key_check').all()).results,[]);
  const replay=await f.paid(r.order);assert.equal(replay.status,200,replay.error);assert.equal(await f.stock(),8);
});
