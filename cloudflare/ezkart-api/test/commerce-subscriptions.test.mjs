import test from 'node:test';
import assert from 'node:assert/strict';
import {randomBytes} from 'node:crypto';
import {setupCommerceFixture} from './commerce-fixture.mjs';
import {customerSubscriptions,prepareSubscriptionPeriod,reconcileSubscriptionPayment,subscriptionDetail,cancelSubscription,periodEnd,dispatchSubscriptionCharge} from '../src/commerce-subscriptions.js';
import {flexibillBatchNotify,flexibillReportNotice} from '../src/doku-flexibill.js';
const owner={id:'buyer-subscription',email:'buyer@example.test'},actor={kind:'customer',id:owner.id},path='/internal/commerce/customer-subscriptions';
const input=(action,fields={})=>({environment:'sandbox',customer:owner,action,...fields});
async function fixture(t){
 const f=await setupCommerceFixture(t);const env={DB:f.db,APP_ENVIRONMENT:'test'};
 await f.db.prepare("INSERT INTO products(id,seller_id,type,status,title,price_amount,created_at,updated_at) VALUES('membership','seller_alice','subscription','active','Membership',12000,'now','now')").run();
 await f.db.prepare("INSERT INTO product_variants(id,seller_id,product_id,name,sku,price_amount,billing_interval,billing_interval_count,sort_order,created_at,updated_at) VALUES('monthly','seller_alice','membership','Monthly','MEM-1',12000,'month',1,1,'now','now')").run();
 const plan={sellerId:'seller_alice',productId:'membership',variantId:'monthly'},offer=await f.call(path,input('quote',plan));assert.equal(offer.status,200,offer.error);
 const request=input('enroll',{...plan,termsHash:offer.termsHash,statement:offer.statement,consentVersion:offer.consentVersion,consent:true,requestKey:randomBytes(16).toString('hex')});
 const enroll=()=>f.call(path,request);
 async function enableEvidenceFixture(){
  await f.db.prepare('DROP VIEW commerce_subscription_payment_sources').run();
  await f.db.prepare('CREATE TABLE commerce_subscription_payment_sources(evidence_id TEXT PRIMARY KEY,period_id TEXT,charge_reference TEXT,seller_id TEXT,commerce_environment TEXT,amount INTEGER,currency TEXT,result TEXT,paid_at TEXT,dispatched_at TEXT)').run();
 }
 async function proof(p,result='paid',paidAt=new Date(Date.now()-5000).toISOString(),patch={}){
  const e={evidence_id:'evidence_'+randomBytes(8).toString('hex'),period_id:p.id,charge_reference:p.charge_reference,seller_id:'seller_alice',commerce_environment:'sandbox',amount:p.amount,currency:'IDR',result,paid_at:result==='paid'?paidAt:null,dispatched_at:p.created_at,...patch};
  await f.db.prepare(`INSERT INTO commerce_subscription_payment_sources(${Object.keys(e).join(',')}) VALUES(${Object.keys(e).map(()=>'?').join(',')})`).bind(...Object.values(e)).run();return e.evidence_id;
 }
 return {...f,env,request,enroll,proof,enableEvidenceFixture};
}
test('explicit consent, frozen terms, idempotency and ownership; no BCA substitution',async t=>{
 const f=await fixture(t);assert.equal((await f.call(path,{...f.request,consent:false})).status,422);
 assert.equal((await f.call(path,{...f.request,termsHash:'changed'})).status,409);
 const first=await f.enroll();assert.equal(first.status,200,first.error);const id=first.subscription.id;
 assert.equal(first.subscription.state,'awaiting_provider');assert.equal(first.subscription.access.allowed,false);
 assert.equal((await f.enroll()).replayed,true);
 assert.equal((await f.call(path,{...f.request,statement:'changed'})).status,409);
 assert.equal((await f.call(path,{...input('detail',{id}),customer:{...owner,id:'stranger'}})).status,404);
 assert.equal((await f.merchant('/v1/commerce/subscriptions/'+id,undefined,{seller:'bob'})).status,404);
 assert.equal((await f.merchant(path,f.request,{method:'POST'})).status,401);
 await f.db.prepare("UPDATE product_variants SET price_amount=50000 WHERE id='monthly'").run();
 assert.equal((await f.enroll()).subscription.terms.amount,12000);
 await assert.rejects(f.db.prepare("UPDATE commerce_subscriptions SET terms_json='{}'").run(),/subscription_terms_immutable/);
 const order=await f.create(f.input({items:[{productId:'membership',variantId:'monthly',quantity:1,expectedPrice:50000}],shipping:{kind:'none',amount:0,skipped:false}}));assert.equal(order.status,409);
 assert.equal((await f.db.prepare('SELECT COUNT(*) n FROM orders').first()).n,0);
 await assert.rejects(dispatchSubscriptionCharge(),e=>e.status===409);
 await assert.rejects(reconcileSubscriptionPayment(f.env,'browser-return'),e=>e.status===409);
});
test('unique periods, failed to paid activation, late outcomes and month-end anchored renewal',async t=>{
 const f=await fixture(t),made=await f.enroll(),id=made.subscription.id;await f.enableEvidenceFixture();
 const clock='2026-01-31T12:00:00.000Z';
 const both=await Promise.all([prepareSubscriptionPeriod(f.env,id,clock),prepareSubscriptionPeriod(f.env,id,clock)]);assert.equal(both[0].id,both[1].id);const p=both[0];
 const failed=await f.proof(p,'failed');await reconcileSubscriptionPayment(f.env,failed);assert.equal((await subscriptionDetail(f.env,actor,id)).subscription.state,'past_due');
 const success=await f.proof(p,'paid',clock);await reconcileSubscriptionPayment(f.env,success);await reconcileSubscriptionPayment(f.env,success);
 const initial=await subscriptionDetail(f.env,actor,id);assert.equal(initial.subscription.periods[0].endsAt,'2026-02-28T12:00:00.000Z');assert.equal(initial.subscription.access.allowed,false,'Historical paid access expires without relying on a cron');
 const next=await prepareSubscriptionPeriod(f.env,id,'2026-02-28T12:00:00.000Z');assert.equal(next.period_number,1);assert.equal(next.ends_at,'2026-03-31T12:00:00.000Z');
 await reconcileSubscriptionPayment(f.env,await f.proof(next,'paid','2026-03-02T12:00:00.000Z'));assert.equal((await subscriptionDetail(f.env,actor,id)).subscription.periods[0].startsAt,'2026-02-28T12:00:00.000Z');
 await reconcileSubscriptionPayment(f.env,await f.proof(next,'failed'));
 assert.equal((await f.db.prepare("SELECT COUNT(*) n FROM commerce_subscription_outcomes WHERE period_id=? AND result='paid'").bind(next.id).first()).n,1);
 assert.equal(periodEnd('2024-02-29T10:00:00.000Z',4,'year',1),'2028-02-29T10:00:00.000Z');
});
test('active access is evidence bound and cancellation stops future periods but preserves paid time',async t=>{
 const f=await fixture(t),id=(await f.enroll()).subscription.id;await f.enableEvidenceFixture();
 const now=new Date(Date.now()-10000).toISOString(),p=await prepareSubscriptionPeriod(f.env,id,now);
 await assert.rejects(reconcileSubscriptionPayment(f.env,await f.proof(p,'paid',now,{amount:p.amount+1})),e=>e.status===409);
 for(const patch of [{paid_at:new Date(Date.parse(now)-1000).toISOString()},{dispatched_at:'bad-time'},{dispatched_at:new Date(Date.now()+60000).toISOString()}])await assert.rejects(reconcileSubscriptionPayment(f.env,await f.proof(p,'paid',now,patch)),e=>e.status===409);
 await reconcileSubscriptionPayment(f.env,await f.proof(p,'paid',now));
 assert.equal((await subscriptionDetail(f.env,actor,id)).subscription.access.allowed,true);
 const cancelled=await cancelSubscription(f.env,actor,id,{confirm:true});assert.equal(cancelled.subscription.state,'cancelled');assert.equal(cancelled.subscription.access.allowed,true);
 await assert.rejects(prepareSubscriptionPeriod(f.env,id,'2027-01-01T00:00:00.000Z'),e=>e.status===409);
 assert.equal((await cancelSubscription(f.env,actor,id,{confirm:true})).subscription.cancelledAt,cancelled.subscription.cancelledAt);
 await assert.rejects(cancelSubscription(f.env,{kind:'merchant',id:'seller_alice',role:'viewer'},id,{confirm:true}),e=>e.status===403);
 await assert.rejects(f.db.prepare('DELETE FROM commerce_subscription_outcomes').run(),/immutable/);
});
test('cancel-vs-prepare race is checked inside the write; undispatched late success cannot activate',async t=>{
 const f=await fixture(t),id=(await f.enroll()).subscription.id;await f.enableEvidenceFixture();
 const db={prepare(sql){const statement=f.db.prepare(sql);return {bind(...values){const bound=statement.bind(...values);if(sql.startsWith('INSERT INTO commerce_subscription_periods'))return {async run(){await cancelSubscription(f.env,actor,id,{confirm:true});return bound.run();}};return bound;}};}};
 await assert.rejects(prepareSubscriptionPeriod({...f.env,DB:db},id),e=>e.status===409);
 assert.equal((await f.db.prepare('SELECT COUNT(*) n FROM commerce_subscription_periods').first()).n,0);
 const next=await f.call(path,{...f.request,requestKey:randomBytes(16).toString('hex')}),id2=next.subscription.id,p=await prepareSubscriptionPeriod(f.env,id2,new Date(Date.now()-10000).toISOString());
 await cancelSubscription(f.env,actor,id2,{confirm:true});const proof=await f.proof(p,'paid',new Date(Date.now()-1000).toISOString(),{dispatched_at:new Date(Date.now()+1000).toISOString()});
 await assert.rejects(reconcileSubscriptionPayment(f.env,proof),e=>e.status===409);
 assert.equal((await subscriptionDetail(f.env,actor,id2)).subscription.access.allowed,false);
});
test('FlexiBill report-ready notice is never a paid outcome',()=>{
 assert.deepEqual(flexibillBatchNotify('TKN_202609ABC.TXT'),{method:'POST',path:'/batch-upload/v1/notify',body:{file_name:'TKN_202609ABC.TXT'}});
 assert.throws(()=>flexibillBatchNotify('../TKN.TXT'));
 const report=flexibillReportNotice({service:{id:'BATCH_UPLOAD'},batch_file:{name:'TKN_202609ABC.TXT',status:'DONE',date:'2026-09-28T01:00:00Z'}});assert.equal(report.paymentConfirmed,false);
});
