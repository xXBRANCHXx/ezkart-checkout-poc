import test from 'node:test';
import assert from 'node:assert/strict';
import {setupCollectionFixture,collectionPath as path} from './provider-collection-fixture.mjs';
import {applyCommerceSchema} from './commerce-schema.mjs';

test('a completed collection retains exact original pages and duplicate legs without releasing funds',async t=>{
  const f=await setupCollectionFixture(t),twins=f.row('same-page'),full=Array.from({length:20},(_,i)=>i<2?twins:f.row('row-'+i));
  const ids=await f.sources({cash:[full,[f.row('last')]],pending:[[f.row('pending',{status:'VOID'})]],after:'-9007199254740993'});
  const saved=await f.seal(ids);assert.equal(saved.status,200,saved.error);assert.equal(saved.replayed,false);
  const c=saved.collection;assert.deepEqual(c.observationIds,ids);assert.equal(c.pagesExhausted,true);assert.equal(c.balancesChanged,true);assert.equal(c.atomicSnapshot,false);assert.equal(c.settlementVerified,false);assert.equal(c.availableToWithdraw,null);
  assert.deepEqual(c.coverage,{DOKU_MERCHANT_IDR:{pages:2,rows:21,exhausted:true},DOKU_MERCHANT_PENDING_IDR:{pages:1,rows:1,exhausted:true}});
  assert.equal((await f.db.prepare('SELECT COUNT(*) AS n FROM commerce_provider_transaction_observations').first()).n,22);
  assert.equal((await f.db.prepare('SELECT COUNT(*) AS n FROM commerce_financial_journals').first()).n,0);
  const read=await f.call(path+'/'+c.id+'?seller=seller_alice&environment=sandbox');assert.deepEqual(read.collection,c);
  assert.equal((await f.call(path+'/'+c.id+'?seller=seller_bob&environment=sandbox')).status,404);
});

test('collection writes require service authentication, original wallet scope and strict parameters',async t=>{
  const f=await setupCollectionFixture(t),ids=await f.sources();
  assert.equal((await f.merchant(path,f.input(ids),{method:'POST'})).status,401);
  for(const input of [f.input(ids,{complete:true}),f.input(ids,{environment:'production'}),f.input(ids,{seller:'seller_bob'}),f.input([...ids.slice(0,-1),ids[0]]),f.input(ids.slice(0,3)),f.input([...ids.slice(0,-1),'fobs_'+'f'.repeat(40)])]){
    const r=await f.call(path,input);assert([403,409,422].includes(r.status),JSON.stringify(r));
  }
  const foreign=[...ids.slice(0,-1),await f.balance('0',{seller:'seller_bob'})];assert.equal((await f.seal(foreign)).status,409);await assert.rejects(f.rawInsert(foreign),/provider_collection_sources/);
  const body=JSON.stringify(f.input(ids)).replace('"seller":','"seller":"seller_bob","seller":');
  const strict=await f.mf.dispatchFetch('https://api.fixture.test'+path,{method:'POST',headers:f.headers(path,'POST',body),body});assert.equal(strict.status,422);
  for(const suffix of ['&limit=21','&seller=seller_bob','&cap=0','&accountNo=2010000001'])assert.equal((await f.list(suffix)).status,422);
  assert.equal((await f.list()).items.length,0);
});

test('partial windows remain partial and stable paging preserves prior complete observations',async t=>{
  const f=await setupCollectionFixture(t),full=Array.from({length:20},(_,i)=>f.row('partial-'+i));
  const first=await f.seal(await f.sources({cash:[full]}));assert.equal(first.status,200,first.error);assert.equal(first.collection.pagesExhausted,false);assert.equal(first.collection.coverage.DOKU_MERCHANT_IDR.exhausted,false);
  const second=await f.seal(await f.sources({cash:[full,[]]}));assert.equal(second.status,200,second.error);assert.equal(second.collection.pagesExhausted,true);
  const page=await f.list('&limit=1');assert(page.nextBefore);
  assert.equal((await f.seal(await f.sources())).status,200);
  const old=await f.list('&limit=1&cap='+page.cap+'&before='+page.nextBefore);assert.equal(old.items.length,1);assert.equal(old.items[0].id,first.collection.id);assert.equal(old.items[0].pagesExhausted,false);assert.equal(old.nextBefore,null);
  assert.equal((await f.list()).settlementVerified,false);assert.equal((await f.list()).availableToWithdraw,null);
});

test('concurrent collection acknowledgements replay one immutable collection and all source links',async t=>{
  const f=await setupCollectionFixture(t),ids=await f.sources();
  const results=await Promise.all([f.seal(ids),f.seal(ids)]);assert(results.every(r=>r.status===200),JSON.stringify(results));assert.equal(results.filter(r=>r.replayed).length,1);assert.equal(results[0].collection.id,results[1].collection.id);
  for(const table of ['commerce_provider_financial_collections','commerce_provider_collection_observations']){
    await assert.rejects(f.db.prepare('DELETE FROM '+table).run(),/immutable/);
    await assert.rejects(f.db.prepare('INSERT OR REPLACE INTO '+table+' SELECT * FROM '+table).run(),/immutable/);
  }
  await assert.rejects(f.db.prepare("UPDATE commerce_provider_financial_collections SET recorded_at='changed'").run(),/immutable/);
  await assert.rejects(f.db.prepare("UPDATE commerce_provider_collection_observations SET role='balance_after'").run(),/immutable/);
  assert.equal((await f.db.prepare('SELECT COUNT(*) AS n FROM commerce_provider_collection_observations').first()).n,4);
});

test('missing, mixed and overlapping pages cannot certify a collection through either service or SQL',async t=>{
  const f=await setupCollectionFixture(t),full=Array.from({length:20},(_,i)=>f.row('row-'+i));
  const check=async(ids,pattern)=>{assert.equal((await f.seal(ids)).status,422);await assert.rejects(f.rawInsert(ids),pattern);};
  await check([await f.balance(),await f.history([],{pageNumber:'1'}),await f.history([],{accountNo:'2030000001'}),await f.balance()],/collection_pages/);
  await check([await f.balance(),await f.history(full),await f.history([],{pageNumber:'2'}),await f.history([],{accountNo:'2030000001'}),await f.balance()],/collection_pages/);
  await check([await f.balance(),await f.history([]),await f.history([],{pageNumber:'1'}),await f.history([],{accountNo:'2030000001'}),await f.balance()],/collection_page_order/);
  await check([await f.balance(),await f.history([]),await f.history([],{accountNo:'2030000001',pageSize:'10'}),await f.balance()],/collection_window/);
  await check([await f.balance(),await f.history([]),await f.history([],{accountNo:'2030000001',fromDateTime:new Date(Date.parse(f.from)+1000).toISOString()}),await f.balance()],/collection_window/);
  await check(await f.sources({cash:[full,[full[0]]]}),/collection_overlap/);
  await check([await f.balance(),await f.history(full),await f.history([f.row('newer',{dateTime:f.to})],{pageNumber:'1'}),await f.history([],{accountNo:'2030000001'}),await f.balance()],/collection_history_order/);
  assert.equal((await f.list()).items.length,0);
  assert((await f.db.prepare('SELECT COUNT(*) AS n FROM commerce_provider_financial_observations').first()).n>0);
});

test('balance brackets, chronology and closed windows cannot be replaced by reordered or future observations',async t=>{
  const f=await setupCollectionFixture(t),ids=await f.sources();
  for(const changed of [[...ids.slice(1),ids[0]],[ids[0],ids[2],ids[1],ids[3]],[ids[0],ids[1],ids[3],ids[2]]]){
    assert.equal((await f.seal(changed)).status,422);await assert.rejects(f.rawInsert(changed),/provider_collection_(balances|chronology)/);
  }
  const at=new Date(Date.now()-30000).toISOString(),future=[await f.balance(),await f.history([],{toDateTime:at},{requestedAt:at,observedAt:at}),await f.history([],{accountNo:'2030000001',toDateTime:at},{requestedAt:at,observedAt:at}),await f.balance('0',{requestedAt:at,observedAt:at})];
  assert.equal((await f.seal(future)).status,422);await assert.rejects(f.rawInsert(future),/collection_window/);
  const overlapped=[await f.balance('0',{requestedAt:at,observedAt:at}),await f.history([]),await f.history([],{accountNo:'2030000001'}),await f.balance()];
  assert.equal((await f.seal(overlapped)).status,422);await assert.rejects(f.rawInsert(overlapped),/collection_chronology/);
});

test('collection and source links commit atomically, and original observations survive a failed finalization',async t=>{
  const f=await setupCollectionFixture(t),ids=await f.sources();
  await f.db.prepare("CREATE TRIGGER fail_collection_link BEFORE INSERT ON commerce_provider_collection_observations WHEN NEW.position=2 BEGIN SELECT RAISE(ABORT,'fixture_collection_failure'); END").run();
  assert.equal((await f.seal(ids)).status,500);assert.equal((await f.list()).items.length,0);
  assert.equal((await f.db.prepare('SELECT COUNT(*) AS n FROM commerce_provider_collection_observations').first()).n,0);
  assert.equal((await f.db.prepare('SELECT COUNT(*) AS n FROM commerce_provider_financial_observations').first()).n,4);
  await f.db.prepare('DROP TRIGGER fail_collection_link').run();assert.equal((await f.seal(ids)).status,200);
});

test('migration preserves existing beta observations, wallets and journals before sealing their original sources',async t=>{
  const f=await setupCollectionFixture(t,{through:51,bindings:{APP_ENVIRONMENT:'beta'}}),ids=await f.sources();
  const tables=['commerce_provider_financial_observations','commerce_wallet_enrollments','commerce_wallet_provider_profiles','commerce_financial_journals'];
  const before=await Promise.all(tables.map(name=>f.db.prepare('SELECT * FROM '+name).all()));
  await applyCommerceSchema(f.db,51,52);
  const after=await Promise.all(tables.map(name=>f.db.prepare('SELECT * FROM '+name).all()));assert.deepEqual(after.map(x=>x.results),before.map(x=>x.results));
  const saved=await f.seal(ids);assert.equal(saved.status,200,saved.error);assert.equal(saved.collection.pagesExhausted,true);
  assert.equal((await f.call(path,f.input(ids,{environment:'sandbox'}))).status,403);
  assert.deepEqual((await f.db.prepare('PRAGMA foreign_key_check').all()).results,[]);
});

test('maximum collection coverage is bounded to forty pages per account and retains every row',async t=>{
  const f=await setupCollectionFixture(t);
  const pages=type=>Array.from({length:40},(_,p)=>Array.from({length:20},(_,i)=>f.row(type+'-'+p+'-'+i)));
  const ids=await f.sources({cash:pages('cash'),pending:pages('pending')});assert.equal(ids.length,82);
  const saved=await f.seal(ids);assert.equal(saved.status,200,saved.error);assert.equal(saved.collection.pagesExhausted,false);
  for(const coverage of Object.values(saved.collection.coverage))assert.deepEqual(coverage,{pages:40,rows:800,exhausted:false});
  assert.equal((await f.db.prepare('SELECT COUNT(*) AS n FROM commerce_provider_transaction_observations').first()).n,1600);
  assert.equal((await f.seal([...ids,await f.balance()])).status,422);
  const plan=await f.db.prepare('EXPLAIN QUERY PLAN SELECT * FROM commerce_provider_collection_observations WHERE collection_sequence=? AND role=?').bind(saved.collection.sequence,'history_page').all();
  assert(plan.results.some(row=>/SEARCH.*idx_provider_collection_coverage/.test(row.detail)),JSON.stringify(plan.results));
});
