import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {readFile} from 'node:fs/promises';
import {join} from 'node:path';
import {chromium} from 'playwright';
import {repoRoot} from '../workspace.mjs';
import {mountLandingMediaPlayer} from '../../../cart/landing-media-player.js';
const escape=s=>s.replaceAll('&','&amp;').replaceAll('"','&quot;').replaceAll('<','&lt;');

test('trusted YouTube host isolates authored frames, validates message sources and restores keyboard focus',async t=>{
 const [helper,host]=await Promise.all(['cart/admin/builder-media.js','cart/landing-media-player.js'].map(file=>readFile(join(repoRoot,file),'utf8')));
 const authored=`<body><script>${helper};document.body.append(EzkartMedia.createYoutube({url:'https://youtu.be/M7lc1UVf-VE',title:'Video demo'}));EzkartMedia.mount(document.body);</script></body>`;
 const nested=`<iframe data-hosted-page sandbox="allow-scripts allow-forms allow-popups allow-popups-to-escape-sandbox allow-top-navigation-by-user-activation" srcdoc="${escape(authored)}"></iframe><script>(${mountLandingMediaPlayer.toString()})(document);</script>`;
 const server=createServer((req,res)=>{res.setHeader('Content-Type',req.url==='/player.js'?'text/javascript':'text/html');res.end(req.url==='/player.js'?host:`<script type="module" src="/player.js"></script><iframe data-hosted-page sandbox="allow-scripts allow-forms allow-popups allow-popups-to-escape-sandbox allow-top-navigation-by-user-activation" srcdoc="${escape(req.url==='/nested'?nested:authored)}"></iframe><iframe id="unrelated" srcdoc="<button>Other page</button>"></iframe>`);});
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const base=`http://127.0.0.1:${server.address().port}`;
 const browser=await chromium.launch(),page=await browser.newPage({viewport:{width:390,height:800}});page.setDefaultTimeout(8000);
 t.after(async()=>{await browser.close();await new Promise(resolve=>server.close(resolve));});
 let referrer='';await page.route('https://www.youtube-nocookie.com/**',route=>{referrer=route.request().headers().referer||'';return route.fulfill({contentType:'text/html',body:'<body>Fixture host player</body>'});});
 await page.goto(base);await page.waitForFunction(()=>Boolean(globalThis.EzkartLandingMediaPlayer));
 const frame=page.frameLocator('iframe[data-hosted-page]');await frame.getByRole('button',{name:'Play Video demo'}).waitFor();
 const isolation=await frame.locator('body').evaluate(()=>{let parentBlocked=false,storageBlocked=false;try{parent.document.body.innerHTML;}catch{parentBlocked=true;}try{localStorage.setItem('unsafe','value');}catch{storageBlocked=true;}return {parentBlocked,storageBlocked};});assert.deepEqual(isolation,{parentBlocked:true,storageBlocked:true});
 const play={type:'ezkart:youtube-play',channel:'spoof',id:'M7lc1UVf-VE',start:0,controls:true,title:'Spoof'};
 await page.evaluate(message=>postMessage(message,'*'),play);await page.frameLocator('#unrelated').locator('body').evaluate((_,message)=>parent.postMessage(message,'*'),play);assert.equal(await page.locator('[data-youtube-host-player]').count(),0);
 await frame.locator('body').evaluate((_,message)=>parent.postMessage({...message,id:'<script>'},'*'),play);await frame.locator('body').evaluate((_,message)=>parent.postMessage({...message,start:Infinity},'*'),play);assert.equal(await page.locator('[data-youtube-host-player]').count(),0);
 await frame.getByRole('button',{name:'Play Video demo'}).click();const dialog=page.locator('[data-youtube-host-player]');await dialog.frameLocator('iframe').getByText('Fixture host player').waitFor();assert.ok(referrer.startsWith(base));assert.equal(await dialog.locator('iframe').getAttribute('title'),'Video demo');
 const bounds=await dialog.boundingBox();assert.ok(bounds.width<=390&&bounds.x>=0);assert.ok((await dialog.locator('iframe').boundingBox()).height>=200);
 assert.equal(await page.getByRole('button',{name:'Close video'}).evaluate(n=>n===document.activeElement),true);await page.keyboard.press('Escape');assert.equal(await dialog.count(),0);assert.equal(await frame.getByRole('button',{name:'Play Video demo'}).evaluate(n=>n===document.activeElement),true);
 await frame.getByRole('button',{name:'Play Video demo'}).click();await dialog.waitFor();await page.getByRole('button',{name:'Close video'}).click();assert.equal(await dialog.count(),0);
 await page.goto(base+'/nested');const deep=page.frameLocator('iframe[data-hosted-page]').frameLocator('iframe[data-hosted-page]');await deep.getByRole('button',{name:'Play Video demo'}).click();await page.locator('[data-youtube-host-player]').frameLocator('iframe').getByText('Fixture host player').waitFor();
 assert.equal(await frame.locator('[data-youtube-host-player]').count(),0,'Opaque intermediate host forwards to trusted outer host');await page.keyboard.press('Escape');assert.equal(await deep.getByRole('button',{name:'Play Video demo'}).evaluate(n=>n===document.activeElement),true);

});
