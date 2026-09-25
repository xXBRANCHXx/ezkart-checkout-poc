import test from 'node:test';
import assert from 'node:assert/strict';
import {randomBytes} from 'node:crypto';
import {setupCommerceFixture} from './commerce-fixture.mjs';
import {cleanupCustomerExports} from '../src/commerce-customer-exports.js';
import {saveCustomerWorkspace} from '../src/commerce-customer-workspace.js';

const base='/v1/commerce/customers',key=()=>randomBytes(16).toString('hex');
async function seed(f,n,{customer=n,seller='seller_alice',mode='sandbox',version=1,at='2026-01-20T01:00:00.000Z',amount=20000,paid=false,state=paid?'paid':'pending',location='Jakarta'}={}){
  const id='EZK-'+(mode==='sandbox'?'S':'P')+'-'+n.toString(16).toUpperCase().padStart(24,'0'),cid='customer_'+customer;
  await f.db.prepare(`INSERT INTO customers(id,seller_id,email,name,phone,consent_json,created_at,updated_at)
    VALUES (?,?,?,'MASTER_PRIVATE_NAME','MASTER_PRIVATE_PHONE','{"marketing":true}',?,?) ON CONFLICT(id) DO NOTHING`).bind(cid,seller,'buyer'+customer+'@example.test',at,at).run();
  await f.db.prepare(`INSERT INTO orders(id,seller_id,customer_id,commerce_version,commerce_environment,checkout_state,subtotal_amount,total_amount,customer_snapshot_json,shipping_address_json,snapshot_json,created_at,updated_at)
    VALUES (?,?,?,?,?,?,?,?,?,?,'{"fees":{"plan":"standard"},"shipping":{"skipped":true}}',?,?)`).bind(id,seller,cid,version,mode,state,amount,amount,
      JSON.stringify({name:'Buyer '+n,email:'buyer'+customer+'@example.test',phone:'081234567890',authUserId:'PRIVATE_AUTH_ID'}),JSON.stringify({location,address:'Saved street '+n,postalCode:'12345',coordinate:{private:'PRIVATE_PIN'}}),at,at).run();
  if(paid)await f.db.prepare(`INSERT INTO commerce_payment_captures(id,seller_id,order_id,provider,commerce_environment,provider_reference,amount,currency,capture_kind,verified_at)
    VALUES (?,?,?,'doku',?,?,?,'IDR','order_payment',?)`).bind('capture_'+n,seller,id,mode,'reference_'+n,amount,at).run();
  return {id,cid};
}
const profile=(revision=0,note='Private customer note',tags=['VIP'])=>({revision,requestKey:key(),note,tags});
const segment=(name='Returning buyers',filters={activity:'repeat'},revision=0,archived=false)=>({revision,requestKey:key(),name,filters,archived});

test('customer directory isolates seller, environment and central version, uses saved contacts and permits only authenticated reads',async t=>{
  const f=await setupCommerceFixture(t),one=await seed(f,1,{paid:true});
  const bob=await seed(f,2,{seller:'seller_bob'}),prod=await seed(f,3,{mode:'production'}),legacy=await seed(f,4,{version:0});
  await seed(f,5,{customer:1,mode:'production',at:'2027-01-01T00:00:00.000Z'});
  assert.equal((await f.mf.dispatchFetch('https://api.fixture.test'+base)).status,401);
  const list=await f.merchant(base);assert.equal(list.status,200,list.error);assert.equal(list.summary.customers,1);assert.equal(list.summary.gross,'20000');assert.equal(list.items[0].name,'Buyer 1');assert(!JSON.stringify(list).match(/MASTER_PRIVATE|PRIVATE_AUTH|PRIVATE_PIN|consent_json/));
  const detail=await f.merchant(base+'/'+one.cid);assert.equal(detail.customer.marketingConsent,'not_recorded');assert.equal(detail.customer.address.address,'Saved street 1');assert.equal(detail.customer.profile.revision,0);
  for(const foreign of [bob,prod,legacy])for(const suffix of ['', '/orders','/changes'])assert.equal((await f.merchant(base+'/'+foreign.cid+suffix)).status,404);
  for(const query of ['seller=seller_bob','q=a&q=b','activity=unknown','minSpend=-1','minSpend=9223372036854775808','minOrders=2&maxOrders=1','lastFrom=2026-02-30','lastFrom=2026-02-02&lastTo=2026-02-01','limit=51','cursor=invalid','q='+('a'.repeat(121))])assert.equal((await f.merchant(base+'?'+query)).status,422,query);
  assert.equal((await f.merchant(base+'/'+one.cid+'?q=buyer')).status,422);
  assert.equal((await f.merchant(base,{}, {method:'POST'})).status,405);
  await f.db.prepare("UPDATE seller_memberships SET role='viewer' WHERE auth_user_id='alice'").run();assert.equal((await f.merchant(base)).canEdit,false);assert.equal((await f.merchant(base+'/'+one.cid)).status,200);
  assert.equal((await f.merchant(base+'/'+one.cid+'/profile',profile())).status,403);
});

test('customer pages include full history beyond 200 profiles, preserve their frontier and apply live segment filters',async t=>{
  const f=await setupCommerceFixture(t);for(let n=1;n<=241;n++)await seed(f,n,{paid:n%2===0});
  const first=await f.merchant(base+'?limit=25');assert.equal(first.summary.customers,241);assert.equal(first.summary.payingCustomers,120);assert.equal(first.summary.gross,'2400000');
  await seed(f,500);await seed(f,501,{customer:1,paid:true,at:'2027-01-01T00:00:00.000Z'});
  const second=await f.merchant(base+'?limit=25&cursor='+first.nextCursor),back=await f.merchant(base+'?limit=25&cursor='+second.previousCursor);assert.deepEqual(back.items,first.items);assert.equal(second.summary.customers,241);
  const ids=[];let page=first;
  do{ids.push(...page.items.map(r=>r.id));if(!page.nextCursor)break;page=await f.merchant(base+'?limit=25&cursor='+page.nextCursor);assert.equal(page.status,200,page.error);}while(true);
  assert.equal(ids.length,241);assert.equal(new Set(ids).size,241);
  const reload=await f.merchant(base+'?limit=25&cursor='+second.pageCursor);assert.deepEqual(reload.items,second.items);
  assert.equal((await f.merchant(base)).summary.customers,242);
  assert.equal((await f.merchant(base+'?minOrders=2')).items[0].id,'customer_1');assert.equal((await f.merchant(base+'?activity=one_order')).matching,241);
  assert.equal((await f.merchant(base+'?activity=no_paid')).matching,121);assert.equal((await f.merchant(base+'?minSpend=20000')).matching,121);
  assert.equal((await f.merchant(base+'?q=buyer200@example.test')).matching,1);assert.equal((await f.merchant(base+'?location=jakarta')).matching,242);
  assert.equal((await f.merchant(base+'?q=x&cursor='+first.nextCursor)).status,422);
  const saved=await f.merchant(base+'/customer_1/profile',profile(0,'Helpful context',[' VIP ','Repeat']));assert.equal(saved.status,200,saved.error);
  const tagged=await f.merchant(base+'?tag=VIP');assert.equal(tagged.matching,1);assert.deepEqual(tagged.items[0].tags,['repeat','vip']);assert(!Object.hasOwn(tagged.items[0],'note'));
  await seed(f,600,{at:'2026-01-19T16:59:59.999Z'});await seed(f,601,{at:'2026-01-19T17:00:00.000Z'});
  const dates=await f.merchant(base+'?lastFrom=2026-01-20&lastTo=2026-01-20');assert.equal(dates.matching,242);
});

test('customer values retain exact captured amounts and repeat buyers require two verified orders',async t=>{
  const f=await setupCommerceFixture(t),amount=Number.MAX_SAFE_INTEGER,o=await seed(f,1,{amount,paid:true,state:'refunded'});
  await seed(f,2,{customer:1,amount:amount-1,paid:true});await seed(f,3,{state:'paid'});await seed(f,4,{customer:3});
  await f.db.prepare(`INSERT INTO commerce_payment_captures(id,seller_id,order_id,provider,commerce_environment,provider_reference,amount,currency,capture_kind,verified_at)
    VALUES ('additional','seller_alice',?,'doku','sandbox','additional-reference',?,'IDR','duplicate_payment','2026-01-20T01:00:00.000Z')`).bind(o.id,amount).run();
  const a=await f.merchant(base);assert.equal(a.summary.gross,(2n*BigInt(amount)-1n).toString());assert.equal(a.summary.average,String(amount));assert.equal(a.summary.additional,String(amount));assert.equal(a.summary.repeatCustomers,1);assert.equal(a.summary.payingCustomers,1);
  const detail=await f.merchant(base+'/'+o.cid);assert.equal(detail.customer.gross,a.summary.gross);assert.equal(detail.customer.orders,2);assert.equal(detail.customer.paidOrders,2);
  assert.equal((await f.merchant(base+'?activity=repeat')).matching,1);assert.equal((await f.merchant(base+'?activity=no_paid')).items[0].id,'customer_3');
  for(let n=5;n<=32;n++)await seed(f,n,{customer:1});
  const first=await f.merchant(base+'/'+o.cid+'/orders?limit=10');await seed(f,100,{customer:1,at:'2000-01-01T00:00:00.000Z'});
  const rows=[...first.items];let cursor=first.nextCursor;while(cursor){const next=await f.merchant(base+'/'+o.cid+'/orders?limit=7&cursor='+cursor);rows.push(...next.items);cursor=next.nextCursor;}
  assert.equal(rows.length,30);assert.equal(new Set(rows.map(r=>r.id)).size,30);assert(!rows.some(r=>r.id.endsWith('000064')));
  assert.equal((await f.merchant(base+'/customer_3/orders?cursor='+first.nextCursor)).status,422);
});

test('checkout identities remain stable for repeated normalized emails and latest contact data comes from the scoped order',async t=>{
  const f=await setupCommerceFixture(t),first=await f.create(f.input({customer:{name:'Old name',email:'BUYER@EXAMPLE.TEST',phone:'081234567890'}}));assert.equal(first.status,200,first.error);
  const second=await f.create(f.input({customer:{name:'New name',email:'buyer@example.test',phone:'081234567891'}}));assert.equal(second.status,200,second.error);
  const list=await f.merchant(base);assert.equal(list.summary.customers,1);assert.equal(list.items[0].orders,2);assert.equal(list.items[0].name,'New name');assert.equal(list.items[0].phone,'081234567891');
  assert.equal((await f.db.prepare('SELECT COUNT(*) AS n FROM customers').first()).n,1);
});

test('profile saves are replay-safe, conflict on stale revisions, preserve audits and recheck write authority in the transaction',async t=>{
  const f=await setupCommerceFixture(t),o=await seed(f,1),input=profile();
  const path=base+'/'+o.cid+'/profile',a=await f.merchant(path,input);assert.equal(a.status,200,a.error);assert.equal(a.change.revision,1);
  const replay=await f.merchant(path,input);assert.equal(replay.change.replayed,true);assert.equal((await f.db.prepare('SELECT COUNT(*) AS n FROM commerce_customer_changes').first()).n,1);
  assert.equal((await f.merchant(path,{...input,note:'Changed request'})).status,409);
  const race=await Promise.all([f.merchant(path,profile(1,'Tab one',['one'])),f.merchant(path,profile(1,'Tab two',['two']))]);assert.deepEqual(race.map(r=>r.status).sort(),[200,409]);
  assert.equal((await f.merchant(path,profile())).status,409);
  for(let revision=2;revision<26;revision++)assert.equal((await f.merchant(path,profile(revision,'Note '+revision,['retained']))).status,200);
  const history=await f.merchant(base+'/'+o.cid+'/changes?limit=10'),changes=[...history.items];let cursor=history.nextCursor;
  while(cursor){const page=await f.merchant(base+'/'+o.cid+'/changes?limit=10&cursor='+cursor);assert.equal(page.status,200,page.error);changes.push(...page.items);cursor=page.nextCursor;}
  assert.equal(changes.length,26);assert(changes.every(r=>r.byYou));assert(!JSON.stringify(changes).includes('actor_auth_user_id'));
  assert.equal((await f.merchant(path,profile(26,'x'.repeat(2001)))).status,422);assert.equal((await f.merchant(path,{...profile(26),authUserId:'bob'})).status,422);
  await assert.rejects(f.db.prepare("UPDATE commerce_customer_profiles SET data_json='{}'").run(),/customer_receipt_required/);
  await assert.rejects(f.db.prepare('DELETE FROM commerce_customer_changes').run(),/customer_change_immutable/);
  await f.db.prepare("UPDATE seller_memberships SET role='viewer' WHERE auth_user_id='alice'").run();
  await assert.rejects(saveCustomerWorkspace({DB:f.db,APP_ENVIRONMENT:'test'},{id:'seller_alice',role:'owner'},'alice','profile',o.cid,profile(26)),error=>error.status===403);
  assert.equal((await f.merchant(path,input)).status,403);
});

test('saved segments support durable edits, archive/restore, scoped pagination and an atomic active-segment limit',async t=>{
  const f=await setupCommerceFixture(t),input=segment(),created=await f.merchant(base+'/segments',input,{method:'POST'});assert.equal(created.status,200,created.error);
  const id=created.change.id;assert.equal((await f.merchant(base+'/segments',input,{method:'POST'})).change.replayed,true);
  const initial=await f.merchant(base+'/segments/'+id);assert.equal(initial.segment.filters.activity,'repeat');assert.equal(initial.segment.revision,1);
  assert.equal((await f.merchant(base+'/segments/'+id,undefined,{seller:'bob'})).status,404);
  assert.equal((await f.merchant(base+'/segments/'+id,segment('Other',{},1),{seller:'bob'})).status,404);
  for(let n=1;n<49;n++)assert.equal((await f.merchant(base+'/segments',segment('Segment '+n,{}),{method:'POST'})).status,200);
  const final=await Promise.all([f.merchant(base+'/segments',segment('Last one',{}),{method:'POST'}),f.merchant(base+'/segments',segment('Too many',{}),{method:'POST'})]);assert.deepEqual(final.map(r=>r.status).sort(),[200,409]);
  assert.equal((await f.merchant(base+'/segments?limit=50')).items.length,50);
  assert.equal((await f.merchant(base+'/segments/'+id,segment('Returning buyers',{activity:'repeat'},1,true))).status,200);
  assert.equal((await f.merchant(base+'/segments',segment('New available slot',{}),{method:'POST'})).status,200);
  assert.equal((await f.merchant(base+'/segments/'+id,segment('Returning buyers',{},2,false))).status,409);
  const archived=await f.merchant(base+'/segments?state=archived');assert.equal(archived.items.length,1);assert.equal(archived.items[0].id,id);
  const all=[];let next=null;do{const p=await f.merchant(base+'/segments?state=all&limit=7'+(next?'&cursor='+next:''));assert.equal(p.status,200,p.error);all.push(...p.items);next=p.nextCursor;}while(next);assert.equal(all.length,51);
  const another=all.find(s=>!s.archived);assert.equal((await f.merchant(base+'/segments/'+another.id,segment(another.name,another.filters,another.revision,true))).status,200);
  assert.equal((await f.merchant(base+'/segments/'+id,segment('Restored',{minSpend:'150000'},2,false))).status,200);
  await assert.rejects(f.db.prepare("UPDATE commerce_customer_segments SET data_json='{}' WHERE id=?").bind(id).run(),/customer_receipt_required/);
});

test('customer export freezes all matching profiles, replays lost receipts and rejects changed requests, foreign access and gaps',async t=>{
  const f=await setupCommerceFixture(t);for(let n=1;n<=38;n++)await seed(f,n,{paid:n%2===0});
  const list=await f.merchant(base),input={requestKey:key(),cohort:list.cohort,filters:{minSpend:'20000'}};
  const results=await Promise.all([f.merchant(base+'/exports',input,{method:'POST'}),f.merchant(base+'/exports',input,{method:'POST'})]);assert(results.every(r=>r.status===200),JSON.stringify(results));assert.equal(results[0].export.id,results[1].export.id);assert.equal(results[0].export.rowCount,19);
  const id=results[0].export.id;await seed(f,100,{paid:true});
  await f.merchant(base+'/customer_2/profile',profile(0,'PRIVATE_NOTE',['loyal']));
  const rows=[];let after=0;do{const page=await f.merchant(base+'/exports/'+id+'?after='+after+'&limit=7');assert.equal(page.status,200,page.error);rows.push(...page.rows);after=page.nextAfter;}while(after!==null);
  assert.equal(rows.length,19);assert.deepEqual(rows.map(r=>r.ordinal),Array.from({length:19},(_,i)=>i+1));assert(!JSON.stringify(rows).match(/PRIVATE_AUTH|MASTER_PRIVATE|PRIVATE_NOTE|loyal/));
  assert.equal((await f.merchant(base+'/exports',input,{method:'POST'})).export.rowCount,19);
  assert.equal((await f.merchant(base+'/exports',{...input,filters:{}},{method:'POST'})).status,409);
  assert.equal((await f.merchant(base+'/exports/'+id,undefined,{seller:'bob'})).status,404);
  assert.equal((await f.merchant(base+'/exports',{...input,requestKey:key()},{seller:'bob',method:'POST'})).status,422);
  for(const query of ['limit=1001','after=-1','after=20','limit=5&limit=6','seller=alice'])assert.equal((await f.merchant(base+'/exports/'+id+'?'+query)).status,422);
  await assert.rejects(f.db.prepare("UPDATE commerce_customer_export_rows SET cells_json='[]' WHERE export_id=?").bind(id).run(),/customer_export_immutable/);
  await assert.rejects(f.db.prepare('DELETE FROM commerce_customer_exports WHERE id=?').bind(id).run(),/customer_export_retained/);
  for(let n=1;n<10;n++)assert.equal((await f.merchant(base+'/exports',{...input,requestKey:key()},{method:'POST'})).status,200);
  assert.equal((await f.merchant(base+'/exports',{...input,requestKey:key()},{method:'POST'})).status,429);assert.equal((await f.merchant(base+'/exports',input,{method:'POST'})).status,200);
});

test('failed export materialization rolls back its receipt and expired private rows are cleaned in bounded batches',async t=>{
  const f=await setupCommerceFixture(t);await seed(f,1);
  const input={requestKey:key(),cohort:(await f.merchant(base)).cohort,filters:{}};
  await f.db.prepare("CREATE TRIGGER injected_export_failure BEFORE INSERT ON commerce_customer_export_rows BEGIN SELECT RAISE(ABORT,'fixture_failure'); END;").run();
  assert.equal((await f.merchant(base+'/exports',input,{method:'POST'})).status,500);assert.equal((await f.db.prepare('SELECT COUNT(*) AS n FROM commerce_customer_exports').first()).n,0);
  await f.db.prepare('DROP TRIGGER injected_export_failure').run();assert.equal((await f.merchant(base+'/exports',input,{method:'POST'})).status,200);
  const expired='cex_'+'e'.repeat(40);await f.db.batch([
    f.db.prepare(`INSERT INTO commerce_customer_exports(id,seller_id,commerce_environment,request_key,request_hash,filters_json,created_at,expires_at)
      VALUES (?,'seller_alice','sandbox','expired','expired','{}','2000-01-01T00:00:00.000Z','2000-01-02T00:00:00.000Z')`).bind(expired),
    f.db.prepare("INSERT INTO commerce_customer_export_rows(export_id,ordinal,cells_json) VALUES (?,1,'[]')").bind(expired),
    f.db.prepare("UPDATE commerce_customer_exports SET state='ready',row_count=1 WHERE id=?").bind(expired),
  ]);
  assert.equal((await f.merchant(base+'/exports/'+expired)).status,410);await cleanupCustomerExports({DB:f.db});assert.equal((await f.merchant(base+'/exports/'+expired)).status,404);
  assert.equal((await f.db.prepare('SELECT COUNT(*) AS n FROM commerce_customer_exports').first()).n,1);
});
