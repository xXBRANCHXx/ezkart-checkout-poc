import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import {setup} from './fixture.mjs';
import {chromium} from '../builder-mcp/node_modules/playwright/index.mjs';

const bridge='x-ezkart-content-security-policy';
const cloud=path=>'cloud='+encodeURIComponent(path);
test('merchant policy selection preserves preview isolation and ignores forged client policy headers',async t=>{
  const f=await setup();t.after(()=>f.close());
  const ordinary=await fetch(f.base+'/cart/admin/?page=marketing'),baseline=ordinary.headers.get('content-security-policy');
  const startup=await readFile(new URL('../../cart/admin/admin-startup.js',import.meta.url));
  assert(baseline.includes("'sha256-"+createHash('sha256').update(startup).digest('base64')+"'"));
  assert.match(baseline,/script-src 'self' 'sha256-[^']+';/);assert.doesNotMatch(baseline,/script-src[^;]*(?:unsafe-inline|unsafe-eval)/);
  assert.match(baseline,/frame-ancestors 'none'/);assert.equal(ordinary.headers.get(bridge),baseline);
  const cases=[
    ['page=shipping-settings',/connect-src 'self' https:\/\/tiles.openfreemap.org; worker-src 'self' blob:/,'DENY'],
    ['page=sites&edit=example.ezkart.site&preview-repair=1',/frame-ancestors 'self'/,'SAMEORIGIN'],
    [cloud('/v1/landing-pages/example/preview'),/script-src 'none'; connect-src 'none'; frame-src 'none'; form-action 'none'; frame-ancestors 'self'/,'SAMEORIGIN'],
    [cloud('/v1/landing-pages/example/view'),/sandbox allow-scripts allow-forms allow-popups/,'DENY'],
    ['page=marketing&preview-repair=1',/frame-ancestors 'none'/,'DENY'],
    [cloud('/v1/landing-pages/example/view')+'&cloud=invalid',/script-src 'self' 'sha256-[^']+';/,'DENY'],
  ];
  for(const [query,pattern,frame] of cases){
    const response=await fetch(f.base+'/cart/admin/?'+query,{headers:{[bridge]:"default-src * 'unsafe-inline' 'unsafe-eval'",'Content-Security-Policy':'default-src *'}}),policy=response.headers.get('content-security-policy');
    assert.match(policy,pattern,query);assert.doesNotMatch(policy,/allow-same-origin|unsafe-eval|default-src \*/);assert.equal(response.headers.get(bridge),policy);
    assert.equal(response.headers.get('x-frame-options'),frame);assert.match(response.headers.get('cache-control'),/no-store/);
  }
  const spoof=await fetch(f.base+'/cart/admin/?page=marketing',{headers:{[bridge]:'default-src *'}});
  const normalizeNonce=policy=>policy.replace(/'nonce-[^']+'/g,"'nonce-per-response'");
  assert.equal(normalizeNonce(spoof.headers.get('content-security-policy')),normalizeNonce(baseline));
  assert.notEqual(spoof.headers.get('content-security-policy'),baseline,'Each response uses a fresh style nonce');
});

test('the merchant browser blocks unapproved inline scripts, handlers and eval under the emitted policy',async t=>{
  const f=await setup();t.after(()=>f.close());const browser=await chromium.launch();t.after(()=>browser.close());
  const page=await browser.newPage();await page.route('**/cart/admin/csp-test-helper.js',route=>route.fulfill({contentType:'text/javascript',body:"window.evalAttempted=true;try{eval('window.unapprovedEval=true')}catch(error){window.evalBlocked=error instanceof EvalError}"}));
  await page.goto(f.base+'/cart/admin/?page=marketing');
  await page.evaluate(()=>{
    globalThis.policyViolations=[];document.addEventListener('securitypolicyviolation',event=>policyViolations.push(event.effectiveDirective));
    const script=document.createElement('script');script.textContent='window.unapprovedInline=true';document.head.append(script);
    const button=document.createElement('button');button.setAttribute('onclick','window.unapprovedHandler=true');document.body.append(button);button.click();
    const helper=document.createElement('script');helper.src='./csp-test-helper.js';document.head.append(helper);
  });
  await page.waitForFunction(()=>policyViolations.length>=3);
  assert.deepEqual(await page.evaluate(()=>({inline:typeof unapprovedInline,handler:typeof unapprovedHandler,eval:typeof unapprovedEval,evalBlocked})),
    {inline:'undefined',handler:'undefined',eval:'undefined',evalBlocked:true});
  assert.equal(await page.getByRole('button',{name:/Google/}).count()>0,true,'The sign-in page still renders its normal control');
});

test('fresh beta Google sign-in follows the actual form redirect chain while unapproved form destinations stay blocked',async t=>{
  const f=await setup({EZKART_DEPLOYMENT_ENVIRONMENT:'beta',EZKART_COMMERCE_ENVIRONMENT:'production',EZKART_CLOUDFLARE_API_URL:'https://ezkart-api-beta.fixture.workers.dev'});t.after(()=>f.close());
  const browser=await chromium.launch();t.after(()=>browser.close());const page=await browser.newPage();
  const redirects=[],interceptionFailures=[];
  // Playwright routes only intercept the first request in a redirect chain.
  // This isolated test browser intercepts every hop so no Auth network is used.
  const transport=await page.context().newCDPSession(page);
  await transport.send('Fetch.enable',{patterns:[{urlPattern:'https://auth.ezkart.test/*'},{urlPattern:'https://accounts.google.com/*'}]});
  transport.on('Fetch.requestPaused',event=>{
    (async()=>{
      const request=event.request,url=new URL(request.url);redirects.push(url.origin);assert.equal(request.method,'GET');
      if(url.origin==='https://auth.ezkart.test'){
        assert.equal(url.pathname,'/auth/v1/authorize');assert.equal(url.searchParams.get('provider'),'google');
        assert.equal(url.searchParams.get('code_challenge_method'),'s256');assert.match(url.searchParams.get('code_challenge'),/^[A-Za-z0-9_-]{43}$/);
        assert.equal(new URL(url.searchParams.get('redirect_to')).origin,'https://test.ezkart.id');
        await transport.send('Fetch.fulfillRequest',{requestId:event.requestId,responseCode:303,responseHeaders:[{name:'Location',value:'https://accounts.google.com/fixture-account-chooser'}]});
      }else await transport.send('Fetch.fulfillRequest',{requestId:event.requestId,responseCode:200,responseHeaders:[{name:'Content-Type',value:'text/html'}],body:Buffer.from('<h1>Choose your Google account</h1>').toString('base64')});
    })().catch(async error=>{interceptionFailures.push(error.message);await transport.send('Fetch.failRequest',{requestId:event.requestId,errorReason:'Failed'}).catch(()=>{});});
  });
  const response=await page.goto(f.base+'/cart/admin/');assert.equal(await page.locator('h1').innerText(),'Your store starts here.');
  assert.match(response.headers()['content-security-policy'],/form-action 'self' https:\/\/auth.ezkart.test https:\/\/accounts.google.com;/);
  await page.getByRole('button',{name:'Continue with Google',exact:true}).click();
  await page.waitForURL('https://accounts.google.com/fixture-account-chooser');assert.deepEqual(interceptionFailures,[]);assert.deepEqual(redirects,['https://auth.ezkart.test','https://accounts.google.com']);
  await page.goto(f.base+'/cart/admin/');let foreignRequests=0;
  await page.route('https://unapproved.example/**',route=>{foreignRequests++;return route.abort();});
  await page.evaluate(()=>{
    globalThis.formBlocked=false;document.addEventListener('securitypolicyviolation',event=>{if(event.effectiveDirective==='form-action')globalThis.formBlocked=true;});
    const form=document.querySelector('#google-sign-in-form');form.action='https://unapproved.example/collect';form.requestSubmit();
  });
  await page.waitForFunction(()=>globalThis.formBlocked);assert.equal(foreignRequests,0);assert.equal(new URL(page.url()).origin,f.base);
});
