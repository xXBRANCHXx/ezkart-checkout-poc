import test from 'node:test';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {generateKeyPairSync,createHash,createHmac,verify,randomBytes} from 'node:crypto';
import {writeFile,mkdir} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {setupCentralFixture} from './central-fixture.mjs';

const root=resolve(import.meta.dirname,'../..'),base='/internal/commerce/finance/wallet',screens='/tmp/ezkart-wallet-enrollment-ui-01a0d643';
const rsa=generateKeyPairSync('rsa',{modulusLength:2048}),privateKey=rsa.privateKey.export({format:'pem',type:'pkcs8'});
const key=()=>randomBytes(16).toString('hex');
const proof=(id='alice')=>({id,email:id+'@example.test',proofExpiresAt:new Date(Date.now()+590000).toISOString()});
async function fixture(t,overrides={}){
  const f=await setupCentralFixture(t,{EZKART_TEST_WALLET:'1',EZKART_DOKU_SANDBOX_SNAP_PRIVATE_KEY:privateKey,EZKART_DOKU_SANDBOX_PARENT_PROFILE_ID:'BRN-fixture',...overrides});
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
  assert.equal(f.control.calls.filter(c=>c.path.endsWith('/receipt')).length,2);
  await f.setControl({});await f.due();await f.processWallet(e);saved=await f.registration(e.id);assert(saved.profile);assert.equal(saved.jobState,'succeeded');assert.equal((await f.registerCalls()).length,1);
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
  await f.setControl({wrongConfirmation:true});await f.due();await f.processWallet(a);assert.equal((await f.registration(a.id)).profile,null);assert((await f.registration(a.id)).registrationBody);
  await f.setControl({});await f.due();await f.processWallet(a,{EZKART_DOKU_SANDBOX_SECRET_KEY:'different-fixture-secret-key'});assert.equal((await f.registration(a.id)).profile,null);assert.equal((await f.registerCalls()).length,1);
  await f.due();await f.processWallet(a);assert((await f.registration(a.id)).profile);
  const b=await f.enroll('bob');await f.db.prepare("UPDATE seller_memberships SET role='viewer' WHERE auth_user_id='bob'").run();await f.processWallet(b);
  assert.equal((await f.registration(b.id)).jobState,'dead');assert.equal((await f.registration(b.id)).binding,null);assert.equal((await f.registerCalls()).length,1);
});

async function merchantFixture(t,overrides={}){
  const f=await fixture(t,overrides),token=await f.merchantToken('alice','alice@example.test'),auth={user:{id:'alice',email:'alice@example.test'},wallet_tokens:{access_token:token,refresh_token:'fixture-refresh',expires_in:3600}};
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

test('merchant Wallet verifies owner identity, connects through the real proxy, and survives desktop/mobile reloads without inventing earnings',async t=>{
  const f=await merchantFixture(t);await mkdir(join(f.app.directory,'orders'),{recursive:true});await writeFile(join(f.app.directory,'orders','legacy-wallet.json'),JSON.stringify({order_id:'EZK-S-LEGACYWALLETSENTINEL',seller_id:'seller_alice',status:'PAID',subtotal:999999}));await f.unlock();assert.equal((await f.registerCalls()).length,0);
  assert(!(await f.page.content()).includes('LEGACYWALLETSENTINEL'));assert.equal(await f.page.locator('.wallet-payment-summary').count(),0);
  await f.db.prepare("UPDATE sellers SET name='Tea <img src=x onerror=alert(1)>' WHERE id='seller_alice'").run();await f.page.locator('[data-wallet-setup-refresh]').click();await f.page.locator('[data-wallet-setup][aria-busy=false]').waitFor();
  assert.match(await f.page.locator('[data-wallet-setup-name]').innerText(),/<img/);assert.equal(await f.page.locator('[data-wallet-setup] img').count(),0);
  await mkdir(screens,{recursive:true});await f.page.screenshot({path:join(screens,'wallet-ready-1360.png'),fullPage:true});
  await f.page.getByRole('button',{name:'Connect seller wallet',exact:true}).click();await f.page.locator('[data-wallet-setup][data-state=connected][aria-busy=false]').waitFor();
  assert.equal(await f.page.locator('.wallet-amount').innerText(),'—');assert.equal(await f.page.getByRole('button',{name:'Withdraw funds'}).isDisabled(),true);assert.match(await f.page.locator('[data-wallet-setup-account]').innerText(),/^Ending in [0-9]{4}$/);
  assert.equal((await f.registerCalls()).length,1);assert.equal(await f.count('commerce_wallet_enrollments'),1);assert.equal(await f.count('commerce_financial_journals'),0);
  for(const width of [1360,390]){await f.page.setViewportSize({width,height:1000});await f.page.reload();await f.page.locator('[data-wallet-setup][data-state=connected][aria-busy=false]').waitFor();assert.equal(await f.page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);await f.page.screenshot({path:join(screens,`wallet-connected-${width}.png`),fullPage:true});}
  assert.equal((await f.registerCalls()).length,1);assert.deepEqual(f.errors,[]);
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
    const e=await f.enroll(id);await f.setControl(control);await f.processWallet(e);await f.setControl({});await f.due();await f.processWallet(e);
    const saved=await f.registration(e.id);assert.equal(saved.jobState,'uncertain');assert.equal(saved.profile,null);assert.equal(saved.registrationBody,null);
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
