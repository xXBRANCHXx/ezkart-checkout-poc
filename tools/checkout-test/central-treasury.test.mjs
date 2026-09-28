import {operatorPage} from '../../../Ezkart-Executive-Dashboard/tools/operations-fixture.mjs';
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
  const page=await operatorPage(t,f,browser,cookie,{tab:'treasury',width});const context=page.context();
  await page.getByRole('heading',{name:'Company bank',exact:true}).waitFor();
  assert(!(await page.content()).includes(bank.accountNumber));await page.getByLabel('Commission to reserve (whole rupiah)').fill('1000');if(width===1360)f.control.drop='/v1/treasury/intents';await page.getByRole('button',{name:'Reserve commission',exact:true}).click();
  if(width===1360){await page.getByRole('button',{name:'Retry original treasury request',exact:true}).waitFor();await page.reload();await page.getByRole('button',{name:'Retry original treasury request',exact:true}).click();}
  await page.getByRole('heading',{name:'Reservation Rp 1000',exact:true}).waitFor();assert.match(page.url(),/intent=try_/);
  assert.equal(await page.getByRole('button',{name:'Verify company bank',exact:true}).isDisabled(),true);
  assert.equal(await page.getByRole('button',{name:'Transfer confirmed commission',exact:true}).count(),0);
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
  if(process.env.EZKART_TEST_SCREENSHOTS){await mkdir(process.env.EZKART_TEST_SCREENSHOTS,{recursive:true});await page.screenshot({path:join(process.env.EZKART_TEST_SCREENSHOTS,'treasury-'+width+'.png'),fullPage:true});}
  const id=new URL(page.url()).searchParams.get('intent');
  const cross=await page.request.post(page.executiveFixture.base+'/api/operations.php?action=request',{data:{path:'/v1/treasury/intents/'+id+'/cancel',method:'POST',body:{requestKey:key()},account:'bob'},headers:{Origin:'https://foreign.invalid'}});
  assert.equal(cross.status(),403);assert.equal((await f.db.prepare('SELECT COUNT(*) n FROM commerce_treasury_cancellations WHERE intent_id=?').bind(id).first()).n,0);
  await page.getByRole('button',{name:'Cancel reservation',exact:true}).click();await page.getByText('Status: cancelled',{exact:true}).waitFor();assert.equal(await page.getByRole('button',{name:'Cancel reservation',exact:true}).count(),0);await context.close();
 }
 assert.equal((await f.app.calls()).filter(c=>c.url.includes('doku.com')||c.url.includes('biteship.com')).length,0);
});
