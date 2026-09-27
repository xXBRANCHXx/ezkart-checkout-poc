import test from 'node:test';
import assert from 'node:assert/strict';
import {randomBytes} from 'node:crypto';
import {setupCommerceFixture} from './commerce-fixture.mjs';
import {applyCommerceSchema} from './commerce-schema.mjs';

const base='/internal/commerce/finance/wallet',key=()=>randomBytes(16).toString('hex'),fingerprint='a'.repeat(64);
const actor=(user='alice')=>({id:user,email:user+'@example.test',proofExpiresAt:new Date(Date.now()+550000).toISOString()});
const request=(extra={})=>({environment:'sandbox',seller:'seller_alice',actor:actor(),action:'enroll',requestKey:key(),...extra});
const read=(f,extra={})=>f.call(base,{environment:'sandbox',seller:'seller_alice',actor:actor(),action:'read',...extra});
const registration=(f,id)=>f.call(base+'/registrations/'+id+'?environment=sandbox');
const count=async(f,table)=>(await f.db.prepare('SELECT count(*) AS n FROM '+table).first()).n;
async function enroll(f,input=request()){const r=await f.call(base,input);assert.equal(r.status,200,r.error);return r.enrollment;}
async function claim(f,enrollment,mode='execute'){
  const r=await registration(f,enrollment.id);assert.equal(r.status,200,r.error);
  const jobs=await f.call('/internal/commerce/jobs/claim',{environment:'sandbox',workerId:'wallet_worker',kinds:['wallet.register'],jobId:r.registration.jobId,mode,limit:1,leaseSeconds:120});
  assert.equal(jobs.status,200,jobs.error);assert.equal(jobs.jobs.length,1);return jobs.jobs[0];
}
const binding=job=>({environment:'sandbox',workerId:'wallet_worker',leaseToken:job.leaseToken,credentialFingerprint:fingerprint,clientId:'MCH-fixture',parentProfileId:'BRN-fixture'});
const bind=(f,e,job,extra={})=>f.call(base+'/registrations/'+e.id+'/bind',{...binding(job),...extra});
const accounts=(cash='2010000001',pending='2030000001')=>[
  {type:'DOKU_MERCHANT_IDR',currency:'IDR',accountNo:cash},
  {type:'DOKU_MERCHANT_PENDING_IDR',currency:'IDR',accountNo:pending},
];
function evidence(profile='SAC-fixture',cash='2010000001',pending='2030000001'){
  const registration={responseCode:'2000000',parentProfileId:'BRN-fixture',profileId:profile,accounts:accounts(cash,pending)};
  const confirmation={responseCode:'2000000',profileId:profile,name:'alice',accounts:accounts(cash,pending).map(a=>({...a,balance:{available:'0.00',reserved:'0.00'}}))};
  return {environment:'sandbox',credentialFingerprint:fingerprint,registrationBody:JSON.stringify(registration),confirmationBody:JSON.stringify(confirmation)};
}
const receipt=(f,e,input=evidence())=>f.call(base+'/registrations/'+e.id+'/receipt',{environment:input.environment,credentialFingerprint:input.credentialFingerprint,registrationBody:input.registrationBody});
const confirm=(f,e,input=evidence())=>f.call(base+'/registrations/'+e.id+'/record',{environment:input.environment,credentialFingerprint:input.credentialFingerprint,confirmationBody:input.confirmationBody});
async function record(f,e,input=evidence()){const r=await receipt(f,e,input);return r.status===200?confirm(f,e,input):r;}
const finish=(f,job,outcome='succeeded',extra={})=>f.call('/internal/commerce/jobs/'+job.id+'/finish',{environment:'sandbox',workerId:'wallet_worker',leaseToken:job.leaseToken,outcome,result:{recorded:true},...extra});

test('wallet enrollment requires signed service authority, a current owner and a fresh account-bound proof',async t=>{
  const f=await setupCommerceFixture(t);assert.equal((await read(f)).enrollment,null);
  assert.equal((await f.merchant(base,request(),{method:'POST'})).status,401);
  for(const input of [request({actor:{...actor(),id:'bob'}}),request({environment:'production'}),request({actor:{...actor(),proofExpiresAt:new Date(Date.now()-1).toISOString()}}),request({actor:{...actor(),proofExpiresAt:new Date(Date.now()+700000).toISOString()}}),request({profileId:'arbitrary-profile'}),request({actor:{...actor(),email:'long-verified-address@example.test'}})])assert([401,403,422].includes((await f.call(base,input)).status));
  await f.db.prepare("UPDATE seller_memberships SET role='admin' WHERE auth_user_id='alice'").run();assert.equal((await read(f)).status,403);
  await f.db.prepare("UPDATE seller_memberships SET role='owner' WHERE auth_user_id='alice'").run();await f.db.prepare("UPDATE sellers SET status='suspended' WHERE id='seller_alice'").run();assert.equal((await read(f)).status,403);
  assert.equal(await count(f,'commerce_wallet_enrollments'),0);assert.equal(await count(f,'commerce_jobs'),0);
});

test('one immutable owner intent and one provider job survive concurrent submissions, lost replies and later identity edits',async t=>{
  const f=await setupCommerceFixture(t),input=request();
  const result=await Promise.all([f.call(base,input),f.call(base,input)]);assert(result.every(r=>r.status===200),JSON.stringify(result));
  const enrollment=result[0].enrollment;assert.equal(result[1].enrollment.id,enrollment.id);assert.equal(await count(f,'commerce_wallet_enrollments'),1);assert.equal(await count(f,'commerce_jobs'),1);
  assert.equal((await f.call(base,request())).status,409);
  await f.db.prepare("UPDATE sellers SET name='Changed store name' WHERE id='seller_alice'").run();
  assert.equal((await f.call(base,{...input,actor:{...actor(),email:'new@example.test'}})).replayed,true);
  const r=await read(f);assert.equal(r.enrollment.accountName,'alice');assert.equal(r.enrollment.email,'alice@example.test');assert.equal(r.owner.storeName,'Changed store name');assert.equal(r.availableToWithdraw,null);
  assert(!JSON.stringify(r).includes(fingerprint));assert.equal(await count(f,'commerce_financial_journals'),0);assert.equal(await count(f,'commerce_payment_captures'),0);
  const saved=(await registration(f,enrollment.id)).registration;assert.match(saved.request.partnerReferenceNo,/^EZK-W-S-[a-f0-9]{40}$/);assert.equal(saved.request.name,'alice');
});

test('ownership or name races and failed intent inserts roll back the provider job atomically',async t=>{
  const f=await setupCommerceFixture(t);
  await f.db.prepare("CREATE TRIGGER revoke_wallet_owner AFTER INSERT ON commerce_jobs WHEN NEW.kind='wallet.register' BEGIN UPDATE seller_memberships SET role='viewer' WHERE seller_id=NEW.seller_id; END").run();
  assert.equal((await f.call(base,request())).status,409);assert.equal(await count(f,'commerce_jobs'),0);assert.equal(await count(f,'commerce_wallet_enrollments'),0);
  assert.equal((await f.db.prepare("SELECT role FROM seller_memberships WHERE auth_user_id='alice'").first()).role,'owner');
  await f.db.prepare('DROP TRIGGER revoke_wallet_owner').run();
  await f.db.prepare("CREATE TRIGGER fail_wallet_intent BEFORE INSERT ON commerce_wallet_enrollments BEGIN SELECT RAISE(ABORT,'fixture_wallet_failure'); END").run();
  const input=request();assert.equal((await f.call(base,input)).status,500);assert.equal(await count(f,'commerce_jobs'),0);
  await f.db.prepare('DROP TRIGGER fail_wallet_intent').run();assert.equal((await f.call(base,input)).status,200);
});

test('provider binding is pinned to one live execute lease and cannot be reused to dispatch another registration',async t=>{
  const f=await setupCommerceFixture(t),a=await enroll(f),b=await enroll(f,request({seller:'seller_bob',actor:actor('bob')})),job=await claim(f,a);
  assert.equal(job.data.enrollmentId,a.id);assert.equal((await registration(f,b.id)).registration.profile,null);
  assert.equal((await bind(f,a,job,{workerId:'another_worker'})).status,409);
  assert.equal((await bind(f,a,job)).mayRegister,true);assert.equal((await bind(f,a,job)).mayRegister,false);
  assert.equal((await bind(f,a,job,{credentialFingerprint:'b'.repeat(64)})).status,409);
  assert.equal((await finish(f,job)).status,409);
  assert.equal((await finish(f,job,'retry',{result:{noEffectConfirmed:true}})).status,409);
  assert.equal((await finish(f,job,'uncertain')).status,200);
  await f.db.prepare("UPDATE commerce_jobs SET available_at='2000-01-01T00:00:00.000Z' WHERE id=?").bind(job.id).run();
  const recovery=await claim(f,a,'reconcile');assert.equal((await bind(f,a,recovery)).status,409);
  assert.equal(await count(f,'commerce_wallet_provider_bindings'),1);assert.equal(await count(f,'commerce_wallet_provider_profiles'),0);
});

test('verified registration plus an independent matching profile read establishes exactly one immutable cash and pending binding',async t=>{
  const f=await setupCommerceFixture(t),e=await enroll(f),job=await claim(f,e);await bind(f,e,job);
  assert.equal((await confirm(f,e)).status,409);assert.equal((await receipt(f,e)).status,200);
  assert.equal((await registration(f,e.id)).registration.registrationBody,evidence().registrationBody);
  const saved=await record(f,e);assert.equal(saved.status,200,saved.error);assert.equal(saved.replayed,false);assert.equal((await record(f,e)).replayed,true);
  assert.equal(await count(f,'commerce_wallet_provider_profiles'),1);assert.equal(await count(f,'commerce_wallet_provider_accounts'),2);
  const r=await read(f);assert.equal(r.enrollment.status,'connected');assert.equal(r.enrollment.providerAccountSuffix,'0001');assert.equal(r.availableToWithdraw,null);
  assert.equal((await finish(f,job)).status,200);assert.equal((await finish(f,job)).status,200);
  for(const table of ['commerce_wallet_enrollments','commerce_wallet_provider_bindings','commerce_wallet_registration_receipts','commerce_wallet_provider_profiles','commerce_wallet_provider_accounts']){
    await assert.rejects(f.db.prepare('DELETE FROM '+table).run(),/immutable/);
    const field=table==='commerce_wallet_enrollments'?'account_name':table==='commerce_wallet_provider_bindings'?'client_id':table==='commerce_wallet_registration_receipts'?'registration_json':table==='commerce_wallet_provider_profiles'?'profile_id':'account_number';
    await assert.rejects(f.db.prepare('UPDATE '+table+' SET '+field+'='+field).run(),/immutable/);
    await assert.rejects(f.db.prepare('INSERT OR REPLACE INTO '+table+' SELECT * FROM '+table).run(),/immutable|wallet_job_mismatch|wallet_binding_lease_mismatch/);
  }
  assert.equal(await count(f,'commerce_financial_journals'),0);
});

test('ambiguous provider evidence, parent substitution and changed credentials cannot establish a wallet',async t=>{
  const f=await setupCommerceFixture(t),e=await enroll(f),job=await claim(f,e);assert.equal((await record(f,e)).status,409);await bind(f,e,job);
  const cases=[{credentialFingerprint:'b'.repeat(64)},{registrationBody:'{"profileId":"wrong","profileId":"SAC-fixture"}'},{registrationBody:'{"x":1,"\\u0078":2}'},
    {registrationBody:JSON.stringify({...JSON.parse(evidence().registrationBody),parentProfileId:'BRN-another'})},
    {registrationBody:JSON.stringify({...JSON.parse(evidence().registrationBody),responseCode:2000000})},
    {registrationBody:JSON.stringify({...JSON.parse(evidence().registrationBody),accounts:[...accounts(),{type:'DOKU_SYSTEM_POINT',currency:'POINT',accountNo:'3000000001'}]})},
    evidence('BRN-fixture'),
    {registrationBody:JSON.stringify({...JSON.parse(evidence().registrationBody),accounts:[...accounts(),accounts()[0]]})},
    {registrationBody:evidence().registrationBody.replace('"accountNo":"2010000001"','"accountNo":2010000001.0')},
    {registrationBody:' '.repeat(16001)}];
  for(const change of cases){const r=await record(f,e,{...evidence(),...change});assert([409,422].includes(r.status),JSON.stringify(r));}
  assert.equal((await receipt(f,e)).status,200);
  for(const confirmationBody of [JSON.stringify({...JSON.parse(evidence().confirmationBody),profileId:'SAC-other'}),JSON.stringify({...JSON.parse(evidence().confirmationBody),accounts:accounts('2010000099')})])assert.equal((await confirm(f,e,{...evidence(),confirmationBody})).status,422);
  assert.equal(await count(f,'commerce_wallet_provider_profiles'),0);assert.equal(await count(f,'commerce_wallet_provider_accounts'),0);
});

test('integer account evidence matches frozen digit strings without accepting exponents, fractions or collapsed leading zeros',async t=>{
  const f=await setupCommerceFixture(t),e=await enroll(f),job=await claim(f,e);await bind(f,e,job);
  for(const token of ['2010000001.0','2.010000001e9','-2010000001','10000000000','true','null']){
    const input=evidence();input.registrationBody=input.registrationBody.replace('"accountNo":"2010000001"','"accountNo":'+token);
    assert.equal((await receipt(f,e,input)).status,422,token);
  }
  const numeric=evidence();numeric.registrationBody=numeric.registrationBody.replaceAll('"2010000001"','2010000001').replaceAll('"2030000001"','2030000001');
  assert.equal((await receipt(f,e,numeric)).status,200);
  const wrong={...numeric,confirmationBody:numeric.confirmationBody.replace('"2010000001"','"0201000001"')};assert.equal((await confirm(f,e,wrong)).status,422);
  assert.equal((await confirm(f,e,numeric)).status,200);
  const saved=(await registration(f,e.id)).registration;assert.equal(saved.profile.cashAccount,'2010000001');assert.equal(saved.registrationBody,numeric.registrationBody);
  assert.equal(await count(f,'commerce_wallet_provider_accounts'),2);assert.equal(await count(f,'commerce_financial_journals'),0);
});

test('migration 0049 preserves registered string accounts and changes only the future evidence guard',async t=>{
  const f=await setupCommerceFixture(t,{through:48}),e=await enroll(f),job=await claim(f,e);await bind(f,e,job);assert.equal((await record(f,e)).status,200);
  const tables=(await f.db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '_cf_%' ORDER BY name").all()).results.map(r=>r.name);
  const before={};for(const table of tables)before[table]=(await f.db.prepare('SELECT * FROM '+table).all()).results;
  await applyCommerceSchema(f.db,48,49);
  for(const table of tables)assert.deepEqual((await f.db.prepare('SELECT * FROM '+table).all()).results,before[table],table);
  assert.deepEqual((await f.db.prepare('PRAGMA foreign_key_check').all()).results,[]);assert.equal((await record(f,e)).replayed,true);
  const second=await enroll(f,request({seller:'seller_bob',actor:actor('bob')})),nextJob=await claim(f,second);await bind(f,second,nextJob);
  const numeric=evidence('SAC-second','2010000002','2030000002');numeric.registrationBody=numeric.registrationBody.replaceAll('"2010000002"','2010000002').replaceAll('"2030000002"','2030000002');
  numeric.confirmationBody=numeric.confirmationBody.replaceAll('"2010000002"','2010000002').replaceAll('"2030000002"','2030000002');
  assert.equal((await record(f,second,numeric)).status,200);assert.equal(await count(f,'commerce_wallet_provider_accounts'),4);
});

test('provider profiles and account numbers cannot cross seller boundaries, including cash/pending cross-column collisions',async t=>{
  const f=await setupCommerceFixture(t),a=await enroll(f),b=await enroll(f,request({seller:'seller_bob',actor:actor('bob')}));
  for(const who of ['charlie','delta']){
    await f.db.prepare("INSERT INTO sellers(id,slug,name,created_at,updated_at) VALUES(?,?,?,'now','now')").bind('seller_'+who,who,who).run();
    await f.db.prepare("INSERT INTO app_users(id,auth_user_id,created_at,updated_at) VALUES(?,?,'now','now')").bind(who,who).run();
    await f.db.prepare("INSERT INTO seller_memberships(seller_id,auth_user_id,role,created_at) VALUES(?,?,'owner','now')").bind('seller_'+who,who).run();
  }
  const c=await enroll(f,request({seller:'seller_charlie',actor:actor('charlie')})),d=await enroll(f,request({seller:'seller_delta',actor:actor('delta')}));
  for(const e of [a,b,c,d]){const job=await claim(f,e);assert.equal((await bind(f,e,job)).status,200);}
  assert.equal((await record(f,a)).status,200);
  assert.equal((await record(f,b,evidence('SAC-fixture','2010000002','2030000002'))).status,409);
  assert.equal((await record(f,c,evidence('SAC-charlie','2030000001','2030000002'))).status,409);
  assert.equal((await record(f,d,evidence('SAC-delta','2010000002','2030000002'))).status,200);
  assert.equal(await count(f,'commerce_wallet_provider_profiles'),2);assert.equal(await count(f,'commerce_wallet_provider_accounts'),4);
  assert.equal((await record(f,a,evidence('SAC-replacement','2010000003','2030000003'))).status,409);
});

test('late confirmed provider evidence survives an expired lease while revoked owners cannot start provider registration',async t=>{
  const f=await setupCommerceFixture(t),e=await enroll(f),job=await claim(f,e);await bind(f,e,job);
  await f.db.prepare("UPDATE commerce_jobs SET lease_until='2000-01-01T00:00:00.000Z' WHERE id=?").bind(job.id).run();
  await f.call('/internal/commerce/jobs/claim',{environment:'sandbox',workerId:'wallet_worker',kinds:['wallet.register'],mode:'reconcile',limit:1});
  assert.equal((await record(f,e)).status,200);assert.equal((await read(f)).enrollment.status,'connected');
  const b=await enroll(f,request({seller:'seller_bob',actor:actor('bob')})),jobB=await claim(f,b);
  await f.db.prepare("UPDATE seller_memberships SET role='viewer' WHERE auth_user_id='bob'").run();
  const denied=await bind(f,b,jobB);assert.equal(denied.status,409,denied.error);assert.equal((await registration(f,b.id)).registration.ownerStillAuthorized,false);
  assert.equal(await count(f,'commerce_wallet_provider_bindings'),1);
});
