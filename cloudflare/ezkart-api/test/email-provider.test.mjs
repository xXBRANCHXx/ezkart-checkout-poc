import test from 'node:test';
import assert from 'node:assert/strict';
import {createHmac} from 'node:crypto';
import {emailAddress,emailConfiguration,emailCredentialHash,verifiedEmailRecipient,sendResendEmail,verifyResendWebhook} from '../src/email-provider.js';
const secret='whsec_'+Buffer.alloc(32,7).toString('base64'),second='whsec_'+Buffer.alloc(32,8).toString('base64');
const config=()=>({APP_ENVIRONMENT:'test',COMMERCE_STORAGE:'d1',COMMERCE_EMAIL_PROVIDER:'resend',COMMERCE_EMAIL_SEND:'enabled',COMMERCE_EMAIL_FROM:'updates@example.test',
  COMMERCE_EMAIL_PROFILE:'test_mail',COMMERCE_EMAIL_START_AT:'2026-09-01T00:00:00.000Z',COMMERCE_EMAIL_TEST_RECIPIENTS:'["alice@example.test"]',
  COMMERCE_EMAIL_WEBHOOKS:JSON.stringify({test_mail:[secret]}),RESEND_API_KEY:'re_fixture_email_key_only',SUPABASE_SERVICE_ROLE_KEY:'fixture_server_role_key_only',SUPABASE_URL:'https://auth.fixture.test'});
const mail=()=>({from:'Ezkart <updates@example.test>',to:['alice@example.test'],subject:'[Sandbox] Payment confirmed',html:'<p>Open your order to read the update.</p>',text:'Open your order to read the update.',
  tags:[{name:'ezkart_environment',value:'sandbox'},{name:'ezkart_profile',value:'test_mail'},{name:'ezkart_delivery',value:'email_'+'a'.repeat(32)}]});
const providerId='abcdef01-2345-4567-8910-123456789abc';
function webhook(body,options={}){
  const timestamp=String(options.timestamp??Math.floor(Date.now()/1000)),id=options.id||'msg_fixture_0001';
  const sig=createHmac('sha256',Buffer.from((options.secret||secret).slice(6),'base64')).update(id+'.'+timestamp+'.'+body).digest('base64');
  return new Request('https://api.fixture.test/webhooks/commerce-email/resend/test_mail',{method:'POST',headers:{'Content-Type':'application/json','svix-id':id,'svix-timestamp':timestamp,'svix-signature':options.signature||'v1,'+sig},body});
}
test('email configuration requires explicit sending setup, current environment, webhook profile and TEST recipients',async()=>{
  const env=config();assert.equal(emailConfiguration(env).ready,true);assert.equal(emailConfiguration({}).ready,false);
  for(const [key,value] of Object.entries({COMMERCE_STORAGE:'legacy',COMMERCE_EMAIL_SEND:'off',COMMERCE_EMAIL_PROVIDER:'smtp',COMMERCE_EMAIL_FROM:'bad@example.test\r\nBcc:else@example.test',COMMERCE_EMAIL_PROFILE:'another_profile',COMMERCE_EMAIL_START_AT:'invalid',RESEND_API_KEY:'missing',SUPABASE_SERVICE_ROLE_KEY:'short',SUPABASE_URL:'http://auth.fixture.test',COMMERCE_EMAIL_TEST_RECIPIENTS:'[]',COMMERCE_EMAIL_WEBHOOKS:'{}'}))assert.equal(emailConfiguration({...env,[key]:value}).ready,false,key);
  for(const url of ['https://auth.fixture.test/path','https://user:pass@auth.fixture.test/','https://auth.fixture.test/?redirect=evil','https://auth.fixture.test:444/'])assert.equal(emailConfiguration({...env,SUPABASE_URL:url}).ready,false,url);
  assert.equal(emailConfiguration({...env,APP_ENVIRONMENT:'production',COMMERCE_EMAIL_TEST_RECIPIENTS:'[]'}).environment,'production');
  assert.equal(emailConfiguration({...env,COMMERCE_EMAIL_PROFILE:'constructor'}).ready,false);
  assert(emailAddress('a+b@example.test'));assert(!emailAddress('Alice@example.test'));assert(!emailAddress('a..b@example.test'));
  const hash=await emailCredentialHash(env);assert.equal(hash,await emailCredentialHash({...env,COMMERCE_EMAIL_WEBHOOKS:JSON.stringify({test_mail:[second,secret]})}));assert.notEqual(hash,await emailCredentialHash({...env,RESEND_API_KEY:'re_changed_account_key'}));assert(!JSON.stringify(emailConfiguration(env)).includes(env.RESEND_API_KEY));
});
test('recipient lookup accepts only the current confirmed Auth identity, never profile metadata or a checkout address',async()=>{
  const env=config(),user={id:'alice',email:'alice@example.test',email_confirmed_at:'2026-09-01T00:00:00Z'},calls=[];
  const fetcher=async(url,options)=>{calls.push({url,options});return Response.json(user);};
  const actual=await verifiedEmailRecipient(env,'alice',fetcher);assert.equal(actual.email,user.email);assert.equal(actual.confirmedAt,'2026-09-01T00:00:00.000Z');assert.equal(calls[0].url,'https://auth.fixture.test/auth/v1/admin/users/alice');assert.equal(calls[0].options.method,'GET');assert.equal(calls[0].options.redirect,'manual');assert.equal(calls[0].options.headers.authorization,'Bearer '+env.SUPABASE_SERVICE_ROLE_KEY);
  for(const extra of [{id:'bob'},{email_confirmed_at:null,user_metadata:{email_verified:true}},{email:'unverified@example.test',email_confirmed_at:null},{banned_until:'2099-01-01T00:00:00Z'},{deleted_at:'2026-09-02T00:00:00Z'},{is_anonymous:true}])await assert.rejects(verifiedEmailRecipient(env,'alice',async()=>Response.json({...user,...extra})),e=>e.code==='email_identity_invalid'&&e.noEffect===true);
  await assert.rejects(verifiedEmailRecipient(env,'alice',async()=>Response.json({message:'secret server error'},{status:500})),e=>e.code==='email_identity_unavailable'&&e.retry&&!e.message.includes('secret'));
  await assert.rejects(verifiedEmailRecipient({...env,COMMERCE_EMAIL_SEND:'off'},'alice',fetcher),e=>e.code==='email_not_connected');assert.equal(calls.length,1);
});
test('Resend sends the exact saved bytes and stable key, enforces the TEST boundary, and distinguishes uncertain from rejected outcomes',async()=>{
  const env=config(),body=JSON.stringify(mail()),calls=[];
  const fetcher=async(url,options)=>{calls.push({url,options});return Response.json({id:providerId});};
  for(let n=0;n<2;n++)assert.equal((await sendResendEmail(env,body,'ezkart_email/sandbox/42',fetcher)).id,providerId);
  assert.equal(calls[0].url,'https://api.resend.com/emails');assert.equal(calls[0].options.body,body);assert.equal(calls[0].options.body,calls[1].options.body);assert.equal(calls[0].options.headers['Idempotency-Key'],calls[1].options.headers['Idempotency-Key']);
  for(const changed of [{to:['outside@example.test']},{cc:['outside@example.test']},{from:'Other <updates@example.test>'},{tags:[{name:'ezkart_environment',value:'production'}]}])await assert.rejects(sendResendEmail(env,JSON.stringify({...mail(),...changed}),'same',fetcher),e=>e.code==='email_request_invalid'&&e.noEffect);
  await assert.rejects(sendResendEmail({...env,COMMERCE_EMAIL_SEND:'off'},body,'same',fetcher),e=>e.code==='email_not_connected');assert.equal(calls.length,2);
  for(const [status,data,expected] of [[429,{name:'rate_limit_exceeded'},'email_rate_limited'],[409,{name:'concurrent_idempotent_requests'},'email_send_uncertain'],[409,{name:'invalid_idempotent_request'},'email_send_rejected'],[422,{name:'validation_error',message:'Private provider detail'},'email_send_rejected'],[500,{name:'application_error'},'email_send_uncertain'],[200,{id:'invalid'},'email_send_uncertain']]){
    await assert.rejects(sendResendEmail(env,body,'same',async()=>Response.json(data,{status})),e=>e.code===expected&&!e.message.includes('Private'));
  }
  await assert.rejects(sendResendEmail(env,body,'same',async()=>{throw Error('connection lost');}),e=>e.uncertain===true);
  await assert.rejects(sendResendEmail(env,body,'same',async()=>new Response('{"id":"'+providerId+'","id":"other"}')),e=>e.uncertain===true);
});
test('webhooks verify raw bytes, timestamp, profile and rotated signatures and reject duplicate JSON or changed bodies',async()=>{
  const env=config(),raw=JSON.stringify({type:'email.delivered',created_at:new Date().toISOString(),data:{email_id:providerId,tags:{ezkart_delivery:'email_'+'a'.repeat(32)}}});
  const accepted=await verifyResendWebhook(webhook(raw),env,'test_mail');assert.equal(accepted.raw,raw);assert.equal(accepted.payload.type,'email.delivered');assert.equal(accepted.id,'msg_fixture_0001');
  const original=webhook(raw),tampered=new Request(original.url,{method:'POST',headers:original.headers,body:raw+' '});await assert.rejects(verifyResendWebhook(tampered,env,'test_mail'),e=>e.status===401);
  for(const timestamp of [Math.floor(Date.now()/1000)-301,Math.floor(Date.now()/1000)+301])await assert.rejects(verifyResendWebhook(webhook(raw,{timestamp}),env,'test_mail'),e=>e.status===401);
  await assert.rejects(verifyResendWebhook(webhook(raw),env,'production_mail'),e=>e.status===503);
  const rotated={...env,COMMERCE_EMAIL_WEBHOOKS:JSON.stringify({test_mail:[second,secret]})};assert.equal((await verifyResendWebhook(webhook(raw,{secret:second}),rotated,'test_mail')).payload.type,'email.delivered');
  const duplicate='{"type":"email.delivered","type":"email.bounced"}';await assert.rejects(verifyResendWebhook(webhook(duplicate),env,'test_mail'),e=>e.status===400);
  await assert.rejects(verifyResendWebhook(webhook('x'.repeat(65537)),env,'test_mail'),e=>e.status===413);
  // The provider's published Svix vector tests interoperability, not merely a
  // signature generated by the same verification implementation.
  const vectorEnv={...env,COMMERCE_EMAIL_WEBHOOKS:JSON.stringify({test_mail:['whsec_plJ3nmyCDGBKInavdOK15jsl']})};
  const vector=webhook('{"event_type":"ping","data":{"success":true}}',{id:'msg_loFOjxBNrRLzqYUf',timestamp:1731705121,signature:'v1,rAvfW3dJ/X/qxhsaXPOyyCGmRKsaKWcsNccKXlIktD0='});
  assert.equal((await verifyResendWebhook(vector,vectorEnv,'test_mail',1731705121000)).payload.event_type,'ping');
});
