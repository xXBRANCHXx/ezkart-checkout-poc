import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {chromium} from 'playwright';
import {Workspace} from '../workspace.mjs';
import {openAssets,chooseBasic} from './asset-helpers.mjs';

test('Indonesian builder keeps authored canvas text unchanged while translating controls',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'ezkart-language-')),ws=await new Workspace(dir).init();await ws.start();
 const browser=await chromium.launch(),page=await browser.newPage({viewport:{width:1440,height:1000}});
 try{
  await page.route('**/cart/admin/?**',async route=>{const response=await route.fetch();await route.fulfill({response,body:(await response.text()).replace('<body class=','<body data-admin-language="id" class=')});});
  await page.goto(ws.url+'/cart/admin/?page=sites');
  await page.locator('[data-library-create-card]').click();await page.locator('[data-bc-choose=visual]').click();
  const form=page.locator('[data-library-page-form]');await form.locator('[name=page_name]').fill('Orders');await form.locator('button[value=default]').click();
  await page.waitForURL('**edit=orders.ezkart.site');await page.waitForFunction(()=>globalThis.EzkartBuilder);
  await openAssets(page);await chooseBasic(page,'native-heading');
  const id=await page.evaluate(()=>EzkartBuilder.nativeInspect().filter(n=>n.type==='heading').at(-1).id);
  const heading=page.locator(`[data-native-id="${id}"]`);
  await page.locator('[data-sq-tab=add]').click();
  await page.locator('[data-native-text]').fill('Orders');await page.locator('[data-native-text]').press('Tab');
  await page.waitForTimeout(150);
  assert.equal(await heading.textContent(),'Orders');
  assert.equal(await page.locator('[data-current-site-name]').textContent(),'Orders');
  assert.equal(await page.locator('html').getAttribute('lang'),'id');
  assert.equal(await page.getByRole('button',{name:'Terbitkan',exact:true}).count(),1);
  await page.screenshot({path:'/tmp/ezkart-language-builder-desktop.png',fullPage:true});
  await page.setViewportSize({width:820,height:1000});await page.screenshot({path:'/tmp/ezkart-language-builder-narrow.png',fullPage:true});
 }finally{await browser.close();await ws.stop();await rm(dir,{recursive:true,force:true});}
});
