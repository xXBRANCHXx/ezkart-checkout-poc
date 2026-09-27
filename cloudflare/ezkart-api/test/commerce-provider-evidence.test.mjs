import test from 'node:test';
import assert from 'node:assert/strict';
import {randomBytes} from 'node:crypto';
import {setupCommerceFixture} from './commerce-fixture.mjs';
import {parseFinancialEvidenceJSON,FinancialJsonNumber} from '../src/financial-evidence-json.js';

const base='/internal/commerce/finance/provider-evidence',wallet='/internal/commerce/finance/wallet',fingerprint='a'.repeat(64);
const now=()=>new Date().toISOString().replace(/\.\d{3}Z$/,'Z'),ref=()=>Array.from(randomBytes(32),n=>n%10).join('');
const accounts=(cash='2010000001',pending='2030000001')=>[{type:'DOKU_MERCHANT_IDR',currency:'IDR',accountNo:cash,balance:{available:'0.00',reserved:'0.00'}},{type:'DOKU_MERCHANT_PENDING_IDR',currency:'IDR',accountNo:pending,balance:{available:'0.00',reserved:'0.00'}}];
async function fixture(t){
  const f=await setupCommerceFixture(t);
  const enrollment=await f.call(wallet,{environment:'sandbox',seller:'seller_alice',actor:{id:'alice',email:'alice@example.test',proofExpiresAt:new Date(Date.now()+590000).toISOString()},action:'enroll',requestKey:randomBytes(16).toString('hex')});assert.equal(enrollment.status,200,enrollment.error);
  const e=enrollment.enrollment.id,path=wallet+'/registrations/'+e;
  const job=(await f.call('/internal/commerce/jobs/claim',{environment:'sandbox',workerId:'evidence_fixture',kinds:['wallet.register'],limit:1})).jobs[0];
  assert.equal((await f.call(path+'/bind',{environment:'sandbox',workerId:'evidence_fixture',leaseToken:job.leaseToken,credentialFingerprint:fingerprint,clientId:'MCH-fixture',parentProfileId:'BRN-fixture'})).status,200);
  const registration={responseCode:'2000000',profileId:'SAC-fixture',parentProfileId:'BRN-fixture',accounts:accounts().map(({balance,...a})=>a)};
  const balance={responseCode:'2000000',profileId:'SAC-fixture',name:'alice',accounts:accounts()};
  assert.equal((await f.call(path+'/receipt',{environment:'sandbox',credentialFingerprint:fingerprint,registrationBody:JSON.stringify(registration)})).status,200);
  assert.equal((await f.call(path+'/record',{environment:'sandbox',credentialFingerprint:fingerprint,confirmationBody:JSON.stringify(balance)})).status,200);
  const evidence=(operation='balance-inquiries',request={profileId:'SAC-fixture'},response=balance)=>({seller:'seller_alice',environment:'sandbox',evidence:{environment:'sandbox',credentialFingerprint:fingerprint,operation,externalId:ref(),requestedAt:now(),observedAt:now(),requestBody:JSON.stringify(request),responseBody:JSON.stringify(response)}});
  const from=new Date(Date.now()-3600000).toISOString().replace(/\.\d{3}Z$/,'Z'),to=now();
  const transaction=(extra={})=>({referenceNo:'group_reference',transactionType:'SETTLEMENT_FEE',mutationType:'DEBIT',amount:2500,currency:'IDR',status:'SUCCESS',dateTime:from,...extra});
  const history=(items=[transaction()],request={})=>evidence('transaction-history-list',{accountNo:'2010000001',fromDateTime:from,toDateTime:to,pageSize:'20',pageNumber:'0',...request},{responseCode:'2000000',detailData:items});
  const list=(suffix='')=>f.call(base+'?seller=seller_alice&environment=sandbox'+suffix);
  return {...f,enrollmentId:e,evidence,balance,history,transaction,list,from,to};
}

test('financial JSON preserves exact numeric tokens and rejects ambiguous keys, malformed Unicode and incomplete values',()=>{
  const parsed=parseFinancialEvidenceJSON('{"amount":9007199254740993,"word":"9007199254740993","__proto__":{"safe":true}}');
  assert(parsed.amount instanceof FinancialJsonNumber);assert.equal(parsed.amount.value,'9007199254740993');assert.equal(parsed.word,'9007199254740993');assert.equal(Object.getPrototypeOf(parsed),null);assert.equal(parsed.__proto__.safe,true);
  for(const raw of ['{"a":1,"a":2}','{"a":1,"\\u0061":2}','{"x":"\\uD800"}','{"x":01}','{"x":1,}','{"x":[1,]}','{"x":NaN}','{}{}','\u00a0{}','['.repeat(26)+'0'+']'.repeat(26),' '.repeat(48001)])assert.throws(()=>parseFinancialEvidenceJSON(raw),raw.slice(0,80));
  assert.equal(parseFinancialEvidenceJSON('"\\ud83c\\udf75"'),'🍵');
});

test('provider evidence needs service authentication, confirmed seller mapping and its pinned credential identity',async t=>{
  const f=await fixture(t);assert.equal((await f.merchant(base,f.evidence(),{method:'POST'})).status,401);
  assert.equal((await f.call('/internal/commerce/finance/provider-account?seller=seller_alice&environment=sandbox')).account.profileId,'SAC-fixture');
  for(const input of [{...f.evidence(),seller:'seller_bob'},{...f.evidence(),environment:'production'},{...f.evidence(),actor:'owner'}]){const result=await f.call(base,input);assert([403,409,422].includes(result.status),JSON.stringify(result));}
  const foreign=f.evidence();foreign.evidence.credentialFingerprint='b'.repeat(64);assert.equal((await f.call(base,foreign)).status,409);
  for(const change of [{observedAt:new Date(Date.now()+120000).toISOString()},{requestedAt:'0000-01-01T00:00:00+14:00'},{operation:'transfer-payment'},{requestedAt:f.to,observedAt:f.from}]){const payload=f.evidence();Object.assign(payload.evidence,change);assert.equal((await f.call(base,payload)).status,422);}
  for(const suffix of ['&seller=seller_bob','&limit=21','&before=0','&account=2010000001'])assert.equal((await f.list(suffix)).status,422);
  assert.equal((await f.call('/internal/commerce/finance/provider-account?seller=seller_bob&environment=sandbox')).status,409);
  assert.equal((await f.list()).items.length,0);
});

test('concurrent observations replay one immutable receipt and cannot reuse a provider request with changed facts',async t=>{
  const f=await fixture(t),payload=f.evidence();const results=await Promise.all([f.call(base,payload),f.call(base,payload)]);
  assert(results.every(r=>r.status===200),JSON.stringify(results));assert.equal(results[0].id,results[1].id);
  assert.equal((await f.db.prepare('SELECT COUNT(*) AS n FROM commerce_provider_balance_observations').first()).n,2);
  const changed=structuredClone(payload);changed.evidence.responseBody=JSON.stringify({...f.balance,name:'changed'});assert.equal((await f.call(base,changed)).status,409);
  for(const table of ['commerce_provider_financial_observations','commerce_provider_balance_observations']){
    await assert.rejects(f.db.prepare('DELETE FROM '+table).run(),/immutable/);
    await assert.rejects(f.db.prepare('INSERT OR REPLACE INTO '+table+' SELECT * FROM '+table).run(),/immutable/);
  }
  const list=await f.list();assert.equal(list.items.length,1);assert.equal(list.settlementVerified,false);assert.equal(list.availableToWithdraw,null);
  assert.equal((await f.db.prepare('SELECT COUNT(*) AS n FROM commerce_financial_journals').first()).n,0);
});

test('balances preserve signed exact rupiah above 2^53 and reject changed accounts and fractional or exponential amounts',async t=>{
  const f=await fixture(t),payload=f.evidence();payload.evidence.responseBody=payload.evidence.responseBody.replace('"available":"0.00"','"available":9007199254740993').replace('"reserved":"0.00"','"reserved":"-12.00"');
  const saved=await f.call(base,payload);assert.equal(saved.status,200,saved.error);const row=(await f.list()).items[0];assert.equal(row.data.accounts[0].available,'9007199254740993');assert.equal(row.data.accounts[0].reserved,'-12');
  assert.equal((await f.db.prepare("SELECT available_amount FROM commerce_provider_balance_observations WHERE account_type='DOKU_MERCHANT_IDR'").first()).available_amount,'9007199254740993');
  for(const value of ['"1.01"','1e3','"9223372036854775808"','null','true']){const bad=f.evidence();bad.evidence.responseBody=bad.evidence.responseBody.replace('"available":"0.00"','"available":'+value);assert.equal((await f.call(base,bad)).status,422);}
  for(const accountsValue of [accounts('2010000099'),[accounts()[0],accounts()[0]],accounts().slice(0,1)])assert.equal((await f.call(base,f.evidence('balance-inquiries',{profileId:'SAC-fixture'},{...f.balance,accounts:accountsValue}))).status,422);
  const duplicate=f.evidence();duplicate.evidence.responseBody=duplicate.evidence.responseBody.replace('"responseCode":"2000000"','"responseCode":"2000000","responseCode":"2000000"');assert.equal((await f.call(base,duplicate)).status,422);
});

test('live numeric balance account IDs bind exact original seller accounts while preserving raw provider evidence',async t=>{
  const f=await fixture(t),payload=f.evidence();payload.evidence.responseBody=payload.evidence.responseBody.replaceAll('"2010000001"','2010000001').replaceAll('"2030000001"','2030000001');
  const result=await f.call(base,payload);assert.equal(result.status,200,result.error);
  const saved=await f.db.prepare('SELECT response_json FROM commerce_provider_financial_observations WHERE id=?').bind(result.id).first();assert.equal(saved.response_json,payload.evidence.responseBody);
  const report=await f.list();assert.deepEqual(report.items[0].data.accounts.map(a=>a.accountNo),['2010000001','2030000001']);
  for(const token of ['2010000001.0','2.010000001e9','10000000000','-2010000001','true']){
    const bad=f.evidence();bad.evidence.responseBody=bad.evidence.responseBody.replace('"2010000001"',token);assert.equal((await f.call(base,bad)).status,422,token);
  }
  assert.equal((await f.list()).items.length,1);assert.equal((await f.db.prepare('SELECT COUNT(*) AS n FROM commerce_financial_journals').first()).n,0);
});

test('history preserves repeated rows, missing partner references, exact amounts and changed statuses as separate observations',async t=>{
  const f=await fixture(t),entry=f.transaction({amount:'9007199254740993',dateTime:f.from.replace('Z','.123456Z')});
  const saved=await f.call(base,f.history([entry,entry]));assert.equal(saved.status,200,saved.error);
  assert.equal((await f.db.prepare('SELECT COUNT(*) AS n FROM commerce_provider_transaction_observations').first()).n,2);
  const later=await f.call(base,f.history([{...entry,status:'VOID'}]));assert.equal(later.status,200,later.error);
  const list=await f.list();assert.equal(list.items[0].data.items[0].status,'VOID');assert.equal(list.items[1].data.items.length,2);assert.equal(list.items[1].data.items[0].partnerReferenceNo,null);assert.equal(list.items[1].data.items[0].amount,'9007199254740993');assert.match(list.items[1].data.items[0].dateTime,/\.123456Z$/);
  await assert.rejects(f.db.prepare("UPDATE commerce_provider_transaction_observations SET amount='0'").run(),/immutable/);
  await assert.rejects(f.db.prepare('INSERT OR REPLACE INTO commerce_provider_transaction_observations SELECT * FROM commerce_provider_transaction_observations').run(),/immutable/);
  for(const change of [{accountNo:'foreign'},{accountNo:'2010000099'},{pageSize:'100'},{pageNumber:'00'},{fromDateTime:f.to,toDateTime:f.from}])assert.equal((await f.call(base,f.history([entry],change))).status,422);
  for(const item of [f.transaction({amount:'-1'}),f.transaction({currency:'POINT'}),f.transaction({status:'UNKNOWN'}),f.transaction({dateTime:'2026-02-31T00:00:00Z'})])assert.equal((await f.call(base,f.history([item]))).status,422);
});

test('observation inserts and all derived rows roll back together, with stable private paging across newer evidence',async t=>{
  const f=await fixture(t);await f.db.prepare("CREATE TRIGGER fail_provider_row BEFORE INSERT ON commerce_provider_transaction_observations BEGIN SELECT RAISE(ABORT,'fixture_derived_failure'); END").run();
  const payload=f.history();assert.equal((await f.call(base,payload)).status,500);assert.equal((await f.list()).items.length,0);
  await f.db.prepare('DROP TRIGGER fail_provider_row').run();assert.equal((await f.call(base,payload)).status,200);
  assert.equal((await f.call(base,f.evidence())).status,200);const first=await f.list('&limit=1');assert(first.nextBefore);
  assert.equal((await f.call(base,f.evidence())).status,200);const second=await f.list('&limit=1&cap='+first.cap+'&before='+first.nextBefore);assert.equal(second.items.length,1);assert.equal(second.nextBefore,null);assert.equal(second.items[0].operation,'transaction-history-list');
  assert.equal((await f.call(base+'?seller=seller_bob&environment=sandbox')).items.length,0);
});
