import test from 'node:test';
import assert from 'node:assert/strict';
import {setupCommerceFixture} from './commerce-fixture.mjs';
import {applyCommerceSchema} from './commerce-schema.mjs';
import {campaignUnsubscribe,prepareCampaignUnsubscribe} from '../src/campaign-unsubscribe.js';
import {grantCampaignConsent,prepareUnsubscribeFixture,unsubscribeFixtureOrder,unsubscribeBuyer as buyer,unsubscribeEnvironment as env,unsubscribeKey as key} from './campaign-unsubscribe-fixture.mjs';
const base='/v1/public/campaign-unsubscribe',confirm='List-Unsubscribe=One-Click',formType='application/x-www-form-urlencoded';
const count=async(f,t)=>(await f.db.prepare('SELECT COUNT(*) AS n FROM '+t).first()).n;
async function fixture(t){const f=await setupCommerceFixture(t);await unsubscribeFixtureOrder(f);const original=await grantCampaignConsent(f),link=await prepareUnsubscribeFixture(f);await link.statement.run();return {...f,link,original};}
async function request(f,path=f.link.path,{method='GET',body,headers={}}={}){const response=await f.mf.dispatchFetch('https://api.fixture.test'+path,{method,headers,...(body===undefined?{}:{body})});return {status:response.status,headers:response.headers,data:method==='HEAD'?await response.text():await response.json()};}
const withdraw=(f,path=f.link.path)=>request(f,path,{method:'POST',body:confirm,headers:{'content-type':formType}});
const preference=f=>f.call('/internal/commerce/customer-consents',{environment:'sandbox',customer:buyer,action:'list'});

test('GET and HEAD are read-only; a capability POST withdraws exactly once without sign-in and updates real audience/history',async t=>{
 const f=await fixture(t),peek=await request(f);assert.equal(peek.status,200);assert.equal(peek.data.unsubscribed,false);assert.equal(peek.data.emailHint,'b•••@example.test');assert(!JSON.stringify(peek.data).includes(buyer.id));assert(!JSON.stringify(peek.data).includes(buyer.email));assert(!JSON.stringify(peek.data).includes(f.link.token));
 assert.match(peek.headers.get('cache-control'),/no-store/);assert.equal(peek.headers.get('referrer-policy'),'no-referrer');assert.equal((await request(f,undefined,{method:'HEAD'})).data,'');assert.equal(await count(f,'commerce_unsubscribe_changes'),0);
 const both=await Promise.all([withdraw(f),withdraw(f)]);assert(both.every(r=>r.status===200&&r.data.unsubscribed),JSON.stringify(both));assert.equal(await count(f,'commerce_unsubscribe_changes'),1);assert.equal((await preference(f)).items[0].revision,2);
 assert.equal((await withdraw(f)).data.changed,false);assert.equal((await request(f)).data.unsubscribed,true);assert.equal(await count(f,'commerce_customer_consent_changes'),1);
 const history=await f.call('/internal/commerce/customer-consents',{environment:'sandbox',customer:buyer,action:'history',sellerId:'seller_alice',email:buyer.email});assert.deepEqual(history.items.map(v=>[v.revision,v.state,v.source]),[[2,'withdrawn','email_unsubscribe'],[1,'granted','buyer_preferences']]);
 const audience=await f.merchant('/v1/commerce/marketing/audience',{filters:{}},{method:'POST'});assert.deepEqual(audience.summary,{matching:1,granted:0,withdrawn:1,unrecorded:0});assert.equal(await count(f,'commerce_email_requests'),0);
});

test('standard URL-encoded and multipart one-click forms work, while duplicates, extra fields, malformed input and oversized bodies cannot withdraw',async t=>{
 const f=await fixture(t);
 for(const [body,type] of [['','text/plain'],['List-Unsubscribe=One-Click&List-Unsubscribe=One-Click',formType],['List-Unsubscribe=One-Click&sellerId=seller_bob',formType],['List-Unsubscribe=Subscribe',formType],['{"List-Unsubscribe":"One-Click"}','application/json'],[new Uint8Array([255]),formType],['junk','multipart/form-data; boundary=x']])assert([400,415].includes((await request(f,undefined,{method:'POST',body,headers:{'content-type':type}})).status));
 const multi=new FormData();multi.append('List-Unsubscribe','One-Click');multi.append('List-Unsubscribe','One-Click');let raw=new Request('https://fixture.test',{method:'POST',body:multi});assert.equal((await request(f,undefined,{method:'POST',body:new Uint8Array(await raw.arrayBuffer()),headers:{'content-type':raw.headers.get('content-type')}})).status,400);
 const file=new FormData();file.append('List-Unsubscribe',new Blob(['One-Click']),'directive.txt');raw=new Request('https://fixture.test',{method:'POST',body:file});assert.equal((await request(f,undefined,{method:'POST',body:new Uint8Array(await raw.arrayBuffer()),headers:{'content-type':raw.headers.get('content-type')}})).status,400);
 const stream=new ReadableStream({start(c){c.enqueue(new TextEncoder().encode('x'.repeat(8193)));c.close();}});const response=await f.mf.dispatchFetch('https://api.fixture.test'+f.link.path,{method:'POST',headers:{'content-type':formType},body:stream,duplex:'half'});assert.equal(response.status,413);assert.equal(await count(f,'commerce_unsubscribe_changes'),0);
 const valid=new FormData();valid.append('List-Unsubscribe','One-Click');raw=new Request('https://fixture.test',{method:'POST',body:valid});assert.equal((await request(f,undefined,{method:'POST',body:new Uint8Array(await raw.arrayBuffer()),headers:{'content-type':raw.headers.get('content-type')}})).status,200);assert.equal(await count(f,'commerce_unsubscribe_changes'),1);
});

test('tokens are opaque, store/address/account/environment scoped, and never use a cookie or supplied identity to select a target',async t=>{
 const f=await fixture(t),other={id:'other-customer',email:'another@example.test'};await unsubscribeFixtureOrder(f,other);await grantCampaignConsent(f,{buyer:other});
 for(const path of [base,base+'?t=bad',base+'?t='+'0'.repeat(64),f.link.path+'&t='+f.link.token,f.link.path+'&environment=production',f.link.path+'&sellerId=seller_bob'])assert.equal((await request(f,path)).status,404,path);
 const wrong=await request(f,undefined,{method:'PUT',body:confirm,headers:{'content-type':formType}});assert.equal(wrong.status,405);assert.equal(wrong.headers.get('allow'),'GET, HEAD, POST');
 await assert.rejects(campaignUnsubscribe({...env(f),APP_ENVIRONMENT:'production'},new Request('https://api.fixture.test'+f.link.path)),e=>e.status===404);
 const result=await request(f,undefined,{method:'POST',body:confirm,headers:{'content-type':formType,cookie:'ezkart_admin=another-account',authorization:'Bearer forged','x-ezkart-marketing-store':'seller_bob',origin:'https://mail.example.test'}});assert.equal(result.status,200);assert.equal((await preference(f)).items[0].state,'withdrawn');
 const others=await f.call('/internal/commerce/customer-consents',{environment:'sandbox',customer:other,action:'list'});assert.equal(others.items[0].state,'granted');assert.equal(await count(f,'commerce_unsubscribe_changes'),1);
});

test('old links remain useful after a new explicit grant, and old grant replays never restore withdrawn permission',async t=>{
 const f=await fixture(t);assert.equal((await withdraw(f)).status,200);await grantCampaignConsent(f,{revision:2});assert.equal((await request(f)).data.unsubscribed,false);assert.equal((await withdraw(f)).status,200);
 const replay=await f.call('/internal/commerce/customer-consents',f.original.input);assert.equal(replay.receipt.state,'granted');assert.equal(replay.preference.state,'withdrawn');assert.equal(replay.preference.revision,4);assert.equal(await count(f,'commerce_unsubscribe_changes'),2);
 const history=await f.call('/internal/commerce/customer-consents',{environment:'sandbox',customer:buyer,action:'history',sellerId:'seller_alice',email:buyer.email});assert.deepEqual(history.items.map(r=>r.revision),[4,3,2,1]);
});

test('withdrawals still work during commerce/email holds, for inactive stores and after the account address changes',async t=>{
 const f=await fixture(t);await f.db.prepare("UPDATE sellers SET status='suspended' WHERE id='seller_alice'").run();
 const result=await campaignUnsubscribe({...env(f),COMMERCE_STORAGE:'legacy',COMMERCE_EMAIL_SEND:'off'},new Request('https://api.fixture.test'+f.link.path,{method:'POST',headers:{'content-type':formType},body:confirm}));assert.equal(result.unsubscribed,true);
 const changed=await f.call('/internal/commerce/customer-consents',{environment:'sandbox',customer:{...buyer,email:'new@example.test'},action:'list'});assert.equal(changed.items.find(r=>r.email===buyer.email).state,'withdrawn');assert.equal(changed.items.find(r=>r.email==='new@example.test').state,'not_recorded');
});

test('token creation needs current permission and remains atomic with a failed immutable message write',async t=>{
 const f=await setupCommerceFixture(t);await unsubscribeFixtureOrder(f);
 const missing=await prepareUnsubscribeFixture(f);await assert.rejects(missing.statement.run(),/unsubscribe_permission_required/);await grantCampaignConsent(f);
 const link=await prepareUnsubscribeFixture(f);await assert.rejects(f.db.batch([link.statement,f.db.prepare("INSERT INTO sellers(id,slug,name,created_at,updated_at) VALUES('seller_alice','duplicate','duplicate','now','now')")]),/UNIQUE/);assert.equal(await count(f,'commerce_unsubscribe_tokens'),0);
 const one=await prepareUnsubscribeFixture(f,{reference:'same-message'});await one.statement.run();const duplicate=await prepareUnsubscribeFixture(f,{reference:'same-message'});await assert.rejects(duplicate.statement.run(),/unsubscribe_token_immutable/);assert.equal(await count(f,'commerce_unsubscribe_tokens'),1);
 await grantCampaignConsent(f,{revision:1,allow:false});const stale=await prepareUnsubscribeFixture(f);await assert.rejects(stale.statement.run(),/unsubscribe_permission_required/);
 await assert.rejects(prepareCampaignUnsubscribe({...env(f),COMMERCE_STORAGE:'legacy'},{sellerId:'seller_alice',authUserId:buyer.id,email:buyer.email,reference:'another-message',consentRevision:1}),e=>e.status===503);
});

test('immutable receipts protect both consent sources from replacements and forged target or grant evidence',async t=>{
 const f=await fixture(t);await withdraw(f);
 for(const sql of ["DELETE FROM commerce_unsubscribe_tokens","UPDATE commerce_unsubscribe_tokens SET reference='changed'","INSERT OR REPLACE INTO commerce_unsubscribe_tokens SELECT * FROM commerce_unsubscribe_tokens","UPDATE commerce_unsubscribe_changes SET statement='changed'","DELETE FROM commerce_unsubscribe_changes","INSERT OR REPLACE INTO commerce_unsubscribe_changes SELECT * FROM commerce_unsubscribe_changes","INSERT OR REPLACE INTO commerce_customer_consents SELECT * FROM commerce_customer_consents",
  "INSERT OR REPLACE INTO commerce_customer_consents(seller_id,commerce_environment,auth_user_id,email,revision,allowed,policy_version,statement,updated_at) SELECT seller_id,commerce_environment,auth_user_id,email,revision,allowed,policy_version,statement,created_at FROM commerce_customer_consent_changes WHERE revision=1",
  "UPDATE commerce_customer_consents SET revision=3,allowed=1"])await assert.rejects(f.db.prepare(sql).run(),/unsubscribe_|consent_receipt_required/);
 await assert.rejects(f.db.prepare(`INSERT OR REPLACE INTO commerce_customer_consent_changes(seller_id,commerce_environment,auth_user_id,email,request_key,request_hash,expected_revision,revision,allowed,policy_version,statement,source,created_at)
  SELECT seller_id,commerce_environment,auth_user_id,email,request_key,request_hash,2,3,1,policy_version,statement,source,created_at FROM commerce_customer_consent_changes`).run(),/consent_history_immutable/);
 await assert.rejects(f.db.prepare("INSERT INTO commerce_unsubscribe_changes(id,token_hash,seller_id,commerce_environment,auth_user_id,email,expected_revision,revision,statement,created_at) VALUES(?,?,'seller_bob','sandbox',?,?,2,3,'forged',?)").bind('cuw_'+key(),f.link.tokenHash,buyer.id,buyer.email,new Date().toISOString()).run(),/unsubscribe_token_required/);
 assert.equal((await preference(f)).items[0].state,'withdrawn');
});

test('mixed permission history pages preserve their original revision boundary across grants and link withdrawals',async t=>{
 const f=await fixture(t);for(let n=1;n<=21;n++){assert.equal((await withdraw(f)).status,200);if(n<21)await grantCampaignConsent(f,{revision:n*2});}
 const input={environment:'sandbox',customer:buyer,action:'history',sellerId:'seller_alice',email:buyer.email},first=await f.call('/internal/commerce/customer-consents',input);assert.equal(first.items[0].revision,42);assert.equal(first.items.length,20);
 await grantCampaignConsent(f,{revision:42});await withdraw(f);const all=[...first.items];let cursor=first.nextCursor;while(cursor){const next=await f.call('/internal/commerce/customer-consents',{...input,cursor});assert.equal(next.status,200,next.error);all.push(...next.items);cursor=next.nextCursor;}
 assert.deepEqual(all.map(r=>r.revision),Array.from({length:42},(_,i)=>42-i));assert.equal(all.filter(r=>r.source==='email_unsubscribe').length,21);
});

test('migration preserves existing permission receipts and choices before combining account and email-link history',async t=>{
 const f=await setupCommerceFixture(t,{through:33});await unsubscribeFixtureOrder(f);const original=await grantCampaignConsent(f);await grantCampaignConsent(f,{revision:1,allow:false});await grantCampaignConsent(f,{revision:2});
 const tables=['commerce_customer_consents','commerce_customer_consent_changes'],before=await Promise.all(tables.map(table=>f.db.prepare('SELECT * FROM '+table).all()));
 await applyCommerceSchema(f.db,33,34);const after=await Promise.all(tables.map(table=>f.db.prepare('SELECT * FROM '+table).all()));assert.deepEqual(after.map(r=>r.results),before.map(r=>r.results));
 const link=await prepareUnsubscribeFixture(f,{revision:3});await link.statement.run();assert.equal((await withdraw(f,link.path)).status,200);const replay=await f.call('/internal/commerce/customer-consents',original.input);assert.equal(replay.receipt.revision,1);assert.equal(replay.preference.revision,4);assert.equal(replay.preference.state,'withdrawn');
 const history=await f.call('/internal/commerce/customer-consents',{environment:'sandbox',customer:buyer,action:'history',sellerId:'seller_alice',email:buyer.email});assert.deepEqual(history.items.map(r=>[r.revision,r.source]),[[4,'email_unsubscribe'],[3,'buyer_preferences'],[2,'buyer_preferences'],[1,'buyer_preferences']]);
});
