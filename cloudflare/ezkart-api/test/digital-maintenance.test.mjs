import test from 'node:test';
import assert from 'node:assert/strict';
import {randomBytes} from 'node:crypto';
import {setupCommerceFixture as setup,digest} from './commerce-fixture.mjs';
import {applyCommerceSchema} from './commerce-schema.mjs';
import {digitalFixtureFile} from './digital-commerce-fixture.mjs';
import {beginDigitalUpload,uploadDigitalPart,completeDigitalUpload,cleanupDigitalUploads,digitalVersionStatements} from '../src/digital-files.js';
import {digitalStorageReportSql,digitalStorageWarnings} from '../src/digital-file-maintenance.js';
import {main as inspect} from '../../../tools/commerce/digital-storage-report.mjs';
const actor={sellerId:'seller_alice',id:'alice',role:'owner'},future=(hours=48)=>new Date(Date.now()+hours*3600000).toISOString();
const mode=async f=>({DB:f.db,PRIVATE_ASSETS:await f.mf.getR2Bucket('PRIVATE_ASSETS')});
async function pending(f,ready=false){
  const env=await mode(f),bytes=Buffer.from('Unpublished private original'),upload=await beginDigitalUpload(env,actor,{requestKey:randomBytes(16).toString('hex'),filename:'Private name.pdf',size:bytes.length,parts:[digest(bytes)]});
  if(ready){await uploadDigitalPart(env,actor,upload.id,1,new Request('https://fixture.test',{method:'PUT',body:bytes,headers:{'content-type':'application/octet-stream'}}));await completeDigitalUpload(env,actor,upload.id);}
  return f.db.prepare('SELECT * FROM digital_file_uploads WHERE id=?').bind(upload.id).first();
}
const report=async(f,now)=>JSON.parse((await f.db.prepare(digitalStorageReportSql).bind(now).first()).report);

test('failed cleanup retains a bounded retry, continues through other files and preserves published purchase bytes',async t=>{
  const f=await setup(t),env=await mode(f),file=await digitalFixtureFile(f),created=await f.create(f.input({items:[file.item],shipping:{kind:'none',amount:0,skipped:false}}));
  assert.equal(created.status,200);assert.equal((await f.paid(created.order)).status,200);
  const original=await f.db.prepare('SELECT * FROM digital_file_uploads WHERE id=?').bind(file.uploadId).first();
  const accounting=(await f.db.prepare('SELECT * FROM commerce_financial_entries ORDER BY journal_sequence,line_number').all()).results;
  const files=[];for(let i=0;i<6;i++)files.push(await pending(f));const now=future();
  const first=files[0],bucket=new Proxy(env.PRIVATE_ASSETS,{get(target,k){if(k==='delete')return async key=>{if(key===first.r2_key)throw Error('Private provider key and filename must never reach the report');return target.delete(key);};return typeof target[k]==='function'?target[k].bind(target):target[k];}});
  assert.deepEqual(await cleanupDigitalUploads({...env,PRIVATE_ASSETS:bucket},now),{removed:4,failed:1,skipped:false});
  let r=await report(f,now);assert.equal(r.lastRun.state,'partial');assert.equal(r.eligibleCleanup,2);assert.equal(r.dueCleanup,1);assert.equal(r.deferredCleanup,1);assert.equal(r.unconfirmedCleanup,1);assert.equal(r.retainedFiles,1);assert.equal(r.retainedBytes,String(file.bytes.length));
  assert.deepEqual(digitalStorageWarnings(r),['maintenance_incomplete','cleanup_retries_pending']);
  assert(!JSON.stringify(r).match(/Private name|dupl_|dfile_|seller_alice|r2_key|provider key/));
  assert.deepEqual(await cleanupDigitalUploads({...env,PRIVATE_ASSETS:bucket},now),{removed:1,failed:0,skipped:false});
  let state=await f.db.prepare('SELECT * FROM digital_file_uploads WHERE id=?').bind(first.id).first();assert.equal(state.cleanup_attempts,1);assert.equal(state.state,'deleting');
  const later=new Date(Date.parse(now)+3600000).toISOString();assert.deepEqual(await cleanupDigitalUploads(env,later),{removed:1,failed:0,skipped:false});
  state=await f.db.prepare('SELECT * FROM digital_file_uploads WHERE id=?').bind(first.id).first();assert.equal(state.cleanup_attempts,2);assert.equal(state.state,'deleted');assert.equal(state.cleanup_error_code,null);assert.equal(state.cleanup_retry_after,null);
  r=await report(f,later);assert.equal(r.eligibleCleanup,0);assert.deepEqual(digitalStorageWarnings(r),[]);
  assert.deepEqual(await f.db.prepare('SELECT * FROM digital_file_uploads WHERE id=?').bind(file.uploadId).first(),original);
  assert.deepEqual(Buffer.from(await(await env.PRIVATE_ASSETS.get(original.r2_key)).arrayBuffer()),file.bytes);
  assert.deepEqual((await f.db.prepare('SELECT * FROM commerce_financial_entries ORDER BY journal_sequence,line_number').all()).results,accounting);
});

test('the cleanup lease serializes overlapping runs and a lost claim acknowledgement recovers after expiry',async t=>{
  const f=await setup(t),env=await mode(f),row=await pending(f),now=future();
  let enteredResolve,release;const entered=new Promise(r=>enteredResolve=r),hold=new Promise(r=>release=r);t.after(()=>release());
  const bucket=new Proxy(env.PRIVATE_ASSETS,{get(target,k){if(k==='delete')return async key=>{enteredResolve();await hold;return target.delete(key);};return typeof target[k]==='function'?target[k].bind(target):target[k];}});
  const first=cleanupDigitalUploads({...env,PRIVATE_ASSETS:bucket},now);await entered;
  assert.deepEqual(await cleanupDigitalUploads(env,now),{removed:0,failed:0,skipped:true});release();assert.equal((await first).removed,1);
  assert.equal((await f.db.prepare('SELECT cleanup_attempts FROM digital_file_uploads WHERE id=?').bind(row.id).first()).cleanup_attempts,1);
  const next=await pending(f),later=new Date(Date.parse(now)+3600000).toISOString();
  const DB=new Proxy(f.db,{get(target,k){if(k==='prepare')return sql=>{const s=target.prepare(sql);if(!sql.startsWith('INSERT INTO digital_file_maintenance'))return s;return {bind(...values){const b=s.bind(...values);return {first:async()=>{await b.first();throw Error('Lost claim acknowledgement');}};}};};return typeof target[k]==='function'?target[k].bind(target):target[k];}});
  await assert.rejects(cleanupDigitalUploads({...env,DB},later),/Lost claim acknowledgement/);
  assert.equal((await cleanupDigitalUploads(env,later)).skipped,true);
  const expired=new Date(Date.parse(later)+20*60000).toISOString();assert.deepEqual(digitalStorageWarnings(await report(f,expired)),['maintenance_interrupted']);
  assert.equal((await cleanupDigitalUploads(env,expired)).removed,1);assert.equal((await f.db.prepare('SELECT state FROM digital_file_uploads WHERE id=?').bind(next.id).first()).state,'deleted');
});

test('publication between selection and deletion preserves the file, and an uncertain R2 delete retries safely',async t=>{
  const f=await setup(t),env=await mode(f),file=await pending(f,true),now=future(8*24);
  await f.db.prepare("INSERT INTO products(id,seller_id,type,status,title,sku,price_amount,digital_filename,created_at,updated_at) VALUES ('new-guide','seller_alice','digital','active','Private guide','NEW',25000,'Private name.pdf','now','now')").run();
  const DB=new Proxy(f.db,{get(target,k){if(k==='prepare')return sql=>{const s=target.prepare(sql);if(!sql.startsWith('SELECT u.* FROM digital_file_uploads u WHERE'))return s;return {bind(...values){const b=s.bind(...values);return {all:async()=>{const rows=await b.all();await f.db.batch(digitalVersionStatements(env,'seller_alice','alice','new-guide',{id:file.id},new Date().toISOString()));return rows;}};}};};return typeof target[k]==='function'?target[k].bind(target):target[k];}});
  assert.deepEqual(await cleanupDigitalUploads({...env,DB},now),{removed:0,failed:0,skipped:false});assert.ok(await env.PRIVATE_ASSETS.head(file.r2_key));
  const uncertain=await pending(f,true),bucket=new Proxy(env.PRIVATE_ASSETS,{get(target,k){if(k==='delete')return async key=>{await target.delete(key);throw Error('Lost deletion response');};return typeof target[k]==='function'?target[k].bind(target):target[k];}});
  assert.equal((await cleanupDigitalUploads({...env,PRIVATE_ASSETS:bucket},now)).failed,1);assert.equal(await env.PRIVATE_ASSETS.head(uncertain.r2_key),null);
  assert.equal((await f.db.prepare('SELECT state FROM digital_file_uploads WHERE id=?').bind(uncertain.id).first()).state,'deleting');
  assert.equal((await cleanupDigitalUploads(env,new Date(Date.parse(now)+3600000).toISOString())).removed,1);
  assert.ok(await env.PRIVATE_ASSETS.head(file.r2_key));
});

test('storage inspection is read-only, TEST-only, exact about recorded bytes and explicit about missing or failed maintenance',async t=>{
  const f=await setup(t),env=await mode(f),now=new Date().toISOString(),queries=[];
  const query=async sql=>{queries.push(sql);return(await f.db.prepare(sql).all()).results;};
  const missing=await inspect(['--fail-on-warning'],query,now);assert.equal(missing.exitCode,2);assert.deepEqual(missing.warnings,['maintenance_not_observed']);assert.equal(missing.retainedBytes,'0');
  for(const args of [['--env','production'],['--delete'],['--fail-on-warning','--fail-on-warning']])await assert.rejects(inspect(args,query,now),/Usage/);
  await assert.rejects(inspect([],query,"2026-09-27T00:00:00.000Z'; DELETE FROM sellers;"),/time is invalid/);assert.equal(queries.length,1);
  const failedDB=new Proxy(f.db,{get(target,k){if(k==='prepare')return sql=>{if(sql.startsWith('SELECT u.* FROM digital_file_uploads u WHERE'))throw Error('Database read failed');return target.prepare(sql);};return typeof target[k]==='function'?target[k].bind(target):target[k];}});
  await assert.rejects(cleanupDigitalUploads({...env,DB:failedDB},now),/did not complete/);assert.equal((await report(f,now)).lastRun.state,'failed');
  assert.equal((await cleanupDigitalUploads(env,now)).removed,0);const result=await inspect(['--fail-on-warning'],query,now);assert.equal(result.exitCode,0);assert.deepEqual(result.warnings,[]);assert.equal(result.readOnly,true);assert.equal(result.deployment,'test');
  const late=new Date(Date.parse(now)+3*3600000).toISOString();assert.deepEqual((await inspect([],query,late)).warnings,['maintenance_overdue']);
  assert.equal((await f.db.prepare('SELECT COUNT(*) AS n FROM digital_file_maintenance').first()).n,1);
  for(const sql of queries)assert.match(sql,/^WITH eligible AS/);
});

test('the maintenance migration preserves existing uploads, parts and immutable purchase versions',async t=>{
  const f=await setup(t,{through:46}),file=await digitalFixtureFile(f),tables=['digital_file_uploads','digital_file_parts','digital_product_versions','digital_product_files'];
  const before=await Promise.all(tables.map(async table=>(await f.db.prepare('SELECT * FROM '+table).all()).results));
  await applyCommerceSchema(f.db,46,47);
  for(let i=0;i<tables.length;i++){
    const after=(await f.db.prepare('SELECT * FROM '+tables[i]).all()).results;
    assert.deepEqual(after.map(row=>Object.fromEntries(Object.keys(before[i][0]).map(k=>[k,row[k]]))),before[i]);
  }
  const row=await f.db.prepare('SELECT cleanup_attempts,cleanup_attempted_at,cleanup_retry_after,cleanup_error_code FROM digital_file_uploads WHERE id=?').bind(file.uploadId).first();
  assert.deepEqual(row,{cleanup_attempts:0,cleanup_attempted_at:null,cleanup_retry_after:null,cleanup_error_code:null});
  assert.deepEqual((await f.db.prepare('PRAGMA foreign_key_check').all()).results,[]);
});

test('a full five-file maintenance batch fits a bounded D1 query budget',async t=>{
  const f=await setup(t),env=await mode(f);for(let i=0;i<5;i++)await pending(f);
  let queries=0;const DB=new Proxy(f.db,{get(target,k){if(k==='prepare')return sql=>{queries++;return target.prepare(sql);};return typeof target[k]==='function'?target[k].bind(target):target[k];}});
  assert.deepEqual(await cleanupDigitalUploads({...env,DB},future()),{removed:5,failed:0,skipped:false});
  assert.ok(queries<=19,'Maintenance must fit its D1 budget: '+queries);
});
