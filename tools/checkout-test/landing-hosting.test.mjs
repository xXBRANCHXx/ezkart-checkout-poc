import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import {setTimeout as delay} from 'node:timers/promises';
import {fileURLToPath} from 'node:url';
import {chromium} from '../builder-mcp/node_modules/playwright/index.mjs';

test('PHP page hosting serves only the current environment publication with an isolated runtime', async t => {
  const requests=[];
  const upstream=createServer((req,res)=>{
    requests.push({url:req.url,authorization:req.headers.authorization});
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
  const php=spawn(process.env.PHP_BINARY||'php',[...args,'-S',`127.0.0.1:${port}`,'-t',fileURLToPath(new URL('../..',import.meta.url))],{
    env:{...process.env,EZKART_CLOUDFLARE_API_URL:`http://127.0.0.1:${upstream.address().port}`,EZKART_DEPLOYMENT_ENVIRONMENT:'test'},
    stdio:'ignore',
  });
  t.after(async()=>{if(php.exitCode===null){php.kill();await once(php,'exit');}});
  let startError;php.on('error',error=>{startError=error;});
  const base=`http://127.0.0.1:${port}/cart/page.php`;
  let ready=false;
  for(let n=0;n<100;n++){
    if(startError)throw startError;
    try {await fetch(base);ready=true;break;}catch{await delay(25);}
  }
  assert.ok(ready,'PHP must start');
  const response=await fetch(base+'?store=coffee-shop&page=launch');
  assert.equal(response.status,200);
  assert.match(await response.text(),/Stored publication/);
  assert.match(response.headers.get('content-security-policy'),/sandbox allow-scripts/);
  assert.doesNotMatch(response.headers.get('content-security-policy'),/allow-same-origin/);
  assert.match(response.headers.get('cache-control'),/no-store/);
  assert.equal(response.headers.get('x-robots-tag'),'noindex, nofollow');
  assert.deepEqual(requests,[{url:'/v1/public/landing-pages/coffee-shop/launch',authorization:undefined}]);
  assert.equal((await fetch(base+'?store=coffee-shop&page=missing')).status,404);
  const bad=await fetch(base+'?store=coffee-shop&page=bad-response');
  assert.equal(bad.status,503);assert.doesNotMatch(await bad.text(),/private|Internal error/);
  const count=requests.length;
  assert.equal((await fetch(base+'?store=../private&page=launch')).status,404);
  assert.equal((await fetch(base+'?store=coffee-shop&page=launch',{method:'POST'})).status,405);
  assert.equal(requests.length,count,'Invalid paths and writes never reach the Worker');

  const browser=await chromium.launch();t.after(()=>browser.close());
  const context=await browser.newContext(), page=await context.newPage();
  const url=base+'?store=coffee-shop&page=launch';
  for(const replaceHeaders of [false,true]){
    if(replaceHeaders)await page.route('**/cart/page.php?*',async route=>{
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
});
