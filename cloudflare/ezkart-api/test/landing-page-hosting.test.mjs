import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {decodeHTML} from 'entities';
import {chromium} from '../../../tools/builder-mcp/node_modules/playwright/index.mjs';
import {hostedLandingResponse, landingPageFrame, landingPagePolicy, landingPageSandbox} from '../src/landing-page-hosting.js';

const authoredSource = shell => decodeHTML(shell.match(/\bsrcdoc="([^"]*)"/)?.[1] || '');

test('trusted shell escapes authored HTML and preserves safe metadata, streams, and durable checkout links', async () => {
  const authored = '<!doctype html><html lang="id"><head><title>&lt;/title&gt;&lt;script&gt;attack()&lt;/script&gt;</title><meta name="description" content="Kopi &amp; susu"><link data-ezkart-favicon data-light="data:image/png;base64,aGVsbG8=" data-dark="javascript:attack()"><style id="ezkart-library-preview-style">.paused{animation:none}</style><script>headAttack()</script></head><body><h1>Saved publication</h1><script>const params={return:location.href};</script></body></html>';
  const shell = landingPageFrame(authored);
  assert.match(shell, /<html lang="id">/);
  assert.match(shell, /<title>&lt;\/title&gt;&lt;script&gt;attack\(\)&lt;\/script&gt;<\/title>/);
  assert.match(shell, /content="Kopi &amp; susu"/);
  assert.equal((shell.match(/<link rel="icon"/g) || []).length, 2);
  assert.doesNotMatch(shell.split('<body>')[0], /javascript:|<script>/);
  assert.equal((shell.match(/<script>/g) || []).length, 1, 'Only the fixed host player runs in the shell');
  const inner = authoredSource(shell);
  assert.match(inner, /headAttack\(\)/);
  assert.doesNotMatch(inner, /ezkart-library-preview-style/);
  assert.match(inner, /return:\(location.href==='about:srcdoc'\?document.baseURI:location.href\)/);
  assert.match(shell, new RegExp(`sandbox="${landingPageSandbox}"`));
  assert.doesNotMatch(landingPageSandbox, /allow-same-origin/);
  assert.match(landingPagePolicy, /; sandbox allow-scripts/,'Direct authored callers retain the opaque CSP');
  const stream = new Blob([authored]).stream();
  const streamed = hostedLandingResponse(stream);
  assert.equal(await streamed.text(), shell);
  assert.doesNotMatch(streamed.headers.get('content-security-policy'), /\bsandbox\b/);
  assert.equal(streamed.headers.get('referrer-policy'), 'strict-origin-when-cross-origin');
  assert.equal(streamed.headers.get('x-robots-tag'), 'noindex, nofollow');
  const head = hostedLandingResponse(null, {noindex:false});
  assert.equal(await head.text(), '');
  assert.equal(head.headers.get('x-robots-tag'), null);
});

test('hosted player accepts only its isolated page frame and fixed YouTube requests at desktop and mobile widths', async t => {
  const authored = '<!doctype html><html><head><title>Hosted video fixture</title></head><body><h1>Saved page</h1><button id="play">Play video</button><script>window.ready=true;window.checkoutReturn=new URLSearchParams({return:location.href}).get("return");document.querySelector("button").onclick=()=>parent.postMessage({type:"ezkart:youtube-play",channel:"fixture",id:"M7lc1UVf-VE",start:42,controls:true,title:"Video <img src=x onerror=alert(1)>"},"*");</script></body></html>';
  const server = createServer(async (_request, response) => {
    const hosted = hostedLandingResponse(authored);
    response.writeHead(hosted.status, Object.fromEntries(hosted.headers));
    response.end(await hosted.text());
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));
  const browser = await chromium.launch();
  t.after(() => browser.close());
  const context = await browser.newContext();
  const page = await context.newPage();
  await page.route('https://www.youtube-nocookie.com/**', route => route.fulfill({contentType:'text/html', body:'<!doctype html><title>Trusted player fixture</title>'}));
  const url = `http://127.0.0.1:${server.address().port}/store/shop/video`;
  await context.addCookies([{name:'merchantSecret',value:'private',domain:'127.0.0.1',path:'/'}]);
  for (const width of [1440, 941, 390]) {
    await page.setViewportSize({width, height:800});
    await page.goto(url);
    const frame = await page.locator('[data-hosted-page]').elementHandle().then(node => node.contentFrame());
    assert.equal(await frame.evaluate(() => window.ready), true);
    assert.equal(await frame.evaluate(() => window.checkoutReturn), url);
    assert.equal(await frame.evaluate(() => {try {return Boolean(parent.document);} catch {return false;}}), false);
    assert.equal(await frame.evaluate(() => {try {return document.cookie;} catch {return 'blocked';}}), 'blocked');
    assert.equal(await frame.evaluate(() => {try {localStorage.setItem('secret','value'); return true;} catch {return false;}}), false);
    assert.equal(await frame.evaluate(() => self.origin), 'null');
    // A window outside the registered authored iframe has no player privileges.
    await page.evaluate(() => window.postMessage({type:'ezkart:youtube-play',channel:'fake',id:'M7lc1UVf-VE',start:0,controls:true}, '*'));
    await frame.evaluate(() => parent.postMessage({type:'ezkart:youtube-play',channel:'fixture',id:'javascript:alert(1)',start:0,controls:true}, '*'));
    await frame.evaluate(() => parent.postMessage({type:'ezkart:youtube-play',channel:'fixture',id:'M7lc1UVf-VE',start:-1,controls:true}, '*'));
    await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    assert.equal(await page.locator('[data-youtube-host-player]').count(), 0);
    await frame.locator('#play').click();
    const dialog = page.getByRole('dialog', {name:'YouTube video player'});
    await dialog.waitFor({state:'visible'});
    const player = dialog.locator('iframe');
    assert.equal(await player.getAttribute('sandbox'), null, 'Only the fixed host-owned player has a normal origin');
    const playerUrl = new URL(await player.getAttribute('src'));
    assert.equal(playerUrl.origin, 'https://www.youtube-nocookie.com');
    assert.equal(playerUrl.pathname, '/embed/M7lc1UVf-VE');
    assert.equal(playerUrl.searchParams.get('start'), '42');
    assert.equal(playerUrl.searchParams.get('controls'), '1');
    assert.equal(await player.getAttribute('referrerpolicy'), 'strict-origin-when-cross-origin');
    assert.equal(await dialog.locator('script').count(), 0, 'Authored player titles remain text');
    const box = await dialog.boundingBox();
    assert.ok(box.x >= 0 && box.x + box.width <= width, 'Player remains inside the narrow viewport');
    await page.keyboard.press('Escape');
    await dialog.waitFor({state:'detached'});
    assert.equal(await page.locator('[data-hosted-page]').getAttribute('sandbox'), landingPageSandbox);
  }
});
