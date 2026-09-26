import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdir} from 'node:fs/promises';
import {randomUUID} from 'node:crypto';
import {setupCentralFixture} from './central-fixture.mjs';
import {browser,pageFor} from './review-workspace-fixture.mjs';
import {campaignMailConfiguration} from '../../cloudflare/ezkart-api/test/campaign-email-fixture.mjs';
import {publicationFixtureOn,publicationKey,publicationBase} from '../../cloudflare/ezkart-api/test/campaign-publication-fixture.mjs';
import {dispatchCampaignEmails} from '../../cloudflare/ezkart-api/src/campaign-email-delivery.js';
import {recordEmailWebhook} from '../../cloudflare/ezkart-api/src/commerce-email-delivery.js';
import {emailFixtureEvent,emailFixtureCallback} from '../../cloudflare/ezkart-api/test/email-fixture.mjs';
const screens='/tmp/ezkart-campaign-publishing-ui-01a0d643',root=p=>p.locator('[data-marketing]'),panel=p=>root(p).locator('[data-campaign-delivery]');
const review=p=>root(p).getByRole('dialog',{name:/Review campaign publication|Change campaign send time|Cancel remaining sends/});
const later=hours=>new Date(Date.now()+hours*3600000).toISOString().slice(0,16)+':00.000Z';
const local=(stamp,offset=7)=>new Date(Date.parse(stamp)+offset*3600000).toISOString().slice(0,16);
async function fixture(t,options={}){
  const bindings={...campaignMailConfiguration(),COMMERCE_EMAIL_TEST_RECIPIENTS:'["alice@example.test","buyer1@example.test","buyer2@example.test"]',...options.bindings},base=await setupCentralFixture(t,options.php||{}, {bindings}),f=await publicationFixtureOn(base,bindings);
  const cookie=f.app.adminCookie({supabase_access_token:await f.merchantToken('alice','alice@example.test'),admin_user:{id:'alice',email:'alice@example.test'}});
  return {...f,cookie};
}
async function open(p,f){await p.goto(f.app.base+'/cart/admin/?page=marketing');await root(p).getByText('Drafts and your planning calendar are ready.',{exact:true}).waitFor();}
async function edit(p,f){await root(p).locator('.marketing-campaign-card').filter({has:p.getByRole('heading',{name:f.values.name,exact:true})}).getByRole('button',{name:'Edit draft',exact:true}).click();await panel(p).getByRole('heading',{name:'Campaign delivery',exact:true}).waitFor();await panel(p).getByRole('button',{name:'Refresh delivery',exact:true}).waitFor({state:'visible'});}
async function start(p,name='Review and publish'){await panel(p).getByRole('button',{name,exact:true}).click();await review(p).locator('[data-delivery-review-status]').filter({hasText:/matching customers have email permission|Choose a future send time|This stops remaining sends/}).waitFor();}
async function confirm(p,label){await review(p).locator('input[name="confirmed"]').check();await review(p).getByRole('button',{name:label,exact:true}).click();}

test('merchants review a saved campaign, schedule in store time, inspect frozen recipients/history and cancel on desktop and mobile',async t=>{
  await mkdir(screens,{recursive:true});const b=await browser(t);
  for(const width of [1360,390])await t.test(String(width),async t=>{
    const f=await fixture(t);await f.addBuyer(1);await f.addBuyer(2);
    const profile=(await f.merchant('/v1/commerce/settings')).profile.values;assert.equal((await f.merchant('/v1/commerce/settings',{kind:'profile',revision:0,requestKey:publicationKey(),values:{...profile,timezone:'Asia/Jayapura'}},{method:'POST'})).status,200);
    const p=await pageFor(b,f,width),errors=[];p.on('pageerror',e=>errors.push(e.message));await open(p,f);await edit(p,f);await start(p);
    const date=later(24);await review(p).getByLabel('Schedule for later',{exact:true}).check();await review(p).getByLabel('Send date and time',{exact:false}).fill(local(date,9));assert.equal(await review(p).getByRole('button',{name:'Schedule campaign',exact:true}).isDisabled(),true);
    await p.screenshot({path:screens+'/review-'+width+'.png'});await confirm(p,'Schedule campaign');await panel(p).getByText('Campaign publication confirmed.',{exact:true}).waitFor();
    let published=(await f.merchant(f.path+'/publication')).publication;assert.equal(published.scheduledAt,date);assert.equal(published.candidateCount,2);
    await p.screenshot({path:screens+'/published-'+width+'.png',fullPage:true});assert.equal(await p.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
    const form=root(p).locator('[data-marketing-form]');await form.getByLabel('Email subject',{exact:true}).fill('A later draft edit');await form.getByRole('button',{name:'Save draft',exact:true}).click();await form.getByText('Campaign draft saved.',{exact:true}).waitFor();
    await panel(p).getByText('Published email and audience',{exact:true}).click();await panel(p).getByText(f.values.subject,{exact:true}).waitFor();assert.equal(await panel(p).getByText('A later draft edit',{exact:true}).count(),0);
    await start(p,'Change send time');const next=later(48);await review(p).getByLabel('Send date and time',{exact:false}).fill(local(next,9));await confirm(p,'Confirm new send time');await panel(p).getByText('New send time confirmed.',{exact:true}).waitFor();
    published=(await f.merchant(f.path+'/publication')).publication;assert.equal(published.scheduledAt,next);assert.equal(published.revision,1);
    await start(p,'Cancel remaining sends');await confirm(p,'Confirm cancellation');await panel(p).getByText('Campaign cancellation confirmed.',{exact:true}).waitFor();assert.equal((await f.merchant(f.path+'/publication')).publication.cancelled,true);
    await panel(p).getByRole('button',{name:'View recipients',exact:true}).click();const recipients=root(p).getByRole('dialog',{name:'Campaign recipients',exact:true});await recipients.getByText('2 recipients shown.',{exact:true}).waitFor();assert.equal(await recipients.getByText('Cancelled',{exact:true}).count(),2);await p.screenshot({path:screens+'/recipients-'+width+'.png'});await recipients.getByRole('button',{name:'Close details',exact:true}).click();
    await panel(p).getByRole('button',{name:'Delivery history',exact:true}).click();const history=root(p).getByRole('dialog',{name:'Delivery history',exact:true});await history.getByText('3 delivery changes shown.',{exact:true}).waitFor();await history.getByText('Remaining sends cancelled',{exact:true}).waitFor();await history.getByRole('button',{name:'Close details',exact:true}).click();
    assert.equal(await f.count('commerce_unsubscribe_tokens'),0);assert.equal(await f.count('commerce_campaign_email_requests'),0);assert.deepEqual(errors,[]);await p.context().close();
  });
});

test('lost publication and schedule responses survive reload and recover exact requests after a role downgrade',async t=>{
  const f=await fixture(t);await f.addBuyer(1);const b=await browser(t),p=await pageFor(b,f,390);await open(p,f);await edit(p,f);await start(p);
  f.control.drop=f.path+'/publish';await confirm(p,'Publish campaign');await panel(p).getByRole('button',{name:'Retry original delivery action',exact:true}).waitFor();
  await panel(p).locator('[data-delivery-error]').filter({hasText:/not confirmed/}).waitFor();assert.equal(await f.count('commerce_campaign_publications'),1);
  const first=f.control.calls.filter(c=>c.path===f.path+'/publish').at(-1).body;assert.equal(await root(p).locator('input[name="name"]').isDisabled(),true);
  await p.reload();await panel(p).getByRole('button',{name:'Retry original delivery action',exact:true}).waitFor();await panel(p).getByRole('button',{name:'Retry original delivery action',exact:true}).click();await panel(p).getByText('Campaign publication confirmed.',{exact:true}).waitFor();
  assert.deepEqual(f.control.calls.filter(c=>c.path===f.path+'/publish').at(-1).body,first);assert.equal(await f.count('commerce_campaign_publications'),1);
  await start(p,'Change send time');await review(p).getByLabel('Send date and time',{exact:false}).fill(local(later(48)));f.control.drop=f.path+'/publication-action';await confirm(p,'Confirm new send time');
  await panel(p).locator('[data-delivery-error]').filter({hasText:/not confirmed/}).waitFor();const action=f.control.calls.filter(c=>c.path===f.path+'/publication-action').at(-1).body;
  await f.db.prepare("UPDATE seller_memberships SET role='viewer' WHERE auth_user_id='alice'").run();await p.reload();await panel(p).getByRole('button',{name:'Retry original delivery action',exact:true}).waitFor();
  await panel(p).getByRole('button',{name:'Retry original delivery action',exact:true}).click();await panel(p).getByText('New send time confirmed.',{exact:true}).waitFor();assert.deepEqual(f.control.calls.filter(c=>c.path===f.path+'/publication-action').at(-1).body,action);
  assert.equal(await f.count('commerce_campaign_publication_actions'),1);assert.equal(await panel(p).getByRole('button',{name:'Change send time',exact:true}).count(),0);assert.equal(await root(p).locator('input[name="name"]').isDisabled(),true);
  await p.screenshot({path:screens+'/recovered-viewer-390.png',fullPage:true});
});

test('changed draft or schedule reviews require a new confirmation and processing closes rescheduling',async t=>{
  const f=await fixture(t);await f.addBuyer(1);const b=await browser(t),p=await pageFor(b,f);await open(p,f);await edit(p,f);
  const form=root(p).locator('[data-marketing-form]');await form.getByLabel('Email subject',{exact:true}).fill('Unsaved subject');assert.equal(await panel(p).getByRole('button',{name:'Review and publish',exact:true}).isDisabled(),true);
  await form.getByRole('button',{name:'Save draft',exact:true}).click();await form.getByText('Campaign draft saved.',{exact:true}).waitFor();await start(p);
  assert.equal((await f.merchant(publicationBase,{id:f.id,revision:2,requestKey:publicationKey(),values:{...f.values,subject:'A concurrent saved subject'}},{method:'POST'})).status,200);
  await confirm(p,'Publish campaign');await panel(p).locator('[data-delivery-error]').filter({hasText:/Review the current campaign/}).waitFor();assert.equal(await f.count('commerce_campaign_publications'),0);
  assert.equal(await panel(p).getByRole('button',{name:'Retry original delivery action',exact:true}).count(),0);
  await form.getByRole('button',{name:'Review saved version',exact:true}).click();const compare=root(p).getByRole('dialog',{name:'Compare your campaign',exact:true});await compare.getByRole('button',{name:'Use saved version',exact:true}).click();
  await start(p);assert.equal(await review(p).locator('input[name="confirmed"]').isChecked(),false);await confirm(p,'Publish campaign');await panel(p).getByText('Campaign publication confirmed.',{exact:true}).waitFor();
  await start(p,'Change send time');assert.equal((await f.action('reschedule',0,later(24))).status,200);await review(p).getByLabel('Send date and time',{exact:false}).fill(local(later(48)));await confirm(p,'Confirm new send time');
  await panel(p).locator('[data-delivery-error]').filter({hasText:/Review the current campaign/}).waitFor();assert.equal(await f.count('commerce_campaign_publication_actions'),1);await start(p,'Change send time');assert.equal(await review(p).locator('input[name="confirmed"]').isChecked(),false);
  await f.db.prepare("UPDATE commerce_jobs SET available_at='2000-01-01T00:00:00.000Z' WHERE kind='campaign.send'").run();assert.equal((await f.call('/internal/commerce/jobs/claim',{environment:'sandbox',workerId:'ui_processing',kinds:['campaign.send'],limit:1})).jobs.length,1);
  await review(p).getByLabel('Send date and time',{exact:false}).fill(local(later(72)));await confirm(p,'Confirm new send time');await panel(p).locator('[data-delivery-error]').filter({hasText:/Processing has started|processing has started/}).waitFor();
  assert.equal(await panel(p).getByRole('button',{name:'Change send time',exact:true}).isDisabled(),true);assert.equal(await f.count('commerce_campaign_publication_actions'),1);
});

test('unverified acknowledgements retain the original publication and malformed recovery storage is never overwritten',async t=>{
  const f=await fixture(t);await f.addBuyer(1);const b=await browser(t),p=await pageFor(b,f,390);await open(p,f);await edit(p,f);let alter=true;
  await p.route('**/cart/admin/?cloud=*',async route=>{if(alter&&new URL(route.request().url()).searchParams.get('cloud')===f.path+'/publish'){
    alter=false;const response=await route.fetch(),data=await response.json();data.receipt.requestKey=publicationKey();await route.fulfill({response,json:data});return;}await route.continue();});
  await start(p);await confirm(p,'Publish campaign');await panel(p).getByText('The delivery response could not be verified. Retry the original delivery action.',{exact:true}).waitFor();
  const first=f.control.calls.filter(c=>c.path===f.path+'/publish').at(-1).body;await p.reload();await panel(p).getByRole('button',{name:'Retry original delivery action',exact:true}).click();await panel(p).getByText('Campaign publication confirmed.',{exact:true}).waitFor();assert.deepEqual(f.control.calls.filter(c=>c.path===f.path+'/publish').at(-1).body,first);
  await start(p,'Change send time');await review(p).getByLabel('Send date and time',{exact:false}).fill(local(later(48)));f.control.drop=f.path+'/publication-action';await confirm(p,'Confirm new send time');await panel(p).locator('[data-delivery-error]').filter({hasText:/not confirmed/}).waitFor();
  const raw=await p.evaluate(()=>{const k=Object.keys(sessionStorage).find(k=>k.startsWith('ezkart.marketing-publication.v1:'));const data=JSON.parse(sessionStorage.getItem(k));data.entries[0].pending.body.scheduledAt='invalid';const raw=JSON.stringify(data);sessionStorage.setItem(k,raw);return raw;});
  await p.reload();await root(p).locator('[data-campaign-delivery-recovery]').getByText(/saved delivery action could not be verified/).waitFor();assert.equal(await panel(p).getByRole('button',{name:'Change send time',exact:true}).isDisabled(),true);
  assert.equal(await p.evaluate(()=>sessionStorage.getItem(Object.keys(sessionStorage).find(k=>k.startsWith('ezkart.marketing-publication.v1:')))),raw);assert.equal(await f.count('commerce_campaign_publication_actions'),1);
});

test('delivery holds, missing permission and unavailable storage block publication without hiding the saved draft',async t=>{
  const b=await browser(t),held=await fixture(t,{bindings:{COMMERCE_CAMPAIGN_SEND:'off'}}),p=await pageFor(b,held,390);await open(p,held);await edit(p,held);await panel(p).getByText('Campaign delivery is not connected. You can keep editing this draft.',{exact:true}).waitFor();
  assert.equal(await panel(p).getByRole('button',{name:'Review and publish',exact:true}).isDisabled(),true);await p.context().close();
  const f=await fixture(t),empty=await pageFor(b,f);await open(empty,f);await edit(empty,f);await panel(empty).getByRole('button',{name:'Review and publish',exact:true}).click();await review(empty).getByText('No customers currently have email permission for this audience. Review the audience before publishing.',{exact:true}).waitFor();
  assert.equal(await review(empty).getByRole('button',{name:'Publish campaign',exact:true}).isDisabled(),true);await empty.context().close();await f.addBuyer(1);
  const blocked=await pageFor(b,f);await blocked.addInitScript(()=>{const set=Storage.prototype.setItem;Storage.prototype.setItem=function(k,v){if(k.startsWith('ezkart.marketing-publication.v1:'))throw Error('Unavailable');return set.call(this,k,v);};});
  await open(blocked,f);await edit(blocked,f);assert.equal(await panel(blocked).getByRole('button',{name:'Review and publish',exact:true}).isDisabled(),true);await root(blocked).locator('[data-campaign-delivery-recovery]').getByText(/cannot preserve delivery actions/).waitFor();
  assert.equal(await f.count('commerce_campaign_publications'),0);assert.equal(await held.count('commerce_campaign_publications'),0);
});

test('recipient paging keeps earlier rows after failures and ignores a response after its dialog closes',async t=>{
  const f=await fixture(t);for(let n=1;n<=27;n++)await f.addBuyer(n);assert.equal((await f.publish()).status,200);const b=await browser(t),p=await pageFor(b,f,390);await open(p,f);await edit(p,f);
  await panel(p).getByRole('button',{name:'View recipients',exact:true}).click();const d=root(p).getByRole('dialog',{name:'Campaign recipients',exact:true});await d.getByText('25 recipients shown.',{exact:true}).waitFor();let fail=true,release,entered;const barrier=new Promise(r=>release=r),started=new Promise(r=>entered=r);
  await p.route('**/cart/admin/?cloud=*',async route=>{const path=new URL(route.request().url()).searchParams.get('cloud');if(path?.startsWith(f.path+'/recipients?cursor=')){
    if(fail){fail=false;await route.fulfill({status:503,json:{ok:false,error:'Recipient page interrupted'}});return;}entered();await barrier;}await route.continue();});
  await d.getByRole('button',{name:'Load more',exact:true}).click();await d.getByText('Recipient page interrupted',{exact:true}).waitFor();assert.equal(await d.locator('li').count(),25);
  await d.getByRole('button',{name:'Try details again',exact:true}).click();await started;await d.getByRole('button',{name:'Close details',exact:true}).click();await root(p).getByRole('button',{name:'New campaign',exact:true}).click();
  const arrived=p.waitForResponse(r=>new URL(r.url()).searchParams.get('cloud')?.startsWith(f.path+'/recipients?cursor='));release();await arrived;assert.equal(await d.isVisible(),false);assert.equal(await root(p).getByRole('heading',{name:'New campaign',exact:true}).isVisible(),true);
  await edit(p,f);await panel(p).getByRole('button',{name:'View recipients',exact:true}).click();await d.getByText('25 recipients shown.',{exact:true}).waitFor();await d.getByRole('button',{name:'Load more',exact:true}).click();await d.getByText('27 recipients shown.',{exact:true}).waitFor();assert.equal(await d.locator('li').count(),27);
});

test('merchant delivery views show actual submission, delivery and complaint evidence without open or sales claims',async t=>{
  const f=await fixture(t);await f.addBuyer(1);await f.addBuyer(2);assert.equal((await f.publish()).status,200);const sent=[];
  const fetcher=async(url,options)=>{const parsed=new URL(url);if(parsed.origin==='https://auth.fixture.test'){const id=parsed.pathname.split('/').at(-1);return Response.json({id,email:'buyer'+id.split('-').at(-1)+'@example.test',email_confirmed_at:'2026-09-01T00:00:00Z'});}
    const id=randomUUID(),message=JSON.parse(options.body);sent.push({id,message});return Response.json({id});};
  assert.equal((await dispatchCampaignEmails(f.env,2,fetcher)).processed,2);
  for(let i=0;i<2;i++)await recordEmailWebhook(emailFixtureCallback(emailFixtureEvent(sent[i].message,sent[i].id,i?'email.complained':'email.delivered')),f.env,'test_mail');
  const b=await browser(t),p=await pageFor(b,f,390);await open(p,f);await edit(p,f);await panel(p).locator('[data-delivery-totals]').getByText('Complaints',{exact:true}).waitFor();
  const values=await panel(p).locator('[data-delivery-totals]>div').evaluateAll(rows=>Object.fromEntries(rows.map(n=>[n.querySelector('span').textContent,Number(n.querySelector('b').textContent)])));assert.equal(values.Submitted,2);assert.equal(values.Delivered,1);assert.equal(values.Complaints,1);
  await panel(p).getByRole('button',{name:'View recipients',exact:true}).click();const d=root(p).getByRole('dialog',{name:'Campaign recipients',exact:true});await d.getByText('2 recipients shown.',{exact:true}).waitFor();assert.equal(await d.getByText('Delivered',{exact:true}).count(),1);assert.equal(await d.getByText('Complaint received',{exact:true}).count(),1);
  assert.equal(await p.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);await p.screenshot({path:screens+'/delivery-evidence-390.png'});await p.keyboard.press('Escape');assert.equal(await d.isVisible(),false);assert.equal(await panel(p).getByRole('button',{name:'View recipients',exact:true}).evaluate(n=>n===document.activeElement),true);
});

test('sign-in replacement after publication removes private delivery UI and keeps the pending operation scoped to its original account',async t=>{
  const f=await fixture(t);await f.addBuyer(1);const b=await browser(t),p=await pageFor(b,f,390);await open(p,f);await edit(p,f);await start(p);
  f.control.afterResponse=async path=>{if(path!==f.path+'/publish')return;f.control.afterResponse=null;f.app.cli(`define('EZ_CUSTOMER_SESSION_BRIDGE', true); session_id('${f.cookie.value}'); require '${process.cwd()}/cart/admin/index.php'; $_SESSION['admin_user']=['id'=>'bob','email'=>'bob@example.test']; $_SESSION['csrf_token']='changed'; session_write_close();`);};
  await confirm(p,'Publish campaign');await root(p).getByRole('link',{name:'Reload sign-in',exact:true}).waitFor();assert.equal(await root(p).locator('input,dialog,[data-campaign-delivery]').count(),0);assert.equal(await f.count('commerce_campaign_publications'),1);
  const bob=f.app.adminCookie({supabase_access_token:await f.merchantToken('bob','bob@example.test'),admin_user:{id:'bob',email:'bob@example.test'}});await p.context().addCookies([bob]);await p.reload();await root(p).getByText('Drafts and your planning calendar are ready.',{exact:true}).waitFor();
  assert.equal(await root(p).locator('[data-campaign-delivery-recovery]').isVisible(),false);assert.equal(await root(p).locator('.marketing-campaign-card').count(),0);assert.equal(await root(p).getByText(f.values.name,{exact:true}).count(),0);
});

test('a later workspace timezone refresh cannot reinterpret the send time already under review',async t=>{
  const f=await fixture(t);await f.addBuyer(1);const profile=(await f.merchant('/v1/commerce/settings')).profile.values;
  assert.equal((await f.merchant('/v1/commerce/settings',{kind:'profile',revision:0,requestKey:publicationKey(),values:{...profile,timezone:'Asia/Jayapura'}},{method:'POST'})).status,200);
  const b=await browser(t),p=await pageFor(b,f,390);await open(p,f);await edit(p,f);await start(p);await review(p).getByLabel('Schedule for later',{exact:true}).check();
  const date=later(48);await review(p).getByLabel('Send date and time',{exact:false}).fill(local(date,9));await review(p).locator('input[name="confirmed"]').check();
  await review(p).getByLabel('Send date and time',{exact:false}).fill(local(later(72),9));await p.keyboard.press('Tab');assert.equal(await review(p).locator('input[name="confirmed"]').isChecked(),false);
  assert.equal((await f.merchant('/v1/commerce/settings',{kind:'profile',revision:1,requestKey:publicationKey(),values:{...profile,timezone:'Asia/Jakarta'}},{method:'POST'})).status,200);
  await p.evaluate(()=>document.querySelector('[data-marketing-refresh]').click());await root(p).locator('[data-marketing-timezone]').getByText('Store timezone: Asia/Jakarta',{exact:true}).waitFor();
  assert.equal(await review(p).getByText('Store timezone: Asia/Jayapura',{exact:true}).count(),1);await review(p).getByLabel('Send date and time',{exact:false}).fill(local(date,9));await confirm(p,'Schedule campaign');await panel(p).getByText('Campaign publication confirmed.',{exact:true}).waitFor();
  assert.equal((await f.merchant(f.path+'/publication')).publication.scheduledAt,date);
});
