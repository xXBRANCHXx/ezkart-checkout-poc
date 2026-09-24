import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {spawn, spawnSync} from 'node:child_process';
import {mkdtemp, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {once} from 'node:events';
import {setTimeout as delay} from 'node:timers/promises';
import {fileURLToPath} from 'node:url';
import {chromium} from '../builder-mcp/node_modules/playwright/index.mjs';

test('PHP page hosting serves only the current environment publication with an isolated runtime', async t => {
  const requests=[];
  const savePreferences=[];
  const sessions=await mkdtemp(join(tmpdir(),'ezkart-url-sessions-'));
  t.after(()=>rm(sessions,{recursive:true,force:true}));
  const upstream=createServer((req,res)=>{
    requests.push({url:req.url,authorization:req.headers.authorization});
    if(req.url==='/v1/landing-pages/launch' && req.method==='PUT') {
      savePreferences.push(req.headers.prefer);
      res.writeHead(200,{'Content-Type':'application/json'});
      res.end(JSON.stringify({ok:true,page:{id:'launch',status:'published',updatedAt:'saved',publishedAt:'saved'}}));
      return;
    }
    if(req.url.endsWith('/view')) {
      if(!req.headers.authorization){res.writeHead(401);res.end('Sign in');return;}
      if(req.headers['x-ezkart-preview-store'] && !['coffee-shop','coffee-shop-0123456789'].includes(req.headers['x-ezkart-preview-store'])){res.writeHead(404);res.end('Page not found');return;}
      res.setHeader('x-ezkart-preview-path','/coffee-shop/shop/launch/preview');
    }
    if(req.url.includes('/public/landing-pages/')) res.setHeader('x-ezkart-public-path','/coffee-shop/shop/launch');
    if(req.url.endsWith('/missing')) {res.writeHead(404);res.end('Internal error details');return;}
    if(req.url.endsWith('/bad-response')) {res.writeHead(200,{'Content-Type':'application/json'});res.end('{"private":"data"}');return;}
    res.writeHead(200,{'Content-Type':'text/html; charset=utf-8'});
    res.end('<!doctype html><html lang="id"><head><title>Hosted coffee</title><meta name="description" content="Kopi &amp; susu"><link rel="icon" data-ezkart-favicon data-light="data:image/png;base64,aGVsbG8=" data-dark="data:image/png;base64,d29ybGQ="></head><body><h1>Stored publication</h1><button id="checkout">Checkout</button><script>window.ready=true;document.querySelector("button").onclick=()=>{const params=new URLSearchParams({return:location.href});window.open("/checkout?"+params,"_blank","noopener");};</script>');
  });
  await new Promise(resolve=>upstream.listen(0,'127.0.0.1',resolve));
  t.after(()=>new Promise(resolve=>upstream.close(resolve)));
  const probe=createServer();await new Promise(resolve=>probe.listen(0,'127.0.0.1',resolve));
  const port=probe.address().port;await new Promise(resolve=>probe.close(resolve));
  const args=process.env.PHP_CURL_EXTENSION?['-d','extension='+process.env.PHP_CURL_EXTENSION]:[];
  const env={...process.env,EZKART_CLOUDFLARE_API_URL:`http://127.0.0.1:${upstream.address().port}`,EZKART_DEPLOYMENT_ENVIRONMENT:'test',EZKART_ADMIN_SESSION_STORAGE:sessions};
  const php=spawn(process.env.PHP_BINARY||'php',[...args,'-S',`127.0.0.1:${port}`,'-t',fileURLToPath(new URL('../..',import.meta.url)),fileURLToPath(new URL('./landing-router.php',import.meta.url))],{
    env,
    stdio:'ignore',
  });
  t.after(async()=>{if(php.exitCode===null){php.kill();await once(php,'exit');}});
  let startError;php.on('error',error=>{startError=error;});
  const base=`http://127.0.0.1:${port}`;
  const publicUrl=base+'/coffee-shop/shop/launch';
  let ready=false;
  for(let n=0;n<100;n++){
    if(startError)throw startError;
    try {await fetch(base);ready=true;break;}catch{await delay(25);}
  }
  assert.ok(ready,'PHP must start');
  const response=await fetch(publicUrl);
  const legacy=await fetch(base+'/cart/page.php?store=coffee-shop&page=launch',{redirect:'manual'});
  assert.equal(legacy.status,302);assert.equal(legacy.headers.get('location'),'/coffee-shop/shop/launch');
  const slash=await fetch(publicUrl+'/',{redirect:'manual'});
  assert.equal(slash.status,308);assert.equal(slash.headers.get('location'),'/coffee-shop/shop/launch');
  assert.equal(response.status,200);
  assert.match(await response.text(),/Stored publication/);
  assert.match(response.headers.get('content-security-policy'),/sandbox allow-scripts/);
  assert.doesNotMatch(response.headers.get('content-security-policy'),/allow-same-origin/);
  assert.match(response.headers.get('cache-control'),/no-store/);
  assert.equal(response.headers.get('x-robots-tag'),'noindex, nofollow');
  assert.deepEqual(requests,[{url:'/v1/public/landing-pages/coffee-shop/launch',authorization:undefined}]);
  const oldBusiness=await fetch(base+'/coffee-shop-0123456789/shop/launch',{redirect:'manual'});
  assert.equal(oldBusiness.status,302);assert.equal(oldBusiness.headers.get('location'),'/coffee-shop/shop/launch');
  assert.equal((await fetch(base+'/coffee-shop/shop/missing')).status,404);
  const bad=await fetch(base+'/coffee-shop/shop/bad-response');
  assert.equal(bad.status,503);assert.doesNotMatch(await bad.text(),/private|Internal error/);
  const count=requests.length;
  assert.equal((await fetch(base+'/cart/page.php?store=../private&page=launch')).status,404);
  assert.equal((await fetch(publicUrl,{method:'POST'})).status,405);
  assert.equal(requests.length,count,'Invalid paths and writes never reach the Worker');

  const browser=await chromium.launch();t.after(()=>browser.close());
  const context=await browser.newContext(), page=await context.newPage();
  const url=publicUrl;
  for(const replaceHeaders of [false,true]){
    if(replaceHeaders)await page.route('**/coffee-shop/shop/launch',async route=>{
      const source=await route.fetch();
      await route.fulfill({response:source,headers:{...source.headers(),'content-security-policy':'upgrade-insecure-requests'}});
    });
    await page.goto(url);
    const frame=await page.locator('[data-hosted-page]').elementHandle().then(node=>node.contentFrame());
    assert.equal(await frame.locator('h1').innerText(),'Stored publication');
    assert.equal(await frame.evaluate(()=>window.ready),true);
    assert.equal(await page.title(),'Hosted coffee');
    assert.equal(await page.locator('html').getAttribute('lang'),'id');
    assert.equal(await page.locator('meta[name=description]').getAttribute('content'),'Kopi & susu');
    assert.equal(await page.locator('link[rel=icon]').count(),2);
    assert.equal(await frame.evaluate(()=>{try{return Boolean(parent.document);}catch{return false;}}),false,'Markup isolation survives provider header replacement');
    assert.equal(await frame.evaluate(()=>{try{localStorage.setItem('probe','yes');return true;}catch{return false;}}),false);
    const popup=context.waitForEvent('page');
    await frame.locator('#checkout').click();
    const checkout=await popup;await checkout.waitForURL('**/checkout?*');
    assert.equal(new URL(checkout.url()).searchParams.get('return'),url,'Legacy checkout returns to the real hosted URL');
    await checkout.close();
  }
  await page.unrouteAll();
  const previewUrl=publicUrl+'/preview';
  await page.goto(previewUrl);
  await page.locator('[data-preview-sign-in]').waitFor({state:'visible'});
  assert.equal(page.url(),previewUrl);
  assert.equal(await page.locator('[data-hosted-page]').count(),0);
  const csrf='fixture-publication-csrf-token-1234567890';
  const data=Buffer.from(JSON.stringify({csrf_token:csrf,authenticated:true,authentication_method:'supabase',authenticated_until:Math.floor(Date.now()/1000)+3600,signed_in_at:Math.floor(Date.now()/1000),supabase_access_token:'fixture-preview-token',mfa_enabled:false,legacy_data_access:false,admin_user:{id:'fixture-user',email:'test@example.test'}})).toString('base64');
  const setup=spawnSync(process.env.PHP_BINARY||'php',[...args,'-r',`session_save_path(getenv('EZKART_ADMIN_SESSION_STORAGE'));session_name('ezkart_admin');session_start();$_SESSION=json_decode(base64_decode('${data}'),true);echo session_id();session_write_close();`],{env,encoding:'utf8'});
  assert.equal(setup.status,0,setup.stderr);
  await context.addCookies([{name:'ezkart_admin',value:setup.stdout.trim(),domain:'127.0.0.1',path:'/cart/admin',httpOnly:true,sameSite:'Lax'}]);
  const saveUrl=base+'/cart/admin/?cloud='+encodeURIComponent('/v1/landing-pages/launch');
  const receipt=await context.request.put(saveUrl,{headers:{'X-Ezkart-Csrf':csrf,Prefer:'return=minimal'},data:{status:'published'}});
  assert.equal(receipt.status(),200);
  assert.equal((await receipt.json()).page.status,'published');
  assert.deepEqual(savePreferences,['return=minimal'],'The authenticated proxy forwards the compact-response preference');
  const denied=await context.request.put(saveUrl,{headers:{Prefer:'return=minimal'},data:{status:'published'}});
  assert.equal(denied.status(),403);
  assert.equal(savePreferences.length,1,'Compact replies never bypass the CSRF check');
  const navigation=page.waitForRequest(previewUrl);
  await page.reload();
  assert.equal((await (await navigation).allHeaders()).cookie,undefined,'Admin cookies stay outside public URL paths');
  const previewFrame=await page.locator('[data-hosted-page]').elementHandle().then(node=>node.contentFrame());
  assert.equal(await previewFrame.locator('h1').innerText(),'Stored publication');
  assert.equal(page.url(),previewUrl);
  assert.equal(await previewFrame.evaluate(()=>document.baseURI),previewUrl);
  await page.goto(base+'/coffee-shop-0123456789/shop/launch/preview');
  await page.waitForURL(previewUrl);
  await page.locator('[data-hosted-page]').waitFor();
  const canonicalFrame=await page.locator('[data-hosted-page]').elementHandle().then(node=>node.contentFrame());
  const oldPreview=base+'/cart/admin/?cloud='+encodeURIComponent('/v1/landing-pages/launch/view');
  const moved=await context.request.get(oldPreview,{maxRedirects:0});
  assert.equal(moved.status(),302);assert.equal(moved.headers().location,'/coffee-shop/shop/launch/preview');
  assert.ok(requests.some(request=>request.url==='/v1/landing-pages/launch/view' && request.authorization==='Bearer fixture-preview-token'));
  const popup=context.waitForEvent('page');
  await canonicalFrame.locator('#checkout').click();
  const checkout=await popup;await checkout.waitForURL('**/checkout?*');
  assert.equal(new URL(checkout.url()).searchParams.get('return'),previewUrl);
  await checkout.close();
  await page.goto(base+'/another-business/shop/launch/preview');
  await page.waitForFunction(()=>document.querySelector('[data-preview-status]')?.textContent.includes('could not be loaded'));
  assert.equal(await page.locator('[data-hosted-page]').count(),0);

});
