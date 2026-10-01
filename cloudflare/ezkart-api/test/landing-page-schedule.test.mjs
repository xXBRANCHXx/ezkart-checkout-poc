import test from 'node:test';
import assert from 'node:assert/strict';
import {setupCommerceFixture} from './commerce-fixture.mjs';
import {seedDeclaredOnboarding} from './onboarding-fixture.mjs';
import {changeLandingSchedule,publishDueLandingPages,checkedScheduleTime} from '../src/landing-page-schedule.js';
import {putJevPage} from '../src/jev-page-state.js';

const seller='seller_alice',id='scheduled',key=`sellers/${seller}/landing-pages/${id}.json`;
const html='<h1>Chosen version</h1><button data-ezkart-add="tea">Buy</button>';
const future=()=>new Date(Date.now()+3600000).toISOString();
const read=async env=>JSON.parse(await(await env.PRIVATE_ASSETS.get(key)).text());
const conflict=error=>error instanceof Response && error.status===409;

test('publication times require valid ISO dates, a named timezone, and a future bounded date',()=>{
  const now=Date.now(),at=new Date(now+120000).toISOString();
  assert.deepEqual(checkedScheduleTime(at,'Asia/Jakarta',now),{at,timezone:'Asia/Jakarta'});
  for(const [at,zone] of [['2026-02-30T00:00:00.000Z','Asia/Jakarta'],[future(),'fake/zone'],[new Date(now).toISOString(),'UTC'],[new Date(now+367*86400000).toISOString(),'UTC']]) assert.throws(()=>checkedScheduleTime(at,zone,now),error=>error.status===400);
});

test('authenticated schedule freezes a version, preserves draft edits, supports reschedule/cancel and exact replay',async t=>{
  const f=await setupCommerceFixture(t); await seedDeclaredOnboarding(f.db);
  const env={DB:f.db,PRIVATE_ASSETS:await f.mf.getR2Bucket('PRIVATE_ASSETS')};
  let saved=await f.merchant(`/v1/landing-pages/${id}`,{name:'Schedule fixture',products:['tea'],customProducts:[],state:{version:6,preview:html}});
  assert.equal(saved.status,200);
  const create={action:'create',requestId:crypto.randomUUID(),sourceUpdatedAt:saved.page.updatedAt,at:future(),timezone:'Asia/Jakarta',html};
  let r=await f.merchant(`/v1/landing-pages/${id}/schedule`,create,{method:'POST'});
  assert.equal(r.status,200,JSON.stringify(r));assert.equal(r.page.status,'draft');assert.equal(r.page.scheduledPublication.sourceUpdatedAt,create.sourceUpdatedAt);
  assert.equal(r.page.scheduledPublication.html,undefined);assert.equal((await read(env)).scheduledPublication.html,html);
  assert.equal((await f.merchant(`/v1/landing-pages/${id}/schedule`,create,{method:'POST',seller:'bob'})).status,404);
  assert.equal((await f.merchant(`/v1/landing-pages/${id}/schedule`,create,{method:'POST'})).status,200);
  assert.equal((await f.merchant(`/v1/landing-pages/${id}/schedule`,{...create,at:new Date(Date.now()+7200000).toISOString()},{method:'POST'})).status,409);
  saved=await f.merchant(`/v1/landing-pages/${id}`,{state:{version:6,preview:'<h1>New private draft</h1>'}});assert.equal(saved.status,200);
  assert.equal((await read(env)).scheduledPublication.html,html);
  const move={action:'reschedule',requestId:crypto.randomUUID(),sourceUpdatedAt:saved.page.updatedAt,scheduleId:create.requestId,at:future(),timezone:'Asia/Makassar'};
  r=await f.merchant(`/v1/landing-pages/${id}/schedule`,move,{method:'POST'});assert.equal(r.status,200);
  assert.equal((await read(env)).scheduledPublication.state.preview,html);
  assert.equal((await f.merchant(`/v1/landing-pages/${id}/schedule`,{...move,requestId:crypto.randomUUID(),sourceUpdatedAt:'old'},{method:'POST'})).status,409);
  let due=await publishDueLandingPages(env,async(_seller,snapshot,state)=>{assert.equal(snapshot,html);assert.equal(state.preview,html);},async()=>false,Date.parse(move.at)+1);
  assert.equal(due.published,1);
  let page=await read(env);assert.equal(page.publishedHtml,html);assert.equal(page.state.preview,'<h1>New private draft</h1>');assert.equal(page.scheduledPublication.status,'published');
  assert.equal((await publishDueLandingPages(env,async()=>assert.fail('duplicate'),async()=>false,Date.parse(move.at)+2)).published,0);
  const second={...create,requestId:crypto.randomUUID(),sourceUpdatedAt:page.updatedAt};
  // Snapshot ownership checks reject missing purchase controls after draft edits.
  assert.equal((await f.merchant(`/v1/landing-pages/${id}/schedule`,second,{method:'POST'})).status,422);
  saved=await f.merchant(`/v1/landing-pages/${id}`,{state:{version:6,preview:html}});
  r=await f.merchant(`/v1/landing-pages/${id}/schedule`,{...second,sourceUpdatedAt:saved.page.updatedAt},{method:'POST'});assert.equal(r.status,200);
  const cancel={action:'cancel',requestId:crypto.randomUUID(),sourceUpdatedAt:r.page.updatedAt,scheduleId:second.requestId};
  r=await f.merchant(`/v1/landing-pages/${id}/schedule`,cancel,{method:'POST'});assert.equal(r.status,200);assert.equal(r.page.scheduledPublication,null);
  assert.equal((await f.merchant(`/v1/landing-pages/${id}/schedule`,cancel,{method:'POST'})).status,200);
  assert.equal((await publishDueLandingPages(env,async()=>assert.fail('cancelled version'),async()=>false,Date.parse(second.at)+1)).published,0);
  // Publishing immediately clears a previously scheduled snapshot and keeps receipts.
  saved=await f.merchant(`/v1/landing-pages/${id}`,{name:'Schedule fixture',products:['tea'],customProducts:[],state:{version:6,preview:html},publishedHtml:html,status:'published'});assert.equal(saved.status,200);assert.equal(saved.page.scheduledPublication,null);assert.equal(saved.page.scheduleReceipt.requestId,cancel.requestId);
  // Exercise the real minute-trigger handler with an isolated due snapshot.
  const cronRequest={...create,requestId:crypto.randomUUID(),sourceUpdatedAt:saved.page.updatedAt,at:future()};
  r=await f.merchant(`/v1/landing-pages/${id}/schedule`,cronRequest,{method:'POST'});assert.equal(r.status,200);
  page=await read(env);page.scheduledPublication.at=new Date(Date.now()-60000).toISOString();
  const object=await env.PRIVATE_ASSETS.head(key);
  await putJevPage(env,seller,id,object.etag,JSON.stringify(page),{customMetadata:object.customMetadata});
  await env.PRIVATE_ASSETS.put(`landing-page-schedules/${page.scheduledPublication.at}/${seller}/${id}/${cronRequest.requestId}.json`,JSON.stringify({seller,id,scheduleId:cronRequest.requestId,at:page.scheduledPublication.at}));
  await f.db.prepare("UPDATE products SET stock_quantity=0 WHERE id='tea'").run();
  await (await f.mf.getWorker()).scheduled({cron:'* * * * *'});
  page=await read(env);assert.equal(page.scheduledPublication.status,'failed');assert.match(page.scheduledPublication.error,/stock/i);assert.equal(page.publishedHtml,html);
  await f.db.prepare("UPDATE seller_memberships SET role='viewer' WHERE auth_user_id='alice'").run();
  assert.equal((await f.merchant(`/v1/landing-pages/${id}/schedule`,{...cronRequest,requestId:crypto.randomUUID(),sourceUpdatedAt:page.updatedAt},{method:'POST'})).status,403);

});

test('due publication rechecks availability, retries unknown storage writes, and cannot beat a concurrent cancellation',async t=>{
  const f=await setupCommerceFixture(t),bucket=await f.mf.getR2Bucket('PRIVATE_ASSETS'),env={DB:f.db,PRIVATE_ASSETS:bucket};
  await f.merchant(`/v1/landing-pages/${id}`,{name:'Race fixture',state:{preview:html}});
  let page=await read(env);
  const action=()=>({action:'create',requestId:crypto.randomUUID(),sourceUpdatedAt:page.updatedAt,at:future(),timezone:'UTC',html});
  let payload=action();page=await changeLandingSchedule(env,seller,id,payload,async()=>{});
  let wait,release;const gate=new Promise(resolve=>release=resolve),entered=new Promise(resolve=>wait=resolve);
  const processing=publishDueLandingPages(env,async()=>{wait();await gate;},async()=>false,Date.parse(payload.at)+1);
  await entered;
  await changeLandingSchedule(env,seller,id,{action:'cancel',requestId:crypto.randomUUID(),sourceUpdatedAt:page.updatedAt,scheduleId:payload.requestId},async()=>{});
  release();await processing;assert.equal((await read(env)).status,'draft');
  page=await read(env);payload=action();page=await changeLandingSchedule(env,seller,id,payload,async()=>{});
  await publishDueLandingPages(env,async()=>{throw new Response('Add stock before publishing.',{status:422});},async()=>false,Date.parse(payload.at)+1);
  page=await read(env);assert.equal(page.status,'draft');assert.equal(page.scheduledPublication.status,'failed');assert.match(page.scheduledPublication.error,/stock/);
  payload=action();const lost={...env,PRIVATE_ASSETS:new Proxy(bucket,{get(target,name){if(name==='put')return async(...args)=>{const result=await target.put(...args);if(args[0]===key)throw Error('lost receipt');return result;};return typeof target[name]==='function'?target[name].bind(target):target[name];}})};
  await assert.rejects(changeLandingSchedule(lost,seller,id,payload,async()=>{}),/lost receipt/);
  page=await changeLandingSchedule(env,seller,id,payload,async()=>assert.fail('must replay'));assert.equal(page.scheduleReceipt.requestId,payload.requestId);
  await publishDueLandingPages(env,async()=>{throw new Response('Storage unavailable',{status:503});},async()=>false,Date.parse(payload.at)+1);assert.equal((await read(env)).scheduledPublication.status,'pending');
  await publishDueLandingPages(env,async()=>{},async()=>false,Date.parse(payload.at)+2);assert.equal((await read(env)).status,'published');
});
