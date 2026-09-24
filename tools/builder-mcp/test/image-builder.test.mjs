import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {chromium} from 'playwright';
import {Workspace,repoRoot} from '../workspace.mjs';

test('image pages create, upload, reorder, replace, undo, save and use the shared stock and checkout flow', async t => {
  const dir=await mkdtemp(join(tmpdir(),'ezkart-image-editor-')),ws=await new Workspace(dir).init();
  const products=[{id:'real-sambal',name:'Sambal from the catalog',status:'active',type:'physical',price:89000,stock:7,images:[],variants:[{id:'bawang',name:'Bawang',price:89000,stock:3},{id:'ijo',name:'Ijo',price:91000,stock:4}]}];
  const catalog=()=>writeFile(join(dir,'catalog.json'),JSON.stringify({products,demoCheckout:true}));
  await catalog();await ws.start();const browser=await chromium.launch();const page=await browser.newPage({viewport:{width:1440,height:1000},reducedMotion:'reduce'});
  page.setDefaultTimeout(10000);const errors=[];page.on('pageerror',error=>errors.push(error.message));
  t.after(async()=>{await browser.close();await ws.stop();await rm(dir,{recursive:true,force:true});assert.deepEqual(errors,[]);});
  const call=(method,args={})=>page.evaluate(({method,args})=>EzkartBuilder[method](args),{method,args});
  await page.goto(ws.url+'/cart/admin/?page=sites');
  await page.locator('[data-library-create-card]').click();
  assert.equal(await page.locator('.bc-choices').isVisible(),true);
  await page.locator('[data-bc-preview=visual]').last().click();
  const example=page.locator('.bc-example');
  for(const width of [1440,390]){
    await page.setViewportSize({width,height:844});
    await page.waitForFunction(mobile=>{
      const img=document.querySelector('.bc-example img');
      return img?.complete&&img.naturalWidth>0&&img.currentSrc.includes(mobile?'sela-mobile-full':'sela-desktop-full');
    },width===390);
    await example.locator('img').evaluate(img=>img.decode());
    assert.ok(await example.evaluate(node=>node.scrollHeight>node.clientHeight+1000));
    await example.evaluate(node=>node.scrollTop=0);
    const bounds=await example.boundingBox();
    await page.mouse.move(bounds.x+bounds.width/2,bounds.y+180);await page.mouse.wheel(0,650);
    await page.waitForFunction(()=>document.querySelector('.bc-example').scrollTop>100);
    assert.equal(await example.locator('header button').isVisible(),true);
    await example.evaluate(node=>node.scrollTop=node.scrollHeight);
    assert.ok(await example.locator('img').evaluate(img=>img.getBoundingClientRect().bottom<=innerHeight));
  }
  await page.keyboard.press('Escape');
  assert.equal(await page.locator('[data-bc-preview=visual]').last().evaluate(node=>node===document.activeElement),true);
  await page.setViewportSize({width:1440,height:1000});
  await page.locator('[data-bc-preview=image]').last().click();
  await page.locator('.bc-example img').evaluateAll(images=>Promise.all(images.map(img=>img.decode())));await page.keyboard.press('Escape');
  await page.locator('[data-bc-choose=image]').click();
  const form=page.locator('[data-library-page-form]');
  await form.locator('[name=page_name]').fill('Image sale');await form.locator('button[value=default]').click();
  await page.waitForURL('**edit=image-sale.ezkart.site');await page.waitForFunction(()=>globalThis.EzkartBuilder&&document.querySelector('.ib-editor:not([hidden])'));
  await assert.rejects(()=>call('exportHtml'),/Upload at least one image/);
  await page.locator('[data-image-page-upload]').setInputFiles([
    join(repoRoot,'cart/admin/assets/builder-choice/sambal.webp'),
    join(repoRoot,'cart/admin/templates/sela/preview/assets/hero-720.webp'),
  ]);
  await page.waitForFunction(()=>document.querySelectorAll('.ib-row').length===2&&!document.querySelector('.ib-controls').disabled);
  const ids=()=>page.locator('.ib-row').evaluateAll(rows=>rows.map(row=>row.dataset.imageRow));
  const original=await ids();
  await page.locator('.ib-row').nth(1).locator('[data-image-drag]').focus();
  await page.keyboard.press('Space');await page.keyboard.press('ArrowUp');await page.keyboard.press('Space');
  assert.deepEqual(await ids(),[original[1],original[0]]);
  await page.locator('[data-sq-undo]').click();assert.deepEqual(await ids(),original);
  await page.locator('[data-sq-redo]').click();assert.deepEqual(await ids(),[original[1],original[0]]);
  await page.locator('.ib-row').first().locator('summary').click();
  await page.locator('.ib-row').first().locator('textarea').fill('The uploaded campaign artwork');
  await page.locator('.ib-row').first().locator('textarea').blur();
  // A tall poster keeps a readable width; the old longest-edge image optimizer cannot do this.
  const tall=await page.evaluate(()=>{const canvas=document.createElement('canvas');canvas.width=900;canvas.height=9000;const ctx=canvas.getContext('2d');ctx.fillStyle='#be321f';ctx.fillRect(0,0,900,9000);return canvas.toDataURL('image/png');});
  const chooser=page.waitForEvent('filechooser');await page.locator('.ib-row').first().locator('[data-image-replace]').click();
  await (await chooser).setFiles({name:'tall-poster.png',mimeType:'image/png',buffer:Buffer.from(tall.split(',')[1],'base64')});
  await page.waitForFunction(()=>document.querySelector('.ib-row strong')?.textContent.includes('tall-poster')&&!document.querySelector('.ib-controls').disabled);
  const dimensions=await page.locator('[data-image-upload]').first().evaluate(img=>({width:img.width,height:img.height,alt:img.alt}));
  assert.deepEqual(dimensions,{width:900,height:9000,alt:'The uploaded campaign artwork'});
  await page.locator('.ib-row').first().locator('[data-image-remove]').click();assert.equal(await page.locator('.ib-row').count(),1);
  await page.locator('[data-sq-undo]').click();assert.equal(await page.locator('.ib-row').count(),2);
  await assert.rejects(()=>call('exportHtml'),/Add one of your products/);
  await page.locator('[data-image-page-product]').selectOption('real-sambal');
  await call('save');await page.reload();await page.waitForFunction(()=>globalThis.EzkartBuilder&&document.querySelectorAll('.ib-row').length===2);
  assert.equal(await page.locator('[data-image-page-product]').inputValue(),'real-sambal');
  assert.equal(await page.locator('.ib-row textarea').first().inputValue(),'The uploaded campaign artwork');
  assert.equal((await ws.read('image-sale')).state.builderMode,'image');
  // Opening an existing image page upgrades its fixed purchase strip without
  // losing its artwork, descriptions or connected catalog product.
  const saved=await ws.read('image-sale');
  saved.state=await page.evaluate(()=>{
    const state=EzkartBuilder.snapshot(),root=document.createElement('div');root.innerHTML=state.preview;
    const checkout=root.querySelector('[data-native-id="image-checkout"]');
    const config=EzkartNative.read(checkout);config.props.position='fixed';config.props.bottom='0px';EzkartNative.write(checkout,config);
    checkout.replaceChildren(EzkartNative.create({id:'image-checkout-add',type:'commerce',part:'add',productId:'real-sambal',group:'image-checkout'}));
    state.preview=root.innerHTML;state.previewStyle='';return state;
  });
  await ws.write('image-sale',saved);await page.reload();
  await page.frameLocator('.ib-phone').locator('[data-product-card="real-sambal"]').waitFor();
  assert.equal(await page.locator('[data-image-page-product]').inputValue(),'real-sambal');
  assert.equal(await page.locator('.ib-row').count(),2);
  assert.equal(await page.locator('.ib-row textarea').first().inputValue(),'The uploaded campaign artwork');
  await call('save');
  assert.match((await ws.read('image-sale')).state.preview,/data-native-id="image-product"/);
  const html=await call('exportHtml');
  const output=await browser.newPage({reducedMotion:'reduce'});await output.setContent(html);
  const card=output.locator('[data-product-card="real-sambal"]');
  assert.equal(await card.count(),1);
  assert.ok(await output.locator('[data-native-id=image-checkout]').evaluate(node=>['static','relative'].includes(getComputedStyle(node).position)));
  assert.ok(await card.evaluate(node=>node.getBoundingClientRect().top>=document.querySelector('[data-image-page]').getBoundingClientRect().bottom));
  assert.equal(await output.locator('[data-image-page]').evaluate(node=>[...node.children].every(child=>child.tagName==='IMG')),true);
  for(const width of [320,390,768,1440]){
    await output.setViewportSize({width,height:1000});
    const bounds=await output.locator('[data-image-page]').boundingBox();assert.ok(Math.abs(bounds.width-Math.min(480,width))<2);
    assert.equal(await output.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
    await output.locator('[data-ezkart-cart-open]').click();
    const drawer=output.locator('.ezkart-cart-drawer');
    assert.equal(await drawer.evaluate(node=>getComputedStyle(node).backgroundColor),'rgb(255, 255, 255)');
    await output.waitForFunction(()=>document.querySelector('.ezkart-cart-layer').classList.contains('is-open'));
    const sheet=await drawer.boundingBox();
    assert.ok(sheet.y>0&&Math.abs(sheet.y+sheet.height-1000)<2,'Cart is a bottom sheet');
    assert.ok(sheet.width<=480&&sheet.x>=0&&sheet.x+sheet.width<=width);
    assert.equal(await output.locator('[data-ezkart-cart-go]').isDisabled(),true);
    assert.equal(await output.locator('.sq-page-preview').evaluate(node=>node.inert),true);
    await output.keyboard.press('Escape');await output.locator('[data-ezkart-cart-layer]').waitFor({state:'hidden'});
    assert.equal(await output.locator('[data-ezkart-cart-open]').evaluate(node=>node===document.activeElement),true);
  }
  await output.setViewportSize({width:390,height:660});
  await card.locator('select[data-ezkart-option-select]').selectOption('Ijo');
  assert.match(await card.locator('footer b').textContent(),/91[.,]000/);
  await card.locator('[data-ezkart-add]').click();
  assert.equal(await output.locator('[data-ezkart-cart-layer]').isVisible(),true);
  assert.match(await output.locator('[data-ezkart-cart-layer]').innerText(),/Ijo/);
  await output.locator('[data-ezkart-cart-quantity="1"]').click();
  assert.match(await output.locator('[data-ezkart-cart-subtotal]').innerText(),/182[.,]000/);
  const thumbnail=await output.locator('.ezkart-cart-row img,.ezkart-cart-thumb').boundingBox();
  assert.equal(thumbnail.width,80);assert.equal(thumbnail.height,96);
  await output.locator('[data-ezkart-cart-quantity="1"]').click();
  await output.locator('[data-ezkart-cart-quantity="1"]').click();
  assert.equal(await output.locator('[data-ezkart-cart-quantity="1"]').isDisabled(),true);
  await output.locator('.ezkart-cart-close').click();await output.locator('[data-ezkart-cart-layer]').waitFor({state:'hidden'});
  await output.locator('[data-ezkart-cart-open]').click();
  assert.match(await output.locator('[data-ezkart-cart-subtotal]').innerText(),/364[.,]000/);
  await output.locator('[data-ezkart-cart-go]').click();
  assert.match(await output.locator('[data-ezkart-cart-items]').textContent(),/No order was placed/);
  await output.close();
  products[0].variants.forEach(variant=>variant.stock=0);await catalog();
  await assert.rejects(()=>call('exportHtml'),/Add stock/);
  products[0].variants[0].stock=3;await catalog();
  for(const width of [320,390,941]){
    await page.setViewportSize({width,height:1000});
    assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
    assert.equal(await page.locator('[data-image-page-add]').isVisible(),true);
  }
  await page.setViewportSize({width:1440,height:1000});
  await page.locator('[data-open-page-creator]').first().click();await page.locator('[data-bc-choose=visual]').click();
  await page.locator('[data-page-creator-form] [name=page_name]').fill('Visual next');await page.locator('[data-create-page]').click();
  await page.waitForURL('**edit=visual-next.ezkart.site');await page.locator('.sq-editor-grid').waitFor({state:'visible'});assert.equal(await page.locator('.ib-editor').isVisible(),false);
  assert.equal(await page.locator('.sq-editor-grid').isVisible(),true);
  assert.equal((await ws.read('image-sale')).state.builderMode,'image');
});

test('the chooser and image editor use the account language while leaving uploaded artwork alone',async t=>{
  const dir=await mkdtemp(join(tmpdir(),'ezkart-image-language-')),ws=await new Workspace(dir).init();
  await writeFile(join(dir,'catalog.json'),JSON.stringify({products:[],language:'id'}));await ws.start();
  const browser=await chromium.launch(),page=await browser.newPage({viewport:{width:390,height:844}});
  t.after(async()=>{await browser.close();await ws.stop();await rm(dir,{recursive:true,force:true});});
  await page.goto(ws.url+'/cart/admin/?page=sites');await page.locator('[data-library-create-card]').click();
  await page.locator('[data-bc-choose=image]').waitFor();assert.match(await page.locator('#library-creator-title').textContent(),/Pilih cara membuat halaman/);
  assert.match(await page.locator('[data-bc-choose=image]').textContent(),/Gunakan Susun Gambar/);
  assert.match(await page.locator('[data-bc-choose=visual]').textContent(),/Gunakan Studio Halaman/);
  assert.equal(await page.locator('#library-page-creator-dialog').evaluate(node=>node.scrollWidth>node.clientWidth),false);
  await page.locator('[data-bc-choose=image]').click();await page.locator('[name=page_name]').fill('Halaman gambar');await page.locator('[data-library-page-form] button[value=default]').click();
  await page.waitForURL('**edit=halaman-gambar.ezkart.site');await page.locator('[data-image-page-add]').waitFor();
  assert.match(await page.locator('[data-image-page-add]').textContent(),/Unggah gambar/);
  assert.match(await page.locator('.ib-stage').textContent(),/khusus tampilan ponsel/);
  await page.getByRole('checkbox',{name:'Tampilkan bilah navigasi',exact:true}).check();
  assert.equal(await page.getByRole('combobox',{name:'Perilaku saat digulir',exact:true}).count(),1);
  assert.equal(await page.locator('[data-image-nav=ctaLabel]').inputValue(),'Belanja sekarang');
});
