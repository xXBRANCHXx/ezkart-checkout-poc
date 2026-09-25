import test from 'node:test';
import assert from 'node:assert/strict';
import {setupCommerceFixture} from './commerce-fixture.mjs';
import {cleanupAnalyticsExports} from '../src/commerce-analytics-exports.js';

const path='/v1/commerce/analytics';
const custom='range=custom&from=2026-01-15&to=2026-02-14';
async function seed(f,n,{at='2026-01-20T01:00:00.000Z',state='pending',amount=20000,paid=false,seconds=60,additional=false,seller='seller_alice',mode='sandbox',version=1,product='tea',quantity=1,title='Saved tea'}={}){
  const id='EZK-'+(mode==='sandbox'?'S':'P')+'-'+n.toString(16).toUpperCase().padStart(24,'0');
  await f.db.batch([
    f.db.prepare(`INSERT INTO orders(id,seller_id,commerce_version,commerce_environment,checkout_state,subtotal_amount,shipping_amount,total_amount,customer_snapshot_json,snapshot_json,created_at,updated_at)
      VALUES (?,?,?,?,?,?,0,?,?,'{"fees":{"plan":"standard"},"shipping":{"skipped":true},"checkout":{"paymentFlow":"hosted"}}',?,?)`)
      .bind(id,seller,version,mode,state,amount,amount,JSON.stringify({name:'Buyer '+n,email:'buyer'+n+'@example.test',phone:'private-phone',authUserId:'private-auth'}),at,at),
    f.db.prepare(`INSERT INTO order_items(id,seller_id,order_id,product_id,product_type,title,sku,quantity,unit_price_amount,fulfillment_snapshot_json,created_at)
      VALUES (?,?,?,?,'physical',?,'SAVED-SKU',?,?,'{"variantId":"","variantName":"Original option","weightGrams":100}',?)`)
      .bind('analytics_item_'+n,seller,id,product,title,quantity,amount/quantity,at),
  ]);
  if(paid)await capture(f,id,n,amount,mode,seller,new Date(Date.parse(at)+seconds*1000).toISOString());
  if(additional)await capture(f,id,'extra'+n,amount,mode,seller,at,'duplicate_payment');
  return id;
}
async function capture(f,id,n,amount=20000,mode='sandbox',seller='seller_alice',at='2026-01-20T01:01:00.000Z',kind='order_payment'){
  await f.db.prepare(`INSERT INTO commerce_payment_captures(id,seller_id,order_id,provider,commerce_environment,provider_reference,amount,currency,capture_kind,verified_at)
    VALUES (?,?,?,'doku',?, ?,?,'IDR',?,?)`).bind('analytics_capture_'+n,seller,id,mode,'reference_'+n,amount,kind,at).run();
}
const exportBody=(a,report='orders',requestKey='a'.repeat(32))=>({report,cohort:a.cohort,requestKey});
const create=(f,body)=>f.merchant(path+'/exports',body,{method:'POST'});

test('analytics enforces seller, environment, viewer and strict query boundaries',async t=>{
  const f=await setupCommerceFixture(t);
  await seed(f,1,{paid:true,state:'refunded',additional:true});await seed(f,2,{mode:'production',paid:true});
  await seed(f,3,{seller:'seller_bob',product:'private',paid:true});await seed(f,4,{version:0});await seed(f,5,{state:'paid'});
  assert.equal((await f.mf.dispatchFetch('https://api.fixture.test'+path)).status,401);
  const a=await f.merchant(path+'?'+custom);assert.equal(a.status,200,a.error);assert.equal(a.current.orders,2);assert.equal(a.current.paid,1);
  assert.equal(a.current.revenue,'20000');assert.equal(a.current.additional,'20000');assert.equal(a.current.status.REFUNDED,1);
  assert(!JSON.stringify(a).match(/private-phone|private-auth|reference_|snapshot_json/));
  assert.equal((await f.merchant(path+'?'+custom,undefined,{seller:'bob'})).current.orders,1);
  assert.equal((await f.merchant(path+'?cohort='+a.cohort,undefined,{seller:'bob'})).status,422);
  await f.db.prepare("UPDATE seller_memberships SET role='viewer' WHERE auth_user_id='alice'").run();
  assert.equal((await f.merchant(path+'?'+custom)).status,200);assert.equal((await create(f,exportBody(a))).status,200);
  assert.equal((await f.merchant(path,{}, {method:'POST'})).status,405);
  for(const q of ['seller=seller_bob','environment=production','range=7&range=30','group=hourly','range=custom&from=2026-02-30&to=2026-03-01',
    'range=custom&from=9998-01-01&to=9998-01-02','status=BOGUS','stage=delayed','table_page=-1','report=products&sort=rate','report=payments&status=PAID','cohort=abc'])
    assert.equal((await f.merchant(path+'?'+q)).status,422,q);
  const c=JSON.parse(Buffer.from(a.cohort,'base64url'));c.at=new Date(Date.now()-86401000).toISOString();
  assert.equal((await f.merchant(path+'?cohort='+Buffer.from(JSON.stringify(c)).toString('base64url'))).status,410);
});

test('full cohorts, partial-month comparisons, median payment timing and immutable variant values',async t=>{
  const f=await setupCommerceFixture(t);
  for(let n=1;n<=241;n++)await seed(f,n,{paid:n%2===0,state:n%2===0?'paid':'pending',seconds:n,quantity:2,amount:40000});
  // Previous period is Dec 15–Jan 14. Jan 1 aligns to Feb 1 by elapsed days.
  await seed(f,500,{at:'2025-12-14T16:59:59.999Z',paid:true});
  await seed(f,501,{at:'2025-12-14T17:00:00.000Z',paid:true});
  await seed(f,502,{at:'2025-12-31T17:00:00.000Z',paid:true});
  await seed(f,503,{at:'2026-02-14T16:59:59.999Z',paid:true,state:'paid',seconds:10});
  await seed(f,504,{at:'2026-02-14T17:00:00.000Z',paid:true});
  await f.db.prepare("UPDATE products SET title='Changed catalog',price_amount=90000 WHERE id='tea'").run();
  const a=await f.merchant(path+'?'+custom+'&group=monthly&report=products');assert.equal(a.status,200,a.error);
  assert.equal(a.current.orders,242);assert.equal(a.current.revenue,'4820000');assert.equal(a.previous.orders,2);assert.equal(a.previous.revenue,'40000');
  assert.equal(a.current.payment_time_samples,121);assert.equal(a.current.payment_seconds,120);
  assert.equal(a.buckets.length,2);assert.deepEqual(a.buckets.map(b=>b.current.revenue),['4800000','20000']);
  assert.deepEqual(a.buckets.map(b=>b.previous.revenue),['20000','20000']);
  assert.equal(a.table.rows[0].name,'Saved tea');assert.equal(a.table.rows[0].orders,242);assert.equal(a.table.rows[0].units,241);
  assert.equal(a.table.rows[0].revenue,'4820000');assert.equal(a.current.item_revenue,a.table.rows[0].revenue);
  const o=await f.merchant(path+'?'+custom+'&report=orders&table_page=99');assert.equal(o.table.page,13);assert.equal(o.table.rows.length,2);assert.equal(o.table.matching,242);
  const filtered=await f.merchant(path+'?'+custom+'&report=orders&q=original&status=PAID&stage=not-required&sort=total');
  assert.equal(filtered.table.matching,121);assert.equal(filtered.table.rows.length,20);assert.equal(filtered.current.orders,242);
  const first=await f.merchant(path+'?'+custom+'&report=orders');
  await seed(f,600,{paid:true});
  const next=await f.merchant(path+'?cohort='+first.cohort+'&report=orders&table_page=2');assert.equal(next.table.matching,242);
  assert(!next.table.rows.some(r=>first.table.rows.some(x=>x.order_id===r.order_id)));
  assert.equal((await f.merchant(path+'?cohort='+first.cohort+'&range=7')).status,422);
});

test('empty, invalid/future dates, yearly spans and exact integer money',async t=>{
  const f=await setupCommerceFixture(t),empty=await f.merchant(path+'?range=all');
  assert.equal(empty.current.orders,0);assert.equal(empty.current.aov,null);assert.equal(empty.current.payment_rate,null);assert.equal(empty.previous,null);
  await seed(f,1,{at:'invalid date'});await seed(f,2,{at:'2026-02-30T01:00:00.000Z'});await seed(f,3,{at:'2099-01-01T00:00:00.000Z'});
  const amount=Number.MAX_SAFE_INTEGER;await seed(f,4,{at:'1995-12-31T17:00:00.000Z',amount,paid:true});await seed(f,5,{amount:amount-1,paid:true});
  const a=await f.merchant(path+'?range=all&group=daily');assert.equal(a.status,200,a.error);
  assert.equal(a.undated,2);assert.equal(a.future,1);assert.equal(a.current.orders,2);assert.equal(a.period.group,'yearly');assert(a.buckets.length<100);
  const total=(2n*BigInt(amount)-1n).toString();assert.equal(a.current.revenue,total);assert.equal(a.current.item_revenue,total);assert.equal(a.current.aov,String(amount));
  assert.equal(a.buckets.reduce((n,b)=>n+BigInt(b.current.revenue),0n).toString(),total);
  const e=await create(f,exportBody(a,'overview'));assert.equal(e.status,200,e.error);
  const rows=(await f.merchant(path+'/exports/'+e.export.id)).rows;
  assert.deepEqual(rows.find(r=>r.cells[0]==='Gross verified payments (IDR)').cells,['Gross verified payments (IDR)',total,null]);
  assert.equal(rows.find(r=>r.cells[0]==='Average paid order (IDR)').cells[1],String(amount));
});

test('exports snapshot full reports, survive payment changes, replay safely and enforce immutable receipts',async t=>{
  const f=await setupCommerceFixture(t);for(let n=1;n<=41;n++)await seed(f,n,{paid:n===1,title:n===1?'=HYPERLINK("unsafe")':'Saved tea'});
  const a=await f.merchant(path+'?'+custom+'&report=orders&q=Buyer%201');assert(a.table.matching<41);
  const body=exportBody(a),responses=await Promise.all([create(f,body),create(f,body)]);
  for(const r of responses)assert.equal(r.status,200,r.error);assert.equal(responses[0].export.id,responses[1].export.id);
  const id=responses[0].export.id;assert.equal(responses[0].export.rowCount,41);
  assert.equal((await create(f,{...body,report:'revenue'})).status,409);
  assert.equal((await f.merchant(path+'/exports/'+id,undefined,{seller:'bob'})).status,404);
  const old=await f.merchant(path+'/exports/'+id+'?limit=7');assert.equal(old.rows.length,7);assert.equal(old.nextAfter,7);
  await capture(f,'EZK-S-'+(2).toString(16).toUpperCase().padStart(24,'0'),'later');
  let after=0,rows=[];do{const r=await f.merchant(path+'/exports/'+id+'?limit=7&after='+after);assert.equal(r.status,200,r.error);rows.push(...r.rows);after=r.nextAfter;}while(after!==null);
  assert.equal(rows.length,41);assert.equal(new Set(rows.map(r=>r.cells[0])).size,41);
  assert.equal(rows.filter(r=>r.cells[8]==='20000').length,1);assert.equal((await f.merchant(path+'?'+custom)).current.paid,2);
  assert.equal((await create(f,body)).replayed,true);
  for(const sql of ["UPDATE commerce_analytics_export_rows SET cells_json='[]'",'DELETE FROM commerce_analytics_export_rows',
    "UPDATE commerce_analytics_exports SET row_count=0",'DELETE FROM commerce_analytics_exports'])await assert.rejects(f.db.prepare(sql).run(),/analytics_export_/);
  for(const query of ['after=-1','after=42','limit=1001','after=1&after=2','seller=seller_bob'])assert.equal((await f.merchant(path+'/exports/'+id+'?'+query)).status,422);
  const revenue=await create(f,exportBody(a,'revenue','b'.repeat(32)));assert.equal(revenue.export.rowCount,2);
  const products=await create(f,exportBody(a,'products','c'.repeat(32)));assert.equal(products.export.rowCount,1);
  const payments=await create(f,exportBody(a,'payments','d'.repeat(32)));assert.equal(payments.export.rowCount,1);
});

test('export failures roll back atomically; expired snapshots clean up in bounded batches and new snapshots are rate limited',async t=>{
  const f=await setupCommerceFixture(t);await seed(f,1,{paid:true});const a=await f.merchant(path+'?'+custom);
  await f.db.prepare("CREATE TRIGGER reject_export_row BEFORE INSERT ON commerce_analytics_export_rows BEGIN SELECT RAISE(ABORT,'fixture_failure'); END").run();
  assert.equal((await create(f,exportBody(a))).status,500);assert.equal((await f.db.prepare('SELECT COUNT(*) AS n FROM commerce_analytics_exports').first()).n,0);
  await f.db.prepare('DROP TRIGGER reject_export_row').run();assert.equal((await create(f,exportBody(a))).status,200);
  const oldId='aex_'+'f'.repeat(40);
  await f.db.batch([
    f.db.prepare(`INSERT INTO commerce_analytics_exports(id,seller_id,commerce_environment,request_key,request_hash,report,period_json,created_at,expires_at)
      VALUES (?,'seller_alice','sandbox','old','old','orders','{}','2000-01-01T00:00:00.000Z','2000-01-02T00:00:00.000Z')`).bind(oldId),
    f.db.prepare("INSERT INTO commerce_analytics_export_rows VALUES (?,1,'[]')").bind(oldId),
    f.db.prepare("UPDATE commerce_analytics_exports SET state='ready',row_count=1 WHERE id=?").bind(oldId),
  ]);
  assert.equal((await f.merchant(path+'/exports/'+oldId)).status,410);await cleanupAnalyticsExports({DB:f.db});
  assert.equal((await f.merchant(path+'/exports/'+oldId)).status,404);
  for(let n=1;n<20;n++)assert.equal((await create(f,exportBody(a,'overview',n.toString(16).padStart(32,'0')))).status,200);
  assert.equal((await create(f,exportBody(a,'overview','e'.repeat(32)))).status,429);
  assert.equal((await create(f,exportBody(a))).status,200);
});

test('real provider session supplies method and verified timing without exposing account instructions',async t=>{
  const f=await setupCommerceFixture(t),o=(await f.create(f.input())).order;assert.equal((await f.event(o,'payment.created',f.session(o))).status,200);assert.equal((await f.paid(o)).status,200);
  const a=await f.merchant(path+'?report=payments');assert.equal(a.status,200,a.error);assert.equal(a.table.rows[0].name,'VIRTUAL_ACCOUNT_BCA');
  assert.equal(a.table.rows[0].paid,1);assert.equal(a.current.payment_time_samples,1);assert(!JSON.stringify(a).includes('accountNumber'));
  const orders=await f.merchant(path+'?report=orders&method=VIRTUAL_ACCOUNT_BCA');assert.equal(orders.table.matching,1);
});

test('multiple saved options count an order once per product and preserve an even-sample median',async t=>{
  const f=await setupCommerceFixture(t),id=await seed(f,1,{paid:true,state:'paid',seconds:10});
  await seed(f,2,{paid:true,state:'paid',seconds:30});
  await f.db.prepare(`INSERT INTO order_items(id,seller_id,order_id,product_id,product_type,title,sku,quantity,unit_price_amount,fulfillment_snapshot_json,created_at)
    VALUES ('another_option','seller_alice',?,'tea','physical','Saved tea','ANOTHER-OPTION',3,5000,'{"variantId":"","variantName":"Another saved option","weightGrams":100}','2026-01-20T01:00:00.000Z')`).bind(id).run();
  const a=await f.merchant(path+'?'+custom+'&report=products');assert.equal(a.status,200,a.error);
  assert.equal(a.table.rows[0].orders,2);assert.equal(a.table.rows[0].paid_orders,2);assert.equal(a.table.rows[0].units,5);
  assert.equal(a.table.rows[0].revenue,'55000');assert.equal(a.current.item_revenue,'55000');assert.equal(a.current.revenue,'40000');
  assert.equal(a.current.payment_seconds,20);assert.equal(a.current.payment_time_samples,2);
});
