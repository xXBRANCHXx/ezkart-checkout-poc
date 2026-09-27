import test from 'node:test';
import assert from 'node:assert/strict';
import {refundCostRange} from '../src/commerce-refund-costs.js';
import {setupRefundProcessingFixture} from './refund-processing-fixture.mjs';

test('refund costs retain the original admin/payment fees and never invent a new provider charge or payer',()=>{
  const p=refundCostRange({subtotal:100000,commission:5000,admin:1250,productRefund:40000,shippingRefund:10000,originalProcessingFee:2500});
  assert.equal(p.buyerRefund,'50000');assert.deepEqual(p.commissionReversal,{minimum:'2000',maximum:'2000'});
  assert.deepEqual(p.sellerProductDeduction,{minimum:'38000',maximum:'38000'});assert.equal(p.retainedAdminFee,'1250');assert.equal(p.originalProcessingFee,'2500');
  assert.equal(p.actualRefundFee,null);assert.equal(p.refundFeePayer,null);assert.equal(p.refundFeePolicy,'current_funds_holder');assert.equal(p.ledgerPosted,false);assert.equal(p.paymentConfirmed,false);
});

test('proportional rounding bounds every cumulative partial refund, returns full original commission, and excludes shipping',()=>{
  const round=(n,d)=>(n*2n+d)/(2n*d);
  for(const subtotal of [1n,19n,101n,999n])for(const rate of [500n,600n]){
    const fee=round(subtotal*rate,10000n);
    for(let part=0n;part<=subtotal;part+=subtotal>100n?17n:1n){
      const result=refundCostRange({subtotal,commission:fee,admin:1250,productRefund:part,shippingRefund:0});
      for(let previous=0n;previous+part<=subtotal;previous+=subtotal>100n?13n:1n){
        const actual=round((previous+part)*fee,subtotal)-round(previous*fee,subtotal);
        assert(actual>=BigInt(result.commissionReversal.minimum)&&actual<=BigInt(result.commissionReversal.maximum));
      }
    }
    assert.equal(refundCostRange({subtotal,commission:fee,admin:1250,productRefund:subtotal,shippingRefund:0}).commissionReversal.minimum,String(fee));
  }
  assert.deepEqual(refundCostRange({subtotal:100,commission:5,admin:1250,productRefund:0,shippingRefund:25000}).commissionReversal,{minimum:'0',maximum:'0'});
  assert.deepEqual(refundCostRange({subtotal:100000000000,commission:6000000000,admin:1250,productRefund:100000000000,shippingRefund:0}).commissionReversal,{minimum:'6000000000',maximum:'6000000000'});
});

test('refund costs reject malformed and excessive original allocations',()=>{
  const input={subtotal:10000,commission:500,admin:1250,productRefund:1000,shippingRefund:0};
  for(const change of [{subtotal:0},{productRefund:10001},{commission:10001},{admin:0},{productRefund:1.5},{shippingRefund:-1},{originalProcessingFee:'1e3'},{subtotal:100000000001}])assert.throws(()=>refundCostRange({...input,...change}),TypeError);
});

test('refund views use the original captured fee policy, keep costs private from buyers, and leave the ledger unchanged',async t=>{
  const f=await setupRefundProcessingFixture(t),before=(await f.db.prepare('SELECT * FROM commerce_financial_entries').all()).results;
  const store=await f.view('alice'),staff=await f.view('bob');assert.equal(store.processing.costs.buyerRefund,'10000');assert.deepEqual(store.processing.costs,staff.processing.costs);
  assert.equal(store.processing.costs.originalProcessingFee,'2500');assert.equal(store.processing.costs.retainedAdminFee,'1250');assert.equal((await f.view()).processing.costs,undefined);
  await f.db.prepare("UPDATE sellers SET plan='advanced' WHERE id='seller_alice'").run();assert.deepEqual((await f.view('alice')).processing.costs,store.processing.costs);
  assert.deepEqual((await f.db.prepare('SELECT * FROM commerce_financial_entries').all()).results,before);
});
