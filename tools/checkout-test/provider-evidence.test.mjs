import test from 'node:test';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {generateKeyPairSync,randomBytes} from 'node:crypto';
import {writeFile} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {setupCentralFixture} from './central-fixture.mjs';

const root=resolve(import.meta.dirname,'../..'),base='/internal/commerce/finance/provider-evidence';
const key=generateKeyPairSync('rsa',{modulusLength:2048}).privateKey.export({type:'pkcs8',format:'pem'});
async function fixture(t){
  const f=await setupCentralFixture(t,{EZKART_TEST_WALLET:'1',EZKART_DOKU_SANDBOX_SNAP_PRIVATE_KEY:key,EZKART_DOKU_SANDBOX_PARENT_PROFILE_ID:'BRN-fixture'});
  const run=code=>new Promise((resolve,reject)=>{const p=spawn(process.env.PHP_BINARY||'php',['-n','-r',`require ${JSON.stringify(join(root,'tools/checkout-test/provider-fixture.php'))}; require ${JSON.stringify(join(root,'cart/api/commerce-wallet-jobs.php'))}; ${code}`],{env:f.app.env});let output='',error='';p.stdout.on('data',x=>output+=x);p.stderr.on('data',x=>error+=x);p.on('error',reject);p.on('close',status=>resolve({status,output,error}));});
  const result=await f.call('/internal/commerce/finance/wallet',{environment:'sandbox',seller:'seller_alice',actor:{id:'alice',email:'alice@example.test',proofExpiresAt:new Date(Date.now()+590000).toISOString()},action:'enroll',requestKey:randomBytes(16).toString('hex')});assert.equal(result.status,200,result.error);
  const connected=await run(`ez_wallet_process_enrollment('${result.enrollment.id}','sandbox');`);assert.equal(connected.status,0,connected.error);
  const account=(await f.call('/internal/commerce/finance/provider-account?seller=seller_alice&environment=sandbox')).account;
  const to=new Date(Date.now()-60000).toISOString().replace(/\.\d{3}Z$/,'Z'),from=new Date(Date.now()-86400000).toISOString().replace(/\.\d{3}Z$/,'Z');
  const transaction=(id,extra={})=>({referenceNo:id,partnerReferenceNo:'EZK-observed-order',transactionType:'PAYMENT',mutationType:'CREDIT',amount:'9007199254740993',currency:'IDR',status:'SUCCESS',dateTime:from,channel:'VIRTUAL_ACCOUNT_BCA',remark:'',...extra});
  const setHistory=(cash,pending=[])=>writeFile(join(f.app.directory,'wallet-history.json'),JSON.stringify({[account.cashAccount]:cash,[account.pendingAccount]:pending}));
  const collect=(pages=10,changes={})=>{const args=['collect-provider-evidence.php',...Object.entries({environment:'sandbox',seller:'seller_alice',from,to,'max-pages':String(pages),...changes}).map(([k,v])=>'--'+k+'='+v)];return run(`$argv=json_decode(base64_decode('${Buffer.from(JSON.stringify(args)).toString('base64')}'),true); require ${JSON.stringify(join(root,'tools/commerce/collect-provider-evidence.php'))};`);};
  return {...f,account,transaction,setHistory,collect,run};
}

test('seller evidence CLI records exact provider reads durably, including lost database acknowledgements, without money journals',async t=>{
  const f=await fixture(t);await f.setHistory([f.transaction('first'),f.transaction('first')],[f.transaction('pending',{status:'PENDING'})]);f.control.drop=base;
  const result=await f.collect();assert.equal(result.status,0,result.error+result.output);const report=JSON.parse(result.output);assert.equal(report.responses,4);assert.equal(report.pagesExhausted,true);assert.equal(report.settlementVerified,false);assert.equal(report.atomicSnapshot,false);
  assert.deepEqual(report.rows,{DOKU_MERCHANT_IDR:2,DOKU_MERCHANT_PENDING_IDR:1});
  assert.equal(await f.count('commerce_provider_financial_observations'),4);assert.equal(await f.count('commerce_provider_transaction_observations'),3);assert.equal(await f.count('commerce_financial_journals'),0);
  assert.equal(f.control.calls.filter(c=>c.path===base).length,5);const read=await f.call(base+'?seller=seller_alice&environment=sandbox');assert.equal(read.items[2].data.items[0].amount,'9007199254740993');
  const provider=(await f.app.calls()).filter(c=>c.url.endsWith('/transaction-history-list'));assert.equal(provider.length,2);assert(provider.every(c=>JSON.parse(c.body).pageSize==='20'));
  assert(!result.output.includes(f.account.cashAccount));assert(!result.output.includes('fixture-snap-wallet-token'));assert.equal((await fetch(f.app.base+'/tools/commerce/collect-provider-evidence.php')).status,404);
});

test('a truncated provider window is reported incomplete and a storage outage stops subsequent provider reads',async t=>{
  const f=await fixture(t);await f.setHistory(Array.from({length:21},(_,i)=>f.transaction('entry-'+i)));
  const limited=await f.collect(1);assert.equal(limited.status,2,limited.error);assert.equal(JSON.parse(limited.output).pagesExhausted,false);assert.equal(await f.count('commerce_provider_transaction_observations'),20);
  const before=(await f.app.calls()).filter(c=>c.url.endsWith('/transaction-history-list')).length;f.control.fail=base;
  const failed=await f.collect();assert.equal(failed.status,1);assert.match(failed.error,/Saved observations remain available/);assert.equal((await f.app.calls()).filter(c=>c.url.endsWith('/transaction-history-list')).length,before);assert.equal(await f.count('commerce_provider_financial_observations'),4);
});

test('collection refuses foreign scopes and production, preserves partial pages, and rejects provider account changes',async t=>{
  const f=await fixture(t);const before=(await f.app.calls()).filter(c=>c.url.includes('doku.com')).length;
  for(const changes of [{seller:'seller_bob'},{environment:'production'},{from:'2026-02-31T00:00:00Z'}])assert.equal((await f.collect(10,changes)).status,1);
  assert.equal((await f.app.calls()).filter(c=>c.url.includes('doku.com')).length,before);
  const duplicate=f.transaction('duplicate');await f.setHistory(Array.from({length:21},()=>duplicate));const overlap=await f.collect();assert.equal(overlap.status,1);assert.match(overlap.error,/history_overlap/);assert.equal(await f.count('commerce_provider_financial_observations'),3);
  await writeFile(join(f.app.directory,'wallet-control.json'),JSON.stringify({wrongConfirmation:true}));const changed=await f.collect();assert.equal(changed.status,1);assert.equal(await f.count('commerce_provider_financial_observations'),3);assert.equal(await f.count('commerce_financial_journals'),0);
});
