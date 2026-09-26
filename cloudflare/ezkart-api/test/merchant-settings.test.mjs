import test from 'node:test';
import assert from 'node:assert/strict';
import {randomBytes} from 'node:crypto';
import {setupCommerceFixture,shippingConfiguration} from './commerce-fixture.mjs';
import {saveMerchantSettings} from '../src/merchant-settings.js';
const key=()=>randomBytes(16).toString('hex'),base='/v1/commerce/settings';
const read=(f,actor)=>f.merchant(base,undefined,actor?{seller:actor}:{});
const profile={name:'Jasmine & Co',businessType:'retailer',supportEmail:'SUPPORT@example.test',supportPhone:'0812 3456 7890',description:'Tea for everyday moments.\nMade with care.',timezone:'Asia/Makassar',dateFormat:'iso'};
const save=(f,values=profile,revision=0,requestKey=key(),kind='profile',actor='alice')=>f.merchant(base,{kind,values,revision,requestKey},{method:'POST',seller:actor});
const count=async(f,table)=>(await f.db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).first()).n;
async function member(f,id,role='viewer'){await f.db.prepare("INSERT INTO app_users(id,auth_user_id,created_at,updated_at) VALUES(?,?,'now','now')").bind(id,id).run();await f.db.prepare("INSERT INTO seller_memberships(seller_id,auth_user_id,role,created_at) VALUES('seller_alice',?,?,'later')").bind(id,role).run();}

test('store details save once, replay after later edits and preserve logo, shipping and shop settings',async t=>{
  const f=await setupCommerceFixture(t),original=await read(f);assert.equal(original.profile.values.name,'alice');assert.equal(original.profile.values.supportEmail,'');assert.equal(original.profile.revision,0);
  await f.db.prepare("UPDATE sellers SET settings_json=json_set(settings_json,'$.adminProfile.logoId','image_alice','$.privateTestSecret','do not expose') WHERE id='seller_alice'").run();
  const requestKey=key(),responses=await Promise.all([save(f,profile,0,requestKey),save(f,profile,0,requestKey)]);
  assert.deepEqual(responses.map(r=>r.status),[200,200],JSON.stringify(responses));assert.equal(await count(f,'commerce_settings_changes'),1);
  assert.equal(responses[0].profile.values.supportEmail,'support@example.test');assert.equal(responses[0].profile.values.supportPhone,'+6281234567890');
  const changed=await Promise.all([save(f,{...profile,name:'First'},1),save(f,{...profile,name:'Second'},1)]);assert.deepEqual(changed.map(r=>r.status).sort(),[200,409]);
  const replay=await save(f,profile,0,requestKey);assert.equal(replay.status,200);assert.equal(replay.receipt.revision,1);assert.equal(replay.profile.revision,2);assert.equal(replay.receipt.values.name,profile.name);assert.equal(replay.receipt.replayed,true);
  assert.equal((await save(f,{...profile,name:'Different'},0,requestKey)).status,409);
  const shop={enabled:true,name:'Published shop name',accent:'#334155',button:'#111827',background:'#f7f8fa',logoId:'',backgroundId:'',animation:'none'};
  assert.equal((await f.merchant('/v1/storefront',shop)).status,200);
  assert.equal((await f.merchant('/v1/admin-profile',{logoId:''})).status,200);
  assert.equal((await f.merchant('/v1/shipping-settings',{revision:1,requestKey:key(),configuration:{...shippingConfiguration,couriers:['jne']}})).status,200);
  assert.equal((await save(f,{...profile,name:'Final store name'},2)).status,200);
  const settings=JSON.parse((await f.db.prepare("SELECT settings_json FROM sellers WHERE id='seller_alice'").first()).settings_json);assert.equal(settings.storefront.name,shop.name);assert.equal(settings.adminProfile.logoId,'');assert.equal(settings.privateTestSecret,'do not expose');
  const me=await f.merchant('/v1/me');assert.equal(me.user.active_seller.name,'Final store name');assert.equal(me.user.active_seller.businessProfile.timezone,'Asia/Makassar');assert(!JSON.stringify(me).includes('do not expose'));
  const publicView=await f.merchant('/v1/storefront/view?store=seller_alice');assert.equal(publicView.store.name,'Published shop name');assert.equal(publicView.store.supportPhone,'+6281234567890');assert.equal(publicView.store.description,profile.description);assert(!JSON.stringify(publicView).includes('privateTestSecret'));
});

test('notification choices are per member; viewers cannot change the store and removed access is never restored by a settings read',async t=>{
  const f=await setupCommerceFixture(t),requestKey=key();assert.equal((await save(f,profile,0,requestKey)).status,200);await member(f,'staff');
  const prefs=(await read(f,'staff')).notifications.values;prefs.messages.inApp=false;prefs.payment_confirmed.email=true;
  assert.equal((await save(f,prefs,0,key(),'notifications','staff')).status,200);assert.equal((await read(f,'staff')).notifications.values.messages.inApp,false);assert.equal((await read(f)).notifications.values.messages.inApp,true);
  assert.equal((await save(f,profile,1,key(),'profile','staff')).status,403);
  const history=await f.merchant(base+'/history?kind=notifications');assert.equal(history.items.length,0);
  const staffHistory=await f.merchant(base+'/history?kind=notifications',undefined,{seller:'staff'});assert.equal(staffHistory.items.length,1);assert.equal(staffHistory.items[0].actor,'you');
  await f.db.prepare("UPDATE seller_memberships SET role='viewer' WHERE auth_user_id='alice'").run();assert.equal((await save(f,profile,0,requestKey)).status,200,'a confirmed save remains readable after a role change');
  await f.db.prepare("DELETE FROM seller_memberships WHERE auth_user_id='alice'").run();assert.equal((await read(f)).status,403);assert.equal((await save(f,profile,0,requestKey)).status,403);assert.equal((await f.merchant('/v1/me')).user.active_seller,null);assert.equal(await count(f,'commerce_settings_changes'),2);
  const bob=await read(f,'bob');assert.equal(bob.profile.revision,0);assert.equal(bob.notifications.revision,0);
  const response=await f.mf.dispatchFetch('https://api.fixture.test'+base,{headers:{authorization:'Bearer '+await f.merchantToken('bob'),'x-ezkart-settings-store':'seller_alice'}});assert.equal(response.status,409);
});

test('strict settings input rejects duplicate JSON, forged scope, malformed preferences and oversized streaming bodies',async t=>{
  const f=await setupCommerceFixture(t),defaults=(await read(f)).notifications.values;
  for(const values of [{...profile,name:''},{...profile,name:'a\nb'},{...profile,timezone:'UTC'},{...profile,dateFormat:'custom'},{...profile,supportEmail:'test@invalid'},{...profile,supportPhone:'javascript:1'},{...profile,description:'x'.repeat(1001)},{...profile,plan:'advanced'}])assert.equal((await save(f,values)).status,422,JSON.stringify(values));
  for(const values of [{...defaults,unexpected:{}},{...defaults,messages:{email:true}},{...defaults,messages:{email:false,inApp:1}},{...defaults,messages:{email:false,inApp:true,extra:false}}])assert.equal((await save(f,values,0,key(),'notifications')).status,422);
  const token=await f.merchantToken(),headers={authorization:'Bearer '+token,'content-type':'application/json'};
  assert.equal((await f.mf.dispatchFetch('https://api.fixture.test'+base,{method:'POST',headers,body:'{"kind":"profile","kind":"notifications"}'})).status,400);
  const stream=new ReadableStream({start(c){c.enqueue(new TextEncoder().encode(JSON.stringify({x:'x'.repeat(13000)})));c.close();}});
  assert.equal((await f.mf.dispatchFetch('https://api.fixture.test'+base,{method:'POST',headers,body:stream,duplex:'half'})).status,413);
  assert.equal((await f.merchant(base,{kind:'profile',revision:0,requestKey:key(),values:profile,sellerId:'seller_bob'},{method:'POST'})).status,422);
  assert.equal((await f.merchant(base+'?seller=seller_bob')).status,405);assert.equal((await f.merchant(base+'/history?kind=profile&kind=notifications')).status,422);assert.equal((await f.mf.dispatchFetch('https://api.fixture.test'+base)).status,401);
  assert.equal(await count(f,'commerce_settings_changes'),0);
});

test('history has a stable boundary across later saves and cannot cross members or settings kinds',async t=>{
  const f=await setupCommerceFixture(t);for(let i=0;i<25;i++)assert.equal((await save(f,{...profile,name:'Version '+i},i)).status,200);
  const first=await f.merchant(base+'/history?kind=profile');assert.equal(first.items.length,20);assert.equal(first.items[0].revision,25);
  assert.equal((await save(f,{...profile,name:'New after reading'},25)).status,200);
  const second=await f.merchant(base+'/history?kind=profile&cursor='+first.nextCursor);assert.deepEqual(second.items.map(x=>x.revision),[5,4,3,2,1]);assert.equal(second.nextCursor,null);
  await member(f,'staff','editor');assert.equal((await f.merchant(base+'/history?kind=profile&cursor='+first.nextCursor,undefined,{seller:'staff'})).status,422);
  assert.equal((await f.merchant(base+'/history?kind=notifications&cursor='+first.nextCursor)).status,422);
  assert.equal((await f.merchant(base+'/history?kind=profile',undefined,{seller:'staff'})).items[0].actor,'store_member');
});

test('database receipts protect projections, JSON channel shapes and live membership even when access changes during a save',async t=>{
  const f=await setupCommerceFixture(t);assert.equal((await save(f)).status,200);
  for(const sql of ["UPDATE commerce_store_settings SET revision=2", "DELETE FROM commerce_store_settings", "UPDATE sellers SET name='forged' WHERE id='seller_alice'", "UPDATE sellers SET settings_json='{}' WHERE id='seller_alice'", "UPDATE commerce_settings_changes SET actor_id='bob'", "DELETE FROM commerce_settings_changes"])
    await assert.rejects(f.db.prepare(sql).run(),/settings_receipt/);
  const prefs=(await read(f)).notifications.values;prefs.messages={email:true,unknown:false};
  await assert.rejects(f.db.prepare("INSERT INTO commerce_settings_changes(seller_id,kind,subject,actor_id,request_key,request_hash,expected_revision,revision,data_json,created_at) VALUES('seller_alice','notifications','alice','alice',?,?,0,1,?,'now')").bind(key(),'a'.repeat(64),JSON.stringify(prefs)).run(),/settings_invalid/);
  let removed=false;const db=new Proxy(f.db,{get(target,property){if(property==='prepare')return sql=>{const statement=target.prepare(sql);if(!sql.startsWith('INSERT INTO commerce_settings_changes'))return statement;
    return {bind(...values){return {async run(){removed=true;await target.prepare("DELETE FROM seller_memberships WHERE auth_user_id='alice'").run();return statement.bind(...values).run();}};}};};const value=Reflect.get(target,property);return typeof value==='function'?value.bind(target):value;}});
  await assert.rejects(saveMerchantSettings({DB:db,COMMERCE_STORAGE:'d1'},{id:'alice',sellerId:'seller_alice'},{kind:'profile',values:{...profile,name:'Forbidden'},revision:1,requestKey:key()}),e=>e instanceof Response&&e.status===403);assert(removed);assert.equal(await count(f,'commerce_settings_changes'),1);
});

test('settings save limits still allow recovery of a previously committed request',async t=>{
  const f=await setupCommerceFixture(t),requestKey=key();assert.equal((await save(f,profile,0,requestKey)).status,200);
  for(let revision=1;revision<60;revision++)assert.equal((await save(f,{...profile,name:'Change '+revision},revision)).status,200);
  assert.equal((await save(f,profile,60)).status,429);assert.equal((await save(f,profile,0,requestKey)).status,200);assert.equal(await count(f,'commerce_settings_changes'),60);
});
