import test from 'node:test';
import assert from 'node:assert/strict';
import {randomBytes,randomUUID} from 'node:crypto';
import {setupCommerceFixture} from './commerce-fixture.mjs';
import {applyCommerceSchema} from './commerce-schema.mjs';
import {emailFixtureConfiguration} from './email-fixture.mjs';
import {dispatchNotifications} from '../src/commerce-notification-dispatch.js';
import {claimCommerceJobs,finishCommerceJob} from '../src/commerce-jobs.js';
import {readNotifications} from '../src/commerce-notifications.js';

const key=()=>randomBytes(16).toString('hex'),buyer='buyer_refunds';
async function fixture(t,options={}){
  const mail=[],config=emailFixtureConfiguration(),outbound=async request=>{
    const url=new URL(request.url);
    if(url.origin==='https://auth.fixture.test'&&url.pathname.startsWith('/auth/v1/admin/users/')){
      const id=url.pathname.split('/').at(-1);return Response.json({id,email:id+'@example.test',email_confirmed_at:'2026-09-01T00:00:00Z'});
    }
    assert.equal(url.href,'https://api.resend.com/emails');mail.push(await request.json());return Response.json({id:randomUUID()});
  };
  const f=await setupCommerceFixture(t,{notifications:'enabled',bindings:{...config,COMMERCE_EMAIL_TEST_RECIPIENTS:JSON.stringify(['alice@example.test',buyer+'@example.test'])},outbound,...options});
  const env={...config,DB:f.db},made=await f.create(f.input({customer:{...f.input().customer,authUserId:buyer}}));assert.equal(made.status,200,made.error);
  const paid=await f.paid(made.order);assert.equal(paid.status,200,paid.error);const order=paid.order,path='/v1/customer/orders/'+order.id+'/refunds';
  const input=()=>({requestKey:key(),orderRevision:order.revision,reason:'other',note:'Private refund note <img src=x onerror=alert(1)>',items:[{orderItemId:order.items[0].id,amount:1000}],shippingAmount:0});
  const request=async(body=input())=>{const r=await f.merchant(path,body,{seller:buyer,method:'POST'});assert.equal(r.status,200,r.error);return r.refund;};
  const decide=async(refund,kind,requestKey=key())=>{const body={requestKey,revision:1,orderRevision:order.revision,kind,message:'Private decision message.'};
    const r=await f.merchant((kind==='withdraw'?path:'/v1/commerce/refunds')+'/'+refund.id,body,{seller:kind==='withdraw'?buyer:'alice',method:'POST'});assert.equal(r.status,200,r.error);return r.refund;};
  const inbox=(actor='alice')=>f.merchant((actor.startsWith('buyer')?'/v1/customer':'/v1/commerce')+'/notifications?category=returns',undefined,{seller:actor});
  const drain=async()=>{let total=0;for(let n=0;n<10;n++){const r=await f.call('/internal/commerce/notifications/drain',{environment:'sandbox',limit:3});assert.equal(r.failed,0,JSON.stringify(r));total+=r.processed;if(r.processed<3)return total;}throw Error('Queue did not drain');};
  const prefs=async(actor,choice)=>{
    const merchant=actor==='alice',url=merchant?'/v1/commerce/settings':'/v1/customer/notifications/preferences';
    const current=await f.merchant(url,undefined,{seller:actor}),settings=merchant?current.notifications:current;
    settings.values.returns=choice;
    assert.equal((await f.merchant(url,{...(merchant?{kind:'notifications'}:{}),values:settings.values,revision:settings.revision,requestKey:key()},{seller:actor,method:'POST'})).status,200);
  };
  return {...f,env,mail,order,path,input,request,decide,inbox,drain,prefs};
}

test('refund request and decision alerts use the original source once, reach only the owner/store and never claim payment',async t=>{
  const f=await fixture(t);await f.drain();const before=(await f.db.prepare('SELECT * FROM commerce_financial_entries ORDER BY journal_sequence,line_number').all()).results;
  for(const kind of ['approve','decline','withdraw']){
    const body=f.input(),r=await f.request(body),actionKey=key();assert.equal((await f.request(body)).id,r.id);
    const saved=await f.decide(r,kind,actionKey);assert.equal((await f.decide(r,kind,actionKey)).state,saved.state);
    assert.equal(await f.drain(),2); // Includes the original request even if the decision was saved before dispatch.
    for(const actor of ['alice',buyer]){
      const notices=(await f.inbox(actor)).items.filter(i=>i.data.refundId===r.id);assert.equal(notices.length,2);
      assert.deepEqual(notices.map(i=>i.data.state).sort(),['requested',saved.state].sort());
      assert(notices.every(i=>i.href===(actor==='alice'?'/cart/admin/?page=refunds&refund='+r.id:'/cart/return.php?order='+f.order.id+'&refund='+r.id)));
      assert(!JSON.stringify(notices).includes('Private refund note'));assert(!JSON.stringify(notices).includes('Private decision message'));
      if(kind==='approve')assert.match(notices.find(i=>i.data.state==='approved').body,/refund has not been paid/);
    }
  }
  assert.equal((await f.inbox('buyer_other')).items.length,0);assert.equal((await f.inbox('bob')).items.length,0);
  assert.equal((await f.db.prepare("SELECT COUNT(*) AS n FROM commerce_jobs WHERE kind='notification.refund_updated'").first()).n,6);
  assert.equal(f.mail.length,0);assert.equal((await f.db.prepare('SELECT checkout_state FROM orders WHERE id=?').bind(f.order.id).first()).checkout_state,'paid');
  assert.deepEqual((await f.db.prepare('SELECT * FROM commerce_financial_entries ORDER BY journal_sequence,line_number').all()).results,before);
  await f.db.prepare("DELETE FROM seller_memberships WHERE auth_user_id='alice'").run();assert.equal((await f.inbox()).status,403);assert.equal((await f.inbox(buyer)).items.length,6);
});

test('existing return choices govern refund inbox/email delivery and email links preserve the exact request',async t=>{
  const f=await fixture(t);await f.drain();await f.prefs('alice',{inApp:false,email:true});await f.prefs(buyer,{inApp:true,email:true});
  const r=await f.request();await f.drain();assert.equal((await f.inbox()).items.length,0);assert.equal((await f.inbox(buyer)).items.length,1);
  const sent=await f.call('/internal/commerce/email/drain',{environment:'sandbox',limit:2});assert.equal(sent.processed,2,JSON.stringify(sent));assert.equal(sent.failed,0);assert.equal(f.mail.length,2);
  for(const message of f.mail){const merchant=message.to[0]==='alice@example.test',url=merchant?'/cart/admin/?page=refunds&refund='+r.id:'/cart/return.php?order='+f.order.id+'&refund='+r.id;
    assert(message.text.includes('View refund request: https://test.ezkart.id'+url));assert(message.html.includes(url.replaceAll('&','&amp;')));assert(!JSON.stringify(message).includes('Private refund note'));
  }
  await f.decide(r,'approve');await f.drain();await f.prefs(buyer,{inApp:false,email:false});await f.prefs('alice',{inApp:false,email:false});
  assert.equal((await f.call('/internal/commerce/email/drain',{environment:'sandbox',limit:2})).processed,2);assert.equal(f.mail.length,2,'current opt-out prevents queued email from starting');
  const next=await f.request();await f.drain();assert.equal((await f.inbox(buyer)).items.length,2,'old inbox choices are preserved');
  const recipients=(await f.db.prepare('SELECT preference_revision,in_app,email_requested FROM commerce_notification_recipients WHERE event_id IN (SELECT id FROM commerce_notification_events WHERE refund_id=?)').bind(next.id).all()).results;
  assert.equal(recipients.length,2);assert(recipients.every(row=>row.preference_revision===2&&row.in_app===0&&row.email_requested===0));
  assert.equal((await f.db.prepare('SELECT COUNT(*) AS n FROM commerce_customer_consents').first()).n,0);
});

test('a lost refund fan-out acknowledgement recovers its durable receipt without repeating recipients or email jobs',async t=>{
  const f=await fixture(t);await f.drain();await f.prefs('alice',{inApp:true,email:true});const r=await f.request();let dropped=false;
  const db=new Proxy(f.db,{get(target,property){if(property==='prepare')return sql=>{const statement=target.prepare(sql);if(!sql.includes('INSERT INTO commerce_notification_events'))return statement;return {bind(...args){return {async run(){const result=await statement.bind(...args).run();if(!dropped){dropped=true;throw Error('Lost committed acknowledgement');}return result;}};}};};const value=Reflect.get(target,property);return typeof value==='function'?value.bind(target):value;}});
  assert.equal((await dispatchNotifications({...f.env,DB:db},1)).failed,1);await f.prefs('alice',{inApp:false,email:false});
  await f.db.prepare("UPDATE commerce_jobs SET available_at='2000-01-01T00:00:00.000Z' WHERE kind='notification.refund_updated'").run();assert.equal(await f.drain(),1);
  assert.equal((await f.db.prepare('SELECT COUNT(*) AS n FROM commerce_notification_events WHERE refund_id=?').bind(r.id).first()).n,1);
  assert.equal((await f.db.prepare('SELECT COUNT(*) AS n FROM commerce_notification_recipients WHERE event_id IN (SELECT id FROM commerce_notification_events WHERE refund_id=?)').bind(r.id).first()).n,2);
  assert.equal((await f.db.prepare("SELECT COUNT(*) AS n FROM commerce_jobs WHERE kind='notification.send'").first()).n,1);assert.equal((await f.inbox()).items.length,1);
});

test('refund notification receipts require the original request or decision, its exact scope and a live lease',async t=>{
  const f=await fixture(t);await f.drain();const r=await f.request();
  const job=(await claimCommerceJobs(f.env,{environment:'sandbox',workerId:'refund_guard',kinds:['notification.refund_updated'],limit:1,leaseSeconds:120}))[0];
  const source=await f.db.prepare('SELECT created_at FROM commerce_jobs WHERE id=?').bind(job.id).first();
  const insert=changes=>{
    const row={id:'notice_'+key(),job_id:job.id,source_lease_token:job.leaseToken,seller_id:job.sellerId,commerce_environment:job.environment,category:'returns',audience:'both',order_id:job.orderId,
      refund_id:r.id,title:'Refund requested',body:'Open the request for its current status.',data_json:JSON.stringify({refundId:r.id,state:'requested'}),occurred_at:source.created_at,created_at:new Date().toISOString(),...changes};
    return f.db.prepare('INSERT INTO commerce_notification_events('+Object.keys(row).join(',')+') VALUES('+Object.keys(row).map(()=>'?').join(',')+')').bind(...Object.values(row)).run();
  };
  for(const changes of [{refund_id:'ref_'+'f'.repeat(32)},{data_json:JSON.stringify({refundId:r.id,state:'approved'})},{data_json:JSON.stringify({refundId:'ref_'+'f'.repeat(32),state:'requested'})},{audience:'merchant'},{source_lease_token:'expired'},{occurred_at:'2000-01-01T00:00:00.000Z'}])await assert.rejects(insert(changes),/notification_source_invalid/);
  await assert.rejects(finishCommerceJob(f.env,job.id,{environment:'sandbox',workerId:'refund_guard',leaseToken:job.leaseToken,outcome:'succeeded'}),e=>e.status===409);
  await finishCommerceJob(f.env,job.id,{environment:'sandbox',workerId:'refund_guard',leaseToken:job.leaseToken,outcome:'uncertain'});
  await f.db.prepare("UPDATE commerce_jobs SET available_at='2000-01-01T00:00:00.000Z' WHERE id=?").bind(job.id).run();assert.equal(await f.drain(),1);
  const payloads=[{orderId:f.order.id,refundId:r.id,state:'approved'},{orderId:f.order.id,refundId:r.id,state:'requested'},
    {orderId:f.order.id,refundId:r.id,state:'declined',actionId:'rfa_'+key()},{orderId:f.order.id,refundId:'ref_'+'f'.repeat(32),state:'requested'}];
  for(const payload of payloads){
    const now=new Date().toISOString();await f.db.prepare(`INSERT INTO commerce_jobs(id,seller_id,order_id,commerce_environment,job_key,kind,payload_json,available_at,created_at,updated_at)
      VALUES(?,'seller_alice',?,'sandbox',?,'notification.refund_updated',?,?,?,?)`).bind('job_'+key(),f.order.id,'forged:'+key(),JSON.stringify(payload),now,now,now).run();
    assert.equal((await dispatchNotifications(f.env,1)).failed,1);
  }
  assert.equal((await f.db.prepare("SELECT COUNT(*) AS n FROM commerce_jobs WHERE kind='notification.refund_updated' AND state='dead'").first()).n,4);
  assert.equal((await f.inbox()).items.length,1);
  await assert.rejects(f.db.prepare("UPDATE commerce_notification_events SET refund_id=NULL WHERE refund_id=?").bind(r.id).run(),/notification_immutable/);
});

test('0046 preserves populated legacy inboxes, reads, preferences and email jobs while backfilling original refund sources',async t=>{
  const f=await fixture(t,{through:45});await f.prefs('alice',{inApp:true,email:true});
  // Seed an old-format payment receipt through its real live job and database guards.
  const settings=(await f.merchant('/v1/commerce/settings')).notifications;settings.values.payment_confirmed.email=true;
  assert.equal((await f.merchant('/v1/commerce/settings',{kind:'notifications',values:settings.values,revision:settings.revision,requestKey:key()},{method:'POST'})).status,200);
  const job=(await claimCommerceJobs(f.env,{environment:'sandbox',workerId:'legacy_receipt',kinds:['notification.order_state'],limit:1,leaseSeconds:120}))[0];
  const source=await f.db.prepare('SELECT created_at FROM commerce_jobs WHERE id=?').bind(job.id).first(),now=new Date().toISOString();
  await f.db.prepare(`INSERT INTO commerce_notification_events(id,job_id,source_lease_token,seller_id,commerce_environment,category,audience,order_id,title,body,data_json,occurred_at,created_at)
    VALUES(?,?,?,'seller_alice','sandbox','payment_confirmed','both',?,'Payment confirmed','Open the order for its current status.','{}',?,?)`).bind('notice_'+key(),job.id,job.leaseToken,f.order.id,source.created_at,now).run();
  await finishCommerceJob(f.env,job.id,{environment:'sandbox',workerId:'legacy_receipt',leaseToken:job.leaseToken,outcome:'succeeded'});
  const recipient=await f.db.prepare("SELECT id FROM commerce_notification_recipients WHERE actor_kind='merchant'").first();
  await readNotifications(f.env,{kind:'merchant',id:'alice',sellerId:'seller_alice'},{ids:[recipient.id]});
  // Seed through the original 0045 guards, without calling today's detail API,
  // which also requires the later private-evidence schema.
  const original=f.input(),refundId='ref_'+key(),capture=await f.db.prepare('SELECT id FROM commerce_payment_captures WHERE order_id=?').bind(f.order.id).first();
  await f.db.prepare(`INSERT INTO commerce_refunds(id,seller_id,order_id,commerce_environment,capture_id,actor_kind,actor_auth_user_id,request_key,request_hash,order_revision,data_json,amount,shipping_amount,created_at,updated_at)
    VALUES(?,'seller_alice',?,'sandbox',?,'buyer',?,?,?,?,?,1000,0,?,?)`)
    .bind(refundId,f.order.id,capture.id,buyer,original.requestKey,'a'.repeat(64),f.order.revision,JSON.stringify({reason:original.reason,note:original.note,items:original.items,shippingAmount:0}),now,now).run();
  await f.db.prepare(`INSERT INTO commerce_refund_actions(id,refund_id,seller_id,actor_kind,actor_auth_user_id,request_key,request_hash,previous_revision,order_revision,kind,message,created_at)
    VALUES(?,?,'seller_alice','merchant','alice',?,?,1,?,'approve','Original decision message.',?)`)
    .bind('raction_'+key(),refundId,key(),'b'.repeat(64),f.order.revision,now).run();
  const tables=(await f.db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '_cf_%' ORDER BY name").all()).results.map(row=>row.name),before=new Map();
  for(const name of tables){const columns=(await f.db.prepare('PRAGMA table_info('+name+')').all()).results.map(c=>'"'+c.name+'"').join(',');before.set(name,{columns,rows:(await f.db.prepare('SELECT '+columns+' FROM '+name).all()).results});}
  assert.equal(before.get('commerce_notification_events').rows.length,1);assert.equal(before.get('commerce_notification_recipients').rows.length,2);assert.equal(before.get('commerce_notification_reads').rows.length,1);
  assert.equal(before.get('commerce_jobs').rows.filter(row=>row.kind==='notification.send').length,1);
  await applyCommerceSchema(f.db,45,46);
  for(const [name,{columns,rows}] of before){const after=(await f.db.prepare('SELECT '+columns+' FROM '+name).all()).results;
    if(name==='commerce_jobs'){assert.equal(after.length,rows.length+2);for(const row of rows)assert(after.some(a=>JSON.stringify(a)===JSON.stringify(row)));}
    else assert.deepEqual(after,rows,name);
  }
  assert.deepEqual((await f.db.prepare('PRAGMA foreign_key_check').all()).results,[]);
  assert.equal(await f.drain(),2);assert.equal((await f.inbox(buyer)).items.length,2);
  const all=await f.merchant('/v1/commerce/notifications');assert.equal(all.items.find(item=>item.category==='payment_confirmed').readAt,before.get('commerce_notification_reads').rows[0].read_at);
  assert.equal((await f.db.prepare("SELECT COUNT(*) AS n FROM sqlite_master WHERE name='commerce_notification_events_0046_backup'").first()).n,0);
});

test('three refund decision alerts leave D1 query headroom for scheduling and authentication',async t=>{
  const f=await fixture(t);await f.drain();const refunds=[];for(let n=0;n<3;n++)refunds.push(await f.request());await f.drain();for(const r of refunds)await f.decide(r,'approve');
  let queries=0;
  const wrap=statement=>new Proxy(statement,{get(target,property){if(property==='bind')return(...args)=>wrap(target.bind(...args));if(['first','all','run','raw'].includes(property))return(...args)=>{queries++;return target[property](...args);};const value=Reflect.get(target,property);return typeof value==='function'?value.bind(target):value;}});
  const DB=new Proxy(f.db,{get(target,property){if(property==='prepare')return sql=>wrap(target.prepare(sql));if(property==='batch')return statements=>{queries+=statements.length;return target.batch(statements);};const value=Reflect.get(target,property);return typeof value==='function'?value.bind(target):value;}});
  const result=await dispatchNotifications({...f.env,DB},3);assert.equal(result.processed,3);assert.equal(result.failed,0);assert(queries<=40,'D1 query headroom: '+queries);
});
