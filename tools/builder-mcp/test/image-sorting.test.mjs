import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {chromium} from 'playwright';
import {Workspace,repoRoot} from '../workspace.mjs';

const artifacts='/tmp/ezkart-image-sorting-review';
async function fixture(t,{touch=false,count=4}={}){
  const dir=await mkdtemp(join(tmpdir(),'ezkart-image-sorting-')),ws=await new Workspace(dir).init();await ws.start();
  const browser=await chromium.launch(),page=await browser.newPage({viewport:{width:touch?390:1440,height:touch?844:1000},hasTouch:touch,isMobile:touch});
  page.setDefaultTimeout(10000);const errors=[];page.on('pageerror',error=>errors.push(error.message));
  t.after(async()=>{await browser.close();await ws.stop();await rm(dir,{recursive:true,force:true});assert.deepEqual(errors,[]);});
  await mkdir(artifacts,{recursive:true});
  await page.goto(ws.url+'/cart/admin/?page=sites');await page.locator('[data-library-create-card]').click();await page.locator('[data-bc-choose=image]').click();
  await page.locator('[data-library-page-form] [name=page_name]').fill('Image sorting');await page.locator('[data-library-page-form] button[value=default]').click();
  await page.waitForURL('**edit=image-sorting.ezkart.site');await page.locator('[data-image-page-upload]').setInputFiles(Array.from({length:count},(_,i)=>join(repoRoot,`cart/admin/assets/builder-choice/kopi-senja-0${i%4+1}.webp`)));
  await page.waitForFunction(count=>document.querySelectorAll('[data-image-row]').length===count&&!document.querySelector('.ib-controls').disabled,count);
  const ids=()=>page.locator('[data-image-row]').evaluateAll(nodes=>nodes.map(node=>node.dataset.imageRow));
  const savedIds=()=>page.locator('[data-image-upload]').evaluateAll(nodes=>nodes.map(node=>node.dataset.nativeId));
  const settle=()=>page.waitForFunction(()=>[...document.querySelectorAll('[data-image-row]')].every(node=>!node.style.transform));
  async function start(index){const handle=page.locator('[data-image-drag]').nth(index);await handle.scrollIntoViewIfNeeded();const box=await handle.boundingBox();const x=box.x+box.width/2,y=box.y+box.height/2;await page.mouse.move(x,y);await page.mouse.down();await page.mouse.move(x+8,y+8);return {x,y};}
  async function target(index){const box=await page.locator('[data-image-row]').nth(index).boundingBox();return {x:box.x+box.width/2,y:box.y+box.height/2+12};}
  return {page,ids,savedIds,settle,start,target};
}

test('image cards sort with a compact pointer preview, animated dotted slot, one undo step and saved order',async t=>{
  const {page,ids,savedIds,settle,start,target}=await fixture(t),original=await ids();
  await page.locator('.ib-controls').screenshot({path:join(artifacts,'desktop-cards.png')});
  assert.equal(await page.locator('[data-image-drag] circle').count(),24);
  assert.equal(await page.locator('.ib-row-actions').count(),0);
  assert.equal(await page.locator('[data-image-remove]').first().evaluate(node=>getComputedStyle(node).borderWidth),'0px');
  const thumbnail=page.locator('[data-image-replace]').first();await thumbnail.hover();
  await page.waitForFunction(()=>getComputedStyle(document.querySelector('.ib-thumbnail span')).opacity==='1');
  await thumbnail.screenshot({path:join(artifacts,'replace-hover.png')});
  const chooser=page.waitForEvent('filechooser');await thumbnail.click();assert.equal((await chooser).isMultiple(),false);await (await chooser).setFiles([]);
  await start(0);const destination=await target(2);await page.mouse.move(destination.x,destination.y,{steps:10});
  assert.deepEqual(await ids(),[original[1],original[2],original[0],original[3]]);
  assert.deepEqual(await savedIds(),original,'Previewing the drop does not mutate the saved page');
  assert.equal(await page.locator('.ib-drop-slot').count(),1);
  const preview=await page.locator('.ib-drag-preview').boundingBox();assert.ok(preview.width<=220&&preview.height<100);
  const moving=await page.locator('[data-image-row]').evaluateAll(nodes=>nodes.some(node=>node.style.transform));assert.ok(moving,'Neighboring cards animate to their new positions');
  await page.screenshot({path:join(artifacts,'desktop-dragging.png')});await page.mouse.up();await settle();
  assert.equal(await page.locator('.ib-drag-preview').count(),0);assert.equal(await page.locator('.ib-drop-slot').count(),0);
  assert.deepEqual(await savedIds(),[original[1],original[2],original[0],original[3]]);
  await page.locator('[data-sq-undo]').click();assert.deepEqual(await ids(),original);
  await page.locator('[data-sq-redo]').click();const reordered=await ids();
  await start(2);const first=await target(0);await page.mouse.move(first.x,first.y-24,{steps:8});await page.keyboard.press('Escape');await page.mouse.up();await settle();
  assert.deepEqual(await ids(),reordered,'Escape restores the starting order');
  await start(0);await page.mouse.move(1300,300,{steps:6});await page.mouse.up();await settle();assert.deepEqual(await ids(),reordered,'Dropping outside the list cancels');
  await page.locator('[data-image-drag]').nth(2).focus();await page.keyboard.press('Space');await page.keyboard.press('Home');await page.keyboard.press('Enter');await settle();
  assert.deepEqual(await ids(),original);assert.equal(await page.locator('[data-image-drag]').first().evaluate(node=>node===document.activeElement),true);
  await page.emulateMedia({reducedMotion:'reduce'});
  await page.keyboard.press('Space');await page.keyboard.press('End');await page.keyboard.press('Space');
  assert.deepEqual(await ids(),[...original.slice(1),original[0]]);
  assert.equal(await page.locator('[data-image-row]').evaluateAll(nodes=>nodes.some(node=>node.style.transform)),false);
  await page.evaluate(()=>EzkartBuilder.save());await page.reload();await page.locator('[data-image-drag]').first().waitFor();
  assert.deepEqual(await ids(),[...original.slice(1),original[0]]);
});

test('touch sorting works at narrow widths and cancels cleanly when the pointer is interrupted',async t=>{
  const {page,ids,savedIds,settle,target}=await fixture(t,{touch:true}),original=await ids(),cdp=await page.context().newCDPSession(page);
  await page.locator('[data-image-drag]').first().scrollIntoViewIfNeeded();
  const handle=await page.locator('[data-image-drag]').first().boundingBox(),x=handle.x+handle.width/2,y=handle.y+handle.height/2;
  const touch=(type,x,y)=>cdp.send('Input.dispatchTouchEvent',{type,touchPoints:type==='touchEnd'||type==='touchCancel'?[]:[{x,y,id:1}]});
  assert.ok(handle.width>=44&&handle.height>=44);
  await touch('touchStart',x,y);await touch('touchMove',x+8,y+8);const destination=await target(2);await touch('touchMove',destination.x,destination.y);
  await page.locator('.ib-drag-preview').waitFor();await page.screenshot({path:join(artifacts,'touch-dragging.png')});await touch('touchEnd');await settle();
  assert.deepEqual(await savedIds(),[original[1],original[2],original[0],original[3]]);
  const current=await ids(),next=await page.locator('[data-image-drag]').first().boundingBox();await touch('touchStart',next.x+22,next.y+22);await touch('touchMove',next.x+30,next.y+40);await touch('touchCancel');await settle();
  assert.deepEqual(await ids(),current);assert.equal(await page.locator('.ib-drag-preview').count(),0);
  for(const width of [320,390,941]){await page.setViewportSize({width,height:844});assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);}
  await page.setViewportSize({width:390,height:844});await page.screenshot({path:join(artifacts,'mobile-cards.png')});
});

test('dragging near the viewport edge scrolls through a long image list without saving intermediate positions',async t=>{
  const {page,ids,savedIds,settle,start}=await fixture(t,{count:10}),original=await ids();
  await page.setViewportSize({width:941,height:650});const point=await start(0);
  await page.mouse.move(point.x,630,{steps:12});
  await page.waitForFunction(first=>[...document.querySelectorAll('[data-image-row]')].findIndex(node=>node.dataset.imageRow===first)>=5,original[0]);
  assert.deepEqual(await savedIds(),original);
  await page.mouse.up();await settle();assert.ok((await ids()).indexOf(original[0])>=5);
  await page.locator('[data-sq-undo]').click();assert.deepEqual(await ids(),original);
});
