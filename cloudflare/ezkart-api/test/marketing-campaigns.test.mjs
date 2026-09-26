import test from 'node:test';
import assert from 'node:assert/strict';
import {randomBytes} from 'node:crypto';
import {setupCommerceFixture} from './commerce-fixture.mjs';
import {saveCampaign,campaignWorkspace,listCampaigns} from '../src/marketing-campaigns.js';
const key=()=>randomBytes(16).toString('hex'),base='/v1/commerce/marketing';
export const campaignDraft=(patch={})=>({name:'Autumn tea collection',subject:'Make time for a cup',preheader:'A small moment for yourself',heading:'Your everyday ritual',body:'Fresh tea for slow mornings.\n\nPacked with care.',buttonLabel:'Explore the store',plannedAt:null,
  audience:{q:'',activity:'all',minSpend:'',minOrders:'',maxOrders:'',lastFrom:'',lastTo:'',location:'',tag:''},archived:false,...patch});
const save=(f,values=campaignDraft(),id=null,revision=0,requestKey=key(),seller='alice')=>f.merchant(base+'/campaigns',{id,revision,requestKey,values},{method:'POST',seller});
const count=async(f,table)=>(await f.db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).first()).n;
const actor={id:'alice',sellerId:'seller_alice'};

test('campaign saves survive duplicate requests, later changes, archives and exact replays without creating a send',async t=>{
  const f=await setupCommerceFixture(t),requestKey=key(),values=campaignDraft({name:'  A careful draft  ',body:'Paragraph one.\r\n\r\nParagraph two.'});
  const results=await Promise.all([save(f,values,null,0,requestKey),save(f,values,null,0,requestKey)]);assert.deepEqual(results.map(r=>r.status),[200,200],JSON.stringify(results));
  const first=results[0].campaign;assert.equal(first.values.name,'A careful draft');assert.equal(first.values.body,'Paragraph one.\n\nParagraph two.');assert.equal(await count(f,'commerce_campaign_changes'),1);
  const races=await Promise.all([save(f,campaignDraft({name:'First writer'}),first.id,1),save(f,campaignDraft({name:'Second writer'}),first.id,1)]);assert.deepEqual(races.map(r=>r.status).sort(),[200,409]);assert.equal(races.find(r=>r.status===409).code,'campaign_revision_conflict');
  const archive=await save(f,campaignDraft({archived:true}),first.id,2);assert.equal(archive.status,200,archive.error);assert.equal(archive.campaign.createdAt,first.createdAt);
  const replay=await save(f,values,null,0,requestKey);assert.equal(replay.receipt.replayed,true);assert.equal(replay.receipt.revision,1);assert.equal(replay.campaign.revision,3);assert.equal(replay.campaign.values.archived,true);
  assert.equal((await save(f,campaignDraft(),null,0,requestKey)).code,'campaign_reference_conflict');assert.equal((await f.merchant(base+'/campaigns')).items.length,0);
  assert.equal((await f.merchant(base+'/campaigns?state=archived')).items[0].id,first.id);
  assert.equal((await save(f,campaignDraft(),first.id,3)).status,200);assert.equal((await f.merchant(base+'/campaigns')).items.length,1);
  assert.equal(await count(f,'commerce_email_requests'),0);assert.equal(await count(f,'commerce_jobs'),0);
});

test('drafts work during the commerce hold, while real customer audience previews remain unavailable',async t=>{
  const f=await setupCommerceFixture(t,{bindings:{COMMERCE_STORAGE:'legacy'}}),workspace=await f.merchant(base+'/workspace');
  assert.equal(workspace.status,200,workspace.error);assert.equal(workspace.deliveryAvailable,false);assert.equal(workspace.emailServiceConnected,false);assert.equal(workspace.audienceAvailable,false);assert.equal(workspace.shopEnabled,false);
  assert.equal(workspace.shopUrl,'https://test.ezkart.id/shop/?store=seller_alice');assert.deepEqual(workspace.summary,{total:0,active:0,planned:0});
  assert.equal((await save(f)).status,200);assert.equal((await f.merchant(base+'/audience',{filters:{}},{method:'POST'})).status,503);
  assert.equal((await f.merchant(base+'/workspace')).summary.active,1);
});

test('store, environment and current membership isolate saved campaigns, history, cursors and replay receipts',async t=>{
  const f=await setupCommerceFixture(t),requestKey=key(),first=await save(f,campaignDraft(),null,0,requestKey),id=first.campaign.id;
  for(const path of ['/campaigns/'+id,'/campaigns/'+id+'/history'])assert.equal((await f.merchant(base+path,undefined,{seller:'bob'})).status,404);
  assert.equal((await save(f,campaignDraft(),id,1,key(),'bob')).status,404);assert.equal((await f.merchant(base+'/campaigns',undefined,{seller:'bob'})).items.length,0);
  const prod={DB:f.db,APP_ENVIRONMENT:'production'};assert.equal((await campaignWorkspace(prod,actor)).summary.total,0);
  await assert.rejects(saveCampaign(prod,actor,{id:null,revision:0,requestKey,values:campaignDraft()}),e=>e.status===409);
  const other=await saveCampaign(prod,actor,{id:null,revision:0,requestKey:key(),values:campaignDraft()});assert.notEqual(other.campaign.id,id);assert.equal((await f.merchant(base+'/workspace')).summary.total,1);
  await f.db.prepare("UPDATE seller_memberships SET role='viewer' WHERE auth_user_id='alice'").run();assert.equal((await f.merchant(base+'/workspace')).canEdit,false);assert.equal((await save(f,campaignDraft(),id,1)).status,403);assert.equal((await save(f,campaignDraft(),null,0,requestKey)).status,200);
  const response=await f.mf.dispatchFetch('https://api.fixture.test'+base+'/workspace',{headers:{authorization:'Bearer '+await f.merchantToken(),'x-ezkart-marketing-store':'seller_bob'}});assert.equal(response.status,409);
  await f.db.prepare("DELETE FROM seller_memberships WHERE auth_user_id='alice'").run();assert.equal((await f.merchant(base+'/workspace')).status,403);assert.equal((await save(f,campaignDraft(),null,0,requestKey)).status,403);assert.equal((await f.merchant('/v1/me')).user.active_seller,null);
});

test('strict request validation rejects forged recipients, malformed dates, extra scope, duplicate fields and streaming overflow',async t=>{
  const f=await setupCommerceFixture(t),headers={authorization:'Bearer '+await f.merchantToken(),'content-type':'application/json'};
  for(const patch of [{name:''},{name:'line\nbreak'},{subject:'x'.repeat(161)},{body:'x\u0000y'},{plannedAt:'2026-02-30T00:00:00.000Z'},{plannedAt:'2026-09-30T00:00:00Z'},{archived:1},{audience:{emails:['victim@example.test']}},{audience:{minSpend:'1e3'}},{audience:{minOrders:'2',maxOrders:'1'}},{send:true}])assert.equal((await save(f,campaignDraft(patch))).status,422,JSON.stringify(patch));
  for(const patch of [{id:'cmp_forged'},{revision:-1},{revision:0.5},{revision:Number.MAX_SAFE_INTEGER},{requestKey:[]},{sellerId:'seller_bob'},{environment:'production'}])assert.equal((await f.merchant(base+'/campaigns',{id:null,revision:0,requestKey:key(),values:campaignDraft(),...patch},{method:'POST'})).status,422);
  for(const body of ['{"id":null,"id":null}',new Uint8Array([123,34,120,34,58,34,255,34,125])])assert.equal((await f.mf.dispatchFetch('https://api.fixture.test'+base+'/campaigns',{method:'POST',headers,body})).status,400);
  const stream=new ReadableStream({start(c){c.enqueue(new TextEncoder().encode(JSON.stringify({x:'x'.repeat(32001)})));c.close();}});
  assert.equal((await f.mf.dispatchFetch('https://api.fixture.test'+base+'/campaigns',{method:'POST',headers,body:stream,duplex:'half'})).status,413);
  for(const path of ['/campaigns?state=all&state=active','/campaigns?environment=production','/campaigns?month=2026-13','/campaigns?cursor=bad'])assert.equal((await f.merchant(base+path)).status,422);
  assert.equal((await f.merchant(base+'/campaigns?state=active',{id:null,revision:0,requestKey:key(),values:campaignDraft()},{method:'POST'})).status,405);
  assert.equal((await f.mf.dispatchFetch('https://api.fixture.test'+base+'/campaigns')).status,401);assert.equal(await count(f,'commerce_campaigns'),0);
});

test('campaign lists keep a creation boundary and calendar filtering uses the saved store timezone',async t=>{
  const f=await setupCommerceFixture(t);for(let i=0;i<27;i++)assert.equal((await save(f,campaignDraft({name:'Draft '+i,plannedAt:'2026-09-30T16:30:00.000Z'}))).status,200);
  const page=await f.merchant(base+'/campaigns'),ids=page.items.map(r=>r.id);assert.equal(ids.length,25);assert(page.nextCursor);
  assert.equal((await save(f,campaignDraft({name:'New after page'}))).status,200);
  const tail=await f.merchant(base+'/campaigns?cursor='+page.nextCursor);assert.equal(tail.items.length,2);assert.equal(new Set([...ids,...tail.items.map(r=>r.id)]).size,27);assert.equal(tail.nextCursor,null);
  assert.equal((await f.merchant(base+'/campaigns?q=Draft&cursor='+page.nextCursor)).status,422);
  assert.equal((await f.merchant(base+'/campaigns?cursor='+page.nextCursor,undefined,{seller:'bob'})).status,422);
  assert.equal((await f.merchant(base+'/campaigns?month=2026-10')).items.length,0);assert.equal((await f.merchant(base+'/campaigns?month=2026-09')).items.length,25);
  const profile=(await f.merchant('/v1/commerce/settings')).profile.values;assert.equal((await f.merchant('/v1/commerce/settings',{kind:'profile',revision:0,requestKey:key(),values:{...profile,timezone:'Asia/Jayapura'}},{method:'POST'})).status,200);
  assert.equal((await f.merchant(base+'/campaigns?month=2026-10')).items.length,25);assert.equal((await f.merchant(base+'/campaigns?month=2026-09')).items.length,0);
});

test('immutable campaign history preserves its revision boundary, and the change limit permits an original replay',async t=>{
  const f=await setupCommerceFixture(t),requestKey=key(),first=await save(f,campaignDraft(),null,0,requestKey),id=first.campaign.id;
  for(let i=1;i<23;i++)assert.equal((await save(f,campaignDraft({name:'Version '+(i+1)}),id,i)).status,200);
  const firstPage=await f.merchant(base+'/campaigns/'+id+'/history');assert.equal(firstPage.items.length,20);assert.equal(firstPage.items[0].revision,23);
  for(let i=23;i<30;i++)assert.equal((await save(f,campaignDraft({name:'Version '+(i+1)}),id,i)).status,200);
  const second=await f.merchant(base+'/campaigns/'+id+'/history?cursor='+firstPage.nextCursor);assert.deepEqual(second.items.map(x=>x.revision),[3,2,1]);assert.equal(second.nextCursor,null);
  assert.equal((await save(f,campaignDraft(),id,30)).status,429);assert.equal((await save(f,campaignDraft(),null,0,requestKey)).status,200);assert.equal(await count(f,'commerce_campaign_changes'),30);
});

test('database guards prevent projection replacement, receipt rewriting, malformed date shape and a membership race',async t=>{
  const f=await setupCommerceFixture(t),one=await save(f),id=one.campaign.id;assert.equal((await save(f,campaignDraft({name:'Version two'}),id,1)).status,200);
  for(const sql of ["UPDATE commerce_campaigns SET revision=99","DELETE FROM commerce_campaigns","INSERT OR REPLACE INTO commerce_campaigns SELECT * FROM commerce_campaigns",
    "INSERT OR REPLACE INTO commerce_campaigns(id,seller_id,commerce_environment,revision,data_json,created_at,updated_at) SELECT campaign_id,seller_id,commerce_environment,revision,data_json,created_at,created_at FROM commerce_campaign_changes WHERE revision=1",
    "UPDATE commerce_campaign_changes SET request_hash='x'","DELETE FROM commerce_campaign_changes","INSERT OR REPLACE INTO commerce_campaign_changes SELECT * FROM commerce_campaign_changes"])
    await assert.rejects(f.db.prepare(sql).run(),/campaign_/);
  for(const values of [(()=>{const v=campaignDraft();delete v.plannedAt;return v;})(),campaignDraft({plannedAt:'not a date'}),campaignDraft({audience:{...campaignDraft().audience,extra:'forged'}})])await assert.rejects(f.db.prepare("INSERT INTO commerce_campaign_changes(actor_id,request_key,request_hash,campaign_id,seller_id,commerce_environment,expected_revision,revision,data_json,created_at) VALUES('alice',?,?,?,'seller_alice','sandbox',2,3,?,?)").bind(key(),'a'.repeat(64),id,JSON.stringify(values),new Date().toISOString()).run(),/campaign_values_invalid/);
  let removed=false;const db=new Proxy(f.db,{get(target,property){if(property==='prepare')return sql=>{const statement=target.prepare(sql);if(!sql.startsWith('INSERT INTO commerce_campaign_changes'))return statement;return {bind(...values){return {async run(){removed=true;await target.prepare("DELETE FROM seller_memberships WHERE auth_user_id='alice'").run();return statement.bind(...values).run();}};}};};const value=Reflect.get(target,property);return typeof value==='function'?value.bind(target):value;}});
  await assert.rejects(saveCampaign({DB:db,APP_ENVIRONMENT:'test'},actor,{id,revision:2,requestKey:key(),values:campaignDraft()}),e=>e.status===403);assert(removed);assert.equal(await count(f,'commerce_campaign_changes'),2);
});

test('audience previews use actual filters and account/address-specific consent, including current withdrawals',async t=>{
  const f=await setupCommerceFixture(t);await f.product('campaign_tea',1000);const buyers=[{id:'campaign-buyer-a',email:'a@example.test'},{id:'campaign-buyer-b',email:'b@example.test'},{id:'campaign-buyer-c',email:'c@example.test'}];
  for(const buyer of buyers){const made=await f.create(f.input({items:[{productId:'campaign_tea',quantity:1,expectedPrice:20000,expectedWeightGrams:100}],customer:{name:buyer.id,email:buyer.email,phone:'081234567890',authUserId:buyer.id}}));assert.equal(made.status,200,made.error);assert.equal((await f.paid(made.order)).status,200);}
  const consent=(buyer,revision,allow)=>f.call('/internal/commerce/customer-consents',{environment:'sandbox',customer:buyer,action:'save',sellerId:'seller_alice',email:buyer.email,revision,allow,requestKey:key(),policyVersion:'email-promotions-v1',statement:`I agree to receive promotional emails from alice at ${buyer.email}. I can stop these emails in Email preferences at any time. This choice does not affect order and delivery updates.`});
  assert.equal((await consent(buyers[0],0,true)).status,200);assert.equal((await consent(buyers[1],0,false)).status,200);
  const preview=filters=>f.merchant(base+'/audience',{filters},{method:'POST'});let result=await preview({});assert.deepEqual(result.summary,{matching:3,granted:1,withdrawn:1,unrecorded:1});assert.equal(result.items.length,3);
  assert.equal((await preview({q:'a@example.test',minSpend:'20000',maxOrders:'1'})).summary.granted,1);assert.equal((await preview({activity:'repeat'})).summary.matching,0);
  await f.db.prepare("UPDATE customers SET consent_json='{\"email\":true}',auth_user_id='forged'").run();assert.deepEqual((await preview({})).summary,result.summary);
  assert.equal((await consent(buyers[0],1,false)).status,200);assert.equal((await preview({})).summary.granted,0);
  assert.equal((await f.merchant(base+'/audience',{filters:{}},{seller:'bob',method:'POST'})).summary.matching,0);assert.equal(await count(f,'commerce_email_requests'),0);
});
