import test from 'node:test';
import assert from 'node:assert/strict';
import {randomBytes} from 'node:crypto';
import {setupCommerceFixture,digest} from './commerce-fixture.mjs';
import {setupEarningsFixture} from './earnings-fixture.mjs';
import {changeDispute} from '../src/commerce-refund-disputes.js';
import {commerceOperationsStatement,commerceOperationsWarnings} from '../src/commerce-operations-report.js';
import {applyCommerceSchema} from './commerce-schema.mjs';
const key=()=>randomBytes(16).toString('hex'),buyer='dispute-buyer';
const claims=(age=0)=>({aal:'aal2',amr:[{method:'totp',timestamp:Math.floor(Date.now()/1000)-age}]});
async function fixture(t){
  const f=await setupCommerceFixture(t,{notifications:'enabled'}),made=await f.create(f.input({customer:{...f.input().customer,authUserId:buyer}})),paid=await f.paid(made.order);
  assert.equal(paid.status,200,paid.error);const order=paid.order,path='/v1/customer/orders/'+order.id+'/refunds';
  const body={requestKey:key(),orderRevision:order.revision,reason:'damaged',note:'The original parcel was damaged.',items:[{orderItemId:order.items[0].id,amount:40000}],shippingAmount:0};
  const saved=await f.merchant(path,body,{seller:buyer,method:'POST'});assert.equal(saved.status,200,saved.error);
  const id=saved.refund.id,store='/v1/commerce/refunds/'+id,support='/v1/support/refunds/'+id,url=path+'/'+id;
  const permission=(role='reviewer')=>f.call('/internal/commerce/support/access',{environment:'sandbox',authUserId:'bob',role,requestKey:key(),operator:'Fixture operator',reason:'Exercise the isolated support role.'});
  assert.equal((await permission()).status,200);
  const view=async(actor=buyer)=>{const r=await f.merchant(actor==='bob'?support:actor===buyer?url:store,undefined,{seller:actor,claims:claims()});assert.equal(r.status,200,r.error);return r.refund;};
  const action=async(kind,actor=buyer,extra={})=>{const r=await view(actor),input={requestKey:key(),kind:'review_'+kind,revision:r.dispute?.revision||0,refundRevision:r.revision,orderRevision:r.orderRevision,evidenceVersion:r.evidenceVersion,message:'Review the original evidence.',...extra};
    return f.merchant((actor==='bob'?support:actor===buyer?url:store)+'/dispute',input,{seller:actor,claims:claims(),method:'POST'});};
  const decline=async()=>{const r=await view();const v=await f.merchant(store,{requestKey:key(),kind:'decline',revision:r.revision,orderRevision:r.orderRevision,evidenceVersion:r.evidenceVersion,message:'Store original decision.'},{method:'POST'});assert.equal(v.status,200,v.error);return v.refund;};
  return {...f,order,body,id,path,url,store,support,permission,view,action,decline};
}

test('appeals preserve the original decision, require a platform role, retain messages and never claim refund payment',async t=>{
  const f=await fixture(t);await f.decline();
  const before=(await f.db.prepare('SELECT * FROM commerce_financial_entries ORDER BY journal_sequence,line_number').all()).results;
  const opened=await f.action('open');assert.equal(opened.status,200,opened.error);assert.equal(opened.refund.state,'declined');assert.equal(opened.refund.dispute.state,'open');
  assert.equal((await f.merchant(f.path,undefined,{seller:buyer})).items[0].availableAmount,0,'a declined request under appeal still reserves the original allocation');
  assert.equal((await f.merchant('/v1/support/refunds',undefined,{seller:'alice',claims:claims()})).status,403,'store ownership is not operator authority');
  assert.equal((await f.merchant(f.support,undefined,{seller:'bob'})).status,401,'support requires signed AAL2');
  assert.equal((await f.merchant(f.url,undefined,{seller:'unrelated-buyer'})).status,404);
  const ask=await f.action('ask_buyer','bob');assert.equal(ask.status,200,ask.error);assert.equal(ask.refund.dispute.state,'awaiting_buyer');
  assert.equal((await f.action('reply')).refund.dispute.state,'open');
  assert.equal((await f.action('approve','alice')).status,403);
  const approved=await f.action('approve','bob');assert.equal(approved.status,200,approved.error);assert.equal(approved.refund.state,'approved');assert.equal(approved.refund.dispute.state,'approved');
  assert.equal(approved.refund.history[0].message,'Store original decision.');assert.equal(approved.refund.paymentConfirmed,false);
  assert.equal((await f.db.prepare('SELECT checkout_state FROM orders WHERE id=?').bind(f.order.id).first()).checkout_state,'paid');
  assert.deepEqual((await f.db.prepare('SELECT * FROM commerce_financial_entries ORDER BY journal_sequence,line_number').all()).results,before);assert.equal(await f.stock(),8);
  const detail=await f.view();assert(!JSON.stringify(detail).includes('operatorReference'));assert.equal((await f.view('bob')).dispute.actions.at(-1).operatorReference,'bob');
  for(const table of ['commerce_support_permissions','commerce_refund_disputes','commerce_refund_dispute_actions']){
    await assert.rejects(f.db.prepare('DELETE FROM '+table).run(),/immutable/);
    await assert.rejects(f.db.prepare('INSERT OR REPLACE INTO '+table+' SELECT * FROM '+table).run(),/immutable/);
  }
});

test('support authorization, fresh authenticator proof and latest evidence are rechecked; exact actions replay once',async t=>{
  const f=await fixture(t),openKey=key();assert.equal((await f.action('open',buyer,{requestKey:openKey})).status,200);
  const r=await f.view('bob'),body={requestKey:key(),kind:'review_approve',revision:r.dispute.revision,refundRevision:r.revision,orderRevision:r.orderRevision,evidenceVersion:0,message:'Original reviewed evidence.'};
  assert.equal((await f.merchant(f.support+'/dispute',body,{seller:'bob',claims:claims(601),method:'POST'})).status,401);
  assert.equal((await f.merchant(f.support,undefined,{seller:'bob',claims:claims(601)})).refund.dispute.requiresVerification,true);
  assert.equal((await f.permission('viewer')).status,200);assert.equal((await f.merchant(f.support+'/dispute',body,{seller:'bob',claims:claims(),method:'POST'})).status,403);
  await f.permission();
  const png='iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a8x8AAAAASUVORK5CYII=';
  const up=await f.merchant(f.url+'/evidence',{filename:'Evidence.png',caption:'Additional original evidence',dataUrl:'data:image/png;base64,'+png},{seller:buyer,method:'POST'});assert.equal(up.status,200,up.error);
  assert.equal((await f.merchant(f.support+'/dispute',body,{seller:'bob',claims:claims(),method:'POST'})).status,409);
  const amended={...body,evidenceVersion:2};const responses=await Promise.all([1,2].map(()=>f.merchant(f.support+'/dispute',amended,{seller:'bob',claims:claims(),method:'POST'})));
  assert(responses.every(r=>r.status===200),JSON.stringify(responses));assert.equal((await f.db.prepare('SELECT COUNT(*) n FROM commerce_refund_dispute_actions').first()).n,1);
  assert.equal((await f.merchant(f.support+'/dispute',{...amended,message:'Changed original'}, {seller:'bob',claims:claims(),method:'POST'})).status,409);
  const file=up.refund.attachments[0],download=await f.mf.dispatchFetch('https://fixture.test'+f.support+'/evidence/'+file.id,{headers:{authorization:'Bearer '+await f.merchantToken('bob',undefined,claims())}});assert.equal(download.status,200);
  await f.permission('revoked');assert.equal((await f.merchant(f.support,undefined,{seller:'bob',claims:claims()})).status,403);
});

test('review decisions and changing party access are checked atomically inside the write',async t=>{
  const f=await fixture(t);await f.action('open');const r=await f.view(),now=new Date().toISOString();
  const insert=changes=>{const row={id:'daction_'+key(),dispute_id:r.dispute.id,actor_kind:'support',actor_auth_user_id:'bob',request_key:key(),request_hash:digest('fixture'),previous_revision:r.dispute.revision,refund_revision:r.revision,order_revision:r.orderRevision,evidence_version:r.evidenceVersion,proof_expires_at:Math.floor(Date.now()/1000)+600,kind:'approve',message:'Original review',created_at:now,...changes};return f.db.prepare('INSERT INTO commerce_refund_dispute_actions('+Object.keys(row).join(',')+') VALUES('+Object.keys(row).map(()=>'?').join(',')+')').bind(...Object.values(row)).run();};
  await assert.rejects(insert({proof_expires_at:1}),/dispute_proof_expired/);await assert.rejects(insert({evidence_version:2}),/dispute_evidence_changed/);
  await f.permission('revoked');await assert.rejects(insert({}),/dispute_actor_forbidden/);await f.permission();
  await f.db.prepare("UPDATE seller_memberships SET role='viewer' WHERE auth_user_id='alice'").run();assert.equal((await f.action('reply','alice')).status,403);
  await assert.rejects(f.db.prepare(`INSERT INTO commerce_refund_actions(id,refund_id,seller_id,actor_kind,actor_auth_user_id,request_key,request_hash,previous_revision,order_revision,kind,message,created_at,evidence_version)
    VALUES(?,?,'seller_alice','buyer',?,?,?, ?,?,'withdraw','Original request withdrawal.',?,0)`).bind('raction_'+key(),f.id,buyer,key(),digest('withdraw'),r.revision,r.orderRevision,now).run(),/refund_dispute_open/);
  const outcomes=await Promise.all(['approve','decline'].map(kind=>f.action(kind,'bob')));assert.deepEqual(outcomes.map(r=>r.status).sort(),[200,409]);
});

test('lost committed responses recover, withdrawal releases only its review, and reopening cannot double-allocate',async t=>{
  const f=await fixture(t);await f.decline();const d=await f.view(),body={requestKey:key(),kind:'review_open',revision:0,refundRevision:d.revision,orderRevision:d.orderRevision,evidenceVersion:0,message:'Please review this decision.'};let dropped=false;
  const db=new Proxy(f.db,{get(target,prop){if(prop==='prepare')return sql=>{const stmt=target.prepare(sql);if(!sql.startsWith('INSERT INTO commerce_refund_disputes('))return stmt;return {bind(...args){return {async run(){await stmt.bind(...args).run();dropped=true;throw Error('Lost committed reply');}};}};};const v=Reflect.get(target,prop);return typeof v==='function'?v.bind(target):v;}});
  const recovered=await changeDispute({DB:db,APP_ENVIRONMENT:'test',COMMERCE_STORAGE:'d1'},{kind:'buyer',id:buyer},f.id,body,f.order.id);assert(dropped);assert.equal(recovered.dispute.revision,1);
  assert.equal((await f.action('withdraw','alice')).status,409);assert.equal((await f.action('withdraw')).refund.dispute.state,'withdrawn');
  const another=await f.merchant(f.path,{...f.body,requestKey:key()},{seller:buyer,method:'POST'});assert.equal(another.status,200,another.error);
  assert.equal((await f.action('reopen','bob')).status,409,'replacement refund consumes the original allocation');
  assert.equal((await f.merchant(f.url+'/dispute',body,{seller:buyer,method:'POST'})).status,200,'opening retry remains the same closed case');
});

test('a declined refund under appeal atomically holds settled and delivered earnings until review closure',async t=>{
  const f=await setupEarningsFixture(t),p=await f.payment();await f.deliver(p);await f.settle(p);await f.catchUp();
  const original=(await f.earnings()).availableEarnings;assert(Number(original)>0);
  const ref=await f.refund(p);await f.refundAction(ref.id,'decline');assert.equal((await f.earnings()).availableEarnings,original);
  const path='/v1/customer/orders/'+p.order.id+'/refunds/'+ref.id,r=(await f.merchant(path,undefined,{seller:'earnings-buyer'})).refund;
  const open=await f.merchant(path+'/dispute',{requestKey:key(),kind:'review_open',revision:0,refundRevision:r.revision,orderRevision:r.orderRevision,evidenceVersion:0,message:'Review the original store decision.'},{seller:'earnings-buyer',method:'POST'});assert.equal(open.status,200,open.error);assert.equal((await f.earnings()).availableEarnings,'0');
  const d=open.refund,close=await f.merchant(path+'/dispute',{requestKey:key(),kind:'review_withdraw',revision:d.dispute.revision,refundRevision:d.revision,orderRevision:d.orderRevision,evidenceVersion:0,message:'I have resolved the issue with the store.'},{seller:'earnings-buyer',method:'POST'});assert.equal(close.status,200,close.error);assert.equal((await f.earnings()).availableEarnings,original);
});

test('review alerts follow original actions once, respect existing audience choices and never copy private review messages',async t=>{
  const f=await fixture(t);await f.action('open');await f.action('ask_buyer','bob');await f.action('reply');await f.action('approve','bob');
  for(let n=0;n<10;n++){const result=await f.call('/internal/commerce/notifications/drain',{environment:'sandbox',limit:3});assert.equal(result.failed,0,JSON.stringify(result));if(result.processed<3)break;}
  const events=(await f.db.prepare("SELECT * FROM commerce_notification_events WHERE json_extract(data_json,'$.disputeId') IS NOT NULL ORDER BY occurred_at,id").all()).results;
  assert.equal(events.length,4);assert(!JSON.stringify(events).includes('Review the original evidence.'));
  assert(events.every(e=>e.refund_id===f.id&&e.category==='returns'&&e.audience==='both'));
  const approved=events.find(e=>JSON.parse(e.data_json).reviewKind==='approve');assert.match(approved.body,/does not confirm a refund payment/);
  const recipients=(await f.db.prepare("SELECT DISTINCT r.actor_kind,r.actor_id FROM commerce_notification_recipients r JOIN commerce_notification_events e ON e.id=r.event_id WHERE json_extract(e.data_json,'$.disputeId') IS NOT NULL ORDER BY r.actor_id").all()).results;
  assert.deepEqual(recipients,[{actor_kind:'merchant',actor_id:'alice'},{actor_kind:'buyer',actor_id:buyer}]);
  const jobs=(await f.db.prepare("SELECT * FROM commerce_jobs WHERE kind='notification.dispute_updated'").all()).results;
  assert.equal(jobs.length,4);assert(jobs.every(j=>j.state==='succeeded'));assert.equal((await f.call('/internal/commerce/notifications/drain',{environment:'sandbox',limit:3})).processed,0);
  // A fabricated source cannot become an accepted inbox event.
  const now=new Date().toISOString(),payload={orderId:f.order.id,refundId:f.id,disputeId:JSON.parse(events[0].data_json).disputeId,reviewKind:'approve',actionId:'daction_'+key()};
  await f.db.prepare(`INSERT INTO commerce_jobs(id,seller_id,order_id,commerce_environment,job_key,kind,payload_json,available_at,created_at,updated_at) VALUES(?,'seller_alice',?,'sandbox',?,'notification.dispute_updated',?,?,?,?)`).bind('job_'+key(),f.order.id,'forged_'+key(),JSON.stringify(payload),now,now,now).run();
  assert.equal((await f.call('/internal/commerce/notifications/drain',{environment:'sandbox',limit:1})).failed,1);
  assert.equal((await f.db.prepare("SELECT COUNT(*) n FROM commerce_notification_events WHERE json_extract(data_json,'$.disputeId') IS NOT NULL").first()).n,4);
});

test('bounded review history retains every original message, rate limits writers, and exposes stale cases without mutations',async t=>{
  const f=await fixture(t),opened=await f.action('open'),r=opened.refund,now=new Date().toISOString();
  for(let n=0;n<52;n++)await f.db.prepare(`INSERT INTO commerce_refund_dispute_actions(id,dispute_id,actor_kind,actor_auth_user_id,request_key,request_hash,previous_revision,refund_revision,order_revision,evidence_version,kind,message,created_at)
    VALUES(?,?,?,?,?,?,?,?,?,0,'reply',?,?)`).bind('daction_'+key(),r.dispute.id,n%2?'merchant':'buyer',n%2?'alice':buyer,key(),digest('message'+n),n+1,r.revision,r.orderRevision,'Original message '+n,now).run();
  const current=await f.view();assert.equal(current.dispute.actions.length,50);assert(current.dispute.olderBefore);
  const earlier=await f.merchant(f.url+'/dispute?before='+current.dispute.olderBefore,undefined,{seller:buyer});assert.equal(earlier.status,200,earlier.error);assert.equal(earlier.disputeHistory.actions.length,2);assert.equal(earlier.disputeHistory.olderBefore,null);
  assert.deepEqual([...earlier.disputeHistory.actions,...current.dispute.actions].map(a=>a.message),Array.from({length:52},(_,n)=>'Original message '+n));
  for(let n=0;n<4;n++)assert.equal((await f.action('reply')).status,200);assert.equal((await f.action('reply')).status,429);
  const query=await f.db.prepare(commerceOperationsStatement('sandbox',new Date(Date.now()+49*3600000).toISOString())).all();assert.equal(query.meta.rows_written,0);
  const report=JSON.parse(query.results[0].report);assert.equal(report.refundReviews.open,1);assert.equal(report.refundReviews.stale,1);assert(commerceOperationsWarnings(report).includes('refund_reviews_stale'));
});

test('0064 preserves populated original decisions, evidence versions and earnings sources without manufacturing reviews',async t=>{
  const f=await setupCommerceFixture(t,{through:63}),made=await f.create(f.input()),paid=await f.paid(made.order),o=paid.order,now=new Date().toISOString(),id='ref_'+key();assert.equal(paid.status,200);
  const capture=await f.db.prepare('SELECT id FROM commerce_payment_captures WHERE order_id=?').bind(o.id).first();
  await f.db.prepare(`INSERT INTO commerce_refunds(id,seller_id,order_id,commerce_environment,capture_id,actor_kind,actor_auth_user_id,request_key,request_hash,order_revision,data_json,amount,shipping_amount,created_at,updated_at)
    VALUES(?,'seller_alice',?,'sandbox',?,'merchant','alice',?,?,?,?,1000,0,?,?)`).bind(id,o.id,capture.id,key(),digest('original'),o.revision,JSON.stringify({reason:'other',note:'Original request.',items:[{orderItemId:o.items[0].id,amount:1000}],shippingAmount:0}),now,now).run();
  await f.db.prepare(`INSERT INTO commerce_refund_actions(id,refund_id,seller_id,actor_kind,actor_auth_user_id,request_key,request_hash,previous_revision,order_revision,kind,message,created_at,evidence_version)
    VALUES(?,?,'seller_alice','merchant','alice',?,?,1,?,'approve','Original decision.',?,0)`).bind('raction_'+key(),id,key(),digest('action'),o.revision,now).run();
  const tables=['commerce_refunds','commerce_refund_actions','commerce_financial_entries','commerce_earnings_assessments','commerce_earnings_inputs'],before={};for(const table of tables)before[table]=(await f.db.prepare('SELECT * FROM '+table).all()).results;
  await applyCommerceSchema(f.db,63,64);for(const table of tables)assert.deepEqual((await f.db.prepare('SELECT * FROM '+table).all()).results,before[table],table);
  assert.equal((await f.db.prepare('SELECT COUNT(*) n FROM commerce_refund_disputes').first()).n,0);assert.deepEqual((await f.db.prepare('PRAGMA foreign_key_check').all()).results,[]);
});
