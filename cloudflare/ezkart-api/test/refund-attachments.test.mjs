import test from 'node:test';
import assert from 'node:assert/strict';
import {randomBytes} from 'node:crypto';
import {setupCommerceFixture,digest} from './commerce-fixture.mjs';
import {uploadRefundAttachment,refundAttachment,refundAttachmentBytes} from '../src/commerce-refund-media.js';
import {applyCommerceSchema} from './commerce-schema.mjs';
const key=()=>randomBytes(16).toString('hex'),buyer='evidence-buyer';
const png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a8x8AAAAASUVORK5CYII=','base64');
const input=(caption='Original parcel photo',bytes=png,mime='image/png',filename='Bukti café.png')=>({filename,caption,dataUrl:'data:'+mime+';base64,'+bytes.toString('base64')});
async function fixture(t,options){
  const f=await setupCommerceFixture(t,options),created=await f.create(f.input({customer:{name:'Buyer',email:'buyer@example.test',phone:'081234567890',authUserId:buyer}}));
  const paid=await f.paid(created.order);assert.equal(paid.status,200,paid.error);const order=paid.order,path='/v1/customer/orders/'+order.id+'/refunds';
  const body={requestKey:key(),orderRevision:order.revision,reason:'damaged',note:'The parcel was damaged.',items:[{orderItemId:order.items[0].id,amount:1000}],shippingAmount:0};
  const saved=await f.merchant(path,body,{seller:buyer,method:'POST'});assert.equal(saved.status,200,saved.error);const refund=saved.refund;
  const url=path+'/'+refund.id,merchantPath='/v1/commerce/refunds/'+refund.id,bucket=await f.mf.getR2Bucket('PRIVATE_ASSETS');
  const env={DB:f.db,PRIVATE_ASSETS:bucket,APP_ENVIRONMENT:'test',COMMERCE_STORAGE:'d1'};
  const upload=(data=input(),actor=buyer)=>f.merchant((actor===buyer?url:merchantPath)+'/evidence',data,{seller:actor,method:'POST'});
  const view=async()=>{const r=await f.merchant(url,undefined,{seller:buyer});assert.equal(r.status,200,r.error);return r.refund;};
  const actor={kind:'buyer',id:buyer};
  return {...f,order,refund,url,merchantPath,env,bucket,upload,view,actor};
}

test('private refund evidence retains exact original bytes and descriptions with actor-bound retries and unchanged money',async t=>{
  const f=await fixture(t),before=(await f.db.prepare('SELECT * FROM commerce_financial_entries ORDER BY journal_sequence,line_number').all()).results;
  const uploads=await Promise.all([f.upload(),f.upload()]);assert(uploads.every(r=>r.status===200),JSON.stringify(uploads));
  const original=uploads[0].refund.attachments[0];assert.equal(original.sha256,digest(png));assert.equal(uploads[1].refund.attachments.length,1);assert.equal(original.actor,'Buyer');assert.equal((await f.view()).evidenceVersion,2);
  const store=await f.upload(input('Store packing photo'),'alice');assert.equal(store.status,200,store.error);assert.equal(store.refund.attachments[1].actor,'Store');
  for(const actor of [buyer,'alice']){const response=await f.mf.dispatchFetch('https://fixture.test'+(actor===buyer?f.url:f.merchantPath)+'/evidence/'+original.id,{headers:{authorization:'Bearer '+await f.merchantToken(actor)}});
    assert.equal(response.status,200);assert.match(response.headers.get('content-disposition'),/^attachment;.*filename\*=UTF-8''Bukti%20caf%C3%A9.png$/);assert.equal(response.headers.get('cache-control'),'no-store');assert.deepEqual(Buffer.from(await response.arrayBuffer()),png);}
  for(const actor of ['bob','same-email-buyer'])assert.equal((await f.mf.dispatchFetch('https://fixture.test'+f.url+'/evidence/'+original.id,{headers:{authorization:'Bearer '+await f.merchantToken(actor,'buyer@example.test')}})).status,404);
  const current=await f.view(),decision=await f.merchant(f.merchantPath,{requestKey:key(),revision:current.revision,orderRevision:current.orderRevision,evidenceVersion:current.evidenceVersion,kind:'decline',message:'The original evidence was reviewed.'},{method:'POST'});assert.equal(decision.status,200,decision.error);
  assert.equal((await f.upload()).refund.attachments.length,2);assert.equal((await f.upload(input('Additional explanation after the decision'))).refund.state,'declined');
  assert.deepEqual((await f.db.prepare('SELECT * FROM commerce_financial_entries ORDER BY journal_sequence,line_number').all()).results,before);assert.equal((await f.view()).paymentConfirmed,false);assert.equal(await f.stock(),8);
  assert(!JSON.stringify(await f.view()).match(/r2_key|actor_auth_user|refund-evidence\//));
});

test('an interrupted original upload resumes without replacement; missing or altered stored originals fail closed',async t=>{
  const f=await fixture(t),env={...f.env,PRIVATE_ASSETS:{get:k=>f.bucket.get(k),put:async(...args)=>{await f.bucket.put(...args);throw Error('connection interrupted after storage');}}};
  await assert.rejects(uploadRefundAttachment(env,f.actor,f.refund.id,input(),f.order.id),/connection interrupted/);
  let row=await f.db.prepare('SELECT * FROM commerce_refund_attachments').first();assert.equal(row.state,'uploading');assert.equal((await f.view()).evidenceVersion,1);
  const recovered=await uploadRefundAttachment({...f.env,PRIVATE_ASSETS:{get:k=>f.bucket.get(k),put:()=>{throw Error('must not replace');}}},f.actor,f.refund.id,input(),f.order.id);
  assert.equal(recovered.attachments.length,1);assert.equal(recovered.attachments[0].state,'ready');assert.equal(recovered.evidenceVersion,2);
  await f.bucket.put(row.r2_key,Buffer.alloc(png.length));assert.equal((await f.upload()).status,503);
  await assert.rejects(refundAttachment(f.env,f.actor,f.refund.id,row.id,f.order.id),e=>e.status===503);
  await f.bucket.delete(row.r2_key);assert.equal((await f.upload()).status,503);assert.equal((await f.bucket.list()).objects.length,0);
  for(const sql of ["UPDATE commerce_refund_attachments SET caption='Rewritten'",'DELETE FROM commerce_refund_attachments','INSERT OR REPLACE INTO commerce_refund_attachments SELECT * FROM commerce_refund_attachments'])await assert.rejects(f.db.prepare(sql).run(),/refund_attachment_immutable/);
});

test('case decisions require the current evidence version in the API and the atomic database write',async t=>{
  const f=await fixture(t),stale=await f.view();assert.equal((await f.upload()).status,200);
  const body={requestKey:key(),revision:stale.revision,orderRevision:stale.orderRevision,evidenceVersion:stale.evidenceVersion,kind:'approve',message:'The evidence was reviewed.'};
  assert.equal((await f.merchant(f.merchantPath,body,{method:'POST'})).status,409);
  await assert.rejects(f.db.prepare(`INSERT INTO commerce_refund_actions(id,refund_id,seller_id,actor_kind,actor_auth_user_id,request_key,request_hash,previous_revision,order_revision,kind,message,created_at,evidence_version)
    VALUES(?,?,'seller_alice','merchant','alice',?,?,?,?,'approve','Reviewed original evidence.',?,0)`).bind('raction_'+key(),f.refund.id,key(),digest('decision'),stale.revision,stale.orderRevision,new Date().toISOString()).run(),/refund_evidence_changed/);
  const current=await f.view(),saved=await f.merchant(f.merchantPath,{...body,evidenceVersion:current.evidenceVersion},{method:'POST'});assert.equal(saved.status,200,saved.error);
  assert.equal((await f.db.prepare('SELECT evidence_version FROM commerce_refund_actions').first()).evidence_version,2);
  await f.upload(input('A later file'));
  assert.equal((await f.merchant(f.merchantPath,{...body,evidenceVersion:current.evidenceVersion},{method:'POST'})).status,200,'original decision receipt still replays');
});

test('membership changes during file storage and private download cannot publish or expose evidence',async t=>{
  const f=await fixture(t),actor={kind:'merchant',id:'alice',sellerId:'seller_alice'};
  const env={...f.env,PRIVATE_ASSETS:{get:k=>f.bucket.get(k),put:async(...args)=>{await f.bucket.put(...args);await f.db.prepare("UPDATE seller_memberships SET role='viewer' WHERE auth_user_id='alice'").run();}}};
  await assert.rejects(uploadRefundAttachment(env,actor,f.refund.id,input('Warehouse photo')),e=>e.status===403);
  assert.equal((await f.db.prepare('SELECT state FROM commerce_refund_attachments').first()).state,'uploading');assert.equal((await f.upload(input('Warehouse photo'),'alice')).status,403);
  const saved=await f.upload(),file=saved.refund.attachments.find(a=>a.state==='ready');
  await assert.rejects(refundAttachment({...f.env,PRIVATE_ASSETS:{get:async k=>{const object=await f.bucket.get(k);await f.db.prepare("DELETE FROM seller_memberships WHERE auth_user_id='alice'").run();return object;}}},actor,f.refund.id,file.id),e=>e.status===403);
});

test('evidence quotas are atomic, originals remain resumable at the limit, and file/type/body bounds are enforced',async t=>{
  const f=await fixture(t),responses=await Promise.all(Array.from({length:12},(_,n)=>f.upload(input('Photo '+n))));
  assert.equal(responses.filter(r=>r.status===200).length,10);assert.equal(responses.filter(r=>r.status===409).length,2);
  const original=responses.find(r=>r.status===200).refund.attachments[0];assert.equal((await f.upload(input(original.caption))).status,200);
  assert.equal((await f.upload(input('Independent store side'),'alice')).status,200);
  for(const data of [{...input(),filename:'../../photo.png'},input('',Buffer.from('<svg></svg>'),'image/png'),{...input(),dataUrl:'data:text/html;base64,PGgxPng8L2gxPg=='},{...input(),caption:'x'.repeat(501)}])assert.equal((await f.upload(data,'alice')).status,422);
  const pdf=Buffer.alloc(refundAttachmentBytes,32);pdf.write('%PDF-1.7\n');pdf.write('\n%%EOF',pdf.length-6);const full=await f.upload(input('Maximum-size original',pdf,'application/pdf','Inspection.pdf'),'alice');assert.equal(full.status,200,full.error);assert.equal(full.refund.attachments.at(-1).sha256,digest(pdf));
  const tooLarge=await f.upload(input('Too large',Buffer.concat([pdf,Buffer.from(' ')]),'application/pdf','Large.pdf'),'alice');assert.equal(tooLarge.status,413);
});

test('0063 preserves populated original refund requests and actions while adding empty private evidence',async t=>{
  const f=await setupCommerceFixture(t,{through:62});
  // Use the unchanged original SQL guards to seed a real paid refund before upgrade.
  const created=await f.create(f.input()),paid=await f.paid(created.order);assert.equal(paid.status,200);
  const o=paid.order,now=new Date().toISOString(),id='ref_'+key(),capture=await f.db.prepare('SELECT id FROM commerce_payment_captures WHERE order_id=?').bind(o.id).first();
  await f.db.prepare(`INSERT INTO commerce_refunds(id,seller_id,order_id,commerce_environment,capture_id,actor_kind,actor_auth_user_id,request_key,request_hash,order_revision,data_json,amount,shipping_amount,created_at,updated_at)
    VALUES(?,'seller_alice',?,'sandbox',?,'merchant','alice',?,?,?,?,1000,0,?,?)`).bind(id,o.id,capture.id,key(),digest('original'),o.revision,JSON.stringify({reason:'other',note:'Original recorded request.',items:[{orderItemId:o.items[0].id,amount:1000}],shippingAmount:0}),now,now).run();
  await f.db.prepare(`INSERT INTO commerce_refund_actions(id,refund_id,seller_id,actor_kind,actor_auth_user_id,request_key,request_hash,previous_revision,order_revision,kind,message,created_at)
    VALUES(?,?,'seller_alice','merchant','alice',?,?,1,?,'approve','Original recorded decision.',?)`).bind('raction_'+key(),id,key(),digest('original-action'),o.revision,now).run();
  const originals=await f.db.prepare('SELECT * FROM commerce_refunds').all(),actions=await f.db.prepare('SELECT * FROM commerce_refund_actions').all();
  await applyCommerceSchema(f.db,62,63);
  assert.deepEqual((await f.db.prepare('SELECT * FROM commerce_refunds').all()).results,originals.results);
  const upgraded=(await f.db.prepare('SELECT * FROM commerce_refund_actions').all()).results;assert.equal(upgraded[0].evidence_version,0);delete upgraded[0].evidence_version;assert.deepEqual(upgraded,actions.results);
  assert.equal((await f.db.prepare('SELECT COUNT(*) n FROM commerce_refund_attachments').first()).n,0);assert.deepEqual((await f.db.prepare('PRAGMA foreign_key_check').all()).results,[]);
});
