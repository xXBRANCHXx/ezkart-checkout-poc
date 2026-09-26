import test from 'node:test';
import assert from 'node:assert/strict';
import {randomBytes,randomUUID} from 'node:crypto';
import {setupCommerceFixture} from './commerce-fixture.mjs';
import {dispatchEmails,deliverEmailJob,recordEmailWebhook} from '../src/commerce-email-delivery.js';
import {claimCommerceJobs,finishCommerceJob} from '../src/commerce-jobs.js';
import {emailConfiguration} from '../src/email-provider.js';
import {notificationEmailPayload} from '../src/email-template.js';
import worker from '../src/index.js';
import {emailFixtureConfiguration as configuration,emailFixtureEvent as callbackBody,emailFixtureCallback as callback} from './email-fixture.mjs';
const key=()=>randomBytes(16).toString('hex');
async function fixture(t,extra={}){
  const control={calls:[],lookups:[],users:{},outcomes:[],providerIds:new Map(),sendHook:null,identityHook:null};
  const outbound=async request=>{
    const url=new URL(request.url);
    if(url.origin==='https://auth.fixture.test'&&url.pathname.startsWith('/auth/v1/admin/users/')){
      const id=decodeURIComponent(url.pathname.split('/').at(-1));control.lookups.push(id);if(control.identityHook)await control.identityHook(id);
      const user=Object.hasOwn(control.users,id)?control.users[id]:{id,email:id+'@example.test',email_confirmed_at:'2026-09-01T00:00:00Z'};
      return user===null?Response.json({message:'not found'},{status:404}):Response.json(user);
    }
    assert.equal(url.href,'https://api.resend.com/emails');assert.equal(request.method,'POST');
    const body=await request.text(),message=JSON.parse(body),idempotencyKey=request.headers.get('Idempotency-Key');
    const id=control.providerIds.get(idempotencyKey)||randomUUID();control.providerIds.set(idempotencyKey,id);
    control.calls.push({body,message,key:idempotencyKey,id});
    if(control.sendHook)await control.sendHook(message,id);
    const outcome=control.outcomes.shift();
    if(outcome==='lost')throw new Error('Fixture provider accepted the email but the connection was lost');
    if(outcome==='rejected')return Response.json({name:'validation_error',message:'private provider detail'},{status:422});
    if(outcome==='rate')return Response.json({name:'rate_limit_exceeded'},{status:429});
    return Response.json({id});
  };
  const config={...configuration(),...extra},f=await setupCommerceFixture(t,{notifications:'enabled',bindings:config,outbound}),env={...config,DB:f.db};
  const setPreference=async(enabled=true,actor='alice',category='payment_confirmed')=>{
    const current=await f.merchant('/v1/commerce/settings',undefined,{seller:actor});assert.equal(current.status,200,current.error);
    current.notifications.values[category].email=enabled;
    const saved=await f.merchant('/v1/commerce/settings',{kind:'notifications',revision:current.notifications.revision,values:current.notifications.values,requestKey:key()},{seller:actor,method:'POST'});assert.equal(saved.status,200,saved.error);
  };
  await setPreference();
  const makeMail=async()=>{const created=await f.create(f.input());assert.equal(created.status,200,created.error);assert.equal((await f.paid(created.order)).status,200);
    const fanout=await f.call('/internal/commerce/notifications/drain',{environment:'sandbox'});assert.equal(fanout.failed,0,JSON.stringify(fanout));return created.order;};
  const ready=()=>f.db.prepare("UPDATE commerce_jobs SET available_at='2000-01-01T00:00:00.000Z' WHERE kind='notification.send'").run();
  const fetcher=(url,options)=>outbound(new Request(url,options));
  const drain=limit=>f.call('/internal/commerce/email/drain',{environment:'sandbox',...(limit?{limit}:{})});
  const postCallback=async request=>f.mf.dispatchFetch(request.url,{method:request.method,headers:Object.fromEntries(request.headers),body:await request.text()});
  const jobs=async()=> (await f.db.prepare("SELECT * FROM commerce_jobs WHERE kind='notification.send' ORDER BY created_at,id").all()).results;
  const count=async table=>(await f.db.prepare('SELECT COUNT(*) AS n FROM '+table).first()).n;
  return {...f,env,control,fetcher,setPreference,makeMail,ready,drain,jobs,count,postCallback};
}

test('real Worker dispatch snapshots verified recipients and exact email bytes; signed callbacks are correlated and immutable',async t=>{
  const f=await fixture(t);await f.makeMail();assert.equal((await f.jobs()).length,1);
  const sent=await f.drain();assert.equal(sent.processed,1,JSON.stringify({sent,jobs:await f.jobs(),lookups:f.control.lookups,requests:await f.count('commerce_email_requests'),starts:await f.count('commerce_email_starts'),calls:f.control.calls.length}));assert.equal(sent.failed,0);assert.equal(f.control.calls.length,1);assert.deepEqual(f.control.lookups,['alice']);
  assert.equal((await f.jobs())[0].state,'succeeded');assert.equal(await f.count('commerce_email_requests'),1);assert.equal(await f.count('commerce_email_starts'),1);assert.equal(await f.count('commerce_email_provider_bindings'),1);
  const x=await f.db.prepare('SELECT * FROM commerce_email_requests').first(),submitted=f.control.calls[0];assert.equal(x.request_json,submitted.body);assert.equal(x.recipient_email,'alice@example.test');assert.equal(x.idempotency_key,submitted.key);assert.equal(Date.parse(x.retry_until)-Date.parse(x.created_at),23*3600000);
  const body=callbackBody(submitted.message,submitted.id),id='msg_saved_'+key();
  for(let n=0;n<2;n++){const response=await f.postCallback(callback(body,{id}));assert.equal(response.status,200);assert.equal((await response.json()).duplicate,Boolean(n));assert.equal(response.headers.get('cache-control'),'no-store');}
  assert.equal(await f.count('commerce_email_events'),2);
  assert.equal((await f.postCallback(callback({...body,type:'email.bounced'},{id}))).status,409);
  assert.equal((await f.postCallback(callback({...body,data:{...body.data,to:['wrong@example.test']}}))).status,409);
  assert.equal((await f.postCallback(callback({...body,data:{...body.data,email_id:randomUUID()}}))).status,409);
  assert.equal((await f.postCallback(callback(body,{signature:'v1,'+Buffer.alloc(32).toString('base64')}))).status,401);
  assert.equal((await f.postCallback(callback(body,{timestamp:Math.floor(Date.now()/1000)-301}))).status,401);
  assert.equal(await f.count('commerce_email_events'),2);
  for(const table of ['commerce_email_requests','commerce_email_starts','commerce_email_events','commerce_email_provider_bindings','commerce_email_skips']){
    if(table!=='commerce_email_skips')await assert.rejects(f.db.prepare('DELETE FROM '+table).run(),/email_immutable/);
  }
  assert.equal((await f.drain()).processed,0);assert.equal(f.control.calls.length,1);
});

test('lost submission responses replay the original bytes and key after a fresh identity lookup, without producing another email',async t=>{
  const f=await fixture(t);await f.makeMail();f.control.outcomes.push('lost');
  assert.equal((await dispatchEmails(f.env,2,f.fetcher)).failed,1);assert.equal((await f.jobs())[0].state,'uncertain');assert.equal(await f.count('commerce_email_events'),0);
  await f.db.prepare("UPDATE sellers SET name='Changed store' WHERE id='seller_alice'").run();await f.ready();
  assert.equal((await dispatchEmails(f.env,2,f.fetcher)).processed,1);assert.equal(f.control.calls.length,2);assert.equal(f.control.providerIds.size,1);assert.equal(f.control.calls[0].body,f.control.calls[1].body);assert.equal(f.control.calls[0].key,f.control.calls[1].key);assert.equal(f.control.lookups.length,2);
  assert.equal(await f.count('commerce_email_requests'),1);assert.equal(await f.count('commerce_email_starts'),2);assert.equal((await f.jobs())[0].attempts,2);
});

test('an early signed delivery callback recovers a lost POST acknowledgement without resending',async t=>{
  const f=await fixture(t);await f.makeMail();f.control.outcomes.push('lost');
  f.control.sendHook=async(message,id)=>{await recordEmailWebhook(callback(callbackBody(message,id)),f.env,'test_mail');};
  const result=await dispatchEmails(f.env,2,f.fetcher);assert.equal(result.processed,1,JSON.stringify(result));assert.equal((await f.jobs())[0].state,'succeeded');
  assert.equal(await f.count('commerce_email_events'),1);assert.equal(await f.count('commerce_email_provider_bindings'),1);assert.equal(f.control.calls.length,1);assert.equal((await dispatchEmails(f.env,2,f.fetcher)).processed,0);
});

test('database acknowledgement loss preserves the submission receipt and an expired worker cannot send',async t=>{
  const f=await fixture(t);await f.makeMail();let dropped=false;
  const db=new Proxy(f.db,{get(target,property){if(property==='prepare')return sql=>{const statement=target.prepare(sql);if(!sql.includes('INSERT INTO commerce_email_events'))return statement;return {bind(...args){return {async run(){const value=await statement.bind(...args).run();if(!dropped){dropped=true;throw Error('Fixture dropped the committed receipt acknowledgement');}return value;}};}};};const value=Reflect.get(target,property);return typeof value==='function'?value.bind(target):value;}});
  assert.equal((await dispatchEmails({...f.env,DB:db},2,f.fetcher)).processed,1);assert.equal(f.control.calls.length,1);assert.equal(await f.count('commerce_email_events'),1);
  await f.makeMail();const job=(await claimCommerceJobs(f.env,{environment:'sandbox',workerId:'expired_mail',kinds:['notification.send'],limit:1,leaseSeconds:120}))[0];
  await assert.rejects(finishCommerceJob(f.env,job.id,{environment:'sandbox',workerId:'expired_mail',leaseToken:job.leaseToken,outcome:'succeeded'}),e=>e.status===409);
  await assert.rejects(f.db.prepare("UPDATE commerce_jobs SET state='succeeded' WHERE id=?").bind(job.id).run(),/email_receipt_required/);
  await f.db.prepare("UPDATE commerce_jobs SET lease_until='2000-01-01T00:00:00.000Z' WHERE id=?").bind(job.id).run();
  await assert.rejects(deliverEmailJob(f.env,job,'expired_mail',f.fetcher));assert.equal(f.control.calls.length,1);
  assert.equal((await dispatchEmails(f.env,2,f.fetcher)).processed,1);assert.equal(f.control.calls.length,2);
});

test('current preferences, memberships and verified accounts stop first sends, including a change during lookup',async t=>{
  for(const condition of ['preference','membership','identity','allowlist','lookup_race'])await t.test(condition,async t=>{
    const f=await fixture(t);await f.makeMail();
    if(condition==='preference')await f.setPreference(false);
    if(condition==='membership')await f.db.prepare("DELETE FROM seller_memberships WHERE auth_user_id='alice'").run();
    if(condition==='identity')f.control.users.alice={id:'alice',email:'alice@example.test',email_confirmed_at:null,user_metadata:{email_verified:true}};
    if(condition==='allowlist')f.control.users.alice={id:'alice',email:'other@example.test',email_confirmed_at:'2026-09-01T00:00:00Z'};
    if(condition==='lookup_race')f.control.identityHook=async()=>{await f.setPreference(false);};
    const result=await dispatchEmails(f.env,2,f.fetcher);assert.equal(result.processed,1,JSON.stringify(result));assert.equal(f.control.calls.length,0);assert.equal(await f.count('commerce_email_starts'),0);
    const skipped=await f.db.prepare('SELECT * FROM commerce_email_skips').first();assert.equal(skipped.uncertain,0);assert.equal(skipped.reason,{preference:'preference_off',membership:'access_removed',identity:'identity_invalid',allowlist:'test_recipient',lookup_race:'preference_off'}[condition]);
    await assert.rejects(f.db.prepare('DELETE FROM commerce_email_skips').run(),/email_immutable/);
  });
});

test('address changes, removed preferences and rotated credentials never redirect or blindly repeat an uncertain submission',async t=>{
  for(const condition of ['address','preference','credentials'])await t.test(condition,async t=>{
    const f=await fixture(t);await f.makeMail();f.control.outcomes.push('lost');await dispatchEmails(f.env,2,f.fetcher);await f.ready();
    if(condition==='address')f.control.users.alice={id:'alice',email:'staff@example.test',email_confirmed_at:'2026-09-01T00:00:00Z'};
    if(condition==='preference')await f.setPreference(false);
    const env=condition==='credentials'?{...f.env,RESEND_API_KEY:'re_another_account_key'}:f.env;
    assert.equal((await dispatchEmails(env,2,f.fetcher)).failed,1);assert.equal(f.control.calls.length,1);assert.equal((await f.jobs())[0].state,'dead');
    const skipped=await f.db.prepare('SELECT * FROM commerce_email_skips').first();assert.equal(skipped.uncertain,1);assert.equal(skipped.reason,{address:'address_changed',preference:'preference_off',credentials:'provider_changed'}[condition]);
  });
});

test('complaints suppress subsequent messages even across stores; late sent/delayed evidence does not remove the complaint',async t=>{
  const f=await fixture(t);await f.makeMail();await dispatchEmails(f.env,2,f.fetcher);const sent=f.control.calls[0];
  for(const type of ['email.delivered','email.complained','email.sent','email.delivery_delayed'])await recordEmailWebhook(callback(callbackBody(sent.message,sent.id,type)),f.env,'test_mail');
  await f.makeMail();assert.equal((await dispatchEmails(f.env,2,f.fetcher)).processed,1);assert.equal(f.control.calls.length,1);assert.equal((await f.db.prepare('SELECT reason FROM commerce_email_skips').first()).reason,'suppressed');
  assert.equal(await f.count('commerce_email_events'),5);
  // The same confirmed account can belong to another store. The address block
  // follows delivery evidence, rather than depending on that store's name.
  await f.setPreference(true,'bob');f.control.users.bob={id:'bob',email:'alice@example.test',email_confirmed_at:'2026-09-01T00:00:00Z'};
  const created=await f.create(f.input({sellerId:'seller_bob',items:[{productId:'private',quantity:1,expectedPrice:20000,expectedWeightGrams:100}]}));assert.equal(created.status,200,created.error);assert.equal((await f.paid(created.order)).status,200);
  assert.equal((await f.call('/internal/commerce/notifications/drain',{environment:'sandbox'})).processed,1);
  assert.equal((await dispatchEmails(f.env,2,f.fetcher)).processed,1);assert.equal(f.control.calls.length,1);assert.equal(await f.count('commerce_email_skips'),2);
  const inbox=await f.merchant('/v1/commerce/notifications');assert.equal(inbox.items.find(i=>i.email?.submittedAt).email.status,'complained');
  assert(!JSON.stringify(inbox).includes('alice@example.test'));
});

test('held services and invalid drain requests have no side effects; email cron stays separate and its D1 work is bounded',async t=>{
  const f=await fixture(t);await f.makeMail();await f.makeMail();
  assert.deepEqual(await dispatchEmails({...f.env,COMMERCE_EMAIL_SEND:'off'},2,f.fetcher),{processed:0,failed:0,held:true});
  assert.deepEqual(await dispatchEmails({...f.env,COMMERCE_STORAGE:'legacy'},2,f.fetcher),{processed:0,failed:0,held:true});
  assert.equal((await f.call('/internal/commerce/email/drain',{environment:'sandbox',limit:3})).status,422);assert.equal(f.control.calls.length,0);assert.equal(await f.count('commerce_email_starts'),0);
  let queries=0;const wrap=statement=>new Proxy(statement,{get(target,property){if(property==='bind')return(...args)=>wrap(target.bind(...args));if(['first','all','run','raw'].includes(property))return(...args)=>{queries++;return target[property](...args);};const value=Reflect.get(target,property);return typeof value==='function'?value.bind(target):value;}});
  const db=new Proxy(f.db,{get(target,property){if(property==='prepare')return sql=>wrap(target.prepare(sql));if(property==='batch')return statements=>{queries+=statements.length;return target.batch(statements);};const value=Reflect.get(target,property);return typeof value==='function'?value.bind(target):value;}});
  const result=await dispatchEmails({...f.env,DB:db},2,f.fetcher);assert.equal(result.processed,2,JSON.stringify(result));assert(queries<=50,'D1 queries: '+queries);
  const tasks=[];await worker.scheduled({cron:'*/2 * * * *'},{...f.env,COMMERCE_EMAIL_SEND:'off'},{waitUntil:promise=>tasks.push(promise)});assert.equal(tasks.length,1);await Promise.all(tasks);assert.equal(f.control.calls.length,2);
});

test('email templates escape merchant content, preserve private destinations and clearly identify sandbox updates',()=>{
  const env=configuration(),row={actor_kind:'merchant',store_name:'<img src=x onerror=alert(1)>',title:'Payment confirmed',body:'Open <script>private</script>\n& verify',category:'payment_confirmed',order_id:'EZK-S-'+'A'.repeat(24),occurred_at:new Date().toISOString()};
  const message=JSON.parse(notificationEmailPayload(emailConfiguration(env),row,'alice@example.test','email_'+'a'.repeat(32)));
  assert(message.subject.startsWith('[Sandbox]'));assert(!message.html.includes('<script>'));assert(!message.html.includes('<img'));assert(message.html.includes('&lt;script&gt;'));assert(message.text.includes('Open <script>'));assert(message.html.includes('https://test.ezkart.id/cart/admin/?page=orders&amp;order='+row.order_id));assert(!message.html.includes('token='));
});

test('an uncertain submission stops before the provider idempotency window expires and keeps its original evidence',async t=>{
  const f=await fixture(t);await f.makeMail();f.control.outcomes.push('lost');await dispatchEmails(f.env,2,f.fetcher);await f.ready();
  const saved=await f.db.prepare('SELECT * FROM commerce_email_requests').first();
  t.mock.timers.enable({apis:['Date'],now:Date.parse(saved.retry_until)+1});
  try{const result=await dispatchEmails(f.env,2,f.fetcher);assert.equal(result.failed,1);assert.equal(f.control.calls.length,1);assert.equal((await f.jobs())[0].state,'dead');
    const skipped=await f.db.prepare('SELECT * FROM commerce_email_skips').first();assert.equal(skipped.reason,'retry_window_expired');assert.equal(skipped.uncertain,1);
  }finally{t.mock.timers.reset();}
  assert.equal(await f.count('commerce_email_starts'),1);assert.equal(await f.count('commerce_email_requests'),1);
});

test('activation cutoff, exhausted retries, rate limits and permanent rejections remain distinguishable and never claim delivery',async t=>{
  const f=await fixture(t);await f.makeMail();
  const future={...f.env,COMMERCE_EMAIL_START_AT:new Date(Date.now()+3600000).toISOString()};assert.equal((await dispatchEmails(future,2,f.fetcher)).processed,1);assert.equal(f.control.calls.length,0);
  assert.equal((await f.db.prepare('SELECT reason FROM commerce_email_skips').first()).reason,'before_activation');
  await f.makeMail();f.control.outcomes.push('rate');assert.equal((await dispatchEmails(f.env,2,f.fetcher)).failed,1);assert.equal(await f.count('commerce_email_provider_bindings'),0);await f.ready();
  assert.equal((await dispatchEmails(f.env,2,f.fetcher)).processed,1);assert.equal(f.control.calls[0].key,f.control.calls[1].key);
  await f.makeMail();f.control.outcomes.push('rejected');assert.equal((await dispatchEmails(f.env,2,f.fetcher)).failed,1);
  await f.makeMail();await f.db.prepare("UPDATE commerce_jobs SET maximum_attempts=1 WHERE kind='notification.send' AND state='queued'").run();f.control.outcomes.push('lost');assert.equal((await dispatchEmails(f.env,2,f.fetcher)).failed,1);
  const rows=await f.jobs();assert.equal(rows.filter(j=>j.state==='dead').length,2);assert.equal(await f.count('commerce_email_provider_bindings'),1);
  const activity=await f.merchant('/v1/commerce/notifications/processing?state=attention');assert.equal(activity.items.length,2);assert(activity.items.every(i=>i.email.status==='needs_review'));assert(!JSON.stringify(activity).includes('private provider detail'));assert(!JSON.stringify(activity).includes('alice@example.test'));
});

test('a conflicting API receipt cannot be hidden by an earlier delivery callback',async t=>{
  const f=await fixture(t);await f.makeMail();
  f.control.sendHook=async message=>{await recordEmailWebhook(callback(callbackBody(message,randomUUID())),f.env,'test_mail');};
  const result=await dispatchEmails(f.env,2,f.fetcher);assert.equal(result.failed,1);assert.equal((await f.jobs())[0].state,'dead');assert.equal(await f.count('commerce_email_events'),1);
  const inbox=await f.merchant('/v1/commerce/notifications');assert.equal(inbox.items[0].email.status,'needs_review');assert(inbox.items[0].email.deliveredAt);
});

test('message reads are rechecked at submission and stale queues appear in operator attention',async t=>{
  const f=await fixture(t);await f.setPreference(true,'alice','messages');
  const conversation=await f.merchant('/v1/customer/messages',{context:{kind:'product',id:'tea'}},{seller:'buyer_one',method:'POST'});assert.equal(conversation.status,200,conversation.error);
  const path='/v1/commerce/messages/'+conversation.conversation.id,send=async()=>{
    const sent=await f.merchant('/v1/customer/messages/'+conversation.conversation.id,{kind:'message',body:'Private message body',photos:[],requestKey:key()},{seller:'buyer_one',method:'POST'});assert.equal(sent.status,200,sent.error);
    assert.equal((await f.call('/internal/commerce/notifications/drain',{environment:'sandbox'})).processed,1);return sent.event.id;
  };
  const id=await send();f.control.identityHook=async()=>{const r=await f.merchant(path+'/read',{eventId:id},{method:'POST'});assert.equal(r.status,200,r.error);};
  assert.equal((await dispatchEmails(f.env,2,f.fetcher)).processed,1);assert.equal(f.control.calls.length,0);assert.equal((await f.db.prepare('SELECT reason FROM commerce_email_skips').first()).reason,'already_read');
  f.control.identityHook=null;await send();await f.ready();
  const attention=await f.merchant('/v1/commerce/notifications/processing?state=attention');assert.equal(attention.items.length,1);assert.equal(attention.items[0].stalled,true);assert.match(attention.items[0].message,/15 minutes/);
  assert.equal((await dispatchEmails(f.env,2,f.fetcher)).processed,1);assert.equal(f.control.calls.length,1);assert(!f.control.calls[0].body.includes('Private message body'));
  const own=await f.merchant('/v1/commerce/notifications/email');assert.equal(own.items.length,2);assert.equal((await f.merchant('/v1/commerce/notifications/email?state=read')).status,422);
  assert.equal((await f.merchant('/v1/commerce/notifications/email',undefined,{seller:'bob'})).items.length,0);assert.equal((await f.merchant('/v1/customer/notifications/email',undefined,{seller:'buyer_one'})).items.length,0);
});

test('database guards reject null recipients and empty or malformed saved requests before any network start',async t=>{
  const f=await fixture(t);
  for(const mutate of [payload=>{payload.to=[null];},payload=>{payload.text='';},payload=>{payload.tags=Object.fromEntries(payload.tags.map(t=>[t.name,t]));}]){
    await f.makeMail();const workerId='mail_guard_'+key(),job=(await claimCommerceJobs(f.env,{environment:'sandbox',workerId,kinds:['notification.send'],limit:1,leaseSeconds:120}))[0],before=f.control.calls.length;
    const db=new Proxy(f.db,{get(target,property){if(property==='prepare')return sql=>{const statement=target.prepare(sql);if(!sql.includes('INSERT INTO commerce_email_requests'))return statement;return {bind(...args){const payload=JSON.parse(args[14]);mutate(payload);args[14]=JSON.stringify(payload);return statement.bind(...args);}};};const value=Reflect.get(target,property);return typeof value==='function'?value.bind(target):value;}});
    await assert.rejects(deliverEmailJob({...f.env,DB:db},job,workerId,f.fetcher),/email_request_invalid/);assert.equal(f.control.calls.length,before);
    assert.equal((await deliverEmailJob(f.env,job,workerId,f.fetcher)).state,'succeeded');assert.equal(f.control.calls.length,before+1);
  }
});
