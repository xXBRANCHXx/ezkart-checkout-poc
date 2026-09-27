import test from 'node:test';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {generateKeyPairSync,randomBytes} from 'node:crypto';
import {writeFile,chmod} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {setupCentralFixture} from './central-fixture.mjs';

const root=resolve(import.meta.dirname,'../..'),base='/internal/commerce/finance/provider-evidence',collections='/internal/commerce/finance/provider-collections';
const key=generateKeyPairSync('rsa',{modulusLength:2048}).privateKey.export({type:'pkcs8',format:'pem'});
async function fixture(t,{beta=false}={}){
  const environment=beta?'production':'sandbox';
  const f=await setupCentralFixture(t,{EZKART_TEST_WALLET:'1',EZKART_DOKU_SANDBOX_SNAP_PRIVATE_KEY:key,EZKART_DOKU_SANDBOX_PARENT_PROFILE_ID:'BRN-fixture',...(beta?{EZKART_DEPLOYMENT_ENVIRONMENT:'beta',EZKART_COMMERCE_ENVIRONMENT:'production',EZKART_CLOUDFLARE_API_URL:'https://ezkart-api-beta.fixture.workers.dev',EZKART_DOKU_PRODUCTION_SNAP_PRIVATE_KEY:key,EZKART_DOKU_PRODUCTION_PARENT_PROFILE_ID:'BRN-fixture'}:{})},beta?{bindings:{APP_ENVIRONMENT:'beta'}}:{});
  const run=(code,overrides={})=>new Promise((resolve,reject)=>{const p=spawn(process.env.PHP_BINARY||'php',['-n','-r',`require ${JSON.stringify(join(root,'tools/checkout-test/provider-fixture.php'))}; require ${JSON.stringify(join(root,'cart/api/commerce-wallet-jobs.php'))}; ${code}`],{env:{...f.app.env,...overrides}});let output='',error='';p.stdout.on('data',x=>output+=x);p.stderr.on('data',x=>error+=x);p.on('error',reject);p.on('close',status=>resolve({status,output,error}));});
  const result=await f.call('/internal/commerce/finance/wallet',{environment,seller:'seller_alice',actor:{id:'alice',email:'alice@example.test',proofExpiresAt:new Date(Date.now()+590000).toISOString()},action:'enroll',requestKey:randomBytes(16).toString('hex')});assert.equal(result.status,200,result.error);
  const connected=await run(`ez_wallet_process_enrollment('${result.enrollment.id}','${environment}');`);assert.equal(connected.status,0,connected.error);
  const account=(await f.call('/internal/commerce/finance/provider-account?seller=seller_alice&environment='+environment)).account;
  const to=new Date(Date.now()-60000).toISOString().replace(/\.\d{3}Z$/,'Z'),from=new Date(Date.now()-86400000).toISOString().replace(/\.\d{3}Z$/,'Z');
  const transaction=(id,extra={})=>({referenceNo:id,partnerReferenceNo:'EZK-observed-order',transactionType:'PAYMENT',mutationType:'CREDIT',amount:'9007199254740993',currency:'IDR',status:'SUCCESS',dateTime:from,channel:'VIRTUAL_ACCOUNT_BCA',remark:'',...extra});
  const setHistory=(cash,pending=[])=>writeFile(join(f.app.directory,'wallet-history.json'),JSON.stringify({[account.cashAccount]:cash,[account.pendingAccount]:pending}));
  const collect=(pages=10,changes={},overrides={})=>{const args=['collect-provider-evidence.php',...Object.entries({environment,seller:'seller_alice',from,to,'max-pages':String(pages),...changes}).map(([k,v])=>'--'+k+'='+v)];return run(`$argv=json_decode(base64_decode('${Buffer.from(JSON.stringify(args)).toString('base64')}'),true); require ${JSON.stringify(join(root,'tools/commerce/collect-provider-evidence.php'))};`,overrides);};
  const finalize=(file,overrides={})=>{const args=['finalize-provider-collection.php','--receipt-file='+file];return run(`$argv=json_decode(base64_decode('${Buffer.from(JSON.stringify(args)).toString('base64')}'),true); require ${JSON.stringify(join(root,'tools/commerce/finalize-provider-collection.php'))};`,overrides);};
  return {...f,account,transaction,setHistory,collect,run,finalize};
}

test('seller evidence CLI records exact provider reads durably, including lost database acknowledgements, without money journals',async t=>{
  const f=await fixture(t);await f.setHistory([f.transaction('first'),f.transaction('first')],[f.transaction('pending',{status:'PENDING'})]);f.control.drop=base;
  const result=await f.collect();assert.equal(result.status,0,result.error+result.output);const report=JSON.parse(result.output);assert.equal(report.responses,4);assert.equal(report.pagesExhausted,true);assert.equal(report.settlementVerified,false);assert.equal(report.atomicSnapshot,false);
  assert.deepEqual(report.rows,{DOKU_MERCHANT_IDR:2,DOKU_MERCHANT_PENDING_IDR:1});
  assert.equal(await f.count('commerce_provider_financial_observations'),4);assert.equal(await f.count('commerce_provider_transaction_observations'),3);assert.equal(await f.count('commerce_financial_journals'),0);
  const saved=await f.call(collections+'/'+report.collectionId+'?seller=seller_alice&environment=sandbox');assert.equal(saved.status,200,saved.error);assert.equal(saved.collection.pagesExhausted,true);assert.equal(saved.collection.coverage.DOKU_MERCHANT_IDR.rows,2);assert.equal(saved.collection.coverage.DOKU_MERCHANT_PENDING_IDR.rows,1);
  assert.equal(await f.count('commerce_provider_financial_collections'),1);assert.equal(await f.count('commerce_provider_collection_observations'),4);
  assert.equal(f.control.calls.filter(c=>c.path===base).length,5);const read=await f.call(base+'?seller=seller_alice&environment=sandbox');assert.equal(read.items[2].data.items[0].amount,'9007199254740993');
  const provider=(await f.app.calls()).filter(c=>c.url.endsWith('/transaction-history-list'));assert.equal(provider.length,2);assert(provider.every(c=>JSON.parse(c.body).pageSize==='20'));
  assert(!result.output.includes(f.account.cashAccount));assert(!result.output.includes('fixture-snap-wallet-token'));assert.equal((await fetch(f.app.base+'/tools/commerce/collect-provider-evidence.php')).status,404);
});

test('a truncated provider window is reported incomplete and a storage outage stops subsequent provider reads',async t=>{
  const f=await fixture(t);await f.setHistory(Array.from({length:21},(_,i)=>f.transaction('entry-'+i)));
  const limited=await f.collect(1);assert.equal(limited.status,2,limited.error);assert.equal(JSON.parse(limited.output).pagesExhausted,false);assert.equal(await f.count('commerce_provider_transaction_observations'),20);
  const receipt=await f.call(collections+'/'+JSON.parse(limited.output).collectionId+'?seller=seller_alice&environment=sandbox');assert.equal(receipt.collection.pagesExhausted,false);
  const before=(await f.app.calls()).filter(c=>c.url.endsWith('/transaction-history-list')).length;f.control.fail=base;
  const failed=await f.collect();assert.equal(failed.status,1);assert.match(failed.error,/Saved observations remain available/);assert.equal((await f.app.calls()).filter(c=>c.url.endsWith('/transaction-history-list')).length,before);assert.equal(await f.count('commerce_provider_financial_observations'),4);
});

test('TEST collection refuses foreign scopes and production mode, preserves partial pages, and rejects provider account changes',async t=>{
  const f=await fixture(t);const before=(await f.app.calls()).filter(c=>c.url.includes('doku.com')).length;
  for(const changes of [{seller:'seller_bob'},{environment:'production'},{from:'2026-02-31T00:00:00Z'}])assert.equal((await f.collect(10,changes)).status,1);
  assert.equal((await f.app.calls()).filter(c=>c.url.includes('doku.com')).length,before);
  const duplicate=f.transaction('duplicate');await f.setHistory(Array.from({length:21},()=>duplicate));const overlap=await f.collect();assert.equal(overlap.status,1);assert.match(overlap.error,/history_overlap/);assert.equal(await f.count('commerce_provider_financial_observations'),3);
  assert.equal(await f.count('commerce_provider_financial_collections'),0);
  await writeFile(join(f.app.directory,'wallet-control.json'),JSON.stringify({wrongConfirmation:true}));const changed=await f.collect();assert.equal(changed.status,1);assert.equal(await f.count('commerce_provider_financial_observations'),3);assert.equal(await f.count('commerce_financial_journals'),0);
});

test('beta collection records live-mode reads without journals and rejects mode or deployment mismatches before provider access',async t=>{
  const f=await fixture(t,{beta:true});await f.setHistory([f.transaction('beta-read')]);
  const result=await f.collect();assert.equal(result.status,0,result.error+result.output);
  const report=JSON.parse(result.output);assert.equal(report.environment,'production');assert.equal(report.responses,4);assert.equal(report.settlementVerified,false);
  assert.equal(await f.count('commerce_provider_financial_observations'),4);assert.equal(await f.count('commerce_provider_transaction_observations'),1);assert.equal(await f.count('commerce_financial_journals'),0);
  assert.equal(await f.count('commerce_provider_financial_collections'),1);assert.equal((await f.call(collections+'/'+report.collectionId+'?seller=seller_alice&environment=production')).collection.pagesExhausted,true);
  const reads=(await f.app.calls()).filter(c=>c.url.endsWith('/transaction-history-list'));assert.equal(reads.length,2);assert(reads.every(c=>c.url.startsWith('https://api.doku.com/')));
  const before=(await f.app.calls()).length;
  for(const [changes,overrides] of [
    [{environment:'sandbox'},{}],
    [{},{EZKART_DEPLOYMENT_ENVIRONMENT:'production'}],
    [{},{EZKART_DEPLOYMENT_ENVIRONMENT:'test'}],
    [{},{EZKART_COMMERCE_ENVIRONMENT:'sandbox'}],
    [{},{EZKART_CLOUDFLARE_API_URL:'https://ezkart-api-test.fixture.workers.dev'}],
  ])assert.equal((await f.collect(10,changes,overrides)).status,1);
  assert.equal((await f.app.calls()).length,before);assert.equal(await f.count('commerce_financial_journals'),0);
  assert(!result.output.includes(f.account.cashAccount));assert(!result.output.includes('fixture-snap-wallet-token'));
});

test('a lost collection acknowledgement retries the same manifest without re-reading DOKU',async t=>{
  const f=await fixture(t);await f.setHistory([f.transaction('saved')]);f.control.drop=collections;
  const result=await f.collect();assert.equal(result.status,0,result.error+result.output);
  const attempts=f.control.calls.filter(c=>c.path===collections);assert.equal(attempts.length,2);assert.deepEqual(attempts[0].body,attempts[1].body);
  assert.equal(await f.count('commerce_provider_financial_collections'),1);assert.equal(await f.count('commerce_provider_financial_observations'),4);
  assert.equal((await f.app.calls()).filter(c=>c.url.endsWith('/transaction-history-list')).length,2);
});

test('finalization outage emits a recoverable private manifest and recovery never calls the provider',async t=>{
  const f=await fixture(t,{beta:true});await f.setHistory([f.transaction('recover')]);f.control.fail=collections;
  const failed=await f.collect();assert.equal(failed.status,1);const receipt=JSON.parse(failed.error);
  assert.equal(receipt.pendingCollection.environment,'production');assert.equal(receipt.pendingCollection.observationIds.length,4);
  assert(!failed.error.includes(f.account.cashAccount));assert(!failed.error.includes('fixture-snap-wallet-token'));
  assert.equal(await f.count('commerce_provider_financial_collections'),0);assert.equal(await f.count('commerce_provider_financial_observations'),4);
  const file=join(f.app.directory,'pending-collection.json');await writeFile(file,failed.error,{mode:0o600});
  const before=(await f.app.calls()).length;f.control.fail='';
  const recovered=await f.finalize(file);assert.equal(recovered.status,0,recovered.error);const id=JSON.parse(recovered.output).collectionId;
  assert.equal((await f.finalize(file)).status,0);assert.equal(await f.count('commerce_provider_financial_collections'),1);
  const recoveryCalls=(await f.app.calls()).slice(before);assert.equal(recoveryCalls.length,2);
  assert(recoveryCalls.every(call=>call.url==='https://ezkart-api-beta.fixture.workers.dev'+collections),JSON.stringify(recoveryCalls.map(call=>call.url)));
  assert.deepEqual((await f.call(collections+'/'+id+'?seller=seller_alice&environment=production')).collection.observationIds,receipt.pendingCollection.observationIds);
  const serviceCalls=f.control.calls.length;
  assert.equal((await f.finalize(file,{EZKART_DEPLOYMENT_ENVIRONMENT:'production'})).status,1);
  assert.equal((await f.finalize(file,{EZKART_CLOUDFLARE_API_URL:'https://ezkart-api-test.fixture.workers.dev'})).status,1);
  await chmod(file,0o644);assert.equal((await f.finalize(file)).status,1);assert.equal(f.control.calls.length,serviceCalls);
  assert.equal((await fetch(f.app.base+'/tools/commerce/finalize-provider-collection.php')).status,404);
  assert.equal(await f.count('commerce_financial_journals'),0);
});
