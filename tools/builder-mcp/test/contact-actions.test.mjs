import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp, writeFile, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {chromium} from 'playwright';
import {Workspace} from '../workspace.mjs';

test('contact defaults to seller messages, switches to email, and persists through history and export', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'ezkart-contact-'));
  await writeFile(join(dir, 'catalog.json'), JSON.stringify({products:[{id:'seller-product',name:'Product',price:10000,stock:5}],publicBase:'https://test.ezkart.id/cart/admin/'}));
  const ws = await new Workspace(dir).init();
  await ws.create({id:'contact',name:'Contact check',productIds:['seller-product']});
  await ws.start();
  const browser = await chromium.launch();
  const page = await browser.newPage({viewport:{width:1500,height:1000}});
  const errors=[];page.on('pageerror',e=>errors.push(e.message));
  const call=(method,args={})=>page.evaluate(({method,args})=>EzkartBuilder[method](args),{method,args});
  try {
    await page.goto(ws.url+'/cart/admin/?page=sites&edit=contact.ezkart.site');
    await page.waitForFunction(()=>globalThis.EzkartBuilder);
    await page.evaluate(()=>{
      for(const id of ['contact-letter','contact-card','contact-details']) {
        const recipe=EzkartAssets.create(id);
        EzkartBuilder.nativeInsert({section:'blank',node:recipe});
      }
    });
    await call('settle');
    const contacts=await page.locator('.sq-page-preview [data-native-action]').evaluateAll(nodes=>nodes.filter(n=>JSON.parse(n.dataset.nativeAction).type==='contact').map(n=>n.dataset.nativeId));
    assert.equal(contacts.length,3);
    const button=page.locator(`[data-native-id="${contacts[0]}"]`);
    await button.click();
    const type=page.locator('[data-native-action-type]');
    await type.locator('xpath=ancestor::details[1]/summary').click();
    assert.equal(await type.inputValue(),'contact');
    assert.equal(await page.locator('[data-native-action-target]').isVisible(),false);
    // Exercise the universal dropdown using its keyboard interaction.
    await type.focus();await page.keyboard.press('e');await page.keyboard.press('Tab');
    assert.equal(await type.inputValue(),'email');
    await page.locator('[data-native-action-target]').fill('hello@example.com');
    await page.locator('[data-native-action-apply]').click();
    assert.equal(JSON.parse(await button.getAttribute('data-native-action')).type,'email');
    await call('undo');assert.equal(JSON.parse(await button.getAttribute('data-native-action')).type,'contact');
    await call('redo');assert.equal(JSON.parse(await button.getAttribute('data-native-action')).type,'email');
    await call('save');await page.reload();await page.waitForFunction(()=>globalThis.EzkartBuilder);await call('settle');
    assert.equal(JSON.parse(await button.getAttribute('data-native-action')).target,'hello@example.com');
    await page.setViewportSize({width:941,height:1000});await button.click();
    if (!await type.isVisible()) await type.locator('xpath=ancestor::details[1]/summary').click();
    await page.locator('[data-native-action-target]').scrollIntoViewIfNeeded();
    assert.equal(await page.locator('[data-native-action-target]').isVisible(),true);
    await page.screenshot({path:'/tmp/ezkart-contact-settings.png'});
    const html=await call('previewHtml');
    const preview=await browser.newPage();await preview.setContent(html);
    const root=preview.locator('.sq-page-preview');
    assert.equal(await root.getAttribute('data-ezkart-contact-url'),'https://test.ezkart.id/cart/messages.php?product=seller-product');
    assert.equal(await preview.locator(`[data-native-id="${contacts[0]}"]`).getAttribute('href'),'mailto:hello@example.com');
    const defaultButton=preview.locator(`[data-native-id="${contacts[1]}"]`);
    assert.equal(await defaultButton.getAttribute('href'),'https://test.ezkart.id/cart/messages.php?product=seller-product');
    await preview.evaluate(()=>{window.open=(url)=>{window.contactOpened=url;};});
    await defaultButton.click();assert.equal(await preview.evaluate(()=>window.contactOpened),'https://test.ezkart.id/cart/messages.php?product=seller-product');
    await button.click();
    if (!await type.isVisible()) await type.locator('xpath=ancestor::details[1]/summary').click();
    await type.focus();await page.keyboard.press('Home');await page.keyboard.press('ArrowDown');await page.keyboard.press('Tab');
    assert.equal(await type.inputValue(),'contact');
    await page.locator('[data-native-action-apply]').click();
    await page.locator('[data-native-action-note]').scrollIntoViewIfNeeded();
    await page.screenshot({path:'/tmp/ezkart-contact-dashboard-settings.png'});
    await call('save');await page.reload();await page.waitForFunction(()=>globalThis.EzkartBuilder);await call('settle');
    assert.equal(JSON.parse(await button.getAttribute('data-native-action')).type,'contact');
    await ws.create({id:'empty-contact',name:'Draft without product'});
    await page.goto(ws.url+'/cart/admin/?page=sites&edit=empty-contact.ezkart.site');
    await page.waitForFunction(()=>globalThis.EzkartBuilder);
    await call('nativeInsert',{section:'blank',node:{id:'draft-contact',type:'button',tag:'a',text:'Contact',action:{type:'contact'}}});
    await preview.setContent(await call('previewHtml'));
    assert.equal(await preview.locator('.sq-page-preview').getAttribute('data-ezkart-contact-url'),'');
    assert.equal(await preview.locator('[data-native-id="draft-contact"]').getAttribute('href'),null);
    assert.equal(await preview.locator('[data-native-id="draft-contact"]').getAttribute('aria-disabled'),'true');
    assert.deepEqual(errors,[]);
  } finally {await browser.close();await ws.stop();await rm(dir,{recursive:true,force:true});}
});
