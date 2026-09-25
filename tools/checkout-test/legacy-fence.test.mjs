import test from 'node:test';
import assert from 'node:assert/strict';
import {spawn,spawnSync} from 'node:child_process';
import {readFile,writeFile,stat,symlink,rm,rename,chmod} from 'node:fs/promises';
import {createHash,createHmac,randomBytes} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {resolve,join} from 'node:path';
import {setup} from './fixture.mjs';
import {buildLegacyPlan,sourceFromPlan,legacySourceDigest} from '../commerce/legacy-order-audit.mjs';

const root=resolve(fileURLToPath(new URL('../..',import.meta.url)));
const php=process.env.PHP_BINARY||'php',transport=join(root,'tools/checkout-test/provider-fixture.php'),controller=join(root,'tools/commerce/legacy-fence.php');
const key=()=>randomBytes(16).toString('hex');
const digest=value=>createHash('sha256').update(value).digest('hex');
const input={cart:{granola:1},shop:'ezkart-demo',shipping_id:'',customer:{fullName:'Fence Fixture',email:'checkout@example.com',phone:'081234567890',location:'Jakarta',address:'Jalan Fixture Nomor 12',postalCode:'12345',note:''}};
const registry={deployment:'test',environment:'sandbox',sellers:[],memberships:[],products:[],variants:[]};
const order=(n=1,extra={})=>({order_id:'EZK-S-'+String(n).padStart(24,'0'),commerce_environment:'sandbox',seller_id:'demo',shop:'ezkart-demo',
  status:'PENDING',subtotal:58000,shipping_price:0,total:58000,items:[{id:'EZK-DEMO-GRANOLA',name:'Demo granola',price:58000,quantity:1}],
  shipping_skipped:true,customer:{name:'Fence Fixture',email:'checkout@example.com',phone:'081234567890',address:'Jalan Fixture Nomor 12',location:'Jakarta',postalCode:'12345'},
  customer_auth_user_id:'',payment_provider:'doku',payment_request_id:'original-'+n,payment_flow:'hosted',payment_type:'',payment_reference:'',payment_url:'',payment_expires_at:'2026-09-25T04:00:00Z',paid_at:'',
  created_at:'2026-09-25T02:00:00Z',updated_at:'2026-09-25T02:00:01Z',...extra});
async function fixture(t) {
  const app=await setup();t.after(()=>app.close());
  app.orderDirectory=app.cli("echo ez_order_directory('sandbox');");
  app.seed=o=>app.cli(`ez_save_order(json_decode(base64_decode('${Buffer.from(JSON.stringify(o)).toString('base64')}'),true));`);
  app.read=o=>readFile(join(app.orderDirectory,digest(o.order_id)+'.json'),'utf8');
  return app;
}
function fence(app,kind,options={},environment={}) {
  const args=[controller,kind,...Object.entries(options).map(([k,v])=>'--'+k+'='+v)];
  const result=spawnSync(php,['-n','-d','auto_prepend_file='+transport,...args],{env:{...app.env,...environment},encoding:'utf8',timeout:35000});
  return {...result,data:result.status===0?JSON.parse(result.stdout):null};
}
function frozen(app,requestKey=key(),revision=0) {
  const result=fence(app,'freeze',{key:requestKey,revision});assert.equal(result.status,0,result.stderr);assert.equal(result.data.current.mode,'frozen');return result.data;
}
function resume(app,freeze,requestKey=key()) {
  const result=fence(app,'resume',{key:requestKey,revision:freeze.current.revision,epoch:freeze.receipt.epoch});assert.equal(result.status,0,result.stderr);return result.data;
}
async function until(check,label) {
  const deadline=Date.now()+7000;
  while(Date.now()<deadline){if(await check())return;await new Promise(r=>setTimeout(r,20));}
  throw Error('Timed out waiting for '+label);
}
const exists=path=>stat(path).then(()=>true,()=>false);
async function notify(app,o) {
  const target='/cart/api/doku-webhook.php',body=JSON.stringify({order:{invoice_number:o.order_id,amount:o.total},transaction:{status:'SUCCESS',original_request_id:o.payment_request_id},channel:{id:'VIRTUAL_ACCOUNT_BCA'}});
  const headers={'Client-Id':'MCH-SANDBOX-TEST','Request-Id':'callback-'+o.order_id,'Request-Timestamp':new Date().toISOString().replace(/\.\d{3}Z$/,'Z')};
  headers.Signature='HMACSHA256='+createHmac('sha256','fixture-doku-sandbox-secret').update(`Client-Id:${headers['Client-Id']}\nRequest-Id:${headers['Request-Id']}\nRequest-Timestamp:${headers['Request-Timestamp']}\nRequest-Target:${target}\nDigest:${createHash('sha256').update(body).digest('base64')}`).digest('base64');
  return fetch(app.base+target,{method:'POST',headers:{'content-type':'application/json',...headers},body});
}

test('freeze captures exact bytes, binds the audited source set and recovers old receipts without reopening a later freeze',async t=>{
  const app=await fixture(t),o=order();app.seed(o);const original=await app.read(o),k=key(),first=frozen(app,k);
  assert.equal(first.current.revision,2);assert.equal(first.receipt.snapshot.orders,1);
  const path=join(app.orderDirectory,first.receipt.snapshot.relativePath),source=JSON.parse(await readFile(path,'utf8'));
  assert.equal(source.entries[0].source,original);assert.equal(source.fence.sourceDigest,legacySourceDigest(source.entries));assert.equal((await stat(path)).mode&0o777,0o600);
  const plan=buildLegacyPlan(source,registry);assert.deepEqual(plan.manifest.fence,source.fence);assert.equal(buildLegacyPlan(sourceFromPlan(plan),registry).hash,plan.hash);
  const changed=structuredClone(source);changed.entries[0].source+=' ';assert.throws(()=>buildLegacyPlan(changed,registry),/Source fence/);
  const replay=fence(app,'freeze',{key:k,revision:0});assert.equal(replay.status,0);assert.deepEqual(replay.data.receipt,first.receipt);
  assert.notEqual(fence(app,'freeze',{key:k,revision:1}).status,0);
  assert.notEqual(fence(app,'resume',{key:key(),revision:0,epoch:k}).status,0);
  const resumed=resume(app,first),second=frozen(app,key(),resumed.current.revision);
  const oldResume=fence(app,'resume',{key:resumed.receipt.requestKey,revision:2,epoch:k});assert.equal(oldResume.status,0);assert.equal(oldResume.data.current.epoch,second.receipt.epoch);
  const oldFreeze=fence(app,'freeze',{key:k,revision:0});assert.equal(oldFreeze.status,0);assert.deepEqual(oldFreeze.data.receipt,first.receipt);assert.equal(oldFreeze.data.current.epoch,second.receipt.epoch);
  assert.equal(await app.read(o),original);
  await chmod(path,0o644);
  assert.notEqual(fence(app,'freeze',{key:k,revision:0}).status,0);
  await chmod(path,0o600);
  const archive=join(app.orderDirectory,'.commerce-freezes'),moved=join(app.orderDirectory,'moved-freezes');
  await rename(archive,moved);await symlink(moved,archive);
  assert.match(fence(app,'freeze',{key:k,revision:0}).stderr,/private storage/);
});

test('checkout drain waits across provider creation, rejects new writes, then exports the final payment response',async t=>{
  const app=await fixture(t),k=key();await writeFile(join(app.directory,'provider-barrier.json'),JSON.stringify({match:'/checkout/v1/payment'}));
  const checkout=app.request('/cart/api/start.php',input);await until(()=>exists(join(app.directory,'provider-entered')),'DOKU request');
  const first=fence(app,'freeze',{key:k,revision:0,'wait-ms':50});assert.notEqual(first.status,0);assert.match(first.stderr,/still finishing/);
  assert.equal(fence(app,'status').data.current.mode,'draining');
  const controlPath=join(app.orderDirectory,'.commerce-storage.state'),pendingControl=await readFile(controlPath,'utf8');
  assert.equal(app.cli(`try { ez_save_order(['order_id'=>'${order(9).order_id}']); } catch (EzLegacyOrderStorageException $e) { echo 'paused'; }`),'paused');
  await writeFile(join(app.directory,'provider-release'),'continue');const created=await checkout;assert.equal(created.status,201);
  const result=fence(app,'freeze',{key:k,revision:0,'wait-ms':2000});assert.equal(result.status,0,result.stderr);
  const source=JSON.parse(await readFile(join(app.orderDirectory,result.data.receipt.snapshot.relativePath),'utf8'));
  assert.equal(source.entries.length,1);const saved=JSON.parse(source.entries[0].source);
  assert.equal(saved.status,'PENDING');assert.ok(saved.payment_url);assert.equal(saved.order_id,created.data.order_id);
  // Model a crash after the export rename but before committing its receipt.
  const exportPath=join(app.orderDirectory,result.data.receipt.snapshot.relativePath),exportBytes=await readFile(exportPath,'utf8');
  await writeFile(controlPath,pendingControl);
  const recovered=fence(app,'freeze',{key:k,revision:0});assert.equal(recovered.status,0,recovered.stderr);
  assert.equal(recovered.data.receipt.snapshot.exportHash,digest(exportBytes));assert.equal(await readFile(exportPath,'utf8'),exportBytes);
  assert.equal((await app.calls()).filter(c=>c.url.includes('/checkout/v1/payment')).length,1);
});

test('frozen writes and authenticated callbacks are retryable; read-only status remains available and resume preserves ownership',async t=>{
  const app=await fixture(t),pending=order(),shipping=order(2,{status:'PAID',shipping_skipped:false,biteship_order_id:'fixture-booking',biteship_status:'confirmed',fulfillment_status:'CONFIRMED',paid_at:'2026-09-25T02:00:01Z'});
  app.seed(pending);app.seed(shipping);const bytes=await app.read(pending),f=frozen(app);
  const configuration=await fetch(app.base+'/cart/api/checkout-config.php');assert.equal(configuration.status,503);assert.equal(configuration.headers.get('retry-after'),'30');
  const checkout=await app.request('/cart/api/start.php',input);assert.equal(checkout.status,503);assert.equal((await app.calls()).length,0);
  const callback=await notify(app,pending);assert.equal(callback.status,503);assert.equal(callback.headers.get('retry-after'),'30');
  const courier=await fetch(app.base+'/cart/api/biteship-webhook.php?environment=sandbox',{method:'POST',headers:{'content-type':'application/json','X-Ezkart-Webhook-Token':'sandbox-webhook-fixture-32-characters'},body:JSON.stringify({event:'order.status',order_id:'fixture-booking',status:'delivered'})});assert.equal(courier.status,503);
  const tracking=await app.tracking(pending.order_id,{refresh:false});assert.equal(tracking.status,503);assert.equal(await app.read(pending),bytes);
  assert.equal((await app.request('/cart/api/status.php?order='+pending.order_id)).status,200);
  for(const expression of [`ez_accept_paid_order('${shipping.order_id}')`,`ez_arrange_paid_order_pickup('${shipping.order_id}')`,`ez_create_doku_payment(ez_load_order('${pending.order_id}'))`,`ez_create_biteship_order(ez_load_order('${shipping.order_id}'))`]) {
    assert.equal(app.cli(`try { ${expression}; } catch (EzLegacyOrderStorageException $e) { echo 'paused'; }`),'paused');
  }
  assert.equal((await app.calls()).length,0);resume(app,f);
  assert.equal((await notify(app,pending)).status,200);assert.equal(JSON.parse(await app.read(pending)).status,'PAID');
  assert.equal((await app.tracking(pending.order_id,{refresh:false})).status,200);assert.equal(JSON.parse(await app.read(pending)).customer_auth_user_id,'fixture-google-customer');
});

test('tracking drain spans the unlocked provider read and includes its final delivery status',async t=>{
  const app=await fixture(t),o=order(1,{status:'PAID',shipping_skipped:false,customer_auth_user_id:'fixture-google-customer',biteship_order_id:'fixture-booking',biteship_status:'confirmed',fulfillment_status:'CONFIRMED',paid_at:'2026-09-25T02:00:01Z'});
  app.seed(o);await writeFile(join(app.directory,'tracking-response.json'),JSON.stringify({success:true,id:'fixture-booking',status:'delivered',courier:{tracking_id:'track-1',waybill_id:'waybill-1'},history:[{status:'delivered',updated_at:new Date().toISOString()}]}));
  await writeFile(join(app.directory,'provider-barrier.json'),JSON.stringify({match:'/v1/orders/fixture-booking'}));
  const tracking=app.tracking(o.order_id,{refresh:true});await until(()=>exists(join(app.directory,'provider-entered')),'tracking request');
  const k=key(),first=fence(app,'freeze',{key:k,revision:0,'wait-ms':50});assert.notEqual(first.status,0);assert.equal(fence(app,'status').data.current.mode,'draining');
  await writeFile(join(app.directory,'provider-release'),'continue');assert.equal((await tracking).status,200);
  const f=frozen(app,k);const source=JSON.parse(await readFile(join(app.orderDirectory,f.receipt.snapshot.relativePath),'utf8'));
  assert.equal(JSON.parse(source.entries[0].source).biteship_status,'delivered');assert.equal(JSON.parse(source.entries[0].source).tracking_unavailable,false);
});

test('crashed writers release their kernel locks and a conflicting controller cannot mutate a live drain',async t=>{
  const app=await fixture(t),o=order(),ready=join(app.directory,'writer-ready');
  const writer=spawn(php,['-n','-r',`require ${JSON.stringify(transport)}; require ${JSON.stringify(join(root,'cart/api/bootstrap.php'))}; $lease=EzLegacyOrderLease::acquire('sandbox');ez_save_order(json_decode(base64_decode('${Buffer.from(JSON.stringify(o)).toString('base64')}'),true));file_put_contents(${JSON.stringify(ready)},'ready');usleep(10000000);`],{env:app.env,stdio:['ignore','pipe','pipe']});
  t.after(()=>{if(writer.exitCode===null)writer.kill('SIGKILL');});await until(()=>exists(ready),'writer lease');
  const k=key(),drain=spawn(php,['-n','-d','auto_prepend_file='+transport,controller,'freeze','--key='+k,'--revision=0','--wait-ms=5000'],{env:app.env,stdio:['ignore','pipe','pipe']});
  t.after(()=>{if(drain.exitCode===null)drain.kill('SIGKILL');});let output='',errors='';drain.stdout.on('data',b=>output+=b);drain.stderr.on('data',b=>errors+=b);
  const drained=new Promise(resolve=>drain.once('exit',(code,signal)=>resolve({code,signal})));
  await until(async()=>{try{return JSON.parse(await readFile(join(app.orderDirectory,'.commerce-storage.state'),'utf8')).mode==='draining';}catch{return false;}},'live drain');
  const competing=fence(app,'freeze',{key:key(),revision:1,'wait-ms':10});assert.notEqual(competing.status,0);assert.match(competing.stderr,/Another migration/);assert.equal(drain.exitCode,null);
  const died=new Promise(resolve=>writer.once('exit',resolve));writer.kill('SIGKILL');await died;
  assert.equal((await drained).code,0,errors);assert.equal(JSON.parse(output).current.mode,'frozen');assert.equal(JSON.parse(output).receipt.snapshot.orders,1);
});

test('malformed sources are never omitted and pending freeze cancellation cannot reuse its old request key',async t=>{
  const app=await fixture(t),o=order();app.seed(o);await writeFile(join(app.orderDirectory,'unexpected.json'),'{}');const k=key();
  const failed=fence(app,'freeze',{key:k,revision:0});assert.notEqual(failed.status,0);assert.match(failed.stderr,/unrecognized/);
  assert.equal(fence(app,'status').data.current.mode,'draining');assert.equal((await app.request('/cart/api/start.php',input)).status,503);
  const opened=fence(app,'resume',{key:key(),revision:1,epoch:k});assert.equal(opened.status,0);assert.equal(opened.data.current.mode,'legacy');
  assert.match(fence(app,'freeze',{key:k,revision:0}).stderr,/cannot freeze again/);
  await rm(join(app.orderDirectory,'unexpected.json'));const f=frozen(app,key(),2);
  const exportPath=join(app.orderDirectory,f.receipt.snapshot.relativePath);await writeFile(exportPath,'{}');
  assert.match(fence(app,'freeze',{key:f.receipt.requestKey,revision:2}).stderr,/unavailable or changed/);
  assert.equal(fence(app,'status').data.current.mode,'frozen');
});

test('damaged controls, symbolic links and a central flag cannot bypass the gate; control tools have no HTTP route',async t=>{
  const app=await fixture(t),o=order();app.seed(o);const f=frozen(app);
  assert.equal(app.cli(`require_once ${JSON.stringify(join(root,'cart/api/commerce-client.php'))};try { ez_central_commerce_enabled(); } catch (EzLegacyOrderStorageException $e) { echo 'paused'; }`,{EZKART_COMMERCE_STORAGE:'d1'}),'paused');
  assert.match(fence(app,'resume',{key:key(),revision:2,epoch:f.receipt.epoch},{EZKART_COMMERCE_STORAGE:'d1'}).stderr,/central commerce/);
  assert.match(fence(app,'status',{}, {EZKART_DEPLOYMENT_ENVIRONMENT:'production'}).stderr,/TEST sandbox/);
  assert.match(fence(app,'status',{}, {EZKART_ORDER_STORAGE:'',EZKART_MIDTRANS_ORDER_STORAGE:''}).stderr,/explicit private/);
  assert.match(fence(app,'status',{}, {EZKART_ORDER_STORAGE:join(app.directory,'never-created')}).stderr,/unavailable/);
  assert.equal(await exists(join(app.directory,'never-created')),false);
  for(const file of ['legacy-fence.php','legacy-fence-lib.php'])assert.equal((await fetch(app.base+'/tools/commerce/'+file)).status,404);
  const state=join(app.orderDirectory,'.commerce-storage.state');await writeFile(state,'broken');
  assert.equal((await app.request('/cart/api/start.php',input)).status,503);assert.equal((await app.calls()).length,0);
  await rm(state);const target=join(app.directory,'external-state');await writeFile(target,'{}');await symlink(target,state);
  assert.equal((await app.request('/cart/api/start.php',input)).status,503);assert.equal(await readFile(target,'utf8'),'{}');
});

test('checkout explains a temporary pause, preserves the cart and resumes on desktop and mobile',async t=>{
  const {chromium}=await import('../builder-mcp/node_modules/playwright/index.mjs');
  const app=await fixture(t),browser=await chromium.launch({headless:true});t.after(()=>browser.close());
  for(const width of [1280,390]) {
    const context=await browser.newContext({viewport:{width,height:900}}),page=await context.newPage(),errors=[];
    page.on('pageerror',e=>errors.push(e.message));
    await page.goto(app.base+'/cart/?shop=ezkart-demo&cart=granola:2');
    await page.waitForFunction(()=>!document.getElementById('to-checkout').disabled);
    const cartKey='ezkart.checkout.cart.v1:ezkart-demo';
    assert.deepEqual(await page.evaluate(k=>JSON.parse(localStorage.getItem(k)),cartKey),{granola:2});
    const f=frozen(app,key(),fence(app,'status').data.current.revision);
    await page.reload();await page.locator('#catalog-error').waitFor({state:'visible'});
    assert.equal(await page.locator('#catalog-error-message').textContent(),'Checkout is temporarily paused. Please retry shortly.');
    assert.equal(await page.locator('#to-checkout').isDisabled(),true);
    assert.deepEqual(await page.evaluate(k=>JSON.parse(localStorage.getItem(k)),cartKey),{granola:2});
    assert.equal((await app.calls()).length,0);
    assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
    resume(app,f);await page.locator('#retry-catalog').click();
    await page.waitForFunction(()=>!document.getElementById('to-checkout').disabled);
    await page.locator('#to-checkout').click();assert.equal(await page.locator('#pay-button').isEnabled(),true);
    assert.deepEqual(await page.evaluate(k=>JSON.parse(localStorage.getItem(k)),cartKey),{granola:2});
    assert.deepEqual(errors,[]);await context.close();
  }
});
