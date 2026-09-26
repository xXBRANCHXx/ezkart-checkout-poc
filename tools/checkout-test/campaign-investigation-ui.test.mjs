import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdir,readFile,stat,writeFile} from 'node:fs/promises';
import {randomUUID} from 'node:crypto';
import {spawn} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {setupCentralFixture} from './central-fixture.mjs';
import {browser,pageFor} from './review-workspace-fixture.mjs';
import {campaignMailConfiguration} from '../../cloudflare/ezkart-api/test/campaign-email-fixture.mjs';
import {publicationFixtureOn} from '../../cloudflare/ezkart-api/test/campaign-publication-fixture.mjs';

async function command(f,args,extraEnv={},override=null){
  const tool=override||fileURLToPath(new URL('../commerce/email-investigate.php',import.meta.url)),prepend=fileURLToPath(new URL('./provider-fixture.php',import.meta.url));
  return new Promise((resolve,reject)=>{
    const child=spawn(process.env.PHP_BINARY||'php',['-n','-d','auto_prepend_file='+prepend,tool,...args],{env:{...f.app.env,...extraEnv}});let stdout='',stderr='';
    child.stdout.on('data',v=>stdout+=v);child.stderr.on('data',v=>stderr+=v);child.on('error',reject);child.on('close',code=>resolve({code,stdout,stderr,data:stdout?JSON.parse(stdout):null}));
  });
}
async function fixture(t){
  const sent=[],reads=[],bindings={...campaignMailConfiguration(),COMMERCE_EMAIL_RECONCILE:'enabled',COMMERCE_EMAIL_TEST_RECIPIENTS:'["buyer1@example.test"]'};
  const outbound=async request=>{
    const url=new URL(request.url);
    if(url.origin==='https://auth.fixture.test')return Response.json({id:'campaign-buyer-1',email:'buyer1@example.test',email_confirmed_at:'2026-09-01T00:00:00Z'});
    assert.equal(url.origin,'https://api.resend.com');
    if(request.method==='POST'){
      assert.equal(url.pathname,'/emails');const payload=await request.json(),id=randomUUID();sent.push({payload,id,at:new Date().toISOString()});throw Error('Fixture lost provider acknowledgement');
    }
    assert.equal(request.method,'GET');const saved=sent.find(s=>url.pathname==='/emails/'+s.id);assert(saved);reads.push(url.pathname);
    return Response.json({object:'email',id:saved.id,...saved.payload,created_at:saved.at,last_event:'delivered',cc:[],bcc:[],reply_to:[],scheduled_at:null});
  };
  const base=await setupCentralFixture(t,{}, {bindings,outbound}),f=await publicationFixtureOn(base,bindings),cookie=f.app.adminCookie({supabase_access_token:await f.merchantToken('alice','alice@example.test'),admin_user:{id:'alice',email:'alice@example.test'}});
  await f.addBuyer(1);assert.equal((await f.publish()).status,200);assert.equal((await f.call('/internal/commerce/campaigns/drain',{environment:'sandbox'})).failed,1);
  assert.equal((await f.action('cancel')).status,200);await f.db.prepare("UPDATE commerce_jobs SET available_at='2000-01-01T00:00:00.000Z' WHERE kind='campaign.send'").run();
  assert.equal((await f.call('/internal/commerce/campaigns/drain',{environment:'sandbox'})).failed,1);
  return {...f,cookie,sent,reads};
}

test('campaign operator command recovers interrupted lookups and resolutions, and merchants see checked delivery on desktop and phone',async t=>{
  const f=await fixture(t),x=await f.db.prepare('SELECT * FROM commerce_campaign_email_requests').first();
  const list=await command(f,['--action=list','--purpose=campaign']);assert.equal(list.code,0,list.stderr);assert.equal(list.data.items[0].id,x.id);
  assert.equal((await command(f,['--action=list'])).data.items.length,0);
  assert.equal((await command(f,['--action=view','--request='+x.id])).code,1);assert.equal((await command(f,['--action=list','--purpose=unknown'])).code,1);
  const intent=f.app.directory+'/campaign-lookup.json',args=['--action=lookup','--purpose=campaign','--request='+x.id,'--provider='+f.sent[0].id,'--operator=fixture_operator','--intent='+intent];
  f.control.drop='/internal/commerce/campaigns/lookup';assert.equal((await command(f,args)).code,1);
  const raw=await readFile(intent,'utf8'),saved=JSON.parse(raw);assert.equal((await stat(intent)).mode&0o777,0o600);assert(saved.arguments.includes('--purpose=campaign'));assert(!raw.includes('commerce-service-fixture-secret'));
  assert.equal((await command(f,['--action=retry','--intent='+intent,'--purpose=transactional'])).code,1);assert.equal(await readFile(intent,'utf8'),raw);
  const retry=await command(f,['--action=retry','--intent='+intent]);assert.equal(retry.code,0,retry.stderr);assert.equal(retry.data.receipt.outcome,'matched');assert.equal(retry.data.receipt.lookupKey,saved.key);assert.equal(f.reads.length,1);
  assert.equal((await command(f,args)).code,1);assert.equal((await command(f,['--action=retry','--intent='+intent],{EZKART_COMMERCE_SERVICE_SECRET:'changed-fixture-secret-for-retry-only'})).code,1);
  assert.equal((await command(f,['--action=list','--purpose=campaign'],{EZKART_DEPLOYMENT_ENVIRONMENT:'production'})).code,1);
  const view=await command(f,['--action=view','--purpose=campaign','--request='+x.id]);assert.equal(view.code,0,view.stderr);assert.equal(view.data.request.state,'dead');
  const resolution=f.app.directory+'/campaign-resolution.json',resolve=['--action=resolve','--purpose=campaign','--request='+x.id,'--lookup='+saved.key,'--updated-at='+view.data.request.updatedAt,'--operator=fixture_operator','--intent='+resolution];
  f.control.drop='/internal/commerce/campaigns/resolve';assert.equal((await command(f,resolve)).code,1);const result=await command(f,['--action=retry','--intent='+resolution]);assert.equal(result.code,0,result.stderr);assert.equal(result.data.replayed,true);
  assert.equal(f.sent.length,1);assert.equal(f.reads.length,1);assert.equal(await f.count('commerce_campaign_email_resolutions'),1);
  const b=await browser(t),p=await pageFor(b,f,1360),root=p.locator('[data-marketing]'),screens='/tmp/ezkart-campaign-investigation-ui-01a0d643';await mkdir(screens,{recursive:true});
  const errors=[];p.on('pageerror',e=>errors.push(e.message));
  for(const width of [1360,390]){
    await p.setViewportSize({width,height:900});await p.goto(f.app.base+'/cart/admin/?page=marketing');await root.getByText('Drafts and your planning calendar are ready.',{exact:true}).waitFor();
    await root.locator('.marketing-campaign-card').getByRole('button',{name:'Edit draft',exact:true}).click();await root.locator('[data-campaign-delivery]').getByRole('button',{name:'View recipients',exact:true}).click();
    const dialog=root.getByRole('dialog',{name:'Campaign recipients',exact:true});await dialog.getByText('1 recipient shown.',{exact:true}).waitFor();await dialog.getByText('Delivered',{exact:true}).waitFor();
    await dialog.getByText(/^Delivery status checked:/).waitFor();await dialog.getByText(/^Submission confirmed after review:/).waitFor();assert.equal(await dialog.getByText(/^Delivered:/).count(),0);
    assert.equal(await dialog.getByText(/^Needs review:/).count(),0);assert.equal(await p.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
    await p.screenshot({path:screens+'/recovered-'+width+'.png'});await p.keyboard.press('Escape');assert.equal(await root.getByRole('button',{name:'View recipients',exact:true}).evaluate(e=>e===document.activeElement),true);
  }
  assert.deepEqual(errors,[]);assert.equal(f.sent.length,1);
  const direct=await fetch(f.app.base+'/tools/commerce/email-investigate.php');assert.equal(direct.status,404);assert.equal(await direct.text(),'');
});

test('mismatched campaign command acknowledgements stay unconfirmed and the original intent remains recoverable',async t=>{
  const f=await fixture(t),x=await f.db.prepare('SELECT * FROM commerce_campaign_email_requests').first(),wrapper=f.app.directory+'/mismatched-command.php';
  const source=fileURLToPath(new URL('../commerce/email-investigate.php',import.meta.url));
  await writeFile(wrapper,`<?php\nrequire ${JSON.stringify(source)};\nexit(ez_email_investigation_main(array_slice($argv, 1), function($method, $target, $payload) {\n  $result = ez_commerce_request($method, $target, $payload);\n  if (str_ends_with($target, '/lookup')) $result['receipt']['lookupKey'] = str_repeat('0', 32);\n  if (str_ends_with($target, '/resolve')) $result['resolution']['requestId'] = 'campmail_' . str_repeat('0', 32);\n  return $result;\n}));\n`);
  const lookup=f.app.directory+'/mismatch-lookup.json',args=['--action=lookup','--purpose=campaign','--request='+x.id,'--provider='+f.sent[0].id,'--operator=fixture_operator','--intent='+lookup];
  const wrong=await command(f,args,{},wrapper);assert.equal(wrong.code,1);assert.equal(wrong.stdout,'');const original=await readFile(lookup,'utf8');
  const correct=await command(f,['--action=retry','--intent='+lookup]);assert.equal(correct.code,0,correct.stderr);assert.equal(correct.data.replayed,true);assert.equal(await readFile(lookup,'utf8'),original);
  const view=await command(f,['--action=view','--purpose=campaign','--request='+x.id]),resolution=f.app.directory+'/mismatch-resolution.json';
  const resolve=['--action=resolve','--purpose=campaign','--request='+x.id,'--lookup='+correct.data.receipt.lookupKey,'--updated-at='+view.data.request.updatedAt,'--operator=fixture_operator','--intent='+resolution];
  assert.equal((await command(f,resolve,{},wrapper)).code,1);const saved=await readFile(resolution,'utf8');const final=await command(f,['--action=retry','--intent='+resolution]);
  assert.equal(final.code,0,final.stderr);assert.equal(final.data.replayed,true);assert.equal(await readFile(resolution,'utf8'),saved);assert.equal(f.sent.length,1);assert.equal(f.reads.length,1);
});
