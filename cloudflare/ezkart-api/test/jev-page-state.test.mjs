import test from 'node:test';
import assert from 'node:assert/strict';
import {setupCommerceFixture} from './commerce-fixture.mjs';
import {seedJevPageRevision,beginJevPageWrite,finishJevPageWrite,putJevPage} from '../src/jev-page-state.js';
const seller='seller_alice', path=id=>`sellers/${seller}/landing-pages/${id}.json`;
const conflict=error=>error instanceof Response && error.status===409;
async function fixture(t){const f=await setupCommerceFixture(t);return {...f,env:{DB:f.db,PRIVATE_ASSETS:await f.mf.getR2Bucket('PRIVATE_ASSETS')}};}
async function review(db,id,revision){
 await db.prepare("INSERT INTO jev_cases VALUES(?,?,'notebook','alice',0,'reviewer',?,'hash','2026-09-28','2026-10-03')").bind(id,seller,id).run();
 return db.prepare("INSERT INTO jev_reviews VALUES(?,?,0,?,'hash',?,'{}','','jev-beta-policy-v1','reviewer','2026-09-28')").bind(id,id,id,revision).run();
}
const archive=(db,id,revision)=>db.prepare("INSERT INTO jev_page_actions(id,seller_id,page_id,review_id,revision,target_revision,action,actor_kind,actor_id,request_key,request_hash,reason,created_at) VALUES(?,?,'notebook','review',?,?,'archive','reviewer','reviewer',?,'hash','Fixture action','2026-09-28')").bind(id,seller,revision,revision,id).run();

test('save fence atomically rejects reviewed revision during and after a concurrent R2 write',async t=>{
 const f=await fixture(t),{env}=f;
 const original=await env.PRIVATE_ASSETS.put(path('notebook'),'original');
 await seedJevPageRevision(env,seller,'notebook',original.etag);await review(f.db,'review',original.etag);
 const token=await beginJevPageWrite(env,seller,'notebook',original.etag);
 await assert.rejects(archive(f.db,'during',original.etag),/jev_page_revision_changed/);
 await assert.rejects(beginJevPageWrite(env,seller,'notebook',original.etag),conflict);
 await assert.rejects(review(f.db,'snapshot-raced',original.etag),/jev_page_revision_changed/);
 const next=await env.PRIVATE_ASSETS.put(path('notebook'),'corrected',{onlyIf:{etagMatches:original.etag},customMetadata:{jevWriteToken:token}});
 await finishJevPageWrite(env,seller,'notebook',token,next.etag);
 await assert.rejects(archive(f.db,'after',original.etag),/jev_page_revision_changed/);
 await assert.rejects(seedJevPageRevision(env,seller,'notebook',original.etag),conflict);
 assert.equal((await f.db.prepare('SELECT COUNT(*) AS n FROM jev_page_actions').first()).n,0);
 await seedJevPageRevision(env,seller,'notebook',next.etag);
 // An archive already committed before a save remains held after a correction.
 await f.db.prepare("INSERT INTO jev_page_actions(id,seller_id,page_id,review_id,revision,target_revision,action,actor_kind,actor_id,request_key,request_hash,reason,created_at) VALUES('current',?,'notebook','review',?,?,'archive','reviewer','reviewer','current','hash','Fixture','2026-09-28')").bind(seller,original.etag,next.etag).run();
 await putJevPage(env,seller,'notebook',next.etag,'another correction');
 assert.equal((await f.db.prepare('SELECT COUNT(*) AS n FROM jev_page_holds').first()).n,1);
});

test('lost R2 acknowledgement recovers only the original stored token; uncertain uncommitted saves cannot expire open',async t=>{
 const f=await fixture(t),{env}=f,bucket=env.PRIVATE_ASSETS;
 const lost={...env,PRIVATE_ASSETS:{head:k=>bucket.head(k),put:async(...args)=>{await bucket.put(...args);throw Error('lost acknowledgement');}}};
 await assert.rejects(putJevPage(lost,seller,'receipt','','saved'),/lost acknowledgement/);
 const saved=await bucket.head(path('receipt'));
 assert.ok((await f.db.prepare("SELECT write_token FROM jev_page_revisions WHERE page_id='receipt'").first()).write_token);
 await seedJevPageRevision(env,seller,'receipt',saved.etag);
 assert.equal((await f.db.prepare("SELECT write_token FROM jev_page_revisions WHERE page_id='receipt'").first()).write_token,null);
 const next=await putJevPage(env,seller,'receipt',saved.etag,'next');assert.notEqual(next.etag,saved.etag);
 const unknown={...env,PRIVATE_ASSETS:{head:k=>bucket.head(k),put:async()=>{throw Error('outcome unknown');}}};
 await assert.rejects(putJevPage(unknown,seller,'uncertain','','not known'),/outcome unknown/);
 await f.db.prepare("UPDATE jev_page_revisions SET write_started_at='2000-01-01' WHERE page_id='uncertain'").run();
 await assert.rejects(beginJevPageWrite(env,seller,'uncertain',''),conflict);
 assert.equal(await bucket.head(path('uncertain')),null);
});

test('ordinary merchant create/save uses conditional storage and advances the shared revision',async t=>{
 const f=await fixture(t),{env}=f;
 assert.equal((await f.merchant('/v1/landing-pages/fenced',{name:'Original',status:'draft',state:{value:1}})).status,200);
 const first=await env.PRIVATE_ASSETS.head(path('fenced'));assert.ok(first.customMetadata.jevWriteToken);
 assert.equal((await f.merchant('/v1/landing-pages/fenced',{name:'Updated',status:'draft',state:{value:2}})).status,200);
 const next=await env.PRIVATE_ASSETS.head(path('fenced'));
 assert.notEqual(first.etag,next.etag);
 const row=await f.db.prepare("SELECT * FROM jev_page_revisions WHERE page_id='fenced'").first();assert.equal(row.current_revision,next.etag);assert.equal(row.write_token,null);
 assert.equal(JSON.parse(await (await env.PRIVATE_ASSETS.get(path('fenced'))).text()).name,'Updated');
 assert.equal((await f.merchant('/v1/landing-pages/fenced',undefined,{method:'DELETE'})).status,200);
 assert.equal(await env.PRIVATE_ASSETS.head(path('fenced')),null);
 assert.equal((await f.merchant('/v1/landing-pages/fenced',{name:'Recreated',status:'draft'})).status,200);
 const recreated=await env.PRIVATE_ASSETS.head(path('fenced'));
 // Direct storage mutation is outside the supported write path; stale CAS never overwrites it.
 const result=await env.PRIVATE_ASSETS.put(path('fenced'),'operator bypass');
 await assert.rejects(putJevPage(env,seller,'fenced',recreated.etag,'stale overwrite'),conflict);
 assert.equal((await env.PRIVATE_ASSETS.head(path('fenced'))).etag,result.etag);
 const occupied=await env.PRIVATE_ASSETS.put(path('create-conflict'),'already exists');
 await assert.rejects(putJevPage(env,seller,'create-conflict','','must not replace'),conflict);
 assert.equal((await env.PRIVATE_ASSETS.head(path('create-conflict'))).etag,occupied.etag);
});
