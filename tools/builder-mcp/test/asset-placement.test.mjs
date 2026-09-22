import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {chromium} from 'playwright';
import {Workspace} from '../workspace.mjs';
import {openAssets} from './asset-helpers.mjs';

async function fixture(t){
 const dir=await mkdtemp(join(tmpdir(),'ezkart-placement-')),ws=await new Workspace(dir).init();
 await writeFile(join(dir,'catalog.json'),JSON.stringify({products:[{id:'coffee',name:'Coffee',type:'physical',price:50000,stock:20,weightGrams:200},{id:'tea',name:'Tea',type:'physical',price:40000,stock:20,weightGrams:200}]}));
 await ws.create({id:'placement',name:'Placement'});await ws.start();
 const browser=await chromium.launch(),page=await browser.newPage({viewport:{width:1600,height:1100},reducedMotion:'reduce'}),errors=[];
 page.on('pageerror',e=>errors.push(e.message));page.setDefaultTimeout(6000);
 t.after(async()=>{await browser.close();await ws.stop();await rm(dir,{recursive:true,force:true});assert.deepEqual(errors,[]);});
 await page.goto(ws.url+'/cart/admin/?page=sites&edit=placement.ezkart.site');await page.waitForFunction(()=>globalThis.EzkartBuilder);
 const call=(method,args={})=>page.evaluate(({method,args})=>EzkartBuilder[method](args),{method,args});await call('settle');
 const choose=async type=>{
  await openAssets(page);await page.locator('[data-sq-library-category=elements]').click();
  const tile=page.locator(`[data-sq-add-element=${type==='divider'?'':'native-'}${type}]`);
  if(!await tile.isVisible())await page.locator('.sq-library-more > summary').click();await tile.click();
 };
 return {page,browser,ws,call,choose};
}

test('basic tools choose before insertion, including real icons, button styles, layouts, images and product parts',async t=>{
 const {page,call,choose}=await fixture(t);
 assert.equal(await page.locator('[data-sq-panel=add]').isVisible(),true);
 await choose('icon');assert.equal((await call('nativeInspect')).length,0);
 assert.ok(await page.locator('[data-sq-asset-choice]:visible').count()>20);
 await page.locator('[data-sq-block-search]').fill('heart');assert.equal(await page.locator('[data-sq-asset-choice]:visible').count(),1);
 await page.locator('[data-sq-asset-choice=icon-heart]').click();
 assert.equal((await call('nativeInspect')).find(node=>node.type==='icon').icon,'heart');
 await page.locator('[data-sq-block-search]').focus();await page.keyboard.press('Escape');
 assert.equal(await page.locator('[data-sq-block-search]').inputValue(),'');
 assert.equal(await page.locator('.sq-asset-choice-view').isVisible(),false);
 await page.locator('[data-sq-add-element=native-icon]').dragTo(page.locator('.sq-page-preview > [data-section-id=blank]'));
 assert.equal((await call('nativeInspect')).filter(node=>node.type==='icon').length,1,'Dragging a tool opens its choices without inserting a default');
 assert.equal(await page.locator('.sq-asset-choice-view').isVisible(),true);
 await choose('button');assert.equal((await call('nativeInspect')).filter(node=>node.type==='button').length,0);
 await page.locator('[data-sq-asset-choice=button-outline]').click();
 const button=(await call('nativeInspect')).find(node=>node.type==='button');assert.equal(button.props.borderTopStyle,'solid');assert.equal(button.props.backgroundColor,'transparent');
 await choose('container');const before=(await call('nativeInspect')).length;
 await page.locator('[data-sq-asset-choice=layout-grid]').click();assert.equal((await call('nativeInspect')).length,before+1);
 assert.equal((await call('nativeInspect')).find(node=>node.name==='Grid').props.display,'grid');
 await choose('image');const imageBefore=(await call('nativeInspect')).length;
 await page.locator('[data-sq-choice-uploads]').click();assert.equal((await call('nativeInspect')).length,imageBefore);
 assert.equal(await page.locator('[data-sq-asset-upload]').isVisible(),true);
 await choose('commerce');
 await page.locator('.sq-choice-product .sq-builder-select-trigger').click();await page.getByRole('option',{name:'Tea',exact:true}).click();
 await page.locator('[data-sq-asset-choice=commerce-price]').click();
 const price=(await call('nativeInspect')).find(node=>node.type==='commerce');assert.equal(price.productId,'tea');assert.equal(price.part,'price');
 const saved=await call('nativeInspect');await page.locator('[data-sq-undo]').click();assert.equal((await call('nativeInspect')).some(node=>node.id===price.id),false);
 await page.locator('[data-sq-redo]').click();assert.deepEqual(await call('nativeInspect'),saved);
 await call('save');await page.reload();await page.waitForFunction(()=>globalThis.EzkartBuilder);assert.deepEqual(await call('nativeInspect'),saved);
 assert.equal(await page.locator('[data-sq-panel=add]').isVisible(),true,'Assets also opens on an existing page');
});

test('chosen items land at the actual drop point in blank, nested, grid and flow sections at different zoom levels',async t=>{
 const {page,browser,call,choose}=await fixture(t);
 const drop=async(selector,target,expected)=>{
  await target.scrollIntoViewIfNeeded();await call('settle');
  const bounds=await target.boundingBox();
  await target.evaluate(node=>node.addEventListener('drop',event=>{window.lastAssetDrop={x:event.clientX,y:event.clientY};},{once:true}));
  await page.locator(selector).dragTo(target,{targetPosition:{x:bounds.width*.62,y:Math.min(bounds.height*.55,220)}});
  await call('settle');
  const node=(await call('nativeInspect')).filter(expected).at(-1);assert.ok(node,'The selected item was added');
  const rect=await page.locator(`.sq-page-preview [data-native-id="${node.id}"]`).boundingBox(),point=await page.evaluate(()=>window.lastAssetDrop);
  assert.ok(Math.abs(rect.x+rect.width/2-point.x)<3,`Horizontal drop position matches: ${JSON.stringify({rect,point})}`);
  assert.ok(Math.abs(rect.y+rect.height/2-point.y)<3,`Vertical drop position matches: ${JSON.stringify({rect,point})}`);
  if(node.type==='icon') {
   const dimensions=await page.locator(`.sq-page-preview [data-native-id="${node.id}"]`).evaluate(n=>({width:parseFloat(getComputedStyle(n).width),height:parseFloat(getComputedStyle(n).height)}));
   assert.ok(Math.abs(dimensions.width-40)<.1 && Math.abs(dimensions.height-40)<.1,'Icons retain their chosen size in each section layout');
  }
  return node;
 };
 await choose('icon');const blank=page.locator('.sq-page-preview > [data-section-id=blank]');
 const star=await drop('[data-sq-asset-choice=icon-star]',blank,node=>node.icon==='star');assert.equal(star.parent,'blank');
 await choose('button');
 await page.getByRole('slider',{name:'Canvas zoom',exact:true}).focus();await page.keyboard.press('Home');for(let i=0;i<4;i++)await page.keyboard.press('PageUp');
 const button=await drop('[data-sq-asset-choice=button-solid]',blank,node=>node.type==='button');assert.equal(button.parent,'blank');
 await page.locator('[data-sq-undo]').click();assert.equal((await call('nativeInspect')).some(n=>n.id===button.id),false);await page.locator('[data-sq-redo]').click();
 // A merchant-chosen row is a real drop target, including a scaled container.
 await choose('container');await page.locator('[data-sq-asset-choice=layout-column]').click();
 const group=(await call('nativeInspect')).find(n=>n.name==='Column');
 await call('nativeUpdate',{id:group.id,props:{transform:'scale(0.8)',transformOrigin:'top left'}});
 await choose('icon');await drop('[data-sq-asset-choice=icon-mail]',page.locator(`.sq-page-preview [data-native-id="${group.id}"]`),node=>node.icon==='mail');
 for(const preset of ['story-split','feature-showcase']){
  await openAssets(page);await page.locator('[data-sq-library-category=sections]').click();await page.locator(`[data-sq-add-block=${preset}]`).click();await call('settle');
  const target=page.locator(`.sq-page-preview > [data-sq-composition=${preset}]`);
  await choose('icon');const count=await page.locator('.sq-page-preview > [data-sq-block]').count();
  const node=await drop('[data-sq-asset-choice=icon-check]',target,n=>n.icon==='check');
  assert.equal(await target.locator(`[data-native-id="${node.id}"]`).count(),1,'The drop stays in the chosen section');
  assert.equal(await page.locator('.sq-page-preview > [data-sq-block]').count(),count,'Dropping never creates a replacement section');
 }
 await page.setViewportSize({width:941,height:1000});await choose('icon');
 await drop('[data-sq-asset-choice=icon-phone]',blank,node=>node.icon==='phone');
 await call('save');const saved=await call('nativeInspect');await page.reload();await page.waitForFunction(()=>globalThis.EzkartBuilder);await call('settle');assert.deepEqual(await call('nativeInspect'),saved);
 const html=await call('previewHtml');const preview=await browser.newPage({viewport:{width:1440,height:1000}});await preview.setContent(html);
 assert.equal(await preview.locator(`[data-native-id="${star.id}"]`).count(),1);await preview.close();
});
