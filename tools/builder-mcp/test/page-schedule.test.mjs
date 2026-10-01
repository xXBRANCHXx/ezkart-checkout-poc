import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {chromium} from 'playwright';
import {Workspace} from '../workspace.mjs';

test('merchant schedules a saved snapshot, changes/cancels time, and recovers the original request across reload', {timeout:90000},async t=>{
  const dir=await mkdtemp(join(tmpdir(),'ezkart-page-schedule-')),ws=await new Workspace(dir).init();
  await writeFile(join(dir,'catalog.json'),JSON.stringify({products:[{id:'tea',name:'Tea',status:'active',type:'physical',price:20000,stock:8,variants:[]}]}));
  await ws.create({id:'schedule',name:'Scheduled page'});await ws.start();
  const browser=await chromium.launch(),page=await browser.newPage({viewport:{width:1440,height:900},timezoneId:'Asia/Jakarta'});page.setDefaultTimeout(10000);
  const errors=[];page.on('pageerror',error=>errors.push(error.message));
  t.after(async()=>{await browser.close();await ws.stop();await rm(dir,{recursive:true,force:true});assert.deepEqual(errors,[]);});
  let lost=false,writeDespiteLoss=false,posts=[];
  await page.route('**/cart/admin/**',async route=>{
    const request=route.request(),path=new URL(request.url()).searchParams.get('cloud');
    if(path!=='/v1/landing-pages/schedule/schedule')return route.continue();
    const input=request.postDataJSON();posts.push(input);
    let saved=await ws.read('schedule');
    if(!lost || writeDespiteLoss){
      if(saved.scheduleReceipt?.requestId!==input.requestId){
        const previous=saved.scheduledPublication;
        const schedule=input.action==='cancel'?null:{id:input.requestId,at:input.at,timezone:input.timezone,status:'pending',sourceUpdatedAt:input.action==='create'?input.sourceUpdatedAt:previous.sourceUpdatedAt};
        saved={...saved,updatedAt:new Date().toISOString(),scheduledPublication:schedule,scheduleReceipt:{requestId:input.requestId,action:input.action,schedule}};await ws.write('schedule',saved);
      }
    }
    if(lost)return route.fulfill({status:503,json:{ok:false,error:'The schedule response was interrupted.'}});
    return route.fulfill({status:200,json:{ok:true,page:saved}});
  });
  const open=async()=>{await page.locator('[data-sq-schedule]').click();await page.locator('[data-sq-schedule-dialog]').waitFor();};
  const fill=async()=>page.locator('[data-schedule-time]').fill(await page.evaluate(()=>{const d=new Date(Date.now()+7200000);return new Date(d.getTime()-d.getTimezoneOffset()*60000).toISOString().slice(0,16);}));
  const url=ws.url+'/cart/admin/?page=sites&edit=schedule.ezkart.site';
  await page.goto(url);await page.waitForFunction(()=>globalThis.EzkartBuilder);
  await page.evaluate(async()=>{await EzkartBuilder.nativeInsert({section:'blank',node:{id:'buy',type:'commerce',part:'add',productId:'tea'}});await EzkartBuilder.save();});
  await open();assert.equal(await page.locator('[data-schedule-zone]').textContent(),'Asia/Jakarta');
  await fill();await page.locator('[data-schedule-create]').click();await page.waitForFunction(()=>document.querySelector('[data-schedule-summary]').textContent.includes('Asia/Jakarta'));
  assert.ok(posts[0].html.includes('data-commerce-add'));assert.equal((await ws.read('schedule')).status,'draft');
  const firstVersion=(await ws.read('schedule')).scheduledPublication.sourceUpdatedAt;
  await fill();await page.locator('[data-schedule-move]').click();await page.waitForFunction(()=>!document.querySelector('[data-schedule-create]').disabled && document.querySelector('[data-schedule-message]').textContent==='Publication scheduled');
  assert.equal((await ws.read('schedule')).scheduledPublication.sourceUpdatedAt,firstVersion);
  for(const width of [1440,390,320]){
    await page.setViewportSize({width,height:844});assert.equal(await page.locator('[data-sq-schedule-dialog]').evaluate(node=>node.scrollWidth<=node.clientWidth),true);
    await page.screenshot({path:`/tmp/ezkart-page-schedule-${width}.png`});
  }
  await page.locator('[data-schedule-cancel]').click();await page.waitForFunction(()=>document.querySelector('[data-schedule-message]').textContent==='Schedule cancelled');assert.equal((await ws.read('schedule')).scheduledPublication,null);
  lost=true;await fill();await page.locator('[data-schedule-create]').click();await page.locator('[data-schedule-retry]').waitFor({state:'visible'});
  const original=posts.at(-1);assert.equal(await page.locator('[data-schedule-create]').isDisabled(),true);
  await page.reload();await page.waitForFunction(()=>globalThis.EzkartBuilder);await open();assert.equal(await page.locator('[data-schedule-retry]').isVisible(),true);
  lost=false;await page.locator('[data-schedule-retry]').click();await page.waitForFunction(()=>document.querySelector('[data-schedule-retry]').hidden);
  assert.deepEqual(posts.at(-1),original);assert.equal((await ws.read('schedule')).scheduledPublication.id,original.requestId);
  // Lost response after durable storage needs only a read confirmation.
  const before=posts.length;lost=true;writeDespiteLoss=true;await fill();await page.locator('[data-schedule-create]').click();await page.waitForFunction(()=>!document.querySelector('[data-schedule-create]').disabled && document.querySelector('[data-schedule-message]').textContent==='Publication scheduled');assert.equal(posts.length,before+1);assert.equal(await page.locator('[data-schedule-retry]').isVisible(),false);
  await page.keyboard.press('Escape');assert.equal(await page.locator('[data-sq-schedule-dialog]').isVisible(),false);
  const recoveryKey=await page.evaluate(()=>`ezkart-page-schedule:${document.body.dataset.adminStorageScope || 'account'}:schedule`);
  await page.evaluate(key=>sessionStorage.setItem(key,'{broken'),recoveryKey);await open();
  assert.equal(await page.locator('[data-schedule-create]').isDisabled(),true);assert.match(await page.locator('[data-schedule-message]').textContent(),/could not be read/);
  await page.keyboard.press('Escape');await page.evaluate(key=>sessionStorage.removeItem(key),recoveryKey);await open();
  const countBeforeStorageFailure=posts.length;
  await page.evaluate(()=>{Storage.prototype.setItem=()=>{throw Error('Storage unavailable');};});
  await page.locator('[data-schedule-create]').click();await page.waitForFunction(()=>document.querySelector('[data-schedule-message]').textContent.includes('No new schedule was sent'));
  assert.equal(posts.length,countBeforeStorageFailure);

});
