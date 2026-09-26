import test from 'node:test';
import assert from 'node:assert/strict';
import {campaignPublicationFixture,publicationBase,publicationKey} from './campaign-publication-fixture.mjs';
import {campaignWorkspace} from '../src/marketing-campaigns.js';
test('workspace reports actual campaign connectivity independently of transactional configuration and merchant role',async t=>{
  const f=await campaignPublicationFixture(t),actor={id:'alice',sellerId:'seller_alice'};
  assert.equal((await campaignWorkspace(f.env,actor)).deliveryAvailable,true);
  const held=await campaignWorkspace({...f.env,COMMERCE_CAMPAIGN_SEND:'off'},actor);assert.equal(held.deliveryAvailable,false);assert.equal(held.emailServiceConnected,true);
  assert.equal((await campaignWorkspace({...f.env,COMMERCE_STORAGE:'legacy'},actor)).deliveryAvailable,false);
  await f.db.prepare("UPDATE seller_memberships SET role='viewer' WHERE auth_user_id='alice'").run();const viewer=await campaignWorkspace(f.env,actor);assert.equal(viewer.canEdit,false);assert.equal(viewer.deliveryAvailable,true);
});
test('published campaigns use their actual revised send time in the library and store-timezone calendar',async t=>{
  const f=await campaignPublicationFixture(t);await f.addBuyer(1);
  const profile=(await f.merchant('/v1/commerce/settings')).profile.values;assert.equal((await f.merchant('/v1/commerce/settings',{kind:'profile',revision:0,requestKey:publicationKey(),values:{...profile,timezone:'Asia/Jayapura'}},{method:'POST'})).status,200);
  const date=new Date();date.setUTCMonth(date.getUTCMonth()+2,1);date.setUTCHours(0,30,0,0);
  const before=new Date(date.getTime()-86400000),draftTime=before.toISOString(),actualTime=new Date(date.getTime()-8*3600000).toISOString(),month=date.toISOString().slice(0,7),oldMonth=before.toISOString().slice(0,7);
  const saved=await f.merchant(publicationBase,{id:f.id,revision:1,requestKey:publicationKey(),values:{...f.values,plannedAt:draftTime}},{method:'POST'});assert.equal(saved.status,200);
  const published=await f.publish({...f.intent(),revision:2,scheduledAt:actualTime});assert.equal(published.status,200,published.error);assert.equal(published.publication.canReschedule,true);
  const list=await f.merchant(publicationBase+'?month='+month);assert.equal(list.items.length,1);assert.deepEqual(list.items[0].publication,{id:published.publication.id,scheduledAt:actualTime,cancelled:false});
  assert.equal((await f.merchant(publicationBase+'?month='+oldMonth)).items.length,0);assert.equal(list.items[0].values.plannedAt,draftTime);
  const changed=await f.action('reschedule',0,new Date(date.getTime()+45*86400000).toISOString());assert.equal(changed.status,200,changed.error);assert.equal((await f.merchant(publicationBase+'?month='+month)).items.length,0);
  assert.equal((await f.action('cancel',1)).status,200);const final=(await f.merchant(publicationBase)).items[0];assert.equal(final.publication.cancelled,true);
  assert.equal((await f.merchant('/v1/commerce/marketing/workspace')).summary.planned,1);
  assert.equal((await f.merchant(publicationBase,undefined,{seller:'bob'})).items.length,0);
});
test('rescheduling capability closes after any processing attempt, including a confirmed no-send outcome',async t=>{
  const f=await campaignPublicationFixture(t);await f.addBuyer(1);const published=await f.publish();assert.equal(published.publication.canReschedule,true);
  const job=(await f.call('/internal/commerce/jobs/claim',{environment:'sandbox',workerId:'campaign_workspace',kinds:['campaign.send'],limit:1})).jobs[0];assert(job);
  assert.equal((await f.merchant(f.path+'/publication')).publication.canReschedule,false);
  assert.equal((await f.action('cancel')).status,200);assert.equal((await f.merchant(f.path+'/publication')).publication.canReschedule,false);
});
