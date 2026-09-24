import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp, writeFile, rm, mkdir} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {chromium} from 'playwright';
import {Workspace} from '../workspace.mjs';

test('Publishing stays visible until acknowledgement, guards closing, and recovers from a failed upload', async t => {
  const dir=await mkdtemp(join(tmpdir(),'ezkart-publishing-'));
  const ws=await new Workspace(dir).init();
  await writeFile(join(dir,'catalog.json'),JSON.stringify({products:[{id:'coffee',name:'Coffee',type:'physical',status:'active',price:79000,stock:5,variants:[]}]}));
  await ws.create({id:'coffee',name:'Coffee launch'});
  await ws.start();
  const browser=await chromium.launch();
  const page=await browser.newPage({viewport:{width:1440,height:1000},reducedMotion:'reduce'});
  page.setDefaultTimeout(10000);
  t.after(async()=>{await browser.close();await ws.stop();await rm(dir,{recursive:true,force:true});});
  const errors=[];page.on('pageerror',error=>errors.push(error.message));
  await page.goto(ws.url+'/cart/admin/?page=sites&edit=coffee.ezkart.site');
  await page.waitForFunction(()=>window.EzkartBuilder);
  await page.evaluate(async()=>{
    await EzkartBuilder.nativeInsert({section:'blank',node:{id:'buy',type:'commerce',part:'add',productId:'coffee'}});
    await EzkartBuilder.save();
  });
  const progress=page.locator('[data-sq-publishing-dialog]');
  const confirmation=page.locator('[data-sq-published-dialog]');
  const publish=page.locator('[data-sq-publish]');
  const closingIsGuarded=()=>page.evaluate(()=>!window.dispatchEvent(new Event('beforeunload',{cancelable:true})));
  let releaseCatalog;
  const catalogGate=new Promise(resolve=>{releaseCatalog=resolve;});
  let releaseUpload, uploadStarted, uploads=0;
  const firstUploadStarted=new Promise(resolve=>{uploadStarted=resolve;});
  let uploadGate=new Promise(resolve=>{releaseUpload=resolve;});
  let failUpload=true, holdCatalog=true;
  await page.route('**/cart/admin/**',async route=>{
    const request=route.request(), cloud=new URL(request.url()).searchParams.get('cloud');
    if(cloud==='/v1/catalog' && holdCatalog){holdCatalog=false;await catalogGate;}
    if(cloud==='/v1/landing-pages/coffee' && request.method()==='PUT' && request.postDataJSON().status==='published'){
      uploads++;uploadStarted();await uploadGate;
      if(failUpload){await route.fulfill({status:503,contentType:'application/json',body:JSON.stringify({ok:false,error:'The server could not save your page. Please try again.'})});return;}
    }
    await route.continue();
  });
  await publish.click();
  await progress.getByRole('heading',{name:'Preparing to publish…'}).waitFor();
  assert.equal(await closingIsGuarded(),true);
  await page.keyboard.press('Escape');
  assert.equal(await progress.isVisible(),true);
  releaseCatalog();
  await page.locator('[data-sq-favicon-dialog]').waitFor({state:'visible'});
  assert.equal(await progress.isVisible(),false);
  assert.equal(await closingIsGuarded(),false,'No publication has started while the merchant chooses a favicon');
  await page.locator('[data-favicon-publish]').click();
  await firstUploadStarted;
  await progress.getByRole('heading',{name:'Publishing your page…'}).waitFor();
  assert.equal(await publish.isDisabled(),true);
  assert.equal(await confirmation.isVisible(),false);
  assert.equal((await ws.read('coffee')).status,'draft');
  assert.equal(await closingIsGuarded(),true);
  await page.keyboard.press('Escape');
  assert.equal(await progress.isVisible(),true);
  const leaving=page.waitForEvent('dialog');
  const navigation=page.reload().catch(()=>{});
  const warning=await leaving;
  assert.equal(warning.type(),'beforeunload');
  await warning.dismiss();await navigation;
  assert.equal(await progress.isVisible(),true,'Declining the close warning keeps publishing visible');
  await mkdir('/tmp/ezkart-publishing-review',{recursive:true});
  for(const width of [1440,390,320]){
    await page.setViewportSize({width,height:900});
    assert.equal(await progress.evaluate(node=>node.scrollWidth<=node.clientWidth),true);
    await page.screenshot({path:`/tmp/ezkart-publishing-review/publishing-${width}.png`});
  }
  await page.evaluate(()=>document.querySelector('[data-sq-publish]').click());
  assert.equal(uploads,1,'Repeated Publish clicks cannot start another upload');
  releaseUpload();
  await progress.getByRole('heading',{name:'Publishing wasn’t completed'}).waitFor();
  assert.match(await progress.locator('[data-publishing-error]').innerText(),/server could not save/);
  assert.equal(await progress.locator('[data-publishing-spinner]').isVisible(),false);
  assert.equal(await closingIsGuarded(),false);
  assert.equal(await confirmation.isVisible(),false);
  assert.equal((await ws.read('coffee')).status,'draft');
  await page.screenshot({path:'/tmp/ezkart-publishing-review/failure-320.png'});
  await progress.getByRole('button',{name:'Back to editor'}).click();
  failUpload=false;
  uploadGate=new Promise(resolve=>{releaseUpload=resolve;});
  const secondUploadStarted=new Promise(resolve=>{uploadStarted=resolve;});
  await publish.click();
  await page.locator('[data-favicon-publish]').click();
  await secondUploadStarted;
  assert.equal(await progress.isVisible(),true);
  assert.equal(await closingIsGuarded(),true);
  assert.equal(await confirmation.isVisible(),false);
  releaseUpload();
  await confirmation.waitFor({state:'visible'});
  assert.match(await confirmation.innerText(),/It’s safe to close this tab/);
  assert.equal(await closingIsGuarded(),false,'The close guard is removed only after the request finishes');
  assert.equal(await progress.isVisible(),false);
  assert.equal((await ws.read('coffee')).status,'published');
  const publicUrl=await confirmation.locator('[data-published-url]').getAttribute('href');
  await page.close();
  assert.equal((await fetch(publicUrl)).status,200,'Closing after confirmation preserves the publication');
  assert.equal(uploads,2);
  assert.deepEqual(errors,[]);
});
