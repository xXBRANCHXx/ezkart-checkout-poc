import {createHmac,randomBytes} from 'node:crypto';
const key=()=>randomBytes(16).toString('hex'),secret='whsec_'+Buffer.alloc(32,7).toString('base64');
export const emailFixtureConfiguration=()=>({APP_ENVIRONMENT:'test',COMMERCE_STORAGE:'d1',COMMERCE_NOTIFICATIONS:'enabled',COMMERCE_EMAIL_PROVIDER:'resend',COMMERCE_EMAIL_SEND:'enabled',
  COMMERCE_EMAIL_FROM:'updates@example.test',COMMERCE_EMAIL_PROFILE:'test_mail',COMMERCE_EMAIL_START_AT:'2026-09-01T00:00:00.000Z',
  COMMERCE_EMAIL_TEST_RECIPIENTS:'["alice@example.test","staff@example.test"]',COMMERCE_EMAIL_WEBHOOKS:JSON.stringify({test_mail:[secret]}),
  RESEND_API_KEY:'re_fixture_email_key_only',SUPABASE_SERVICE_ROLE_KEY:'fixture_server_role_key_only',SUPABASE_URL:'https://auth.fixture.test'});
export function emailFixtureEvent(message,id,type='email.delivered',extra={}){
  return {type,created_at:new Date().toISOString(),data:{email_id:id,from:message.from,to:message.to,subject:message.subject,tags:Object.fromEntries(message.tags.map(t=>[t.name,t.value])),...extra}};
}
export function emailFixtureCallback(body,{id='msg_'+key(),timestamp=Math.floor(Date.now()/1000),signature}={}){
  const raw=typeof body==='string'?body:JSON.stringify(body),mac=createHmac('sha256',Buffer.from(secret.slice(6),'base64')).update(id+'.'+timestamp+'.'+raw).digest('base64');
  return new Request('https://api.fixture.test/webhooks/commerce-email/resend/test_mail',{method:'POST',headers:{'Content-Type':'application/json','svix-id':id,'svix-timestamp':String(timestamp),'svix-signature':signature||'v1,'+mac},body:raw});
}
