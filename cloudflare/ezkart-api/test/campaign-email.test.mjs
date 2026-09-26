import test from 'node:test';
import assert from 'node:assert/strict';
import {campaignEmailPayload} from '../src/campaign-email-template.js';
import {campaignEmailConfiguration,campaignUnsubscribeHeaders,sendResendCampaignEmail,sendResendEmail,emailConfiguration} from '../src/email-provider.js';
import {campaignMailConfiguration,campaignMailId,campaignMailLink,campaignMailKey,campaignMailSource} from './campaign-email-fixture.mjs';
const providerId='abcdef01-2345-4567-8910-123456789abc';
const payload=(source=campaignMailSource(),env=campaignMailConfiguration(),link=campaignMailLink)=>campaignEmailPayload(campaignEmailConfiguration(env),source,'alice@example.test',campaignMailId,link);
const invalid=e=>e.code==='email_request_invalid'&&e.noEffect===true;

test('campaign transport needs a separate activation and every existing email boundary, with no network use while held',async()=>{
  const env=campaignMailConfiguration(),body=payload(),fetcher=()=>assert.fail('A held request reached the provider');
  assert.equal(campaignEmailConfiguration(env).ready,true);
  assert.equal(emailConfiguration({...env,COMMERCE_CAMPAIGN_SEND:'off'}).ready,true);
  for(const change of [{COMMERCE_CAMPAIGN_SEND:undefined},{COMMERCE_CAMPAIGN_SEND:'off'},{COMMERCE_STORAGE:'legacy'},
    {COMMERCE_EMAIL_SEND:'off'},{COMMERCE_EMAIL_PROVIDER:'smtp'},{COMMERCE_EMAIL_WEBHOOKS:'{}'},{COMMERCE_EMAIL_TEST_RECIPIENTS:'[]'},
    {RESEND_API_KEY:''},{APP_ENVIRONMENT:'sandbox'},{SUPABASE_SERVICE_ROLE_KEY:''}]){
    assert.equal(campaignEmailConfiguration({...env,...change}).ready,false);
    await assert.rejects(sendResendCampaignEmail({...env,...change},body,campaignMailKey,fetcher),e=>e.code==='email_not_connected'&&e.noEffect===true);
  }
});

test('rendered campaign mail has escaped copy, owned destinations, the exact one-click headers and a visible opt-out in both formats',()=>{
  const source=campaignMailSource();source.storeName='Tea <img src=x onerror=alert(1)> & Co';source.values.heading='<script>alert(1)</script>';source.values.body='First <b>paragraph</b>\r\n\r\nSecond & last.';
  const body=JSON.parse(payload(source));
  assert.deepEqual(body.headers,{'List-Unsubscribe':'<'+campaignMailLink+'>','List-Unsubscribe-Post':'List-Unsubscribe=One-Click'});
  assert.equal(body.subject,'[Sandbox] Make time for a cup');assert.deepEqual(body.to,['alice@example.test']);
  assert(body.html.includes('&lt;script&gt;alert(1)&lt;/script&gt;'));assert(!/<script|<img|onerror="/.test(body.html));
  assert(body.html.includes('First &lt;b&gt;paragraph&lt;/b&gt;<br><br>Second &amp; last.'));assert(body.text.includes('First <b>paragraph</b>\n\nSecond & last.'));
  assert(body.html.includes('href="https://test.ezkart.id/shop/?store=seller_alice"'));assert(body.text.includes(campaignMailLink));assert(body.html.includes('href="'+campaignMailLink+'"'));
  assert.equal(body.tags.find(t=>t.name==='ezkart_purpose').value,'campaign');assert.equal(payload(source),payload(source));
  const saved=payload(source);source.values.heading='A later edit';assert.notEqual(saved,payload(source));assert(JSON.parse(saved).html.includes('&lt;script&gt;'));
  source.values.buttonLabel='';source.shopEnabled=false;const noButton=JSON.parse(payload(source));assert(!noButton.html.includes('/shop/'));assert(!noButton.text.includes('/shop/'));
});

test('incomplete drafts and cross-environment, external or malformed unsubscribe destinations cannot become campaign messages',()=>{
  const env=campaignMailConfiguration(),config=campaignEmailConfiguration(env),source=campaignMailSource();
  for(const values of [{subject:''},{heading:''},{body:''},{archived:true},{subject:'forged\r\nBcc: outsider@example.test'},{body:'private\u0000data'},{html:'<h1>Injected</h1>'}])assert.throws(()=>payload({...source,values:{...source.values,...values}}),invalid);
  for(const patch of [{shopEnabled:false},{sellerId:'seller_alice&store=other'},{storeName:''},{storeName:'Tea\nBcc: other'},{shopEnabled:1}])assert.throws(()=>payload({...source,...patch}),invalid);
  for(const url of [campaignMailLink.replace('test.ezkart.id','ezkart.id'),campaignMailLink.replace('test.ezkart.id','test.ezkart.id.attacker.test'),campaignMailLink.replace('https:','http:'),campaignMailLink+'&store=other',campaignMailLink+'#fragment',campaignMailLink.replace('?t=','?t=%62'),campaignMailLink+'\r\nX-Header: yes','https://test.ezkart.id@attacker.test/cart/unsubscribe.php?t='+'b'.repeat(64)]){
    assert.throws(()=>campaignUnsubscribeHeaders(config,url),invalid);assert.throws(()=>payload(source,env,url),invalid);
  }
  assert.throws(()=>campaignEmailPayload(config,source,'outside\r\n@example.test',campaignMailId,campaignMailLink),invalid);
  assert.throws(()=>campaignEmailPayload(config,source,'alice@example.test','email_'+'a'.repeat(32),campaignMailLink),invalid);
  const production={...env,APP_ENVIRONMENT:'production'},productionLink=campaignMailLink.replace('test.ezkart.id','ezkart.id'),mail=JSON.parse(payload(source,production,productionLink));
  assert.equal(mail.subject,source.values.subject);assert(mail.html.includes('href="https://ezkart.id/shop/'));assert(!mail.html.includes('test.ezkart.id'));assert.equal(mail.tags[0].value,'production');
});

test('campaign retries submit exactly the stored UTF-8 payload and delivery-bound key without changing transactional transport',async()=>{
  const env=campaignMailConfiguration(),source=campaignMailSource();source.values.body='Teh hangat ☕\nJasmine & care.';const body=payload(source),calls=[];
  const fetcher=async(url,options)=>{calls.push({url,options});return Response.json({id:providerId});};
  for(let n=0;n<2;n++)assert.equal((await sendResendCampaignEmail(env,body,campaignMailKey,fetcher)).id,providerId);
  assert.equal(calls.length,2);assert.equal(calls[0].url,'https://api.resend.com/emails');assert.equal(calls[0].options.method,'POST');assert.equal(calls[0].options.redirect,'manual');
  for(const call of calls){assert.equal(call.options.body,body);assert.equal(call.options.headers['Idempotency-Key'],campaignMailKey);assert.equal(call.options.headers.authorization,'Bearer '+env.RESEND_API_KEY);}
  await assert.rejects(sendResendEmail(env,body,campaignMailKey,fetcher),invalid);
  for(const key of ['ezkart_email/sandbox/42',campaignMailKey+'x',campaignMailKey.replace('sandbox','production'),'bad\nkey'])await assert.rejects(sendResendCampaignEmail(env,body,key,fetcher),invalid);
  assert.equal(calls.length,2);
});

test('campaign transport rejects changed recipients, purpose, headers, missing visible links, duplicate JSON and oversized Unicode before any request',async()=>{
  const env=campaignMailConfiguration(),message=JSON.parse(payload()),fetcher=()=>assert.fail('An invalid request reached the provider');
  const mutations=[{to:['outside@example.test']},{to:['alice@example.test','staff@example.test']},{cc:['staff@example.test']},{from:'Merchant <updates@example.test>'},
    {subject:'one\ntwo'},{headers:null},{headers:{...message.headers,'X-Uncontrolled':'private'}},{headers:{...message.headers,'List-Unsubscribe':'<'+campaignMailLink+'>, <https://attacker.test/>'}},
    {headers:{...message.headers,'List-Unsubscribe-Post':'List-Unsubscribe=Two-Click'}},{html:'<p>No withdrawal link</p>'},{text:'No withdrawal link'},
    {tags:message.tags.filter(t=>t.name!=='ezkart_purpose')},{tags:message.tags.map(t=>t.name==='ezkart_purpose'?{...t,value:'transactional'}:t)},
    {tags:message.tags.map(t=>t.name==='ezkart_environment'?{...t,value:'production'}:t)},{tags:message.tags.map(t=>({...t,extra:'unexpected'}))},
    {tags:message.tags.map(t=>t.name==='ezkart_delivery'?{...t,value:[t.value]}:t)}];
  for(const change of mutations)await assert.rejects(sendResendCampaignEmail(env,JSON.stringify({...message,...change}),campaignMailKey,fetcher),invalid);
  const duplicate=payload().replace('"subject":','"subject":"changed","subject":');await assert.rejects(sendResendCampaignEmail(env,duplicate,campaignMailKey,fetcher),invalid);
  const huge=JSON.stringify({...message,text:'🙂'.repeat(17000)+campaignMailLink});assert(huge.length<65536);assert(Buffer.byteLength(huge)>65536);await assert.rejects(sendResendCampaignEmail(env,huge,campaignMailKey,fetcher),invalid);
});

test('campaign submission preserves uncertain outcomes, never follows redirects, and exposes no raw provider failures',async()=>{
  const env=campaignMailConfiguration(),body=payload();
  for(const [status,data,code] of [[429,{name:'rate_limit_exceeded'},'email_rate_limited'],[409,{name:'concurrent_idempotent_requests'},'email_send_uncertain'],[409,{name:'invalid_idempotent_request'},'email_send_rejected'],[422,{name:'validation_error',message:'Private provider error'},'email_send_rejected'],[503,{name:'unavailable'},'email_send_uncertain'],[302,{id:providerId},'email_send_uncertain'],[200,{id:'unknown'},'email_send_uncertain']]){
    await assert.rejects(sendResendCampaignEmail(env,body,campaignMailKey,async()=>Response.json(data,{status})),e=>e.code===code&&!e.message.includes('Private provider'));
  }
  for(const fetcher of [async()=>{throw Error('socket closed');},async()=>new Response('{"id":"'+providerId+'","id":"another"}'),async()=>new Response('x'.repeat(12001)),async()=>new Response('not JSON')]){
    await assert.rejects(sendResendCampaignEmail(env,body,campaignMailKey,fetcher),e=>e.code==='email_send_uncertain'&&e.uncertain===true&&!e.noEffect);
  }
});

test('maximum saved copy remains sendable within the campaign UTF-8 limit after HTML escaping',async()=>{
  const source=campaignMailSource();source.storeName="'".repeat(160);source.values={...source.values,subject:"'".repeat(160),preheader:"'".repeat(200),heading:"'".repeat(160),body:"'".repeat(6000),buttonLabel:"'".repeat(60)};
  const body=payload(source);assert(Buffer.byteLength(body)<=65536);assert.equal(JSON.parse(body).text.includes(source.values.body),true);
  assert.equal((await sendResendCampaignEmail(campaignMailConfiguration(),body,campaignMailKey,async()=>Response.json({id:providerId}))).id,providerId);
});
