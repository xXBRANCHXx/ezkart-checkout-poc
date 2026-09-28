import {test} from 'node:test';
import assert from 'node:assert/strict';
import {setupCommerceFixture} from './commerce-fixture.mjs';
import {declaredSellerAge} from '../src/seller-onboarding.js';
const key=()=>crypto.randomUUID().replaceAll('-','');
const actor=(id='alice')=>({id,email:id+'@example.test',proofExpiresAt:new Date(Date.now()+550000).toISOString()});
const input=(action,extra={})=>({environment:'production',seller:'seller_alice',actor:actor(),action,...extra});
const path='/internal/commerce/onboarding';
test('18+ declaration uses the Indonesian calendar including leap dates',()=>{
 assert.equal(declaredSellerAge('2008-09-29',Date.parse('2026-09-28T16:59:59Z')),17);
 assert.equal(declaredSellerAge('2008-09-29',Date.parse('2026-09-28T17:00:00Z')),18);
 assert.equal(declaredSellerAge('2008-02-29',Date.parse('2026-02-28T05:00:00Z')),17);
 assert.equal(declaredSellerAge('2008-02-29',Date.parse('2026-03-01T05:00:00Z')),18);
 for(const date of ['2008-02-30','2007-02-29','2027-01-01','bad'])assert.throws(()=>declaredSellerAge(date,Date.parse('2026-09-28T00:00:00Z')),Response);
});
test('owner/MFA scope, immutable revisions, pinned address confirmation and declared age readiness',async t=>{
 const f=await setupCommerceFixture(t,{bindings:{APP_ENVIRONMENT:'beta'},declaredOnboarding:false});
 await f.db.prepare("UPDATE app_users SET email='alice@example.test' WHERE auth_user_id='alice'").run();
 assert.equal((await f.merchant(path,input('read'),{method:'POST'})).status,401);
 assert.equal((await f.call(path,input('read',{actor:actor('bob')}))).status,403);
 assert.equal((await f.call(path,input('read',{actor:{...actor(),proofExpiresAt:new Date(Date.now()-1).toISOString()}}))).status,401);
 const initial=await f.call(path,input('read'));assert.equal(initial.status,200,initial.error);assert.equal(initial.onboarding.ready,false);assert.equal(initial.onboarding.age.minimumAge,18);
 const profile=input('profile',{revision:0,requestKey:key(),legalName:'Alice Legal',birthDate:'1990-09-28',phone:'+6281234567890'});
 assert.equal((await f.call(path,{...profile,verified:true})).status,422);
 assert.equal((await f.call(path,{...profile,birthDate:'2015-01-01'})).status,422);
 const saved=await f.call(path,profile);assert.equal(saved.status,200,saved.error);assert.equal(saved.onboarding.email,'alice@example.test');assert.equal(saved.onboarding.emailVerified,true);
 assert.equal((await f.call(path,profile)).onboarding.profile.revision,1);
 assert.equal((await f.call(path,{...profile,phone:'081111111111'})).status,409);
 assert.equal((await f.call(path,{...profile,requestKey:key()})).status,409);
 const bank=input('bank',{revision:0,requestKey:key(),bank:{code:'CENAIDJA',accountNumber:'0000123456789',channel:'BI_FAST'}});
 assert.equal((await f.call(path,bank)).status,200);
 const confirmed=await f.call(path,input('confirm_pins',{revision:1,requestKey:key(),shippingRevision:1}));assert.equal(confirmed.status,200,confirmed.error);assert.equal(confirmed.onboarding.shipping.confirmed,true);assert.equal(confirmed.onboarding.ready,true);assert.equal(confirmed.onboarding.identity.status,'not_assessed');assert.equal(confirmed.onboarding.age.source,'seller_declared');assert.equal(confirmed.onboarding.age.meetsPolicy,true);
 const declaration=await f.db.prepare("SELECT declared_age,age_as_of_date,declared_birth_date FROM seller_onboarding_current WHERE seller_id='seller_alice'").first();assert.equal(declaration.declared_age,declaredSellerAge(declaration.declared_birth_date));assert.match(declaration.age_as_of_date,/^\d{4}-\d{2}-\d{2}$/);
 assert(!JSON.stringify(confirmed).includes('0000123456789'));
 assert.equal((await f.create(f.input())).status,200,'Complete seller declarations satisfy onboarding without an identity-proof assertion');
 assert.equal((await f.call('/internal/commerce/finance/wallet',input('enroll',{requestKey:key()}))).status,200);
 assert.equal(await f.db.prepare("SELECT name FROM sqlite_master WHERE name='seller_authenticated_identity'").first(),null);
 assert.equal((await f.db.prepare('SELECT COUNT(*) AS n FROM commerce_wallet_enrollments').first()).n,1);
 await assert.rejects(f.db.prepare("UPDATE seller_onboarding_banks SET account_number='999'").run(),/onboarding_immutable/);
 // A shipping change invalidates the owner's earlier confirmation.
 const shipping=(await f.merchant('/v1/shipping-settings')).settings.configuration;delete shipping.addresses[0].coordinate;
 assert.equal((await f.merchant('/v1/shipping-settings',{revision:1,requestKey:key(),configuration:shipping})).status,200);
 const missing=await f.call(path,input('read'));assert.equal(missing.onboarding.shipping.confirmed,false);assert.equal(missing.onboarding.shipping.pinsPresent,false);
 assert.equal((await f.call(path,input('confirm_pins',{revision:2,requestKey:key(),shippingRevision:2}))).status,409);assert.equal((await f.create(f.input())).status,409);
});
test('declared details remain versioned and changed shipping requires renewed pin confirmation',async t=>{
 const f=await setupCommerceFixture(t,{bindings:{APP_ENVIRONMENT:'beta'}});
 const read=async()=>(await f.call(path,input('read'))).onboarding;
 assert.equal((await read()).ready,true);
 assert.equal((await f.call('/internal/commerce/finance/withdrawals',{environment:'production',seller:'seller_alice',actor:actor(),requestKey:key(),amount:'250000',bank:{code:'CENAIDJA',accountNumber:'99999',channel:'BI_FAST'}})).status,422);
 const phone=await f.call(path,input('profile',{revision:2,requestKey:key(),legalName:'Fixture alice',birthDate:'1990-01-01',phone:'081111111111'}));assert.equal(phone.status,200,phone.error);
 assert.equal(phone.onboarding.identity.status,'not_assessed');assert.equal(phone.onboarding.profile.revision,3);
 const bank=await f.call(path,input('bank',{revision:1,requestKey:key(),bank:{code:'CENAIDJA',accountNumber:'99900012345',channel:'BI_FAST'}}));assert.equal(bank.status,200,bank.error);assert.equal(bank.onboarding.ready,true);
 const shipping=(await f.merchant('/v1/shipping-settings')).settings.configuration;shipping.addresses[0].address='Jalan Updated Warehouse 19';
 assert.equal((await f.merchant('/v1/shipping-settings',{revision:1,requestKey:key(),configuration:shipping})).status,200);
 const pending=await read();assert.equal(pending.ready,false);assert.equal(pending.identity.status,'not_assessed');assert.deepEqual(pending.requirements,['confirmed_pickup_return_pins']);
 const pinned=await f.call(path,input('confirm_pins',{revision:3,requestKey:key(),shippingRevision:2}));assert.equal(pinned.status,200,pinned.error);assert.equal(pinned.onboarding.ready,true);assert.equal(pinned.onboarding.profile.revision,4);
 const changed=await f.call(path,input('profile',{revision:4,requestKey:key(),legalName:'Alice Changed',birthDate:'1990-01-01',phone:'081234567890'}));assert.equal(changed.status,200,changed.error);assert.equal(changed.onboarding.profile.revision,5);
 assert.equal((await read()).ready,true);assert.equal((await read()).identity.status,'not_assessed');
 const before=(await read()).profile.revision;assert.equal((await f.call(path,input('profile',{revision:before,requestKey:key(),legalName:'Alice Changed',birthDate:'2015-01-01',phone:'081234567890'}))).status,422);assert.equal((await read()).profile.revision,before);
});

test('original uncertain production wallet remains readable and cannot register again after required profile email becomes stale',async t=>{
 const f=await setupCommerceFixture(t,{bindings:{APP_ENVIRONMENT:'beta'}}),wallet='/internal/commerce/finance/wallet',enrollmentInput=input('enroll',{requestKey:key()});
 const created=await f.call(wallet,enrollmentInput);assert.equal(created.status,200,created.error);const id=created.enrollment.id;
 const registration=await f.call(wallet+'/registrations/'+id+'?environment=production');const jobId=registration.registration.jobId;
 const claimed=await f.call('/internal/commerce/jobs/claim',{environment:'production',workerId:'wallet_worker',kinds:['wallet.register'],jobId,mode:'execute',limit:1,leaseSeconds:120});assert.equal(claimed.status,200,claimed.error);const job=claimed.jobs[0];
 const bind={environment:'production',workerId:'wallet_worker',leaseToken:job.leaseToken,credentialFingerprint:'a'.repeat(64),clientId:'MCH-fixture',parentProfileId:'BRN-fixture'};
 assert.equal((await f.call(wallet+'/registrations/'+id+'/bind',bind)).mayRegister,true);
 assert.equal((await f.call('/internal/commerce/jobs/'+job.id+'/finish',{environment:'production',workerId:'wallet_worker',leaseToken:job.leaseToken,outcome:'uncertain',result:{recorded:false}})).status,200);
 await f.db.prepare("UPDATE app_users SET email='updated@example.test' WHERE auth_user_id='alice'").run();
 assert.equal((await f.call(path,input('read'))).onboarding.wallet.status,'review');
 const replay=await f.call(wallet,enrollmentInput);assert.equal(replay.status,200,replay.error);assert.equal(replay.enrollment.id,id);
 assert.equal((await f.call(wallet,input('enroll',{requestKey:key()}))).status,409);
 const recovery=await f.call(wallet+'/registrations/'+id+'?environment=production');assert.equal(recovery.status,200);assert.equal(recovery.registration.jobState,'uncertain');assert(recovery.registration.binding);
 assert.equal((await f.db.prepare('SELECT COUNT(*) AS n FROM commerce_wallet_enrollments').first()).n,1);
});


test('email changes require a visible profile refresh without claiming identity verification',async t=>{
 const f=await setupCommerceFixture(t,{bindings:{APP_ENVIRONMENT:'beta'}}),read=async actorOverride=>(await f.call(path,input('read',actorOverride?{actor:actorOverride}:{}))).onboarding;
 assert.equal((await read()).ready,true);
 await f.db.prepare("UPDATE app_users SET email='new@example.test' WHERE auth_user_id='alice'").run();
 const changedActor={...actor(),email:'new@example.test'},changed=await read(changedActor);assert.equal(changed.ready,false);assert.equal(changed.identity.status,'not_assessed');assert.deepEqual(changed.requirements,['refresh_legal_profile']);
 const saved=await f.call(path,input('profile',{actor:changedActor,revision:changed.profileRevision,requestKey:key(),legalName:changed.profile.legalName,birthDate:changed.profile.birthDate,phone:changed.profile.phone}));assert.equal(saved.status,200,saved.error);assert.equal(saved.onboarding.ready,true);assert.equal(saved.onboarding.profile.revision,3);
});

test('a newly added owner cannot read or copy prior owner declarations and bank but can save a new revision',async t=>{
 const f=await setupCommerceFixture(t,{bindings:{APP_ENVIRONMENT:'beta'}});
 await f.db.prepare("INSERT INTO seller_memberships(seller_id,auth_user_id,role,created_at) VALUES('seller_alice','bob','owner','now')").run();
 const other=extra=>input('read',{actor:actor('bob'),...extra}),response=await f.call(path,other());assert.equal(response.status,200,response.error);const state=response.onboarding;
 assert.equal(state.ready,false);assert.equal(state.profile,null);assert.equal(state.bank,null);assert.equal(state.profileRevision,2);assert.equal(state.bankRevision,1);assert.equal(state.shipping.confirmed,false);
 assert(!JSON.stringify(state).includes('Fixture alice'));assert(!JSON.stringify(state).includes('1990-01-01'));assert(!JSON.stringify(state).includes('7890'));
 assert(state.requirements.includes('legal_name_phone'));assert(state.requirements.includes('saved_bank'));assert.equal(state.identity.status,'not_assessed');
 assert.equal((await f.call(path,other({action:'confirm_pins',revision:2,shippingRevision:1,requestKey:key()}))).status,409);
 const saved=await f.call(path,other({action:'profile',revision:state.profileRevision,requestKey:key(),legalName:'Bob Own Legal Name',birthDate:'1995-05-01',phone:'081111111111'}));assert.equal(saved.status,200,saved.error);assert.equal(saved.onboarding.profile.revision,3);assert.equal(saved.onboarding.profile.legalName,'Bob Own Legal Name');assert.equal(saved.onboarding.shipping.confirmed,false);assert.equal(saved.onboarding.ready,false);
 const bank=await f.call(path,other({action:'bank',revision:state.bankRevision,requestKey:key(),bank:{code:'CENAIDJA',accountNumber:'000999999999',channel:'BI_FAST'}}));assert.equal(bank.status,200,bank.error);assert.equal(bank.onboarding.bank.revision,2);
 const previous=await f.call(path,input('read'));assert.equal(previous.onboarding.profile,null);assert.equal(previous.onboarding.bank,null);assert.equal(previous.onboarding.ready,false);
});


test('SQL readiness independently applies declared DOB age policy and snapshots must match its calculation',async t=>{
 const f=await setupCommerceFixture(t,{bindings:{APP_ENVIRONMENT:'beta'}}),p=await f.db.prepare("SELECT * FROM seller_onboarding_current WHERE seller_id='seller_alice'").first();
 assert.equal(p.declared_age,declaredSellerAge(p.declared_birth_date));
 await assert.rejects(f.db.prepare(`INSERT INTO seller_onboarding_profiles(seller_id,revision,request_key,request_hash,owner_auth_id,declared_age,age_as_of_date,legal_name,declared_birth_date,verified_email,phone,confirmed_shipping_revision,proof_expires_at,created_at)
 SELECT seller_id,revision+1,?,request_hash,owner_auth_id,declared_age+1,age_as_of_date,legal_name,declared_birth_date,verified_email,phone,confirmed_shipping_revision,proof_expires_at,created_at FROM seller_onboarding_current WHERE seller_id='seller_alice'`).bind(key()).run(),/onboarding_declared_age_invalid/);
 await f.db.prepare('UPDATE seller_onboarding_policy SET minimum_age=? WHERE id=1').bind(p.declared_age+1).run();
 assert.equal(await f.db.prepare("SELECT * FROM seller_onboarding_ready WHERE seller_id='seller_alice'").first(),null);
 const state=(await f.call(path,input('read'))).onboarding;assert.equal(state.ready,false);assert(state.requirements.includes('age_declaration'));assert.equal(state.identity.status,'not_assessed');assert.equal((await f.create(f.input())).status,409);
});

test('topbar completion flag contains no personal details and follows confirmed onboarding and ownership',async t=>{
 const f=await setupCommerceFixture(t,{bindings:{APP_ENVIRONMENT:'beta'},declaredOnboarding:false}),route='/v1/commerce/notifications/onboarding';
 await f.db.prepare("UPDATE app_users SET email='alice@example.test' WHERE auth_user_id='alice'").run();
 const status=()=>f.merchant(route,undefined,{email:'alice@example.test'});
 const first=await status();assert.equal(first.status,200,first.error);assert.equal(first.owner,true);assert.equal(first.complete,false);
 assert.deepEqual(Object.keys(first).sort(),['complete','ok','owner','status']);
 await f.call(path,input('profile',{revision:0,requestKey:key(),legalName:'Alice Legal',birthDate:'1990-01-01',phone:'081234567890'}));
 await f.call(path,input('bank',{revision:0,requestKey:key(),bank:{code:'CENAIDJA',accountNumber:'0000123456789',channel:'BI_FAST'}}));
 assert.equal((await status()).complete,false);
 await f.call(path,input('confirm_pins',{revision:1,requestKey:key(),shippingRevision:1}));assert.equal((await status()).complete,true);
 const shipping=(await f.merchant('/v1/shipping-settings')).settings.configuration;shipping.addresses[0].address='Changed pickup address';await f.merchant('/v1/shipping-settings',{revision:1,requestKey:key(),configuration:shipping});assert.equal((await status()).complete,false);
 await f.db.prepare("UPDATE seller_memberships SET role='viewer' WHERE seller_id='seller_alice' AND auth_user_id='alice'").run();assert.equal((await status()).owner,false);
 assert.equal((await f.merchant('/v1/customer/notifications/onboarding')).status,404);
});
