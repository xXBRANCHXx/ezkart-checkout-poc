import test from 'node:test';
import assert from 'node:assert/strict';
import {randomBytes,randomUUID} from 'node:crypto';
import {setupCommerceFixture} from './commerce-fixture.mjs';
import {emailFixtureConfiguration,emailFixtureEvent,emailFixtureCallback} from './email-fixture.mjs';
import {saveBuyerNotificationPreferences} from '../src/buyer-notification-preferences.js';
import {dispatchEmails} from '../src/commerce-email-delivery.js';
const key=()=>randomBytes(16).toString('hex'),base='/v1/customer/notifications/preferences',buyer='buyer_one';
async function fixture(t,config={}){
  const mail=[],users={},settings={...emailFixtureConfiguration(),COMMERCE_EMAIL_TEST_RECIPIENTS:'["confirmed@example.test"]',...config};let beforeVerify;
  const outbound=async request=>{const url=new URL(request.url);
    if(url.origin==='https://auth.fixture.test'&&url.pathname.startsWith('/auth/v1/admin/users/')){const id=url.pathname.split('/').at(-1);if(beforeVerify)await beforeVerify();return Response.json(users[id]||{id,email:'confirmed@example.test',email_confirmed_at:'2026-09-01T00:00:00Z'});}
    assert.equal(url.href,'https://api.resend.com/emails');const payload=await request.json(),id=randomUUID();mail.push({payload,id});return Response.json({id});
  };
  const f=await setupCommerceFixture(t,{notifications:'enabled',bindings:settings,outbound});
  const get=(who=buyer)=>f.merchant(base,undefined,{seller:who}),save=(values,revision,requestKey=key(),who=buyer)=>f.merchant(base,{values,revision,requestKey},{seller:who,method:'POST'});
  const make=async(seller='seller_alice')=>{const made=await f.create(f.input({sellerId:seller,customer:{name:'Buyer',email:'unverified-checkout@example.test',phone:'081234567890',authUserId:buyer},items:[{productId:seller==='seller_alice'?'tea':'private',quantity:1,expectedPrice:20000,expectedWeightGrams:100}]}));assert.equal(made.status,200,made.error);assert.equal((await f.paid(made.order)).status,200);assert.equal((await f.call('/internal/commerce/notifications/drain',{environment:'sandbox'})).failed,0);return made.order;};
  const drain=async()=>f.call('/internal/commerce/email/drain',{environment:'sandbox'}),count=async table=>(await f.db.prepare('SELECT COUNT(*) AS n FROM '+table).first()).n;
  return {...f,mail,users,get,save,make,drain,count,env:{...settings,DB:f.db},beforeVerify:fn=>{beforeVerify=fn;},fetcher:(url,options)=>outbound(new Request(url,options))};
}
test('buyer choices are opt-in for email, private to the account, revisioned and replayable without granting marketing consent',async t=>{
  const f=await fixture(t),initial=await f.get();assert.equal(initial.status,200);assert.equal(initial.revision,0);assert.equal(Object.keys(initial.values).length,6);assert(Object.values(initial.values).every(v=>v.inApp&&!v.email));
  initial.values.shipping.email=true;const requestKey=key(),saved=await f.save(initial.values,0,requestKey);assert.equal(saved.status,200,saved.error);assert.equal(saved.revision,1);assert.equal(saved.receipt.replayed,false);
  assert.equal((await f.save(initial.values,0,requestKey)).receipt.replayed,true);assert.equal(await f.count('commerce_buyer_notification_changes'),1);assert.equal((await f.get('buyer_other')).revision,0);
  initial.values.shipping.email=false;assert.equal((await f.save(initial.values,0,requestKey)).status,409);assert.equal((await f.save(initial.values,0)).status,409);
  const foreign=await f.merchant(base+'/history',undefined,{seller:'buyer_other'});assert.equal(foreign.items.length,0);assert.equal(await f.count('commerce_customer_consents'),0);
  await assert.rejects(f.db.prepare("UPDATE commerce_buyer_notification_preferences SET revision=999").run(),/buyer_notification_receipt_required/);await assert.rejects(f.db.prepare('DELETE FROM commerce_buyer_notification_changes').run(),/buyer_notification_immutable/);
});
test('strict requests reject duplicate JSON, forged identities, unknown groups, unsafe revisions and direct projection writes',async t=>{
  const f=await fixture(t),values=(await f.get()).values;
  for(const extra of [{accountId:'buyer_other'},{revision:1.5},{revision:Number.MAX_SAFE_INTEGER},{requestKey:'BAD'},{values:{...values,weekly_activity:{inApp:true,email:true}}},{values:{...values,messages:{inApp:1,email:true}}},{values:{...values,messages:null}}]){
    const r=await f.merchant(base,{values,revision:0,requestKey:key(),...extra},{seller:buyer,method:'POST'});assert.equal(r.status,422,JSON.stringify(extra));
  }
  const response=await f.mf.dispatchFetch('https://api.fixture.test'+base,{method:'POST',headers:{Authorization:'Bearer '+await f.merchantToken(buyer),'Content-Type':'application/json'},body:'{"revision":0,"revision":1}'});assert.equal(response.status,400);
  assert.equal((await f.merchant(base+'?account=buyer_other',undefined,{seller:buyer})).status,405);assert.equal((await f.merchant(base+'/history?cursor=x&cursor=y',undefined,{seller:buyer})).status,422);
  await assert.rejects(f.db.prepare('INSERT INTO commerce_buyer_notification_preferences(auth_user_id,revision,preferences_json,updated_at) VALUES(?,?,?,?)').bind(buyer,1,JSON.stringify(values),new Date().toISOString()).run(),/buyer_notification_receipt_required/);
  assert.equal(await f.count('commerce_buyer_notification_preferences'),0);assert.equal(await f.count('commerce_buyer_notification_changes'),0);
});
test('concurrent and interrupted saves have one receipt and history cursors stay bound to the account and stable page',async t=>{
  const f=await fixture(t),actor={kind:'buyer',id:buyer},values=(await f.get()).values,input={values,revision:0,requestKey:key()};values.messages.email=true;
  const results=await Promise.all([saveBuyerNotificationPreferences(f.env,actor,input),saveBuyerNotificationPreferences(f.env,actor,input)]);assert(results.every(r=>r.revision===1));assert.equal(await f.count('commerce_buyer_notification_changes'),1);
  let dropped=false;const db=new Proxy(f.db,{get(target,property){if(property==='prepare')return sql=>{const statement=target.prepare(sql);if(!sql.includes('INSERT INTO commerce_buyer_notification_changes'))return statement;return {bind(...args){return {async run(){const r=await statement.bind(...args).run();if(!dropped){dropped=true;throw Error('Fixture lost the committed response');}return r;}};}};};const value=Reflect.get(target,property);return typeof value==='function'?value.bind(target):value;}});
  const recovered=await saveBuyerNotificationPreferences({...f.env,DB:db},actor,{...input,revision:1,requestKey:key()});assert.equal(recovered.revision,2);assert.equal(recovered.receipt.replayed,true);
  for(let revision=2;revision<23;revision++)assert.equal((await f.save(values,revision)).status,200);
  const first=await f.merchant(base+'/history',undefined,{seller:buyer});assert.equal(first.items.length,20);assert(first.nextCursor);assert.equal(first.items[0].revision,23);
  await f.save(values,23);const next=await f.merchant(base+'/history?cursor='+first.nextCursor,undefined,{seller:buyer});assert.deepEqual(next.items.map(i=>i.revision),[3,2,1]);
  assert.equal((await f.merchant(base+'/history?cursor='+first.nextCursor,undefined,{seller:'buyer_other'})).status,422);
});
test('buyer fan-out snapshots choices across stores and email uses current confirmed identity, never the checkout contact',async t=>{
  const f=await fixture(t);await f.make();assert.equal(await f.count('commerce_email_requests'),0);
  const preferences=(await f.get()).values;preferences.payment_confirmed={inApp:false,email:true};assert.equal((await f.save(preferences,0)).status,200);const order=await f.make('seller_bob');
  const row=await f.db.prepare("SELECT r.preference_revision,r.in_app,r.email_requested FROM commerce_notification_recipients r JOIN commerce_notification_events e ON e.id=r.event_id WHERE r.actor_kind='buyer' AND e.order_id=?").bind(order.id).first();assert.deepEqual(row,{preference_revision:1,in_app:0,email_requested:1});
  const inbox=await f.merchant('/v1/customer/notifications',undefined,{seller:buyer});assert.equal(inbox.items.length,1,'the earlier in-app update remains');
  const sent=await f.drain();assert.equal(sent.processed,1,JSON.stringify(sent));assert.equal(f.mail.length,1);assert.deepEqual(f.mail[0].payload.to,['confirmed@example.test']);assert(!JSON.stringify(f.mail).includes('unverified-checkout@example.test'));
  assert(f.mail[0].payload.html.includes('/cart/return.php?order='+order.id));assert(f.mail[0].payload.html.includes('/cart/notifications.php?view=preferences'));
  const request=emailFixtureCallback(emailFixtureEvent(f.mail[0].payload,f.mail[0].id));const received=await f.mf.dispatchFetch(request.url,{method:'POST',headers:Object.fromEntries(request.headers),body:await request.text()});assert.equal(received.status,200);
  const emails=await f.merchant('/v1/customer/notifications/email',undefined,{seller:buyer});assert.equal(emails.items.length,1);assert.equal(emails.items[0].email.status,'delivered');assert(!JSON.stringify(emails).includes('confirmed@example.test'));
  assert.equal((await f.merchant('/v1/customer/notifications/email',undefined,{seller:'buyer_other'})).items.length,0);
});
test('turning buyer email off during verification prevents the network start; later choices do not rewrite old recipient records',async t=>{
  const f=await fixture(t),prefs=(await f.get()).values;prefs.payment_confirmed.email=true;await f.save(prefs,0);await f.make();
  f.beforeVerify(async()=>{prefs.payment_confirmed.email=false;assert.equal((await f.save(prefs,1)).status,200);});
  const result=await dispatchEmails(f.env,2,f.fetcher);assert.equal(result.processed,1,JSON.stringify(result));assert.equal(f.mail.length,0);assert.equal(await f.count('commerce_email_starts'),0);
  assert.equal((await f.db.prepare('SELECT reason FROM commerce_email_skips').first()).reason,'preference_off');assert.equal((await f.db.prepare("SELECT preference_revision FROM commerce_notification_recipients WHERE actor_kind='buyer'").first()).preference_revision,1);
});
test('preference management stays available while commerce is held without enabling sources or email',async t=>{
  const f=await fixture(t,{COMMERCE_STORAGE:'legacy'}),prefs=(await f.get()).values;prefs.returns.email=true;assert.equal((await f.save(prefs,0)).status,200);
  const saved=await f.get();assert.equal(saved.delivery.inAppEnabled,false);assert.equal(saved.delivery.emailEnabled,false);assert.equal((await f.drain()).status,503);assert.equal(f.mail.length,0);
});
