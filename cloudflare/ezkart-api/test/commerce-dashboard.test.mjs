import test from 'node:test';
import assert from 'node:assert/strict';
import {setupCommerceFixture,fixtureShipping} from './commerce-fixture.mjs';

const path='/v1/commerce/dashboard',day=86400000;
const todayStart=()=>Date.parse(new Date(Date.now()+7*3600000).toISOString().slice(0,10)+'T00:00:00.000Z')-7*3600000;
async function seed(f,n,{at=todayStart()+3600000,state='pending',amount=20000,paid=false,additional=false,seller='seller_alice',mode='sandbox',version=1,product='tea',quantity=1,skipped=true}={}){
  const id='EZK-'+(mode==='sandbox'?'S':'P')+'-'+n.toString(16).toUpperCase().padStart(24,'0'),date=new Date(at).toISOString(),shipping=skipped?0:fixtureShipping.amount,total=amount+shipping;
  const statements=[f.db.prepare(`INSERT INTO orders(id,seller_id,commerce_version,commerce_environment,checkout_state,subtotal_amount,shipping_amount,total_amount,customer_snapshot_json,snapshot_json,created_at,updated_at)
    VALUES (?,?,?,?,?,?,?,?, ?,?,?,?)`).bind(id,seller,version,mode,state,amount,shipping,total,JSON.stringify({name:'Historical Buyer '+n,authUserId:'private-auth',phone:'secret-phone'}),JSON.stringify({fees:{plan:'standard'},shipping:skipped?{skipped,destination:{location:'Jakarta',address:'Private address'}}:fixtureShipping}),date,date),
  f.db.prepare(`INSERT INTO order_items(id,seller_id,order_id,product_id,product_type,title,sku,quantity,unit_price_amount,fulfillment_snapshot_json,created_at)
    VALUES (?,?,?,?,'physical',?,?,?,?,'{"variantId":"","variantName":"Saved option","weightGrams":100}',?)`).bind('report_item_'+id,seller,id,product,'Saved '+product,'SAVED-'+product,quantity,amount/quantity,date)];
  if(paid)statements.push(f.db.prepare(`INSERT INTO commerce_payment_captures(id,seller_id,order_id,provider,commerce_environment,provider_reference,amount,currency,capture_kind,verified_at)
    VALUES (?,?,?,'doku',?, ?,?,'IDR','order_payment',?)`).bind('report_capture_'+id,seller,id,mode,'reference_'+id,total,date));
  if(additional)statements.push(f.db.prepare(`INSERT INTO commerce_payment_captures(id,seller_id,order_id,provider,commerce_environment,provider_reference,amount,currency,capture_kind,verified_at)
    VALUES (?,?,?,'doku',?, ?,?,'IDR','duplicate_payment',?)`).bind('additional_capture_'+id,seller,id,mode,'additional_'+id,total,date));
  await f.db.batch(statements);return id;
}

test('dashboard authenticates read-only merchants and rejects invalid scope, duplicate parameters and unknown grouping',async t=>{
  const f=await setupCommerceFixture(t);
  await seed(f,1,{paid:true,state:'paid'});await seed(f,2,{mode:'production',paid:true,state:'paid'});
  await seed(f,3,{seller:'seller_bob',product:'private',paid:true,state:'paid'});await seed(f,4,{version:0});
  assert.equal((await f.mf.dispatchFetch('https://api.fixture.test'+path)).status,401);
  const a=await f.merchant(path);assert.equal(a.status,200,a.error);assert.equal(a.summary.orders,1);assert.equal(a.operations.total,1);assert.equal(a.summary.confirmedAmount,'20000');
  const b=await f.merchant(path,undefined,{seller:'bob'});assert.equal(b.summary.orders,1);assert.equal(b.recent[0].customerName,'Historical Buyer 3');
  await f.db.prepare("UPDATE seller_memberships SET role='viewer' WHERE auth_user_id='alice'").run();assert.equal((await f.merchant(path)).status,200);
  assert.equal((await f.merchant(path,{}, {method:'POST'})).status,405);
  for(const query of ['seller=seller_bob','environment=production','range=365','range=7&range=30','group=hourly','q=test'])assert.equal((await f.merchant(path+'?'+query)).status,422,query);
  assert(!JSON.stringify(a).match(/private-auth|secret-phone|Private address|reference_|snapshot_json/));
});

test('dashboard counts all records beyond 200 and separates paid, duplicate, unpaid and all-date operations',async t=>{
  const f=await setupCommerceFixture(t),counts={creating:0,pending:0,paid:0,failed:0,expired:0,cancelled:0,partially_refunded:0,refunded:0};
  let paid=0,paidAmount=0,paidUnits=0,totalUnits=0;
  for(let n=0;n<240;n++){
    const state=Object.keys(counts)[n%8],hasPayment=['paid','partially_refunded','refunded'].includes(state),quantity=n%2+1,amount=quantity*20000;
    await seed(f,n,{state,paid:hasPayment,amount,quantity,product:n%2?'mug':'tea',additional:n===2});counts[state]++;totalUnits+=quantity;
    if(hasPayment){paid++;paidAmount+=amount;paidUnits+=quantity;}
  }
  await seed(f,999,{at:todayStart()-100*day,paid:true,state:'paid',skipped:false});
  await f.db.prepare("UPDATE products SET title='Renamed catalog product',price_amount=90000 WHERE id='tea'").run();
  const a=await f.merchant(path+'?range=30');assert.equal(a.status,200,a.error);
  assert.equal(a.summary.orders,240);assert.equal(a.operations.total,241);assert.equal(a.summary.paidOrders,paid);assert.equal(a.summary.confirmedAmount,String(paidAmount));assert.equal(a.summary.additionalAmount,'20000');
  assert.equal(a.summary.paidUnits,paidUnits);assert.equal(a.summary.orderedUnits,totalUnits);assert.deepEqual(a.statuses,counts);
  assert.equal(a.chart.buckets.length,30);assert.equal(a.chart.buckets.reduce((n,b)=>n+BigInt(b.amount),0n),BigInt(paidAmount));
  assert.equal(a.recent.length,5);assert.deepEqual(a.topProducts.map(p=>p.title).sort(),['Saved mug','Saved tea']);assert.equal(a.topProducts.reduce((n,p)=>n+Number(p.amount),0),paidAmount);
  assert.equal(a.catalogActivity.reduce((n,p)=>n+p.quantity,0),totalUnits);assert.equal(a.operations.queues['needs-processing'],1);
  assert.equal((await f.merchant(path+'?range=all')).summary.orders,241);
});

test('Jakarta boundaries and bounded weekly, monthly and yearly charts retain the full reporting cohort',async t=>{
  const f=await setupCommerceFixture(t),start=todayStart()-6*day;
  await seed(f,1,{at:start-1,paid:true,state:'paid'});await seed(f,2,{at:start,paid:true,state:'paid'});
  await seed(f,3,{at:todayStart()+day-1,paid:true,state:'paid'});await seed(f,4,{at:todayStart()+day,paid:true,state:'paid'});
  for(const group of ['daily','weekly','monthly','yearly']){
    const a=await f.merchant(path+'?range=7&group='+group);assert.equal(a.status,200,a.error);assert.equal(a.summary.orders,2);assert.equal(a.summary.confirmedAmount,'40000');
    assert.equal(a.chart.buckets.reduce((n,b)=>n+BigInt(b.amount),0n),40000n);assert(a.chart.buckets.length<=7);
    if(group==='weekly')assert(a.chart.buckets.every(b=>new Date(b.date+'T00:00:00Z').getUTCDay()===1));
  }
  await seed(f,5,{at:Date.parse('1995-12-31T17:00:00.000Z'),paid:true,state:'paid'});
  const all=await f.merchant(path+'?range=all&group=daily');assert.equal(all.chart.group,'yearly');assert(all.chart.buckets.length<100);assert.equal(all.chart.buckets[0].date,'1996-01-01');
  assert.equal(all.summary.orders,4);assert.equal(all.chart.buckets.reduce((n,b)=>n+BigInt(b.amount),0n),80000n);
});

test('gross amounts and averages stay exact and a paid label without a verified capture contributes no confirmed money',async t=>{
  const f=await setupCommerceFixture(t),amount=Number.MAX_SAFE_INTEGER;
  await seed(f,1,{amount,paid:true,state:'paid',additional:true});await seed(f,2,{amount:amount-1,paid:true,state:'refunded'});await seed(f,3,{state:'paid'});
  const a=await f.merchant(path);assert.equal(a.status,200,a.error);const total=BigInt(amount)*2n-1n;
  assert.equal(a.summary.orders,3);assert.equal(a.summary.paidOrders,2);assert.equal(a.summary.confirmedAmount,total.toString());assert.equal(a.summary.averageAmount,String(amount));
  assert.equal(a.summary.additionalAmount,String(amount));assert.equal(a.summary.productAmount,total.toString());assert.equal(a.topProducts[0].amount,total.toString());assert.equal(a.chart.buckets.at(-1).amount,total.toString());
});

test('real payment and merchant acceptance update dashboard queues without additional stock or provider work',async t=>{
  const f=await setupCommerceFixture(t),o=(await f.create(f.input({shipping:fixtureShipping}))).order;
  assert.equal((await f.paid(o)).status,200);const stock=await f.stock();
  let a=await f.merchant(path);assert.equal(a.operations.queues['needs-processing'],1);assert.equal(a.summary.shippingAmount,'18000');assert.equal(a.summary.productAmount,'40000');
  const order=await f.merchant('/v1/fulfillment/'+o.id);assert.equal((await f.merchant('/v1/fulfillment/'+o.id,{kind:'accept',revision:order.order.revision,requestKey:'d'.repeat(32)},{method:'POST'})).status,200);
  a=await f.merchant(path);assert.equal(a.operations.queues.processing,1);assert.equal(a.operations.queues.attention,0);assert.equal(a.summary.bookedOrders,0);assert.equal(await f.stock(),stock);
  const first=await f.merchant('/v1/commerce/orders');assert.equal(first.queues.processing,a.operations.queues.processing);assert.equal(first.summary.confirmedAmount,a.summary.confirmedAmount);
});
