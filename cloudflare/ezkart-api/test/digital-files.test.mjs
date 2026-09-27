import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomBytes} from 'node:crypto';
import {setupCommerceFixture as setup,digest} from './commerce-fixture.mjs';
import {beginDigitalUpload,uploadDigitalPart,completeDigitalUpload,cancelDigitalUpload,digitalMerchantFile,digitalVersionStatements,cleanupDigitalUploads,digitalPartBytes} from '../src/digital-files.js';

const actor={sellerId:'seller_alice',id:'alice',role:'owner'};
async function client(f,path,body,{method=body===undefined?'GET':'POST',seller='alice',store='seller_'+seller,headers={}}={}){
  const binary=body instanceof Uint8Array;
  return f.mf.dispatchFetch('https://api.fixture.test/v1/digital-files'+path,{method,headers:{authorization:'Bearer '+await f.merchantToken(seller),
    'x-ezkart-file-store':store,'content-type':binary?'application/octet-stream':'application/json',...headers},...(body===undefined?{}:{body:binary?body:JSON.stringify(body)})});
}
async function call(f,path,body,options){const r=await client(f,path,body,options);return {status:r.status,...await r.json()};}
function manifest(bytes,extra={}){return {requestKey:randomBytes(16).toString('hex'),filename:'Complete guide.pdf',size:bytes.length,
  parts:Array.from({length:Math.ceil(bytes.length/digitalPartBytes)},(_,i)=>digest(bytes.subarray(i*digitalPartBytes,(i+1)*digitalPartBytes))),...extra};}
async function upload(f,bytes=Buffer.from('A private purchased guide'),extra={}){
  const input=manifest(bytes,extra),start=await call(f,'/uploads',input);assert.equal(start.status,200,start.error);
  const id=start.upload.id;
  for(let i=0;i<input.parts.length;i++)assert.equal((await call(f,`/uploads/${id}/parts/${i+1}`,bytes.subarray(i*digitalPartBytes,(i+1)*digitalPartBytes),{method:'PUT'})).status,200);
  const finish=await call(f,`/uploads/${id}/complete`,{});assert.equal(finish.status,200,finish.error);assert.equal(finish.upload.state,'ready');
  return {id,input,bytes,upload:finish.upload};
}
async function product(f,file,id='custom-digital'){
  const image='media_'+id;
  if(!await f.db.prepare('SELECT 1 FROM media_uploads WHERE id=?').bind(image).first()){
    await f.db.prepare("INSERT INTO media_uploads(id,seller_id,r2_key,mime_type,size_bytes,created_by_auth_user_id,created_at) VALUES (?,'seller_alice',?,'image/png',1,'alice','now')").bind(image,image).run();
    await (await f.mf.getR2Bucket('PUBLIC_ASSETS')).put(image,new Uint8Array([1]));
  }
  const old=(await f.merchant('/v1/catalog')).products.find(p=>p.id===id);
  return f.merchant('/v1/products/'+id,{id,name:'Private guide',type:'digital',price:25000,sku:'BOOK-'+id,imageUploadIds:[image],digitalUploadId:file,
    digitalFileName:'forged-name.html',...(old?{revision:old.revision}:{})});
}

test('private uploads resume verified chunks, reject changed bytes, finalize once and serve safe private ranges',async t=>{
  const f=await setup(t),bytes=Buffer.alloc(digitalPartBytes+37,97),input=manifest(bytes,{filename:'Panduan café.pdf'});
  const start=await call(f,'/uploads',input);assert.equal(start.status,200,start.error);const id=start.upload.id;
  assert.equal(start.upload.state,'uploading');assert(!JSON.stringify(start).includes('multipart_id'));assert(!JSON.stringify(start).includes('r2_key'));
  const part1=bytes.subarray(0,digitalPartBytes),part2=bytes.subarray(digitalPartBytes);
  assert.equal((await call(f,`/uploads/${id}/complete`,{})).status,409);
  assert.equal((await call(f,`/uploads/${id}/parts/1`,part2,{method:'PUT'})).code,'digital_part_size');
  assert.equal((await call(f,`/uploads/${id}/parts/2`,Buffer.alloc(37,98),{method:'PUT'})).code,'digital_part_mismatch');
  assert.equal((await call(f,`/uploads/${id}/parts/2`,Buffer.alloc(38),{method:'PUT'})).status,413);
  const race=await Promise.all([call(f,`/uploads/${id}/parts/1`,part1,{method:'PUT'}),call(f,`/uploads/${id}/parts/1`,part1,{method:'PUT'})]);
  for(const r of race)assert.equal(r.status,200,r.error);
  const resumed=await call(f,'/uploads',input);assert.equal(resumed.upload.id,id);assert.deepEqual(resumed.upload.parts.map(p=>p.number),[1]);
  assert.equal((await call(f,'/uploads',{...input,filename:'Different.pdf'})).code,'digital_replay_conflict');
  assert.equal((await call(f,`/uploads/${id}/parts/2`,part2,{method:'PUT'})).status,200);
  const finals=await Promise.all([call(f,`/uploads/${id}/complete`,{}),call(f,`/uploads/${id}/complete`,{})]);
  for(const r of finals){assert.equal(r.status,200,r.error);assert.equal(r.upload.state,'ready');}
  assert.equal(finals[0].upload.readyAt,finals[1].upload.readyAt);
  const file=await client(f,`/uploads/${id}/file`);assert.equal(file.status,200);assert.deepEqual(Buffer.from(await file.arrayBuffer()),bytes);
  assert.equal(file.headers.get('content-type'),'application/octet-stream');assert.match(file.headers.get('content-disposition'),/^attachment;/);
  assert.match(file.headers.get('content-disposition'),/caf%C3%A9/);assert.match(file.headers.get('cache-control'),/no-store/);assert.match(file.headers.get('content-security-policy'),/sandbox/);
  const range=await client(f,`/uploads/${id}/file`,undefined,{headers:{range:'bytes=5242880-'}});assert.equal(range.status,206);assert.equal((await range.arrayBuffer()).byteLength,37);
  assert.equal(range.headers.get('content-range'),`bytes 5242880-${bytes.length-1}/${bytes.length}`);
  const suffix=await client(f,`/uploads/${id}/file`,undefined,{headers:{range:'bytes=-7'}});assert.equal((await suffix.arrayBuffer()).byteLength,7);
  for(const value of ['bytes=5-2','bytes=9999999-','bytes=-0','bytes=0-1,4-5','items=0-1'])assert.equal((await client(f,`/uploads/${id}/file`,undefined,{headers:{range:value}})).status,416);
  const head=await client(f,`/uploads/${id}/file`,undefined,{method:'HEAD'});assert.equal(head.status,200);assert.equal(await head.text(),'');assert.equal(head.headers.get('content-length'),String(bytes.length));
  assert.equal((await call(f,`/uploads/${id}/parts/2`,part2,{method:'PUT'})).upload.state,'ready');
  assert.equal((await call(f,`/uploads/${id}/parts/2`,Buffer.alloc(37,98),{method:'PUT'})).status,409);
});

test('file routes enforce identity, store, role, strict paths and bounded manifests',async t=>{
  const f=await setup(t),a=await upload(f),path='/uploads/'+a.id;
  for(const route of [path,path+'/file']){
    assert.equal((await client(f,route,undefined,{seller:'bob'})).status,404);
    assert.equal((await client(f,route,undefined,{store:'seller_bob'})).status,409);
    assert.equal((await f.mf.dispatchFetch('https://api.fixture.test/v1/digital-files'+route)).status,401);
  }
  for(const route of [path+'?before=1',path+'?x=y','/uploads/nonsense','/uploads/'+a.id+'/parts/01'])assert.equal((await client(f,route)).status,400);
  assert.equal((await client(f,path,{}, {method:'DELETE'})).status,405);
  for(const input of [manifest(Buffer.from('x'),{filename:'../file.pdf'}),{...a.input,filename:'bad\nheader.pdf'},{...a.input,size:0},{...a.input,size:524288001},{...a.input,parts:['z'.repeat(64)]},{...a.input,parts:[]},{...a.input,extra:true}]){
    assert.equal((await call(f,'/uploads',input)).status,422);
  }
  await f.db.prepare("UPDATE seller_memberships SET role='viewer' WHERE auth_user_id='alice'").run();
  assert.equal((await call(f,path)).status,200);assert.equal((await call(f,path)).upload.canEdit,false);
  for(const route of ['/uploads',path+'/complete',path+'/cancel'])assert.equal((await call(f,route,route==='/uploads'?a.input:{})).status,403);
  await f.db.prepare("DELETE FROM seller_memberships WHERE auth_user_id='alice'").run();
  assert.notEqual((await client(f,path+'/file')).status,200);
});

test('publishing pins immutable versions, catalog copies share bytes and old files survive replacement and deletion',async t=>{
  const f=await setup(t),old=await upload(f),newer=await upload(f,Buffer.from('Version two'));
  assert.equal((await product(f,undefined)).status,409);
  let saved=await product(f,old.id);assert.equal(saved.status,200,saved.error);assert.equal(saved.product.digitalFile.version,1);
  assert.equal(saved.product.digitalFile.filename,'Complete guide.pdf');assert.equal(saved.product.digitalFileName,'Complete guide.pdf');
  const first=saved.product.digitalFile;
  saved=await product(f,old.id);assert.equal(saved.product.digitalFile.id,first.id);
  saved=await product(f,newer.id);assert.equal(saved.product.digitalFile.version,2);assert.notEqual(saved.product.digitalFile.id,first.id);
  const history=await call(f,'/products/custom-digital');assert.equal(history.status,200);assert.deepEqual(history.items.map(i=>[i.version,i.current]),[[2,true],[1,false]]);
  assert.equal((await call(f,'/products/custom-digital?before=2')).items[0].id,first.id);
  assert.equal((await call(f,'/products/custom-digital?before=2&before=1')).status,400);
  assert.equal((await call(f,'/uploads/'+old.id+'/cancel',{})).code,'digital_file_in_use');
  assert.equal((await client(f,'/uploads/'+old.id+'/file')).status,200);
  const copy=await f.merchant('/v1/products/custom-digital/duplicate',{}, {method:'POST'});assert.equal(copy.status,201,copy.error);
  assert.equal(copy.product.digitalFile.uploadId,newer.id);assert.equal(copy.product.digitalFile.version,1);assert.notEqual(copy.product.digitalFile.id,saved.product.digitalFile.id);
  const publicCatalog=await f.mf.dispatchFetch('https://api.fixture.test/v1/storefront/products?ids=custom-digital');
  assert.equal(publicCatalog.status,200);const publicText=await publicCatalog.text();assert(!publicText.includes(old.id));assert(!publicText.includes(newer.id));assert(!publicText.includes(first.id));
  const other=await upload(f,Buffer.from('other file'));await f.db.prepare("UPDATE products SET title='Changed concurrently' WHERE id='custom-digital'").run();
  const stale=await f.merchant('/v1/products/custom-digital',{...saved.product,imageUploadIds:['media_custom-digital'],digitalUploadId:other.id});assert.equal(stale.status,409);
  assert.equal((await call(f,'/products/custom-digital')).items.length,2);
  await assert.rejects(f.db.prepare('UPDATE digital_product_versions SET upload_id=? WHERE id=?').bind(newer.id,first.id).run(),/digital_file_immutable/);
  await assert.rejects(f.db.prepare("UPDATE digital_file_uploads SET state='deleting' WHERE id=?").bind(old.id).run(),/digital_file_in_use/);
  assert.equal((await f.merchant('/v1/products/custom-digital',undefined,{method:'DELETE'})).status,200);
  assert.equal((await client(f,'/uploads/'+old.id+'/file')).status,200);
  const env={DB:f.db,PRIVATE_ASSETS:await f.mf.getR2Bucket('PRIVATE_ASSETS')};
  await cleanupDigitalUploads(env,new Date(Date.now()+8*86400000).toISOString());
  assert.equal((await call(f,'/uploads/'+old.id)).upload.state,'ready');assert.equal((await call(f,'/uploads/'+newer.id)).upload.state,'ready');
  assert.equal((await call(f,'/uploads/'+other.id)).upload.state,'deleted');
});

test('multipart completion and initiation recover ambiguous responses without discarding verified bytes',async t=>{
  const f=await setup(t),bucket=await f.mf.getR2Bucket('PRIVATE_ASSETS'),env={DB:f.db,PRIVATE_ASSETS:bucket};
  const bytes=Buffer.from('A recoverable file'),input=manifest(bytes),start=await call(f,'/uploads',input),id=start.upload.id;
  assert.equal((await call(f,`/uploads/${id}/parts/1`,bytes,{method:'PUT'})).status,200);
  const interrupted={...env,PRIVATE_ASSETS:{head:bucket.head.bind(bucket),resumeMultipartUpload:(...args)=>{
    const m=bucket.resumeMultipartUpload(...args);return {complete:async parts=>{await m.complete(parts);throw Error('response lost');}};
  }}};
  const done=await completeDigitalUpload(interrupted,actor,id);assert.equal(done.state,'ready');
  assert.equal((await completeDigitalUpload(env,actor,id)).readyAt,done.readyAt);
  const next=manifest(Buffer.from('Another file')),calls=[];
  const database={batch:f.db.batch.bind(f.db),prepare(sql){const s=f.db.prepare(sql);return {bind(...args){const bound=s.bind(...args);
    if(sql.startsWith('UPDATE digital_file_uploads SET state=\'uploading\''))return {run:async()=>{await bound.run();throw Error('D1 response lost');}};
    return bound;}};}};
  const recovery=await beginDigitalUpload({...env,DB:database,PRIVATE_ASSETS:{...bucket,createMultipartUpload:async(...args)=>{
    const m=await bucket.createMultipartUpload(...args);return {uploadId:m.uploadId,abort:async()=>{calls.push('abort');await m.abort();}};
  }}},actor,next);
  assert.equal(recovery.state,'uploading');assert.deepEqual(calls,[]);
});

test('cancellation and cleanup leave durable receipts, prevent resurrection, and preserve exact request limits',async t=>{
  const f=await setup(t),a=await upload(f),path='/uploads/'+a.id;
  const canceled=await call(f,path+'/cancel',{});assert.equal(canceled.status,200,canceled.error);assert.equal(canceled.upload.state,'deleted');
  assert.equal((await call(f,path+'/cancel',{})).upload.state,'deleted');assert.equal((await call(f,'/uploads',a.input)).upload.state,'deleted');
  assert.equal((await call(f,path+'/complete',{})).status,410);assert.equal((await client(f,path+'/file')).status,409);
  await assert.rejects(f.db.prepare("UPDATE digital_file_uploads SET state='ready' WHERE id=?").bind(a.id).run(),/digital_file_state/);
  const inputs=Array.from({length:11},()=>manifest(Buffer.from('Unfinished file')));
  for(let i=0;i<10;i++)assert.equal((await call(f,'/uploads',inputs[i])).status,200);
  assert.equal((await call(f,'/uploads',inputs[10])).code,'digital_upload_limit');
  assert.equal((await call(f,'/uploads',inputs[0])).status,200,'Exact recovery does not consume another slot');
  const cleanup=await cleanupDigitalUploads({DB:f.db,PRIVATE_ASSETS:await f.mf.getR2Bucket('PRIVATE_ASSETS')},new Date(Date.now()+2*86400000).toISOString());
  assert.equal(cleanup.removed,5,'Maintenance is bounded');
  assert.equal((await call(f,'/uploads',inputs[10])).status,200);
});

test('storage awaits recheck access and cancellation fences a completion that already reached R2',async t=>{
  const f=await setup(t),bucket=await f.mf.getR2Bucket('PRIVATE_ASSETS'),env={DB:f.db,PRIVATE_ASSETS:bucket},bytes=Buffer.from('Sensitive bytes');
  const input=manifest(bytes),pending=await beginDigitalUpload(env,actor,input),id=pending.id;
  const revoke={...env,PRIVATE_ASSETS:{resumeMultipartUpload:(...args)=>{const m=bucket.resumeMultipartUpload(...args);return {uploadPart:async(...part)=>{
    const result=await m.uploadPart(...part);await f.db.prepare("UPDATE seller_memberships SET role='viewer' WHERE auth_user_id='alice'").run();return result;
  }};}}};
  await assert.rejects(uploadDigitalPart(revoke,actor,id,1,new Request('https://fixture/part',{method:'PUT',headers:{'content-type':'application/octet-stream'},body:bytes})),e=>e.status===403);
  assert.equal((await f.db.prepare('SELECT COUNT(*) AS n FROM digital_file_parts WHERE upload_id=?').bind(id).first()).n,0);
  await f.db.prepare("UPDATE seller_memberships SET role='owner' WHERE auth_user_id='alice'").run();
  assert.equal((await call(f,`/uploads/${id}/parts/1`,bytes,{method:'PUT'})).status,200);
  const cancellation={...env,PRIVATE_ASSETS:{head:bucket.head.bind(bucket),resumeMultipartUpload:(...args)=>{const m=bucket.resumeMultipartUpload(...args);return {complete:async parts=>{
    const object=await m.complete(parts);await cancelDigitalUpload(env,actor,id);return object;
  }};}}};
  await assert.rejects(completeDigitalUpload(cancellation,actor,id),e=>e.status===409);
  assert.equal((await call(f,'/uploads/'+id)).upload.state,'deleted');assert.equal(await bucket.head('digital/seller_alice/'+id),null);
  const fresh=await upload(f,bytes),read={...env,PRIVATE_ASSETS:{get:async(...args)=>{const object=await bucket.get(...args);
    await f.db.prepare("UPDATE sellers SET status='suspended' WHERE id='seller_alice'").run();return object;
  }}};
  await assert.rejects(digitalMerchantFile(read,actor,fresh.id,new Request('https://fixture/file')),e=>e.status===403);
  await f.db.prepare("UPDATE sellers SET status='active' WHERE id='seller_alice'").run();
  const transient={...env,PRIVATE_ASSETS:{resumeMultipartUpload:()=>({abort:async()=>{throw Error('Storage timeout');}})}};
  await assert.rejects(cancelDigitalUpload(transient,actor,fresh.id),/Storage timeout/);
  assert.equal((await call(f,'/uploads/'+fresh.id)).upload.state,'deleting');assert(await bucket.head('digital/seller_alice/'+fresh.id));
  assert.equal((await cancelDigitalUpload(env,actor,fresh.id)).state,'deleted');assert.equal(await bucket.head('digital/seller_alice/'+fresh.id),null);
});

test('a cancelled file rolls back catalog changes and current membership is checked inside the catalog transaction',async t=>{
  const f=await setup(t),file=await upload(f),env={DB:f.db};
  await f.db.prepare("INSERT INTO products(id,seller_id,type,status,title,price_amount,created_at,updated_at) VALUES ('digital-race','seller_alice','digital','active','Original',25000,'now','now')").run();
  const row=await f.db.prepare('SELECT * FROM digital_file_uploads WHERE id=?').bind(file.id).first();
  const statements=[f.db.prepare("UPDATE products SET title='Changed',digital_filename=? WHERE id='digital-race'").bind(file.input.filename),
    ...digitalVersionStatements(env,'seller_alice','alice','digital-race',row,new Date().toISOString())];
  await call(f,'/uploads/'+file.id+'/cancel',{});
  await assert.rejects(f.db.batch(statements),/digital_file_unavailable/);assert.equal((await f.db.prepare("SELECT title FROM products WHERE id='digital-race'").first()).title,'Original');
  await f.db.prepare("UPDATE seller_memberships SET role='viewer' WHERE auth_user_id='alice'").run();
  await assert.rejects(f.db.batch([
    f.db.prepare("UPDATE products SET title='Late edit' WHERE id='digital-race'"),
    f.db.prepare("INSERT INTO seller_events(id,seller_id,actor_auth_user_id,event_type,entity_type,entity_id,payload_json,created_at) VALUES ('late-edit','seller_alice','alice','product.duplicated','product','digital-race','{}','now')"),
  ]),/digital_membership_changed/);
  assert.equal((await f.db.prepare("SELECT title FROM products WHERE id='digital-race'").first()).title,'Original');
  const plans=(await f.db.prepare("EXPLAIN QUERY PLAN SELECT COUNT(*) FROM digital_file_uploads WHERE seller_id=? AND state IN ('preparing','uploading','completing') AND expires_at>?").bind('seller_alice',new Date().toISOString()).all()).results;
  assert(plans.some(p=>p.detail.includes('idx_digital_uploads_pending')));
});

test('an expired initiation with a lost response still returns its original receipt for safe cancellation',async t=>{
  const f=await setup(t),env={DB:f.db,PRIVATE_ASSETS:await f.mf.getR2Bucket('PRIVATE_ASSETS')},input=manifest(Buffer.from('Recover original request'));
  await assert.rejects(beginDigitalUpload({...env,PRIVATE_ASSETS:{createMultipartUpload:async()=>{throw Error('Provider initiation interrupted');}}},actor,input),/interrupted/);
  const row=await f.db.prepare('SELECT id,state FROM digital_file_uploads WHERE request_key=?').bind(input.requestKey).first();assert.equal(row.state,'preparing');
  t.mock.timers.enable({apis:['Date'],now:Date.now()+2*86400000});
  const receipt=await beginDigitalUpload(env,actor,input);assert.equal(receipt.id,row.id);assert.equal(receipt.expired,true);assert.equal(receipt.state,'preparing');
  assert.equal((await cancelDigitalUpload(env,actor,row.id)).state,'deleted');
});
