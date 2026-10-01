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
 const product={id:'coffee',name:'Kopi Susu',type:'physical',status:'active',price:42500,stock:12,description:'Kopi susu dengan rasa lembut, dikemas segar untuk dinikmati di rumah.',media:[{id:'cover'},{id:'first'},{id:'cover'}],images:[cover],image:cover,
  options:[{name:'Size',values:['Small','Large','No photo','Sold out']}],variants:[
   {id:'small',name:'Small',price:42500,stock:8,imageUploadId:'first',image:first,options:[{option:'Size',value:'Small'}]},
   {id:'large',name:'Large',price:65000,stock:4,imageUploadId:'second',image:second,options:[{option:'Size',value:'Large'}]},
   {id:'no-photo',name:'No photo',price:49000,stock:4,options:[{option:'Size',value:'No photo'}]},
   {id:'sold-out',name:'Sold out',price:69000,stock:0,image:second,options:[{option:'Size',value:'Sold out'}]},
   {id:'hidden',name:'Hidden',hidden:true,price:1,stock:1,imageUploadId:'private-photo',image:second,options:[{option:'Size',value:'Hidden'}]},
  ]};
 await writeFile(join(dir,'catalog.json'),JSON.stringify({demoCheckout:true,mediaBase:ws.url,products:[product]}));
 await ws.create({id:'cover',name:'Cover first',productIds:['coffee']});
 const browser=await chromium.launch(),context=await browser.newContext({viewport:{width:1440,height:1000},hasTouch:true,reducedMotion:'reduce'});
 if(fallback)await context.addInitScript(()=>{const supports=CSS.supports.bind(CSS);CSS.supports=(...a)=>a[1]==='base-select'?false:supports(...a);});
 await context.route(ws.url+'/v1/public/media/**',async route=>{const id=new URL(route.request().url()).pathname.split('/').at(-1),name={cover:'kopi-susu',first:'granola',second:'sambal-roa'}[id];await route.fulfill({contentType:'image/webp',body:await readFile(join(repoRoot,'cart/admin/assets/products/'+name+'.webp'))});});
 context.setDefaultTimeout(8000);
 const page=await context.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));
 t.after(async()=>{await browser.close();await ws.stop();await rm(dir,{recursive:true,force:true});assert.deepEqual(errors,[]);});
 await page.goto(ws.url+'/cart/admin/?page=sites&edit=cover.ezkart.site');await page.waitForFunction(()=>globalThis.EzkartBuilder);
 return {ws,context,page,cover,first,second,product,errors};
}

async function outputFixture(t) {
 const data=await fixture(t);const {page,context,errors}=data;
 await page.evaluate(()=>EzkartBuilder.nativeInsert({section:'blank',node:{id:'coffee-card',type:'product',productId:'coffee',props:{gridColumn:'1 / -1',width:'100%'}}}));
 await page.evaluate(()=>EzkartBuilder.save());await page.reload();await page.waitForFunction(()=>globalThis.EzkartBuilder);
 const html=await page.evaluate(()=>EzkartBuilder.exportHtml()),output=await context.newPage();output.on('pageerror',e=>errors.push(e.message));
 await output.route('https://gallery.example.test/',route=>route.fulfill({body:html,contentType:'text/html'}));await output.goto('https://gallery.example.test/');await output.setViewportSize({width:390,height:844});
 return {...data,output,card:output.locator('[data-product-card=coffee]'),dialog:output.locator('.sq-product-image-dialog')};
}
async function touch(client,type,points){await client.send('Input.dispatchTouchEvent',{type,touchPoints:points.map((p,i)=>({...p,id:i+1,radiusX:2,radiusY:2,force:1}))});}
async function tap(client,x,y){await touch(client,'touchStart',[{x,y}]);await touch(client,'touchEnd',[]);}
test('gallery opens current photo, deduplicates catalog/visible variants, navigates without commerce changes and fits all widths',async t=>{
 const {page,context,output,card,dialog,cover,first,second,ws}=await outputFixture(t),art=card.locator('.product-art');
 for(const width of [320,390,768,1440]){
  await output.setViewportSize({width,height:900});await art.click();await dialog.waitFor();
  const fit=await dialog.locator('img').evaluate(img=>{const r=img.getBoundingClientRect(),d=img.closest('dialog');return {width:r.width,height:r.height,left:r.left,right:r.right,top:r.top,bottom:r.bottom,fit:getComputedStyle(img).objectFit,border:getComputedStyle(d).borderWidth,radius:getComputedStyle(d).borderRadius,padding:getComputedStyle(d).padding,scale:d.dataset.photoZoom};});
  assert.equal(fit.width,fit.height);assert.equal(fit.fit,'contain');assert.equal(fit.border,'0px');assert.equal(fit.radius,'0px');assert.equal(fit.padding,'0px');assert.equal(fit.scale,'1');assert.ok(fit.left>=0&&fit.right<=width);assert.ok(fit.top>=0&&fit.bottom<=900);
  assert.equal(await dialog.locator('img').getAttribute('src'),cover);assert.match(await dialog.locator('[role=status]').innerText(),/1 \/ 3/);
  await dialog.locator('[data-photo-next]').click();assert.equal(await dialog.locator('img').getAttribute('src'),first);
  await output.keyboard.press('ArrowRight');assert.equal(await dialog.locator('img').getAttribute('src'),second);
  await dialog.locator('[data-photo-next]').click();assert.equal(await dialog.locator('img').getAttribute('src'),cover);
  await output.keyboard.press('ArrowLeft');assert.equal(await dialog.locator('img').getAttribute('src'),second);
  await dialog.locator('[data-photo-close]').click();await dialog.waitFor({state:'hidden'});await output.waitForFunction(()=>!history.state?.ezkartProductPhoto);
  assert.equal(await card.locator('img').getAttribute('src'),cover);assert.equal(await card.getAttribute('data-ezkart-variant'),'small');assert.equal(await output.locator('.ezkart-cart-row').count(),0);
 }
 await output.setViewportSize({width:390,height:844});await card.locator('select').selectOption({label:'Large'});await art.click();assert.equal(await dialog.locator('img').getAttribute('src'),second,'The chosen variant photo opens first');
 await dialog.locator('[data-photo-next]').click();assert.equal(await dialog.locator('img').getAttribute('src'),cover);
 await dialog.locator('[data-photo-close]').click();await dialog.waitFor({state:'hidden'});await output.waitForFunction(()=>!history.state?.ezkartProductPhoto);assert.equal(await card.locator('img').getAttribute('src'),second);
 const editorCard=page.locator('[data-product-card=coffee]');await editorCard.locator('.product-art').click({modifiers:['Alt']});assert.match(await page.locator('.sq-product-image-dialog [role=status]').innerText(),/1 \/ 3/);await page.keyboard.press('Escape');
 const published=await page.evaluate(()=>EzkartBuilder.publish());await output.goto(published.url);const hosted=output.frameLocator('[data-hosted-page]'),hostedCard=hosted.locator('[data-product-card=coffee]');await hostedCard.locator('.product-art').click();
 await hosted.locator('[data-photo-next]').click();assert.equal(await hosted.getByRole('dialog').locator('img').getAttribute('src'),first);await hostedCard.evaluate(()=>history.back());await hosted.getByRole('dialog').waitFor({state:'hidden'});assert.equal(output.url(),published.url);
});
test('real mobile touch swipes, pinch and double tap zoom only the gallery and reset on navigation and close',async t=>{
 const {output,context,card,dialog,cover,first}=await outputFixture(t);await card.locator('.product-art').click();await dialog.waitFor();const client=await context.newCDPSession(output),stage=dialog.locator('.sq-product-image-stage');
 const bounds=await stage.boundingBox(),x=bounds.x+bounds.width/2,y=bounds.y+bounds.height/2;
 await touch(client,'touchStart',[{x:x+80,y}]);await touch(client,'touchMove',[{x:x-80,y:y+4}]);await touch(client,'touchEnd',[]);assert.equal(await dialog.locator('img').getAttribute('src'),first);
 await touch(client,'touchStart',[{x:x-80,y}]);await touch(client,'touchMove',[{x:x+80,y}]);await touch(client,'touchEnd',[]);assert.equal(await dialog.locator('img').getAttribute('src'),cover);
 await tap(client,x,y);await tap(client,x,y);assert.ok(Number(await dialog.getAttribute('data-photo-zoom'))>2);
 const before=await dialog.locator('img').getAttribute('style');await touch(client,'touchStart',[{x,y}]);await touch(client,'touchMove',[{x:x+80,y:y+20}]);await touch(client,'touchEnd',[]);assert.notEqual(await dialog.locator('img').getAttribute('style'),before);assert.equal(await dialog.locator('img').getAttribute('src'),cover,'Zoomed swipes pan instead of changing photos');
 await dialog.locator('[data-photo-zoom]').click();assert.equal(await dialog.getAttribute('data-photo-zoom'),'1');
 await touch(client,'touchStart',[{x:x-45,y},{x:x+45,y}]);await touch(client,'touchMove',[{x:x-120,y},{x:x+120,y}]);await touch(client,'touchEnd',[]);assert.ok(Number(await dialog.getAttribute('data-photo-zoom'))>2,'Two-finger pinch zooms');
 await output.screenshot({path:'/tmp/ezkart-gallery-zoom-390.png'});
 await dialog.locator('[data-photo-next]').click();assert.equal(await dialog.getAttribute('data-photo-zoom'),'1');assert.equal(await dialog.locator('img').getAttribute('src'),first);
 await output.screenshot({path:'/tmp/ezkart-gallery-fit-390.png'});
 await output.keyboard.press('Escape');await dialog.waitFor({state:'hidden'});await output.waitForFunction(()=>!history.state?.ezkartProductPhoto);
 await card.locator('.product-art').click();await dialog.waitFor();assert.equal(await dialog.getAttribute('data-photo-zoom'),'1');assert.equal(await dialog.locator('img').getAttribute('src'),cover);
 for(let i=0;i<3;i++){await dialog.locator('[data-photo-close]').click();await card.locator('.product-art').click();await dialog.waitFor();}
 await output.evaluate(()=>history.back());await dialog.waitFor({state:'hidden'});assert.ok(await card.locator('.product-art').evaluate(n=>n===document.activeElement));
 await card.locator('.product-art').click();await dialog.waitFor();await stage.dblclick();assert.ok(Number(await dialog.getAttribute('data-photo-zoom'))>1);await stage.dblclick();assert.equal(await dialog.getAttribute('data-photo-zoom'),'1');
});
test('native commerce images expose only their product photos and image-only exports include the gallery runtime',async t=>{
 const {page,context,cover,first}=await fixture(t);
 await page.evaluate(()=>EzkartBuilder.nativeInsert({section:'blank',node:{id:'photo-only',type:'container',props:{display:'grid',paddingTop:'20px',paddingRight:'20px',paddingBottom:'20px',paddingLeft:'20px'},children:[{id:'image',type:'commerce',part:'image',productId:'coffee',group:'one',props:{width:'160px',height:'160px'}},{id:'add',type:'commerce',part:'add',productId:'coffee',group:'one'}]}}));
 const html=await page.evaluate(()=>EzkartBuilder.exportHtml()),output=await context.newPage();await output.setContent(html);
 const image=output.locator('[data-native-id=image]');assert.equal(await image.getAttribute('role'),'button');await image.click();const dialog=output.getByRole('dialog');await dialog.waitFor();assert.equal(await dialog.locator('img').getAttribute('src'),cover);assert.match(await dialog.locator('[role=status]').innerText(),/1 \/ 3/);await dialog.locator('[data-photo-next]').click();assert.equal(await dialog.locator('img').getAttribute('src'),first);await output.keyboard.press('Escape');assert.ok(await image.evaluate(n=>n===document.activeElement));
});
