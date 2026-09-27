import test from 'node:test';
import assert from 'node:assert/strict';
import {randomBytes} from 'node:crypto';
import {spawn} from 'node:child_process';
import {mkdir,writeFile} from 'node:fs/promises';
import {setupCentralFixture} from './central-fixture.mjs';
import {browser,pageFor} from './review-workspace-fixture.mjs';
const buyer='fixture-google-customer',key=()=>randomBytes(16).toString('hex');
const claims=(age=0)=>({aal:'aal2',amr:[{method:'totp',timestamp:Math.floor(Date.now()/1000)-age}]});
async function fixture(t){
  const f=await setupCentralFixture(t),b=await browser(t),made=await f.create(f.input({customer:{name:'Original Buyer',email:'checkout@example.com',phone:'081234567890',authUserId:buyer}})),paid=await f.paid(made.order);
  assert.equal(paid.status,200,paid.error);const order=paid.order,path='/v1/customer/orders/'+order.id+'/refunds';
  const created=await f.merchant(path,{requestKey:key(),orderRevision:order.revision,reason:'damaged',note:'The original parcel was damaged.',items:[{orderItemId:order.items[0].id,amount:1000}],shippingAmount:0},{seller:buyer,method:'POST'});assert.equal(created.status,200,created.error);const refund=created.refund;
  const permission=(role='reviewer')=>f.call('/internal/commerce/support/access',{environment:'sandbox',authUserId:'bob',role,requestKey:key(),operator:'Fixture operator',reason:'Browser review acceptance.'});assert.equal((await permission()).status,200);
  const admin=async(id,age=0)=>f.app.adminCookie({supabase_access_token:await f.merchantToken(id,id+'@example.test',claims(age)),mfa_enabled:true,mfa_aal:'aal2',admin_user:{id,email:id+'@example.test'}});
  const cookies={buyer:f.app.customerCookie('checkout@example.com',buyer,3600,await f.merchantToken(buyer,'checkout@example.com')),merchant:await admin('alice'),support:await admin('bob')};
  const url=kind=>f.app.base+(kind==='buyer'?'/cart/return.php?order='+order.id+'&refund='+refund.id:'/cart/admin/?page='+(kind==='support'?'support-refunds':'refunds')+'&refund='+refund.id);
  const page=async(kind,width=390,cookie=cookies[kind])=>{const p=await pageFor(b,f,width,cookie);p.on('dialog',d=>void d.accept());await p.goto(url(kind));return p;};
  const open=async()=>{const r=(await f.merchant(path+'/'+refund.id,undefined,{seller:buyer})).refund;const out=await f.merchant(path+'/'+refund.id+'/dispute',{requestKey:key(),kind:'review_open',revision:0,refundRevision:r.revision,orderRevision:r.orderRevision,evidenceVersion:r.evidenceVersion,message:'Review the original evidence.'},{seller:buyer,method:'POST'});assert.equal(out.status,200,out.error);return out.refund;};
  return {...f,b,order,path,refund,permission,admin,cookies,url,page,open};
}
const review=p=>p.locator('[data-refund-review]');
async function act(p,label,message){await review(p).locator('textarea').fill(message);await review(p).getByRole('button',{name:label,exact:true}).click();await p.getByText('Your refund request was saved.',{exact:true}).waitFor();}

test('buyer, store and operator review screens recover saved actions and complete an appeal on desktop/mobile',async t=>{
  const f=await fixture(t),directory='/tmp/ezkart-refund-disputes-ui-01a0d643';await mkdir(directory,{recursive:true});
  const buyerPage=await f.page('buyer'),errors=[];buyerPage.on('pageerror',e=>errors.push(e.message));
  await review(buyerPage).locator('textarea').fill('The damage remains unresolved <img src=x onerror=alert(1)>.');f.control.drop=f.path+'/'+f.refund.id+'/dispute';
  await review(buyerPage).getByRole('button',{name:'Request Ezkart review',exact:true}).click();await buyerPage.getByRole('button',{name:'Retry confirmation',exact:true}).waitFor();const original=f.control.calls.filter(c=>c.body?.kind==='review_open').at(-1).body;
  await buyerPage.reload();await buyerPage.getByRole('button',{name:'Retry confirmation',exact:true}).click();await buyerPage.getByText('Your refund request was saved.',{exact:true}).waitFor();assert.deepEqual(f.control.calls.filter(c=>c.body?.kind==='review_open').at(-1).body,original);
  const staff=await f.page('support',1360);staff.on('pageerror',e=>errors.push(e.message));await act(staff,'Ask buyer for information','Please explain the damage visible in the original photo.');
  await buyerPage.getByRole('button',{name:'Reload request',exact:true}).click();await act(buyerPage,'Send information','The seal was broken and the parcel leaked.');
  const store=await f.page('merchant',390);store.on('pageerror',e=>errors.push(e.message));await act(store,'Send information','We confirm the buyer supplied the original parcel evidence.');assert.equal(await store.getByRole('button',{name:'Approve request',exact:true}).count(),0);
  for(const [kind,p] of [['buyer',buyerPage],['store',store],['support',staff]])for(const width of [1360,390]){
    await p.setViewportSize({width,height:1000});await p.getByRole('button',{name:'Reload request',exact:true}).click();await p.waitForFunction(()=>!document.querySelector('[data-refund-detail-reload]')?.disabled);await review(p).getByRole('heading',{name:'Ezkart review',exact:true}).waitFor();
    assert.equal(await p.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);assert.equal(await p.locator('img[onerror]').count(),0);
    if(width===390)for(const control of await review(p).getByRole('button').all()){const box=await control.boundingBox();assert(box.width>=110&&box.height<120,'review actions must remain readable at phone width');}
    await review(p).screenshot({path:directory+'/'+kind+'-'+width+'.png'});
  }
  const target='/v1/support/refunds/'+f.refund.id+'/dispute';f.control.drop=target;await review(staff).locator('textarea').fill('Original purchase, delivery and supplied evidence support the requested amount.');await review(staff).getByRole('button',{name:'Approve refund request',exact:true}).click();await staff.getByRole('button',{name:'Retry confirmation',exact:true}).waitFor();
  await staff.reload();await staff.getByRole('button',{name:'Retry confirmation',exact:true}).click();await staff.getByText('Your refund request was saved.',{exact:true}).waitFor();
  await staff.getByText('This refund request is approved. The refund has not been paid. Refund processing is not available yet.',{exact:true}).waitFor();assert.equal((await f.db.prepare("SELECT COUNT(*) n FROM commerce_refund_dispute_actions WHERE kind='approve'").first()).n,1);
  assert.deepEqual(errors,[]);assert.equal((await f.providerCalls()).length,0);
});

test('operator access refresh uses a current signed authenticator result, preserves the case and never grants access to store ownership',async t=>{
  const f=await fixture(t);await f.open();const stale=await f.admin('bob',601),p=await f.page('support',390,stale);
  await p.getByRole('heading',{name:'Verify your authenticator',exact:true}).waitFor();await review(p).getByText('Ezkart review requested',{exact:true}).waitFor();assert.equal(await review(p).getByRole('button',{name:'Approve refund request',exact:true}).count(),0);
  const fresh=await f.merchantToken('bob','bob@example.test',claims()),user={id:'bob',email:'bob@example.test',factors:[{id:'11111111-1111-4111-8111-111111111111',factor_type:'totp',status:'verified'}]};
  await writeFile(f.app.directory+'/auth-response.json',JSON.stringify({user,wallet_tokens:{access_token:fresh,refresh_token:'fixture-refresh',expires_in:3600}}));
  const crossSite=await p.request.post(f.url('support'),{form:{action:'support_verify',csrf_token:await p.locator('#review-verification [name=csrf_token]').inputValue(),code:'123456'},headers:{Origin:'null','Sec-Fetch-Site':'cross-site'}});assert.equal(crossSite.status(),403);
  await p.getByLabel('Authenticator code',{exact:true}).fill('111111');await p.getByRole('button',{name:'Verify review access',exact:true}).click();await p.getByText('Review access could not be verified. Check your sign-in and try again.',{exact:true}).waitFor();
  await p.getByLabel('Authenticator code',{exact:true}).fill('123456');await p.getByRole('button',{name:'Verify review access',exact:true}).click();await review(p).getByRole('button',{name:'Approve refund request',exact:true}).waitFor();assert.equal(new URL(p.url()).searchParams.get('refund'),f.refund.id);
  await f.permission('revoked');await p.reload();await p.getByRole('heading',{name:'Review access required',exact:true}).waitFor();assert.equal(await p.locator('[data-refunds]').count(),0);
  const merchant=await f.page('support',390,f.cookies.merchant);await merchant.getByRole('heading',{name:'Review access required',exact:true}).waitFor();assert.equal(await merchant.locator('[data-refunds]').count(),0);
});

test('private support provisioning recovers its exact receipt, reports the latest role and rejects a different deployment',async t=>{
  const f=await setupCentralFixture(t),body={environment:'sandbox',authUserId:'bob',role:'reviewer',requestKey:key(),operator:'Fixture operator',reason:'Approve an isolated review account.'};
  const run=(input=body,deployment='test',overrides={})=>new Promise((resolve,reject)=>{
    const code=`require '${process.cwd()}/tools/checkout-test/provider-fixture.php'; $argv=['support-access.php','--deployment=${deployment}']; require '${process.cwd()}/tools/commerce/support-access.php';`;
    const child=spawn(process.env.PHP_BINARY||'php',['-n','-r',code],{env:{...f.app.env,...overrides}});let output='',error='';child.stdout.on('data',x=>output+=x);child.stderr.on('data',x=>error+=x);child.on('error',reject);child.on('close',status=>resolve({status,output,error}));child.stdin.end(JSON.stringify(input));
  });
  f.control.drop='/internal/commerce/support/access';assert.equal((await run()).status,1);const retry=await run();assert.equal(retry.status,0,retry.error);assert.equal(JSON.parse(retry.output).permission.currentRole,'reviewer');
  assert.equal((await f.db.prepare('SELECT COUNT(*) n FROM commerce_support_permissions').first()).n,1);
  assert.equal((await run({...body,role:'viewer'})).status,1);assert.equal((await run({...body,role:'revoked',requestKey:key()})).status,0);
  assert.equal(JSON.parse((await run()).output).permission.currentRole,'revoked');
  const count=f.control.calls.length;for(const [deployment,overrides] of [['beta',{}],['test',{EZKART_DEPLOYMENT_ENVIRONMENT:'production'}]])assert.equal((await run(body,deployment,overrides)).status,1);assert.equal(f.control.calls.length,count);
  assert((await f.app.calls()).every(c=>!c.url.includes('doku.com')));
});

test('operator proxy binds the signed-in account and withholds private evidence after a session change',async t=>{
  const f=await fixture(t);await f.open();const png='iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a8x8AAAAASUVORK5CYII=';
  const uploaded=await f.merchant(f.path+'/'+f.refund.id+'/evidence',{filename:'Original.png',caption:'Private evidence',dataUrl:'data:image/png;base64,'+png},{seller:buyer,method:'POST'});assert.equal(uploaded.status,200,uploaded.error);
  const p=await f.page('support'),path='/v1/support/refunds/'+f.refund.id,headers={Cookie:f.cookies.support.name+'='+f.cookies.support.value,'X-Ezkart-Refund-Account':'bob','X-Ezkart-CSRF':await p.locator('[data-refunds]').getAttribute('data-csrf')};
  const endpoint=target=>'/cart/admin/?cloud='+encodeURIComponent(target);
  assert.equal((await f.app.request(endpoint(path),undefined,{...headers,'X-Ezkart-Refund-Account':'alice'})).status,401);
  for(const [invalid,status] of [[path+'?before=1',400],[path+'/dispute?before=1&before=2',400],[path+'/dispute/evidence',400],[path+'/evidence?before=1',405]])assert.equal((await f.app.request(endpoint(invalid),undefined,headers)).status,status);
  assert.equal((await f.app.request(endpoint(path+'/evidence'),{},headers)).status,405);
  assert.equal((await f.app.request(endpoint(path+'/dispute'),{}, {...headers,'X-Ezkart-CSRF':'forged'})).status,403);
  const file=uploaded.refund.attachments[0];f.control.afterResponse=async target=>{if(target!==path+'/evidence/'+file.id)return;f.control.afterResponse=null;f.app.cli(`define('EZ_CUSTOMER_SESSION_BRIDGE',true); session_id('${f.cookies.support.value}'); require '${process.cwd()}/cart/admin/index.php'; $_SESSION['authenticated']=false; session_write_close();`);};
  let downloads=0;p.on('download',()=>downloads++);await p.getByRole('button',{name:'Download original: Original.png',exact:true}).click();await p.getByRole('button',{name:'Reload sign-in',exact:true}).waitFor();assert.equal(downloads,0);
  for(const route of ['/cart/admin/support-access.php','/tools/commerce/support-access.php'])assert.equal((await fetch(f.app.base+route)).status,404);
});
