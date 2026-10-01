import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {chromium} from 'playwright';
import {Workspace} from '../workspace.mjs';
import {openAssets,chooseBasic} from './asset-helpers.mjs';

test('merchant copies accurate AI instructions from both code fields; fallback and documented cart examples work',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'ezkart-code-instructions-'));
 const products=[{id:'coffee',name:'Coffee',status:'active',type:'physical',currency:'IDR',price:79000,stock:8,sku:'PRIVATE-SKU',variants:[{id:'small',name:'Small',price:79000,stock:8},{id:'hidden',name:'Private variant',hidden:true,price:1,stock:8}]},{id:'inactive',status:'archived',name:'Archived',price:1,stock:1}];
 await writeFile(join(dir,'catalog.json'),JSON.stringify({products,demoCheckout:true}));
 const ws=await new Workspace(dir).init();await ws.create({id:'code',name:'Code instructions',productIds:['coffee']});await ws.start();
 const browser=await chromium.launch();const page=await browser.newPage({viewport:{width:1440,height:1000},reducedMotion:'reduce'});page.setDefaultTimeout(6000);
 const errors=[];page.on('pageerror',e=>errors.push(e.message));
 const call=(method,args={})=>page.evaluate(({method,args})=>EzkartBuilder[method](args),{method,args});
 try{
  await page.goto(ws.url+'/cart/admin/?page=sites&edit=code.ezkart.site');await page.waitForFunction(()=>globalThis.EzkartBuilder);
  await page.evaluate(()=>Object.defineProperty(navigator,'clipboard',{configurable:true,value:{writeText:async text=>{globalThis.copiedInstructions=text;}}}));
  await chooseBasic(page,'html');
  const copy=page.locator('[data-sq-copy-code-ai=block]');await copy.waitFor();
  const code='<button type="button" data-ezkart-add="coffee" data-ezkart-variant="small">Custom buy</button>';
  const field=page.locator('[data-sq-code-input]');await field.fill(code);await field.dispatchEvent('change');await copy.click();
  const prompt=await page.evaluate(()=>copiedInstructions);
  assert.match(prompt,/custom HTML block/);assert.match(prompt,/HTML, CSS and browser JavaScript/);assert.match(prompt,/no parent EzkartCart API/);assert.match(prompt,/data-ezkart-variant="small"/);assert.match(prompt,/"connected": true/);assert.match(prompt,/ezkart:commerce/);assert.match(prompt,/video-dialog/);assert.ok(prompt.includes(code));
  assert.ok(!prompt.includes('PRIVATE-SKU'));assert.ok(!prompt.includes('Private variant'));assert.ok(!prompt.includes('Archived'));
  assert.equal(await page.locator('[data-sq-code-controls] [data-sq-code-ai-status]').innerText(),'AI instructions copied. Paste them into your AI chat and add your design request.');
  await call('save');await page.reload();await page.waitForFunction(()=>globalThis.EzkartBuilder);
  await openAssets(page);await page.locator('[data-sq-library-category=saved]').click();await page.locator('[data-sq-create-component]').click();
  const component=page.locator('[data-sq-component-dialog]');await page.waitForFunction(()=>document.activeElement?.name==='component_name');await component.locator('[name=component_code]').fill('<article>Merchant component</article>');
  await page.evaluate(()=>Object.defineProperty(navigator,'clipboard',{configurable:true,value:{writeText:async()=>{throw new Error('permission denied');}}}));
  const componentCopy=component.locator('[data-sq-copy-code-ai=component]');await componentCopy.click();
  const fallback=page.locator('.sq-code-instructions-dialog');await fallback.waitFor();const fallbackField=fallback.locator('textarea');
  assert.match(await fallbackField.inputValue(),/reusable component/);assert.match(await fallbackField.inputValue(),/Merchant component/);assert.equal(await fallbackField.evaluate(n=>n.selectionEnd-n.selectionStart),(await fallbackField.inputValue()).length);
  await page.setViewportSize({width:390,height:850});const bounds=await fallback.boundingBox();assert.ok(bounds.x>=0&&bounds.x+bounds.width<=390);
  if(process.env.EZKART_TEST_EVIDENCE_DIR)await page.screenshot({path:join(process.env.EZKART_TEST_EVIDENCE_DIR,'code-instructions-390.png')});
  await fallback.getByRole('button',{name:'Close',exact:true}).click();assert.equal(await componentCopy.evaluate(n=>document.activeElement===n),true);await component.getByRole('button',{name:'Close component editor',exact:true}).click();
  // Exercise the exact API and declarative add control in a full exported page.
  await call('addSection',{component:'blank',id:'purchase-section'});
  await call('nativeInsert',{section:'purchase-section',node:{id:'purchase',type:'commerce',part:'add',productId:'coffee',group:'purchase',label:'Buy coffee'}});
  const html=await call('previewHtml');const preview=await browser.newPage({viewport:{width:390,height:850}});preview.on('pageerror',e=>errors.push(e.message));
  await preview.route('http://code-preview.test/',r=>r.fulfill({body:html,contentType:'text/html'}));await preview.goto('http://code-preview.test/');
  await preview.getByRole('button',{name:'Custom buy',exact:true}).click();await preview.locator('.ezkart-cart-row').waitFor();assert.match(await preview.locator('.ezkart-cart-row').innerText(),/Small/);
  assert.equal(await preview.evaluate(()=>EzkartCart.add({productId:'coffee',variantId:'small',quantity:1})),true);
  assert.equal(await preview.evaluate(()=>EzkartCart.add({productId:'coffee',variantId:'hidden',quantity:1})),false);
  assert.equal(await preview.evaluate(()=>EzkartCart.add({productId:'coffee',variantId:'small',quantity:100})),false);
  assert.deepEqual(errors,[]);
 }finally{await browser.close();await ws.stop();await rm(dir,{recursive:true,force:true});}
});
