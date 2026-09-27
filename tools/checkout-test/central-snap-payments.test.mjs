import test from 'node:test';
import assert from 'node:assert/strict';
import {generateKeyPairSync,createHash,createHmac,randomBytes,verify} from 'node:crypto';
import {spawn} from 'node:child_process';
import {readFile,writeFile,access,mkdir} from 'node:fs/promises';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {setupCentralFixture} from './central-fixture.mjs';

const php=process.env.PHP_BINARY||'php',keys=generateKeyPairSync('rsa',{modulusLength:2048,publicKeyEncoding:{type:'spki',format:'pem'},privateKeyEncoding:{type:'pkcs8',format:'pem'}});
const target='/cart/api/doku-snap-webhook.php',account='1900800000347140';
const iso=()=>new Date().toISOString().replace(/\.\d{3}Z$/,'Z');
async function fixture(t,{beta=false,...overrides}={}){
  const environment=beta?'production':'sandbox';
  const f=await setupCentralFixture(t,{EZKART_TEST_SNAP:'1',EZKART_DOKU_SANDBOX_PAYMENT_FLOW:'snap_bca',EZKART_DOKU_PRODUCTION_PAYMENT_FLOW:'snap_bca',
    EZKART_DOKU_SANDBOX_SNAP_PRIVATE_KEY:keys.privateKey,EZKART_DOKU_PRODUCTION_SNAP_PRIVATE_KEY:keys.privateKey,
    EZKART_DOKU_SANDBOX_SNAP_BCA_PARTNER_SERVICE_ID:'19008',EZKART_DOKU_PRODUCTION_SNAP_BCA_PARTNER_SERVICE_ID:'19008',
    EZKART_DOKU_SANDBOX_SNAP_BCA_CUSTOMER_PREFIX:'0',EZKART_DOKU_PRODUCTION_SNAP_BCA_CUSTOMER_PREFIX:'0',
    ...(beta?{EZKART_DEPLOYMENT_ENVIRONMENT:'beta',EZKART_COMMERCE_ENVIRONMENT:'production',EZKART_CLOUDFLARE_API_URL:'https://ezkart-api-beta.fixture.workers.dev'}:{}),...overrides},
    beta?{bindings:{APP_ENVIRONMENT:'beta'}}:{});
  const create=async()=>{const r=await f.create(f.input({checkout:{intentHash:'f'.repeat(64),paymentFlow:'snap_bca',shop:'alice-shop'}}));assert.equal(r.status,200,r.error);return r.order;};
  return {...f,environment,create,read:async order=>(await f.call('/internal/commerce/snap-payments/'+order.id+'?environment='+environment)).payment,
    providerCreates:async()=>(await f.app.calls()).filter(c=>c.url.includes('/transfer-va/create-va'))};
}
function cli(f,file,args){
  const child=spawn(php,['-n','-d','auto_prepend_file='+fileURLToPath(new URL('./provider-fixture.php',import.meta.url)),fileURLToPath(new URL('../commerce/'+file,import.meta.url)),...args],{env:f.app.env});
  let stdout='',stderr='';child.stdout.on('data',c=>stdout+=c);child.stderr.on('data',c=>stderr+=c);
  return new Promise((resolve,reject)=>{child.on('error',reject);child.on('exit',code=>resolve({code,stdout,stderr}));});
}
const dispatch=f=>cli(f,'payment-dispatch.php',['--once']);
function notice(order){return {partnerServiceId:'   19008',customerNo:account.slice(5),virtualAccountNo:'   '+account,
  virtualAccountName:order.customer.name,virtualAccountEmail:order.customer.email,trxId:order.id,paidAmount:{value:order.total+'.00',currency:'IDR'},
  paymentRequestId:'PJP-one',trxDateTime:iso(),additionalInfo:{channel:'VIRTUAL_ACCOUNT_BCA'}};}
async function notify(f,order,{data=notice(order),invalid=false,externalId='123456789',timestamp=iso(),suffix='',headers:overrides={}}={}){
  const raw=typeof data==='string'?data:JSON.stringify(data),client=f.environment==='sandbox'?'MCH-SANDBOX-TEST':'MCH-PRODUCTION-TEST',secret=f.environment==='sandbox'?'fixture-doku-sandbox-secret':'fixture-doku-production-secret';
  const token='fixture-notification-token',canonical=['POST',target,token,createHash('sha256').update(raw).digest('hex'),timestamp].join(':');
  const headers={Authorization:'Bearer '+token,'X-PARTNER-ID':client,'X-EXTERNAL-ID':externalId,'X-TIMESTAMP':timestamp,'CHANNEL-ID':'H2H',
    'X-SIGNATURE':createHmac('sha512',invalid?'wrong':secret).update(canonical).digest('base64'),...overrides};
  return f.app.request(target+suffix,raw,headers);
}
async function waitFile(file){for(let n=0;n<200;n++){try{await access(file);return;}catch{}await new Promise(r=>setTimeout(r,25));}throw Error('Fixture provider barrier not reached');}
const header=(call,name)=>call.headers.find(h=>h.startsWith(name+': '))?.slice(name.length+2);

test('beta dispatcher signs production SNAP, saves one original request and renders payment instructions without private evidence',async t=>{
  const f=await fixture(t,{beta:true}),order=await f.create(),done=await dispatch(f);assert.equal(done.code,0,done.stderr+done.stdout);
  const payment=await f.read(order);assert.equal(payment.order.state,'pending');assert.equal(payment.order.payment.accountNumber,account);assert.equal(payment.order.payment.flow,'snap_bca');
  const creates=await f.providerCreates();assert.equal(creates.length,1);const request=creates[0];assert.equal(new URL(request.url).origin,'https://api.doku.com');assert.equal(header(request,'X-EXTERNAL-ID'),order.paymentRequestId);
  const token=(await f.app.calls()).find(c=>c.url.includes('/access-token/'));assert(verify('RSA-SHA256',Buffer.from('MCH-PRODUCTION-TEST|'+header(token,'X-TIMESTAMP')),keys.publicKey,Buffer.from(header(token,'X-SIGNATURE'),'base64')));
  const canonical=['POST',new URL(request.url).pathname,'fixture-snap-payment-token',createHash('sha256').update(request.body).digest('hex'),header(request,'X-TIMESTAMP')].join(':');
  assert.equal(header(request,'X-SIGNATURE'),createHmac('sha512','fixture-doku-production-secret').update(canonical).digest('base64'));
  assert.equal(JSON.parse(request.body).trxId,order.id);assert.equal(JSON.parse(request.body).totalAmount.value,order.total+'.00');
  const receipt=await f.db.prepare('SELECT body_json,request_json FROM commerce_snap_payment_receipts').first();assert.equal(receipt.request_json,request.body);
  const publicStatus=await f.app.request('/cart/api/status.php?order='+order.id);assert.equal(publicStatus.status,200);assert.equal(publicStatus.data.environment,'production');assert.equal(publicStatus.data.payment_details.account_number,account);
  for(const privateText of ['credentialFingerprint','PRIVATE KEY','fixture-snap-payment-token','fixture-doku-production-secret','body_json','providerRequestId'])assert(!JSON.stringify(publicStatus.data).includes(privateText));
  const {chromium}=await import('../builder-mcp/node_modules/playwright/index.mjs'),browser=await chromium.launch({headless:true});t.after(()=>browser.close());
  const screenshots='/tmp/ezkart-snap-payment-ui-01a0d643';await mkdir(screenshots,{recursive:true});
  for(const width of [1360,390]){
    const page=await browser.newPage({viewport:{width,height:900}});await page.goto(f.app.base+'/cart/payment.php?order='+order.id);
    await page.waitForFunction(()=>document.querySelector('#account-number')?.value.replaceAll(' ','')==='1900800000347140');
    assert.equal(await page.locator('#sandbox-badge').isVisible(),false);assert.equal(await page.locator('#transfer-details').isVisible(),true);
    assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);await page.screenshot({path:join(screenshots,'snap-beta-'+width+'.png')});await page.close();
  }
  const accepted=await notify(f,order);assert.equal(accepted.status,200,JSON.stringify(accepted.data));assert.equal(accepted.data.responseCode,'2002500');assert.equal((await f.read(order)).order.state,'paid');assert.equal(await f.stock(),8);
  assert.equal((await dispatch(f)).code,0);assert.equal((await f.providerCreates()).length,1);
});

test('lost receipt acknowledgement retries only internal storage and never creates a second provider account',async t=>{
  const f=await fixture(t),order=await f.create();f.control.drop='/internal/commerce/snap-payments/'+order.id+'/receipt';
  const done=await dispatch(f);assert.equal(done.code,0,done.stderr+done.stdout);assert.equal((await f.providerCreates()).length,1);
  assert.equal((await f.read(order)).order.state,'pending');assert.equal(await f.count('commerce_snap_payment_receipts'),1);
  assert.equal(f.control.calls.filter(c=>c.path.endsWith('/receipt')).length,2);
});

test('lost dispatch acknowledgement and lost provider response remain uncertain without a second create',async t=>{
  for(const kind of ['bind','provider'])await t.test(kind,async t=>{
    const f=await fixture(t),order=await f.create();
    if(kind==='bind')f.control.drop='/internal/commerce/snap-payments/'+order.id+'/bind';
    else await writeFile(join(f.app.directory,'snap-control.json'),JSON.stringify({loseCreate:true}));
    const done=await dispatch(f);assert.equal(done.code,2,done.stderr+done.stdout);assert.equal((await f.read(order)).order.paymentJobState,'uncertain');
    assert.equal((await f.providerCreates()).length,kind==='bind'?0:1);
    await f.db.prepare("UPDATE commerce_jobs SET available_at='2000-01-01T00:00:00.000Z' WHERE order_id=? AND kind='payment.create'").bind(order.id).run();
    const again=await dispatch(f);assert.equal(again.code,2);assert.equal((await f.providerCreates()).length,kind==='bind'?0:1);
    if(kind==='provider'){assert.equal((await notify(f,order)).status,200);assert.equal((await f.read(order)).order.state,'paid');}
  });
});

test('authentication failure before dispatch has a proven no-effect retry and can recover',async t=>{
  const f=await fixture(t),order=await f.create();await writeFile(join(f.app.directory,'snap-control.json'),JSON.stringify({tokenDenied:true}));
  const denied=await dispatch(f);assert.equal(denied.code,0,denied.stderr);assert.equal((await f.read(order)).binding,null);assert.equal((await f.read(order)).order.paymentJobState,'retry');assert.equal((await f.providerCreates()).length,0);
  await writeFile(join(f.app.directory,'snap-control.json'),'{}');await f.db.prepare("UPDATE commerce_jobs SET available_at='2000-01-01T00:00:00.000Z' WHERE order_id=?").bind(order.id).run();
  assert.equal((await dispatch(f)).code,0);assert.equal((await f.read(order)).order.state,'pending');assert.equal((await f.providerCreates()).length,1);
});

test('signed early callback can commit while the provider creation reply is still in flight',async t=>{
  const f=await fixture(t),order=await f.create();await writeFile(join(f.app.directory,'provider-barrier.json'),JSON.stringify({match:'/transfer-va/create-va'}));
  const creating=dispatch(f);t.after(()=>writeFile(join(f.app.directory,'provider-release'),'ready').catch(()=>{}));
  await waitFile(join(f.app.directory,'provider-entered'));assert((await f.read(order)).binding);
  const accepted=await notify(f,order);assert.equal(accepted.status,200,JSON.stringify(accepted.data));assert.equal((await f.read(order)).order.state,'paid');
  await writeFile(join(f.app.directory,'provider-release'),'ready');const done=await creating;assert.equal(done.code,0,done.stderr);
  const final=await f.read(order);assert.equal(final.order.state,'paid');assert.equal(final.order.payment.accountNumber,account);assert.equal(await f.count('commerce_payment_captures'),1);assert.equal(await f.count('commerce_snap_payment_receipts'),2);assert.equal(await f.stock(),8);
});

test('HTTP callbacks reject unsigned or mismatched evidence, wait for durable storage and replay one financial capture',async t=>{
  const f=await fixture(t),order=await f.create();assert.equal((await dispatch(f)).code,0);
  const beforeCalls=f.control.calls.length;assert.equal((await notify(f,order,{invalid:true})).status,400);assert.equal(f.control.calls.length,beforeCalls);
  assert.equal((await notify(f,order,{suffix:'?bypass=1'})).status,400);
  for(const data of [{...notice(order),paidAmount:{value:'1.00',currency:'IDR'}},{...notice(order),virtualAccountNo:'   1900800000347141'}])assert.equal((await notify(f,order,{data})).status,400);
  assert.equal(await f.count('commerce_payment_captures'),0);assert.equal(await f.stock(),10);
  f.control.fail='/internal/commerce/snap-payments/'+order.id+'/receipt';const failed=await notify(f,order);assert.equal(failed.status,503);assert.notEqual(failed.data.responseCode,'2002500');assert.equal(await f.count('commerce_payment_captures'),0);
  f.control.fail='';const data=notice(order);assert.equal((await notify(f,order,{data})).data.responseCode,'2002500');const count=await f.count('commerce_financial_journals');
  assert.equal((await notify(f,order,{data,externalId:'987654321'})).status,200);assert.equal(await f.count('commerce_payment_captures'),1);assert.equal(await f.count('commerce_financial_journals'),count);assert.equal(await f.stock(),8);
  const rows=(await f.db.prepare('SELECT body_json,request_json FROM commerce_snap_payment_receipts').all()).results;
  for(const forbidden of ['fixture-notification-token','fixture-snap-payment-token','PRIVATE KEY','x-signature','authorization'])assert(!JSON.stringify(rows).includes(forbidden));
});

test('ordinary signed-in checkout chooses SNAP explicitly and resumes its original order',async t=>{
  const f=await fixture(t),cookie=f.app.customerCookie(),input={checkout_key:randomBytes(16).toString('hex'),cart:{tea:2},expected_prices:{tea:20000},expected_total:40000,shop:'alice-shop',shipping_id:'',
    customer:{fullName:'Checkout Tester',email:'checkout@example.com',phone:'081234567890',location:'Jakarta Selatan',address:'Jalan Test Nomor 12',postalCode:'12345',note:'',coordinate:{latitude:-6.2,longitude:106.8}}};
  const headers={Cookie:cookie.name+'='+cookie.value};const first=await f.app.request('/cart/api/start.php',input,headers);assert.equal(first.status,201,JSON.stringify(first.data));assert.equal(first.data.payment_flow,'snap_bca');assert.equal(first.data.status,'PENDING');
  const again=await f.app.request('/cart/api/start.php',input,headers);assert.equal(again.data.order_id,first.data.order_id);assert.equal((await f.providerCreates()).length,1);assert.equal(await f.count('orders'),1);
});

test('the beta operator status command waits sixty seconds, stores read evidence and cannot create or capture a payment',async t=>{
  const f=await fixture(t,{beta:true}),order=await f.create();assert.equal((await dispatch(f)).code,0);
  const args=['--order='+order.id];const early=await cli(f,'observe-snap-payment.php',args);assert.equal(early.code,1);assert.match(early.stderr,/sixty seconds/);assert.equal(early.stdout,'');
  assert.equal((await f.app.calls()).filter(c=>c.url.includes('/transfer-va/status')).length,0);
  assert.equal((await fetch(f.app.base+'/tools/commerce/observe-snap-payment.php')).status,404);
  const boundAt=Date.parse((await f.read(order)).boundAt);await new Promise(resolve=>setTimeout(resolve,Math.max(0,boundAt+61000-Date.now())));
  const observed=await cli(f,'observe-snap-payment.php',args);assert.equal(observed.code,0,observed.stderr);assert.equal(observed.stderr,'');
  const result=JSON.parse(observed.stdout);assert.equal(result.environment,'production');assert.equal(result.recorded,true);assert.equal(result.records,0);
  for(const flag of ['paymentConfirmed','settlementVerified','createRetryAllowed'])assert.equal(result[flag],false);
  assert.equal((await f.providerCreates()).length,1);assert.equal(await f.count('commerce_payment_captures'),0);assert.equal((await f.read(order)).order.state,'pending');
  const receipt=await f.db.prepare("SELECT body_json FROM commerce_snap_payment_receipts WHERE operation='bca-status'").first();assert.deepEqual(JSON.parse(receipt.body_json),{responseCode:'2002600',virtualAccountData:[]});
});
