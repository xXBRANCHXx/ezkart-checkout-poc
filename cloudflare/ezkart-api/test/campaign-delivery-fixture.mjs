import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {campaignPublicationFixture,publicationKey} from './campaign-publication-fixture.mjs';
export async function campaignDeliveryFixture(t,options={}){
  const control={calls:[],lookups:[],reads:[],read:null,readHook:null,users:{},outcomes:[],providerIds:new Map(),sendHook:null,identityHook:null,forcedId:null};
  const outbound=async request=>{
    const url=new URL(request.url);
    if(url.origin==='https://auth.fixture.test'&&url.pathname.startsWith('/auth/v1/admin/users/')){
      const id=decodeURIComponent(url.pathname.split('/').at(-1));control.lookups.push(id);if(control.identityHook)await control.identityHook(id);
      const user=Object.hasOwn(control.users,id)?control.users[id]:{id,email:(id.startsWith('campaign-buyer-')?'buyer'+id.slice(15):id)+'@example.test',email_confirmed_at:'2026-09-01T00:00:00Z'};
      return user===null?Response.json({message:'not found'},{status:404}):Response.json(user);
    }
    if(url.origin==='https://api.resend.com'&&request.method==='GET'){
      assert.match(url.pathname,/^\/emails\/[a-f0-9-]{36}$/);assert.equal(request.headers.get('authorization'),'Bearer '+(f.bindings.RESEND_READ_API_KEY||f.bindings.RESEND_API_KEY));
      control.reads.push(url.pathname);if(control.readHook)await control.readHook();
      const saved=control.calls.find(c=>url.pathname==='/emails/'+c.id),data=saved?{object:'email',id:saved.id,...saved.message,created_at:saved.createdAt,last_event:'delivered',cc:[],bcc:[],reply_to:[],scheduled_at:null}:null;
      return control.read?control.read(data,request):data?Response.json(data):Response.json({message:'not found'},{status:404});
    }
    assert.equal(url.href,'https://api.resend.com/emails');assert.equal(request.method,'POST');
    const body=await request.text(),message=JSON.parse(body),key=request.headers.get('Idempotency-Key'),id=control.forcedId||control.providerIds.get(key)||randomUUID();
    control.providerIds.set(key,id);control.calls.push({body,message,key,id,createdAt:new Date().toISOString()});if(control.sendHook)await control.sendHook(message,id);
    const outcome=control.outcomes.shift();
    if(outcome==='lost')throw new Error('Fixture accepted submission; response was lost');
    if(outcome==='rejected')return Response.json({name:'validation_error'},{status:422});
    if(outcome==='rate')return Response.json({name:'rate_limit_exceeded'},{status:429});
    return Response.json({id});
  };
  const f=await campaignPublicationFixture(t,{...options,outbound,bindings:{COMMERCE_EMAIL_TEST_RECIPIENTS:JSON.stringify(['alice@example.test','staff@example.test',...Array.from({length:10},(_,i)=>'buyer'+(i+1)+'@example.test')]),...options.bindings}});
  const fetcher=(url,options)=>outbound(new Request(url,options));
  const drain=limit=>f.call('/internal/commerce/campaigns/drain',{environment:'sandbox',...(limit?{limit}:{})});
  const count=async table=>(await f.db.prepare('SELECT COUNT(*) AS n FROM '+table).first()).n;
  const jobs=async()=>(await f.db.prepare("SELECT * FROM commerce_jobs WHERE kind='campaign.send' ORDER BY id").all()).results;
  const ready=()=>f.db.prepare("UPDATE commerce_jobs SET available_at='2000-01-01T00:00:00.000Z' WHERE kind='campaign.send'").run();
  const postCallback=async request=>f.mf.dispatchFetch(request.url,{method:request.method,headers:Object.fromEntries(request.headers),body:await request.text()});
  const decline=async(grant,revision=1)=>{
    const input={...grant.input,revision,allow:false,requestKey:publicationKey(),statement:`I withdraw permission for promotional emails from alice at ${grant.input.email}. Order and delivery updates are unaffected.`};
    const result=await f.call('/internal/commerce/customer-consents',input);assert.equal(result.status,200,result.error);return result;
  };
  const makeNotification=async()=>{
    const current=await f.merchant('/v1/commerce/settings');current.notifications.values.payment_confirmed.email=true;
    const settings=await f.merchant('/v1/commerce/settings',{kind:'notifications',revision:current.notifications.revision,values:current.notifications.values,requestKey:publicationKey()},{method:'POST'});assert.equal(settings.status,200,settings.error);
    const order=await f.create(f.input());assert.equal(order.status,200,order.error);assert.equal((await f.paid(order.order)).status,200);
    const result=await f.call('/internal/commerce/notifications/drain',{environment:'sandbox'});assert.equal(result.failed,0,JSON.stringify(result));
  };
  return {...f,control,fetcher,drain,count,jobs,ready,postCallback,decline,makeNotification};
}
