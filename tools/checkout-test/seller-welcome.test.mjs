import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdir} from 'node:fs/promises';
import {setupCentralFixture} from './central-fixture.mjs';
import {browser,pageFor} from './review-workspace-fixture.mjs';
const screens='/tmp/ezkart-seller-welcome';
test('seller entry uses brand colors, persists language before login and requires setup before dashboard',async t=>{
 const f=await setupCentralFixture(t,{}, {declaredOnboarding:false}),b=await browser(t);await mkdir(screens,{recursive:true});
 const p=await pageFor(b,f),errors=[];p.on('pageerror',e=>errors.push(e.message));
 for(const width of [1360,390]){
  await p.setViewportSize({width,height:940});await p.goto(f.app.base+'/cart/admin/');
  await p.getByRole('heading',{name:'Your store starts here.'}).waitFor();
  assert.equal(await p.evaluate(()=>getComputedStyle(document.body).backgroundColor),'rgb(246, 247, 251)');
  assert.equal(await p.evaluate(()=>getComputedStyle(document.body,'::before').content),'none');
  assert.equal(await p.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
  await p.screenshot({path:screens+'/login-'+width+'.png',fullPage:true});
 }
 await p.locator('[data-entry-language]').selectOption('id');await p.getByRole('heading',{name:'Tokomu dimulai di sini.'}).waitFor();
 await p.reload();await p.getByRole('button',{name:'Lanjutkan dengan Google'}).waitFor();
 await p.screenshot({path:screens+'/login-id-390.png',fullPage:true});
 const cookie=f.app.adminCookie({supabase_access_token:await f.merchantToken('alice','alice@example.test'),admin_user:{id:'alice',email:'alice@example.test'}});await p.context().addCookies([cookie]);
 await p.goto(f.app.base+'/cart/admin/?page=dashboard');assert.equal(new URL(p.url()).searchParams.get('page'),'onboarding');
 await p.getByRole('heading',{name:'Selamat datang di Ezkart'}).waitFor();assert.equal(await p.locator('[data-entry-language]').inputValue(),'id');
 await p.goto(f.app.base+'/cart/admin/?page=products');assert.equal(new URL(p.url()).searchParams.get('page'),'onboarding');
 await p.goto(f.app.base+'/cart/admin/?page=settings');assert.equal(new URL(p.url()).searchParams.get('page'),'settings');
 assert.deepEqual(errors,[]);
});
