import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdir,writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {setupCentralFixture} from './central-fixture.mjs';
import {browser,pageFor} from './review-workspace-fixture.mjs';
import {grantCampaignConsent,prepareUnsubscribeFixture,unsubscribeFixtureOrder,unsubscribeBuyer as buyer} from '../../cloudflare/ezkart-api/test/campaign-unsubscribe-fixture.mjs';
const screens='/tmp/ezkart-unsubscribe-ui-01a0d643',confirm='List-Unsubscribe=One-Click',type='application/x-www-form-urlencoded';
async function fixture(t,overrides={}){const f=await setupCentralFixture(t,overrides);await unsubscribeFixtureOrder(f);await grantCampaignConsent(f);const link=await prepareUnsubscribeFixture(f);await link.statement.run();return {...f,link,url:f.app.base+'/cart/unsubscribe.php?t='+link.token};}
const peek=f=>f.call('/internal/commerce/customer-consents',{environment:'sandbox',customer:buyer,action:'list'});

test('anonymous desktop/mobile recipients see a read-only confirmation and explicitly unsubscribe without scripts, sessions or external resources',async t=>{
 const f=await fixture(t),b=await browser(t);await mkdir(screens,{recursive:true});await f.db.prepare("UPDATE sellers SET name=? WHERE id='seller_alice'").bind('Alice Tea <img src=x onerror=alert(1)>').run();
 for(const [n,width] of [1360,390].entries()){
  if(n)await grantCampaignConsent(f,{revision:2,name:'Alice Tea <img src=x onerror=alert(1)>'});
  const context=await b.newContext({viewport:{width,height:960},javaScriptEnabled:false}),p=await context.newPage(),requests=[];p.on('request',r=>requests.push(r.url()));
  const response=await p.goto(f.url);assert.equal(response.status(),200);assert.equal(response.headers()['referrer-policy'],'no-referrer');assert.match(response.headers()['cache-control'],/no-store/);assert.match(response.headers()['content-security-policy'],/form-action 'self'/);assert.equal(response.headers()['set-cookie'],undefined);
  await p.getByRole('heading',{name:'Your email, your choice',exact:true}).waitFor();assert.equal((await peek(f)).items[0].state,'granted');assert.equal(await f.count('commerce_unsubscribe_changes'),n);assert.equal(await p.locator('main img,script').count(),0);assert.equal(await p.getByText('Alice Tea <img src=x onerror=alert(1)>',{exact:true}).count(),1);assert.equal((await p.content()).includes(buyer.email),false);assert.equal((await context.cookies()).length,0);
  await p.screenshot({path:screens+'/confirm-'+width+'.png',fullPage:true});await p.getByRole('button',{name:'Stop promotional emails',exact:true}).focus();await p.keyboard.press('Enter');await p.getByRole('heading',{name:'You’re unsubscribed',exact:true}).waitFor();
  assert.equal(await f.count('commerce_unsubscribe_changes'),n+1);assert.equal((await peek(f)).items[0].state,'withdrawn');assert.equal(await p.getByRole('button',{name:'Stop promotional emails',exact:true}).count(),0);
  await p.screenshot({path:screens+'/done-'+width+'.png',fullPage:true});assert.equal(await p.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);assert(requests.every(url=>url.startsWith(f.app.base)),JSON.stringify(requests));assert.equal((await context.cookies()).length,0);await context.close();
 }
 const calls=(await f.app.calls()).filter(c=>c.url.includes('/v1/public/campaign-unsubscribe'));assert(calls.length>=4);assert(calls.every(c=>!c.headers.some(h=>/^(authorization|cookie|x-ezkart-signature):/i.test(h))));assert.equal((await f.providerCalls()).length,0);assert.equal(await f.count('commerce_email_requests'),0);
});

test('mail-system URL-encoded/multipart POSTs need no login or redirect, and current account cookies never choose the recipient',async t=>{
 const f=await fixture(t);let response=await fetch(f.url,{method:'POST',redirect:'manual',headers:{'content-type':type,Origin:'https://mail.example.test',Cookie:'ezkart_customer=another-account; ezkart_admin=another-store'},body:confirm});assert.equal(response.status,200);assert.equal(response.headers.get('location'),null);assert.equal(response.headers.get('set-cookie'),null);assert.match(await response.text(),/You’re unsubscribed/);assert.equal(await f.count('commerce_unsubscribe_changes'),1);
 await grantCampaignConsent(f,{revision:2});const form=new FormData();form.append('List-Unsubscribe','One-Click');response=await fetch(f.url,{method:'POST',redirect:'manual',body:form});assert.equal(response.status,200);assert.match(await response.text(),/You’re unsubscribed/);assert.equal(await f.count('commerce_unsubscribe_changes'),2);
 response=await fetch(f.url,{method:'HEAD'});assert.equal(response.status,200);assert.equal(await response.text(),'');assert.equal(await f.count('commerce_unsubscribe_changes'),2);
});

test('lost unsubscribe acknowledgements retain the same link and recover without another withdrawal receipt',async t=>{
 const f=await fixture(t),b=await browser(t),p=await pageFor(b,f,390,null);await p.goto(f.url);f.control.drop=f.link.path;await p.getByRole('button',{name:'Stop promotional emails',exact:true}).click();await p.getByRole('heading',{name:'Please try again',exact:true}).waitFor();assert.equal(await f.count('commerce_unsubscribe_changes'),1);assert.equal(new URL(p.url()).searchParams.get('t'),f.link.token);
 await p.screenshot({path:screens+'/retry-390.png',fullPage:true});await p.getByRole('button',{name:'Try unsubscribe again',exact:true}).click();await p.getByRole('heading',{name:'You’re unsubscribed',exact:true}).waitFor();assert.equal(await f.count('commerce_unsubscribe_changes'),1);assert.equal((await peek(f)).items[0].revision,2);const posts=f.control.calls.filter(c=>c.path===f.link.path&&c.body);assert.equal(posts.length,2);assert(posts.every(c=>c.body===confirm));
});

test('invalid links, forged scope and malformed or oversized confirmations are rejected without changing permission',async t=>{
 const f=await fixture(t);
 for(const path of ['/cart/unsubscribe.php','/cart/unsubscribe.php?t=bad','/cart/unsubscribe.php?t='+'0'.repeat(64),'/cart/unsubscribe.php?t[]='+f.link.token,'/cart/unsubscribe.php?t='+f.link.token+'&t='+f.link.token,'/cart/unsubscribe.php?t='+f.link.token+'&email=other@example.test']){const r=await fetch(f.app.base+path);assert.equal(r.status,404,path);const html=await r.text();assert(!html.includes(buyer.email));assert(!html.includes('alice'));}
 for(const [body,contentType,status] of [[confirm+'&List-Unsubscribe=One-Click',type,400],[confirm+'&allow=true',type,400],['List-Unsubscribe=Subscribe',type,400],['{}','application/json',415],['x'.repeat(8193),type,413]]){const r=await fetch(f.url,{method:'POST',headers:{'content-type':contentType},body});assert.equal(r.status,status);}
 const file=new FormData();file.append('List-Unsubscribe',new Blob(['One-Click']),'directive.txt');assert.equal((await fetch(f.url,{method:'POST',body:file})).status,400);
 const extra=new FormData();extra.append('List-Unsubscribe','One-Click');extra.append('sellerId','seller_bob');assert.equal((await fetch(f.url,{method:'POST',body:extra})).status,400);
 const method=await fetch(f.url,{method:'PUT',body:confirm});assert.equal(method.status,405);assert.equal(method.headers.get('allow'),'GET, HEAD, POST');assert.equal(await f.count('commerce_unsubscribe_changes'),0);assert.equal((await peek(f)).items[0].state,'granted');
});

test('unsubscribing works through the PHP commerce hold and later appears in the verified buyer’s permission history',async t=>{
 const held=await fixture(t,{EZKART_COMMERCE_STORAGE:'legacy'}),b=await browser(t),p=await pageFor(b,held,390,null);await held.db.prepare("UPDATE sellers SET status='suspended' WHERE id='seller_alice'").run();await p.goto(held.url);await p.getByRole('button',{name:'Stop promotional emails',exact:true}).click();await p.getByRole('heading',{name:'You’re unsubscribed',exact:true}).waitFor();assert.equal((await peek(held)).items[0].state,'withdrawn');
 const f=await fixture(t),response=await fetch(f.url,{method:'POST',headers:{'content-type':type},body:confirm});assert.equal(response.status,200);await writeFile(join(f.app.directory,'auth-response.json'),JSON.stringify({user:{email:buyer.email}}));const cookie=f.app.customerCookie(buyer.email),account=await pageFor(b,f,390,cookie);await account.goto(f.app.base+'/cart/preferences.php');await account.getByText('Your preferences are up to date.',{exact:true}).waitFor();assert.equal(await account.locator('input[name=allow]').isChecked(),false);
 await account.getByText('Preference history',{exact:true}).click();await account.getByText('From an unsubscribe link',{exact:true}).waitFor();assert.equal(await account.locator('.preference-history li').count(),2);await account.screenshot({path:screens+'/history-390.png',fullPage:true});assert.equal(await account.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
});
