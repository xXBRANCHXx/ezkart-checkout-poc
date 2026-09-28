import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {chromium} from 'playwright';
import {repoRoot} from '../workspace.mjs';
import {join} from 'node:path';
test('domain management connects a published page, shows DNS/TLS, renews and disconnects at desktop/mobile',async t=>{
 const browser=await chromium.launch();t.after(()=>browser.close());const page=await browser.newPage({viewport:{width:1200,height:900}});page.setDefaultTimeout(6000);
 const errors=[];page.on('pageerror',e=>errors.push(e.message));
 const php=(await readFile(join(repoRoot,'cart/admin/advanced.php'),'utf8')).replace(/<\?[\s\S]*?\?>/g,'');
 const markup=php.slice(php.indexOf('<section class="surface domain-management"'));
 const files=Object.fromEntries(await Promise.all(['admin.css','admin-ui.css','advanced.css','custom-domains.js'].map(async name=>[name,await readFile(join(repoRoot,'cart/admin',name),'utf8')])));
 let domains=[],canEdit=true;const calls=[];
 await page.route('**/*',async route=>{
  const req=route.request(),url=new URL(req.url()),path=url.searchParams.get('cloud');
  if(path){
   if(path==='/v1/landing-pages')return route.fulfill({json:{ok:true,pages:[{id:'home',name:'Home page',status:'published'},{id:'draft',name:'Draft page',status:'draft'}]}});
   if(req.method()==='POST'){
    assert.equal(req.headers()['x-ezkart-csrf'],'fixture-csrf');calls.push(path);
    if(path==='/v1/custom-domains'){assert.deepEqual(req.postDataJSON(),{hostname:'shop.brand.com',pageId:'home'});domains=[{id:'dom_'+'a'.repeat(32),hostname:'shop.brand.com',pageId:'home',state:'pending',challengeExpiresAt:'2026-10-01',dns:[{type:'TXT',name:'_ezkart-domain.shop.brand.com',value:'ezkart-'+'a'.repeat(64)},{type:'CNAME',name:'shop.brand.com',value:'shops.ezkart.site'}]}];}
    if(path.endsWith('/verify')){domains[0].state='active';domains[0].tlsStatus='active';}
    if(path.endsWith('/renew')){domains[0].state='pending';domains[0].dns[0].value='new-ownership-code';}
    if(path.endsWith('/disconnect'))domains=[];
    return route.fulfill({json:{ok:true,domain:domains[0]||{disconnected:true}}});
   }
   return route.fulfill({json:{ok:true,domains,canEdit,configured:true}});
  }
  const name=url.pathname.split('/').at(-1);if(files[name])return route.fulfill({body:files[name],contentType:name.endsWith('.js')?'text/javascript':'text/css'});
  return route.fulfill({contentType:'text/html',body:`<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="admin.css"><link rel="stylesheet" href="admin-ui.css"><link rel="stylesheet" href="advanced.css"><body class="dashboard-page page-advanced" data-admin-cloud-enabled="true" data-admin-csrf-token="fixture-csrf"><main style="max-width:1100px;margin:auto;padding:12px">${markup}</main><script src="custom-domains.js"></script>`});
 });
 await page.goto('https://fixture.test/');await page.getByText('No domains connected yet.').waitFor();
 assert.equal(await page.getByText('Draft page',{exact:true}).count(),0);
 await page.getByPlaceholder('shop.yourbrand.com').fill('shop.brand.com');await page.getByLabel('Home page').check();await page.getByRole('button',{name:'Connect domain',exact:true}).click();
 await page.getByRole('heading',{name:'shop.brand.com'}).waitFor();assert.match(await page.locator('[data-domain-list]').innerText(),/HTTPS: not requested/);
 for(const width of [1200,390]){await page.setViewportSize({width,height:900});assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);await page.screenshot({path:`/tmp/ezkart-domains-${width}.png`,fullPage:true});}
 await page.getByRole('button',{name:'Check DNS and HTTPS'}).click();await page.getByRole('link',{name:'Open domain'}).waitFor();
 await page.getByRole('button',{name:'Generate new ownership code'}).click();await page.getByText('new-ownership-code',{exact:true}).waitFor();
 await page.getByRole('button',{name:'Disconnect domain'}).click();await page.getByText('Domain disconnected. Remove its DNS records when ready.').waitFor();assert.equal(await page.locator('.domain-connection').count(),0);
 canEdit=false;await page.getByRole('button',{name:'Refresh connections'}).click();await page.getByText('Only the store owner can manage domains.').waitFor();assert.equal(await page.getByRole('button',{name:'Connect domain',exact:true}).isDisabled(),true);
 assert.equal(calls.length,4);assert.deepEqual(errors,[]);
});
