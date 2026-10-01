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
 const product={id:'coffee',name:'Kopi Susu',type:'physical',status:'active',price:42500,stock:12,description:'Kopi susu dengan rasa lembut, dikemas segar untuk dinikmati di rumah.',media:[{id:'cover'}],images:[cover],image:cover,
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

async function geometry(card, split) {
 const info=await card.evaluate(card=>{
  const art=card.querySelector('.product-art'),img=art.querySelector('img'),heading=card.querySelector('h3'),footer=card.querySelector('footer');
  const rect=n=>{const r=n.getBoundingClientRect();return {x:r.x,y:r.y,w:r.width,h:r.height,right:r.right,bottom:r.bottom};};
  return {card:rect(card),art:rect(art),img:rect(img),heading:rect(heading),footer:rect(footer),radius:getComputedStyle(img).borderRadius,clip:getComputedStyle(art).overflow,fit:getComputedStyle(img).objectFit,transform:getComputedStyle(img).transform,loaded:img.complete&&img.naturalWidth>0,overflow:document.documentElement.scrollWidth>innerWidth+1};
 });
 assert.ok(info.loaded);assert.ok(Math.abs(info.art.w-info.art.h)<1,'The product frame stays square');
 assert.equal(info.radius,'0px');assert.equal(info.clip,'visible');assert.equal(info.fit,'contain');assert.equal(info.transform,'none');assert.equal(info.overflow,false);
 if(split){assert.ok(info.heading.x>info.art.right,'Details sit beside the square');assert.ok(info.footer.y>=info.art.bottom-1);assert.ok(info.footer.w>info.art.w*1.7,'Purchase controls keep the full card width');}
 else assert.ok(info.heading.y>=info.art.bottom,'Desktop keeps its vertical card');
}
async function viewer(page, card, expected, modifiers=[]){
 const art=card.locator('.product-art');await art.click({modifiers});const dialog=page.getByRole('dialog',{name:/Product photo|Foto produk/});
 await dialog.waitFor();assert.equal(await dialog.locator('img').getAttribute('src'),expected);
 assert.equal(await dialog.locator('img').evaluate(img=>getComputedStyle(img).objectFit),'contain');
 assert.ok(await dialog.locator('[data-photo-close]').evaluate(b=>b===document.activeElement));
 await page.keyboard.press('Escape');await dialog.waitFor({state:'hidden'});
 assert.ok(await art.evaluate(node=>node===document.activeElement));
 await page.waitForFunction(()=>!history.state?.ezkartProductPhoto);
 await art.focus();await page.keyboard.press('Enter');await dialog.waitFor();
 const current=page.url();await page.evaluate(()=>history.back());await dialog.waitFor({state:'hidden'});assert.equal(page.url(),current);
 assert.ok(await art.evaluate(node=>node===document.activeElement));
 await art.click({modifiers});await dialog.waitFor();await dialog.locator('[data-photo-close]').click();await dialog.waitFor({state:'hidden'});
 await page.waitForFunction(()=>!history.state?.ezkartProductPhoto);
}
test('split mobile product cards keep full square photos and an accessible viewer through save, preview, export and publication',async t=>{
 const {ws,context,page,cover,second,errors}=await fixture(t);
 await page.evaluate(()=>EzkartBuilder.nativeInsert({section:'blank',node:{id:'coffee-card',type:'product',productId:'coffee',props:{gridColumn:'1 / -1',width:'100%'}}}));
 const card=page.locator('.sq-page-preview [data-product-card=coffee]');await card.locator('img').waitFor();
 await card.locator('.product-art').click();assert.equal(await page.locator('.sq-product-image-dialog[open]').count(),0,'Ordinary Studio clicks still edit');
 await viewer(page,card,cover,['Alt']);
 await page.evaluate(()=>EzkartBuilder.setDevice({device:'mobile'}));await geometry(card,true);
 await page.evaluate(()=>EzkartBuilder.save());await page.reload();await page.waitForFunction(()=>globalThis.EzkartBuilder);
 await card.locator('img').waitFor();await viewer(page,card,cover,['Alt']);
 const html=await page.evaluate(()=>EzkartBuilder.exportHtml());const output=await context.newPage();output.on('pageerror',e=>errors.push(e.message));
 await output.route('https://mobile.example.test/',route=>route.fulfill({body:html,contentType:'text/html'}));await output.goto('https://mobile.example.test/');
 const publicCard=output.locator('[data-product-card=coffee]');
 for(const width of [320,390,768,1440]){await output.setViewportSize({width,height:900});await geometry(publicCard,width<=600);await publicCard.hover();assert.equal(await publicCard.locator('img').evaluate(img=>getComputedStyle(img).transform),'none');}
 await output.setViewportSize({width:390,height:844});await output.screenshot({path:'/tmp/ezkart-split-mobile-cover-390.png'});await viewer(output,publicCard,cover);
 assert.equal(await publicCard.getAttribute('data-ezkart-variant'),'small');assert.equal(await output.locator('.ezkart-cart-row').count(),0,'Enlargement never adds to cart');
 await publicCard.locator('select').selectOption({label:'Large'});assert.equal(await publicCard.locator('img').getAttribute('src'),second);await viewer(output,publicCard,second);
 await output.screenshot({path:'/tmp/ezkart-split-mobile-390.png'});
 const published=await page.evaluate(()=>EzkartBuilder.publish());await output.goto(published.url);
 const frame=output.frameLocator('[data-hosted-page]'),hosted=frame.locator('[data-product-card=coffee]');await hosted.locator('img').waitFor();await geometry(hosted,true);
 await hosted.locator('.product-art').click();await frame.getByRole('dialog').waitFor();assert.equal(await frame.getByRole('dialog').locator('img').getAttribute('src'),cover);
 await hosted.evaluate(()=>history.back());await frame.getByRole('dialog').waitFor({state:'hidden'});assert.equal(output.url(),published.url,'Back closes the photo inside the hosted page');
 await hosted.locator('.product-art').click();await frame.getByRole('dialog').waitFor();await frame.getByRole('dialog').locator('[data-photo-close]').click();await frame.getByRole('dialog').waitFor({state:'hidden'});
 await output.reload();assert.equal(await hosted.locator('img').getAttribute('src'),cover);
});
test('Image Stack phone preview uses the same square split card and viewer after save/reload',async t=>{
 const {ws,page,cover,errors}=await fixture(t);const saved=await ws.read('cover');saved.state=await page.evaluate(()=>EzkartImageBuilder.blank());await ws.write('cover',saved);await page.reload();
 await page.waitForFunction(()=>globalThis.EzkartBuilder&&document.querySelector('.ib-editor:not([hidden])'));
 await page.locator('[data-image-page-upload]').setInputFiles(join(repoRoot,'cart/admin/assets/builder-choice/sambal.webp'));
 await page.waitForFunction(()=>document.querySelector('.ib-row')&&!document.querySelector('.ib-controls').disabled);
 await page.locator('[data-image-page-product]').selectOption('coffee');await page.evaluate(()=>EzkartBuilder.save());await page.reload();
 await page.waitForFunction(()=>globalThis.EzkartBuilder);const phone=page.frameLocator('.ib-phone'),card=phone.locator('[data-product-card=coffee]');await card.locator('img').waitFor();
 await geometry(card,true);assert.equal(await card.locator('img').getAttribute('src'),cover);
 await card.locator('.product-art').click();await phone.getByRole('dialog').waitFor();assert.equal(await phone.getByRole('dialog').locator('img').getAttribute('src'),cover);
 await page.keyboard.press('Escape');await phone.getByRole('dialog').waitFor({state:'hidden'});assert.ok(await card.locator('.product-art').evaluate(node=>node===document.activeElement));
 assert.equal(await phone.locator('.ezkart-cart-row').count(),0);
 await page.setViewportSize({width:390,height:844});await geometry(card,true);
 await card.evaluate(node=>window.scrollTo(0,node.getBoundingClientRect().top+scrollY-16));
 await page.locator('.ib-phone').screenshot({path:'/tmp/ezkart-image-stack-split-preview.png',animations:'disabled'});
});
