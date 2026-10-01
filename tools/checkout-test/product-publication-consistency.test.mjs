import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile, writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {chromium} from '../builder-mcp/node_modules/playwright/index.mjs';
import {setup} from './fixture.mjs';

test('repeated product price publications recover their exact committed save after an interrupted response', async t => {
  const app = await setup({EZKART_CLOUDFLARE_API_URL:'https://ezkart-api-test.fixture.workers.dev'});
  t.after(() => app.close());
  const browser = await chromium.launch(); t.after(() => browser.close());
  const context = await browser.newContext({viewport:{width:941,height:904}});
  await context.addCookies([app.adminCookie()]);
  const image = await readFile(new URL('../../cart/admin/assets/products/granola.webp',import.meta.url));
  const fixture = {store:{sellerId:'seller_fixture'},catalog:[{id:'custom-tea',revision:1,name:'Morning tea',category:'Tea',type:'physical',status:'active',sku:'TEA',price:20000,stock:10,weightGrams:100,media:[1,2,3].map(n=>({id:'tea_image_'+n})),variants:[]}],drafts:[],products:[]};
  const persist = () => writeFile(join(app.directory,'storefront.json'),JSON.stringify(fixture));
  await persist();
  const writes = [], confirmations = [], errors = [];
  let mode = 'success', receipt = null, releaseDraft, startDraft, holdDraft = false;
  await context.route('**/*',async route => {
    const request = route.request(), url = new URL(request.url()), path = url.searchParams.get('cloud');
    if (url.pathname.startsWith('/v1/public/media/') || path?.startsWith('/v1/media/')) return route.fulfill({contentType:'image/webp',body:image});
    if (path === '/v1/admin-profile') return route.fulfill({json:{ok:true,profile:{logoId:'',canEdit:true}}});
    if (path === '/v1/catalog') return route.fulfill({json:{ok:true,products:fixture.catalog,drafts:fixture.drafts}});
    if (path?.startsWith('/v1/drafts/')) {
      const id = path.split('/').at(-1);
      if (request.method() === 'DELETE') fixture.drafts = fixture.drafts.filter(draft=>draft.id!==id);
      else {
        fixture.drafts = [...fixture.drafts.filter(draft=>draft.id!==id),{...request.postDataJSON().snapshot,id}];
        if (holdDraft) {holdDraft=false; await new Promise(resolve=>{releaseDraft=resolve;startDraft();});}
      }
      await persist(); return route.fulfill({json:{ok:true,draft:{id}}});
    }
    if (path === '/v1/products/custom-tea/confirmation') {
      confirmations.push(path);
      return route.fulfill(receipt ? {json:{ok:true,saveId:receipt,product:fixture.catalog[0]}} : {status:404,json:{ok:false,error:'Save not found'}});
    }
    if (path === '/v1/products/custom-tea') {
      const payload = request.postDataJSON(); writes.push(payload);
      if (payload.revision!==fixture.catalog[0].revision) return route.fulfill({status:409,json:{ok:false,error:'This product changed.',code:'catalog_revision_conflict'}});
      if (mode === 'before-commit') return route.fulfill({status:503,json:{ok:false,error:'Connection interrupted'}});
      fixture.catalog[0] = {...fixture.catalog[0],...payload,revision:payload.revision+1}; receipt=payload.saveId; await persist();
      if (mode === 'after-commit' || mode === 'after-commit-error') return route.fulfill({status:mode==='after-commit-error'?500:503,json:{ok:false,error:'Connection interrupted'}});
      return route.fulfill({json:{ok:true,product:fixture.catalog[0]}});
    }
    if (path) return route.fulfill({json:{ok:true,items:[],notifications:[],unreadCount:0}});
    if (url.hostname!=='127.0.0.1') return route.abort();
    return route.continue();
  });
  const page = await context.newPage(); page.on('pageerror',error=>errors.push(error.message)); page.setDefaultTimeout(7000);
  const editor = app.base+'/cart/admin/?page=product-new&product=custom-tea&fresh=1';
  const publish = () => page.getByRole('button',{name:'Publish changes',exact:true}).first().click();
  const open = async () => {await page.goto(editor); await page.waitForFunction(()=>document.querySelector('#product-create-form [name=name]')?.value==='Morning tea');};
  const price = () => page.locator('#product-create-form [name=price]');
  await open(); await price().fill('31500'); await publish();
  await page.waitForURL('**/?page=products&updated=1'); assert.equal(fixture.catalog[0].price,31500);
  await open(); assert.equal(await price().inputValue(),'31500');
  await price().fill('42500');
  const draftStarted = new Promise(resolve=>{startDraft=resolve;}); holdDraft=true;
  await page.locator('[data-save-product-draft]').click(); await draftStarted;
  mode='after-commit'; await publish();
  assert.equal(writes.length,1,'Publishing waits for the older in-flight draft');
  releaseDraft();
  await page.waitForURL('**/?page=products&updated=1');
  assert.equal(fixture.catalog[0].price,42500);
  assert.equal(writes.length,2,'Lost responses are confirmed without replaying the product mutation');
  assert.equal(confirmations.length,1);
  assert.equal(fixture.drafts.length,0,'An older autosave cannot recreate the published draft');
  await open(); assert.equal(await price().inputValue(),'42500');
  mode='before-commit'; await price().fill('55000'); await publish();
  await page.locator('[data-product-create-error]').filter({hasText:'Connection interrupted'}).waitFor();
  assert.equal(fixture.catalog[0].price,42500,'An older successful receipt cannot confirm a new failed save');
  assert.equal(await price().inputValue(),'55000','Unsaved price stays available to retry');
  mode='success'; await publish(); await page.waitForURL('**/?page=products&updated=1');
  assert.equal(fixture.catalog[0].price,55000);
  await open(); mode='after-commit-error'; await price().fill('65000'); await publish();
  await page.waitForURL('**/?page=products&updated=1');assert.equal(fixture.catalog[0].price,65000,'A server error after commit uses the same exact confirmation');
  assert.equal(new Set(writes.map(write=>write.saveId)).size,writes.length,'Every save uses a new confirmation identity');
  assert.deepEqual(errors,[]);
});

test('an unconfirmed new physical product keeps its ID and SKU on retry rather than creating another product',async t=>{
  const app=await setup({EZKART_CLOUDFLARE_API_URL:'https://ezkart-api-test.fixture.workers.dev'});t.after(()=>app.close());
  const browser=await chromium.launch();t.after(()=>browser.close());
  const context=await browser.newContext({viewport:{width:390,height:844}});await context.addCookies([app.adminCookie()]);
  const image=await readFile(new URL('../../cart/admin/assets/products/granola.webp',import.meta.url));
  const draft={id:'draft-new-retry',baseRevision:null,name:'Retry tea',fields:{type:'physical',category:'Tea',price:'31500',stock:'10',weight:'100'},images:[1,2,3].map(n=>({id:'image-'+n,cloudId:'new_image_'+n})),hasVariants:false,options:[],variants:[]};
  const fixture={store:{sellerId:'seller_fixture'},catalog:[],drafts:[draft],products:[]};
  const persist=()=>writeFile(join(app.directory,'storefront.json'),JSON.stringify(fixture));await persist();
  const writes=[],errors=[];let failDraft=true;
  await context.route('**/*',async route=>{
    const request=route.request(),url=new URL(request.url()),path=url.searchParams.get('cloud');
    if(url.pathname.startsWith('/v1/public/media/')||path?.startsWith('/v1/media/'))return route.fulfill({contentType:'image/webp',body:image});
    if(path==='/v1/catalog')return route.fulfill({json:{ok:true,products:fixture.catalog,drafts:fixture.drafts}});
    if(path==='/v1/admin-profile')return route.fulfill({json:{ok:true,profile:{logoId:'',canEdit:true}}});
    if(path?.startsWith('/v1/drafts/')){
      if(failDraft)return route.fulfill({status:503,json:{ok:false,error:'Draft unavailable'}});
      const id=path.split('/').at(-1);fixture.drafts=[{...request.postDataJSON().snapshot,id}];await persist();return route.fulfill({json:{ok:true,draft:{id}}});
    }
    if(path?.endsWith('/confirmation'))return route.fulfill({status:404,json:{ok:false,error:'Confirmation temporarily unavailable'}});
    if(path?.startsWith('/v1/products/')){
      const payload=request.postDataJSON();writes.push(payload);
      assert.equal(fixture.drafts[0].publishingProductId,payload.id,'Identity is saved before the product mutation begins');
      assert.equal(fixture.drafts[0].fields.price,String(payload.price),'The latest frozen price is saved with the identity');
      if(fixture.catalog.some(product=>product.id===payload.id))return route.fulfill({status:409,json:{ok:false,error:'This product changed.',code:'catalog_revision_conflict'}});
      fixture.catalog.push({...payload,revision:1,status:'active',media:payload.imageUploadIds.map(id=>({id}))});await persist();
      return route.fulfill({status:503,json:{ok:false,error:'Connection interrupted'}});
    }
    if(path)return route.fulfill({json:{ok:true,items:[],notifications:[],unreadCount:0}});
    if(url.hostname!=='127.0.0.1')return route.abort();return route.continue();
  });
  const page=await context.newPage();page.setDefaultTimeout(7000);page.on('pageerror',error=>errors.push(error.message));
  await page.goto(app.base+'/cart/admin/?page=product-new&draft=draft-new-retry');
  await page.waitForFunction(()=>document.querySelector('#product-create-form [name=name]')?.value==='Retry tea');
  const publish=()=>page.locator('[form="product-create-form"][type="submit"]').first().click();
  await publish();await page.locator('[data-product-create-error]').filter({hasText:'Draft unavailable'}).waitFor();
  assert.equal(writes.length,0,'A failed durable identity save prevents the product mutation');
  failDraft=false;
  await publish();await page.locator('[data-product-create-error]').filter({hasText:'Connection interrupted'}).waitFor();
  await page.locator('#product-create-form [name=price]').fill('42500');await publish();
  await page.locator('[data-product-conflict-latest]').waitFor();
  assert.equal(writes.length,2);assert.equal(writes[0].id,writes[1].id);assert.equal(writes[0].sku,writes[1].sku);
  assert.notEqual(writes[0].saveId,writes[1].saveId);
  assert.equal(fixture.catalog.length,1,'An unknown original outcome cannot create a second product');
  assert.equal(fixture.catalog[0].price,31500,'The committed original stays intact until reviewed with its current revision');
  assert.equal(await page.locator('#product-create-form [name=price]').inputValue(),'42500');
  await page.locator('[data-save-product-draft]').click();
  await page.waitForFunction(()=>document.querySelector('[data-product-draft-status]').textContent.includes('Saved'));
  assert.equal(fixture.drafts[0].publishingProductId,writes[0].id,'The draft retains the original create identity');
  await page.reload();
  await page.waitForFunction(()=>document.querySelector('#product-create-form [name=name]')?.value==='Retry tea');
  await publish();await page.locator('[data-product-conflict-latest]').waitFor();
  assert.equal(writes.length,3);assert.equal(writes[2].id,writes[0].id);assert.equal(writes[2].sku,writes[0].sku);
  assert.equal(writes[2].revision,null,'Reload does not promote an old draft to the latest catalog revision');
  assert.equal(fixture.catalog.length,1,'Reopening an uncertain create does not duplicate the committed product');
  assert.equal(fixture.catalog[0].price,31500);assert.equal(await page.locator('#product-create-form [name=price]').inputValue(),'42500');
  assert.deepEqual(errors,[]);
});
