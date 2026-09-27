import test from 'node:test';
import assert from 'node:assert/strict';
import {betaScheduledTask,runBetaScheduledTask} from '../src/commerce-schedule.js';
import worker from '../src/index.js';
import {setupCommerceFixture} from './commerce-fixture.mjs';
import {emailFixtureConfiguration} from './email-fixture.mjs';

const env={APP_ENVIRONMENT:'beta',COMMERCE_SCHEDULE:'compact_v1'};
const controller=minute=>({cron:'* * * * *',scheduledTime:Date.UTC(2026,8,28,0,minute)});
test('one beta trigger retains hourly maintenance and separate bounded dispatch invocations across hour boundaries',()=>{
  const counts={};
  for(let minute=0;minute<120;minute++){
    const task=betaScheduledTask(env,controller(minute));assert.ok(['housekeeping','notifications','email','campaigns','automations'].includes(task));counts[task]=(counts[task]||0)+1;
    if(minute%60===17)assert.equal(task,'housekeeping');
  }
  assert.deepEqual(counts,{notifications:30,email:28,campaigns:30,automations:30,housekeeping:2});
  for(const deployment of ['test','production',''])assert.equal(betaScheduledTask({...env,APP_ENVIRONMENT:deployment},controller(1)),null);
  assert.equal(betaScheduledTask({...env,COMMERCE_SCHEDULE:'held'},controller(1)),null);
  assert.equal(betaScheduledTask(env,{...controller(17),cron:'17 * * * *'}),null);
  for(const value of [undefined,NaN,Infinity,-1,'123',Number.MAX_SAFE_INTEGER])assert.throws(()=>betaScheduledTask(env,{...controller(1),scheduledTime:value}));
});

test('scheduled results await completion, report only operational metadata and preserve failures',async()=>{
  const entries=[],log={info:(...v)=>entries.push(v),error:(...v)=>entries.push(v)};
  let completed=false;
  await runBetaScheduledTask('email',controller(1),{email:async()=>{await Promise.resolve();completed=true;return {privateRecipient:'hidden@example.test'};}},log);
  assert.equal(completed,true);assert.equal(entries[0][1].outcome,'ok');assert(!JSON.stringify(entries).includes('hidden'));
  const failure=Error('original failure');await assert.rejects(runBetaScheduledTask('campaigns',controller(2),{campaigns:async()=>{throw failure;}},log),error=>error===failure);
  assert.equal(entries[1][1].outcome,'error');assert(!JSON.stringify(entries).includes('original failure'));
  await runBetaScheduledTask('email',controller(1),{email:async()=>({failed:1,processed:0,privateRecipient:'hidden@example.test'})},log);
  assert.equal(entries[2][1].outcome,'attention');assert.equal(entries[2][1].failed,1);assert(!JSON.stringify(entries).includes('hidden'));
});

test('real scheduled entry point performs no database or provider work while compact email and campaign services are held',async()=>{
  for(const minute of [1,2,3]){
    const tasks=[];await worker.scheduled(controller(minute),env,{waitUntil:task=>tasks.push(task)});
    assert.equal(tasks.length,1);await Promise.all(tasks);
  }
});

test('enabled compact beta dispatchers accept the real empty D1 queues without fabricating messages or payments',async t=>{
  const bindings={...emailFixtureConfiguration(),...env,COMMERCE_CAMPAIGN_SEND:'enabled',COMMERCE_MARKETING_AUTOMATIONS:'enabled',COMMERCE_CHECKOUT:'held'};
  const f=await setupCommerceFixture(t,{bindings}),live={...bindings,DB:f.db};
  for(const minute of [0,1,2,3]){
    const tasks=[];await worker.scheduled(controller(minute),live,{waitUntil:task=>tasks.push(task)});
    assert.equal(tasks.length,1);await Promise.all(tasks);
  }
  for(const table of ['commerce_email_requests','commerce_campaign_email_requests','orders','commerce_notification_events']){
    assert.equal((await f.db.prepare('SELECT COUNT(*) AS n FROM '+table).first()).n,0);
  }
});
