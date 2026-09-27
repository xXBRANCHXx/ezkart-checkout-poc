import test from 'node:test';
import assert from 'node:assert/strict';
import {randomBytes} from 'node:crypto';
import {setupCommerceFixture} from './commerce-fixture.mjs';
import {refundEvidenceFixture} from './refund-evidence-fixture.mjs';
import {digitalFixtureFile} from './digital-commerce-fixture.mjs';
import {digitalPartBytes} from '../src/digital-files.js';
const fixture=async(t,options)=>refundEvidenceFixture(await setupCommerceFixture(t),options);

test('refund review distinguishes partial/native access from the verified original download and keeps each item separate',async t=>{
  const f=await fixture(t,{bytes:randomBytes(digitalPartBytes+7)}),prefix=await f.grant(),download=()=>f.view().then(r=>r.items.find(i=>i.orderItemId===f.digital.id).download);
  const native=await f.mf.dispatchFetch('https://api.fixture.test'+prefix+'/file',{headers:{authorization:'Bearer '+await f.merchantToken(f.buyer)}});assert.equal(native.status,200);await native.arrayBuffer();assert.equal((await download()).confirmedAt,null);
  await f.part(prefix,1);assert.equal((await download()).confirmedAt,null);await f.part(prefix,2);const complete=await download();assert(complete.confirmedAt);assert.equal(complete.version,1);assert.equal(complete.size,f.file.bytes.length);
  await digitalFixtureFile(f,{replace:true,bytes:Buffer.from('New unrelated edition')});await f.db.prepare("UPDATE products SET status='archived' WHERE id='guide'").run();assert.deepEqual(await download(),complete);
  const view=await f.view('alice');assert.equal(view.items.find(i=>i.title==='Second guide').download.confirmedAt,null);assert.equal(view.evidence.courierDeliveredAt,null);
  assert.equal(view.evidence.payment.amount,f.order.total);assert.equal(view.evidence.payment.currency,'IDR');assert(view.evidence.payment.confirmedAt);assert.equal(view.paymentConfirmed,false);
  assert(!JSON.stringify(view).match(/dgrant_|dupl_|dfile_|r2_key|auth_user|capture_id|bankReference/));
});

test('refund evidence shows only purchase-related returns and actual inspections without private warehouse data or a refund claim',async t=>{
  const f=await fixture(t),delivered=await f.deliver(),related=await f.openReturn(),unrelated=await f.openReturn([{orderItemId:f.mug.id,quantity:1}]);
  await f.returnAction(related,'approve');await f.returnAction(related,'inspect',{confirmed:true,privateNote:'Private warehouse bin 77',items:[{orderItemId:f.tea.id,received:1,restocked:0}]});
  const before=(await f.db.prepare('SELECT * FROM commerce_financial_entries ORDER BY journal_sequence,line_number').all()).results;
  for(const actor of [f.buyer,'alice']){const view=await f.view(actor);assert.equal(view.evidence.courierDeliveredAt,delivered);assert.equal(view.evidence.returns.length,1);assert.equal(view.evidence.returns[0].id,related);
    assert.deepEqual(view.evidence.returns[0].items,[{orderItemId:f.tea.id,quantity:2,received:1}]);assert.equal(view.evidence.returns[0].state,'receiving');assert.equal(view.evidence.moreReturns,false);
    assert(!JSON.stringify(view).includes(unrelated));assert(!JSON.stringify(view).includes('Private warehouse'));assert.equal(view.items.find(i=>i.orderItemId===f.digital.id).download.confirmedAt,null);assert.equal(view.paymentConfirmed,false);
  }
  assert.deepEqual((await f.db.prepare('SELECT * FROM commerce_financial_entries ORDER BY journal_sequence,line_number').all()).results,before);
  assert.equal((await f.merchant(f.path+'/'+f.refund.id,undefined,{seller:'other-buyer'})).status,404);assert.equal((await f.merchant('/v1/commerce/refunds/'+f.refund.id,undefined,{seller:'bob'})).status,404);
  await f.db.prepare("DELETE FROM seller_memberships WHERE auth_user_id='alice'").run();assert.equal((await f.merchant('/v1/commerce/refunds/'+f.refund.id)).status,403);
});

test('sandbox shipping skips and mutable order labels cannot create delivery evidence; review holds remain visible',async t=>{
  const f=await fixture(t,{skipped:true});await f.db.prepare("UPDATE orders SET fulfillment_state='delivered',fulfillment_review=1,payment_review=1 WHERE id=?").bind(f.order.id).run();
  const view=await f.view('alice');assert.equal(view.evidence.shippingSkipped,true);assert.equal(view.evidence.courierDeliveredAt,null);assert.equal(view.evidence.paymentReview,true);assert.equal(view.evidence.fulfillmentReview,true);assert.equal(view.canApprove,false);
  assert(view.items.filter(i=>i.type==='digital').every(i=>i.download.confirmedAt===null));
});

test('related-return evidence is bounded and explicitly reports omitted older cases',async t=>{
  const f=await fixture(t);await f.deliver();for(let n=0;n<21;n++){const id=await f.openReturn([{orderItemId:f.tea.id,quantity:1}]);await f.returnAction(id,'decline');}
  const view=await f.view();assert.equal(view.evidence.returns.length,20);assert.equal(view.evidence.moreReturns,true);assert.equal(new Set(view.evidence.returns.map(r=>r.id)).size,20);assert(view.evidence.returns.every(r=>r.state==='declined'&&r.items[0].received===0));
});
