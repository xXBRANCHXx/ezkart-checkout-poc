import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {mkdir} from 'node:fs/promises';
import {setupCentralFixture} from './central-fixture.mjs';
import {browser,pageFor,choose} from './review-workspace-fixture.mjs';
const claims=age=>({aal:'aal2',amr:[{method:'totp',timestamp:Math.floor(Date.now()/1000)-age}]});
async function fixture(t){
 const f=await setupCentralFixture(t),b=await browser(t);
 const permission=role=>f.call('/internal/commerce/support/access',{environment:'sandbox',authUserId:'bob',role,requestKey:randomUUID().replaceAll('-',''),operator:'Fixture operator',reason:'Isolated Jev review browser fixture.'});
 assert.equal((await permission('reviewer')).status,200);
 const admin=async(id='bob',age=0)=>f.app.adminCookie({supabase_access_token:await f.merchantToken(id,id+'@example.test',claims(age)),mfa_enabled:true,mfa_aal:'aal2',admin_user:{id,email:id+'@example.test'}});
 const page=async(width=1360,cookie=null)=>pageFor(b,f,width,cookie||await admin());
 return {...f,b,permission,admin,page,url:f.app.base+'/cart/admin/?page=jev'};
}
const mode={modelEnabled:true,policyApproved:true,archiveEnabled:true,model:'fixture-model',policyVersion:'fixture-policy',policyRules:[{code:'credential_request',label:'Credential requests',basis:'Fixture-only policy'}]};
const sample=()=>({id:'jrv_fixture',caseId:'jcase_fixture',store:'alice',pageId:'page-one',revision:'revision-one',createdAt:new Date().toISOString(),state:'queued',deadlineAt:new Date(Date.now()+5*86400000).toISOString(),rescanCount:0,due:false,archiveState:'active',archiveReason:null,policyVersion:'fixture-policy',outcome:null,failureCode:null,reportText:'A report is an allegation.',sources:[{id:'text_1',text:'Send your bank password <img src=x onerror=alert(1)>.'}],coverage:{textOnly:true,unreviewedMedia:false,truncated:false},model:'fixture-model',grades:[],currentRevision:'revision-one',stale:false});
async function mock(page){
 const state={review:null,calls:[],receipts:new Map(),dropGrade:true,canWrite:true};
 await page.route('**/cart/api/jev.php?*',async route=>{
  const req=route.request(),path=new URL(req.url()).searchParams.get('path'),body=req.method()==='POST'?req.postDataJSON():null;
  state.calls.push({path,body,headers:req.headers()});let data;
  if(path.startsWith('/v1/jev/pages?'))data={store:'alice',pages:[{id:'page-one',name:'Fixture page',revision:'revision-one',status:'published'}]};
  else if(path==='/v1/jev/reviews'&&!body)data={items:state.review?[state.review]:[],mode,canWrite:state.canWrite};
  else if(body){
   if(state.receipts.has(body.requestKey))data=state.receipts.get(body.requestKey);
   else{if(path==='/v1/jev/reviews'){assert.equal(body.expectedRevision,'revision-one');state.review=sample();state.review.reportText=body.reportText;}
    else if(path.endsWith('/run')){state.review.state='completed';state.review.archiveState='archived';state.review.archiveReason='Fixture policy evidence.';state.review.outcome={verdict:'needs_change',summary:'The text directly requests credentials.',findings:[{code:'credential_request',sourceId:'text_1',quote:'Send your bank password',explanation:'An explicit credential request in page text.'}],uncertainties:[]};}
    else if(path.endsWith('/grade'))state.review.grades.push({...body,id:'grade_1',createdAt:new Date().toISOString()});
    else if(path.endsWith('/restore')){assert.equal(body.expectedRevision,'revision-one');state.review.archiveState='active';}
    data={review:structuredClone(state.review),mode,canWrite:state.canWrite};state.receipts.set(body.requestKey,data);
   }
   if(path.endsWith('/grade')&&state.dropGrade){state.dropGrade=false;await route.abort();return;}
  }else data={review:state.review,mode,canWrite:state.canWrite};
  await route.fulfill({json:data});
 });return state;
}
test('reviewer intake, explicit run, evidence, grade lost-ack recovery and restore work at desktop/mobile',async t=>{
 const f=await fixture(t),p=await f.page(),s=await mock(p),errors=[];p.on('pageerror',e=>errors.push(e.message));await p.goto(f.url);
 await p.getByText('No saved reviews yet. Queue a page below to begin.',{exact:true}).waitFor();assert.equal(s.calls.filter(c=>c.body).length,0);
 await p.getByLabel('Store slug',{exact:true}).fill('alice');await p.getByRole('button',{name:'Load saved pages',exact:true}).click();await p.getByLabel('Reported concern',{exact:true}).fill('The page asks for a bank password.');await p.getByRole('button',{name:'Save review request',exact:true}).click();
 await p.getByRole('button',{name:'Run Jev review',exact:true}).waitFor();assert.equal(s.calls.filter(c=>c.path.endsWith('/run')).length,0);
 await p.getByRole('button',{name:'Run Jev review',exact:true}).click();await p.getByRole('heading',{name:'Grade this recommendation',exact:true}).waitFor();await p.getByText('Rule: Credential requests · Basis: Fixture-only policy',{exact:true}).waitFor();assert.equal(await p.locator('[data-jev] img').count(),0);
 await p.getByLabel('Reason for your grade',{exact:true}).fill('The quote matches the saved revision.');await p.getByRole('button',{name:'Save grade',exact:true}).click();await p.getByRole('button',{name:'Retry confirmation',exact:true}).waitFor();const original=s.calls.filter(c=>c.path.endsWith('/grade')).at(-1).body;
 await p.reload();await p.getByRole('button',{name:'Retry confirmation',exact:true}).click();await p.getByText('The original action is confirmed.',{exact:true}).waitFor();assert.deepEqual(s.calls.filter(c=>c.path.endsWith('/grade')).at(-1).body,original);assert.equal(s.review.grades.length,1);
 await p.getByLabel('Reason for restoring current revision revision-one',{exact:true}).fill('Human reviewer overrides this fixture archive.');await p.getByRole('button',{name:'Restore page',exact:true}).click();await p.getByText('No temporary archive is recorded for this page.',{exact:true}).waitFor();
 const dir='/tmp/ezkart-jev-workspace';await mkdir(dir,{recursive:true});for(const width of [1360,390]){await p.setViewportSize({width,height:1000});await p.reload();await p.getByRole('heading',{name:'Grade this recommendation',exact:true}).waitFor();assert.equal(await p.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);await p.screenshot({path:dir+'/review-'+width+'.png',fullPage:true});}
 assert.deepEqual(errors,[]);assert.equal(s.calls.every(c=>c.headers['x-ezkart-jev-account']==='bob'&&c.headers['x-ezkart-csrf']),true);assert.equal(await p.evaluate(()=>Object.keys(localStorage).some(k=>k.includes('jev'))),false);assert.equal(await p.evaluate(()=>Object.keys(sessionStorage).some(k=>k.includes('jev:pending'))),false);assert.equal((await f.providerCalls()).length,0);
});
test('failed and uncertain reviews are not clean results; viewer and merchant access cannot run reviews',async t=>{
 const f=await fixture(t),p=await f.page(390),s=await mock(p);s.review=sample();s.review.state='uncertain';await p.goto(f.url+'&review=jrv_fixture');await p.getByText('The original attempt may already have reached the model. Refresh to recover its saved result; do not create another request to retry this attempt.',{exact:true}).waitFor();assert.equal(await p.getByRole('button',{name:'Run Jev review',exact:true}).count(),0);
 s.review.state='failed';await p.getByRole('button',{name:'Refresh',exact:true}).click();await p.getByText('Jev did not return a usable review. This is not a clean result or evidence of a violation. Human review is required.',{exact:true}).waitFor();
 await f.permission('viewer');s.canWrite=false;s.review.state='queued';await p.reload();await p.getByRole('button',{name:'Run Jev review',exact:true}).waitFor();assert.equal(await p.getByRole('button',{name:'Run Jev review',exact:true}).isDisabled(),true);
 const merchant=await f.page(390,await f.admin('alice'));await merchant.goto(f.url);await merchant.getByRole('heading',{name:'Review access required',exact:true}).waitFor();assert.equal(await merchant.locator('[data-jev]').count(),0);
 await f.permission('reviewer');const stale=await f.page(390,await f.admin('bob',601));const staleState=await mock(stale);staleState.canWrite=false;await stale.goto(f.url);await stale.getByRole('heading',{name:'Verify your authenticator',exact:true}).waitFor();assert.equal(await stale.getByRole('button',{name:'Load saved pages',exact:true}).isDisabled(),true);
 assert.equal((await f.providerCalls()).length,0);
});
