import test from 'node:test';
import assert from 'node:assert/strict';
import {randomBytes,createHash} from 'node:crypto';
import {readFile,readdir} from 'node:fs/promises';
import {DatabaseSync} from 'node:sqlite';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {setupCommerceFixture} from './commerce-fixture.mjs';
import {applyCommerceSchema} from './commerce-schema.mjs';
import {commerceHash} from '../src/commerce-orders.js';
import {dispatchNotifications} from '../src/commerce-notification-dispatch.js';
import {saveReply} from '../src/commerce-messages.js';

const key=()=>randomBytes(16).toString('hex'),buyer='upgrade-buyer';
const quote=name=>'"'+name.replaceAll('"','""')+'"';
async function snapshot(db){
  const schema=(await db.prepare("SELECT type,name,tbl_name,sql FROM sqlite_master WHERE name NOT LIKE 'sqlite_%' ORDER BY type,name").all()).results;
  const rows={};
  for(const table of schema.filter(row=>row.type==='table'&&!row.name.startsWith('_cf_')))rows[table.name]=(await db.prepare('SELECT * FROM '+quote(table.name)).all()).results.sort((a,b)=>JSON.stringify(a).localeCompare(JSON.stringify(b)));
  rows.sqlite_sequence=(await db.prepare('SELECT * FROM sqlite_sequence ORDER BY name').all()).results;
  return {schema,rows};
}
async function physicalDatabase(previousDirs,id){
  for(const dir of (await readdir(tmpdir())).filter(name=>name.startsWith('miniflare-')&&!previousDirs.has(name))){
    const d1=join(tmpdir(),dir,'d1');let files;
    try{files=await readdir(d1,{recursive:true});}catch{continue;}
    for(const file of files.filter(name=>name.endsWith('.sqlite'))){
      const path=join(d1,file),native=new DatabaseSync(path,{readOnly:true});
      try{if(native.prepare('SELECT id FROM commerce_conversations WHERE id=?').get(id))return path;}catch{/* This may be the namespace metadata database. */}finally{native.close();}
    }
  }
  throw Error('The fixture physical SQLite file could not be identified by its unique conversation.');
}
async function integrity(db,path){
  assert.deepEqual((await db.prepare('PRAGMA foreign_key_check').all()).results,[]);
  const native=new DatabaseSync(path,{readOnly:true});
  try{
    assert.deepEqual(native.prepare('PRAGMA integrity_check').all().map(row=>({...row})),[{integrity_check:'ok'}]);
    assert.deepEqual(native.prepare('PRAGMA foreign_key_check').all(),[]);
  }finally{native.close();}
}

test('0084 upgrades populated 0083 data additively, preserving Messages receipts and allowing the first verified origin later',async t=>{
  const previousDirs=new Set(await readdir(tmpdir()));
  const f=await setupCommerceFixture(t,{through:83,notifications:'scheduled'}),db=f.db;
  const env={DB:db,APP_ENVIRONMENT:'test',COMMERCE_STORAGE:'d1',COMMERCE_NOTIFICATIONS:'scheduled',PRIVATE_ASSETS:await f.mf.getR2Bucket('PRIVATE_ASSETS')};
  const api=(path,input,who=buyer)=>f.merchant('/v1/'+(who===buyer||who==='stranger'?'customer':'commerce')+'/messages'+path,input,{seller:who,method:input===undefined?'GET':'POST'});
  assert.equal(await db.prepare("SELECT name FROM sqlite_master WHERE name='commerce_message_origins'").first(),null);
  const prefs=await f.merchant('/v1/customer/notifications/preferences',undefined,{seller:buyer});prefs.values.messages.email=true;
  assert.equal((await f.merchant('/v1/customer/notifications/preferences',{revision:0,requestKey:key(),values:prefs.values},{seller:buyer,method:'POST'})).status,200);
  const settings=await f.merchant('/v1/commerce/settings');settings.notifications.values.messages.email=false;
  assert.equal((await f.merchant('/v1/commerce/settings',{kind:'notifications',revision:0,requestKey:key(),values:settings.notifications.values},{method:'POST'})).status,200);
  const created=await f.create(f.input({customer:{name:'Existing Customer',email:'existing@example.test',phone:'081234567890',authUserId:buyer}}));assert.equal(created.status,200,created.error);
  assert.equal((await f.paid(created.order)).status,200);
  const id='conv_'+(await commerceHash({mode:'sandbox',seller:'seller_alice',buyer})).slice(0,32);
  // Seed through the original 0026/0029 table and trigger contracts, before any
  // 0084 table exists. New origin-aware SELECTs deliberately are not used here.
  await db.prepare(`INSERT INTO commerce_conversations(id,seller_id,commerce_environment,buyer_auth_user_id,buyer_name,context_kind,context_id,creator_kind,creator_id,created_at)
    VALUES(?,'seller_alice','sandbox',?,'Existing Customer','product','tea','buyer',?,?)`).bind(id,buyer,buyer,new Date().toISOString()).run();
  const first={kind:'message',body:'Existing buyer question',photos:[],requestKey:key()};
  const oldInputs=[first,{kind:'message',body:'Existing merchant answer',photos:[],requestKey:key()},{kind:'message',body:'Existing buyer follow-up',photos:[],requestKey:key()}];
  for(const [index,input] of oldInputs.entries()){
    await db.prepare(`INSERT INTO commerce_message_events(conversation_id,commerce_environment,actor_kind,actor_id,request_key,request_hash,kind,body,media_json,context_json,state,expected_revision,created_at)
      VALUES(?,'sandbox',?,?,?,?, 'message',?,'[]','{}','open',NULL,?)`).bind(id,index===1?'merchant':'buyer',index===1?'alice':buyer,input.requestKey,await commerceHash({id,...input}),input.body,new Date().toISOString()).run();
  }
  const last=(await db.prepare('SELECT MAX(id) AS id FROM commerce_message_events WHERE conversation_id=?').bind(id).first()).id;
  await db.prepare("INSERT INTO commerce_message_reads(conversation_id,actor_kind,actor_id,event_id,updated_at) VALUES(?,'merchant','alice',?,?)").bind(id,last,new Date().toISOString()).run();
  await saveReply(env,{kind:'merchant',id:'alice',sellerId:'seller_alice',role:'owner'},{title:'Existing saved reply',body:'Existing response',state:'active',revision:0,requestKey:key()});
  for(let n=0;n<4;n++)assert.equal((await dispatchNotifications(env)).failed,0);
  const inbox=await f.merchant('/v1/commerce/notifications');assert.ok(inbox.items.length>0);
  assert.equal((await f.merchant('/v1/commerce/notifications/read',{ids:[inbox.items[0].id]},{method:'POST'})).status,200);
  const sqlitePath=await physicalDatabase(previousDirs,id);
  await integrity(db,sqlitePath);
  const before=await snapshot(db);
  for(const name of ['customers','products','orders','commerce_conversations','commerce_message_events','commerce_message_reads','commerce_saved_replies','commerce_jobs','commerce_job_attempts','commerce_notification_events','commerce_notification_recipients','commerce_notification_reads','commerce_notification_preferences','commerce_buyer_notification_preferences','commerce_buyer_notification_changes'])assert.ok(before.rows[name]?.length>0,'populated '+name);
  const legacyDetail=await db.prepare('SELECT id,body,state FROM commerce_message_events WHERE conversation_id=? ORDER BY id').bind(id).all();assert.deepEqual(legacyDetail.results.map(row=>row.body),oldInputs.map(input=>input.body));
  const migration=await readFile(new URL('../migrations/0084_message_origin_push.sql',import.meta.url),'utf8');
  await applyCommerceSchema(db,83,84);
  await integrity(db,sqlitePath);
  const after=await snapshot(db),oldNames=new Set(before.schema.map(row=>row.type+':'+row.name));
  assert.deepEqual(after.schema.filter(row=>oldNames.has(row.type+':'+row.name)),before.schema,'every old table, index, view and trigger is byte-for-byte unchanged');
  for(const [name,rows] of Object.entries(before.rows))assert.deepEqual(after.rows[name],rows,'all existing rows/IDs/receipts preserved: '+name);
  assert.deepEqual(after.schema.filter(row=>!oldNames.has(row.type+':'+row.name)).map(row=>row.type+':'+row.name).sort(),[
    'index:customer_push_actor','index:customer_push_pending','table:commerce_message_origins','table:customer_push_deliveries','table:customer_push_subscriptions',
    'trigger:customer_push_limit_insert','trigger:customer_push_limit_update','trigger:message_origin_delete','trigger:message_origin_update',
  ]);
  for(const name of ['commerce_message_origins','customer_push_subscriptions','customer_push_deliveries'])assert.deepEqual(after.rows[name],[],'no opt-in, origin or delivery backfill');
  assert.deepEqual((await db.prepare('SELECT id,body,state FROM commerce_message_events WHERE conversation_id=? ORDER BY id').bind(id).all()).results,legacyDetail.results,'original Messages read query remains valid with additive tables retained');
  t.diagnostic(JSON.stringify({migration:'0084_message_origin_push.sql',sha256:createHash('sha256').update(migration).digest('hex'),preservedTables:Object.keys(before.rows).length,preservedRows:Object.values(before.rows).reduce((n,rows)=>n+rows.length,0),newSchemaObjects:9,foreignKeys:'clean',integrity:'ok'}));
  const detail=await api('/'+id);assert.equal(detail.status,200);assert.equal(detail.conversation.origin,null);assert.deepEqual(detail.items.map(item=>item.body),oldInputs.map(input=>input.body));
  assert.equal((await api('/'+id,undefined,'stranger')).status,404);assert.equal((await api('/'+id,undefined,'bob')).status,404);
  const jobsBefore=(await db.prepare('SELECT COUNT(*) AS n FROM commerce_jobs').first()).n;
  const replay=await api('/'+id,first);assert.equal(replay.status,200);assert.equal(replay.replayed,true);assert.equal((await db.prepare('SELECT COUNT(*) AS n FROM commerce_jobs').first()).n,jobsBefore,'old request ID never emits a duplicate job');
  const started=await api('',{context:{kind:'order',id:created.order.id}});assert.equal(started.status,200);assert.equal(started.conversation.id,id);assert.equal(started.conversation.origin,null);
  const visit=randomBytes(32).toString('hex'),hash=createHash('sha256').update('tracking:sandbox:'+visit).digest('hex'),campaign='trk_'+key(),source=randomBytes(32).toString('hex');
  await db.prepare("INSERT INTO tracking_campaigns(id,seller_id,commerce_environment,name,request_hash,started_at) VALUES(?,'seller_alice','sandbox','Upgrade campaign','fixture',?)").bind(campaign,new Date().toISOString()).run();
  await db.prepare("INSERT INTO tracking_pages VALUES(?,'original-page','Original Page','/alice/shop/original-page')").bind(campaign).run();
  await db.prepare("INSERT INTO tracking_sources VALUES(?,?,'original-page','Facebook',?)").bind(source,campaign,new Date().toISOString()).run();
  await db.prepare('INSERT INTO tracking_visits VALUES(?,?,?,?,?,?)').bind(hash,source,'fixture',new Date().toISOString(),new Date(Date.now()+3600000).toISOString(),'{}').run();
  const sourced=await api('',{context:{kind:'product',id:'tea'},origin:{pageId:'original-page',trackingVisit:visit}});assert.equal(sourced.status,200);assert.equal(sourced.conversation.id,id);
  const origin={pageId:'original-page',pageName:'Original Page',platform:'Facebook',campaign:'Upgrade campaign',campaignId:campaign,verifiedTrackingLink:true};assert.deepEqual(sourced.conversation.origin,origin);
  await db.prepare("UPDATE tracking_visits SET expires_at='2000-01-01T00:00:00.000Z' WHERE token_hash=?").bind(hash).run();
  await env.PRIVATE_ASSETS.put('sellers/seller_alice/landing-pages/later-page.json',JSON.stringify({id:'later-page',name:'Later page',status:'published',publishedHtml:'<html></html>'}));
  assert.deepEqual((await api('',{context:{kind:'product',id:'tea'},origin:{pageId:'later-page'}})).conversation.origin,origin,'later origin cannot replace first origin');
  assert.deepEqual((await api('/'+id,undefined,'alice')).conversation.origin,origin);
  assert.equal((await db.prepare('SELECT COUNT(*) AS n FROM commerce_conversations').first()).n,1);
  await assert.rejects(db.prepare("UPDATE commerce_message_origins SET origin_json='{}' WHERE conversation_id=?").bind(id).run(),/immutable_message_origin/);
  const replyInput={kind:'message',body:'Reply after additive upgrade',photos:[],requestKey:key()};
  const reply=await api('/'+id,replyInput,'alice');assert.equal(reply.status,200);
  const jobs=await db.prepare('SELECT COUNT(*) AS n FROM commerce_jobs').first();const repeated=await api('/'+id,replyInput,'alice');assert.equal(repeated.status,200);assert.equal(repeated.replayed,true);assert.equal(repeated.event.id,reply.event.id);assert.equal((await db.prepare('SELECT COUNT(*) AS n FROM commerce_jobs').first()).n,jobs.n);
  assert.ok(jobs.n>jobsBefore);assert.deepEqual((await db.prepare('SELECT * FROM customer_push_subscriptions').all()).results,[]);assert.deepEqual((await db.prepare('SELECT * FROM customer_push_deliveries').all()).results,[]);
  await integrity(db,sqlitePath);
});
