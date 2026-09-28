import test from 'node:test';
import assert from 'node:assert/strict';
import {setupPayoutFixture} from './payout-fixture.mjs';
import {applyCommerceSchema} from './commerce-schema.mjs';
import {setupCollectionFixture} from './provider-collection-fixture.mjs';

async function fixture(t){
  const f=await setupCollectionFixture(t),end=Date.parse(f.to),start=end-70*86400000;
  const windows=[0,31,62].map((days,i)=>({fromDateTime:new Date(start+days*86400000).toISOString(),toDateTime:new Date(i===2?end:start+(days+31)*86400000).toISOString()}));
  const sources=async({plan=windows,cash=()=>[],pending=()=>[]}={})=>{
    const ids=[await f.balance()];
    for(const [accountNo,rows] of [['2010000001',cash],['2030000001',pending]])for(const [i,w] of plan.entries())
      ids.push(await f.history(rows(i),{accountNo,...w}));
    ids.push(await f.balance());return ids;
  };
  const reject=async(ids,pattern)=>{assert.equal((await f.seal(ids)).status,422);await assert.rejects(f.rawInsert(ids),pattern);};
  return {...f,windows,sources,reject};
}

test('multi-window collection requires every pocket and window exhausted, preserving boundary multiplicity',async t=>{
  const f=await fixture(t),boundary=f.row('endpoint',{dateTime:f.windows[0].toDateTime});
  const ids=await f.sources({cash:i=>i<2?[boundary,boundary]:[]});
  const result=await f.seal(ids);assert.equal(result.status,200,result.error);assert.equal(result.collection.pagesExhausted,true);
  assert.equal(result.collection.window.from,new Date(f.windows[0].fromDateTime).toISOString().replace('Z','000Z'));
  const coverage=(await f.db.prepare('SELECT * FROM commerce_provider_collection_windows WHERE collection_sequence=?').bind(result.collection.sequence).all()).results;
  assert.equal(coverage.length,2);assert(coverage.every(x=>x.exhausted===1));
  const full=Array.from({length:20},(_,i)=>f.row('old-'+i,{dateTime:f.windows[0].fromDateTime}));
  const partial=await f.seal(await f.sources({cash:i=>i===0?full:[]}));assert.equal(partial.status,200,partial.error);
  assert.equal(partial.collection.pagesExhausted,false);
  assert.equal((await f.db.prepare("SELECT exhausted FROM commerce_provider_collection_windows WHERE collection_sequence=? AND account_type='DOKU_MERCHANT_IDR'").bind(partial.collection.sequence).first()).exhausted,0);
});

test('multi-window holes, overlaps and missing or changed endpoint copies are rejected by service and SQL',async t=>{
  const f=await fixture(t),boundary=f.row('endpoint',{dateTime:f.windows[0].toDateTime});
  await f.reject(await f.sources({plan:[f.windows[0],f.windows[2]]}),/collection_window/);
  const overlap=structuredClone(f.windows);overlap[1].fromDateTime=new Date(Date.parse(overlap[1].fromDateTime)-1000).toISOString();overlap[1].toDateTime=new Date(Date.parse(overlap[1].toDateTime)-1000).toISOString();
  await f.reject(await f.sources({plan:overlap}),/collection_window/);
  await f.reject(await f.sources({cash:i=>i===0?[boundary]:[]}),/collection_boundary/);
  await f.reject(await f.sources({cash:i=>i===0?[boundary]:i===1?[{...boundary,amount:'2'}]:[]}),/collection_boundary/);
  await f.reject(await f.sources({cash:i=>i===0?[boundary,boundary]:i===1?[boundary]:[]}),/collection_boundary/);
  const ids=[await f.balance()];
  for(const [accountNo,plan] of [['2010000001',f.windows],['2030000001',f.windows.slice(1)]])for(const w of plan)ids.push(await f.history([],{accountNo,...w}));
  ids.push(await f.balance());await f.reject(ids,/collection_window/);
});

test('multi-window plans remain bounded to twelve windows through service and SQL',async t=>{
  const f=await fixture(t),from=Date.parse(f.windows[0].fromDateTime);
  const plan=Array.from({length:13},(_,i)=>({fromDateTime:new Date(from+i*86400000).toISOString(),toDateTime:new Date(from+(i+1)*86400000).toISOString()}));
  await f.reject(await f.sources({plan}),/collection_window/);
});

test('migration 0067 preserves an original single-window payout, its immutable sources and exact replay',async t=>{
  const f=await setupPayoutFixture(t,{through:65}),cap=await f.payoutStatus(),pair=await f.collectPayout();
  const result=await f.reconcilePayout(pair,cap);assert.equal(result.status,200,result.error);await f.refreshEarnings(pair);
  const before=await f.readPayout(),tables=['commerce_provider_financial_observations','commerce_provider_financial_collections','commerce_provider_collection_observations','commerce_payout_assessments','commerce_financial_journals','commerce_financial_entries'];
  const rows=await Promise.all(tables.map(table=>f.db.prepare('SELECT * FROM '+table).all()));
  await applyCommerceSchema(f.db,65,67);
  const after=await Promise.all(tables.map(table=>f.db.prepare('SELECT * FROM '+table).all()));assert.deepEqual(after.map(x=>x.results),rows.map(x=>x.results));
  assert.deepEqual(await f.readPayout(),before);assert.equal((await f.reconcilePayout(pair,cap)).replayed,true);
  assert.deepEqual((await f.db.prepare('PRAGMA foreign_key_check').all()).results,[]);
});
