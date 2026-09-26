import test from 'node:test';
import assert from 'node:assert/strict';
import {randomBytes} from 'node:crypto';
import {setupCommerceFixture,fixtureShipping} from './commerce-fixture.mjs';
import {applyCommerceSchema} from './commerce-schema.mjs';

const base='/internal/commerce/finance',key=()=>randomBytes(16).toString('hex');
const summary=(f,seller='seller_alice')=>f.call(base+'/summary?seller='+seller+'&environment=sandbox');
const list=(f,query='')=>f.call(base+'/journals?seller=seller_alice&environment=sandbox'+query);
const count=async(f,table)=>(await f.db.prepare('SELECT COUNT(*) AS n FROM '+table).first()).n;
async function order(f,extra={}){const made=await f.create(f.input(extra));assert.equal(made.status,200,made.error);return made.order;}
function balanced(journal){assert.equal(journal.entries.reduce((sum,line)=>sum+BigInt(line.amount),0n),0n);}
async function seed(f,n,{fees={plan:'standard'},mode='sandbox',seller='seller_alice',amount=40000,kind='order_payment'}={}){
  const id='EZK-'+(mode==='sandbox'?'S':'P')+'-'+n.toString(16).padStart(24,'0').toUpperCase();
  await f.db.prepare(`INSERT INTO orders(id,seller_id,status,currency,subtotal_amount,shipping_amount,total_amount,created_at,updated_at,commerce_version,commerce_environment,checkout_state,snapshot_json)
    VALUES(?,?,'paid','IDR',?,0,?,'2026-01-01T00:00:00.000Z','2026-01-01T00:00:00.000Z',1,?,'paid',?)`).bind(id,seller,amount,amount,mode,JSON.stringify({fees})).run();
  await f.db.prepare(`INSERT INTO commerce_payment_captures(id,seller_id,order_id,provider,commerce_environment,provider_reference,amount,currency,capture_kind,verified_at)
    VALUES(?,?,?,'doku',?,?,?,'IDR',?,'2026-01-02T00:00:00.000Z')`).bind('capture_seed_'+n,seller,id,mode,'seed-'+n,amount,kind).run();
  return id;
}

test('verified captures atomically post original fees while retries and additional payments never duplicate seller allocations',async t=>{
  const f=await setupCommerceFixture(t),o=await order(f);await f.db.prepare("UPDATE sellers SET plan='advanced' WHERE id='seller_alice'").run();
  const input={provider:'doku',verified:true,amount:o.total,currency:'IDR',reference:'original-payment',originalRequestId:o.paymentRequestId,channel:'VIRTUAL_ACCOUNT_BCA',accountNumber:'770011223344',estimatedFee:4750,actualFee:4750};
  assert.equal((await f.event(o,'payment.succeeded',input,'same-callback')).status,200);
  const first=await list(f);assert.equal(first.items.length,1);balanced(first.items[0]);assert.equal(first.items[0].source.fees.plan,'standard');
  const lines=Object.fromEntries(first.items[0].entries.map(line=>[line.account,line.amount]));assert.deepEqual(lines,{provider_receivable:'40000',seller_pending:'-36750',platform_commission_pending:'-2000',platform_admin_pending:'-1250'});
  assert.equal((await f.event(o,'payment.succeeded',input,'same-callback')).status,200);assert.equal((await f.event(o,'payment.succeeded',input,'another-callback')).status,200);assert.equal(await count(f,'commerce_financial_journals'),1);
  assert.equal((await f.paid(o,{reference:'extra-payment'})).status,200);const extra=(await list(f)).items[0];assert.equal(extra.allocationState,'duplicate');balanced(extra);assert.deepEqual(extra.entries.map(line=>line.account),['provider_receivable','unallocated_receipts']);
  const s=await summary(f);assert.equal(s.status,200,s.error);assert.equal(s.capturedGross,'80000');assert.equal(s.accounts.seller_pending,'-36750');assert.equal(s.accounts.unallocated_receipts,'-40000');assert.equal(s.additionalPayments,1);assert.equal(s.accountingComplete,true);assert.equal(s.availableToWithdraw,null);assert.equal(s.settlementConnected,false);
  const newer=await order(f,{shipping:fixtureShipping,items:[{productId:'tea',quantity:2,expectedPrice:20000,expectedWeightGrams:100}]});await f.paid(newer);const advanced=(await list(f)).items[0];balanced(advanced);assert.equal(advanced.source.fees.commissionAmount,2400);assert.equal(advanced.source.grossAmount,58000);assert.equal(advanced.entries.find(line=>line.account==='shipping_reserve').amount,'-18000');assert.equal(advanced.entries.find(line=>line.account==='seller_pending').amount,'-36350');
});

test('journal money remains exact at rounding and size boundaries and never clips a seller shortfall to zero',async t=>{
  const f=await setupCommerceFixture(t);await f.product('rounding',10,'seller_alice',10010);await f.product('small',10,'seller_alice',1000);await f.product('large',100,'seller_alice',1000000000);
  for(const [productId,quantity,price,expected] of [['rounding',1,10010,8259],['small',1,1000,-300],['large',100,1000000000,94999998750]]){
    const o=await order(f,{items:[{productId,quantity,expectedPrice:price,expectedWeightGrams:100}]});assert.equal((await f.paid(o)).status,200);const journal=(await list(f)).items[0];balanced(journal);assert.equal(journal.entries.find(line=>line.account==='seller_pending').amount,String(-expected));
  }
  const s=await summary(f);assert.equal(s.capturedGross,'100000011010');assert.equal(typeof s.accounts.provider_receivable,'string');assert.equal(s.availableToWithdraw,null);
  await seed(f,500,{amount:Number.MAX_SAFE_INTEGER});await seed(f,501,{amount:Number.MAX_SAFE_INTEGER-1});
  const combined=await summary(f),expected=(100000011010n+2n*BigInt(Number.MAX_SAFE_INTEGER)-1n).toString();assert.equal(combined.capturedGross,expected);assert.equal(combined.accounts.provider_receivable,expected);assert.equal(combined.accounts.unallocated_receipts,String(-(2n*BigInt(Number.MAX_SAFE_INTEGER)-1n)));(await list(f)).items.forEach(balanced);
});

test('missing, tampered and unknown fee policies remain unallocated without rejecting actual payment evidence',async t=>{
  const f=await setupCommerceFixture(t),template=(await order(f)).snapshot.fees;
  const policies=[{plan:'standard'}, {...template,version:2},{...template,commissionAmount:'2000'},{...template,commissionAmount:1},{...template,adminAmount:0},{...template,processingFeePolicy:'estimated'}];
  for(let n=0;n<policies.length;n++)await seed(f,n+1,{fees:policies[n]});
  const journals=(await list(f)).items;assert.equal(journals.length,policies.length);for(const journal of journals){assert.equal(journal.allocationState,'unallocated');balanced(journal);assert.deepEqual(journal.entries.map(line=>line.account),['provider_receivable','unallocated_receipts']);}
  const s=await summary(f);assert.equal(s.unallocated,6);assert.equal(s.accounts.unallocated_receipts,'-240000');assert.equal(s.accounts.seller_pending,undefined);assert.equal(s.availableToWithdraw,null);
});

test('concurrent payment callbacks produce one allocated capture and one separately held additional receipt',async t=>{
  const f=await setupCommerceFixture(t),o=await order(f),result=await Promise.all([f.paid(o,{reference:'race-a'}),f.paid(o,{reference:'race-b'})]);
  assert.deepEqual(result.map(r=>r.status),[200,200]);const journals=(await list(f)).items;assert.equal(journals.length,2);assert.equal(journals.filter(j=>j.allocationState==='allocated').length,1);assert.equal(journals.filter(j=>j.allocationState==='duplicate').length,1);journals.forEach(balanced);
  assert.equal((await summary(f)).accounts.seller_pending,'-36750');
});

test('financial posting failures roll back payment, inventory, capture and order-event writes together',async t=>{
  const f=await setupCommerceFixture(t),o=await order(f),callback=key(),eventsBefore=await count(f,'commerce_order_events');
  await f.db.prepare("CREATE TRIGGER fail_financial BEFORE INSERT ON commerce_financial_entries WHEN NEW.account='seller_pending' BEGIN SELECT RAISE(ABORT,'test_financial_failure'); END").run();
  const failed=await f.paid(o,{},callback);assert.equal(failed.status,500);assert.equal(await count(f,'commerce_financial_journals'),0);assert.equal(await count(f,'commerce_payment_captures'),0);assert.equal(await count(f,'commerce_order_events'),eventsBefore);assert.equal(await f.stock(),10);
  assert.equal((await f.call('/internal/commerce/orders/'+o.id+'?environment=sandbox')).order.state,'creating');
  await f.db.prepare('DROP TRIGGER fail_financial').run();assert.equal((await f.paid(o,{},callback)).status,200);assert.equal(await f.stock(),8);assert.equal(await count(f,'commerce_financial_journals'),1);assert.equal((await summary(f)).balanced,true);
});

test('journal and entry guards reject altered, unbalanced, foreign and deleted accounting evidence',async t=>{
  const f=await setupCommerceFixture(t),o=await order(f);await f.paid(o);const row=await f.db.prepare('SELECT * FROM commerce_financial_journals').first();
  for(const sql of ['UPDATE commerce_financial_journals SET posted_at=\'changed\'','DELETE FROM commerce_financial_journals','UPDATE commerce_financial_entries SET amount=amount+1','DELETE FROM commerce_financial_entries','DELETE FROM commerce_payment_captures',"UPDATE commerce_financial_accounts SET normal_side='debit'",'DELETE FROM commerce_financial_accounts'])await assert.rejects(f.db.prepare(sql).run(),/immutable/);
  await assert.rejects(f.db.prepare("INSERT OR REPLACE INTO commerce_financial_accounts VALUES('unallocated_receipts','expense','debit')").run(),/financial_account_immutable/);
  await assert.rejects(f.db.prepare('INSERT OR REPLACE INTO commerce_financial_entries SELECT * FROM commerce_financial_entries LIMIT 1').run(),/financial_entry_immutable/);
  await assert.rejects(f.db.prepare('INSERT OR REPLACE INTO commerce_financial_journals SELECT * FROM commerce_financial_journals LIMIT 1').run(),/financial_journal_immutable/);
  await assert.rejects(f.db.prepare('INSERT INTO commerce_financial_entries(journal_sequence,line_number,account,amount) VALUES(?,8,\'seller_pending\',-1)').bind(row.sequence).run(),/financial_entry_mismatch/);
  const write=changes=>{const r={...row,...changes};return f.db.prepare(`INSERT INTO commerce_financial_journals(id,seller_id,order_id,capture_id,commerce_environment,currency,kind,allocation_state,source_json,lines_json,occurred_at,posted_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)`).bind(...['id','seller_id','order_id','capture_id','commerce_environment','currency','kind','allocation_state','source_json','lines_json','occurred_at','posted_at'].map(k=>r[k])).run();};
  for(const changes of [{seller_id:'seller_bob'},{commerce_environment:'production'},{kind:'settlement'},{source_json:'{}'},{lines_json:'[{"account":"provider_receivable","amount":40000},{"account":"seller_pending","amount":-40000}]'}])await assert.rejects(write(changes),/financial_source_mismatch/);
});

test('upgrade catch-up posts only existing captures, keeps original policies and converges under repeated concurrent batches',async t=>{
  const f=await setupCommerceFixture(t,{through:22}),o=await order(f);await f.paid(o);await seed(f,1);await seed(f,2,{seller:'seller_bob'});await seed(f,3,{mode:'production'});
  await applyCommerceSchema(f.db,22,23);let s=await summary(f);assert.equal(s.accountingComplete,false);assert.equal(s.posted,0);assert.equal(s.unposted,2);assert.equal(s.capturedGross,'80000');
  assert.equal((await f.call(base+'/captures/reconcile',{environment:'sandbox',limit:1})).remaining,2);
  const results=await Promise.all([f.call(base+'/captures/reconcile',{environment:'sandbox',limit:1}),f.call(base+'/captures/reconcile',{environment:'sandbox',limit:1})]);assert(results.every(r=>r.status===200));
  assert.equal((await f.call(base+'/captures/reconcile',{environment:'sandbox',limit:1})).remaining,0);assert.equal(await count(f,'commerce_financial_journals'),3);s=await summary(f);assert.equal(s.accountingComplete,true);assert.equal(s.unallocated,1);assert.equal(s.accounts.seller_pending,'-36750');assert.equal(s.availableToWithdraw,null);
  assert.equal(await count(f,'commerce_payment_captures'),4);assert.equal((await summary(f,'seller_bob')).capturedGross,'40000');
});

test('service authorization, environment isolation and fixed journal pages prevent forged allocations and disclosure',async t=>{
  const f=await setupCommerceFixture(t);await f.db.prepare("UPDATE products SET stock_quantity=1000 WHERE id='tea'").run();
  for(let n=0;n<24;n++){const o=await order(f);await f.paid(o);}
  await seed(f,100,{seller:'seller_bob'});await seed(f,101,{mode:'production'});
  const first=await list(f,'&limit=10');assert.equal(first.items.length,10);assert.equal((await list(f,'&limit=10&cap='+first.cap+'&before='+first.nextBefore)).items.length,10);
  const later=await order(f);await f.paid(later);let all=[...first.items],before=first.nextBefore;
  while(before){const page=await list(f,'&limit=10&cap='+first.cap+'&before='+before);assert.equal(page.status,200,page.error);all.push(...page.items);before=page.nextBefore;}
  assert.equal(all.length,24);assert.equal(new Set(all.map(r=>r.id)).size,24);all.forEach(balanced);assert.equal((await summary(f)).captures,25);
  assert.equal((await f.merchant(base+'/summary?seller=seller_alice&environment=sandbox')).status,401);
  for(const query of ['seller=seller_alice&environment=production','seller=seller_alice&environment=sandbox&seller=seller_bob','seller=seller_alice&environment=sandbox&credit=1000'])assert([403,422].includes((await f.call(base+'/summary?'+query)).status));
  assert.equal((await f.call(base+'/captures/reconcile',{environment:'sandbox',amount:1000})).status,422);assert.equal((await f.call(base+'/captures/reconcile',{environment:'production'})).status,403);
  for(const query of ['&limit=51','&before=-1','&cap=9007199254740992'])assert.equal((await list(f,query)).status,422);
});
