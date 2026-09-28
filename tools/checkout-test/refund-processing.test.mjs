import {operatorPage,revokeOperatorConnection} from '../../../Ezkart-Executive-Dashboard/tools/operations-fixture.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdir,readFile,writeFile} from 'node:fs/promises';
import {setupCentralFixture} from './central-fixture.mjs';
import {browser,pageFor} from './review-workspace-fixture.mjs';
import {setupRefundProcessingFixture,refundProcessingClaims as claims} from '../../cloudflare/ezkart-api/test/refund-processing-fixture.mjs';
async function fixture(t){
  const f=await setupRefundProcessingFixture(t),app=await setupCentralFixture(t,{}, {},f),b=await browser(t);
  await writeFile(app.app.directory+'/auth-response.json',JSON.stringify({user:{id:f.buyer,email:'earnings@example.test',email_confirmed_at:'2026-09-01T00:00:00Z',factors:[]}}));
  const cookies={buyer:app.app.customerCookie('earnings@example.test',f.buyer,3600,await f.merchantToken(f.buyer,'earnings@example.test')),
    support:app.app.adminCookie({supabase_access_token:await f.merchantToken('bob','bob@example.test',claims()),mfa_enabled:true,mfa_aal:'aal2',admin_user:{id:'bob',email:'bob@example.test'}})};
  const page=async(kind,width=390)=>{if(kind==='support'){const p=await operatorPage(t,app,b,cookies.support,{tab:'refunds',width,params:{refund:f.refund.id}});p.on('dialog',d=>void d.accept());return p;}const p=await pageFor(b,app,width,cookies[kind]);p.on('dialog',d=>void d.accept());
    await p.goto(app.app.base+(kind==='buyer'?'/cart/return.php?order='+f.p.order.id+'&refund='+f.refund.id:'/cart/admin/?page=support-refunds&refund='+f.refund.id));return p;};
  return {...f,...app,page};
}
test('buyer bank confirmation stays out of browser storage; desktop/mobile provider handoff recovers its original preparation',async t=>{
  const f=await fixture(t),buyer=await f.page('buyer'),errors=[];buyer.on('pageerror',e=>errors.push(e.message));
  const bank=buyer.locator('[data-refund-bank]');await bank.getByLabel('Bank name',{exact:true}).fill(f.bankBody.bankName);await bank.getByLabel('Account holder name',{exact:true}).fill(f.bankBody.accountName);
  await bank.getByLabel('Bank account number',{exact:true}).fill(f.bankBody.accountNumber);await bank.getByLabel('Confirm bank account number',{exact:true}).fill(f.bankBody.accountNumber);await bank.getByRole('checkbox').check();
  f.control.drop=f.url+'/bank';await bank.getByRole('button',{name:'Save refund bank details',exact:true}).click();await bank.getByRole('button',{name:'Retry bank confirmation',exact:true}).waitFor();
  assert(!await buyer.evaluate(number=>JSON.stringify({...localStorage}).includes(number),f.bankBody.accountNumber));
  await bank.getByRole('button',{name:'Retry bank confirmation',exact:true}).click();await buyer.getByText('Your refund bank details were saved.',{exact:true}).waitFor();
  assert.equal((await f.db.prepare('SELECT COUNT(*) n FROM commerce_refund_bank_details').first()).n,1);
  const staff=await f.page('support',1360);staff.on('pageerror',e=>errors.push(e.message));f.control.drop=f.support+'/processing';
  await staff.getByRole('heading',{name:'Cost after a confirmed refund',exact:true}).waitFor();assert.equal(await buyer.locator('[data-refund-costs]').count(),0);
  await staff.getByRole('button',{name:'Prepare DOKU refund request',exact:true}).click();await staff.getByRole('button',{name:'Retry confirmation',exact:true}).waitFor();
  await staff.reload();await staff.getByRole('button',{name:'Retry confirmation',exact:true}).click();await staff.getByText('Your refund request was saved.',{exact:true}).waitFor();
  assert.equal((await f.db.prepare('SELECT COUNT(*) n FROM commerce_refund_provider_requests').first()).n,1);
  const [download]=await Promise.all([staff.waitForEvent('download'),staff.getByRole('button',{name:'Download original DOKU request',exact:true}).click()]);
  const content=await readFile(await download.path(),'utf8');assert(content.includes('Account number: '+f.bankBody.accountNumber));
  f.control.drop=f.support+'/processing';await staff.getByRole('button',{name:'Start original DOKU handoff',exact:true}).click();
  await staff.getByRole('button',{name:'Retry confirmation',exact:true}).waitFor();await staff.reload();await staff.getByRole('button',{name:'Retry confirmation',exact:true}).click();
  await staff.getByRole('link',{name:'Open official DOKU support',exact:true}).waitFor();assert.equal(await staff.getByRole('button',{name:'Start original DOKU handoff',exact:true}).count(),0);
  assert.equal((await f.db.prepare('SELECT COUNT(*) n FROM commerce_refund_provider_followups').first()).n,1);
  const form=staff.locator('[data-refund-submission]');await form.getByLabel('Ticket or sent-message reference',{exact:true}).fill('DOKU-FIXTURE-BROWSER');
  const local=await staff.evaluate(()=>{const d=new Date();return new Date(d.getTime()-d.getTimezoneOffset()*60000).toISOString().slice(0,19);});
  await form.getByLabel('Actual submission time',{exact:true}).fill(local);await form.getByRole('checkbox').check();await form.getByRole('button',{name:'Record DOKU submission',exact:true}).click();
  await staff.getByText('Submitted to DOKU — refund not confirmed',{exact:true}).waitFor();
  const follow=staff.locator('[data-refund-followup]');await follow.getByLabel('Original case update',{exact:true}).selectOption('returned_reported');await follow.getByLabel('Original ticket or response reference',{exact:true}).fill('DOKU-FIXTURE-BROWSER-RESPONSE');
  await follow.getByLabel('Time of this observation',{exact:true}).fill(await staff.evaluate(()=>{const d=new Date();return new Date(d.getTime()-d.getTimezoneOffset()*60000).toISOString().slice(0,23);}));
  await follow.getByRole('button',{name:'Save original-case update',exact:true}).click();await staff.getByText('DOKU completion reported — returned funds not verified',{exact:true}).waitFor();
  assert.equal((await f.db.prepare('SELECT COUNT(*) n FROM commerce_refund_finalizations').first()).n,0);
  const directory='/tmp/ezkart-refund-processing-ui-01a0d643';await mkdir(directory,{recursive:true});
  for(const [kind,p] of [['buyer',buyer],['support',staff]])for(const width of [1360,390]){
    await p.setViewportSize({width,height:1000});await p.getByRole('button',{name:'Reload request',exact:true}).click();await p.waitForFunction(()=>!document.querySelector('[data-refund-detail-reload]')?.disabled);
    await p.screenshot({path:'/tmp/refund-layout-'+kind+'-'+width+'.png',fullPage:true});await p.waitForFunction(()=>document.documentElement.scrollWidth<=innerWidth);assert.equal(await p.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true,kind+' '+width+' '+JSON.stringify(await p.evaluate(()=>[...document.querySelectorAll('body *')].filter(e=>e.getBoundingClientRect().right>innerWidth+1&&e.getBoundingClientRect().width>0).map(e=>[e.tagName,e.className,e.getBoundingClientRect().right]).slice(0,25))));await p.locator('[data-refund-processing]').screenshot({path:directory+'/'+kind+'-'+width+'.png'});
  }
  assert.deepEqual(errors,[]);assert((await f.app.calls()).every(c=>!c.url.includes('doku.com')));
});

test('the PHP proxy protects the original bank packet against changed sessions and stale authenticator proof',async t=>{
  const f=await fixture(t);await f.bank();assert.equal((await f.prepare()).status,200);const p=await f.page('support');
  f.control.afterResponse=async path=>{if(path!==f.support+'/packet')return;f.control.afterResponse=null;
    await revokeOperatorConnection(p);};
  let downloads=0;p.on('download',()=>downloads++);await p.getByRole('button',{name:'Download original DOKU request',exact:true}).click();await p.getByRole('button',{name:'Reload sign-in',exact:true}).waitFor();assert.equal(downloads,0);
  assert.equal((await f.merchant(f.support+'/packet',undefined,{seller:'bob',claims:claims(601)})).status,401);
});
