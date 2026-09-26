import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdir} from 'node:fs/promises';
import {randomBytes} from 'node:crypto';
import {setupCentralFixture} from './central-fixture.mjs';
import {browser,pageFor,choose} from './review-workspace-fixture.mjs';
import {campaignMailConfiguration,campaignMailSource} from '../../cloudflare/ezkart-api/test/campaign-email-fixture.mjs';
import {grantCampaignConsent,unsubscribeFixtureOrder} from '../../cloudflare/ezkart-api/test/campaign-unsubscribe-fixture.mjs';
const base='/v1/commerce/marketing/automations',key=()=>randomBytes(16).toString('hex'),screens='/tmp/ezkart-automation-ui-01a0d643';
const ok=result=>{assert.equal(result.status,200,JSON.stringify(result));return result;};
const root=p=>p.locator('[data-automations]'),form=p=>root(p).locator('[data-auto-form]');
async function fixture(t,bindings={}){
  const f=await setupCentralFixture(t,{}, {bindings:{...campaignMailConfiguration(),COMMERCE_MARKETING_AUTOMATIONS:'enabled',...bindings}});
  const cookie=f.app.adminCookie({supabase_access_token:await f.merchantToken('alice','alice@example.test'),admin_user:{id:'alice',email:'alice@example.test'}});
  const {plannedAt,archived,...copy}=campaignMailSource().values,values={...copy,buttonLabel:'',trigger:'paid',delayMinutes:0,cooldownDays:7};
  const save=(patch={},id=null,revision=0)=>f.merchant(base,{id,revision,requestKey:key(),values:{...values,...patch}},{method:'POST'});
  return {...f,cookie,values,save};
}
async function open(p,f){await p.goto(f.app.base+'/cart/admin/?page=marketing');await root(p).getByText(/automations shown\.|No automations match/).waitFor();}
async function newDraft(p,name){await root(p).getByRole('button',{name:'New automation',exact:true}).click();for(const [label,value] of Object.entries({'Automation name':name,'Email subject':'Thanks for choosing us','Email heading':'Your next cup','Email message':'A useful message.\n\n<img src=x onerror=alert(1)>'}))await form(p).getByLabel(label,{exact:true}).fill(value);}
async function save(p){await form(p).getByRole('button',{name:'Save paused draft',exact:true}).click();await root(p).getByText('Save confirmed. Current state: paused.',{exact:true}).waitFor();}
async function edit(p,name){await root(p).locator('.marketing-campaign-card').filter({has:p.getByRole('heading',{name,exact:true})}).getByRole('button',{name:'Open automation',exact:true}).click();await form(p).getByLabel('Automation name',{exact:true}).waitFor();}
async function activate(p){await form(p).getByRole('button',{name:'Review activation',exact:true}).click();const dialog=root(p).getByRole('dialog',{name:'Activate this saved automation?',exact:true});await dialog.waitFor();await dialog.getByRole('button',{name:'Activate saved rule',exact:true}).click();}

test('real automation creation, activation, delayed activity, pause, archive and restoration work on desktop and mobile',async t=>{
  const f=await fixture(t),b=await browser(t);await mkdir(screens,{recursive:true});
  for(const width of [1360,390]){
    const p=await pageFor(b,f,width),errors=[];p.on('pageerror',e=>errors.push(e.message));await open(p,f);await newDraft(p,'Payment follow-up '+width);
    await choose(p,form(p),'trigger','After a verified payment');await form(p).getByLabel('Wait before sending',{exact:true}).fill('2');await choose(p,form(p),'delayUnit','Hours');
    await save(p);const rule=ok(await f.merchant(base+'?q='+width)).items[0];assert.equal(rule.values.delayMinutes,120);assert.equal(rule.state,'paused');
    await form(p).getByRole('button',{name:'Review activation',exact:true}).click();const dialog=root(p).getByRole('dialog',{name:'Activate this saved automation?',exact:true});await dialog.waitFor();assert.equal(await dialog.locator('img,script').count(),0);
    await p.screenshot({path:screens+'/activation-'+width+'.png'});await dialog.getByRole('button',{name:'Activate saved rule',exact:true}).click();await root(p).getByText('Activation confirmed. Current state: active.',{exact:true}).waitFor();assert.equal(await form(p).getByLabel('Email message',{exact:true}).isDisabled(),true);
    const buyer={id:'automation-ui-buyer-'+width,email:'automation'+width+'@example.test'},order=await unsubscribeFixtureOrder(f,buyer);await grantCampaignConsent(f,{buyer});ok(await f.paid(order));const processing=ok(await f.call('/internal/commerce/automations/process',{environment:'sandbox'}));assert.equal(processing.enrolled,1);assert.equal(processing.published,0);
    await root(p).getByRole('button',{name:'Refresh activity',exact:true}).click();await root(p).locator('[data-auto-activity]').getByText('Waiting',{exact:true}).waitFor();
    assert.equal(await p.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);await root(p).locator('[data-auto-editor]').scrollIntoViewIfNeeded();await p.screenshot({path:screens+'/editor-'+width+'.png'});
    await form(p).getByRole('button',{name:'Pause automation',exact:true}).click();await root(p).getByText('Pause confirmed. Current state: paused.',{exact:true}).waitFor();ok(await f.call('/internal/commerce/automations/process',{environment:'sandbox'}));
    await root(p).getByRole('button',{name:'Refresh activity',exact:true}).click();await root(p).locator('[data-auto-activity]').getByText('Skipped',{exact:true}).waitFor();await root(p).locator('[data-auto-activity]').getByText('Rule paused or replaced',{exact:true}).waitFor();
    await form(p).getByRole('button',{name:'Archive automation',exact:true}).click();await root(p).getByText('Archive confirmed. Current state: archived.',{exact:true}).waitFor();
    await form(p).getByRole('button',{name:'Restore paused draft',exact:true}).click();await root(p).getByText('Restore confirmed. Current state: paused.',{exact:true}).waitFor();
    await root(p).getByText('Saved rule history',{exact:true}).click();await root(p).getByText('5 saved changes shown.',{exact:true}).waitFor();
    assert.equal((await f.merchant(base+'/'+rule.id)).automation.state,'paused');assert.deepEqual(errors,[]);await p.context().close();
  }
  assert.equal(await f.count('commerce_campaign_email_requests'),0);assert.equal((await f.providerCalls()).length,0);
});

test('lost save and activation responses survive reload and emergency pause prevents an activation replay from resuming',async t=>{
  const f=await fixture(t),b=await browser(t),p=await pageFor(b,f,390);await open(p,f);await newDraft(p,'Recover this automation');f.control.drop=base;
  await form(p).getByRole('button',{name:'Save paused draft',exact:true}).click();await root(p).getByRole('button',{name:'Retry original save',exact:true}).waitFor();assert.equal(await f.count('commerce_automation_changes'),1);
  const original=f.control.calls.filter(c=>c.path===base&&c.body).at(-1).body;await p.reload();await root(p).getByRole('button',{name:'Retry original save',exact:true}).waitFor();await root(p).getByRole('button',{name:'Retry original save',exact:true}).click();await root(p).getByText('Save confirmed. Current state: paused.',{exact:true}).waitFor();
  assert.deepEqual(f.control.calls.filter(c=>c.path===base&&c.body).at(-1).body,original);assert.equal(await f.count('commerce_automation_changes'),1);
  const rule=ok(await f.merchant(base)).items[0];f.control.drop=base+'/'+rule.id+'/action';await activate(p);await root(p).getByRole('button',{name:'Retry original activation',exact:true}).waitFor();assert.equal((await f.merchant(base+'/'+rule.id)).automation.state,'active');
  await form(p).getByRole('button',{name:'Pause automation',exact:true}).click();await root(p).getByText('Pause confirmed. Current state: paused.',{exact:true}).waitFor();assert.equal(await f.count('commerce_automation_changes'),3);
  await p.reload();await root(p).getByRole('button',{name:'Retry original activation',exact:true}).waitFor();await root(p).getByRole('button',{name:'Retry original activation',exact:true}).click();await root(p).getByText('Activation confirmed. Current state: paused.',{exact:true}).waitFor();
  assert.equal((await f.merchant(base+'/'+rule.id)).automation.state,'paused');assert.equal(await f.count('commerce_automation_changes'),3);assert.equal(await f.count('commerce_campaign_publications'),0);
});

test('concurrent automation drafts compare conflicts, preserve independent filters and keep active copy read-only',async t=>{
  const f=await fixture(t),saved=ok(await f.save({name:'Shared rule'})),b=await browser(t),a=await pageFor(b,f,390),other=await pageFor(b,f);await open(a,f);await open(other,f);await edit(a,'Shared rule');await edit(other,'Shared rule');
  await form(a).getByLabel('Email subject',{exact:true}).fill('My subject');await form(a).getByLabel('Email message',{exact:true}).fill('My message');
  await form(other).getByLabel('Email subject',{exact:true}).fill('Other subject');await form(other).getByLabel('Customer tag',{exact:true}).fill('loyal');await save(other);
  await form(a).getByRole('button',{name:'Save paused draft',exact:true}).click();await root(a).getByText('The saved automation changed. Review the saved version before another change.',{exact:true}).waitFor();
  await form(a).getByRole('button',{name:'Review saved automation',exact:true}).click();const dialog=root(a).getByRole('dialog',{name:'Compare automation versions',exact:true});await dialog.waitFor();await choose(a,dialog,'automation-merge-subject','My draft value');await dialog.getByRole('button',{name:'Use compared changes',exact:true}).click();
  assert.equal(await form(a).getByLabel('Customer tag',{exact:true}).inputValue(),'loyal');await save(a);const row=ok(await f.merchant(base+'/'+saved.automation.id)).automation;assert.equal(row.values.subject,'My subject');assert.equal(row.values.body,'My message');assert.equal(row.values.audience.tag,'loyal');assert.equal(row.revision,3);
});

test('browser storage failures and altered pending saves block writes without overwriting the original draft record',async t=>{
  const f=await fixture(t),b=await browser(t),blocked=await pageFor(b,f);
  await blocked.addInitScript(()=>{Storage.prototype.setItem=()=>{throw Error('Fixture storage unavailable');};});await open(blocked,f);await newDraft(blocked,'Keep this draft safe');assert.equal(await form(blocked).getByRole('button',{name:'Save paused draft',exact:true}).isDisabled(),true);assert.equal(await f.count('commerce_automation_changes'),0);await blocked.context().close();
  const p=await pageFor(b,f);await open(p,f);await newDraft(p,'Original request');f.control.drop=base;await form(p).getByRole('button',{name:'Save paused draft',exact:true}).click();await root(p).getByRole('button',{name:'Retry original save',exact:true}).waitFor();
  await root(p).getByText('The result was not confirmed. Retry the original automation request.',{exact:true}).waitFor();
  const retained=await p.evaluate(()=>{const k=Object.keys(sessionStorage).find(k=>k.startsWith('ezkart.automations.v1:')),data=JSON.parse(sessionStorage.getItem(k));data.entries[0].pending[0].body.values.name='Altered intent';sessionStorage.setItem(k,JSON.stringify(data));return sessionStorage.getItem(k);});
  await p.reload();await root(p).getByText('The saved automation drafts could not be verified. Keep this tab open and copy changes before clearing its session storage.',{exact:true}).waitFor();await newDraft(p,'Do not replace the saved reference');assert.equal(await form(p).getByRole('button',{name:'Save paused draft',exact:true}).isDisabled(),true);
  assert.equal(await p.evaluate(()=>sessionStorage.getItem(Object.keys(sessionStorage).find(k=>k.startsWith('ezkart.automations.v1:')))),retained);assert.equal(await f.count('commerce_automation_changes'),1);
});

test('automation proxy paths remain private and store-bound, and held drafts can be inspected without activation',async t=>{
  const f=await fixture(t,{COMMERCE_MARKETING_AUTOMATIONS:'off'}),saved=ok(await f.save({name:'Held draft'})),b=await browser(t),p=await pageFor(b,f,390);await open(p,f);await edit(p,'Held draft');assert.equal(await form(p).getByRole('button',{name:'Review activation',exact:true}).isDisabled(),true);
  const headers=await p.evaluate(()=>({'X-Ezkart-CSRF':document.body.dataset.adminCsrfToken,'X-Ezkart-Marketing-Account':document.body.dataset.adminReviewAccount,'X-Ezkart-Marketing-Store':document.querySelector('[data-marketing]').dataset.store}));headers.Cookie='ezkart_admin='+f.cookie.value;
  const request=(path,extra={},method='GET')=>fetch(f.app.base+'/cart/admin/?cloud='+encodeURIComponent(path),{method,headers:{...headers,...extra}});
  for(const [path,status] of [[base+'?state=paused',200],[base+'?state=available',200],[base+'/'+saved.automation.id+'/activity?status=waiting',200],[base+'?state=paused&state=active',400],[base+'?month=2026-10',400],[base+'/'+saved.automation.id+'/publish',400],[base+'/'+saved.automation.id+'/action',405],['/v1/commerce/marketing/campaigns/'+saved.automation.id,400]])assert.equal((await request(path)).status,status,path);
  assert.equal((await request(base,{'X-Ezkart-Marketing-Account':'bob'})).status,401);assert.equal((await request(base,{'X-Ezkart-Marketing-Store':'seller_bob'})).status,409);
  assert.equal((await fetch(f.app.base+'/cart/admin/marketing-automations.php')).status,404);
  await f.db.prepare("UPDATE seller_memberships SET role='viewer' WHERE auth_user_id='alice'").run();await p.reload();await root(p).getByRole('button',{name:'New automation',exact:true}).waitFor();assert.equal(await root(p).getByRole('button',{name:'New automation',exact:true}).isDisabled(),true);await edit(p,'Held draft');assert.equal(await form(p).getByLabel('Automation name',{exact:true}).isDisabled(),true);
  assert.equal(await f.count('commerce_automation_changes'),1);
});

test('automated message links open an immutable campaign and return to its source rule; unsaved drafts can be discarded',async t=>{
  const f=await fixture(t),b=await browser(t),p=await pageFor(b,f);await open(p,f);await newDraft(p,'Welcome once');await save(p);await activate(p);await root(p).getByText('Activation confirmed. Current state: active.',{exact:true}).waitFor();
  const buyer={id:'welcome-ui-buyer',email:'welcome@example.test'};await unsubscribeFixtureOrder(f,buyer);await grantCampaignConsent(f,{buyer});assert.equal(ok(await f.call('/internal/commerce/automations/process',{environment:'sandbox'})).published,1);
  await root(p).getByRole('button',{name:'Refresh activity',exact:true}).click();await root(p).locator('[data-auto-activity]').getByRole('button',{name:'View message',exact:true}).click();
  const editor=p.locator('[data-marketing-editor]');await editor.getByRole('heading',{name:'Automated message',exact:true}).waitFor();assert.equal(await editor.getByLabel('Email subject',{exact:true}).isDisabled(),true);assert.equal(await editor.getByRole('button',{name:'Save draft',exact:true}).isDisabled(),true);
  await editor.getByRole('button',{name:'Open source automation',exact:true}).click();await root(p).getByRole('heading',{name:'Welcome once',exact:true}).last().waitFor();
  await root(p).getByRole('button',{name:'New automation',exact:true}).click();await form(p).getByLabel('Automation name',{exact:true}).fill('Discard only this draft');await root(p).getByRole('button',{name:'Discard unsaved automation',exact:true}).click();
  const dialog=root(p).getByRole('dialog',{name:'Discard this unsaved automation?',exact:true});await dialog.getByRole('button',{name:'Discard automation draft',exact:true}).click();assert.equal(await root(p).locator('[data-auto-editor]').isVisible(),false);assert.equal(await root(p).getByText('Discard only this draft · Unsaved draft',{exact:true}).count(),0);assert.equal(await f.count('commerce_automations'),1);
});
