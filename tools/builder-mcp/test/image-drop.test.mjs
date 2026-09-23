import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm,writeFile,mkdir} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {chromium} from 'playwright';
import {Workspace,repoRoot} from '../workspace.mjs';

async function fixture(t){
  const dir=await mkdtemp(join(tmpdir(),'ezkart-image-drop-')),ws=await new Workspace(dir).init();await ws.create({id:'drop',name:'Image drops'});await ws.start();
  const browser=await chromium.launch(),page=await browser.newPage({viewport:{width:1600,height:1000},reducedMotion:'reduce'}),cdp=await page.context().newCDPSession(page),errors=[];
  page.setDefaultTimeout(8000);page.on('pageerror',error=>errors.push(error.message));
  t.after(async()=>{await browser.close();await ws.stop();await rm(dir,{recursive:true,force:true});assert.deepEqual(errors,[]);});
  await page.goto(ws.url+'/cart/admin/?page=sites&edit=drop.ezkart.site');await page.waitForFunction(()=>globalThis.EzkartBuilder);
  const call=(method,args={})=>page.evaluate(({method,args})=>EzkartBuilder[method](args),{method,args});await call('settle');
  if(await page.locator('[data-sq-panel=add]').isVisible())await page.locator('[data-sq-tab=add]').click();
  const photos=()=>call('nativeInspect').then(nodes=>nodes.filter(node=>node.type==='image'));
  const photo=join(repoRoot,'cart/admin/assets/products/kopi-susu.webp');
  const portrait=join(dir,'portrait.png');await writeFile(portrait,Buffer.from(await page.evaluate(()=>{const canvas=document.createElement('canvas');canvas.width=400;canvas.height=600;const ctx=canvas.getContext('2d');ctx.fillStyle='#e6ac79';ctx.fillRect(0,0,400,600);return canvas.toDataURL().split(',')[1];}),'base64'));
  const drop=async(target,files,{x=.55,y=.5,commit=true}={})=>{
    await target.scrollIntoViewIfNeeded();await call('settle');const box=await target.boundingBox(),point={x:box.x+box.width*x,y:box.y+Math.min(box.height*y,180)};
    const data={items:[],files,dragOperationsMask:1};
    await cdp.send('Input.dispatchDragEvent',{type:'dragEnter',...point,data});await cdp.send('Input.dispatchDragEvent',{type:'dragOver',...point,data});
    if(commit)await cdp.send('Input.dispatchDragEvent',{type:'drop',...point,data});
    return point;
  };
  return {page,ws,call,photos,photo,portrait,drop,dir,cdp,browser};
}

async function resizePastPage(page, call, node, width) {
  await node.scrollIntoViewIfNeeded();
  await node.click();
  await call('settle');
  await page.locator('[data-sq-element-resize]').scrollIntoViewIfNeeded();
  const start = await node.boundingBox(), cssWidth = await node.evaluate(n => n.offsetWidth);
  const grip = await page.locator('[data-sq-element-resize]').boundingBox();
  const x = grip.x + grip.width / 2, y = grip.y + grip.height / 2;
  const hit = await page.evaluate(({x,y}) => document.elementFromPoint(x,y)?.outerHTML.slice(0,200), {x,y});
  if (!hit?.includes('data-sq-element-resize')) await page.screenshot({path:'/tmp/ezkart-image-drop/resize-hit.png'});
  assert.ok(hit?.includes('data-sq-element-resize'), `Resize handle is reachable at ${x}, ${y}: ${hit}`);
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x + (width - cssWidth) * start.width / cssWidth, y + 10, {steps: 12});
  const during = await node.evaluate(n => ({id: n.id, width: n.offsetWidth, style: n.getAttribute('style'), flow: n.getAttribute('data-flow-mobile'), classes: n.className}));
  assert.ok(during.width > await page.locator('.sq-page-preview').evaluate(n => n.offsetWidth), `The element grows beyond the page during the drag: ${JSON.stringify(during)}`);
  await page.mouse.up();
  await call('settle');
}

test('an imported image can extend beyond the mobile page, with history, responsive layouts and saved export intact', async t => {
  const {page, call, photos, portrait, drop, browser} = await fixture(t);
  await drop(page.locator('.sq-page-preview > [data-section-id=blank]'), [portrait]);
  await page.waitForFunction(() => EzkartBuilder.nativeInspect().some(n => n.type === 'image'));
  await call('settle');
  const id = (await photos())[0].id, node = page.locator(`[data-native-id="${id}"]`);
  const desktopWidth = await node.evaluate(n => n.offsetWidth);
  await page.locator('[data-sq-device=mobile]').click();
  await call('settle');
  const before = (await photos())[0];
  await node.click(); await call('settle');
  const widthInput = page.locator('[data-sq-native-inspector] [data-style-number=width]');
  for (const group of await widthInput.locator('xpath=ancestor::details').all()) {
    if (await group.getAttribute('open') === null) await group.locator(':scope > summary').click();
  }
  await widthInput.fill('520'); await widthInput.press('Tab'); await call('settle');
  assert.equal(await node.evaluate(n => n.offsetWidth), 520, 'Entering a width overrides the initial automatic fit');
  await call('undo'); assert.deepEqual((await photos())[0], before);
  await resizePastPage(page, call, node, 510);
  const resized = (await photos())[0], mobileWidth = await node.evaluate(n => n.offsetWidth);
  assert.ok(mobileWidth > 390);
  assert.equal(await node.evaluate(n => getComputedStyle(n).maxWidth), 'none');
  assert.ok(await node.evaluate(n => Math.abs(n.offsetWidth / n.offsetHeight - n.naturalWidth / n.naturalHeight) < .02), 'Resizing a naturally sized image preserves its proportions');
  const visibleOutside = await node.evaluate(n => {
    const r = n.getBoundingClientRect(), page = n.closest('.sq-page-preview').getBoundingClientRect();
    return document.elementFromPoint(Math.min(r.right - 5, page.right + 15), r.top + 30) === n;
  });
  assert.ok(visibleOutside, 'The image remains reachable outside the page edge in the editor');
  await mkdir('/tmp/ezkart-image-drop', {recursive: true});
  await page.screenshot({path: '/tmp/ezkart-image-drop/oversized-mobile.png'});
  await call('undo'); assert.deepEqual((await photos())[0], before);
  await call('redo'); assert.deepEqual((await photos())[0], resized);
  await page.locator('[data-sq-device=desktop]').click(); await call('settle');
  assert.equal(await node.evaluate(n => n.offsetWidth), desktopWidth, 'Mobile resizing leaves desktop unchanged');
  await call('save'); await page.reload(); await page.waitForFunction(() => globalThis.EzkartBuilder); await call('settle');
  await page.locator('[data-sq-device=mobile]').click(); await call('settle');
  assert.equal(await node.evaluate(n => n.offsetWidth), mobileWidth);
  await node.click(); await call('settle');
  const input = page.locator('[data-sq-native-inspector] [data-style-number=width]');
  for (const group of await input.locator('xpath=ancestor::details').all()) {
    if (await group.getAttribute('open') === null) await group.locator(':scope > summary').click();
  }
  await input.fill('560'); await input.press('Tab'); await call('settle');
  assert.equal(await node.evaluate(n => n.offsetWidth), 560, 'The width field also accepts a size beyond the page');
  const exported = await browser.newPage({viewport: {width: 390, height: 900}});
  await exported.setContent(await call('previewHtml'));
  const published = exported.locator(`[data-native-id="${id}"]`);
  await published.evaluate(n => n.decode());
  assert.equal(await published.evaluate(n => n.offsetWidth), 560);
  await exported.setViewportSize({width: 1440, height: 900});
  assert.equal(await published.evaluate(n => n.offsetWidth), desktopWidth);
  await exported.close();
});

test('older grid and flow elements can be resized past the page with snapping enabled and survive export', async t => {
  const {page, call, browser} = await fixture(t);
  await call('addElement', {section: 'blank', type: 'image', id: 'legacy-image'});
  await call('updateElement', {id: 'legacy-image', layout: {x: 1, y: 2, width: 3, height: 3}});
  await call('addSection', {component: 'feature-showcase', id: 'feature'});
  await page.locator('[data-sq-device=mobile]').click(); await call('settle');
  const grid = page.locator('[data-sq-element-id=legacy-image]'), flow = page.locator('#feature > .ezm-section-copy');
  assert.equal(await page.locator('[data-sq-snap-to-grid]').isChecked(), true);
  const widths = [];
  for (const node of [grid, flow]) {
    await resizePastPage(page, call, node, 510);
    const width = await node.evaluate(n => n.offsetWidth); widths.push(width);
    assert.ok(width > 390);
    assert.ok(JSON.parse(await node.getAttribute('data-flow-mobile')).width > 390);
  }
  await call('save'); await page.reload(); await page.waitForFunction(() => globalThis.EzkartBuilder); await call('settle');
  await page.locator('[data-sq-device=mobile]').click(); await call('settle');
  for (const [index, node] of [grid, flow].entries()) assert.equal(await node.evaluate(n => n.offsetWidth), widths[index]);
  const exported = await browser.newPage({viewport: {width: 390, height: 900}});
  await exported.setContent(await call('previewHtml'));
  for (const [index, selector] of ['[data-ezkart-element=legacy-image]', '#feature > .ezm-section-copy'].entries()) {
    assert.equal(await exported.locator(selector).evaluate(n => n.offsetWidth), widths[index]);
  }
  await exported.close();
});

test('desktop file drops place editable images at the pointer, retain proportions, history, uploads and standalone previews',async t=>{
  const {page,call,photos,photo,portrait,drop,browser}=await fixture(t),blank=page.locator('.sq-page-preview > [data-section-id=blank]');
  const initialUrl=page.url();
  await drop(blank,[photo],{commit:false});assert.equal(await page.locator('.sq-canvas-image-drop').isVisible(),true);
  assert.equal((await photos()).length,0,'Drag-over never inserts or reorders content');
  await mkdir('/tmp/ezkart-image-drop',{recursive:true});await page.screenshot({path:'/tmp/ezkart-image-drop/drop-target.png'});
  const point=await drop(blank,[photo]);await page.waitForFunction(()=>EzkartBuilder.nativeInspect().filter(n=>n.type==='image').length===1);await call('settle');
  assert.equal(page.url(),initialUrl,'Dropping a file does not navigate away');assert.equal(await page.locator('.sq-canvas-image-drop').isVisible(),false);
  const added=(await photos())[0],node=page.locator(`[data-native-id="${added.id}"]`),bounds=await node.boundingBox();
  assert.match(added.src,/^data:image\//);assert.ok(Math.abs(bounds.x+bounds.width/2-point.x)<3);assert.ok(Math.abs(bounds.y+bounds.height/2-point.y)<3,'The loaded image stays centered on the drop point');
  assert.ok(await node.evaluate(n=>Math.abs(n.offsetWidth/n.offsetHeight-n.naturalWidth/n.naturalHeight)<.02),'Original proportions are preserved');
  await page.screenshot({path:'/tmp/ezkart-image-drop/placed.png'});
  await page.locator('[data-sq-undo]').click();assert.equal((await photos()).length,0);await page.locator('[data-sq-redo]').click();assert.equal((await photos()).length,1);
  await node.click();const move=page.locator('[data-sq-element-move]').first();await move.waitFor();const grip=await move.boundingBox();await page.mouse.move(grip.x+grip.width/2,grip.y+grip.height/2);await page.mouse.down();await page.mouse.move(grip.x+grip.width/2+50,grip.y+grip.height/2+40,{steps:12});await page.mouse.up();await call('settle');
  assert.notDeepEqual((await photos())[0].props,added.props,'The dropped image can be moved with the existing handle');
  const beforeResize=await node.boundingBox(),resize=await page.locator('[data-sq-element-resize]').first().boundingBox();await page.mouse.move(resize.x+resize.width/2,resize.y+resize.height/2);await page.mouse.down();await page.mouse.move(resize.x+resize.width/2+45,resize.y+resize.height/2+30,{steps:12});await page.mouse.up();await call('settle');assert.ok((await node.boundingBox()).width>beforeResize.width,'The dropped image can be resized');
  await drop(blank,[photo,portrait]);await page.waitForFunction(()=>EzkartBuilder.nativeInspect().filter(n=>n.type==='image').length===3);await call('settle');
  const list=await photos();assert.equal(new Set(list.map(n=>n.id)).size,3);const second=await page.locator(`[data-native-id="${list[1].id}"]`).boundingBox(),third=await page.locator(`[data-native-id="${list[2].id}"]`).boundingBox();assert.ok(Math.abs(second.x+second.width/2-third.x-third.width/2)>3,'Multiple images use separate placements');
  await page.locator('[data-sq-tab=add]').click();await page.locator('[data-sq-library-category=uploads]').click();await page.waitForFunction(()=>document.querySelectorAll('[data-sq-upload-asset]').length===3);assert.equal(await page.locator('[data-sq-upload-asset]').count(),3);
  await call('save');await page.reload();await page.waitForFunction(()=>globalThis.EzkartBuilder);await call('settle');assert.deepEqual(await photos(),list);
  const html=await call('previewHtml');assert.ok(!html.includes('sq-canvas-image-drop'));assert.ok(!html.includes('sq-canvas-upload-status'));
  const exported=await browser.newPage();await exported.setContent(html);await exported.locator(`[data-native-id="${added.id}"]`).evaluate(n=>n.decode());assert.ok(await exported.locator(`[data-native-id="${added.id}"]`).evaluate(n=>n.naturalWidth>0));await exported.close();
  for(const width of [941,390]){
    await page.setViewportSize({width,height:1000});if(await page.locator('[data-sq-panel=add]').isVisible())await page.locator('[data-sq-tab=add]').click();const before=(await photos()).length;await drop(blank,[photo]);await page.waitForFunction(count=>EzkartBuilder.nativeInspect().filter(n=>n.type==='image').length===count,before+1);await call('settle');const status=await page.locator('.sq-canvas-upload-status').boundingBox();assert.ok(status.x>=0&&status.x+status.width<=width,'Upload feedback fits narrow editors');await page.screenshot({path:`/tmp/ezkart-image-drop/placed-${width}.png`});
  }
});

test('file drops preserve the chosen section and scaled group, including a slower upload while the editor changes',async t=>{
  const {page,call,photos,photo,drop}=await fixture(t);
  await call('nativeInsert',{section:'blank',node:{id:'drop-group',type:'container',name:'Photo group',props:{width:'600px',minHeight:'380px',transform:'scale(.8)',transformOrigin:'top left',backgroundColor:'#f6e6d5'}}});await call('settle');
  const group=page.locator('[data-native-id=drop-group]'),point=await drop(group,[photo]);await page.waitForFunction(()=>EzkartBuilder.nativeInspect().some(n=>n.type==='image'));await call('settle');
  const image=(await photos())[0];assert.equal(image.parent,'drop-group');const rect=await page.locator(`[data-native-id="${image.id}"]`).boundingBox();assert.ok(Math.abs(rect.x+rect.width/2-point.x)<3);assert.ok(Math.abs(rect.y+rect.height/2-point.y)<3);
  await call('addSection',{component:'story-split',id:'story'});const story=page.locator('.sq-page-preview > [data-section-id=story]');const count=await page.locator('.sq-page-preview > [data-sq-block]').count();const before=(await photos()).length;await drop(story,[photo]);await page.waitForFunction(count=>EzkartBuilder.nativeInspect().filter(n=>n.type==='image').length===count,before+1);assert.equal(await page.locator('.sq-page-preview > [data-sq-block]').count(),count);assert.equal(await story.locator('[data-native-type=image]').count(),1,'A drop stays in an existing flow section');
  let release,started;const gate=new Promise(resolve=>release=resolve),reached=new Promise(resolve=>started=resolve);const route='**/*cloud=%2Fv1%2Fassets';
  await page.route(route,async route=>{if(route.request().method()==='POST'){started();await gate;}await route.continue();});
  const saved=await photos();await drop(group,[photo]);await reached;await call('undo');release();await page.locator('.sq-canvas-upload-status.is-error').waitFor();assert.match(await page.locator('.sq-canvas-upload-status').innerText(),/Saved in Uploads.*destination changed/);assert.equal((await photos()).length,saved.length-1,'The upload cannot place an image into a stale page after undo');await page.unroute(route);
});

test('invalid and failed file drops leave the page intact and can be retried; outside drops and canceled drags do not navigate',async t=>{
  const {page,call,photos,photo,portrait,drop,dir,cdp}=await fixture(t),blank=page.locator('.sq-page-preview > [data-section-id=blank]'),status=page.locator('.sq-canvas-upload-status');
  const text=join(dir,'document.txt'),invalid=join(dir,'broken.png'),large=join(dir,'large.png');await writeFile(text,'not an image');await writeFile(invalid,'not an image');await writeFile(large,Buffer.alloc(8*1024*1024+1));
  for(const [file,message] of [[text,/Choose a PNG/],[invalid,/could not be opened/],[large,/smaller than 8 MB/]]){await drop(blank,[file]);await status.locator('span').filter({hasText:message}).waitFor();assert.equal((await photos()).length,0);assert.equal(await page.locator('.sq-canvas-image-drop').isVisible(),false);}
  const route='**/*cloud=%2Fv1%2Fassets';await page.route(route,r=>r.request().method()==='POST'?r.fulfill({status:503,json:{ok:false,error:'Upload unavailable. Try again.'}}):r.continue());await drop(blank,[photo]);await status.locator('span').filter({hasText:'Upload unavailable'}).waitFor();assert.equal((await photos()).length,0);await page.unroute(route);
  await drop(blank,[text,portrait]);await page.waitForFunction(()=>EzkartBuilder.nativeInspect().filter(n=>n.type==='image').length===1);await status.locator('span').filter({hasText:/1 image added.*document.txt/}).waitFor();
  await drop(blank,[photo],{commit:false});await cdp.send('Input.dispatchDragEvent',{type:'dragCancel',x:0,y:0,data:{items:[],files:[photo],dragOperationsMask:1}});await page.waitForFunction(()=>document.querySelector('.sq-canvas-image-drop').hidden);
  const url=page.url(),data={items:[],files:[photo],dragOperationsMask:1};await cdp.send('Input.dispatchDragEvent',{type:'dragEnter',x:10,y:10,data});await cdp.send('Input.dispatchDragEvent',{type:'dragOver',x:10,y:10,data});await cdp.send('Input.dispatchDragEvent',{type:'drop',x:10,y:10,data});assert.equal(page.url(),url);await status.locator('span').filter({hasText:'Drop images onto your page or into Uploads.'}).waitFor();assert.equal((await photos()).length,1);
  await call('save');
});
