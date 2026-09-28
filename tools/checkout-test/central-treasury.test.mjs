import test from 'node:test';import assert from 'node:assert/strict';import {writeFile,mkdir} from 'node:fs/promises';import {join} from 'node:path';
import {setupCentralFixture} from './central-fixture.mjs';
import {setupEarningsFixture,key} from '../../cloudflare/ezkart-api/test/earnings-fixture.mjs';
import {refundProcessingClaims as claims} from '../../cloudflare/ezkart-api/test/refund-processing-fixture.mjs';

test('owner treasury page reserves and cancels original commission with visible holds on desktop and mobile; no financial provider calls',async t=>{
 const bank={configurationId:'fixture-v1',code:'CENAIDJA',accountNumber:'001234567890',channel:'BI_FAST',beneficiaryName:'Fixture Ezkart Company'};
 const bindings={COMMERCE_TREASURY_OPERATORS:'bob',COMMERCE_TREASURY_BANK:JSON.stringify(bank),COMMERCE_PLATFORM_WALLET_SELLER:'seller_bob'};
 const f=await setupCentralFixture(t,{}, {bindings}),e=await setupEarningsFixture(t,{baseFixture:f,bindings});await e.settle(await e.payment());
 assert.equal((await f.call('/internal/commerce/support/access',{environment:'sandbox',authUserId:'bob',role:'reviewer',requestKey:key(),operator:'Local UI fixture',reason:'Treasury UI access.'})).status,200);
 const token=await f.merchantToken('bob','bob@example.test',claims());await writeFile(join(f.app.directory,'auth-response.json'),JSON.stringify({user:{id:'bob',email:'bob@example.test'}}));
 const cookie=f.app.adminCookie({supabase_access_token:token,admin_user:{id:'bob',email:'bob@example.test'}});
 const {chromium}=await import('../builder-mcp/node_modules/playwright/index.mjs'),browser=await chromium.launch({headless:true});t.after(()=>browser.close());
 for(const width of [1360,390]){
  const context=await browser.newContext({viewport:{width,height:1000},reducedMotion:'reduce'});await context.addCookies([cookie]);const page=await context.newPage();
  await page.goto(f.app.base+'/cart/admin/?page=treasury');await page.getByRole('heading',{name:'Company bank',exact:true}).waitFor();
  assert(!(await page.content()).includes(bank.accountNumber));await page.getByLabel('Commission to reserve (whole rupiah)').fill('1000');await page.getByRole('button',{name:'Reserve commission',exact:true}).click();
  await page.getByRole('heading',{name:'Reservation Rp 1000',exact:true}).waitFor();assert.match(page.url(),/intent=try_/);
  assert.equal(await page.getByRole('button',{name:'Verify company bank',exact:true}).isDisabled(),true);
  assert.equal(await page.getByRole('button',{name:'Transfer confirmed commission',exact:true}).count(),0);
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
  if(process.env.EZKART_TEST_SCREENSHOTS){await mkdir(process.env.EZKART_TEST_SCREENSHOTS,{recursive:true});await page.screenshot({path:join(process.env.EZKART_TEST_SCREENSHOTS,'treasury-'+width+'.png'),fullPage:true});}
  const id=new URL(page.url()).searchParams.get('intent'),csrf=await page.locator('body').getAttribute('data-admin-csrf-token');
  const cross=await fetch(f.app.base+'/cart/admin/?page=treasury&intent='+id,{method:'POST',headers:{Cookie:cookie.name+'='+cookie.value,'Content-Type':'application/x-www-form-urlencoded',Origin:'https://foreign.invalid'},body:new URLSearchParams({action:'treasury_cancel',csrf_token:csrf,request_key:key()})});
  assert((await cross.text()).includes('treasury form expired'));assert.equal((await f.db.prepare('SELECT COUNT(*) n FROM commerce_treasury_cancellations WHERE intent_id=?').bind(id).first()).n,0);
  await page.getByRole('button',{name:'Cancel reservation',exact:true}).click();await page.getByText('The original commission reservation was cancelled.',{exact:true}).waitFor();assert.equal(await page.getByRole('button',{name:'Cancel reservation',exact:true}).count(),0);await context.close();
 }
 assert.equal((await f.app.calls()).filter(c=>c.url.includes('doku.com')||c.url.includes('biteship.com')).length,0);
});
