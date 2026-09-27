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
  const spoof=await fetch(f.base+'/cart/admin/?page=marketing',{headers:{[bridge]:'default-src *'}});assert.equal(spoof.headers.get('content-security-policy'),baseline);
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
