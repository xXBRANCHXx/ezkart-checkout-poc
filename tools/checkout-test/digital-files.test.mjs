import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdir,readFile} from 'node:fs/promises';
import {randomBytes} from 'node:crypto';
import {setupCentralFixture} from './central-fixture.mjs';
import {browser,pageFor} from './review-workspace-fixture.mjs';
import {digest} from '../../cloudflare/ezkart-api/test/commerce-fixture.mjs';
const prefix='/v1/digital-files',screens='/tmp/ezkart-digital-ui-01a0d643',productId='custom-digitalguide',chunk=5*1024*1024;
const root=p=>p.locator('[data-digital-file-editor]');
async function fixture(t){
  const f=await setupCentralFixture(t),bytes=Buffer.from('Original private file\0\xff','latin1'),token=await f.merchantToken('alice','alice@example.test');
  const worker=async(path,body,method='POST')=>{
    const binary=body instanceof Uint8Array,r=await f.mf.dispatchFetch('https://api.fixture.test'+prefix+path,{method,headers:{authorization:'Bearer '+token,'x-ezkart-file-store':'seller_alice','content-type':binary?'application/octet-stream':'application/json'},body:binary?body:JSON.stringify(body)});
    const value=await r.json();assert.equal(r.status,200,JSON.stringify(value));return value;
  };
  const start=await worker('/uploads',{requestKey:randomBytes(16).toString('hex'),filename:'Original guide.pdf',size:bytes.length,parts:[digest(bytes)]}),id=start.upload.id;
  await worker('/uploads/'+id+'/parts/1',bytes,'PUT');await worker('/uploads/'+id+'/complete',{});
  const media=await f.merchant('/v1/media',{dataUrl:'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a8x8AAAAASUVORK5CYII='},{method:'POST'});assert.equal(media.status,201,JSON.stringify(media));
  const product=await f.merchant('/v1/products/'+productId,{id:productId,name:'Complete freelance guide',type:'digital',price:25000,sku:'GUIDE-1',category:'Learning & Education > Books & Guides > E-books',imageUploadIds:[media.media.id],digitalUploadId:id});assert.equal(product.status,200,JSON.stringify(product));
  const cookie=f.app.adminCookie({supabase_access_token:token,admin_user:{id:'alice',email:'alice@example.test'}});
  return {...f,cookie,id,bytes,product:product.product};
}
async function open(p,f){await p.goto(f.app.base+'/cart/admin/?page=product-new&product='+productId);try{await root(p).getByText('Published file retained. Replacements create a new version.',{exact:true}).waitFor();}catch(error){console.log('File editor diagnostics',await root(p).textContent(),await p.evaluate(()=>({loaded:!!globalThis.EzkartDigitalFiles,store:document.body.dataset.adminFileStore,account:document.body.dataset.adminReviewAccount})));throw error;}}
async function headers(p,f){return {...await p.evaluate(()=>({'X-Ezkart-CSRF':document.body.dataset.adminCsrfToken,'X-Ezkart-File-Account':document.body.dataset.adminReviewAccount,'X-Ezkart-File-Store':document.body.dataset.adminFileStore})),Cookie:'ezkart_admin='+f.cookie.value};}

test('real file editor uploads binary chunks, publishes replacement versions and downloads through PHP on desktop and mobile',async t=>{
  const f=await fixture(t),b=await browser(t);await mkdir(screens,{recursive:true});
  for(const width of [1360,390]){
    const p=await pageFor(b,f,width),errors=[];p.on('pageerror',error=>errors.push(error.message));await open(p,f);
    const bytes=Buffer.from('Replacement\0'+width+'\xff','latin1'),name='Updated café '+width+'.pdf';
    await root(p).locator('[data-digital-pick]').setInputFiles({name,mimeType:'application/octet-stream',buffer:bytes});
    await root(p).getByText('File verified. Publish the product to use this file.',{exact:true}).waitFor();
    p.on('console',message=>{if(message.type()==='error')console.log('File browser error:',message.text());});
    const download=p.waitForEvent('download');await root(p).getByRole('button',{name:'Download selected file',exact:true}).click();const file=await download;
    assert.equal(file.suggestedFilename(),name);assert.deepEqual(await readFile(await file.path()),bytes);
    await root(p).locator('summary').click();await root(p).getByRole('button',{name:'Download version 1',exact:true}).waitFor();
    assert.equal(await p.evaluate(()=>document.documentElement.scrollWidth>innerWidth+1),false);
    await root(p).screenshot({path:screens+'/editor-'+width+'.png'});
    await p.locator('.product-editor-header').getByRole('button',{name:'Publish changes',exact:true}).click();await p.waitForURL('**/?page=products&updated=1');
    const current=(await f.merchant('/v1/catalog')).products.find(v=>v.id===productId);assert.equal(current.digitalFile.filename,name);assert.equal(current.digitalFile.version,width===1360?2:3);
    assert.deepEqual(errors,[]);await p.context().close();
  }
  const old=await f.mf.getR2Bucket('PRIVATE_ASSETS');assert.equal((await old.list({prefix:'digital/seller_alice/'})).objects.length,3);
});

test('interrupted upload recovers after reload, rejects a different file and sends only missing chunks',async t=>{
  const f=await fixture(t),b=await browser(t),p=await pageFor(b,f,390);await open(p,f);
  const bytes=Buffer.alloc(chunk+73,255);bytes.write('Resumable private file');let lostId='';
  f.control.afterResponse=async path=>{
    if(path!==prefix+'/uploads')return;f.control.afterResponse=null;
    const row=await f.db.prepare('SELECT id FROM digital_file_uploads WHERE id!=?').bind(f.id).first();lostId=row.id;f.control.drop=prefix+'/uploads/'+lostId+'/parts/1';
  };
  await root(p).locator('[data-digital-pick]').setInputFiles({name:'Resume guide.zip',mimeType:'application/zip',buffer:bytes});
  await root(p).getByText('The result was not confirmed. Resume the same upload.',{exact:true}).waitFor();
  await p.reload();await root(p).getByText('1 of 2 parts confirmed. Select the same file to resume.',{exact:true}).waitFor();
  const wrong=Buffer.from(bytes);wrong[chunk]=34;
  await root(p).locator('[data-digital-pick]').setInputFiles({name:'Resume guide.zip',mimeType:'application/zip',buffer:wrong});
  await root(p).getByText('This is a different file. Select the original file to resume, or discard the selected upload before replacing it.',{exact:true}).waitFor();
  assert.equal(f.control.calls.filter(c=>c.path===prefix+'/uploads/'+lostId+'/parts/1').length,1);
  await root(p).locator('[data-digital-pick]').setInputFiles({name:'Resume guide.zip',mimeType:'application/zip',buffer:bytes});
  await root(p).getByText('File verified. Publish the product to use this file.',{exact:true}).waitFor();
  assert.equal(f.control.calls.filter(c=>c.path===prefix+'/uploads/'+lostId+'/parts/1').length,1);assert.equal(f.control.calls.filter(c=>c.path===prefix+'/uploads/'+lostId+'/parts/2').length,1);
  const current=await f.db.prepare('SELECT state FROM digital_file_uploads WHERE id=?').bind(lostId).first();assert.equal(current.state,'ready');
  f.control.drop=prefix+'/uploads/'+lostId+'/cancel';await root(p).getByRole('button',{name:'Discard selected upload',exact:true}).click();
  await root(p).getByRole('button',{name:'Retry discarding upload',exact:true}).waitFor();await p.reload();
  await root(p).getByRole('button',{name:'Retry discarding upload',exact:true}).click();await root(p).getByText('Published file retained. Replacements create a new version.',{exact:true}).waitFor();
  assert.equal((await f.db.prepare('SELECT state FROM digital_file_uploads WHERE id=?').bind(lostId).first()).state,'deleted');
});

test('private file proxy checks session, store, exact paths, attachment headers and mid-transfer sign-in changes',async t=>{
  const f=await fixture(t),b=await browser(t),p=await pageFor(b,f);await open(p,f);const h=await headers(p,f);
  const request=(path,extra={},options={})=>fetch(f.app.base+'/cart/admin/?cloud='+encodeURIComponent(prefix+path),{...options,headers:{...h,...extra}});
  const filePath='/uploads/'+f.id+'/file';
  let response=await request(filePath);assert.equal(response.status,200);assert.deepEqual(Buffer.from(await response.arrayBuffer()),f.bytes);
  assert.match(response.headers.get('content-disposition'),/^attachment;/);assert.match(response.headers.get('cache-control'),/no-store/);assert.equal(response.headers.get('x-content-type-options'),'nosniff');
  response=await request(filePath,{Range:'bytes=0-7'});assert.equal(response.status,206);assert.deepEqual(Buffer.from(await response.arrayBuffer()),f.bytes.subarray(0,8));
  assert.equal((await request(filePath,{'X-Ezkart-File-Account':'bob'})).status,401);assert.equal((await request(filePath,{'X-Ezkart-CSRF':'wrong'})).status,401);assert.equal((await request(filePath,{'X-Ezkart-File-Store':'seller_bob'})).status,409);
  assert.equal((await request(filePath,{Range:'bytes=0-1,4-5'})).status,416);
  for(const path of [filePath+'?before=1','/uploads/'+f.id+'/parts/01','/products/'+productId+'?before=2&before=1','/products/'+productId+'?before[]=2'])assert.equal((await request(path)).status,400,path);
  assert.equal((await fetch(f.app.base+'/cart/admin/digital-file-proxy.php')).status,404);
  const form=new URLSearchParams({account:'alice',store:'seller_alice',csrf:h['X-Ezkart-CSRF']});
  response=await fetch(f.app.base+'/cart/admin/?cloud='+encodeURIComponent(prefix+filePath),{method:'POST',headers:{Cookie:h.Cookie,'Content-Type':'application/x-www-form-urlencoded',Origin:f.app.base},body:form});
  assert.equal(response.status,200);assert.deepEqual(Buffer.from(await response.arrayBuffer()),f.bytes);
  f.control.afterResponse=async path=>{if(path!==prefix+filePath)return;f.control.afterResponse=null;
    f.app.cli(`define('EZ_CUSTOMER_SESSION_BRIDGE', true); session_id('${f.cookie.value}'); require '${process.cwd()}/cart/admin/index.php'; $_SESSION['admin_user']=['id'=>'bob','email'=>'bob@example.test']; $_SESSION['csrf_token']='changed'; session_write_close();`);};
  response=await request(filePath);assert.equal(response.status,401);assert(!String(await response.text()).includes('Original private file'));
});

test('corrupt recovery and disabled browser storage preserve the original file and block new uploads',async t=>{
  const f=await fixture(t),b=await browser(t),p=await pageFor(b,f);await open(p,f);
  const record=await p.evaluate(()=>{const key=Object.keys(sessionStorage).find(k=>k.startsWith('ezkart.digital-file.v1:'));const value=JSON.parse(sessionStorage.getItem(key));value.data='{"changed":true}';sessionStorage.setItem(key,JSON.stringify(value));return {key,raw:sessionStorage.getItem(key)};});
  await p.reload();await root(p).getByText('The saved upload reference could not be verified. Keep this tab open and preserve its recovery record before clearing browser storage.',{exact:true}).waitFor();
  assert.equal(await root(p).getByRole('button',{name:'Replace file',exact:true}).isDisabled(),true);assert.equal(await p.evaluate(key=>sessionStorage.getItem(key),record.key),record.raw);
  assert.equal(await f.count('digital_file_uploads'),1);
  const blocked=await pageFor(b,f);await blocked.addInitScript(()=>{const original=Storage.prototype.setItem;Storage.prototype.setItem=function(k,v){if(k.startsWith('ezkart.digital-file.v1:'))throw Error('Blocked');return original.call(this,k,v);};});
  await blocked.goto(f.app.base+'/cart/admin/?page=product-new&product='+productId);await root(blocked).getByText('The saved upload reference could not be verified. Keep this tab open and preserve its recovery record before clearing browser storage.',{exact:true}).waitFor();
  assert.equal(await root(blocked).getByRole('button',{name:'Replace file',exact:true}).isDisabled(),true);assert.equal(await f.count('digital_file_uploads'),1);
});

test('a lost initial digital publication retains its draft and product identity across reload and another store editor',async t=>{
  const f=await fixture(t),b=await browser(t),p=await pageFor(b,f);await p.goto(f.app.base+'/cart/admin/?page=product-new&new=1');
  await p.locator('[name="name"]').fill('New digital recovery guide');await p.locator('[data-product-type-trigger]').click();await p.locator('[data-product-type-option="digital"]').click();
  await p.locator('[data-product-category-open]').click();await p.locator('[data-product-category-level="2"]').getByRole('button',{name:'E-books',exact:true}).click();await p.getByRole('button',{name:'Use this category',exact:true}).click();
  await p.locator('[data-product-media-input]').setInputFiles({name:'cover.png',mimeType:'image/png',buffer:Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a8x8AAAAASUVORK5CYII=','base64')});
  await root(p).locator('[data-digital-pick]').setInputFiles({name:'New guide.pdf',mimeType:'application/pdf',buffer:Buffer.from('New creation bytes')});
  await root(p).getByText('File verified. Publish the product to use this file.',{exact:true}).waitFor();
  let publishedId='';f.control.afterResponse=async path=>{if(!path.startsWith('/v1/products/custom-'))return;f.control.afterResponse=null;publishedId=path.split('/').at(-1);f.control.drop=path;};
  await p.locator('.product-editor-header').getByRole('button',{name:'Create product',exact:true}).click();await p.locator('[data-product-create-error]').waitFor();
  assert(publishedId);const draftUrl=p.url(),draftId=new URL(draftUrl).searchParams.get('draft');
  const draft=JSON.parse((await f.db.prepare('SELECT snapshot_json FROM product_drafts WHERE id=?').bind(draftId).first()).snapshot_json);assert.equal(draft.digitalUpload.upload.state,'ready');
  await p.reload();await root(p).getByText('Published file retained. Replacements create a new version.',{exact:true}).waitFor();
  await p.locator('.product-editor-header').getByRole('button',{name:'Create product',exact:true}).click();await p.locator('[data-product-conflict-latest]').waitFor();assert.match(await p.locator('[data-product-conflict-latest]').getAttribute('href'),new RegExp(publishedId));
  await f.db.prepare("INSERT INTO seller_memberships(seller_id,auth_user_id,role,created_at) VALUES ('seller_alice','bob','editor','0000')").run();
  const cookie=f.app.adminCookie({supabase_access_token:await f.merchantToken('bob','bob@example.test'),admin_user:{id:'bob',email:'bob@example.test'}}),other=await pageFor(b,f,390,cookie);
  await other.goto(draftUrl);await root(other).getByText('Published file retained. Replacements create a new version.',{exact:true}).waitFor();
  await other.locator('.product-editor-header').getByRole('button',{name:'Create product',exact:true}).click();await other.locator('[data-product-conflict-latest]').waitFor();assert.match(await other.locator('[data-product-conflict-latest]').getAttribute('href'),new RegExp(publishedId));
  assert.equal((await f.db.prepare("SELECT COUNT(*) AS n FROM products WHERE title='New digital recovery guide'").first()).n,1);
});
