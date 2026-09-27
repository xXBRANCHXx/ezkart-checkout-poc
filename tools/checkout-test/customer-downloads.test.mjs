import test from 'node:test';
import assert from 'node:assert/strict';
import {randomBytes} from 'node:crypto';
import {writeFile,readFile,mkdir} from 'node:fs/promises';
import {join} from 'node:path';
import {setupCentralFixture} from './central-fixture.mjs';
import {digitalFixtureFile} from '../../cloudflare/ezkart-api/test/digital-commerce-fixture.mjs';
import {digitalPartBytes} from '../../cloudflare/ezkart-api/src/digital-files.js';
import {digitalDownloadProof} from '../../cloudflare/ezkart-api/src/commerce-digital.js';

const buyer='fixture-google-customer',key=()=>randomBytes(16).toString('hex'),endpoint='/cart/admin/customer-downloads.php';
async function fixture(t,bytes=Buffer.from('A private customer download')){
  const f=await setupCentralFixture(t),file=await digitalFixtureFile(f,{bytes});
  const result=await f.create(f.input({customer:{name:'Buyer',email:'checkout@example.com',phone:'081234567890',authUserId:buyer},items:[file.item],shipping:{kind:'none',amount:0,skipped:false}}));
  assert.equal(result.status,200,result.error);const order=result.order;assert.equal((await f.paid(order)).status,200);
  const cookie=f.app.customerCookie('checkout@example.com',buyer,3600,await f.merchantToken(buyer,'checkout@example.com'));
  const account=JSON.parse(f.app.cli(`require '${process.cwd()}/cart/api/customer-auth.php';session_id('${cookie.value}');ez_customer_session();ez_customer_current();$csrf=ez_customer_csrf();echo json_encode(['csrf'=>$csrf,'version'=>$_SESSION['customer_auth']['version']]);session_write_close();`));
  const headers={Cookie:cookie.name+'='+cookie.value,'X-Ezkart-CSRF':account.csrf,'X-Ezkart-Customer-Session':account.version};
  const query={order:order.id},item=order.items[0],path=q=>endpoint+'?'+new URLSearchParams(q);
  const api=(q,body,h=headers)=>f.app.request(path({...query,...q}),body,h);
  return {...f,file,order,item,cookie,headers,query,path,api};
}
test('customer proxy carries exact multipart bytes and verification metadata, and never confirms server-only receipt as delivery',async t=>{
  const f=await fixture(t,randomBytes(digitalPartBytes+73)),purchases=await f.api({});assert.equal(purchases.status,200,JSON.stringify(purchases.data));
  assert.equal(purchases.data.items[0].deliveryConfirmed,false);
  const requestKey=key(),created=await f.api({item:f.item.id},{requestKey});assert.equal(created.status,200,JSON.stringify(created.data));
  const grant=created.data.grant.id;assert.equal((await f.api({item:f.item.id},{requestKey})).data.grant.id,grant);
  const proofs=[];
  for(const part of [1,2]){
    const response=await fetch(f.app.base+f.path({...f.query,item:f.item.id,grant,part}),{headers:f.headers});assert.equal(response.status,200,await(response.status!==200?response.text():Promise.resolve('')));
    const bytes=new Uint8Array(await response.arrayBuffer());assert.deepEqual(Buffer.from(bytes),f.file.bytes.subarray((part-1)*digitalPartBytes,part*digitalPartBytes));
    assert.equal(response.headers.get('x-ezkart-file-part'),String(part));assert.match(response.headers.get('content-security-policy'),/default-src 'none'/);
    assert.match(response.headers.get('cache-control'),/no-store/);assert.equal(response.headers.get('content-type'),'application/octet-stream');
    proofs.push(await digitalDownloadProof(grant,part,response.headers.get('x-ezkart-file-challenge'),bytes));
  }
  assert.equal(await f.count('commerce_digital_deliveries'),0,'PHP receiving every byte is not buyer verification');
  for(const part of [1,2]){const receipt=await f.api({item:f.item.id,grant,part,receipt:1},{proof:proofs[part-1]});assert.equal(receipt.status,200,JSON.stringify(receipt.data));assert.equal(receipt.data.deliveryConfirmed,part===2);}
  assert.equal(await f.count('commerce_digital_deliveries'),1);
});

async function browser(t){const {chromium}=await import('../builder-mcp/node_modules/playwright/index.mjs'),b=await chromium.launch({headless:true});t.after(()=>b.close());return b;}
async function pageFor(b,f,width=1360){const context=await b.newContext({viewport:{width,height:1000},reducedMotion:'reduce'});await context.addCookies([f.cookie]);const page=await context.newPage();page.setDefaultTimeout(18000);return page;}
const ui=p=>p.locator('[data-customer-downloads]');
async function open(p,f){await p.goto(f.app.base+'/cart/downloads.php?order='+f.order.id);await p.waitForFunction(()=>document.querySelector('[data-download-status]')?.textContent==='Your purchased files are up to date.');}
const complete=p=>ui(p).getByText('Download verified. Save your file below.',{exact:true}).waitFor();

test('buyers receive, verify and save original files on desktop and narrow screens without a full-file memory buffer',async t=>{
  const f=await fixture(t,randomBytes(digitalPartBytes+73)),b=await browser(t),screens='/tmp/ezkart-customer-downloads-ui-01a0d643';await mkdir(screens,{recursive:true});
  for(const width of [1360,390]){
    const p=await pageFor(b,f,width),errors=[];p.on('pageerror',e=>errors.push(e.message));await open(p,f);
    await ui(p).getByRole('button',{name:'Download file',exact:true}).click();await complete(p);
    const [saved]=await Promise.all([p.waitForEvent('download'),ui(p).getByRole('link',{name:'Save file',exact:true}).click()]);
    assert.equal(saved.suggestedFilename(),'Panduan café.pdf');assert.deepEqual(await readFile(await saved.path()),f.file.bytes);
    assert.equal(await f.count('commerce_digital_deliveries'),1);assert.equal(await p.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
    await ui(p).screenshot({path:screens+'/download-'+width+'.png'});assert.deepEqual(errors,[]);
    await ui(p).getByRole('button',{name:'Remove browser copy',exact:true}).click();await ui(p).getByText('Browser copy removed. You can download this purchase again.',{exact:true}).waitFor();
    assert.equal(await ui(p).getByRole('link',{name:'Save file',exact:true}).isVisible(),false);await p.context().close();
  }
});

test('reload recovers a lost grant and flushed parts after a lost receipt, including an interrupted journal append',async t=>{
  const f=await fixture(t,randomBytes(digitalPartBytes+73)),b=await browser(t),p=await pageFor(b,f,390);await open(p,f);
  const path='/v1/customer/orders/'+f.order.id+'/downloads/'+f.item.id+'/grants';f.control.drop=path;
  await ui(p).getByRole('button',{name:'Download file',exact:true}).click();await ui(p).getByRole('button',{name:'Resume download',exact:true}).waitFor();assert.equal(await f.count('commerce_digital_download_grants'),1);
  const original=f.control.calls.filter(c=>c.path===path&&c.body).at(-1).body;
  await p.evaluate(async()=>{const dir=await(await navigator.storage.getDirectory()).getDirectoryHandle('ezkart-downloads');for await(const [name,handle]of dir.entries())if(name.endsWith('.journal')){
    const file=await handle.getFile(),write=await handle.createWritable({keepExistingData:true});await write.write({type:'write',position:file.size,data:'{"unfinished":'});await write.close();}});
  const grant=(await f.db.prepare('SELECT id FROM commerce_digital_download_grants').first()).id;f.control.drop=path+'/'+grant+'/parts/1/receipt';
  await open(p,f);await ui(p).getByRole('button',{name:'Download file',exact:true}).click();await ui(p).getByRole('button',{name:'Resume download',exact:true}).waitFor();
  assert.equal(await f.count('commerce_digital_download_grants'),1);assert.deepEqual(f.control.calls.filter(c=>c.path===path&&c.body).at(-1).body,original);
  assert.equal(await f.count('commerce_digital_part_receipts'),1);assert.equal(await f.count('commerce_digital_deliveries'),0);
  const before=f.control.calls.filter(c=>c.path.endsWith('/parts/1')).length;
  await open(p,f);await ui(p).getByRole('button',{name:'Download file',exact:true}).click();await complete(p);
  assert.equal(f.control.calls.filter(c=>c.path.endsWith('/parts/1')).length,before,'Verified local bytes resume without another transfer');
  assert.equal(await f.count('commerce_digital_deliveries'),1);
  const [saved]=await Promise.all([p.waitForEvent('download'),ui(p).getByRole('link',{name:'Save file',exact:true}).click()]);assert.deepEqual(await readFile(await saved.path()),f.file.bytes);
});

test('corrupt browser recovery blocks new requests and changed sessions remove buyer download controls',async t=>{
  const f=await fixture(t),b=await browser(t),p=await pageFor(b,f,390);await open(p,f);
  await p.evaluate(async({item,file})=>{const root=document.querySelector('[data-customer-downloads]'),identity=JSON.stringify([root.dataset.account,root.dataset.order,item,file]);
    const scope=[...new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(identity)))].map(v=>v.toString(16).padStart(2,'0')).join('');
    const dir=await(await navigator.storage.getDirectory()).getDirectoryHandle('ezkart-downloads',{create:true}),handle=await dir.getFileHandle(scope+'.journal',{create:true}),write=await handle.createWritable();await write.write('{"body":"{}","hash":"corrupt"}\n');await write.close();
  },{item:f.item.id,file:f.file.version});
  await ui(p).getByRole('button',{name:'Download file',exact:true}).click();await ui(p).getByText('Your saved download record is damaged. Remove the browser copy before starting again.',{exact:true}).waitFor();
  assert.equal(await f.count('commerce_digital_download_grants'),0);await ui(p).getByRole('button',{name:'Remove browser copy',exact:true}).click();
  await ui(p).getByText('Browser copy removed. You can download this purchase again.',{exact:true}).waitFor();
  f.control.afterResponse=async path=>{if(!path.endsWith('/parts/1'))return;f.control.afterResponse=null;
    f.app.cli(`require '${process.cwd()}/cart/api/customer-auth.php';session_id('${f.cookie.value}');ez_customer_session();$_SESSION['customer_auth']['version']='replaced';session_write_close();`);};
  await ui(p).getByRole('button',{name:'Download file',exact:true}).click();await ui(p).getByRole('button',{name:'Reload sign-in',exact:true}).waitFor();
  assert.equal(await ui(p).locator('.download-card').count(),0);assert.equal(await f.count('commerce_digital_part_receipts'),0);assert.equal(await f.count('commerce_digital_deliveries'),0);
});

test('download proxy rejects other sessions, missing CSRF, forged paths and stale accounts before sending file bytes',async t=>{
  const f=await fixture(t),intent={requestKey:key()},item={item:f.item.id};
  assert.equal((await f.api(item,intent,{})).status,401);
  assert.equal((await f.api(item,intent,{...f.headers,'X-Ezkart-Customer-Session':'old'})).status,401);
  assert.equal((await f.api(item,intent,{...f.headers,'X-Ezkart-CSRF':'bad'})).status,403);
  for(const suffix of ['&order='+f.order.id,'&environment=production','&item[]=x','&part=1','&grant=bad','&receipt=','&file=1'])assert.equal((await f.app.request(f.path(f.query)+suffix,undefined,f.headers)).status,400);
  assert.equal((await f.api(item,'{"requestKey":"'+key()+'","requestKey":"'+key()+'"}')).status,400);
  const grant=(await f.api(item,intent)).data.grant.id,target={...f.query,...item,grant,part:1};
  assert.equal((await f.app.request(f.path(target),undefined,{...f.headers,Range:'bytes=0-2'})).status,400);
  await writeFile(join(f.app.directory,'auth-response.json'),JSON.stringify({user:{id:'other-account'}}));
  assert.equal((await f.app.request(f.path(target),undefined,f.headers)).status,401);assert.equal(await f.count('commerce_digital_download_requests'),0);
  await writeFile(join(f.app.directory,'auth-response.json'),'{}');
  f.control.afterResponse=async path=>{if(!path.endsWith('/parts/1'))return;f.control.afterResponse=null;
    f.app.cli(`require '${process.cwd()}/cart/api/customer-auth.php';session_id('${f.cookie.value}');ez_customer_session();$_SESSION['customer_auth']['version']='new-session';session_write_close();`);};
  const changed=await f.app.request(f.path(target),undefined,f.headers);assert.equal(changed.status,401);assert.equal(changed.data.code,'customer_session_changed');
  assert.equal(await f.count('commerce_digital_part_receipts'),0);assert.equal(await f.count('commerce_digital_deliveries'),0);
});

test('download and acknowledgement response loss preserve the original grant and complete evidence',async t=>{
  const f=await fixture(t),requestKey=key(),item={item:f.item.id},base='/v1/customer/orders/'+f.order.id+'/downloads/'+f.item.id+'/grants';
  f.control.drop=base;assert.equal((await f.api(item,{requestKey})).status,503);
  const restored=await f.api(item,{requestKey});assert.equal(restored.status,200);assert.equal(await f.count('commerce_digital_download_grants'),1);
  const grant=restored.data.grant.id,target={...f.query,...item,grant,part:1};
  f.control.drop=base+'/'+grant+'/parts/1';assert.equal((await f.app.request(f.path(target),undefined,f.headers)).status,503);
  const response=await fetch(f.app.base+f.path(target),{headers:f.headers});assert.equal(response.status,200);
  const proof=await digitalDownloadProof(grant,1,response.headers.get('x-ezkart-file-challenge'),new Uint8Array(await response.arrayBuffer()));
  f.control.drop=base+'/'+grant+'/parts/1/receipt';assert.equal((await f.api({...item,grant,part:1,receipt:1},{proof})).status,503);
  assert.equal(await f.count('commerce_digital_deliveries'),1);const retry=await f.api({...item,grant,part:1,receipt:1},{proof});
  assert.equal(retry.status,200,JSON.stringify(retry.data));assert.equal(retry.data.deliveryConfirmed,true);assert.equal(await f.count('commerce_digital_deliveries'),1);
});

test('pause releases browser storage and another tab resumes the same purchase without duplicate grants or verified parts',async t=>{
  const f=await fixture(t,randomBytes(digitalPartBytes+73)),b=await browser(t),p=await pageFor(b,f,390);await open(p,f);
  let enteredResolve,releaseResolve;const entered=new Promise(resolve=>enteredResolve=resolve),hold=new Promise(resolve=>releaseResolve=resolve);
  await p.route('**/customer-downloads.php?*',async route=>{
    const url=new URL(route.request().url());if(url.searchParams.get('part')==='2'&&!url.searchParams.has('receipt')){enteredResolve();await hold;}
    try{await route.continue();}catch{}
  });
  await ui(p).getByRole('button',{name:'Download file',exact:true}).click();await entered;
  const second=await p.context().newPage();second.setDefaultTimeout(18000);await open(second,f);
  await ui(second).getByRole('button',{name:'Download file',exact:true}).click();await ui(second).getByText('This download is already open in another tab. Close it there and resume here.',{exact:true}).waitFor();
  assert.equal(await f.count('commerce_digital_download_grants'),1);
  await ui(p).getByRole('button',{name:'Pause',exact:true}).click();await ui(p).getByText('Paused. Resume to continue from the parts saved on this device.',{exact:true}).waitFor();
  const before=f.control.calls.filter(c=>c.path.endsWith('/parts/1')).length;
  await ui(second).getByRole('button',{name:'Resume download',exact:true}).click();await complete(second);releaseResolve();
  assert.equal(f.control.calls.filter(c=>c.path.endsWith('/parts/1')).length,before);assert.equal(await f.count('commerce_digital_download_grants'),1);assert.equal(await f.count('commerce_digital_deliveries'),1);
});

test('unavailable browser storage prevents grant creation and the buyer page keeps its strict policy and sign-in return path',async t=>{
  const f=await fixture(t),b=await browser(t),p=await pageFor(b,f);
  const source=await readFile(new URL('../../cart/customer-download-worker.js',import.meta.url),'utf8');
  await p.route('**/customer-download-worker.js?*',route=>route.fulfill({contentType:'text/javascript',body:"Object.defineProperty(navigator.storage,'getDirectory',{value:async()=>{throw Error('Device storage is unavailable.');}});\n"+source}));
  const response=await p.goto(f.app.base+'/cart/downloads.php?order='+f.order.id);assert.match(response.headers()['content-security-policy'],/worker-src 'self'/);assert.doesNotMatch(response.headers()['content-security-policy'],/unsafe-inline|unsafe-eval/);
  await p.waitForFunction(()=>document.querySelector('[data-download-status]')?.textContent==='Your purchased files are up to date.');
  await ui(p).getByRole('button',{name:'Download file',exact:true}).click();await ui(p).getByText('Device storage is unavailable.',{exact:true}).waitFor();assert.equal(await f.count('commerce_digital_download_grants'),0);
  await p.evaluate(()=>{const script=document.createElement('script');script.textContent='window.unapprovedDownloadScript=true';document.head.append(script);});
  assert.equal(await p.evaluate(()=>typeof unapprovedDownloadScript),'undefined');
  const next=f.app.cli(`require '${process.cwd()}/cart/api/customer-auth.php';echo ez_customer_next('/cart/downloads.php?order=${f.order.id}&redirect=https://other.example');`);assert.equal(next,'/cart/downloads.php?order='+f.order.id);
  const gate=await fetch(f.app.base+'/cart/downloads.php?order='+f.order.id),html=await gate.text();assert.equal(gate.status,200);assert.match(html,/Sign in to download/);assert(!html.includes('data-customer-downloads'));assert(!html.includes(f.file.version));
});
