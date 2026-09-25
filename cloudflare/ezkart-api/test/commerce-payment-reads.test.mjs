import test from 'node:test';
import assert from 'node:assert/strict';
import {setupCommerceFixture} from './commerce-fixture.mjs';

const path='/v1/commerce/payments';
async function seed(f,n,{at='2026-01-20T01:00:00.000Z',state='pending',amount=20000,paid=false,seller='seller_alice',mode='sandbox',version=1}={}){
  const id='EZK-'+(mode==='sandbox'?'S':'P')+'-'+n.toString(16).toUpperCase().padStart(24,'0');
  await f.db.prepare(`INSERT INTO orders(id,seller_id,commerce_version,commerce_environment,checkout_state,subtotal_amount,total_amount,customer_snapshot_json,snapshot_json,created_at,updated_at)
    VALUES (?,?,?,?,?,?,?,?,'{"fees":{"plan":"standard"},"shipping":{"skipped":true}}',?,?)`)
    .bind(id,seller,version,mode,state,amount,amount,JSON.stringify({name:'Buyer '+n,email:'buyer'+n+'@example.test',phone:'PRIVATE_PHONE',authUserId:'PRIVATE_AUTH'}),at,at).run();
  if(paid)await f.db.prepare(`INSERT INTO commerce_payment_captures(id,seller_id,order_id,provider,commerce_environment,provider_reference,amount,currency,capture_kind,verified_at)
    VALUES (?,?,?,'doku',?,?,?,'IDR','order_payment',?)`).bind('capture_'+n,seller,id,mode,'provider-reference-'+n,amount,at).run();
  return id;
}

test('payment reads enforce seller/environment/version scope and read-only viewer access',async t=>{
  const f=await setupCommerceFixture(t),id=await seed(f,1,{state:'paid',paid:true});
  const foreign=await seed(f,2,{seller:'seller_bob',paid:true}),production=await seed(f,3,{mode:'production',paid:true}),legacy=await seed(f,4,{version:0});
  assert.equal((await f.mf.dispatchFetch('https://api.fixture.test'+path)).status,401);
  const a=await f.merchant(path);assert.equal(a.status,200,a.error);assert.equal(a.summary.orders,1);assert.equal(a.summary.gross,'20000');assert.equal(a.items[0].primaryReference,'provider-reference-1');
  assert(!JSON.stringify(a).match(/PRIVATE_PHONE|PRIVATE_AUTH|snapshot_json|lease_token/));
  for(const key of [foreign,production,legacy]){
    assert.equal((await f.merchant(path+'/'+key)).status,404);
    for(const kind of ['captures','attempts','events'])assert.equal((await f.merchant(path+'/'+key+'/'+kind)).status,404);
  }
  await f.db.prepare("UPDATE seller_memberships SET role='viewer' WHERE auth_user_id='alice'").run();assert.equal((await f.merchant(path+'/'+id)).status,200);
  for(const p of [path,path+'/'+id,path+'/'+id+'/captures'])assert.equal((await f.merchant(p,{}, {method:'POST'})).status,405);
  for(const q of ['seller=seller_bob','environment=production','state=unknown','review=maybe','evidence=settled','from=2026-02-30',
    'from=2026-02-01&to=2026-01-01','limit=51','state=paid&state=pending','q='+('x'.repeat(121)),'method='+('x'.repeat(101)),'cursor=broken'])
    assert.equal((await f.merchant(path+'?'+q)).status,422,q);
  assert.equal((await f.merchant(path+'/'+id+'?q=test')).status,422);
});

test('full payment totals and keyset pages include every order and retain the insertion frontier in both directions',async t=>{
  const f=await setupCommerceFixture(t);for(let n=1;n<=241;n++)await seed(f,n,{paid:n%2===0,state:n%2===0?'paid':'pending'});
  const first=await f.merchant(path+'?limit=25');assert.equal(first.status,200,first.error);assert.equal(first.summary.orders,241);assert.equal(first.summary.paidOrders,120);assert.equal(first.summary.gross,'2400000');assert.equal(first.summary.awaitingAmount,'2420000');
  assert.equal(first.methods[0].orders,241);assert.equal(first.items.length,25);assert.equal(first.previousCursor,null);
  await seed(f,500,{paid:true});
  const second=await f.merchant(path+'?limit=25&cursor='+first.nextCursor);assert.equal(second.summary.orders,241);
  const back=await f.merchant(path+'?limit=25&cursor='+second.previousCursor);assert.deepEqual(back.items,first.items);
  const reload=await f.merchant(path+'?limit=25&cursor='+first.pageCursor);assert.deepEqual(reload.items,first.items);
  const ids=[];let page=first;
  do{ids.push(...page.items.map(r=>r.id));if(!page.nextCursor)break;page=await f.merchant(path+'?limit=25&cursor='+page.nextCursor);assert.equal(page.status,200,page.error);}while(true);
  assert.equal(ids.length,241);assert.equal(new Set(ids).size,241);
  assert.equal((await f.merchant(path)).summary.orders,242);
  const filtered=await f.merchant(path+'?evidence=verified&state=paid');assert.equal(filtered.matching,120);assert.equal(filtered.summary.orders,242);
  const found=await f.merchant(path+'?q=provider-reference-240');assert.equal(found.matching,1);assert.equal(found.items[0].primaryReference,'provider-reference-240');
  assert.equal((await f.merchant(path+'?method=Missing')).matching,0);
  assert.equal((await f.merchant(path+'?evidence=verified&cursor='+first.nextCursor)).status,422);
  await seed(f,600,{at:'2026-01-19T16:59:59.999Z'});await seed(f,601,{at:'2026-01-19T17:00:00.000Z'});
  await seed(f,602,{at:'2026-01-20T16:59:59.999Z'});await seed(f,603,{at:'2026-01-20T17:00:00.000Z'});
  const date=await f.merchant(path+'?from=2026-01-20&to=2026-01-20');assert.equal(date.summary.orders,244);assert.equal(date.matching,244);
});

test('verified and additional captures remain exact; refunded gross and paid labels are distinct',async t=>{
  const f=await setupCommerceFixture(t),amount=Number.MAX_SAFE_INTEGER;
  const id=await seed(f,1,{amount,state:'refunded',paid:true});await seed(f,2,{amount:amount-1,state:'paid',paid:true});await seed(f,3,{state:'paid'});
  await f.db.prepare(`INSERT INTO commerce_payment_captures(id,seller_id,order_id,provider,commerce_environment,provider_reference,amount,currency,capture_kind,verified_at)
    VALUES ('additional','seller_alice',?,'doku','sandbox','extra-reference',?,'IDR','duplicate_payment','2026-01-20T01:00:00.000Z')`).bind(id,amount).run();
  const a=await f.merchant(path);assert.equal(a.summary.gross,(2n*BigInt(amount)-1n).toString());assert.equal(a.summary.additional,String(amount));assert.equal(a.summary.average,String(amount));
  assert.equal(a.summary.paidOrders,2);assert.equal(a.summary.needsReview,1);assert.equal(a.summary.awaitingOrders,0);
  const extra=await f.merchant(path+'?evidence=additional&review=yes');assert.equal(extra.matching,1);assert.equal(extra.items[0].id,id);
  const found=await f.merchant(path+'?q=extra-reference');assert.equal(found.matching,1);
  const detail=await f.merchant(path+'/'+id);assert.equal(detail.order.total,String(amount));assert.equal(detail.order.needsReview,true);assert.equal(detail.captures.items.length,2);
  assert(detail.captures.items.every(r=>r.amount===String(amount)));
  const empty=await f.merchant(path+'?from=2025-01-01&to=2025-01-02');assert.equal(empty.summary.average,null);assert.equal(empty.summary.paymentRate,null);
});

test('payment sessions, uncertain provider attempts and delayed leases expose useful state without private worker data',async t=>{
  const f=await setupCommerceFixture(t),o=(await f.create(f.input())).order;
  const claim=await f.call('/internal/commerce/jobs/claim',{environment:'sandbox',workerId:'PRIVATE_WORKER',kinds:['payment.create'],orderId:o.id,limit:1});assert.equal(claim.status,200,claim.error);
  const job=claim.jobs[0];assert.equal((await f.call('/internal/commerce/jobs/'+job.id+'/finish',{environment:'sandbox',workerId:'PRIVATE_WORKER',leaseToken:job.leaseToken,outcome:'uncertain',error:'PRIVATE_ERROR Bearer secret',result:{private:'PRIVATE_RESULT'}})).status,200);
  let a=await f.merchant(path+'?review=yes');assert.equal(a.matching,1);assert.equal(a.summary.needsReview,1);
  let d=await f.merchant(path+'/'+o.id);assert.equal(d.operations[0].state,'uncertain');assert.equal(d.attempts.items[0].outcome,'uncertain');
  assert(!JSON.stringify(d).match(/PRIVATE_|leaseToken|accountNumber|paymentUrl|payload_json|result_json/));
  assert.equal((await f.event(o,'payment.created',f.session(o))).status,200);assert.equal((await f.paid(o)).status,200);
  d=await f.merchant(path+'/'+o.id);assert.equal(d.session.method,'VIRTUAL_ACCOUNT_BCA');assert.equal(d.session.reference,o.paymentRequestId);assert.equal(d.order.confirmed,'40000');assert.equal(d.order.needsReview,false);
  assert.equal((await f.merchant(path+'?method=VIRTUAL_ACCOUNT_BCA')).matching,1);
  assert.equal((await f.merchant(path+'?q=virtual%20account%20bca')).matching,1);
  assert.equal((await f.merchant(path+'?q='+o.paymentRequestId)).matching,1);
  const second=(await f.create(f.input())).order;
  await f.db.prepare("UPDATE commerce_jobs SET state='running',lease_until='2000-01-01T00:00:00.000Z',lease_token='private-stale' WHERE order_id=? AND kind='payment.create'").bind(second.id).run();
  a=await f.merchant(path+'?review=yes');assert.equal(a.matching,1);assert.equal(a.items[0].id,second.id);
  d=await f.merchant(path+'/'+second.id);assert.equal(d.operations[0].timedOut,1);
});

test('capture, event and request histories page independently with a stable frontier and perform no commerce writes',async t=>{
  const f=await setupCommerceFixture(t),o=(await f.create(f.input())).order;assert.equal((await f.paid(o)).status,200);
  for(let n=1;n<=45;n++)assert.equal((await f.paid(o,{reference:'additional-'+n})).status,200);
  const at='2026-01-20T01:00:00.000Z';
  for(let n=0;n<25;n++)await f.db.batch([
    f.db.prepare(`INSERT INTO commerce_jobs(id,seller_id,order_id,commerce_environment,job_key,kind,payload_json,state,attempts,available_at,created_at,updated_at)
      VALUES (?,'seller_alice',?,'sandbox',?,'payment.create','{}','uncertain',1,?,?,?)`).bind('historical_job_'+n,o.id,'historical_'+n,at,at,at),
    f.db.prepare(`INSERT INTO commerce_job_attempts(id,job_id,attempt,lease_token,worker_id,mode,started_at,finished_at,outcome,error)
      VALUES (?,?,1,'PRIVATE_TOKEN','PRIVATE_WORKER','execute',?,?,'uncertain','PRIVATE_ERROR')`).bind('historical_attempt_'+n,'historical_job_'+n,at,at),
  ]);
  const before=await f.db.prepare('SELECT (SELECT COUNT(*) FROM commerce_payment_captures) AS captures,(SELECT SUM(stock_quantity) FROM products) AS stock,(SELECT COUNT(*) FROM commerce_jobs) AS jobs').first();
  const d=await f.merchant(path+'/'+o.id);assert.equal(d.status,200,d.error);
  for(const [kind,total] of [['captures',46],['events',46],['attempts',25]]){
    assert.equal(d[kind].items.length,20);assert(d[kind].nextCursor);
    const rows=[...d[kind].items];let next=d[kind].nextCursor;
    do{const a=await f.merchant(path+'/'+o.id+'/'+kind+'?cursor='+next);assert.equal(a.status,200,a.error);rows.push(...a.items);next=a.nextCursor;}while(next);
    assert.equal(rows.length,total,kind);assert.equal(new Set(rows.map(r=>r.id)).size,total);
  }
  assert.equal((await f.merchant(path+'/'+o.id+'/events?cursor='+d.captures.nextCursor)).status,422);
  const another=(await f.create(f.input())).order;
  assert.equal((await f.merchant(path+'/'+another.id+'/captures?cursor='+d.captures.nextCursor)).status,422);
  const after=await f.db.prepare('SELECT (SELECT COUNT(*) FROM commerce_payment_captures) AS captures,(SELECT SUM(stock_quantity) FROM products) AS stock,(SELECT COUNT(*) FROM commerce_jobs WHERE order_id!=?) AS jobs').bind(another.id).first();
  assert.deepEqual(after,before);
});

test('backdated capture inserts remain outside every continuation of an existing history',async t=>{
  const f=await setupCommerceFixture(t),id=await seed(f,1,{paid:true,state:'paid'});
  async function capture(n,at){return f.db.prepare(`INSERT INTO commerce_payment_captures(id,seller_id,order_id,provider,commerce_environment,provider_reference,amount,currency,capture_kind,verified_at)
    VALUES (?,'seller_alice',?,'doku','sandbox',?,20000,'IDR','duplicate_payment',?)`).bind('extra_'+n,id,'extra_'+n,at).run();}
  for(let n=1;n<=25;n++)await capture(n,'2026-01-20T01:00:00.000Z');
  const first=(await f.merchant(path+'/'+id)).captures;
  await capture(99,'2000-01-01T00:00:00.000Z');
  const rows=[...first.items];let cursor=first.nextCursor;
  do{const page=await f.merchant(path+'/'+id+'/captures?limit=2&cursor='+cursor);assert.equal(page.status,200,page.error);rows.push(...page.items);cursor=page.nextCursor;}while(cursor);
  assert.equal(rows.length,26);assert.equal(new Set(rows.map(r=>r.id)).size,26);assert(!rows.some(r=>r.id==='extra_99'));
  const refreshed=await f.merchant(path+'/'+id+'/captures?limit=50');assert.equal(refreshed.items.length,27);assert(refreshed.items.some(r=>r.id==='extra_99'));
});
