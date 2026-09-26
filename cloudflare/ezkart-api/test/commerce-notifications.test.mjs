import test from 'node:test';
import assert from 'node:assert/strict';
import {randomBytes} from 'node:crypto';
import {setupCommerceFixture,fixtureShipping} from './commerce-fixture.mjs';
import {claimCommerceJobs,finishCommerceJob} from '../src/commerce-jobs.js';
import {readNotifications} from '../src/commerce-notifications.js';
import worker from '../src/index.js';
import {dispatchNotifications,deliverNotificationJob,scheduleNotifications,notificationWeek} from '../src/commerce-notification-dispatch.js';
const key=()=>randomBytes(16).toString('hex'),base='/v1/commerce/notifications';
async function fixture(t,notifications='scheduled'){
  const f=await setupCommerceFixture(t,{notifications}),env={DB:f.db,APP_ENVIRONMENT:'test',COMMERCE_STORAGE:'d1',COMMERCE_NOTIFICATIONS:notifications};
  const inbox=(actor='alice',query='')=>f.merchant((actor.startsWith('buyer')?'/v1/customer/notifications':base)+query,undefined,{seller:actor});
  const paid=async()=>{const r=await f.create(f.input({customer:{name:'Buyer',email:'buyer@example.test',phone:'081234567890',authUserId:'buyer_one'}}));assert.equal(r.status,200,r.error);assert.equal((await f.paid(r.order)).status,200);return r.order;};
  const drain=(limit=3)=>f.call('/internal/commerce/notifications/drain',{environment:'sandbox',limit});
  const count=async table=>(await f.db.prepare('SELECT COUNT(*) AS n FROM '+table).first()).n;
  return {...f,env,inbox,makePaid:paid,drain,count};
}
test('real payment and message jobs deliver separate private buyer/store notifications and honor personal choices',async t=>{
  const f=await fixture(t);await f.db.prepare("INSERT INTO app_users(id,auth_user_id,created_at,updated_at) VALUES('staff','staff','now','now')").run();await f.db.prepare("INSERT INTO seller_memberships(seller_id,auth_user_id,role,created_at) VALUES('seller_alice','staff','viewer','now')").run();
  const settings=await f.merchant('/v1/commerce/settings',undefined,{seller:'staff'}),prefs=settings.notifications.values;prefs.payment_confirmed.inApp=false;prefs.payment_confirmed.email=true;
  assert.equal((await f.merchant('/v1/commerce/settings',{kind:'notifications',revision:0,requestKey:key(),values:prefs},{seller:'staff',method:'POST'})).status,200);
  const order=await f.makePaid(),drained=await f.drain();assert.equal(drained.processed,1,JSON.stringify(drained));assert.equal(drained.failed,0);
  assert.equal((await f.inbox()).items[0].category,'payment_confirmed');assert.equal((await f.inbox('buyer_one')).items[0].href,'/cart/return.php?order='+order.id);assert.equal((await f.inbox('staff')).items.length,0);assert.equal((await f.inbox('bob')).items.length,0);
  const stats=await f.merchant(base+'/stats',undefined,{seller:'staff'});assert.equal(stats.email_waiting,1);assert.equal(stats.unread,0);
  const hidden=await f.db.prepare("SELECT preference_revision,in_app,email_requested FROM commerce_notification_recipients WHERE actor_id='staff'").first();assert.deepEqual(hidden,{preference_revision:1,in_app:0,email_requested:1});
  const conv=await f.merchant('/v1/customer/messages',{context:{kind:'order',id:order.id}},{seller:'buyer_one',method:'POST'});assert.equal(conv.status,200,conv.error);
  assert.equal((await f.merchant('/v1/customer/messages/'+conv.conversation.id,{kind:'message',body:'A private question',photos:[],requestKey:key()},{seller:'buyer_one',method:'POST'})).status,200);assert.equal((await f.drain()).processed,1);
  assert.equal((await f.inbox()).items[0].category,'messages');assert.equal((await f.inbox('buyer_one')).items.length,1,'buyer does not receive an alert for their own message');assert(!(JSON.stringify(await f.inbox())).includes('A private question'));
  assert.equal((await f.merchant('/v1/commerce/messages/'+conv.conversation.id,{kind:'message',body:'A private reply',photos:[],requestKey:key()},{method:'POST'})).status,200);assert.equal((await f.drain()).processed,1);assert.equal((await f.inbox('buyer_one')).items[0].category,'messages');
  const own=(await f.inbox()).items[0].id,foreign=(await f.inbox('buyer_one')).items[0].id;
  assert.equal((await f.merchant(base+'/read',{ids:[own,foreign]},{method:'POST'})).status,404);assert.equal(await f.count('commerce_notification_reads'),0);
  for(let i=0;i<2;i++)assert.equal((await f.merchant(base+'/read',{ids:[own]},{method:'POST'})).status,200);assert.equal(await f.count('commerce_notification_reads'),1);assert.equal((await f.inbox('alice','?state=unread')).items.length,1);
  await f.db.prepare("DELETE FROM seller_memberships WHERE auth_user_id='alice'").run();assert.equal((await f.inbox()).status,403);assert.equal((await f.inbox('buyer_one')).status,200);
});

test('a lost fan-out acknowledgement is reconciled without changing delivered preferences or duplicating recipients',async t=>{
  const f=await fixture(t);await f.makePaid();let dropped=false;
  const db=new Proxy(f.db,{get(target,property){if(property==='prepare')return sql=>{const statement=target.prepare(sql);if(!sql.includes('INSERT INTO commerce_notification_events'))return statement;return {bind(...args){return {async run(){const result=await statement.bind(...args).run();if(!dropped){dropped=true;throw Error('Lost database acknowledgement');}return result;}};}};};const value=Reflect.get(target,property);return typeof value==='function'?value.bind(target):value;}});
  const failed=await dispatchNotifications({...f.env,DB:db},1);assert.equal(failed.failed,1);assert.equal(await f.count('commerce_notification_events'),1);assert.equal(await f.count('commerce_notification_recipients'),2);assert.equal((await f.db.prepare("SELECT state FROM commerce_jobs WHERE kind='notification.order_state'").first()).state,'uncertain');
  const settings=await f.merchant('/v1/commerce/settings'),prefs=settings.notifications.values;prefs.payment_confirmed.inApp=false;await f.merchant('/v1/commerce/settings',{kind:'notifications',revision:0,requestKey:key(),values:prefs},{method:'POST'});
  await f.db.prepare("UPDATE commerce_jobs SET available_at='2000-01-01T00:00:00.000Z' WHERE kind='notification.order_state'").run();const recovered=await f.drain();assert.equal(recovered.processed,1,JSON.stringify(recovered));assert.equal(await f.count('commerce_notification_recipients'),2);assert.equal((await f.inbox()).items.length,1);
  const history=await f.merchant(base+'/processing?state=all');assert.equal(history.items[0].state,'succeeded');assert.equal(history.items[0].attempts,2);assert.equal(history.items[0].deliveredInApp,2);
  await assert.rejects(f.db.prepare("UPDATE commerce_notification_recipients SET in_app=0").run(),/notification_immutable/);await assert.rejects(f.db.prepare("DELETE FROM commerce_notification_events").run(),/notification_immutable/);
});

test('scheduled reminders suppress resolved orders and weekly summaries use actual confirmed payments',async t=>{
  const f=await fixture(t),created=await f.create(f.input({expiresAt:new Date(Date.now()+7200000).toISOString()}));assert.equal(created.status,200,created.error);
  const scheduled=await scheduleNotifications(f.env,{now:new Date(Date.now()+31*60000)});assert.equal(scheduled.pending,1);assert.equal((await scheduleNotifications(f.env,{now:new Date(Date.now()+32*60000)})).pending,0);
  assert.equal((await f.paid(created.order)).status,200);await f.db.prepare("UPDATE commerce_jobs SET available_at='2000-01-01T00:00:00.000Z' WHERE kind='notification.payment_pending'").run();const result=await f.drain();assert.equal(result.failed,0,JSON.stringify(result));assert.equal((await f.inbox()).items.length,1);assert.equal((await f.db.prepare("SELECT suppression FROM commerce_notification_events WHERE category='payment_pending'").first()).suppression,'obsolete');
  assert.deepEqual(notificationWeek(new Date('2026-09-28T01:59:59Z')),{from:'2026-09-14',to:'2026-09-21'});assert.deepEqual(notificationWeek(new Date('2026-09-28T02:00:00Z')),{from:'2026-09-21',to:'2026-09-28'});
  await f.db.prepare("UPDATE sellers SET created_at='2020-01-01T00:00:00.000Z'").run();const settings=await f.merchant('/v1/commerce/settings'),prefs=settings.notifications.values;prefs.weekly_activity.inApp=true;await f.merchant('/v1/commerce/settings',{kind:'notifications',revision:0,requestKey:key(),values:prefs},{method:'POST'});
  const local=new Date(Date.now()+7*3600000),nextMonday=new Date(Date.UTC(local.getUTCFullYear(),local.getUTCMonth(),local.getUTCDate()+((8-local.getUTCDay())%7||7),2));
  const week=await scheduleNotifications(f.env,{now:nextMonday});assert.equal(week.weekly,2);await f.db.prepare("UPDATE commerce_jobs SET available_at='2000-01-01T00:00:00.000Z' WHERE kind='notification.weekly_activity'").run();assert.equal((await f.drain()).failed,0);
  const weekly=(await f.inbox('alice','?category=weekly_activity')).items[0];assert.equal(weekly.data.total,2);assert.equal(weekly.data.withoutOrders,1);assert.deepEqual(weekly.data.products,[{id:'mug',name:'mug'}]);assert.equal((await f.inbox('bob')).items.length,0);
});

test('notification completion needs a durable receipt; expired leases cannot deliver and exhausted retries are visible',async t=>{
  const f=await fixture(t);await f.makePaid();
  const claim=(workerId,mode='execute')=>claimCommerceJobs(f.env,{environment:'sandbox',workerId,mode,kinds:['notification.order_state'],limit:1,leaseSeconds:15});
  const first=(await claim('notice_first'))[0];
  await assert.rejects(finishCommerceJob(f.env,first.id,{environment:'sandbox',workerId:'notice_first',leaseToken:first.leaseToken,outcome:'succeeded',result:{}}),e=>e.status===409);
  await assert.rejects(f.db.prepare("UPDATE commerce_jobs SET state='succeeded' WHERE id=?").bind(first.id).run(),/notification_receipt_required/);
  await f.db.prepare("UPDATE commerce_jobs SET lease_until='2000-01-01T00:00:00.000Z' WHERE id=?").bind(first.id).run();
  const next=(await claim('notice_next','reconcile'))[0];assert.equal(next.attempts,2);
  await assert.rejects(deliverNotificationJob(f.env,first,'notice_first'),/notification_source_invalid/);assert.equal(await f.count('commerce_notification_events'),0);
  await deliverNotificationJob(f.env,next,'notice_next');assert.equal(await f.count('commerce_notification_events'),1);assert.equal(await f.count('commerce_notification_recipients'),2);
  await f.makePaid();const last=(await claim('notice_last'))[0];await f.db.prepare('UPDATE commerce_jobs SET maximum_attempts=1 WHERE id=?').bind(last.id).run();
  const dead=await finishCommerceJob(f.env,last.id,{environment:'sandbox',workerId:'notice_last',leaseToken:last.leaseToken,outcome:'uncertain',error:'Storage acknowledgement missing'});assert.equal(dead.state,'dead');
  await f.makePaid();const crashed=(await claim('notice_crash'))[0];await f.db.prepare("UPDATE commerce_jobs SET maximum_attempts=1,lease_until='2000-01-01T00:00:00.000Z' WHERE id=?").bind(crashed.id).run();assert.deepEqual(await claim('notice_after','reconcile'),[]);
  const attention=await f.merchant(base+'/processing?state=attention');assert.equal(attention.items.length,2);assert(attention.items.every(item=>item.state==='dead'&&item.message.includes('operator review')));assert(!JSON.stringify(attention).includes('Storage acknowledgement missing'));
});

test('concurrent drains and read confirmations are idempotent; access removed during a read prevents all writes',async t=>{
  const f=await fixture(t);await f.makePaid();const results=await Promise.all([dispatchNotifications(f.env),dispatchNotifications(f.env)]);assert.equal(results.reduce((n,r)=>n+r.processed,0),1);assert.equal(await f.count('commerce_notification_events'),1);
  const id=(await f.inbox()).items[0].id,actor={kind:'merchant',id:'alice',sellerId:'seller_alice'};
  const reads=await Promise.all([readNotifications(f.env,actor,{ids:[id]}),readNotifications(f.env,actor,{ids:[id]})]);assert(reads.every(r=>r.read[0]===id));assert.equal(await f.count('commerce_notification_reads'),1);
  await f.makePaid();await f.drain();const fresh=(await f.inbox()).items[0].id;let revoked=false;
  const db=new Proxy(f.db,{get(target,property){if(property==='prepare')return sql=>{const statement=target.prepare(sql);if(!sql.includes('INSERT INTO commerce_notification_reads'))return statement;return {bind(...args){return {async run(){if(!revoked){revoked=true;await f.db.prepare("DELETE FROM seller_memberships WHERE auth_user_id='alice'").run();}return statement.bind(...args).run();}};}};};const value=Reflect.get(target,property);return typeof value==='function'?value.bind(target):value;}});
  await assert.rejects(readNotifications({...f.env,DB:db},actor,{ids:[fresh]}),e=>e.status===403);assert.equal(await f.count('commerce_notification_reads'),1);
  assert.equal((await f.inbox('buyer_other')).items.length,0);
});

test('shipping and return sources deliver exact contextual updates without claiming pickup or refund success',async t=>{
  const f=await fixture(t),created=await f.create(f.input({shipping:fixtureShipping,customer:{name:'Buyer',email:'buyer@example.test',phone:'081234567890',authUserId:'buyer_one'}}));assert.equal(created.status,200,created.error);const order=created.order;await f.paid(order);await f.drain();
  let shipmentId;for(const kind of ['accept','pickup']){const detail=await f.merchant('/v1/fulfillment/'+order.id),r=await f.merchant('/v1/fulfillment/'+order.id,{kind,revision:detail.order.revision,requestKey:key()},{method:'POST'});assert.equal(r.status,200,r.error);if(kind==='pickup')shipmentId=r.receipt.shipmentId;}
  await f.drain();let inbox=await f.inbox('buyer_one','?category=shipping');assert.equal(inbox.items.length,2);assert(inbox.items.find(i=>i.title==='Pickup requested').body.includes('does not confirm'));
  await f.call('/internal/commerce/shipments/'+shipmentId+'/account',{environment:'sandbox',accountHash:'a'.repeat(64)});
  const shipment=(await f.call('/internal/commerce/shipments/'+shipmentId+'?environment=sandbox')).shipment;
  const bound=await f.call('/internal/commerce/shipments/'+shipmentId+'/bind',{environment:'sandbox',verified:true,providerId:'courier_notice_'+shipmentId,reference:shipment.reference,data:{kind:'status',status:'delivered',updatedAt:new Date().toISOString()}});assert.equal(bound.status,200,bound.error);await f.drain();
  const path='/v1/returns/orders/'+order.id,detail=await f.merchant(path),opened=await f.merchant(path,{requestKey:key(),orderRevision:detail.order.revision,reason:'damaged',note:'Private damaged-goods report',items:detail.items.map(i=>({orderItemId:i.orderItemId,quantity:1}))},{method:'POST'});assert.equal(opened.status,200,opened.error);await f.drain();
  const ret=(await f.inbox('alice','?category=returns')).items[0];assert.equal(ret.href,'/cart/admin/?page=returns&return='+opened.id);assert.equal(ret.title,'Return requested');assert(!ret.body.includes('Private damaged-goods report'));assert(!ret.body.includes('refund'));
  assert.equal((await f.inbox('buyer_one','?category=returns')).items[0].href,'/cart/return.php?order='+order.id);
});

test('held dispatch, invalid schedules, malformed requests and closed stores do not create misleading alerts',async t=>{
  const f=await fixture(t);await f.makePaid();const before=await f.count('commerce_jobs');
  assert.equal((await f.call('/internal/commerce/notifications/drain',{environment:'sandbox',schedule:true,limit:4})).status,422);assert.equal(await f.count('commerce_jobs'),before);
  assert.deepEqual(await dispatchNotifications({...f.env,COMMERCE_NOTIFICATIONS:'off'}),{processed:0,failed:0,held:true});assert.equal(await f.count('commerce_notification_events'),0);
  assert.equal((await f.merchant(base+'/read',{ids:[1,1]},{method:'POST'})).status,422);assert.equal((await f.inbox('alice','?state=read&state=all')).status,422);
  const token=await f.merchantToken();for(const [body,status] of [['{"ids":[1],"ids":[2]}',400],['{"ids":[]}',422]]){const response=await f.mf.dispatchFetch('https://api.fixture.test'+base+'/read',{method:'POST',headers:{Authorization:'Bearer '+token,'Content-Type':'application/json'},body});assert.equal(response.status,status);}
  await f.drain();await f.makePaid();await f.db.prepare("UPDATE sellers SET status='suspended' WHERE id='seller_alice'").run();await f.drain();
  assert.equal((await f.inbox()).status,403);const buyer=await f.inbox('buyer_one');assert.equal(buyer.items.length,1);assert.equal((await f.merchant('/v1/customer/notifications/read',{ids:[buyer.items[0].id]},{seller:'buyer_one',method:'POST'})).status,200);
  assert.equal((await f.db.prepare("SELECT COUNT(*) AS n FROM commerce_notification_events WHERE suppression='store_closed'").first()).n,1);
});

test('late payments produce a merchant review alert and resolved stock produces its own durable follow-up',async t=>{
  const f=await fixture(t),created=await f.create(f.input({customer:{name:'Buyer',email:'buyer@example.test',phone:'081234567890',authUserId:'buyer_one'}}));assert.equal(created.status,200,created.error);
  assert.equal((await f.event(created.order,'payment.expired',{verified:true})).status,200);assert.equal((await f.paid(created.order)).status,200);for(let n=0;n<2;n++)await f.drain();
  const reviews=await f.inbox('alice','?category=payment_review');assert.equal(reviews.items.length,1);assert.equal(reviews.items[0].title,'Payment or stock review needed');assert.equal((await f.inbox('buyer_one','?category=payment_review')).items.length,0);
  const path='/v1/inventory/reviews/'+created.order.id,detail=await f.merchant(path),resolved=await f.merchant(path,{requestKey:key(),revision:detail.order.revision,confirmed:true,note:'Physical stock checked',items:detail.items.map(item=>({orderItemId:item.orderItemId,productRevision:item.current.revision}))},{method:'POST'});assert.equal(resolved.status,200,resolved.error);await f.drain();assert.equal((await f.inbox('alice','?category=payment_review')).items[0].title,'Stock review resolved');
});

test('bounded notification dispatch stays below the free D1 invocation query budget',async t=>{
  const f=await fixture(t);for(let n=0;n<3;n++)await f.makePaid();let queries=0;
  const wrap=statement=>new Proxy(statement,{get(target,property){if(property==='bind')return(...args)=>wrap(target.bind(...args));if(['first','all','run','raw'].includes(property))return(...args)=>{queries++;return target[property](...args);};const value=Reflect.get(target,property);return typeof value==='function'?value.bind(target):value;}});
  const db=new Proxy(f.db,{get(target,property){if(property==='prepare')return sql=>wrap(target.prepare(sql));if(property==='batch')return statements=>{queries+=statements.length;return target.batch(statements);};const value=Reflect.get(target,property);return typeof value==='function'?value.bind(target):value;}});
  const result=await dispatchNotifications({...f.env,DB:db});assert.equal(result.processed,3,JSON.stringify(result));assert.equal(result.failed,0);assert(queries<=40,'D1 query budget needs headroom for scheduling and service authentication: '+queries);assert.equal((await f.inbox()).items.length,3);
});

test('the minute cron dispatches through the real handler and the central-storage hold prevents scheduling and delivery',async t=>{
  const f=await fixture(t);await f.makePaid();
  const run=async env=>{const pending=[];await worker.scheduled({cron:'* * * * *'},env,{waitUntil:value=>pending.push(value)});await Promise.all(pending);};
  await run({...f.env,COMMERCE_STORAGE:'legacy'});assert.equal(await f.count('commerce_notification_events'),0);
  await run(f.env);assert.equal(await f.count('commerce_notification_events'),1);assert.equal((await f.inbox()).items.length,1);
  await run(f.env);assert.equal(await f.count('commerce_notification_events'),1);
});
