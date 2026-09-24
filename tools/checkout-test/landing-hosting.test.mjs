import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import {setTimeout as delay} from 'node:timers/promises';
import {fileURLToPath} from 'node:url';

test('PHP page hosting serves only the current environment publication with an isolated runtime', async t => {
  const requests=[];
  const upstream=createServer((req,res)=>{
    requests.push({url:req.url,authorization:req.headers.authorization});
    if(req.url.endsWith('/missing')) {res.writeHead(404);res.end('Internal error details');return;}
    if(req.url.endsWith('/bad-response')) {res.writeHead(200,{'Content-Type':'application/json'});res.end('{"private":"data"}');return;}
    res.writeHead(200,{'Content-Type':'text/html; charset=utf-8'});
    res.end('<!doctype html><h1>Stored publication</h1><script>window.ready=true</script>');
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
});
