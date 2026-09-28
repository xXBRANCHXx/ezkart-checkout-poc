import test from 'node:test';
import assert from 'node:assert/strict';
import {generateKeyPairSync,createHash,createHmac,randomBytes} from 'node:crypto';
import {spawn} from 'node:child_process';
import {writeFile,mkdtemp,readFile} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {fileURLToPath} from 'node:url';
import {setupCentralFixture} from './central-fixture.mjs';
import {seedRoutingWallets} from '../../cloudflare/ezkart-api/test/payment-routing-fixture.mjs';
const keys=generateKeyPairSync('rsa',{modulusLength:2048,publicKeyEncoding:{type:'spki',format:'pem'},privateKeyEncoding:{type:'pkcs8',format:'pem'}}),hash=v=>createHash('sha256').update(v).digest('hex');
const stamp=()=>new Date().toISOString().replace(/\.\d{3}Z$/,'Z'),target='/cart/api/doku-hosted-webhook.php';
async function fixture(t){
 const recovery=await mkdtemp(join(tmpdir(),'ezkart-checkout-recovery-'));
 t.after(async()=>{const {rm}=await import('node:fs/promises');await rm(recovery,{recursive:true,force:true});});
 const f=await setupCentralFixture(t,{EZKART_COMMERCE_PAYMENT_RECOVERY_DIRECTORY:recovery,EZKART_TEST_SNAP:'1',EZKART_DOKU_SANDBOX_SNAP_BCA_PARTNER_SERVICE_ID:'19008',EZKART_DOKU_SANDBOX_SNAP_BCA_CUSTOMER_PREFIX:'0',EZKART_DOKU_SANDBOX_PAYMENT_FLOW:'routed_hosted',EZKART_DOKU_SANDBOX_CHECKOUT_METHODS:'QRIS,CREDIT_CARD,VIRTUAL_ACCOUNT_BCA',EZKART_DOKU_SANDBOX_SNAP_PRIVATE_KEY:keys.privateKey},{bindings:{COMMERCE_PLATFORM_WALLET_SELLER:'seller_bob'}});
 await seedRoutingWallets(f,{environment:'sandbox',clientId:'MCH-SANDBOX-TEST',fingerprint:hash(JSON.stringify(['sandbox','MCH-SANDBOX-TEST',hash('fixture-doku-sandbox-secret'),hash(keys.publicKey)]))});
 f.recovery=recovery;
 f.createHosted=async()=>{const r=await f.create(f.input({checkout:{intentHash:'a'.repeat(64),paymentFlow:'routed_hosted',shop:'alice-shop'}}));assert.equal(r.status,200,JSON.stringify(r));return r.order;};
 f.payment=async id=>(await f.call('/internal/commerce/hosted-payments/'+id+'?environment=sandbox')).payment;
 f.creates=async()=>(await f.app.calls()).filter(c=>c.url.endsWith('/checkout/v1/payment'));
 return f;
}
function dispatch(f){const p=spawn(process.env.PHP_BINARY||'php',['-n','-d','auto_prepend_file='+fileURLToPath(new URL('./provider-fixture.php',import.meta.url)),fileURLToPath(new URL('../commerce/payment-dispatch.php',import.meta.url)),'--once'],{env:f.app.env});let stdout='',stderr='';p.stdout.on('data',c=>stdout+=c);p.stderr.on('data',c=>stderr+=c);return new Promise((resolve,reject)=>{p.on('error',reject);p.on('exit',code=>resolve({code,stdout,stderr}));});}
function notice(order,method='QRIS'){return {service:{id:method},acquirer:{id:method==='QRIS'?'DOKU':'BANK_CIMB'},channel:{id:method==='QRIS'?'QRIS_DOKU':method},order:{invoice_number:order.id,amount:order.total},
 transaction:{status:'SUCCESS',date:stamp(),...(method==='CREDIT_CARD'?{type:'SALE',original_request_id:'channel-sale-original'}:{})},
 ...(method==='QRIS'?{emoney_payment:{account_id:'documented-acquirer-account',approval_code:'approval-one'}}:{card_payment:{masked_card_number:'539371******3085',approval_code:'approval-one',response_code:'00'}})};}
async function notify(f,data,{invalid=false,id='notice-delivery-1',suffix=''}={}){const raw=typeof data==='string'?data:JSON.stringify(data),ts=stamp(),canonical='Client-Id:MCH-SANDBOX-TEST\nRequest-Id:'+id+'\nRequest-Timestamp:'+ts+'\nRequest-Target:'+target+'\nDigest:'+createHash('sha256').update(raw).digest('base64');return f.app.request(target+suffix,raw,{'Client-Id':'MCH-SANDBOX-TEST','Request-Id':id,'Request-Timestamp':ts,Signature:'HMACSHA256='+createHmac('sha256',invalid?'wrong':'fixture-doku-sandbox-secret').update(canonical).digest('base64')});}
test('routed Checkout sends one original split/session, keeps private evidence and records scoped QRIS success exactly once',async t=>{
 const f=await fixture(t),order=await f.createHosted(),done=await dispatch(f);assert.equal(done.code,0,done.stderr+done.stdout);
 const p=await f.payment(order.id);assert.equal(p.order.state,'pending');assert.equal(p.order.payment.flow,'routed_hosted');
 const calls=await f.creates();assert.equal(calls.length,1);const request=JSON.parse(calls[0].body);
 assert.deepEqual(request.additionalInfo.account,p.binding.routing.profileId?{id:p.binding.routing.profileId,split_rule_id:p.binding.routing.splitRuleId}:null);
 assert.deepEqual(request.payment.payment_method_types,['CREDIT_CARD','QRIS']);assert.equal(request.order.auto_redirect,false);
 assert.equal(request.order.invoice_number,order.id);assert.equal(request.additional_info.override_notification_url,'https://test.ezkart.id'+target);
 const publicRead=await f.app.request('/cart/api/status.php?order='+order.id);assert.equal(publicRead.data.payment_flow,'routed_hosted');
 for(const secret of ['credentialFingerprint','fixture-doku-sandbox-secret','body_json','split_rule_id'])assert(!JSON.stringify(publicRead.data).includes(secret));
 const n=notice(order);assert.equal((await notify(f,{...n,transaction:{...n.transaction,date:'2020-01-01T00:00:00Z'}},{id:'pre-binding'})).status,503);assert.equal((await notify(f,n,{invalid:true})).status,400);assert.equal((await notify(f,n,{suffix:'?bad=1'})).status,400);
 assert.equal((await notify(f,n)).status,200);assert.equal((await f.payment(order.id)).order.state,'paid');assert.equal(await f.stock(),8);
 assert.equal((await notify(f,n,{id:'different-delivery'})).status,200);assert.equal(await f.count('commerce_payment_captures'),1);assert.equal(await f.count('commerce_hosted_payment_receipts'),3);
 n.emoney_payment.approval_code='different-approved-payment';assert.equal((await notify(f,n,{id:'extra-payment'})).status,200);
 assert.equal(await f.count('commerce_payment_captures'),2);assert.equal(await f.stock(),8);assert.equal((await f.payment(order.id)).order.paymentReview,true);
 assert.equal((await dispatch(f)).code,0);assert.equal((await f.creates()).length,1);
});
test('card SALE callback before the create reply is atomic, raw cards/auth/refund rejected, and failed storage retries original receipt only',async t=>{
 const f=await fixture(t),order=await f.createHosted();f.control.fail='/internal/commerce/hosted-payments/'+order.id+'/receipt';
 const sent=await dispatch(f);assert.equal(sent.code,2,sent.stdout+sent.stderr);assert.equal((await f.creates()).length,1);assert.equal((await f.payment(order.id)).order.state,'creating');
 const n=notice(order,'CREDIT_CARD');assert.equal((await notify(f,n)).status,503);assert.equal(await f.count('commerce_payment_captures'),0);
 f.control.fail='';assert.equal((await notify(f,{...n,transaction:{...n.transaction,type:'AUTHORIZE'}})).status,503);
 assert.equal((await notify(f,{...n,card_payment:{...n.card_payment,card_number:'4111111111111111'}})).status,400);
 assert.equal((await notify(f,{...n,order:{...n.order,amount:1}})).status,503);
 await f.db.exec("CREATE TRIGGER fixture_capture_failure BEFORE INSERT ON commerce_financial_entries BEGIN SELECT RAISE(ABORT,'fixture_failure'); END;");
 assert.equal((await notify(f,n)).status,503);assert.equal(await f.count('commerce_payment_captures'),0);assert.equal(await f.count('commerce_hosted_payment_receipts'),0);
 await f.db.exec('DROP TRIGGER fixture_capture_failure');assert.equal((await notify(f,n)).status,200);assert.equal((await f.payment(order.id)).order.state,'paid');
 const replay=await dispatch(f);assert.equal(replay.code,0,replay.stdout+replay.stderr);assert.equal((await f.creates()).length,1);
});
test('lost create or bind acknowledgement stays original and cannot send Checkout twice',async t=>{
 for(const lost of ['bind','provider','receipt'])await t.test(lost,async t=>{
  const f=await fixture(t),order=await f.createHosted();
  if(lost==='bind')f.control.drop='/internal/commerce/hosted-payments/'+order.id+'/bind';
  if(lost==='provider')await writeFile(join(f.app.directory,'hosted-control.json'),JSON.stringify({loseCreate:true}));
  if(lost==='receipt')f.control.drop='/internal/commerce/hosted-payments/'+order.id+'/receipt';
  const done=await dispatch(f);assert.equal(done.code,lost==='receipt'?0:2,done.stdout+done.stderr);
  assert.equal((await f.creates()).length,lost==='bind'?0:1);await dispatch(f);assert.equal((await f.creates()).length,lost==='bind'?0:1);
 });
});

test('PHP mixed checkout freezes typed native BCA or hosted choice and rejects a changed choice on the original key',async t=>{
 const f=await fixture(t),cookie=f.app.customerCookie(),headers={Cookie:cookie.name+'='+cookie.value};
 const config=await f.app.request('/cart/api/checkout-config.php');assert.equal(config.status,200);assert.deepEqual(config.data.payment_choices,['bca_va','doku_checkout']);assert.deepEqual(config.data.hosted_payment_methods,['CREDIT_CARD','QRIS']);
 const body={checkout_key:randomBytes(16).toString('hex'),cart:{tea:2},expected_prices:{tea:20000},expected_total:40000,shop:'alice-shop',shipping_id:'',payment_choice:'bca_va',
 customer:{fullName:'Checkout Tester',email:'checkout@example.com',phone:'081234567890',location:'Jakarta Selatan',address:'Jalan Test Nomor 12',postalCode:'12345',note:'',coordinate:{latitude:-6.2,longitude:106.8}}};
 const native=await f.app.request('/cart/api/start.php',body,headers);assert.equal(native.status,201,JSON.stringify(native)+f.app.logs());assert.equal(native.data.payment_flow,'snap_bca');assert.equal(native.data.status,'PENDING');
 const original=await f.record(native.data.order_id);assert.equal(original.snapshot.checkout.paymentChoice,'bca_va');assert(original.payment.accountNumber);
 assert.equal((await f.app.request('/cart/api/start.php',{...body,payment_choice:'doku_checkout'},headers)).status,409);
 assert.equal((await f.app.request('/cart/api/start.php',body,headers)).data.order_id,native.data.order_id);
 const hostedBody={...body,checkout_key:randomBytes(16).toString('hex'),payment_choice:'doku_checkout'};const hosted=await f.app.request('/cart/api/start.php',hostedBody,headers);
 assert.equal(hosted.status,201,JSON.stringify(hosted));assert.equal(hosted.data.payment_flow,'routed_hosted');assert.equal(hosted.data.status,'PENDING');assert.equal((await f.record(hosted.data.order_id)).snapshot.checkout.paymentChoice,'doku_checkout');
 assert.equal((await f.app.request('/cart/api/start.php',hostedBody,headers)).data.order_id,hosted.data.order_id);assert.equal((await f.creates()).length,1);assert.equal(await f.count('orders'),2);
 assert.equal((await f.app.request('/cart/api/start.php',{...body,checkout_key:randomBytes(16).toString('hex'),payment_choice:'hosted'},headers)).status,422);
});

test('private original create receipt recovers after storage failure with no provider call and rejects substitution',async t=>{
 const f=await fixture(t),order=await f.createHosted();f.control.fail='/internal/commerce/hosted-payments/'+order.id+'/receipt';
 assert.equal((await dispatch(f)).code,2);assert.equal((await f.creates()).length,1);const file=join(f.recovery,order.id+'-checkout.json'),saved=JSON.parse(await readFile(file,'utf8'));
 assert.equal(saved.binding.orderId,order.id);assert.equal((await f.payment(order.id)).order.state,'creating');f.control.fail='';
 const run=async(path=file)=>{const p=spawn(process.env.PHP_BINARY||'php',['-n','-d','auto_prepend_file='+fileURLToPath(new URL('./provider-fixture.php',import.meta.url)),fileURLToPath(new URL('../commerce/finalize-hosted-payment.php',import.meta.url)),'--receipt-file='+path],{env:{...f.app.env,EZKART_DOKU_SANDBOX_SECRET_KEY:'rotated-unavailable-secret'}});let out='',err='';p.stdout.on('data',c=>out+=c);p.stderr.on('data',c=>err+=c);return new Promise(resolve=>p.on('exit',code=>resolve({code,out,err})));};
 const providerCount=async()=>(await f.app.calls()).filter(c=>/^https:\/\/api(?:-sandbox)?\.doku\.com\//.test(c.url)).length;const calls=await providerCount(),done=await run();assert.equal(done.code,0,done.err);assert.equal(JSON.parse(done.out).providerCalls,0);assert.equal(await providerCount(),calls);assert.equal((await f.payment(order.id)).order.state,'pending');
 assert.equal((await run()).code,0);assert.equal(await f.count('commerce_payment_sessions'),1);
 const forged=join(f.recovery,'forged.json');await writeFile(forged,JSON.stringify({...saved,binding:{...saved.binding,amount:1}}),{mode:0o600});assert.equal((await run(forged)).code,1);assert.equal((await f.creates()).length,1);
 assert.equal((await fetch(f.app.base+'/tools/commerce/finalize-hosted-payment.php')).status,404);
});

test('hosted capture settles only matched original routed wallet history with actual fee evidence',async t=>{
 const {setupSettlementFixture}=await import('../../cloudflare/ezkart-api/test/settlement-fixture.mjs');
 const {prepareFixtureRoute}=await import('../../cloudflare/ezkart-api/test/payment-routing-fixture.mjs');
 const f=await setupSettlementFixture(t),made=await f.create(f.checkoutInput({checkout:{intentHash:'f'.repeat(64),paymentFlow:'routed_hosted',shop:'alice-shop'}}));assert.equal(made.status,200,made.error);const order=made.order;
 const workerId='hosted_settlement_fixture',job=(await f.call('/internal/commerce/jobs/claim',{environment:'sandbox',workerId,kinds:['payment.create'],orderId:order.id,limit:1,leaseSeconds:120})).jobs[0];
 await prepareFixtureRoute(f,order,job,{workerId});const path='/internal/commerce/hosted-payments/'+order.id;
 const bound=await f.call(path+'/bind',{environment:'sandbox',workerId,leaseToken:job.leaseToken,credentialFingerprint:'a'.repeat(64),clientId:'MCH-FIXTURE-SNAP',methods:['QRIS']});assert.equal(bound.status,200,bound.error);
 const paid=await f.call(path+'/receipt',{environment:'sandbox',credentialFingerprint:'a'.repeat(64),operation:'checkout-notification',externalId:'hosted-notice',sentAt:stamp(),observedAt:stamp(),requestBody:null,body:JSON.stringify(notice(order))});assert.equal(paid.status,200,paid.error);
 const payment=(await f.call(path+'?environment=sandbox')).payment,p={order:paid.order,route:payment.route},rows=f.legs(p,{fee:321});
 for(const list of Object.values(rows))for(const r of list)r.channel='QRIS';
 const missing=structuredClone(rows);missing.sellerPending=missing.sellerPending.filter(r=>r.transactionType!=='SETTLEMENT_FEE');
 const held=await f.reconcile(p,await f.collect(p,missing));assert.equal(held.status,200,held.error);assert.equal(held.settlementVerified,false);assert.equal((await f.journals()).items.length,1);
 const result=await f.reconcile(p,await f.collect(p,rows));assert.equal(result.status,200,result.error);assert.equal(result.settlementVerified,true);assert.equal(result.assessment.feeAmount,'321');assert.equal(result.earningsReleased,false);
 const balances=(await f.summary()).accounts;assert.equal(balances.provider_receivable,'0');assert.equal(balances.provider_cash_seller,String(order.total-321-p.route.binding.platformAmount));assert.equal(balances.provider_cash_platform,String(p.route.binding.platformAmount));
 const journals=(await f.journals()).items;assert.equal(journals.length,2);for(const j of journals)assert.equal(j.entries.reduce((sum,e)=>sum+BigInt(e.amount),0n),0n);
});
