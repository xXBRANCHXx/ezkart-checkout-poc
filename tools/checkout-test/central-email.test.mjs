import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdir,writeFile} from 'node:fs/promises';
import {randomBytes,randomUUID} from 'node:crypto';
import {setupCentralFixture} from './central-fixture.mjs';
import {browser,pageFor,choose} from './review-workspace-fixture.mjs';
import {emailFixtureConfiguration,emailFixtureEvent,emailFixtureCallback} from '../../cloudflare/ezkart-api/test/email-fixture.mjs';
const key=()=>randomBytes(16).toString('hex'),base='/v1/commerce/notifications',screens='/tmp/ezkart-email-ui-01a0d643';
const root=p=>p.locator('[data-notification-workspace]');
async function fixture(t){
  const mail=[];
  const outbound=async request=>{
    const url=new URL(request.url);
    if(url.origin==='https://auth.fixture.test'&&url.pathname==='/auth/v1/admin/users/alice')return Response.json({id:'alice',email:'alice@example.test',email_confirmed_at:'2026-09-01T00:00:00Z'});
    assert.equal(url.href,'https://api.resend.com/emails');assert.equal(request.method,'POST');
    const payload=await request.json(),id=randomUUID();mail.push({payload,id});return Response.json({id});
  };
  const f=await setupCentralFixture(t,{EZKART_TEST_NOTIFICATIONS:'1'},{bindings:emailFixtureConfiguration(),outbound});
  const cookie=f.app.adminCookie({supabase_access_token:await f.merchantToken('alice','alice@example.test'),admin_user:{id:'alice',email:'alice@example.test'}});
  const settings=await f.merchant('/v1/commerce/settings');settings.notifications.values.payment_confirmed={email:true,inApp:false};
  assert.equal((await f.merchant('/v1/commerce/settings',{kind:'notifications',values:settings.notifications.values,revision:0,requestKey:key()},{method:'POST'})).status,200);
  const create=async()=>{const made=await f.create(f.input());assert.equal(made.status,200,made.error);assert.equal((await f.paid(made.order)).status,200);assert.equal((await f.call('/internal/commerce/notifications/drain',{environment:'sandbox'})).failed,0);return made.order;};
  const callback=async(type,index=0)=>{const message=mail[index],request=emailFixtureCallback(emailFixtureEvent(message.payload,message.id,type));const result=await f.mf.dispatchFetch(request.url,{method:'POST',headers:Object.fromEntries(request.headers),body:await request.text()});assert.equal(result.status,200,await result.text());};
  const drain=async()=>{const r=await f.call('/internal/commerce/email/drain',{environment:'sandbox'});assert.equal(r.failed,0,JSON.stringify(r));return r;};
  return {...f,cookie,mail,create,callback,drain};
}

test('email-only merchants see queued, submitted and delivered history at desktop and phone widths, including the real email template',async t=>{
  const f=await fixture(t),order=await f.create(),b=await browser(t);await mkdir(screens,{recursive:true});
  for(const width of [1360,390]){
    const p=await pageFor(b,f,width),errors=[];p.on('pageerror',error=>errors.push(error.message));
    await p.goto(f.app.base+'/cart/admin/?page=notifications');await root(p).getByText('0 notifications shown',{exact:true}).waitFor();
    await root(p).getByRole('button',{name:'Your emails',exact:true}).click();await root(p).getByText('1 email update shown',{exact:true}).waitFor();
    await root(p).getByText(width===1360?'Email queued':'Email accepted by the recipient’s mail server',{exact:true}).waitFor();
    assert.equal(await root(p).getByRole('button',{name:'Mark as read',exact:true}).count(),0);assert.equal(await root(p).getByRole('button',{name:'Mark shown as read',exact:true}).isVisible(),false);
    assert.equal(await root(p).getByRole('link',{name:'View order',exact:true}).getAttribute('href'),'/cart/admin/?page=orders&order='+order.id);
    assert.equal(await p.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
    if(width===1360){await f.drain();await root(p).getByRole('button',{name:'Refresh',exact:true}).click();await root(p).getByText('Email accepted by the sending service',{exact:true}).waitFor();await f.callback('email.delivered');
      await root(p).getByRole('button',{name:'Refresh',exact:true}).click();await root(p).getByText('Email accepted by the recipient’s mail server',{exact:true}).waitFor();}
    await p.screenshot({path:screens+'/history-'+width+'.png',fullPage:true});
    await p.reload();await root(p).getByText('1 email update shown',{exact:true}).waitFor();await root(p).getByRole('button',{name:'Your inbox',exact:true}).click();await root(p).getByText('0 notifications shown',{exact:true}).waitFor();
    await p.goBack();await root(p).getByText('1 email update shown',{exact:true}).waitFor();assert.deepEqual(errors,[]);
    const preview=await p.context().newPage();await preview.setContent(f.mail[0].payload.html);assert.equal(await preview.locator('h1').textContent(),'Payment confirmed');assert.equal(await preview.locator('script').count(),0);assert.equal(await preview.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
    await preview.screenshot({path:screens+'/template-'+width+'.png',fullPage:true});await p.context().close();
  }
  await writeFile(screens+'/notification.html',f.mail[0].payload.html);assert.equal(f.mail.length,1);assert.equal((await f.providerCalls()).length,0);
});

test('email history recovers from interrupted reads and delivery activity shows actual failure without exposing addresses',async t=>{
  const f=await fixture(t);await f.create();await f.drain();await f.callback('email.bounced');const b=await browser(t),p=await pageFor(b,f,390);
  await p.goto(f.app.base+'/cart/admin/?page=notifications&view=email');await root(p).getByText('Email bounced',{exact:true}).waitFor();
  f.control.fail=base+'/email?q=&category=';
  await p.route('**/cart/admin/?cloud=*',async route=>{const path=new URL(route.request().url()).searchParams.get('cloud');if(path?.startsWith(base+'/email')&&f.control.fail){f.control.fail='';await route.fulfill({status:503,json:{ok:false,error:'Email history interrupted'}});return;}await route.continue();});
  await root(p).getByRole('button',{name:'Refresh',exact:true}).click();await root(p).getByText(/Email history interrupted/).waitFor();await root(p).getByText('Email bounced',{exact:true}).waitFor();
  await root(p).getByRole('button',{name:'Refresh',exact:true}).click();await root(p).getByText('1 email update shown',{exact:true}).waitFor();
  await root(p).getByRole('button',{name:'Store delivery activity',exact:true}).click();await root(p).getByText('1 delivery update shown',{exact:true}).waitFor();await root(p).locator('[data-notice-processing]').getByText('Email bounced',{exact:true}).waitFor();
  assert.equal((await root(p).textContent()).includes('alice@example.test'),false);assert.equal(await p.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);await p.screenshot({path:screens+'/bounced-390.png',fullPage:true});
  const activity=root(p).locator('[data-notice-processing]');await choose(p,activity,'state','All updates');await activity.getByRole('button',{name:'Apply delivery filter',exact:true}).click();await activity.getByText('2 delivery updates shown',{exact:true}).waitFor();
  const headers=await p.evaluate(()=>{const c=JSON.parse(document.querySelector('[data-notification-workspace]').dataset.config);return {'X-Ezkart-CSRF':c.csrf,'X-Ezkart-Notification-Account':c.account,'X-Ezkart-Notification-Store':c.store};});headers.Cookie='ezkart_admin='+f.cookie.value;
  const url=path=>'/cart/admin/?cloud='+encodeURIComponent(base+path);
  for(const suffix of ['/email?state=read','/email?seller=seller_bob','/email?category=returns&category=messages'])assert.equal((await f.app.request(url(suffix),undefined,headers)).status,400);
  assert.equal((await f.app.request(url('/email'),undefined,{...headers,'X-Ezkart-Notification-Account':'someone_else'})).status,401);
  const foreign=await f.merchant(base+'/email',undefined,{seller:'bob'});assert.equal(foreign.items.length,0);
  await f.create();await f.drain();const skipped=await f.merchant(base+'/email');assert.equal(skipped.items[0].email.status,'skipped');assert.equal(skipped.items[0].email.reason,'suppressed');assert.equal(f.mail.length,1);
});
