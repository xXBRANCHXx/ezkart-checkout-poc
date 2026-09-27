import test from 'node:test';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {generateKeyPairSync,createHash,createHmac,verify,randomBytes} from 'node:crypto';
import {writeFile,mkdir,mkdtemp,rm,readFile,readdir,stat,chmod} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {setupCentralFixture} from './central-fixture.mjs';
import {setupEarningsFixture} from '../../cloudflare/ezkart-api/test/earnings-fixture.mjs';
import {payoutFixture} from '../../cloudflare/ezkart-api/test/payout-fixture.mjs';

const root=resolve(import.meta.dirname,'../..'),base='/internal/commerce/finance/wallet',screens='/tmp/ezkart-wallet-enrollment-ui-01a0d643';
const rsa=generateKeyPairSync('rsa',{modulusLength:2048}),privateKey=rsa.privateKey.export({format:'pem',type:'pkcs8'});
const key=()=>randomBytes(16).toString('hex');
const proof=(id='alice')=>({id,email:id+'@example.test',proofExpiresAt:new Date(Date.now()+590000).toISOString()});
async function fixture(t,overrides={},options={}){
  const f=await setupCentralFixture(t,{EZKART_TEST_WALLET:'1',EZKART_DOKU_SANDBOX_SNAP_PRIVATE_KEY:privateKey,EZKART_DOKU_SANDBOX_PARENT_PROFILE_ID:'BRN-fixture',...overrides},options);
  const setControl=data=>writeFile(join(f.app.directory,'wallet-control.json'),JSON.stringify(data));
  const enroll=async(id='alice')=>{const r=await f.call(base,{environment:'sandbox',seller:'seller_'+id,actor:proof(id),action:'enroll',requestKey:key()});assert.equal(r.status,200,r.error);return r.enrollment;};
  const registration=async id=>(await f.call(base+'/registrations/'+id+'?environment=sandbox')).registration;
  const due=()=>f.db.prepare("UPDATE commerce_jobs SET available_at='2000-01-01T00:00:00.000Z'").run();
  const registerCalls=async()=>(await f.app.calls()).filter(c=>c.url.endsWith('/sub-account/v2.0/register'));
  const run=async(code,extra={})=>new Promise((resolve,reject)=>{
    const child=spawn(process.env.PHP_BINARY||'php',['-n','-r',`require ${JSON.stringify(join(root,'tools/checkout-test/provider-fixture.php'))}; require ${JSON.stringify(join(root,'cart/api/commerce-wallet-jobs.php'))}; ${code}`],{env:{...f.app.env,...extra}});
    let output='',error='';child.stdout.on('data',x=>output+=x);child.stderr.on('data',x=>error+=x);child.on('error',reject);child.on('close',status=>resolve({status,output,error}));
  });
  const processWallet=async(enrollment,extra={})=>{const r=await run(`ez_wallet_process_enrollment('${enrollment.id}','sandbox');`,extra);assert.equal(r.status,0,r.error+r.output);};
  return {...f,setControl,enroll,registration,due,registerCalls,run,processWallet};
}

test('wallet dispatcher signs one registration, confirms both account identities and persists no spendable funds',async t=>{
  const f=await fixture(t),e=await f.enroll();await f.processWallet(e);const saved=await f.registration(e.id);
  assert(saved.profile);assert.equal(saved.jobState,'succeeded');assert.equal(await f.count('commerce_wallet_provider_accounts'),2);
  assert.equal(await f.count('commerce_financial_journals'),0);assert.equal(await f.count('commerce_payment_captures'),0);
  const calls=(await f.app.calls()).filter(c=>c.url.includes('doku.com'));
  assert.deepEqual(calls.map(c=>new URL(c.url).pathname),['/authorization/v1/access-token/b2b','/sub-account/v2.0/balance-inquiries','/sub-account/v2.0/register','/sub-account/v2.0/balance-inquiries']);
  const h=c=>Object.fromEntries(c.headers.map(x=>[x.slice(0,x.indexOf(':')).toLowerCase(),x.slice(x.indexOf(':')+1).trim()]));
  const tokenHeaders=h(calls[0]);assert(verify('RSA-SHA256',Buffer.from(tokenHeaders['x-client-key']+'|'+tokenHeaders['x-timestamp']),rsa.publicKey,Buffer.from(tokenHeaders['x-signature'],'base64')));
  for(const call of calls.slice(1)){
    const headers=h(call),canonical=['POST',new URL(call.url).pathname,'fixture-snap-wallet-token',createHash('sha256').update(call.body).digest('hex'),headers['x-timestamp']].join(':');
    assert.equal(headers['x-signature'],createHmac('sha512','fixture-doku-sandbox-secret').update(canonical).digest('base64'));assert.match(headers['x-external-id'],/^[0-9]{32}$/);
  }
  const submitted=JSON.parse((await f.registerCalls())[0].body);assert.equal(submitted.name,'alice');assert.equal(submitted.email,'alice@example.test');assert.equal(submitted.parentProfileId,'BRN-fixture');
  await f.processWallet(e);assert.equal((await f.registerCalls()).length,1);
});

test('numeric provider accounts remain exact through registration, confirmation and immutable storage',async t=>{
  const f=await fixture(t),e=await f.enroll();await f.setControl({numericAccounts:true});await f.processWallet(e);
  const saved=await f.registration(e.id);assert.equal(saved.jobState,'succeeded');assert(saved.profile);
  const raw=JSON.parse(saved.registrationBody);assert(raw.accounts.every(a=>typeof a.accountNo==='number'));
  assert.equal(saved.profile.cashAccount,String(raw.accounts[0].accountNo));assert.equal(saved.profile.pendingAccount,String(raw.accounts[1].accountNo));
  const evidence=await f.db.prepare('SELECT registration_json,confirmation_json FROM commerce_wallet_provider_profiles').first();
  assert.equal(evidence.registration_json,saved.registrationBody);assert(JSON.parse(evidence.confirmation_json).accounts.every(a=>typeof a.accountNo==='number'));
  await f.processWallet(e);assert.equal((await f.registerCalls()).length,1);assert.equal(await f.count('commerce_financial_journals'),0);
});

test('lost receipt acknowledgement and failed account reads recover the original registration without another provider write',async t=>{
  const f=await fixture(t),e=await f.enroll();f.control.drop=base+'/registrations/'+e.id+'/receipt';await f.setControl({confirmationUnavailable:true});
  await f.processWallet(e);let saved=await f.registration(e.id);assert.equal(saved.jobState,'uncertain');assert(saved.registrationBody);assert.equal(saved.profile,null);
  const failedAttempt=await f.db.prepare('SELECT result_json FROM commerce_job_attempts WHERE job_id=?').bind(saved.jobId).first();
  assert.deepEqual(JSON.parse(failedAttempt.result_json).failure,{stage:'confirm_accounts',category:'provider',reason:'http',httpStatus:503});
  assert.equal(f.control.calls.filter(c=>c.path.endsWith('/receipt')).length,2);
  await f.setControl({});await f.due();await f.processWallet(e);saved=await f.registration(e.id);assert(saved.profile);assert.equal(saved.jobState,'succeeded');assert.equal((await f.registerCalls()).length,1);
  const attempts=(await f.db.prepare('SELECT result_json FROM commerce_job_attempts WHERE job_id=? ORDER BY attempt').bind(saved.jobId).all()).results;
  assert.equal(attempts.length,2);assert.equal(attempts[0].result_json,failedAttempt.result_json);assert.equal(JSON.parse(attempts[1].result_json).failure,undefined);
});

test('unknown registration, duplicate-reference and bind acknowledgements stay under review without blind retries',async t=>{
  const f=await fixture(t),a=await f.enroll();await f.setControl({loseRegister:true});await f.processWallet(a);
  assert.equal((await f.registration(a.id)).jobState,'uncertain');assert.equal((await f.registration(a.id)).registrationBody,null);
  await f.setControl({});await f.due();await f.processWallet(a);assert.equal((await f.registerCalls()).length,1);assert.equal((await f.registration(a.id)).profile,null);
  const b=await f.enroll('bob');f.control.drop=base+'/registrations/'+b.id+'/bind';await f.processWallet(b);await f.due();await f.processWallet(b);
  assert((await f.registration(b.id)).binding);assert.equal((await f.registerCalls()).length,1);assert.equal((await f.registration(b.id)).jobState,'uncertain');
});

test('provider configuration failures consume no job attempts; rejected preflight is safely retryable; credentials and account mismatches cannot attach wallets',async t=>{
  const f=await fixture(t),a=await f.enroll();
  const missing=await f.run(`ez_wallet_process_enrollment('${a.id}','sandbox');`,{EZKART_DOKU_SANDBOX_SNAP_PRIVATE_KEY:'missing-key'});assert.notEqual(missing.status,0);
  assert.equal((await f.db.prepare('SELECT attempts FROM commerce_jobs').first()).attempts,0);
  await f.setControl({tokenDenied:true});await f.processWallet(a);assert.equal((await f.registration(a.id)).binding,null);assert.equal((await f.registration(a.id)).jobState,'retry');assert.equal((await f.registerCalls()).length,0);
  const rejected=JSON.parse((await f.db.prepare('SELECT result_json FROM commerce_jobs').first()).result_json);
  assert.equal(rejected.noEffectConfirmed,true);assert.deepEqual(rejected.failure,{stage:'parent_preflight',category:'provider',reason:'http',httpStatus:401});
  await f.setControl({wrongConfirmation:true});await f.due();await f.processWallet(a);assert.equal((await f.registration(a.id)).profile,null);assert((await f.registration(a.id)).registrationBody);
  await f.setControl({});await f.due();await f.processWallet(a,{EZKART_DOKU_SANDBOX_SECRET_KEY:'different-fixture-secret-key'});assert.equal((await f.registration(a.id)).profile,null);assert.equal((await f.registerCalls()).length,1);
  await f.due();await f.processWallet(a);assert((await f.registration(a.id)).profile);
  const b=await f.enroll('bob');await f.db.prepare("UPDATE seller_memberships SET role='viewer' WHERE auth_user_id='bob'").run();await f.processWallet(b);
  assert.equal((await f.registration(b.id)).jobState,'dead');assert.equal((await f.registration(b.id)).binding,null);assert.equal((await f.registerCalls()).length,1);
});

async function merchantFixture(t,overrides={},options={}){
  const f=await fixture(t,overrides,options),token=await f.merchantToken('alice','alice@example.test'),auth={user:{id:'alice',email:'alice@example.test'},wallet_tokens:{access_token:token,refresh_token:'fixture-refresh',expires_in:3600}};
  const setAuth=data=>writeFile(join(f.app.directory,'auth-response.json'),JSON.stringify({...auth,...data}));await setAuth({});
  const cookie=f.app.adminCookie({supabase_access_token:token,admin_user:{id:'alice',email:'alice@example.test'}});
  const {chromium}=await import('../builder-mcp/node_modules/playwright/index.mjs'),browser=await chromium.launch({headless:true});t.after(()=>browser.close());
  const context=await browser.newContext({viewport:{width:1360,height:1000},reducedMotion:'reduce'});await context.addCookies([cookie]);const page=await context.newPage();page.setDefaultTimeout(12000);
  const errors=[];page.on('pageerror',e=>errors.push(e.message));
  const session=async code=>{const current=(await context.cookies()).find(c=>c.name==='ezkart_admin');return f.app.cli(`$_COOKIE['ezkart_admin']='${current.value}'; define('EZ_CUSTOMER_SESSION_BRIDGE',true); require ${JSON.stringify(join(root,'cart/admin/index.php'))}; ${code}; session_write_close();`);};
  const unlock=async()=>{await page.goto(f.app.base+'/cart/admin/?page=wallet');await page.getByRole('button',{name:'Send email code',exact:true}).click();await page.getByLabel('Email code',{exact:true}).fill('654321');await page.getByRole('button',{name:'Verify and open Wallet',exact:true}).click();await page.locator('[data-wallet-setup][aria-busy=false]').waitFor();};
  const request=async(action,body,extra={})=>{
    const cookies=await context.cookies(),csrf=await page.locator('body').getAttribute('data-admin-csrf-token');
    return f.app.request('/cart/admin/?wallet='+action,body,{Cookie:cookies.map(c=>c.name+'='+c.value).join('; '),'X-Ezkart-Csrf':csrf,'X-Ezkart-Wallet-Account':'alice','X-Ezkart-Wallet-Store':'seller_alice',...extra});
  };
  return {...f,page,context,browser,errors,setAuth,session,unlock,request};
}

async function bankInquiryFixture(t,overrides={},extraBindings={}){
  const recovery=await mkdtemp(join(tmpdir(),'ezkart-bank-inquiry-'));t.after(()=>rm(recovery,{recursive:true,force:true}));
  const bindings={COMMERCE_PLATFORM_WALLET_SELLER:'seller_bob',COMMERCE_WITHDRAWAL_INQUIRY:'enabled',...extraBindings};
  const f=await merchantFixture(t,{EZKART_COMMERCE_WITHDRAWALS:'enabled',EZKART_COMMERCE_WITHDRAWAL_INQUIRY:'enabled',
    EZKART_COMMERCE_WITHDRAWAL_RECOVERY_DIRECTORY:recovery,...overrides},{bindings});
  const identity=await f.run(`require ${JSON.stringify(join(root,'cart/api/doku-payout.php'))}; echo json_encode(EzDokuPayoutClient::configured('sandbox')->providerIdentity());`);
  assert.equal(identity.status,0,identity.error);const provider=JSON.parse(identity.output);
  const e=await setupEarningsFixture(t,{baseFixture:f,bindings,fingerprint:provider.credentialFingerprint,clientId:provider.clientId});
  await e.product('bank-inquiry-merchant',10,'seller_alice',400000);
  const p=await e.payment({items:[{productId:'bank-inquiry-merchant',quantity:2,expectedPrice:400000,expectedWeightGrams:100}]});await e.settle(p);await e.deliver(p);
  await f.unlock();
  await f.page.locator('[data-withdrawals][aria-busy=false]').waitFor();
  const reserve=async()=>{const r=await f.request('withdrawal_reserve',{requestKey:key(),amount:'250000',bank:{code:'CENAIDJA',accountNumber:'001234567890',channel:'BI_FAST'}});assert.equal(r.status,200,JSON.stringify(r.data));return r.data.withdrawal;};
  const inquire=w=>f.request('withdrawal_inquire',{id:w.id});
  const bankCalls=async()=>(await f.app.calls()).filter(c=>c.url.endsWith('/sub-account/v2.0/transfer-inquiry'));
  return {...f,e,p,provider,recovery,reserve,inquire,bankCalls};
}

async function paymentGrantFixture(t,overrides={}){
  const f=await bankInquiryFixture(t,overrides, {COMMERCE_WITHDRAWAL_PAYMENT:'enabled'}),w=await f.reserve();
  await f.setControl({inquiryName:'Bank Owner Ω\u2028\u2029',inquiryLiteralUnicode:true});
  const bank=await f.inquire(w);assert.equal(bank.status,200,JSON.stringify(bank.data));
  const confirmation=await f.request('withdrawal_confirm',{id:w.id,requestKey:key(),inquiryDigest:bank.data.withdrawal.inquiry.digest});assert.equal(confirmation.status,200);
  const paymentPath='/internal/commerce/finance/withdrawals/'+w.id+'/payment';
  const g=await f.call(paymentPath+'/start',{environment:'sandbox',seller:'seller_alice',actor:proof(),confirmationId:confirmation.data.confirmation.id,
    credentialFingerprint:f.provider.credentialFingerprint,clientId:f.provider.clientId});assert.equal(g.status,200,g.error);assert.equal(g.mayPay,true);
  return {...f,w,g,paymentPath};
}

test('payout reconciliation recovers a lost acknowledgement without provider calls and shows completed and stale outcomes in protected Wallet',async t=>{
  const f=await paymentGrantFixture(t),p=payoutFixture({...f.e,p:f.p},f.w,f.g),cap=await p.payoutStatus(),pair=await p.collectPayout();
  const input=p.payoutInput(pair,cap),encoded=Buffer.from(JSON.stringify(input)).toString('base64');
  const providerCalls=async()=>(await f.app.calls()).filter(call=>call.url.includes('doku.com')).length,before=await providerCalls();
  const code=`require ${JSON.stringify(join(root,'cart/api/commerce-payouts.php'))}; echo json_encode(ez_reconcile_withdrawal_payout('${f.w.id}',json_decode(base64_decode('${encoded}'),true)));`;
  const path=p.path+'/payout/reconcile';f.control.drop=path;
  const lost=await f.run(code);assert.equal(lost.status,0,lost.error);assert.equal(JSON.parse(lost.output).replayed,true);
  assert.equal(f.control.calls.filter(call=>call.path===path).length,2);assert.equal(await f.count('commerce_payout_assessments'),1);
  assert.equal((await f.db.prepare("SELECT COUNT(*) AS n FROM commerce_financial_journals WHERE kind='payout'").first()).n,1);
  f.control.drop='';const recovered=await f.run(code);assert.equal(recovered.status,0,recovered.error);
  assert.equal(JSON.parse(recovered.output).replayed,true);assert.equal(JSON.parse(recovered.output).outcome.payoutConfirmed,true);
  assert.equal(await providerCalls(),before);
  const cli=async extra=>new Promise((resolve,reject)=>{
    const child=spawn(process.env.PHP_BINARY||'php',['-n','-d','auto_prepend_file='+join(root,'tools/checkout-test/provider-fixture.php'),
      join(root,'tools/commerce/reconcile-withdrawal-payout.php'),'--environment=sandbox','--withdrawal='+f.w.id,
      '--seller-collection='+pair.sellerCollectionId,'--platform-collection='+pair.platformCollectionId,'--status-cap='+cap,...extra],{env:f.app.env});
    let output='',error='';child.stdout.on('data',x=>output+=x);child.stderr.on('data',x=>error+=x);child.on('error',reject);child.on('close',status=>resolve({status,output,error}));
  });
  const result=await cli([]);assert.equal(result.status,0,result.error);assert.equal(JSON.parse(result.output).providerCalls,0);
  assert.equal((await cli(['--status-cap='+cap])).status,1);
  assert.notEqual((await f.run(code,{EZKART_DEPLOYMENT_ENVIRONMENT:'production'})).status,0);
  await p.refreshEarnings(pair);await f.page.reload();await withdrawalIdle(f);await viewWithdrawal(f);
  assert.equal(await f.page.locator('[data-withdrawal-status]').innerText(),'Transfer completed');
  assert.match(await f.page.locator('[data-withdrawal-message]').innerText(),/stays deducted/);
  assert.doesNotMatch(await f.page.locator('[data-withdrawal-status-note]').innerText(),/remains reserved/);
  for(const width of [1360,390]){
    await f.page.setViewportSize({width,height:1000});assert.equal(await f.page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
    assert.equal(await f.page.locator('[data-withdrawal-dialog]').evaluate(el=>el.scrollWidth<=el.clientWidth),true);
    await f.page.screenshot({path:join(screens,'payout-completed-'+width+'.png'),fullPage:true});
  }
  await p.payoutStatus();await f.page.getByRole('button',{name:'Refresh request',exact:true}).click();await withdrawalIdle(f);
  assert.equal(await f.page.locator('[data-withdrawal-status]').innerText(),'Transfer reconciliation needs review');
  assert.match(await f.page.locator('[data-withdrawal-message]').innerText(),/Earlier accounting entries remain recorded/);
  assert.equal((await f.e.earnings()).completedWithdrawals,'250000');
  for(const file of ['/cart/api/commerce-payouts.php','/tools/commerce/reconcile-withdrawal-payout.php'])assert.equal((await fetch(f.app.base+file)).status,404);
  let expired=false;f.control.afterResponse=async path=>{if(!expired&&path===p.path+'/read'){expired=true;await f.session("$_SESSION['wallet_access']['expires_at']=time()-1");}};
  await f.page.getByRole('button',{name:'Refresh request',exact:true}).click();await f.page.getByRole('button',{name:'Send email code',exact:true}).waitFor();
  assert.equal(await f.page.locator('[data-withdrawals]').count(),0);assert.equal((await f.request('withdrawal_read',{id:f.w.id})).status,401);
  assert.equal(await providerCalls(),before);assert.deepEqual(f.errors,[]);
});

test('a reconciled voided transfer releases only its reservation and shows the failed outcome without another payment action',async t=>{
  const f=await paymentGrantFixture(t),p=payoutFixture({...f.e,p:f.p},f.w,f.g),cap=await p.payoutStatus('06');
  const pair=await p.collectPayout({payouts:[p.row('PAYOUT',250000,'VOID')]});
  const result=await p.reconcilePayout(pair,cap);assert.equal(result.recorded.state,'failed');assert.equal(result.recorded.feeAmount,'2500');
  await p.refreshEarnings(pair);assert.equal((await f.e.earnings()).availableEarnings,'756250');
  await f.page.reload();await withdrawalIdle(f);await viewWithdrawal(f);
  assert.equal(await f.page.locator('[data-withdrawal-status]').innerText(),'Transfer failed · funds released');
  assert.match(await f.page.locator('[data-withdrawal-message]').innerText(),/reservation has been released/);
  for(const selector of ['[data-withdrawal-cancel]','[data-withdrawal-confirm-form]','[data-withdrawal-check]'])assert.equal(await f.page.locator(selector).isHidden(),true);
  assert.equal((await f.request('withdrawal_pay',{id:f.w.id})).status,400);
  assert.equal((await f.app.calls()).filter(c=>c.url.endsWith('/sub-account/v2.0/transfer-payment')).length,0);assert.deepEqual(f.errors,[]);
});

test('withdrawal status uses the original signed provider reference and shows pending/success with funds reserved on desktop and mobile',async t=>{
  const f=await paymentGrantFixture(t,{EZKART_COMMERCE_WITHDRAWAL_STATUS:'enabled'}),before=await f.e.summary();
  const result=await f.request('withdrawal_status',{id:f.w.id});assert.equal(result.status,200,JSON.stringify(result.data));
  assert.equal(result.data.statusCheck.state,'recorded');assert.equal(result.data.withdrawal.payment.status.state,'reported_pending');
  const calls=async()=>(await f.app.calls()).filter(c=>c.url.endsWith('/sub-account/v2.0/transactions-status'));
  const call=(await calls())[0],h=Object.fromEntries(call.headers.map(x=>[x.slice(0,x.indexOf(':')).toLowerCase(),x.slice(x.indexOf(':')+1).trim()]));
  assert.deepEqual(JSON.parse(call.body),{partnerReferenceNo:f.g.binding.partnerReferenceNo});
  const canonical=['POST',new URL(call.url).pathname,'fixture-snap-wallet-token',createHash('sha256').update(call.body).digest('hex'),h['x-timestamp']].join(':');
  assert.equal(h['x-signature'],createHmac('sha512','fixture-doku-sandbox-secret').update(canonical).digest('base64'));assert.match(h['x-external-id'],/^[0-9]{32}$/);
  const files=(await readdir(f.recovery)).filter(name=>name.includes('-status-'));assert.equal(files.length,1);const file=join(f.recovery,files[0]),raw=await readFile(file,'utf8');
  assert.equal((await stat(file)).mode&0o777,0o600);
  await f.page.reload();await f.page.locator('[data-withdrawals][aria-busy=false]').waitFor();await f.page.getByRole('button',{name:'View withdrawal 1',exact:true}).click();
  await f.page.locator('[data-withdrawals][aria-busy=false]').waitFor();assert.equal(await f.page.locator('[data-withdrawal-status]').innerText(),'DOKU reports pending');
  // Separate observations beyond the provider transport's second resolution.
  await new Promise(resolve=>setTimeout(resolve,1100));await f.setControl({statusResponse:{latestTransactionStatus:'00',latestTransactionDesc:'success'}});
  await f.page.getByRole('button',{name:'Check transfer status',exact:true}).click();await f.page.locator('[data-withdrawals][aria-busy=false]').waitFor();
  assert.equal(await f.page.locator('[data-withdrawal-status]').innerText(),'DOKU reports success · reconciliation pending');
  assert.match(await f.page.locator('[data-withdrawal-status-note]').innerText(),/remains reserved/);
  assert.equal(await f.page.locator('[data-withdrawal-cancel]').isHidden(),true);assert.equal((await f.request('withdrawal_cancel',{id:f.w.id,requestKey:key()})).status,409);
  await f.page.screenshot({path:join(screens,'withdrawal-status-1360.png')});await f.page.setViewportSize({width:390,height:844});
  assert.equal(await f.page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);await f.page.screenshot({path:join(screens,'withdrawal-status-390.png')});
  assert.equal((await calls()).length,2);assert.equal(await readFile(file,'utf8'),raw);assert.equal((await readdir(f.recovery)).filter(name=>name.includes('-status-')).length,2);
  assert.equal((await f.app.calls()).filter(c=>c.url.endsWith('/sub-account/v2.0/transfer-payment')).length,0);
  assert.deepEqual(await f.e.summary(),before);assert.equal((await f.e.earnings()).reservedWithdrawals,'250000');assert.deepEqual(f.errors,[]);
  for(const path of ['/cart/api/commerce-withdrawal-status.php','/tools/commerce/finalize-withdrawal-status.php'])assert.equal((await fetch(f.app.base+path)).status,404);
});

test('withdrawal status receipts recover failed and lost acknowledgements from private originals without repeating a provider check',async t=>{
  const f=await paymentGrantFixture(t,{EZKART_COMMERCE_WITHDRAWAL_STATUS:'enabled'}),path=f.paymentPath+'/status/receipt';
  f.control.fail=path;let result=await f.request('withdrawal_status',{id:f.w.id});assert.equal(result.status,200,JSON.stringify(result.data));
  assert.equal(result.data.statusCheck.state,'review');assert.equal(await f.count('commerce_withdrawal_status_observations'),0);
  f.control.fail='';f.control.drop=path;result=await f.request('withdrawal_status',{id:f.w.id});assert.equal(result.status,200,JSON.stringify(result.data));
  assert.equal(result.data.statusCheck.state,'review');assert.equal(await f.count('commerce_withdrawal_status_observations'),1);
  const before=(await f.app.calls()).filter(c=>c.url.includes('doku.com')).length;
  const files=(await readdir(f.recovery)).filter(name=>name.includes('-status-'));assert.equal(files.length,2);
  for(const name of files){
    const file=join(f.recovery,name),raw=await readFile(file,'utf8');
    const finalize=()=>new Promise((resolve,reject)=>{
      const child=spawn(process.env.PHP_BINARY||'php',['-n','-d','auto_prepend_file='+join(root,'tools/checkout-test/provider-fixture.php'),
        join(root,'tools/commerce/finalize-withdrawal-status.php'),'--receipt-file='+file],{env:{...f.app.env,EZKART_COMMERCE_WITHDRAWALS:'held',EZKART_COMMERCE_WITHDRAWAL_STATUS:'held'}});
      let output='',error='';child.stdout.on('data',x=>output+=x);child.stderr.on('data',x=>error+=x);child.on('error',reject);child.on('close',status=>resolve({status,output,error}));
    });
    const recovered=await finalize();assert.equal(recovered.status,0,recovered.error);assert.equal(JSON.parse(recovered.output).providerCalls,0);
    assert.equal(JSON.parse(recovered.output).payoutConfirmed,false);assert.equal((await finalize()).status,0);assert.equal(await readFile(file,'utf8'),raw);
    await chmod(file,0o644);assert.equal((await finalize()).status,1);await chmod(file,0o600);
  }
  assert.equal(await f.count('commerce_withdrawal_status_observations'),2);assert.equal((await f.app.calls()).filter(c=>c.url.includes('doku.com')).length,before);
  assert.equal((await f.e.earnings()).reservedWithdrawals,'250000');
});

test('withdrawal status rejects injected identity and held or changed credentials before provider access, and preserves the response when Wallet expires',async t=>{
  const f=await paymentGrantFixture(t,{EZKART_COMMERCE_WITHDRAWAL_STATUS:'enabled'});
  const calls=async()=>(await f.app.calls()).filter(c=>c.url.endsWith('/sub-account/v2.0/transactions-status'));
  for(const extra of [{actor:proof('bob')},{environment:'production'},{seller:'seller_bob'},{partnerReferenceNo:'foreign'}])
    assert.equal((await f.request('withdrawal_status',{id:f.w.id,...extra})).status,422);
  assert.equal((await f.request('withdrawal_status',{id:f.w.id},{'X-Ezkart-Csrf':'wrong'})).status,401);
  assert.equal((await f.request('withdrawal_status',{id:f.w.id},{'X-Ezkart-Wallet-Store':'seller_bob'})).status,401);
  const scope=Buffer.from(JSON.stringify({environment:'sandbox',seller:'seller_alice',actor:proof()})).toString('base64');
  const code=`require ${JSON.stringify(join(root,'cart/api/commerce-withdrawal-status.php'))}; echo json_encode(ez_check_withdrawal_status('${f.w.id}',json_decode(base64_decode('${scope}'),true)));`;
  for(const extra of [{EZKART_COMMERCE_WITHDRAWAL_STATUS:'held'},{EZKART_DOKU_SANDBOX_SECRET_KEY:'foreign-fixture-secret'},
    {EZKART_COMMERCE_WITHDRAWAL_RECOVERY_DIRECTORY:join(root,'cart')}])assert.notEqual((await f.run(code,extra)).status,0);
  assert.equal((await calls()).length,0);
  // A read remains available while new withdrawal requests are independently held.
  const held=await f.run(code,{EZKART_COMMERCE_WITHDRAWALS:'held'});assert.equal(held.status,0,held.error);
  assert.equal(JSON.parse(held.output).state,'recorded');
  await f.setControl({statusFailure:true});assert.equal((await f.request('withdrawal_status',{id:f.w.id})).status,503);
  assert.equal(await f.count('commerce_withdrawal_status_observations'),1);await f.setControl({});
  await f.page.reload();await f.page.locator('[data-withdrawals][aria-busy=false]').waitFor();await f.page.getByRole('button',{name:'View withdrawal 1',exact:true}).click();
  await f.page.locator('[data-withdrawals][aria-busy=false]').waitFor();
  let expired=false;f.control.afterResponse=async path=>{if(!expired&&path===f.paymentPath+'/status/receipt'){expired=true;await f.session("$_SESSION['wallet_access']['expires_at']=time()-1");}};
  await f.page.getByRole('button',{name:'Check transfer status',exact:true}).click();await f.page.getByRole('button',{name:'Send email code',exact:true}).waitFor();
  assert.equal(await f.count('commerce_withdrawal_status_observations'),2);assert.equal(await f.page.locator('[data-withdrawals]').count(),0);
  assert.equal((await f.request('withdrawal_status',{id:f.w.id})).status,401);assert.equal((await calls()).length,3);
  assert.equal((await f.e.earnings()).reservedWithdrawals,'250000');
});

test('a payment-granted withdrawal keeps its reserved money and hides cancellation, confirmation and repeat bank actions in Wallet',async t=>{
  const f=await paymentGrantFixture(t);await f.page.reload();await f.page.locator('[data-withdrawals][aria-busy=false]').waitFor();
  await f.page.getByRole('button',{name:'View withdrawal 1',exact:true}).click();await f.page.locator('[data-withdrawals][aria-busy=false]').waitFor();
  assert.equal(await f.page.locator('[data-withdrawal-status]').innerText(),'Transfer needs review');
  assert.match(await f.page.locator('[data-withdrawal-message]').innerText(),/cannot be cancelled or sent again/);
  for(const selector of ['[data-withdrawal-cancel]','[data-withdrawal-confirm-form]','[data-withdrawal-check]'])assert.equal(await f.page.locator(selector).isHidden(),true);
  assert.equal((await f.request('withdrawal_cancel',{id:f.w.id,requestKey:key()})).status,409);
  for(const action of ['withdrawal_pay','withdrawal_payment_start'])assert.equal((await f.request(action,{id:f.w.id})).status,400);
  assert.equal((await f.e.earnings()).reservedWithdrawals,'250000');assert.equal((await f.e.summary()).balanced,true);
  assert.equal((await f.app.calls()).filter(c=>c.url.endsWith('/sub-account/v2.0/transfer-payment')).length,0);
  // Exercise only the presentation of a current read from a changed owner;
  // server ownership and payment/cancellation guards have separate real tests.
  await f.page.route('**/cart/admin/?wallet=withdrawal_read',async route=>{
    const response=await route.fetch(),data=await response.json();
    await route.fulfill({response,json:{...data,originalOwner:false,funds:{...data.funds,reservationShortfall:'1'}}});
  });
  await f.page.locator('[data-withdrawal-detail-refresh]').click();await f.page.locator('[data-withdrawals][aria-busy=false]').waitFor();
  const warning=await f.page.locator('[data-withdrawal-warning]').innerText();assert.match(warning,/previous owner authorized/);assert(!warning.includes('cancel'));
  await f.page.setViewportSize({width:390,height:844});assert.equal(await f.page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
  await f.page.screenshot({path:join(screens,'withdrawal-payment-review-390.png')});
});

test('original private payment evidence survives failed and lost acknowledgements and recovers in a fresh PHP process without a provider call',async t=>{
  const f=await paymentGrantFixture(t),input=join(f.recovery,'payment-input.json'),file=join(f.recovery,f.w.id+'-bank-payment.json');
  await writeFile(input,JSON.stringify(f.g),{mode:0o600});
  const encoded=await f.run(`require ${JSON.stringify(join(root,'cart/api/commerce-withdrawal-payments.php'))}; $g=json_decode(file_get_contents(${JSON.stringify(input)}),true); $c=EzDokuPayoutClient::configured('sandbox'); echo json_encode(['body'=>json_encode($c->paymentPayload($g['binding'],$g['originalInquiry'],$g['inquiryDigest']),JSON_UNESCAPED_SLASHES|JSON_UNESCAPED_UNICODE|JSON_THROW_ON_ERROR)]);`);
  assert.equal(encoded.status,0,encoded.error);const requestBody=JSON.parse(encoded.output).body;
  assert.equal((await f.call(f.paymentPath+'/read',{environment:'sandbox'})).requestBody,requestBody);
  const at=new Date().toISOString(),evidence={environment:'sandbox',credentialFingerprint:f.provider.credentialFingerprint,operation:'transfer-payment',
    externalId:f.g.binding.paymentExternalId,requestedAt:at,observedAt:at,requestBody,
    responseBody:JSON.stringify({...JSON.parse(requestBody),responseCode:'2000000',referenceNo:'PAY-'+f.w.id,referenceNumber:'BANK-'+f.w.id,transactionDate:at})};
  const document={version:1,withdrawalId:f.w.id,environment:'sandbox',confirmationId:f.g.confirmationId,binding:f.g.binding,evidence};
  await writeFile(input,JSON.stringify(document));
  const store=()=>f.run(`require ${JSON.stringify(join(root,'cart/api/commerce-withdrawal-payments.php'))}; ez_withdrawal_store_payment(${JSON.stringify(file)},json_decode(file_get_contents(${JSON.stringify(input)}),true));`);
  assert.equal((await store()).status,0);assert.equal((await store()).status,0);assert.equal((await stat(file)).mode&0o777,0o600);
  const raw=await readFile(file,'utf8'),before=(await f.app.calls()).filter(c=>c.url.includes('doku.com')).length;
  const finalize=()=>new Promise((resolve,reject)=>{
    const child=spawn(process.env.PHP_BINARY||'php',['-n','-d','auto_prepend_file='+join(root,'tools/checkout-test/provider-fixture.php'),
      join(root,'tools/commerce/finalize-withdrawal-payment.php'),'--receipt-file='+file],{env:f.app.env});
    let output='',error='';child.stdout.on('data',x=>output+=x);child.stderr.on('data',x=>error+=x);child.on('error',reject);child.on('close',status=>resolve({status,output,error}));
  });
  f.control.fail=f.paymentPath+'/receipt';assert.equal((await finalize()).status,1);assert.equal(await f.count('commerce_withdrawal_payment_receipts'),0);
  f.control.fail='';f.control.drop=f.paymentPath+'/receipt';assert.equal((await finalize()).status,1);assert.equal(await f.count('commerce_withdrawal_payment_receipts'),1);
  f.control.drop='';const recovered=await finalize();assert.equal(recovered.status,0,recovered.error);assert.equal(JSON.parse(recovered.output).providerCalls,0);assert.equal(JSON.parse(recovered.output).payoutConfirmed,false);
  assert.equal((await finalize()).status,0);assert.equal(await readFile(file,'utf8'),raw);assert.equal(await f.count('commerce_withdrawal_payment_receipts'),1);
  await writeFile(input,JSON.stringify({...document,confirmationId:'wdconf_'+'f'.repeat(40)}));assert.notEqual((await store()).status,0);assert.equal(await readFile(file,'utf8'),raw);
  await chmod(file,0o644);assert.equal((await finalize()).status,1);await chmod(file,0o600);assert.equal((await finalize()).status,0);
  assert.equal((await f.app.calls()).filter(c=>c.url.includes('doku.com')).length,before);
  assert.equal((await f.e.earnings()).reservedWithdrawals,'250000');
  await f.page.reload();await f.page.locator('[data-withdrawals][aria-busy=false]').waitFor();await f.page.getByRole('button',{name:'View withdrawal 1',exact:true}).click();
  await f.page.locator('[data-withdrawals][aria-busy=false]').waitFor();assert.equal(await f.page.locator('[data-withdrawal-status]').innerText(),'Transfer response saved');
  assert.equal(await f.page.locator('[data-withdrawal-cancel]').isHidden(),true);
  for(const path of ['/cart/api/commerce-withdrawal-payments.php','/tools/commerce/finalize-withdrawal-payment.php'])assert.equal((await fetch(f.app.base+path)).status,404);
});

test('the protected merchant bank inquiry persists its receipt, confirms the returned beneficiary and never sends a payment',async t=>{
  const f=await bankInquiryFixture(t),w=await f.reserve(),name='Fixture Bank Owner Ω\u2028\u2029';await f.setControl({inquiryName:name,inquiryLiteralUnicode:true});
  const result=await f.inquire(w);assert.equal(result.status,200,JSON.stringify(result.data));assert.equal(result.data.withdrawal.bankVerified,true);
  assert.equal(result.data.withdrawal.bank.beneficiaryName,name);assert.equal(result.data.withdrawal.bank.accountNumber,'001234567890');assert.equal(result.data.withdrawal.payoutConfirmed,false);
  const receipt=join(f.recovery,w.id+'-bank-inquiry.json');assert.equal((await stat(receipt)).mode&0o777,0o600);
  const saved=JSON.parse(await readFile(receipt,'utf8'));assert.equal(saved.withdrawalId,w.id);assert.equal(saved.binding.beneficiaryAccountNumber,'001234567890');
  assert(saved.evidence.responseBody.includes(name)); // Exercise PHP/Worker digests over literal Unicode line separators.
  const confirmation=await f.request('withdrawal_confirm',{id:w.id,requestKey:key(),inquiryDigest:result.data.withdrawal.inquiry.digest});assert.equal(confirmation.status,200,JSON.stringify(confirmation.data));
  assert.equal(confirmation.data.payoutConfirmed,false);assert.equal((await f.inquire(w)).data.bankCheck.providerCalls,0);assert.equal((await f.bankCalls()).length,1);
  const history=await f.request('withdrawal_list',{});assert.equal(history.status,200);assert(!JSON.stringify(history.data).includes('001234567890'));
  assert(!(await f.app.calls()).some(c=>c.url.endsWith('/transfer-payment')));
  assert(!/credentialFingerprint|requestBody|responseBody|SAC-|2010000001/.test(JSON.stringify(result.data)));
  for(const extra of [{actor:proof('bob')},{seller:'seller_bob'},{environment:'production'},{credentialFingerprint:'f'.repeat(64)}])
    assert.equal((await f.request('withdrawal_inquire',{id:w.id,...extra})).status,422);
  assert.equal((await f.request('withdrawal_read',{id:w.id},{'X-Ezkart-Csrf':'changed'})).status,401);
  await f.session("$_SESSION['wallet_access']['expires_at']=time()-1");
  for(const action of ['withdrawal_read','withdrawal_list','withdrawal_inquire','withdrawal_confirm','withdrawal_cancel'])assert.equal((await f.request(action,action==='withdrawal_list'?{}:{id:w.id})).status,401);
});

test('a lost inquiry-grant acknowledgement cannot cause the merchant proxy to call the provider on replay',async t=>{
  const f=await bankInquiryFixture(t),w=await f.reserve();f.control.drop='/internal/commerce/finance/withdrawals/'+w.id+'/inquiry/start';
  const lost=await f.inquire(w);assert(lost.status>=500);assert.equal((await f.bankCalls()).length,0);assert.equal(await f.count('commerce_withdrawal_inquiry_grants'),1);
  const replay=await f.inquire(w);assert.equal(replay.status,200,JSON.stringify(replay.data));assert.equal(replay.data.withdrawal.inquiry.state,'review');assert.equal((await f.bankCalls()).length,0);
  assert.equal((await f.request('withdrawal_cancel',{id:w.id,requestKey:key()})).status,200);assert.equal((await f.e.earnings()).reservedWithdrawals,'0');
});

test('private original receipts recover missing or lost storage acknowledgements without another provider inquiry',async t=>{
  for(const failure of ['fail','drop']){
    const f=await bankInquiryFixture(t),w=await f.reserve();f.control[failure]='/internal/commerce/finance/withdrawals/'+w.id+'/inquiry/receipt';
    const first=await f.inquire(w);assert.equal(first.status,200,JSON.stringify(first.data));assert.equal((await f.bankCalls()).length,1);
    assert.equal(first.data.bankCheck.state,failure==='drop'?'verified':'review');
    const file=join(f.recovery,w.id+'-bank-inquiry.json'),original=await readFile(file,'utf8');assert.equal(await f.count('commerce_withdrawal_inquiry_receipts'),failure==='drop'?1:0);
    f.control[failure]='';const recovered=await f.inquire(w);assert.equal(recovered.status,200,JSON.stringify(recovered.data));assert.equal(recovered.data.withdrawal.bankVerified,true);
    assert.equal(await f.count('commerce_withdrawal_inquiry_receipts'),1);assert.equal((await f.bankCalls()).length,1);assert.equal(await readFile(file,'utf8'),original);
    assert.equal((await f.e.earnings()).reservedWithdrawals,'250000');assert.equal((await f.e.summary()).balanced,true);
  }
});

test('failed or mismatched provider inquiries retain their original grant and diagnostic instead of retrying or confirming a bank',async t=>{
  for(const failure of ['inquiryFailure','inquiryWrongAccount']){
    const f=await bankInquiryFixture(t),w=await f.reserve();await f.setControl({[failure]:true});
    const first=await f.inquire(w);assert.equal(first.status,200,JSON.stringify(first.data));assert.equal(first.data.withdrawal.bankVerified,false);
    assert.equal(first.data.withdrawal.inquiry.state,'review');const diagnostic=(await f.call('/internal/commerce/finance/withdrawals/'+w.id+'/inquiry/read',{environment:'sandbox'})).diagnostic;
    assert.equal(diagnostic.stage,'provider_inquiry');assert.equal(diagnostic.providerStatus,failure==='inquiryFailure'?503:0);
    await f.setControl({});assert.equal((await f.inquire(w)).data.bankCheck.providerCalls,0);assert.equal((await f.bankCalls()).length,1);
    assert.equal((await f.request('withdrawal_confirm',{id:w.id,requestKey:key(),inquiryDigest:'a'.repeat(64)})).status,409);
  }
});

test('private receipt finalization works with the inquiry switch held and makes no provider call',async t=>{
  const f=await bankInquiryFixture(t),w=await f.reserve();f.control.fail='/internal/commerce/finance/withdrawals/'+w.id+'/inquiry/receipt';
  assert.equal((await f.inquire(w)).status,200);f.control.fail='';const file=join(f.recovery,w.id+'-bank-inquiry.json');
  const run=()=>new Promise((resolve,reject)=>{
    const child=spawn(process.env.PHP_BINARY||'php',['-n','-d','auto_prepend_file='+join(root,'tools/checkout-test/provider-fixture.php'),
      join(root,'tools/commerce/finalize-withdrawal-inquiry.php'),'--receipt-file='+file],{env:{...f.app.env,EZKART_COMMERCE_WITHDRAWAL_INQUIRY:'held'}});
    let output='',error='';child.stdout.on('data',x=>output+=x);child.stderr.on('data',x=>error+=x);child.on('error',reject);child.on('close',status=>resolve({status,output,error}));
  });
  const done=await run();assert.equal(done.status,0,done.error);assert.equal(JSON.parse(done.output).providerCalls,0);assert.equal((await f.bankCalls()).length,1);
  assert.equal((await run()).status,0);assert.equal(await f.count('commerce_withdrawal_inquiry_receipts'),1);
  await chmod(file,0o644);assert.equal((await run()).status,1);await chmod(file,0o600);
  for(const path of ['/tools/commerce/finalize-withdrawal-inquiry.php','/cart/api/commerce-withdrawal-inquiries.php']){
    const blocked=await fetch(f.app.base+path);assert.equal(blocked.status,404);assert.equal(await blocked.text(),'');
  }
});

test('held merchant withdrawals and unavailable private recovery storage consume no inquiry grants',async t=>{
  const held=await bankInquiryFixture(t,{EZKART_COMMERCE_WITHDRAWALS:'held'});
  assert.equal((await held.request('withdrawal_reserve',{requestKey:key(),amount:'250000',bank:{code:'CENAIDJA',accountNumber:'001234567890',channel:'BI_FAST'}})).status,503);
  assert.equal(await held.count('commerce_withdrawals'),0);assert.equal((await held.bankCalls()).length,0);
  const f=await bankInquiryFixture(t,{EZKART_COMMERCE_WITHDRAWAL_RECOVERY_DIRECTORY:'/tmp'}),w=await f.reserve();
  assert.equal((await f.inquire(w)).status,503);assert.equal(await f.count('commerce_withdrawal_inquiry_grants'),0);assert.equal((await f.bankCalls()).length,0);
});

const withdrawalIdle=f=>f.page.locator('[data-withdrawals][aria-busy=false]').waitFor();
async function chooseWithdrawalBank(f,name){
  await f.page.getByLabel('Find your bank',{exact:true}).fill(name);
  const control=f.page.getByRole('combobox',{name:'Bank',exact:true});
  if(await control.evaluate(node=>node.tagName==='SELECT'))await control.selectOption({label:name});
  else {await control.click();await f.page.getByRole('option',{name,exact:true}).click();}
}
async function fillWithdrawal(f){
  await f.page.getByRole('button',{name:'Withdraw funds',exact:true}).click();await withdrawalIdle(f);
  await f.page.getByLabel('Withdrawal amount (IDR)',{exact:true}).fill('250000');
  await chooseWithdrawalBank(f,'BANK BCA');
  await f.page.getByLabel('Bank account number',{exact:true}).fill('001234567890');
}
async function saveWithdrawal(f){
  await fillWithdrawal(f);await f.page.getByRole('button',{name:'Save withdrawal request',exact:true}).click();await withdrawalIdle(f);
  await f.page.locator('[data-withdrawal-detail]').waitFor({state:'visible'});
  return (await f.db.prepare('SELECT id FROM commerce_withdrawals ORDER BY sequence DESC LIMIT 1').first()).id;
}
async function viewWithdrawal(f,sequence=1){
  await f.page.getByRole('button',{name:'View withdrawal '+sequence,exact:true}).click();await withdrawalIdle(f);
}

test('withdrawal screens save, verify, confirm and cancel the original request on desktop and mobile without claiming a transfer',async t=>{
  const f=await bankInquiryFixture(t);await f.setControl({inquiryName:'Owner <img src=x onerror=alert(1)>'});
  await fillWithdrawal(f);await mkdir(screens,{recursive:true});
  await f.page.setViewportSize({width:390,height:844});await f.page.screenshot({path:join(screens,'withdrawal-request-form-390.png'),fullPage:true});
  await f.page.getByRole('button',{name:'Save withdrawal request',exact:true}).click();await withdrawalIdle(f);
  const id=(await f.db.prepare('SELECT id FROM commerce_withdrawals').first()).id;assert.equal(await f.count('commerce_withdrawals'),1);assert.equal((await f.bankCalls()).length,0);
  assert.equal(await f.page.locator('[data-withdrawal-account]').innerText(),'001234567890');
  await f.page.getByRole('button',{name:'Verify bank account',exact:true}).click();await withdrawalIdle(f);
  assert.equal((await f.bankCalls()).length,1);assert.equal(await f.page.locator('[data-withdrawal-beneficiary]').innerText(),'Owner <img src=x onerror=alert(1)>');
  assert.equal(await f.page.locator('[data-withdrawal-dialog] img').count(),0);
  await f.page.getByRole('button',{name:'Confirm bank details',exact:true}).click();assert.equal(await f.count('commerce_withdrawal_confirmations'),0);
  await mkdir(screens,{recursive:true});
  for(const width of [1360,390]){
    await f.page.setViewportSize({width,height:width===390?844:1000});
    assert.equal(await f.page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
    assert.equal(await f.page.locator('[data-withdrawal-dialog]').evaluate(node=>node.scrollWidth<=node.clientWidth),true);
    await f.page.screenshot({path:join(screens,'withdrawal-bank-review-'+width+'.png'),fullPage:true});
  }
  await f.page.getByRole('checkbox').check();await f.page.getByRole('button',{name:'Confirm bank details',exact:true}).click();await withdrawalIdle(f);
  assert.equal(await f.count('commerce_withdrawal_confirmations'),1);assert.match(await f.page.locator('[data-withdrawal-confirmed]').innerText(),/No transfer has been started/);
  await f.page.getByRole('button',{name:'Close withdrawal details',exact:true}).click();
  assert(!(await f.page.locator('body').innerText()).includes('001234567890'));
  assert(!(await f.page.evaluate(()=>JSON.stringify({...sessionStorage,...localStorage}))).includes('001234567890'));
  await f.page.reload();await withdrawalIdle(f);await viewWithdrawal(f);
  assert.equal(await f.page.locator('[data-withdrawal-reference]').innerText(),id);assert.equal(await f.count('commerce_withdrawals'),1);
  await f.page.getByRole('button',{name:'Cancel request',exact:true}).click();await f.page.getByRole('button',{name:'Keep request',exact:true}).click();
  assert.equal(await f.count('commerce_withdrawal_cancellations'),0);
  await f.page.getByRole('button',{name:'Cancel request',exact:true}).click();await f.page.getByRole('button',{name:'Confirm cancellation',exact:true}).click();await withdrawalIdle(f);
  assert.equal(await f.page.locator('[data-withdrawal-status]').innerText(),'Cancelled');assert.equal((await f.e.earnings()).availableEarnings,'756250');
  assert.equal((await f.bankCalls()).length,1);assert(!(await f.app.calls()).some(call=>call.url.endsWith('/transfer-payment')));assert.deepEqual(f.errors,[]);
});

test('withdrawal recovery survives lost reservation or detail replies and reloads without saving a second intent',async t=>{
  for(const mode of ['lost_ack','lost_detail','not_committed']){
    await t.test(mode,async t=>{
      const f=await bankInquiryFixture(t);let blocked=true;
      await f.page.route('**/cart/admin/?wallet=withdrawal_lookup',async route=>{
        if(blocked)await route.fulfill({status:503,json:{ok:false,error:'Temporary lookup failure'}});
        else await route.continue();
      });
      if(mode==='lost_ack')await f.page.route('**/cart/admin/?wallet=withdrawal_reserve',async route=>{const response=await route.fetch();await route.fulfill({status:503,json:{ok:false,error:'Lost reservation reply'}});assert.equal(response.status(),200);});
      if(mode==='lost_detail')await f.page.route('**/cart/admin/?wallet=withdrawal_read',route=>route.fulfill({status:503,json:{ok:false,error:'Temporary detail failure'}}));
      if(mode==='not_committed')f.control.fail='/internal/commerce/finance/withdrawals';
      await fillWithdrawal(f);await f.page.getByRole('button',{name:'Save withdrawal request',exact:true}).click();await withdrawalIdle(f);
      const storage='ezkart-withdrawal:alice:seller_alice:sandbox:reserve',savedKey=await f.page.evaluate(name=>sessionStorage.getItem(name),storage);
      assert.match(savedKey,/^[a-f0-9]{32}$/);assert.equal(await f.count('commerce_withdrawals'),mode==='not_committed'?0:1);
      assert(!(await f.page.evaluate(()=>JSON.stringify(sessionStorage))).includes('001234567890'));
      blocked=false;f.control.fail='';await f.page.unroute('**/cart/admin/?wallet=withdrawal_reserve');await f.page.unroute('**/cart/admin/?wallet=withdrawal_read');
      await f.page.reload();await withdrawalIdle(f);
      if(mode==='not_committed'){
        await fillWithdrawal(f);await f.page.getByRole('button',{name:'Save withdrawal request',exact:true}).click();await withdrawalIdle(f);
      }else{await f.page.getByRole('button',{name:'Check previous request',exact:true}).click();await withdrawalIdle(f);}
      assert.equal(await f.count('commerce_withdrawals'),1);
      assert.equal((await f.db.prepare('SELECT request_key FROM commerce_withdrawals').first()).request_key,savedKey);
      assert.equal(await f.page.locator('[data-withdrawal-account]').innerText(),'001234567890');assert.equal((await f.e.earnings()).reservedWithdrawals,'250000');
      assert.equal((await f.bankCalls()).length,0);assert.deepEqual(f.errors,[]);
    });
  }
});

test('withdrawal UI shows current funding holds and preserves one uncertain bank check across retries and cancellation',async t=>{
  const f=await bankInquiryFixture(t);await saveWithdrawal(f);const refund=await f.e.refund(f.p);
  await f.page.getByRole('button',{name:'Refresh request',exact:true}).click();await withdrawalIdle(f);
  assert.match(await f.page.locator('[data-withdrawal-warning]').innerText(),/no longer cover/);assert.equal(await f.page.getByRole('button',{name:'Verify bank account',exact:true}).isDisabled(),true);
  await f.e.refundAction(refund.id,'decline');await f.page.getByRole('button',{name:'Refresh request',exact:true}).click();await withdrawalIdle(f);
  await f.setControl({inquiryFailure:true});await f.page.getByRole('button',{name:'Verify bank account',exact:true}).click();await withdrawalIdle(f);
  assert.equal(await f.page.locator('[data-withdrawal-status]').innerText(),'Bank check needs review');assert.equal((await f.bankCalls()).length,1);
  await f.setControl({});await f.page.getByRole('button',{name:'Check bank verification',exact:true}).click();await withdrawalIdle(f);
  assert.equal((await f.bankCalls()).length,1);assert.equal(await f.page.getByRole('button',{name:'Confirm bank details',exact:true}).isVisible(),false);
  await f.page.getByRole('button',{name:'Cancel request',exact:true}).click();await f.page.getByRole('button',{name:'Confirm cancellation',exact:true}).click();await withdrawalIdle(f);
  assert.equal(await f.count('commerce_withdrawal_cancellations'),1);assert.equal((await f.e.summary()).balanced,true);assert.deepEqual(f.errors,[]);
});

test('withdrawal UI closes and clears bank details on expired authorization after an already saved provider receipt',async t=>{
  const f=await bankInquiryFixture(t);await saveWithdrawal(f);let expired=false;
  f.control.afterResponse=async path=>{if(!expired&&path.endsWith('/inquiry/receipt')){expired=true;await f.session("$_SESSION['wallet_access']['expires_at']=time()-1");}};
  await f.page.getByRole('button',{name:'Verify bank account',exact:true}).click();
  await f.page.getByRole('button',{name:'Send email code',exact:true}).waitFor();
  assert.equal(await f.page.locator('[data-wallet-content]').count(),0);
  assert.equal(await f.page.locator('dialog[open]').count(),0);assert(!(await f.page.content()).includes('001234567890'));
  assert.equal(await f.count('commerce_withdrawal_inquiry_receipts'),1);assert.equal((await f.bankCalls()).length,1);
  await f.page.getByRole('button',{name:'Send email code',exact:true}).click();
  await f.page.getByText('Wait one minute before requesting another email code.',{exact:true}).waitFor();
  // The fixture advanced the grant expiry, so advance only its local send
  // cooldown as well; re-verification still goes through the actual code form.
  const rateFile=join(f.app.env.EZKART_ADMIN_SESSION_STORAGE,'wallet-rate-limits',createHash('sha256').update(f.app.env.EZKART_SUPABASE_URL+'|alice').digest('hex')+'.json');
  const rate=JSON.parse(await readFile(rateFile,'utf8'));rate.send=rate.send.map(at=>at-61);await writeFile(rateFile,JSON.stringify(rate));
  f.control.afterResponse=null;await f.unlock();await withdrawalIdle(f);await viewWithdrawal(f);
  assert.equal(await f.page.locator('[data-withdrawal-status]').innerText(),'Bank verified');assert.equal((await f.bankCalls()).length,1);assert.deepEqual(f.errors,[]);
  let cleared=null;
  f.page.on('console',message=>{if(message.text().startsWith('withdrawal-lock-check:'))cleared=JSON.parse(message.text().slice('withdrawal-lock-check:'.length));});
  await f.page.evaluate(()=>window.addEventListener('ezkart:wallet-locked',()=>console.info('withdrawal-lock-check:'+JSON.stringify({
    open:!!document.querySelector('[data-withdrawal-dialog][open]'),
    bankText:document.querySelector('[data-withdrawal-account]').textContent.length,
    accountInput:document.getElementById('withdrawal-account').value.length,
  }))));
  await f.session("$_SESSION['wallet_access']['expires_at']=time()-1");
  await f.page.evaluate(()=>window.dispatchEvent(new Event('ezkart:wallet-refresh')));
  await f.page.getByRole('button',{name:'Send email code',exact:true}).waitFor();
  assert.deepEqual(cleared,{open:false,bankText:0,accountInput:0});
  assert.equal(await f.count('commerce_withdrawal_inquiry_receipts'),1);assert.equal((await f.bankCalls()).length,1);
});

test('withdrawal history pages retain their original cohort, mask accounts and allow cancellation while new requests are held',async t=>{
  const f=await bankInquiryFixture(t);
  for(let i=0;i<11;i++){const w=await f.reserve();assert.equal((await f.request('withdrawal_cancel',{id:w.id,requestKey:key()})).status,200);}
  await f.page.getByRole('button',{name:'Refresh requests',exact:true}).click();await withdrawalIdle(f);assert.equal(await f.page.locator('[data-withdrawal-history] tr').count(),10);
  const later=await f.reserve();await f.page.getByRole('button',{name:'Load earlier requests',exact:true}).click();await withdrawalIdle(f);
  assert.equal(await f.page.locator('[data-withdrawal-history] tr').count(),11);assert.equal(await f.page.locator('[data-withdrawal-id="'+later.id+'"]').count(),0);
  assert(!(await f.page.locator('[data-withdrawal-history]').innerText()).includes('001234567890'));
  await f.page.getByRole('button',{name:'Refresh requests',exact:true}).click();await withdrawalIdle(f);assert.equal(await f.page.locator('[data-withdrawal-id="'+later.id+'"]').count(),1);
  await f.page.setViewportSize({width:390,height:844});await f.page.reload();await withdrawalIdle(f);
  assert.equal(await f.page.locator('[data-withdrawal-history-table]').evaluate(node=>node.scrollWidth<=node.clientWidth),true);
  await mkdir(screens,{recursive:true});
  await f.page.locator('[data-withdrawals]').evaluate(node=>node.scrollIntoView({block:'start',behavior:'instant'}));
  await f.page.screenshot({path:join(screens,'withdrawal-history-390.png')});
  const held=await bankInquiryFixture(t,{EZKART_COMMERCE_WITHDRAWALS:'held'}),created=await held.call('/internal/commerce/finance/withdrawals',{environment:'sandbox',seller:'seller_alice',actor:proof(),requestKey:key(),amount:'250000',bank:{code:'CENAIDJA',accountNumber:'001234567890',channel:'BI_FAST'}});
  assert.equal(created.status,200,created.error);await held.page.getByRole('button',{name:'Refresh requests',exact:true}).click();await withdrawalIdle(held);
  assert.equal(await held.page.getByRole('button',{name:'Withdraw funds',exact:true}).isDisabled(),true);await viewWithdrawal(held);
  assert.equal(await held.page.getByRole('button',{name:'Verify bank account',exact:true}).isDisabled(),true);
  await held.page.getByRole('button',{name:'Cancel request',exact:true}).click();await held.page.getByRole('button',{name:'Confirm cancellation',exact:true}).click();await withdrawalIdle(held);
  assert.equal(await held.count('commerce_withdrawal_cancellations'),1);assert.equal((await held.bankCalls()).length,0);
});

test('merchant bank choices use the published channel catalog and cannot submit unsupported bank methods or caller identities',async t=>{
  const f=await bankInquiryFixture(t),read=await f.request('read');assert.equal(read.data.withdrawalCapabilities.banks.length,125);
  await fillWithdrawal(f);await chooseWithdrawalBank(f,'BANK DANAMON UUS (SYARIAH)');
  assert.deepEqual(await f.page.locator('#withdrawal-channel option').allTextContents(),['BI-FAST']);
  for(const bank of [{code:'SYBDIDJ1',accountNumber:'001234567890',channel:'ONLINE'},{code:'FAKEIDJA',accountNumber:'001234567890',channel:'BI_FAST'}]){
    assert.equal((await f.request('withdrawal_reserve',{requestKey:key(),amount:'250000',bank})).status,422);
  }
  assert.equal((await f.request('withdrawal_lookup',{requestKey:key(),seller:'seller_bob'})).status,422);
  assert.equal(await f.count('commerce_withdrawals'),0);assert.equal((await f.bankCalls()).length,0);
  assert.equal((await fetch(f.app.base+'/cart/admin/wallet-withdrawals.php')).status,404);
});

test('merchant Wallet verifies owner identity, connects through the real proxy, and survives desktop/mobile reloads without inventing earnings',async t=>{
  const f=await merchantFixture(t);await mkdir(join(f.app.directory,'orders'),{recursive:true});await writeFile(join(f.app.directory,'orders','legacy-wallet.json'),JSON.stringify({order_id:'EZK-S-LEGACYWALLETSENTINEL',seller_id:'seller_alice',status:'PAID',subtotal:999999}));await f.unlock();assert.equal((await f.registerCalls()).length,0);
  assert(!(await f.page.content()).includes('LEGACYWALLETSENTINEL'));assert.equal(await f.page.locator('.wallet-payment-summary').count(),0);
  await f.db.prepare("UPDATE sellers SET name='Tea <img src=x onerror=alert(1)>' WHERE id='seller_alice'").run();await f.page.locator('[data-wallet-setup-refresh]').click();await f.page.locator('[data-wallet-setup][aria-busy=false]').waitFor();
  assert.match(await f.page.locator('[data-wallet-setup-name]').innerText(),/<img/);assert.equal(await f.page.locator('[data-wallet-setup] img').count(),0);
  await mkdir(screens,{recursive:true});await f.page.screenshot({path:join(screens,'wallet-ready-1360.png'),fullPage:true});
  await f.page.getByRole('button',{name:'Connect seller wallet',exact:true}).click();await f.page.locator('[data-wallet-setup][data-state=connected][aria-busy=false]').waitFor();
  assert.match(await f.page.locator('.wallet-amount').innerText(),/Rp\s*0$/);assert.equal(await f.page.getByRole('button',{name:'Withdraw funds'}).isDisabled(),true);assert.match(await f.page.locator('[data-wallet-setup-account]').innerText(),/^Ending in [0-9]{4}$/);
  assert.equal((await f.registerCalls()).length,1);assert.equal(await f.count('commerce_wallet_enrollments'),1);assert.equal(await f.count('commerce_financial_journals'),0);
  for(const width of [1360,390]){await f.page.setViewportSize({width,height:1000});await f.page.reload();await f.page.locator('[data-wallet-setup][data-state=connected][aria-busy=false]').waitFor();assert.equal(await f.page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);await f.page.screenshot({path:join(screens,`wallet-connected-${width}.png`),fullPage:true});}
  assert.equal((await f.registerCalls()).length,1);assert.deepEqual(f.errors,[]);
});

test('protected Wallet shows actual released earnings, reserves and stable history on desktop and mobile and clears failed or expired reads',async t=>{
  const bindings={COMMERCE_PLATFORM_WALLET_SELLER:'seller_bob'},f=await merchantFixture(t,{}, {bindings}),e=await setupEarningsFixture(t,{baseFixture:f,bindings});
  const p=await e.payment();await e.settle(p);await e.deliver(p);
  for(let i=0;i<11;i++){const r=await e.refund(p);await e.refundAction(r.id,'decline');}
  await f.unlock();
  const amount=async name=>(await f.page.locator('[data-wallet-earnings-'+name+']').innerText()).replace(/\D/g,'');
  assert.equal(await amount('available'),'34250');assert.equal(await amount('reserved'),'0');
  assert.equal(await f.page.locator('[data-wallet-earnings-history] tr').count(),20);
  await f.page.locator('[data-wallet-earnings-more]').click();await f.page.locator('[data-wallet-setup][aria-busy=false]').waitFor();
  assert.equal(await f.page.locator('[data-wallet-earnings-history] tr').count(),23);assert.equal(await f.page.locator('[data-wallet-earnings-more]').isHidden(),true);
  assert.equal(await f.page.getByRole('button',{name:'Withdraw funds'}).isDisabled(),true);
  const raw=await f.request('read');assert.equal(raw.status,200);assert(!/fcol_|fobs_|credentialFingerprint|providerReference/.test(JSON.stringify(raw.data)));
  await mkdir(screens,{recursive:true});
  for(const width of [1360,390]){await f.page.setViewportSize({width,height:1000});await f.page.reload();await f.page.locator('[data-wallet-setup][aria-busy=false]').waitFor();await f.page.evaluate(()=>window.scrollTo(0,0));assert.equal(await amount('available'),'34250');assert.equal(await f.page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);assert.equal(await f.page.locator('[data-wallet-earnings-history-table]').evaluate(el=>el.scrollWidth<=el.clientWidth),true);await f.page.screenshot({path:join(screens,'wallet-earnings-'+width+'.png'),fullPage:true});}
  await e.refund(p);await f.page.locator('[data-wallet-setup-refresh]').click();await f.page.locator('[data-wallet-setup][aria-busy=false]').waitFor();
  assert.equal(await amount('available'),'0');assert.equal(await amount('reserved'),'34250');
  f.control.fail='/internal/commerce/finance/earnings/summary?seller=seller_alice&environment=sandbox';await f.page.locator('[data-wallet-setup-refresh]').click();await f.page.locator('[data-wallet-setup][aria-busy=false]').waitFor();
  assert.equal(await f.page.locator('.wallet-amount').innerText(),'—');assert.match(await f.page.locator('[data-wallet-earnings-status]').innerText(),/could not be checked/);
  assert.match(await f.page.locator('#wallet-withdraw-reason').innerText(),/could not be checked/);assert.equal(await f.page.getByRole('button',{name:'Withdraw funds',exact:true}).isDisabled(),true);
  f.control.fail=null;await f.session("$_SESSION['wallet_access']['expires_at']=time()-1");
  assert.equal((await f.request('history&cap=99&before=99')).status,401);
  assert.equal((await f.request('read')).status,401);assert.deepEqual(f.errors,[]);assert.equal((await f.registerCalls()).length,0);
});

test('protected Wallet separates withdrawal reservations and reports changed funding without exposing bank details',async t=>{
  const bindings={COMMERCE_PLATFORM_WALLET_SELLER:'seller_bob'},f=await merchantFixture(t,{}, {bindings}),e=await setupEarningsFixture(t,{baseFixture:f,bindings});
  await e.product('withdrawal-ui',10,'seller_alice',400000);
  const p=await e.payment({items:[{productId:'withdrawal-ui',quantity:2,expectedPrice:400000,expectedWeightGrams:100}]});await e.settle(p);await e.deliver(p);
  const payload={environment:'sandbox',seller:'seller_alice',actor:proof()},withdrawals='/internal/commerce/finance/withdrawals';
  const reserved=await f.call(withdrawals,{...payload,requestKey:key(),amount:'500000',bank:{code:'CENAIDJA',accountNumber:'001234567890',channel:'BI_FAST'}});assert.equal(reserved.status,200,reserved.error);
  await f.unlock();const amount=async name=>(await f.page.locator('[data-wallet-earnings-'+name+']').innerText()).replace(/\D/g,'');
  for(const width of [1360,390]){
    await f.page.setViewportSize({width,height:1000});await f.page.reload();await f.page.locator('[data-wallet-setup][aria-busy=false]').waitFor();
    assert.equal(await amount('available'),'256250');assert.equal(await amount('withdrawals'),'500000');assert.equal(await f.page.locator('[data-wallet-earnings-withdrawals-row]').isVisible(),true);
    assert.match(await f.page.locator('[data-wallet-earnings-status]').innerText(),/already deducted/);assert(!(await f.page.locator('body').innerText()).includes('001234567890'));
    assert.equal(await f.page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
    await mkdir(screens,{recursive:true});await f.page.screenshot({path:join(screens,'wallet-withdrawal-reservation-'+width+'.png'),fullPage:true});
  }
  const refund=await e.refund(p);await f.page.locator('[data-wallet-setup-refresh]').click();await f.page.locator('[data-wallet-setup][aria-busy=false]').waitFor();
  assert.equal(await amount('available'),'0');assert.equal(await amount('reserved'),'756250');assert.match(await f.page.locator('[data-wallet-earnings-status]').innerText(),/no longer cover/);
  const cancelled=await f.call(withdrawals+'/'+reserved.withdrawal.id+'/cancel',{...payload,requestKey:key()});assert.equal(cancelled.status,200,cancelled.error);
  await f.page.locator('[data-wallet-setup-refresh]').click();await f.page.locator('[data-wallet-setup][aria-busy=false]').waitFor();
  assert.equal(await f.page.locator('[data-wallet-earnings-withdrawals-row]').isHidden(),true);assert.equal(await amount('available'),'0');
  await e.refundAction(refund.id,'decline');await f.page.locator('[data-wallet-setup-refresh]').click();await f.page.locator('[data-wallet-setup][aria-busy=false]').waitFor();assert.equal(await amount('available'),'756250');
  assert.equal(await f.page.getByRole('button',{name:'Withdraw funds'}).isDisabled(),true);assert.equal((await f.registerCalls()).length,0);assert.deepEqual(f.errors,[]);
});

test('wallet proxy requires current owner, unchanged account/store, CSRF and fresh factor-bound proof for every read and write',async t=>{
  const f=await merchantFixture(t);await f.page.goto(f.app.base+'/cart/admin/?page=wallet');
  assert.equal((await f.request('read')).status,401);assert.equal(await f.count('commerce_wallet_enrollments'),0);
  await f.unlock();
  for(const headers of [{'X-Ezkart-Csrf':'wrong'},{'X-Ezkart-Wallet-Account':'bob'},{'X-Ezkart-Wallet-Store':'seller_bob'}])assert.equal((await f.request('read',undefined,headers)).status,401);
  for(const body of [{requestKey:key(),email:'bob@example.test'},{requestKey:key(),profileId:'SAC-foreign'},{requestKey:key(),actor:proof('bob')},'{"requestKey":"'+key()+'","requestKey":"'+key()+'"}'])assert.equal((await f.request('enroll',body)).status,422);
  assert.equal((await f.request('read',{})).status,405);assert.equal((await f.request('enroll')).status,405);assert.equal((await f.request('read&seller=seller_bob')).status,400);
  await f.db.prepare("UPDATE seller_memberships SET role='admin' WHERE auth_user_id='alice'").run();assert.equal((await f.request('read')).status,403);assert.equal((await f.request('enroll',{requestKey:key()})).status,403);
  await f.db.prepare("UPDATE seller_memberships SET role='owner' WHERE auth_user_id='alice'").run();
  const savedGrant=await f.session("echo base64_encode(json_encode($_SESSION['wallet_access']))");
  await f.session("$_SESSION['wallet_access']['expires_at']=time()-1");assert.equal((await f.request('read')).status,401);
  await f.session(`$_SESSION['wallet_access']=json_decode(base64_decode('${savedGrant}'),true)`);
  await f.setAuth({user:{id:'alice',email:'alice@example.test',factors:[{id:'11111111-1111-4111-8111-111111111111',factor_type:'totp',status:'verified'}]}});
  assert.equal((await f.request('enroll',{requestKey:key()})).status,401);assert.equal(await f.count('commerce_wallet_enrollments'),0);assert.equal((await f.registerCalls()).length,0);
  for(const path of ['/cart/admin/commerce-wallet.php','/tools/commerce/wallet-dispatch.php'])assert.equal((await fetch(f.app.base+path)).status,404);
});

test('expired or changed sessions suppress late replies while preserving an already committed wallet intent',async t=>{
  const f=await merchantFixture(t);await f.unlock();const savedGrant=await f.session("echo base64_encode(json_encode($_SESSION['wallet_access']))");
  let changed=false;f.control.afterResponse=async path=>{if(!changed&&path===base&&f.control.calls.at(-1)?.body?.action==='enroll'){changed=true;await f.session("$_SESSION['wallet_access']['expires_at']=time()-1");}};
  const result=await f.request('enroll',{requestKey:key()});assert.equal(result.status,401);assert.equal(result.data.code,'wallet_locked');assert.equal(result.data.enrollment,undefined);assert.equal(await f.count('commerce_wallet_enrollments'),1);assert.equal((await f.registerCalls()).length,0);
  f.control.afterResponse=null;await f.session(`$_SESSION['wallet_access']=json_decode(base64_decode('${savedGrant}'),true)`);assert.equal((await f.request('read')).data.enrollment.status,'queued');
  changed=false;f.control.afterResponse=async path=>{if(!changed&&path===base){changed=true;await f.session("$_SESSION['admin_user']=['id'=>'bob','email'=>'bob@example.test']; $_SESSION['csrf_token']='changed-session'");}};
  const late=await f.request('read');assert.equal(late.status,401);assert.equal(late.data.enrollment,undefined);assert.equal((await f.registerCalls()).length,0);
});

test('lost browser acknowledgements recover one saved intent across reloads and continue its original setup',async t=>{
  const f=await merchantFixture(t);await f.unlock();let drop=true;
  await f.page.route('**/cart/admin/?wallet=enroll',async route=>{const response=await route.fetch();if(drop){drop=false;await route.fulfill({status:503,json:{ok:false,error:'Connection interrupted'}});}else await route.fulfill({response});});
  await f.page.getByRole('button',{name:'Connect seller wallet',exact:true}).click();await f.page.locator('[data-wallet-setup][data-state=queued][aria-busy=false]').waitFor();
  assert.equal(await f.count('commerce_wallet_enrollments'),1);assert.equal((await f.registerCalls()).length,0);
  const saved=await f.page.evaluate(()=>sessionStorage.getItem('ezkart-wallet-request:alice:seller_alice:sandbox'));assert.match(saved,/^[a-f0-9]{32}$/);
  await f.page.reload();await f.page.locator('[data-wallet-setup][data-state=queued][aria-busy=false]').waitFor();assert.equal(await f.page.evaluate(()=>sessionStorage.getItem('ezkart-wallet-request:alice:seller_alice:sandbox')),saved);
  await f.page.getByRole('button',{name:'Continue setup',exact:true}).click();await f.page.locator('[data-wallet-setup][data-state=connected][aria-busy=false]').waitFor();
  assert.equal(await f.count('commerce_wallet_enrollments'),1);assert.equal((await f.registerCalls()).length,1);assert.deepEqual(f.errors,[]);
});

test('missing provider credentials and held central storage expose no connect action or provider call',async t=>{
  for(const overrides of [{EZKART_DOKU_SANDBOX_SNAP_PRIVATE_KEY:'missing-key'},{EZKART_COMMERCE_STORAGE:'legacy'}]){
    await t.test(Object.keys(overrides)[0],async child=>{const f=await merchantFixture(child,overrides);await f.unlock();assert.equal(await f.page.getByRole('button',{name:'Connect seller wallet',exact:true}).count(),0);
      assert.match(await f.page.locator('[data-wallet-setup-status]').innerText(),/not available yet/);const result=await f.request('enroll',{requestKey:key()});assert.equal(result.status,503);
      assert.equal(await f.count('commerce_wallet_enrollments'),0);assert.equal((await f.registerCalls()).length,0);assert.equal((await f.app.calls()).filter(c=>c.url.includes('doku.com')).length,0);
    });
  }
});

test('provider duplicate responses and mismatched registration parents cannot trigger alternate references',async t=>{
  const f=await fixture(t);
  for(const [id,control] of [['alice',{duplicate:true}],['bob',{wrongParent:true}]]){
    const e=await f.enroll(id);await f.setControl(control);await f.processWallet(e);
    const first=await f.registration(e.id),result=JSON.parse((await f.db.prepare('SELECT result_json FROM commerce_jobs WHERE id=?').bind(first.jobId).first()).result_json);
    assert.equal(result.recorded,false);assert.equal(result.noEffectConfirmed,undefined);
    assert.deepEqual(result.failure,{stage:'register_account',category:'provider',reason:control.duplicate?'http':'registration_response',httpStatus:control.duplicate?409:null});
    assert(!/fixture-snap-wallet-token|PRIVATE KEY|secret|alice@|bob@|SAC-|BRN-/i.test(JSON.stringify(result)));
    await f.setControl({});await f.due();await f.processWallet(e);
    const saved=await f.registration(e.id);assert.equal(saved.jobState,'uncertain');assert.equal(saved.profile,null);assert.equal(saved.registrationBody,null);
    const attempts=(await f.db.prepare('SELECT result_json FROM commerce_job_attempts WHERE job_id=? ORDER BY attempt').bind(saved.jobId).all()).results;
    assert.deepEqual(JSON.parse(attempts[0].result_json),result);assert.deepEqual(JSON.parse(attempts[1].result_json).failure,{stage:'registration_recovery',category:'internal'});
  }
  assert.equal((await f.registerCalls()).length,2);assert.equal(await f.count('commerce_wallet_provider_accounts'),0);
});

test('bounded wallet CLI processes only wallet jobs and reports uncertainty without exposing owner or provider secrets',async t=>{
  const f=await fixture(t);await f.enroll();await f.enroll('bob');const order=await f.create(f.input());assert.equal(order.status,200);
  const command=`$argv=['wallet-dispatch.php','--once']; require ${JSON.stringify(join(root,'tools/commerce/wallet-dispatch.php'))};`;
  const run=await f.run(command);assert.equal(run.status,0,run.error+run.output);assert.deepEqual(JSON.parse(run.output),{environment:'sandbox',processed:2,succeeded:2,uncertain:0,dead:0});assert.equal((await f.registerCalls()).length,2);
  assert.equal((await f.db.prepare("SELECT state FROM commerce_jobs WHERE kind='payment.create'").first()).state,'queued');
  const again=await f.run(command);assert.equal(again.status,0,again.error);assert.equal(JSON.parse(again.output).processed,0);
  assert(!/alice|bob|SAC-|fixture-snap-wallet-token|PRIVATE KEY|secret/i.test(run.output+run.error));
});
