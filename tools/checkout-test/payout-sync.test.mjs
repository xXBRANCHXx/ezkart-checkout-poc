import test from 'node:test';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {generateKeyPairSync,randomBytes} from 'node:crypto';
import {mkdtemp,mkdir,rm,writeFile,readFile,readdir,stat,chmod,symlink,copyFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {setupCentralFixture} from './central-fixture.mjs';
import {setupWithdrawalInquiryFixture,withdrawalPath} from '../../cloudflare/ezkart-api/test/withdrawal-inquiry-fixture.mjs';
import {payoutFixture} from '../../cloudflare/ezkart-api/test/payout-fixture.mjs';
import {seedRoutingWallets} from '../../cloudflare/ezkart-api/test/payment-routing-fixture.mjs';
import {shippingConfiguration} from '../../cloudflare/ezkart-api/test/commerce-fixture.mjs';

const root=resolve(import.meta.dirname,'../..'),key=generateKeyPairSync('rsa',{modulusLength:2048}).privateKey.export({format:'pem',type:'pkcs8'});
const evidencePath='/internal/commerce/finance/provider-evidence',collectionPath='/internal/commerce/finance/provider-collections';
async function fixture(t,{beta=false,queue=false}={}){
  const environment=beta?'production':'sandbox',recovery=await mkdtemp(join(tmpdir(),'ezkart-payout-sync-'));
  t.after(()=>rm(recovery,{recursive:true,force:true}));
  const bindings={COMMERCE_PLATFORM_WALLET_SELLER:'seller_bob',COMMERCE_WITHDRAWAL_INQUIRY:'enabled',COMMERCE_WITHDRAWAL_PAYMENT:'enabled',...(queue?{COMMERCE_WITHDRAWAL_SYNC:'enabled'}:{}),...(beta?{APP_ENVIRONMENT:'beta'}:{})};
  const base=await setupCentralFixture(t,{EZKART_TEST_WALLET:'1',EZKART_COMMERCE_WITHDRAWAL_SYNC:'enabled',EZKART_COMMERCE_WITHDRAWAL_RECOVERY_DIRECTORY:recovery,EZKART_COMMERCE_WITHDRAWAL_SYNC_STORAGE:'fixture_private_receipts',
    EZKART_DOKU_SANDBOX_SNAP_PRIVATE_KEY:key,EZKART_DOKU_SANDBOX_PARENT_PROFILE_ID:'BRN-fixture',
    ...(beta?{EZKART_DEPLOYMENT_ENVIRONMENT:'beta',EZKART_COMMERCE_ENVIRONMENT:'production',EZKART_CLOUDFLARE_API_URL:'https://ezkart-api-beta.fixture.workers.dev',
      EZKART_DOKU_PRODUCTION_SNAP_PRIVATE_KEY:key,EZKART_DOKU_PRODUCTION_PARENT_PROFILE_ID:'BRN-fixture'}:{})},{bindings});
  const php=(code,overrides={})=>new Promise((resolve,reject)=>{
    const child=spawn(process.env.PHP_BINARY||'php',['-n','-r',`require ${JSON.stringify(join(root,'tools/checkout-test/provider-fixture.php'))}; ${code}`],{env:{...base.app.env,...overrides}});
    let output='',error='';child.stdout.on('data',x=>output+=x);child.stderr.on('data',x=>error+=x);child.on('error',reject);child.on('close',status=>resolve({status,output,error}));
  });
  const identityResult=await php(`require ${JSON.stringify(join(root,'cart/api/doku-sub-accounts.php'))}; echo json_encode(EzDokuSubAccountReader::configured('${environment}')->providerIdentity());`);
  assert.equal(identityResult.status,0,identityResult.error);const identity=JSON.parse(identityResult.output);
  const f=await setupWithdrawalInquiryFixture(t,{baseFixture:base,bindings,fingerprint:identity.credentialFingerprint,clientId:identity.clientId});
  const grant=async()=>{
    const w=await f.reserve(),i=await f.start(w,{credentialFingerprint:identity.credentialFingerprint,clientId:identity.clientId});assert.equal(i.status,200,i.error);
    const r=await f.receipt(w,f.evidence(i)),c=await f.confirm(w,r.inquiryDigest);
    const g=await f.call(withdrawalPath+'/'+w.id+'/payment/start',{...f.scope(),credentialFingerprint:identity.credentialFingerprint,clientId:identity.clientId,confirmationId:c.confirmation.id});
    assert.equal(g.status,200,g.error);return {w,g,...payoutFixture(f,w,g)};
  };
  const current=await grant(),scope=await f.call(current.path+'/payout/sync-scope',{environment});assert.equal(scope.status,200,scope.error);
  const accounts=[scope.original.sellerAccount,scope.original.platformAccount];
  await writeFile(join(f.app.directory,'wallet-profiles.json'),JSON.stringify(Object.fromEntries(accounts.map((a,i)=>[i,{responseCode:'2000000',profileId:a.profileId,accounts:[
    {type:'DOKU_MERCHANT_IDR',currency:'IDR',accountNo:a.cashAccount},{type:'DOKU_MERCHANT_PENDING_IDR',currency:'IDR',accountNo:a.pendingAccount}]}]))));
  const control=value=>writeFile(join(f.app.directory,'wallet-control.json'),JSON.stringify(value));
  await control({statusResponse:{latestTransactionStatus:'00',latestTransactionDesc:'success'}});
  const history=async({fee=2500,sellerFee=false,payouts=[current],extra=[]}={})=>{
    const rows=f.legs(f.p);
    for(const p of payouts){rows.sellerCash.push(p.row('PAYOUT',250000));rows[sellerFee?'sellerCash':'platformCash'].push(p.row('PAYOUT_CHARGE',fee));}
    rows.sellerCash.push(...extra);
    for(const items of Object.values(rows))items.sort((a,b)=>b.dateTime.localeCompare(a.dateTime));
    await writeFile(join(f.app.directory,'wallet-history.json'),JSON.stringify(Object.fromEntries([
      [accounts[0].cashAccount,rows.sellerCash],[accounts[0].pendingAccount,rows.sellerPending],[accounts[1].cashAccount,rows.platformCash],[accounts[1].pendingAccount,rows.platformPending]])));
    // The real history API's completed boundary has second precision.
    await new Promise(resolve=>setTimeout(resolve,1005-Date.now()%1000));
  };
  await history();
  const run=randomBytes(16).toString('hex'),directory=join(recovery,current.w.id+'-sync-'+run);
  const sync=(changes={},overrides={})=>{
    const args=['sync-withdrawal-payout.php',...Object.entries({environment,withdrawal:current.w.id,run,mode:'collect',...changes}).map(([k,v])=>'--'+k+'='+v)];
    return php(`$argv=json_decode(base64_decode('${Buffer.from(JSON.stringify(args)).toString('base64')}'),true); require ${JSON.stringify(join(root,'tools/commerce/sync-withdrawal-payout.php'))};`,overrides);
  };
  const reads=async()=>(await f.app.calls()).filter(c=>c.url.includes('/sub-account/v2.0/'));
  const funds=()=>f.call('/internal/commerce/finance/earnings/summary?seller=seller_alice&environment='+environment);
  const dispatch=(reads=20,overrides={})=>php(`$argv=['payout-sync-dispatch.php','--once','--max-reads=${reads}']; require ${JSON.stringify(join(root,'tools/commerce/payout-sync-dispatch.php'))};`,overrides);
  const scheduled=(reads=20,overrides={})=>php(`$argv=['payout-sync-scheduled.php','--once','--max-reads=${reads}']; require ${JSON.stringify(join(root,'tools/commerce/payout-sync-scheduled.php'))};`,overrides);
  return {...f,...current,php,identity,environment,recovery,directory,run,scope,history,controlProvider:control,sync,reads,grant,funds,dispatch,scheduled};
}

test('the scheduled beta runner records a held heartbeat with private storage and no provider reads',async t=>{
  const f=await fixture(t,{beta:true}),directory=join(f.recovery,'scheduled-private');
  const result=await f.scheduled(20,{EZKART_COMMERCE_WITHDRAWAL_SYNC:'held',EZKART_COMMERCE_WITHDRAWAL_RECOVERY_DIRECTORY:directory});
  assert.equal(result.status,0,result.error);const body=JSON.parse(result.output);assert.equal(body.state,'held');assert.equal(body.providerCalls,0);
  assert.equal((await f.reads()).length,0);assert.equal(await f.count('commerce_payout_sync_jobs'),0);
  const row=await f.db.prepare('SELECT * FROM commerce_payout_sync_runner').first();assert.equal(row.state,'held');assert.equal(row.runs,1);
  const saved=JSON.parse(await readFile(join(directory,'payout-sync-last-run.json'),'utf8'));assert.equal(saved.confirmed,true);
  assert.equal((await stat(directory)).mode&0o777,0o700);
  assert.equal((await stat(join(directory,'payout-sync-last-run.json'))).mode&0o777,0o600);
  assert.equal((await stat(join(directory,'payout-sync-scheduler.lock'))).mode&0o777,0o600);
  const unsafe=join(root,'runner-public-'+randomBytes(8).toString('hex'));
  assert.equal((await f.scheduled(20,{EZKART_COMMERCE_WITHDRAWAL_RECOVERY_DIRECTORY:unsafe})).status,1);
  await assert.rejects(stat(unsafe),{code:'ENOENT'});
  assert(!result.output.includes('fixture_private_receipts'));assert(!result.output.includes(f.w.id));
  for(const file of ['/cart/api/commerce-payout-sync-runner.php','/tools/commerce/payout-sync-scheduled.php'])assert.equal((await fetch(f.app.base+file)).status,404);
});

test('scheduled bounded work and lost runner acknowledgements preserve one payout and the original receipts',async t=>{
  const f=await fixture(t,{beta:true,queue:true}),base='/internal/commerce/finance/payout-sync/runner/';f.control.drop=base+'start';
  const first=await f.scheduled(2);assert.equal(first.status,2,first.error);assert.equal(JSON.parse(first.output).state,'retry');
  const initial=JSON.parse(await readFile(join(f.recovery,'payout-sync-last-run.json'),'utf8'));assert.equal(initial.confirmed,true);
  const starts=f.control.calls.filter(c=>c.path===base+'start');assert.equal(starts.length,2);assert.deepEqual(starts[0].body,starts[1].body);
  await f.db.prepare("UPDATE commerce_payout_sync_jobs SET available_at='2000-01-01T00:00:00.000Z'").run();f.control.drop=base+'finish';
  const done=await f.scheduled();assert.equal(done.status,0,done.error);assert.equal(JSON.parse(done.output).state,'completed');assert.equal((await f.reads()).length,9);
  const finished=f.control.calls.filter(c=>c.path===base+'finish');assert.equal(finished.length,3);assert.deepEqual(finished[1].body,finished[2].body);
  const row=await f.db.prepare('SELECT * FROM commerce_payout_sync_runner').first();assert.equal(row.runs,2);assert.equal(row.failed_runs,0);
  assert.equal((await f.db.prepare("SELECT COUNT(*) n FROM commerce_financial_journals WHERE kind='payout'").first()).n,1);
});

test('a prolonged runner completion outage recovers its exact saved result before another scheduled pass',async t=>{
  const f=await fixture(t,{beta:true,queue:true}),base='/internal/commerce/finance/payout-sync/runner/';f.control.fail=base+'finish';
  const failed=await f.scheduled();assert.equal(failed.status,1);assert.equal((await f.reads()).length,9);
  const file=join(f.recovery,'payout-sync-last-run.json'),original=JSON.parse(await readFile(file,'utf8'));assert.equal(original.confirmed,false);assert.equal(original.finish.result.state,'completed');
  await f.db.prepare("UPDATE commerce_payout_sync_runner SET lease_until='2000-01-01T00:00:00.000Z'").run();f.control.fail='';
  const recovered=await f.scheduled(20,{EZKART_COMMERCE_WITHDRAWAL_SYNC:'held',EZKART_DOKU_PRODUCTION_SNAP_PRIVATE_KEY:'unavailable'});
  assert.equal(recovered.status,0,recovered.error);assert.equal(JSON.parse(recovered.output).state,'held');assert.equal((await f.reads()).length,9);
  const finishes=f.control.calls.filter(c=>c.path===base+'finish');assert.deepEqual(finishes[2].body,original.finish);
  const row=await f.db.prepare('SELECT * FROM commerce_payout_sync_runner').first();assert.equal(row.runs,2);assert.equal(row.interrupted_runs,0);
  assert.equal((await f.db.prepare("SELECT COUNT(*) n FROM commerce_financial_journals WHERE kind='payout'").first()).n,1);
});

test('scheduled dispatch failures stay visible and foreign or unsafe runner receipts stop before provider access',async t=>{
  const f=await fixture(t,{beta:true,queue:true});f.control.fail='/internal/commerce/finance/payout-sync/schedule';
  const failed=await f.scheduled();assert.equal(failed.status,1,failed.error);assert.equal(JSON.parse(failed.output).state,'failed');
  assert.equal((await f.db.prepare('SELECT failed_runs FROM commerce_payout_sync_runner').first()).failed_runs,1);
  const file=join(f.recovery,'payout-sync-last-run.json'),saved=JSON.parse(await readFile(file,'utf8'));
  assert.equal((await f.scheduled(20,{EZKART_COMMERCE_WITHDRAWAL_SYNC_STORAGE:'different_storage'})).status,1);
  assert.deepEqual(JSON.parse(await readFile(file,'utf8')),saved);assert.equal((await f.reads()).length,0);
  await chmod(file,0o644);assert.equal((await f.scheduled()).status,1);assert.equal((await f.reads()).length,0);
});

test('overlapping scheduled processes share one private lock and cannot claim another run',async t=>{
  const f=await fixture(t,{beta:true});let release,arrived;
  const gate=new Promise(resolve=>release=resolve),started=new Promise(resolve=>arrived=resolve);
  f.control.afterResponse=async path=>{if(path.endsWith('/runner/start')){arrived();await gate;}};
  const first=f.scheduled(20,{EZKART_COMMERCE_WITHDRAWAL_SYNC:'held'});await started;
  try {
    const competing=await f.scheduled(20,{EZKART_COMMERCE_WITHDRAWAL_SYNC:'held'});
    assert.equal(competing.status,0,competing.error);assert.equal(JSON.parse(competing.output).state,'busy');
    assert.equal((await f.db.prepare('SELECT runs FROM commerce_payout_sync_runner').first()).runs,1);
  } finally {release();f.control.afterResponse=null;}
  const done=await first;assert.equal(done.status,0,done.error);assert.equal((await f.reads()).length,0);
});

test('the scheduled CLI loads the private parent settings when no web-server document root exists',async t=>{
  const directory=await mkdtemp(join(tmpdir(),'ezkart-scheduled-config-')),web=join(directory,'public_html');t.after(()=>rm(directory,{recursive:true,force:true}));
  await mkdir(join(web,'tools/commerce'),{recursive:true});await mkdir(join(web,'cart/api'),{recursive:true});
  const command=join(web,'tools/commerce/payout-sync-scheduled.php');await copyFile(join(root,'tools/commerce/payout-sync-scheduled.php'),command);
  await writeFile(join(directory,'config.runtime.php'),"<?php return ['runner_config_probe'=>'private-parent-loaded'];\n",{mode:0o600});
  await writeFile(join(web,'cart/api/commerce-payout-sync-runner.php'),`<?php require ${JSON.stringify(join(root,'cart/api/bootstrap.php'))}; function ez_run_scheduled_payout_sync(int $reads): array {return ['exitCode'=>0,'probe'=>ez_config('runner_config_probe'),'reads'=>$reads];}`);
  const result=await new Promise((resolve,reject)=>{
    const child=spawn(process.env.PHP_BINARY||'php',['-n',command,'--once','--max-reads=7'],{env:{PATH:process.env.PATH}});let output='',error='';
    child.stdout.on('data',x=>output+=x);child.stderr.on('data',x=>error+=x);child.on('error',reject);child.on('close',status=>resolve({status,output,error}));
  });
  assert.equal(result.status,0,result.error);assert.equal(JSON.parse(result.output).probe,'private-parent-loaded');assert.equal(JSON.parse(result.output).reads,7);
});

test('bounded provider reads resume the original common window and do not replay successful requests',async t=>{
  const f=await fixture(t);
  const first=await f.sync({'max-reads':'2'});assert.equal(first.status,2,first.error);assert.equal(JSON.parse(first.output).reason,'read_budget');
  const raw=await readFile(join(f.directory,'read-0001.json'),'utf8'),window=await readFile(join(f.directory,'window.json'),'utf8');
  assert.equal((await f.reads()).length,2);
  const second=await f.sync({'max-reads':'3'});assert.equal(second.status,2,second.error);assert.equal((await f.reads()).length,5);
  const last=await f.sync({'max-reads':'4'});assert.equal(last.status,0,last.error);assert.equal((await f.reads()).length,9);
  assert.equal(await readFile(join(f.directory,'read-0001.json'),'utf8'),raw);assert.equal(await readFile(join(f.directory,'window.json'),'utf8'),window);
});

test('an original version-one intent resumes without changing its plan or receipt layout',async t=>{
  const f=await fixture(t),legacy={version:1,run:f.run,original:f.scope.original,
    plan:{from:f.scope.plan.from,settlements:[{seller:'seller_alice',orderId:f.p.order.id}],withdrawals:[],truncated:false},maxPages:10};
  await mkdir(f.directory,{mode:0o700});const file=join(f.directory,'intent.json');await writeFile(file,JSON.stringify(legacy)+'\n',{mode:0o600});
  const raw=await readFile(file,'utf8'),result=await f.sync();assert.equal(result.status,0,result.error);
  assert.equal((await f.reads()).length,9);assert.equal(await readFile(file,'utf8'),raw);
  assert((await readdir(f.directory)).includes('status-boundary.json'));assert((await readdir(f.directory)).includes('selleraccount-collection.json'));
  const recovered=await f.sync({mode:'recover'},{EZKART_COMMERCE_WITHDRAWAL_SYNC:'held',EZKART_DOKU_SANDBOX_SNAP_PRIVATE_KEY:'missing'});
  assert.equal(recovered.status,0,recovered.error);assert.equal((await f.reads()).length,9);assert.equal(await f.count('commerce_payout_assessments'),1);
});

test('a saved provider failure stays visible on recovery and a new run can observe its resolution',async t=>{
  const f=await fixture(t);await f.controlProvider({statusFailure:true});
  const failed=await f.sync();assert.equal(failed.status,2,failed.error);assert.equal(JSON.parse(failed.output).relatedReviews[0].reason,'provider_read_failed');
  assert.equal(await f.count('commerce_payout_assessments'),0);const count=(await f.reads()).length;
  const original=await readFile(join(f.directory,'read-0001.json'),'utf8');assert.equal(JSON.parse(original).failure.status,503);
  await f.controlProvider({statusResponse:{latestTransactionStatus:'00'}});
  assert.equal((await f.sync({mode:'recover'},{EZKART_COMMERCE_WITHDRAWAL_SYNC:'held',EZKART_DOKU_SANDBOX_SNAP_PRIVATE_KEY:'missing'})).status,2);
  assert.equal((await f.reads()).length,count);assert.equal(await readFile(join(f.directory,'read-0001.json'),'utf8'),original);
  assert.equal((await f.sync({run:randomBytes(16).toString('hex')})).status,0);
});

test('the shared platform is read once for two sellers and both settlements remain current',async t=>{
  const f=await fixture(t);
  await f.db.batch([
    f.db.prepare("INSERT INTO sellers(id,slug,name,created_at,updated_at) VALUES('seller_charlie','charlie','Charlie','now','now')"),
    f.db.prepare("INSERT INTO app_users(id,auth_user_id,created_at,updated_at) VALUES('charlie','charlie','now','now')"),
    f.db.prepare("INSERT INTO seller_memberships(seller_id,auth_user_id,role,created_at) VALUES('seller_charlie','charlie','owner','now')"),
  ]);
  const shipping=await f.merchant('/v1/shipping-settings',{revision:0,requestKey:randomBytes(16).toString('hex'),configuration:shippingConfiguration},{seller:'charlie'});assert.equal(shipping.status,200,shipping.error);
  await seedRoutingWallets(f,{environment:f.environment,fingerprint:f.identity.credentialFingerprint,clientId:f.identity.clientId,wallets:[['charlie','3','BRN-fixture']]});
  await f.product('charlie-product',5,'seller_charlie',400000);
  const second=await f.payment({sellerId:'seller_charlie',checkout:{intentHash:'f'.repeat(64),paymentFlow:'snap_bca',shop:'charlie-shop'},items:[{productId:'charlie-product',quantity:1,expectedPrice:400000,expectedWeightGrams:100}]});
  const profiles=JSON.parse(await readFile(join(f.app.directory,'wallet-profiles.json'),'utf8'));
  profiles.charlie={responseCode:'2000000',profileId:'SAC-charlie',accounts:[{type:'DOKU_MERCHANT_IDR',currency:'IDR',accountNo:'2010000003'},{type:'DOKU_MERCHANT_PENDING_IDR',currency:'IDR',accountNo:'2030000003'}]};
  await writeFile(join(f.app.directory,'wallet-profiles.json'),JSON.stringify(profiles));
  const history=JSON.parse(await readFile(join(f.app.directory,'wallet-history.json'),'utf8')),legs=f.legs(second);
  history['2010000003']=legs.sellerCash;history['2030000003']=legs.sellerPending;history['2010000002'].push(...legs.platformCash);
  for(const rows of Object.values(history))rows.sort((a,b)=>b.dateTime.localeCompare(a.dateTime));
  await writeFile(join(f.app.directory,'wallet-history.json'),JSON.stringify(history));await new Promise(resolve=>setTimeout(resolve,1005-Date.now()%1000));
  const result=await f.sync();assert.equal(result.status,0,result.error+result.output);const body=JSON.parse(result.output);
  assert.equal(body.providerCalls,13);assert.equal(body.coveredOrders.length,2);assert.deepEqual(body.sharedHistoryReview,{settlements:0,payouts:0});
  const settled=await f.call('/internal/commerce/finance/settlement?seller=seller_charlie&environment='+f.environment+'&orderId='+second.order.id);
  assert.equal(settled.settlementVerified,true);assert.equal(settled.earningsReleased,false);
  const platform=(await f.reads()).filter(c=>c.url.endsWith('/balance-inquiries')&&JSON.parse(c.body).profileId==='SAC-bob');assert.equal(platform.length,2);
  assert.equal((await f.sync({mode:'recover'})).status,0);assert.equal((await f.reads()).length,13);
});

test('the recurring dispatcher resumes one run after read limits and lost acknowledgements',async t=>{
  const f=await fixture(t,{beta:true,queue:true}),base='/internal/commerce/finance/payout-sync/';f.control.drop=base+'claim';
  const first=await f.dispatch(2);assert.equal(first.status,2,first.error+first.output);const result=JSON.parse(first.output);assert.equal(result.state,'retry');
  assert.equal((await f.reads()).length,2);assert.equal(await f.count('commerce_payout_sync_jobs'),1);
  const claims=f.control.calls.filter(c=>c.path===base+'claim');assert.equal(claims.length,2);assert.deepEqual(claims[0].body,claims[1].body);
  await f.db.prepare("UPDATE commerce_payout_sync_jobs SET available_at='2000-01-01T00:00:00.000Z'").run();f.control.drop=base+'finish';
  const resumed=await f.dispatch(20);assert.equal(resumed.status,0,resumed.error+resumed.output);assert.equal(JSON.parse(resumed.output).run,result.run);
  assert.equal(JSON.parse(resumed.output).providerCalls,7);assert.equal((await f.reads()).length,9);assert.equal(await f.count('commerce_payout_assessments'),1);
  const jobs=await f.call(base+'list',{environment:f.environment});assert.deepEqual(jobs.counts,{completed:1});assert.equal(jobs.items[0].attempts,2);assert.equal(jobs.items[0].failures,0);
  assert.equal((await f.dispatch()).status,0);assert.equal((await f.reads()).length,9);
  assert.equal((await f.dispatch(20,{EZKART_COMMERCE_WITHDRAWAL_SYNC:'held'})).status,0);assert.equal((await f.reads()).length,9);
  for(const file of ['/cart/api/commerce-payout-cohort.php','/cart/api/commerce-payout-sync-dispatch.php','/tools/commerce/payout-sync-dispatch.php'])assert.equal((await fetch(f.app.base+file)).status,404);
});

test('provider-pending dispatches schedule a fresh observation pass without another transfer or principal deduction',async t=>{
  const f=await fixture(t,{queue:true});await f.controlProvider({statusResponse:{latestTransactionStatus:'03',latestTransactionDesc:'pending'}});
  const pending=await f.dispatch();assert.equal(pending.status,2,pending.error);assert.equal(JSON.parse(pending.output).state,'review');
  const old=(await f.call('/internal/commerce/finance/payout-sync/list',{environment:f.environment})).items[0];
  assert.deepEqual(old.result.reviewReasons,['provider_pending']);assert(Date.parse(old.availableAt)<Date.now()+310000);
  assert.equal((await f.readPayout()).outcome.paidAmount,'0');
  await f.db.prepare("UPDATE commerce_payout_sync_jobs SET available_at='2000-01-01T00:00:00.000Z' WHERE id=?").bind(old.id).run();
  // The real scheduler waits five minutes; force a later recorded second here.
  await new Promise(resolve=>setTimeout(resolve,1005-Date.now()%1000));
  await f.controlProvider({statusResponse:{latestTransactionStatus:'00',latestTransactionDesc:'success'}});
  const done=await f.dispatch();assert.equal(done.status,0,done.error+done.output);assert.notEqual(JSON.parse(done.output).run,old.id);
  assert.equal((await f.readPayout()).outcome.paidAmount,'250000');assert.equal((await f.funds()).completedWithdrawals,'250000');
  assert((await f.reads()).every(c=>!/transfer-payment|register|transfer-inquiry/.test(c.url)));
});

test('beta payout synchronization connects original status, both account histories, payout and settlement accounting; recovery uses no provider credentials',async t=>{
  const f=await fixture(t,{beta:true}),before=await f.funds();f.control.drop=evidencePath;
  const run=await f.sync();assert.equal(run.status,0,run.error+run.output);const result=JSON.parse(run.output);
  assert.equal(result.providerCalls,9);assert.equal(result.responses,8);assert.equal(result.payoutConfirmed,true);assert.equal(result.mayPay,false);
  assert.deepEqual(result.sharedHistoryReview,{settlements:0,payouts:0});assert.deepEqual(result.relatedReviews,[]);
  // Reserved money becomes a completed outflow; it never becomes available again.
  assert.equal((await f.funds()).availableEarnings,before.availableEarnings);
  assert.equal((await f.funds()).reservedWithdrawals,'0');assert.equal((await f.funds()).completedWithdrawals,'250000');
  assert.equal(await f.count('commerce_payout_assessments'),1);assert.equal((await f.readPayout()).outcome.paidAmount,'250000');
  const reads=await f.reads();assert.equal(reads.length,9);assert(reads.every(c=>c.url.startsWith('https://api.doku.com/')));
  assert(reads.every(c=>!/transfer-payment|transfer-inquiry|register/.test(c.url)));
  const originals=Object.fromEntries(await Promise.all((await readdir(f.directory)).filter(x=>x.endsWith('.json')).map(async name=>[name,await readFile(join(f.directory,name),'utf8')])));
  assert.equal((await stat(f.directory)).mode&0o777,0o700);
  for(const name of Object.keys(originals))assert.equal((await stat(join(f.directory,name))).mode&0o777,0o600);
  await f.controlProvider({tokenDenied:true});
  const recovered=await f.sync({mode:'recover'},{EZKART_COMMERCE_WITHDRAWAL_SYNC:'held',EZKART_DOKU_PRODUCTION_SNAP_PRIVATE_KEY:'unavailable'});
  assert.equal(recovered.status,0,recovered.error);assert.equal(JSON.parse(recovered.output).providerCalls,0);assert.equal((await f.reads()).length,9);
  for(const [name,raw] of Object.entries(originals))assert.equal(await readFile(join(f.directory,name),'utf8'),raw);
  assert.equal(await f.count('commerce_payout_assessments'),1);
  for(const file of ['/cart/api/commerce-payout-sync.php','/tools/commerce/sync-withdrawal-payout.php'])assert.equal((await fetch(f.app.base+file)).status,404);
  for(const privateValue of ['2010000001','2030000002',f.identity.credentialFingerprint,'fixture-doku'])assert(!run.output.includes(privateValue));
});

test('interrupted observation delivery recovers original bytes and resumes only missing provider reads',async t=>{
  const f=await fixture(t);f.control.fail=evidencePath;
  const failed=await f.sync();assert.equal(failed.status,1);assert.equal((await f.reads()).length,2);
  const saved=await readFile(join(f.directory,'read-0002.json'),'utf8');assert.equal(await f.count('commerce_withdrawal_status_observations'),1);
  f.control.fail='';
  const recovery=await f.sync({mode:'recover'},{EZKART_DOKU_SANDBOX_SNAP_PRIVATE_KEY:'missing'});assert.equal(recovery.status,1);assert.equal((await f.reads()).length,2);
  const resumed=await f.sync();assert.equal(resumed.status,0,resumed.error);assert.equal(JSON.parse(resumed.output).providerCalls,7);
  assert.equal(await readFile(join(f.directory,'read-0002.json'),'utf8'),saved);assert.equal((await f.reads()).length,9);
  assert.equal(await f.count('commerce_withdrawal_status_observations'),1);assert.equal(await f.count('commerce_payout_assessments'),1);
});

test('lost collection and payout acknowledgements recover exactly without another provider read',async t=>{
  const f=await fixture(t);let blocked=false;
  f.control.afterResponse=async path=>{if(path===collectionPath&&!blocked){blocked=true;f.control.fail=collectionPath;f.control.drop=collectionPath;}};
  const failed=await f.sync();assert.equal(failed.status,1);assert.equal((await f.reads()).length,5);assert.equal(await f.count('commerce_provider_financial_collections'),3);
  f.control.afterResponse=null;f.control.fail='';
  f.control.drop=f.path+'/payout/reconcile';const resumed=await f.sync();assert.equal(resumed.status,0,resumed.error);
  assert.equal(JSON.parse(resumed.output).providerCalls,4);assert.equal((await f.reads()).length,9);assert.equal(await f.count('commerce_payout_assessments'),1);
  const requests=f.control.calls.filter(c=>c.path===f.path+'/payout/reconcile');assert.equal(requests.length,2);assert.deepEqual(requests[0].body,requests[1].body);
});

test('a payout committed before a prolonged outage recovers entirely while provider synchronization is held',async t=>{
  const f=await fixture(t),target=f.path+'/payout/reconcile';let lost=false;
  f.control.afterResponse=async path=>{if(path===target&&!lost){lost=true;f.control.fail=target;f.control.drop=target;}};
  const failed=await f.sync();assert.equal(failed.status,1);assert.equal((await f.reads()).length,9);assert.equal(await f.count('commerce_payout_assessments'),1);
  const input=await readFile(join(f.directory,'payout-input.json'),'utf8');
  f.control.afterResponse=null;f.control.fail='';await f.controlProvider({tokenDenied:true});
  const recovered=await f.sync({mode:'recover'},{EZKART_COMMERCE_WITHDRAWAL_SYNC:'held',EZKART_DOKU_SANDBOX_SNAP_PRIVATE_KEY:'unavailable'});
  assert.equal(recovered.status,0,recovered.error);assert.equal(JSON.parse(recovered.output).providerCalls,0);
  assert.equal((await f.reads()).length,9);assert.equal(await f.count('commerce_payout_assessments'),1);
  assert.equal(await readFile(join(f.directory,'payout-input.json'),'utf8'),input);
});

test('one active process owns a synchronization run; a competing invocation cannot read DOKU',async t=>{
  const f=await fixture(t);assert.equal((await f.sync()).status,0);
  const code=`$f=fopen(${JSON.stringify(join(f.directory,'lock'))},'r+b'); flock($f,LOCK_EX); echo "locked\\n"; fflush(STDOUT); sleep(15);`;
  const holder=spawn(process.env.PHP_BINARY||'php',['-n','-r',code]);
  t.after(()=>holder.kill());await new Promise((resolve,reject)=>{holder.stdout.once('data',resolve);holder.once('error',reject);});
  const busy=await f.sync();assert.equal(busy.status,1);assert.equal((await f.reads()).length,9);
  holder.kill();await new Promise(resolve=>holder.once('close',resolve));
  assert.equal((await f.sync({mode:'recover'})).status,0);assert.equal((await f.reads()).length,9);
});

test('new evidence makes an old run report review, and a fresh run applies fee corrections without restoring payout principal',async t=>{
  const f=await fixture(t);assert.equal((await f.sync()).status,0);const paid=(await f.funds()).completedWithdrawals;
  await f.payoutStatus();
  const old=await f.sync({mode:'recover'});assert.equal(old.status,2,old.error);assert.equal(JSON.parse(old.output).providerCalls,0);assert.equal(JSON.parse(old.output).payoutConfirmed,false);
  assert.equal((await f.funds()).completedWithdrawals,paid);assert.equal((await f.funds()).availableEarnings,'0');
  await f.history({fee:4000});const fresh=await f.sync({run:randomBytes(16).toString('hex')});assert.equal(fresh.status,0,fresh.error+fresh.output);
  assert.equal((await f.readPayout()).assessment.feeAmount,'4000');assert.equal((await f.funds()).completedWithdrawals,paid);
  const fees=await f.db.prepare("SELECT SUM(amount) AS amount FROM commerce_financial_entries WHERE account='platform_withdrawal_fee'").first();assert.equal(fees.amount,4000);
});

test('shared original histories refresh a second payout and its supporting earnings in the same run',async t=>{
  const f=await fixture(t),other=await f.grant();await other.payoutStatus();await f.history({payouts:[f,other]});
  const result=await f.sync();assert.equal(result.status,0,result.error+result.output);
  assert.equal((await other.readPayout()).outcome.payoutConfirmed,true);assert.equal((await f.funds()).completedWithdrawals,'500000');
  assert.equal(await f.count('commerce_payout_assessments'),2);assert.deepEqual(JSON.parse(result.output).sharedHistoryReview,{settlements:0,payouts:0});
});

test('seller-paid fees and incomplete history cannot become reconciled payouts',async t=>{
  const f=await fixture(t);await f.history({sellerFee:true});
  const fee=await f.sync();assert.equal(fee.status,2,fee.error);assert.equal(JSON.parse(fee.output).outcome.reason,'seller_fee_unfunded');
  assert.equal((await f.funds()).availableEarnings,'0');assert.equal((await f.readPayout()).outcome.paidAmount,'0');
  const extra=Array.from({length:21},(_,i)=>({...f.row('PAYOUT',1),partnerReferenceNo:'unrelated-'+i,referenceNo:'other-'+i}));
  await f.history({extra});const run=randomBytes(16).toString('hex'),partial=await f.sync({run,'max-pages':'1'});
  assert.equal(partial.status,2,partial.error);assert.equal(JSON.parse(partial.output).reason,'history_incomplete');assert.equal(JSON.parse(partial.output).pagesExhausted,false);
  const before=(await f.reads()).length;const recovery=await f.sync({run,'max-pages':'1',mode:'recover'});assert.equal(recovery.status,2);assert.equal((await f.reads()).length,before);
  assert.equal((await f.sync({run,'max-pages':'2'})).status,1);assert.equal((await f.reads()).length,before);
});

test('synchronization rejects main, held dispatch, wrong scope, unsafe recovery files and changed credentials before provider reads',async t=>{
  const f=await fixture(t,{beta:true});
  for(const [changes,overrides] of [[{}, {EZKART_DEPLOYMENT_ENVIRONMENT:'production'}],[{}, {EZKART_COMMERCE_WITHDRAWAL_SYNC:'held'}],
    [{environment:'sandbox'},{}],[{run:'../escape'},{}],[{mode:'send'},{}],[{'max-pages':'41'},{}],
    [{}, {EZKART_DOKU_PRODUCTION_SECRET_KEY:'a-different-production-secret'}]])assert.equal((await f.sync(changes,overrides)).status,1);
  assert.equal((await f.reads()).length,0);
  assert.equal((await f.call(f.path+'/payout/sync-scope',{environment:f.environment,seller:'seller_bob'})).status,422);
  assert.equal((await f.call(f.path+'/payout/sync-scope',{environment:'sandbox'})).status,403);
  assert.equal((await f.sync()).status,0);
  const file=join(f.directory,'read-0001.json');await chmod(file,0o644);assert.equal((await f.sync({mode:'recover'})).status,1);await chmod(file,0o600);
  const raw=await readFile(file);await rm(file);const other=join(f.recovery,'foreign.json');await writeFile(other,raw,{mode:0o600});await symlink(other,file);
  assert.equal((await f.sync({mode:'recover'})).status,1);assert.equal((await f.reads()).length,9);
});

// Age only the isolated fixture's grant, restoring its immutable SQL guard before
// invoking production code. No live records or provider endpoints are involved.
async function ageGrant(f,days=70){
  const trigger=await f.db.prepare("SELECT sql FROM sqlite_master WHERE type='trigger' AND name='withdrawal_payment_grants_no_update'").first();
  await f.db.prepare('DROP TRIGGER withdrawal_payment_grants_no_update').run();
  const at=new Date(Date.now()-days*86400000).toISOString();
  await f.db.prepare('UPDATE commerce_withdrawal_payment_grants SET created_at=? WHERE withdrawal_id=?').bind(at,f.w.id).run();
  await f.db.prepare(trigger.sql).run();
  return at;
}

test('seventy-day payout uses three complete windows, boundary copies once, and durable interrupted recovery',async t=>{
  const f=await fixture(t,{queue:true}),grantedAt=await ageGrant(f);
  const scope=await f.call(f.path+'/payout/sync-scope',{environment:f.environment});
  assert.equal(scope.plan.version,3);assert(Date.parse(scope.plan.from)<=Date.parse(grantedAt)-300000);
  const boundary=new Date(Date.parse(scope.plan.from)+31*86400000).toISOString();
  const rows=f.legs(f.p);
  rows.sellerCash.push({...f.row('PAYOUT',250000),dateTime:boundary});
  rows.platformCash.push({...f.row('PAYOUT_CHARGE',2500),dateTime:boundary});
  for(const items of Object.values(rows))items.sort((a,b)=>b.dateTime.localeCompare(a.dateTime));
  const a=scope.original;
  await writeFile(join(f.app.directory,'wallet-history.json'),JSON.stringify({
    [a.sellerAccount.cashAccount]:rows.sellerCash,[a.sellerAccount.pendingAccount]:rows.sellerPending,
    [a.platformAccount.cashAccount]:rows.platformCash,[a.platformAccount.pendingAccount]:rows.platformPending}));
  await f.controlProvider({filterHistoryWindows:true,statusResponse:{latestTransactionStatus:'00'}});
  const scheduled=await f.call('/internal/commerce/finance/payout-sync/schedule',{environment:f.environment,limit:1});assert.equal(scheduled.queued,1);
  await new Promise(resolve=>setTimeout(resolve,1005-Date.now()%1000));
  const first=await f.sync({'max-reads':'4'});assert.equal(first.status,2,first.error);assert.equal(JSON.parse(first.output).reason,'read_budget');
  const plan=await readFile(join(f.directory,'window.json'),'utf8'),intent=await readFile(join(f.directory,'intent.json'),'utf8');
  const windows=JSON.parse(plan).windows;assert.equal(windows.length,3);
  for(const [i,w] of windows.entries()){
    assert(Date.parse(w.to)-Date.parse(w.from)<=31*86400000);
    if(i)assert.equal(w.from,windows[i-1].to);
  }
  assert.equal(windows[0].from,scope.plan.from);
  const boundaryStatus=JSON.parse(await readFile(join(f.directory,'status-'+f.w.id+'-boundary.json'),'utf8'));
  assert(Date.parse(windows.at(-1).to)>=Date.parse(boundaryStatus.checkedAt));
  const saved=await readFile(join(f.directory,'read-0004.json'),'utf8');
  const recovery=await f.sync({mode:'recover'});assert.equal(recovery.status,1);assert.equal((await f.reads()).length,4);
  const done=await f.sync({'max-reads':'20'});assert.equal(done.status,0,done.error+done.output);
  assert.equal(JSON.parse(done.output).providerCalls,13);assert.equal((await f.reads()).length,17);
  assert.equal(await readFile(join(f.directory,'window.json'),'utf8'),plan);assert.equal(await readFile(join(f.directory,'intent.json'),'utf8'),intent);
  assert.equal(await readFile(join(f.directory,'read-0004.json'),'utf8'),saved);
  const payout=await f.readPayout();assert.equal(payout.outcome.payoutConfirmed,true);assert.equal(payout.assessment.feeAmount,'2500');
  assert.equal(payout.assessment.source.legs.length,2);
  assert.equal((await f.sync({mode:'recover'},{EZKART_COMMERCE_WITHDRAWAL_SYNC:'held',EZKART_DOKU_SANDBOX_SNAP_PRIVATE_KEY:'missing'})).status,0);
  assert.equal((await f.reads()).length,17);assert.equal(await f.count('commerce_payout_assessments'),1);
  // A contiguous subset is valid history but cannot replace the full original
  // grant-to-status range, even when it still contains the payout leg.
  for(const remove of [[1,4],[3,6]]){
    const ids=[];
    for(const account of [a.sellerAccount,a.platformAccount]){
      const manifest=JSON.parse(await readFile(join(f.directory,'collection-'+account.enrollmentId+'.json'),'utf8'));
      manifest.observationIds=manifest.observationIds.filter((_,i)=>!remove.includes(i));
      const sealed=await f.call(collectionPath,manifest);assert.equal(sealed.status,200,sealed.error);ids.push(sealed.collection.id);
    }
    const incomplete=await f.call(f.path+'/payout/reconcile',{environment:f.environment,sellerCollectionId:ids[0],platformCollectionId:ids[1],statusCap:boundaryStatus.statusCap});
    assert.equal(incomplete.status,409);
  }
  // The same provider reference at a different time is a duplicate financial
  // leg, not another endpoint copy. Preserve it and hold the new assessment.
  rows.sellerCash.push({...f.row('PAYOUT',250000),dateTime:new Date(Date.parse(grantedAt)+86400000).toISOString()});
  rows.sellerCash.sort((x,y)=>y.dateTime.localeCompare(x.dateTime));
  await writeFile(join(f.app.directory,'wallet-history.json'),JSON.stringify({
    [a.sellerAccount.cashAccount]:rows.sellerCash,[a.sellerAccount.pendingAccount]:rows.sellerPending,
    [a.platformAccount.cashAccount]:rows.platformCash,[a.platformAccount.pendingAccount]:rows.platformPending}));
  const duplicate=await f.sync({run:randomBytes(16).toString('hex')});assert.equal(duplicate.status,2,duplicate.error+duplicate.output);
  assert.equal(JSON.parse(duplicate.output).outcome.reason,'incomplete_or_duplicate_legs');
  assert.equal((await f.funds()).completedWithdrawals,'250000');assert.equal(await f.count('commerce_withdrawal_payment_grants'),1);
  rows.sellerCash.push(...Array.from({length:20},(_,i)=>({...f.row('PAYOUT',1),referenceNo:'unrelated-old-'+i,partnerReferenceNo:'unrelated-old-'+i,
    dateTime:new Date(Date.parse(grantedAt)+86400000).toISOString()})));
  rows.sellerCash.sort((x,y)=>y.dateTime.localeCompare(x.dateTime));
  await writeFile(join(f.app.directory,'wallet-history.json'),JSON.stringify({
    [a.sellerAccount.cashAccount]:rows.sellerCash,[a.sellerAccount.pendingAccount]:rows.sellerPending,
    [a.platformAccount.cashAccount]:rows.platformCash,[a.platformAccount.pendingAccount]:rows.platformPending}));
  const partial=await f.sync({run:randomBytes(16).toString('hex'),'max-pages':'3'});assert.equal(partial.status,2,partial.error+partial.output);
  assert.equal(JSON.parse(partial.output).reason,'history_incomplete');assert.equal(JSON.parse(partial.output).pagesExhausted,false);
});

test('an original version-two single-window intent remains recoverable unchanged',async t=>{
  const f=await fixture(t),legacy={version:2,run:f.run,original:f.scope.original,plan:{...f.scope.plan,version:2},maxPages:10};
  delete legacy.plan.maxWindows;
  await mkdir(f.directory,{mode:0o700});const file=join(f.directory,'intent.json');await writeFile(file,JSON.stringify(legacy)+'\n',{mode:0o600});
  const raw=await readFile(file,'utf8'),result=await f.sync();assert.equal(result.status,0,result.error+result.output);
  assert.equal(await readFile(file,'utf8'),raw);assert.equal(JSON.parse(await readFile(join(f.directory,'window.json'),'utf8')).windows,undefined);
  assert.equal((await f.sync({mode:'recover'},{EZKART_COMMERCE_WITHDRAWAL_SYNC:'held'})).status,0);
  assert.equal((await f.reads()).length,9);assert.equal(await f.count('commerce_payout_assessments'),1);
});

test('later independent evidence in an older window invalidates an interrupted multi-window run',async t=>{
  const f=await fixture(t);await ageGrant(f);
  await f.controlProvider({filterHistoryWindows:true,statusResponse:{latestTransactionStatus:'00'}});
  const paused=await f.sync({'max-reads':'3'});assert.equal(paused.status,2,paused.error);
  const window=JSON.parse(await readFile(join(f.directory,'window.json'),'utf8')).windows[0],at=new Date().toISOString();
  await f.record('transaction-history-list',{accountNo:f.scope.original.sellerAccount.cashAccount,
    fromDateTime:window.from,toDateTime:window.to,pageSize:'20',pageNumber:'0'},
    {responseCode:'2000000',detailData:[]},{requestedAt:at,observedAt:at});
  const resumed=await f.sync();assert.equal(resumed.status,2,resumed.error+resumed.output);
  assert.equal(JSON.parse(resumed.output).relatedReviews.find(x=>x.kind==='payout').reason,'sources_changed_or_incomplete');
  assert.equal(await f.count('commerce_payout_assessments'),0);assert.equal(await f.count('commerce_withdrawal_payment_grants'),1);
});
