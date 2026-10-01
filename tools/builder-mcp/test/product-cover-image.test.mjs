import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,writeFile,readFile,rm} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {chromium} from 'playwright';
import {Workspace,repoRoot} from '../workspace.mjs';

async function fixture(t,fallback=false){
 const dir=await mkdtemp(join(tmpdir(),'ezkart-cover-')),ws=await new Workspace(dir).init();await ws.start();
 const asset=id=>ws.url+'/v1/public/media/'+id;
 const cover=asset('cover'),first=asset('first'),second=asset('second');
 const product={id:'coffee',name:'Kopi Susu',type:'physical',status:'active',price:42500,stock:12,media:[{id:'cover'}],images:[cover],image:cover,
  options:[{name:'Size',values:['Small','Large','No photo','Sold out']}],variants:[
   {id:'small',name:'Small',price:42500,stock:8,imageUploadId:'first',image:first,options:[{option:'Size',value:'Small'}]},
   {id:'large',name:'Large',price:65000,stock:4,imageUploadId:'second',image:second,options:[{option:'Size',value:'Large'}]},
   {id:'no-photo',name:'No photo',price:49000,stock:4,options:[{option:'Size',value:'No photo'}]},
   {id:'sold-out',name:'Sold out',price:69000,stock:0,image:second,options:[{option:'Size',value:'Sold out'}]},
   {id:'hidden',name:'Hidden',hidden:true,price:1,stock:1,image:second,options:[{option:'Size',value:'Hidden'}]},
  ]};
 await writeFile(join(dir,'catalog.json'),JSON.stringify({demoCheckout:true,mediaBase:ws.url,products:[product]}));
 await ws.create({id:'cover',name:'Cover first',productIds:['coffee']});
 const browser=await chromium.launch(),context=await browser.newContext({viewport:{width:1440,height:1000},reducedMotion:'reduce'});
 if(fallback)await context.addInitScript(()=>{const supports=CSS.supports.bind(CSS);CSS.supports=(...a)=>a[1]==='base-select'?false:supports(...a);});
 await context.route(ws.url+'/v1/public/media/**',async route=>{const id=new URL(route.request().url()).pathname.split('/').at(-1),name={cover:'kopi-susu',first:'granola',second:'sambal-roa'}[id];await route.fulfill({contentType:'image/webp',body:await readFile(join(repoRoot,'cart/admin/assets/products/'+name+'.webp'))});});
 context.setDefaultTimeout(8000);
 const page=await context.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));
 t.after(async()=>{await browser.close();await ws.stop();await rm(dir,{recursive:true,force:true});assert.deepEqual(errors,[]);});
 await page.goto(ws.url+'/cart/admin/?page=sites&edit=cover.ezkart.site');await page.waitForFunction(()=>globalThis.EzkartBuilder);
 return {ws,context,page,cover,first,second,product,errors};
}

for(const fallback of [false,true])test(`product cards keep the cover until an explicit choice in editor, preview and publication (${fallback?'fallback':'native'} select)`,async t=>{
 const {ws,context,page,cover,first,second,product,errors}=await fixture(t,fallback);
 await page.evaluate(()=>EzkartBuilder.nativeInsert({section:'blank',node:{id:'coffee-card',type:'product',productId:'coffee',props:{gridColumn:'1 / -1',width:'100%'}}}));
 const card=page.locator('.sq-page-preview [data-product-card=coffee]'),photo=card.locator('.product-art img');await photo.waitFor();
 assert.equal(await photo.getAttribute('src'),cover);
 const choose=async label=>{
  if(fallback){const trigger=card.getByRole('combobox',{name:'Size',exact:true});await trigger.waitFor();await trigger.click({modifiers:['Alt']});await page.locator('.ezkart-select-menu:not([hidden]) [role=option]').filter({hasText:new RegExp('^'+label+'$')}).click();}
  else await card.locator('select').selectOption({label});
 };
 if(fallback){await choose('Small');assert.equal(await photo.getAttribute('src'),first,'Explicitly confirming the default option also chooses its image');}
 await choose('Large');assert.equal(await photo.getAttribute('src'),second);assert.match(await card.locator('footer b').innerText(),/65[.,]000/);
 await choose('No photo');assert.equal(await photo.getAttribute('src'),cover);
 await choose('Small');assert.equal(await photo.getAttribute('src'),first);
 await page.evaluate(()=>EzkartBuilder.save());await page.reload();await page.waitForFunction(()=>globalThis.EzkartBuilder);
 await photo.waitFor();assert.equal(await photo.getAttribute('src'),cover,'A reopened editor starts with the cover');
 await choose('Large');assert.equal(await photo.getAttribute('src'),second);
 const html=await page.evaluate(()=>EzkartBuilder.exportHtml());
 const output=await context.newPage();output.on('pageerror',e=>errors.push(e.message));
 await output.route('https://cover.example.test/',route=>route.fulfill({body:html,contentType:'text/html'}));await output.goto('https://cover.example.test/');
 const publicCard=output.locator('[data-product-card=coffee]');
 assert.equal(await publicCard.locator('img').getAttribute('src'),cover,'A new visitor sees the cover regardless of merchant preview choices');
 await publicCard.locator('select').selectOption({label:'Large'});assert.equal(await publicCard.locator('img').getAttribute('src'),second);
 await publicCard.locator('select').selectOption({label:'No photo'});assert.equal(await publicCard.locator('img').getAttribute('src'),cover);
 await publicCard.locator('select').selectOption({label:'Small'});assert.equal(await publicCard.locator('img').getAttribute('src'),first);
 await publicCard.locator('[data-ezkart-add]').click();assert.match(await output.locator('.ezkart-cart-row').innerText(),/Small/);assert.match(await output.locator('[data-ezkart-cart-subtotal]').innerText(),/42[.,]500/);
 await output.keyboard.press('Escape');await output.reload();assert.equal(await publicCard.locator('img').getAttribute('src'),cover);
 const published=await page.evaluate(()=>EzkartBuilder.publish());assert.equal(published.published,true);
 await output.goto(published.url);const hosted=output.frameLocator('[data-hosted-page]').locator('[data-product-card=coffee]');
 assert.equal(await hosted.locator('img').getAttribute('src'),cover);
 await hosted.locator('select').selectOption({label:'Large'});assert.equal(await hosted.locator('img').getAttribute('src'),second);
 await output.setViewportSize({width:390,height:844});await output.screenshot({path:'/tmp/ezkart-product-cover-selected-390.png'});
 await output.reload();assert.equal(await hosted.locator('img').getAttribute('src'),cover);await output.screenshot({path:'/tmp/ezkart-product-cover-default-390.png'});
 assert.equal(await hosted.locator('select option').count(),4,'Hidden variants stay hidden');
 await writeFile(join(ws.directory,'catalog.json'),JSON.stringify({demoCheckout:true,mediaBase:ws.url,products:[{...product,options:[],variants:[]}]}));
 await page.evaluate(()=>EzkartBuilder.exportHtml());
 assert.equal(await photo.getAttribute('src'),cover,'Removing all variants restores the cover');
 assert.equal(await card.locator('select').count(),0);
});

test('native commerce images distinguish default, explicit, fixed and invalid choices across groups and remounts',async t=>{
 const {context,page,cover,first,second,product}=await fixture(t);
 await page.evaluate(()=>EzkartBuilder.nativeInsert({section:'blank',node:{id:'parts',type:'container',props:{display:'grid',gap:'12px',paddingTop:'16px',paddingRight:'16px',paddingBottom:'16px',paddingLeft:'16px'},children:[
  {id:'image',type:'commerce',part:'image',props:{width:'120px',height:'120px'},productId:'coffee',group:'shared'},
  {id:'options',type:'commerce',part:'options',productId:'coffee',group:'shared'},
  {id:'price',type:'commerce',part:'price',productId:'coffee',group:'shared'},
  {id:'add',type:'commerce',part:'add',productId:'coffee',group:'shared'},
  {id:'independent',type:'commerce',part:'image',props:{width:'120px',height:'120px'},productId:'coffee',group:'other'},
  {id:'fixed',type:'commerce',part:'image',props:{width:'120px',height:'120px'},productId:'coffee',variantId:'large'},
 ]}}));
 const photo=page.locator('[data-native-id=image] img');await photo.waitFor();assert.equal(await photo.getAttribute('src'),cover);
 assert.equal(await page.locator('[data-native-id=independent] img').getAttribute('src'),cover);assert.equal(await page.locator('[data-native-id=fixed] img').getAttribute('src'),second);
 await page.locator('[data-native-id=options] input[value=small]').focus();await page.keyboard.press(' ');assert.equal(await photo.getAttribute('src'),first);
 await page.locator('[data-native-id=options] input[value=large]').focus();await page.keyboard.press(' ');assert.equal(await photo.getAttribute('src'),second);
 await page.evaluate(()=>EzkartBuilder.nativeUpdate({id:'price',prefix:'Now: '}));assert.equal(await photo.getAttribute('src'),second,'Re-rendering preserves an explicit choice');
 await page.locator('[data-native-id=options] input[value=no-photo]').focus();await page.keyboard.press(' ');assert.equal(await photo.getAttribute('src'),cover);
 await page.locator('[data-native-id=options] input[value=large]').focus();await page.keyboard.press(' ');
 const html=await page.evaluate(()=>EzkartBuilder.exportHtml()),output=await context.newPage();await output.setContent(html);
 assert.equal(await output.locator('[data-native-id=image] img').getAttribute('src'),cover);
 assert.equal(await output.locator('[data-native-id=fixed] img').getAttribute('src'),second);
 await output.locator('[data-native-id=options] label').filter({has:output.locator('input[value=small]')}).click();assert.equal(await output.locator('[data-native-id=image] img').getAttribute('src'),first);
 await output.locator('[data-native-id=options] label').filter({has:output.locator('input[value=no-photo]')}).click();assert.equal(await output.locator('[data-native-id=image] img').getAttribute('src'),cover);
 await page.evaluate(product=>EzkartCommerce.mount(document.querySelector('.sq-page-preview'),[{...product,variants:product.variants.filter(v=>v.id!=='large')}],true),product);
 assert.equal(await photo.getAttribute('src'),cover,'Removing the selected variant resets the image to the cover');
 await page.evaluate(product=>EzkartCommerce.mount(document.querySelector('.sq-page-preview'),[{...product,images:[],image:''}],true),product);
 assert.equal(await photo.getAttribute('src'),first,'A product without a cover can still use a variant photo');
 await page.evaluate(()=>EzkartBuilder.save());await page.reload();await page.waitForFunction(()=>globalThis.EzkartBuilder);await photo.waitFor();assert.equal(await photo.getAttribute('src'),cover);
});
