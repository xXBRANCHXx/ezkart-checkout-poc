import test from 'node:test';
import assert from 'node:assert/strict';
import {randomBytes,randomUUID} from 'node:crypto';
import {setupCommerceFixture} from './commerce-fixture.mjs';
import {emailFixtureConfiguration,emailFixtureEvent,emailFixtureCallback} from './email-fixture.mjs';
import {lookupEmail,resolveEmail,emailInvestigations} from '../src/email-investigation.js';
import {emailLookupConfiguration,emailConfiguration,retrieveResendEmail} from '../src/email-provider.js';
import {dispatchEmails,recordEmailWebhook} from '../src/commerce-email-delivery.js';
import {applyCommerceSchema} from './commerce-schema.mjs';

const key=()=>randomBytes(16).toString('hex');
async function fixture(t,{through=Infinity}={}){
  const control={sent:[],reads:[],lost:false,read:null,hook:null};
  const config={...emailFixtureConfiguration(),COMMERCE_EMAIL_RECONCILE:'enabled',RESEND_READ_API_KEY:'re_fixture_reader_only'};
  const outbound=async request=>{
    const url=new URL(request.url);
    if(url.origin==='https://auth.fixture.test'){
      const id=url.pathname.split('/').at(-1);return Response.json({id,email:id+'@example.test',email_confirmed_at:'2026-09-01T00:00:00Z'});
    }
    assert.equal(url.origin,'https://api.resend.com');
    if(request.method==='POST'){
      assert.equal(url.pathname,'/emails');const payload=await request.json(),id=randomUUID();control.sent.push({payload,id,createdAt:new Date().toISOString()});
      if(control.lost)throw Error('Fixture lost the sending acknowledgement');return Response.json({id});
    }
    assert.equal(request.method,'GET');assert.match(url.pathname,/^\/emails\/[a-f0-9-]{36}$/);assert.equal(request.headers.get('authorization'),'Bearer '+config.RESEND_READ_API_KEY);
    control.reads.push(url.pathname);if(control.hook)await control.hook();
    const sent=control.sent.find(s=>url.pathname.endsWith(s.id))||control.sent[0];
    const data={object:'email',id:sent.id,...sent.payload,created_at:sent.createdAt.replace('T',' ').replace('Z','000+00'),bcc:[],cc:[],reply_to:[],scheduled_at:null,last_event:'delivered'};
    return control.read?control.read(data):Response.json(data);
  };
  const f=await setupCommerceFixture(t,{through,notifications:'enabled',bindings:config,outbound}),env={...config,DB:f.db};
  await f.product('email_test',100);
  const prefs=await f.merchant('/v1/commerce/settings');prefs.notifications.values.payment_confirmed.email=true;
  assert.equal((await f.merchant('/v1/commerce/settings',{kind:'notifications',revision:prefs.notifications.revision,values:prefs.notifications.values,requestKey:key()},{method:'POST'})).status,200);
  const make=async()=>{
    const created=await f.create(f.input({items:[{productId:'email_test',quantity:1,expectedPrice:20000,expectedWeightGrams:100}]}));assert.equal(created.status,200,created.error);assert.equal((await f.paid(created.order)).status,200);
    assert.equal((await f.call('/internal/commerce/notifications/drain',{environment:'sandbox'})).failed,0);
    await f.call('/internal/commerce/email/drain',{environment:'sandbox'});
    return f.db.prepare('SELECT * FROM commerce_email_requests ORDER BY rowid DESC LIMIT 1').first();
  };
  const lookupInput=x=>({environment:'sandbox',requestId:x.id,providerId:control.sent.find(s=>JSON.stringify(s.payload)===x.request_json)?.id||control.sent.at(-1).id,lookupKey:key(),operator:'fixture_operator'});
  const lookup=input=>f.call('/internal/commerce/email/lookup',input);
  const job=x=>f.db.prepare('SELECT * FROM commerce_jobs WHERE id=?').bind(x.job_id).first();
  const resolveInput=async(x,l)=>({environment:'sandbox',requestId:x.id,lookupKey:l,operator:'fixture_operator',resolutionKey:key(),expectedUpdatedAt:(await job(x)).updated_at});
  const fetcher=(url,options)=>outbound(new Request(url,options));
  return {...f,env,config,control,make,lookupInput,lookup,job,resolveInput,fetcher};
}

test('read-only lookup recovers a lost provider ID and resolves an exhausted job with immutable evidence and no resend',async t=>{
  const f=await fixture(t);f.control.lost=true;const x=await f.make();assert.equal((await f.job(x)).state,'uncertain');
  await f.db.prepare("UPDATE commerce_jobs SET state='dead' WHERE id=?").bind(x.job_id).run();
  const input=f.lookupInput(x),looked=await f.lookup(input);assert.equal(looked.status,200,JSON.stringify(looked));assert.equal(looked.receipt.outcome,'matched');
  assert.equal(looked.receipt.kind,'delivered');assert.equal(f.control.reads.length,1);assert.equal((await f.job(x)).state,'dead');
  const binding=await f.db.prepare('SELECT * FROM commerce_email_verified_bindings WHERE request_id=?').bind(x.id).first();assert.equal(binding.provider_id,input.providerId);
  const resolve=await f.resolveInput(x,input.lookupKey),done=await f.call('/internal/commerce/email/resolve',resolve);assert.equal(done.status,200,JSON.stringify(done));
  assert.equal((await f.job(x)).state,'succeeded');assert.equal((await f.call('/internal/commerce/email/resolve',resolve)).replayed,true);
  assert.equal((await f.lookup(input)).replayed,true);assert.equal(f.control.reads.length,1);
  assert.equal((await dispatchEmails(f.env,2,f.fetcher)).processed,0);assert.equal(f.control.sent.length,1);
  const inbox=await f.merchant('/v1/commerce/notifications/email');assert.equal(inbox.items[0].email.status,'delivered');assert.equal(inbox.items[0].email.deliveredAt,null);
  assert(inbox.items[0].email.checkedAt&&inbox.items[0].email.resolvedAt);assert(!JSON.stringify(inbox).includes('alice@example.test'));
  const attempts=await f.db.prepare('SELECT * FROM commerce_job_attempts WHERE job_id=?').bind(x.job_id).all();assert.equal(attempts.results.length,1);assert.equal(attempts.results[0].outcome,'uncertain');
  for(const table of ['commerce_email_lookups','commerce_email_lookup_results','commerce_email_lookup_bindings','commerce_email_resolutions'])await assert.rejects(f.db.prepare('DELETE FROM '+table).run(),/email_immutable/);
  assert.equal((await f.call('/internal/commerce/email/resolve',{...resolve,resolutionKey:key()})).status,409);
});

test('known-ID observations retain real callback timestamps and address suppression; delayed observations cannot override terminal evidence',async t=>{
  const f=await fixture(t),x=await f.make(),input=f.lookupInput(x);
  f.control.read=data=>Response.json({...data,last_event:'delivery_delayed'});assert.equal((await f.lookup(input)).receipt.kind,'delayed');
  f.control.read=null;assert.equal((await f.lookup({...input,lookupKey:key()})).receipt.kind,'delivered');
  const attention=await f.merchant('/v1/commerce/notifications/processing?state=attention');assert.equal(attention.items.filter(r=>r.kind==='notification.send').length,0);
  const sent=f.control.sent[0],callback=emailFixtureCallback(emailFixtureEvent(sent.payload,sent.id));await recordEmailWebhook(callback,f.env,'test_mail');
  const inbox=await f.merchant('/v1/commerce/notifications/email');assert(inbox.items[0].email.deliveredAt);
  f.control.read=data=>Response.json({...data,last_event:'bounced'});assert.equal((await f.lookup({...input,lookupKey:key()})).receipt.kind,'bounced');
  assert.equal((await f.merchant('/v1/commerce/notifications/email')).items[0].email.status,'bounced');
  await f.make();assert.equal(f.control.sent.length,1);const skipped=await f.db.prepare('SELECT * FROM commerce_email_skips').first();assert.equal(skipped.reason,'suppressed');
  assert.equal((await f.merchant('/v1/commerce/notifications/stats')).email_attention,1);
});

test('404, provider errors, mismatched identities and unsupported states never prove delivery or authorize retry',async t=>{
  const f=await fixture(t);f.control.lost=true;
  for(const [change,outcome] of [
    [()=>Response.json({message:'not found'},{status:404}),'not_found'],[()=>Response.json({message:'rate'},{status:429}),'unavailable'],
    [()=>Response.json({message:'no permission'},{status:403}),'rejected'],[d=>Response.json({...d,to:['another@example.test']}),'mismatch'],
    [d=>Response.json({...d,tags:[]}),'mismatch'],[d=>Response.json({...d,created_at:'2000-01-01 00:00:00+00'}),'mismatch'],
    [d=>Response.json({...d,bcc:['another@example.test']}),'mismatch'],[d=>Response.json({...d,last_event:'invented'}),'invalid']]){
    const x=await f.make();f.control.read=change;const input=f.lookupInput(x),result=await f.lookup(input);assert.equal(result.receipt?.outcome,outcome,JSON.stringify(result));
    assert.equal((await f.job(x)).state,'uncertain');assert.equal((await f.call('/internal/commerce/email/resolve',await f.resolveInput(x,input.lookupKey))).status,409);
    assert.equal(await f.db.prepare('SELECT * FROM commerce_email_verified_bindings WHERE request_id=?').bind(x.id).first(),null);
  }
  assert.equal(f.control.sent.length,8);
});

test('lookup identity, service authentication, body ambiguity, provider configuration and retry rate are enforced',async t=>{
  const f=await fixture(t);f.control.lost=true;const x=await f.make(),input=f.lookupInput(x);
  const unauth=await f.mf.dispatchFetch('https://fixture.test/internal/commerce/email/lookup',{method:'POST',body:JSON.stringify(input)});assert.equal(unauth.status,401);
  const path='/internal/commerce/email/lookup';
  for(const body of ['{"environment":"sandbox","environment":"sandbox"}',JSON.stringify({...input,padding:'x'.repeat(3000)}),new Uint8Array([255,255])]){
    const response=await f.mf.dispatchFetch('https://fixture.test'+path,{method:'POST',headers:f.headers(path,'POST',body),body});assert.equal(response.status,body.length>3000?413:422);
  }
  for(const changed of [{...input,environment:'production'},{...input,operator:'invalid value'},{...input,requestId:'email_bad'},{...input,body:{}},{...input,providerId:'https://evil.test'}])assert((await f.lookup(changed)).status>=400);
  assert.equal(f.control.reads.length,0);
  assert.equal((await f.lookup(input)).status,200);
  assert.equal((await f.lookup({...input,providerId:randomUUID()})).status,409);
  assert.equal((await f.lookup({...input,operator:'another_operator'})).status,409);
  for(let n=0;n<2;n++)assert.equal((await f.lookup({...input,lookupKey:key()})).status,200);
  assert.equal((await f.lookup({...input,lookupKey:key()})).status,429);assert.equal(f.control.reads.length,3);
  assert.equal((await f.lookup(input)).replayed,true);
  await assert.rejects(lookupEmail({...f.env,RESEND_API_KEY:'re_different_fixture_key'},{...input,lookupKey:key()},f.fetcher),e=>e.status===409);
  await assert.rejects(lookupEmail({...f.env,COMMERCE_EMAIL_RECONCILE:'off'},{...input,lookupKey:key()},f.fetcher),e=>e.status===503);
  assert.equal(emailConfiguration({...f.env,COMMERCE_EMAIL_SEND:'off'}).ready,false);assert.equal(emailLookupConfiguration({...f.env,COMMERCE_EMAIL_SEND:'off',SUPABASE_SERVICE_ROLE_KEY:''}).ready,true);
  assert.equal(emailLookupConfiguration({...f.env,COMMERCE_STORAGE:'legacy'}).ready,false);
});

test('concurrent and lost database acknowledgements replay one durable lookup and resolution',async t=>{
  const f=await fixture(t);f.control.lost=true;const x=await f.make(),input=f.lookupInput(x);
  const results=await Promise.all([f.lookup(input),f.lookup(input)]);assert(results.every(r=>r.status===200&&r.receipt.outcome==='matched'),JSON.stringify(results));
  assert.equal((await f.db.prepare('SELECT COUNT(*) AS n FROM commerce_email_lookup_results').first()).n,1);
  let lost=false;
  const db=new Proxy(f.db,{get(target,property){if(property==='prepare')return sql=>{const statement=target.prepare(sql);if(!sql.includes('INSERT INTO commerce_email_resolutions'))return statement;
    return {bind(...args){return {async run(){const result=await statement.bind(...args).run();if(!lost){lost=true;throw Error('Fixture lost committed resolution acknowledgement');}return result;}};}};};const value=Reflect.get(target,property);return typeof value==='function'?value.bind(target):value;}});
  const resolve=await f.resolveInput(x,input.lookupKey),done=await resolveEmail({...f.env,DB:db},resolve);assert(done.resolution);assert.equal(done.replayed,true);
  assert.equal((await f.job(x)).state,'succeeded');assert.equal(f.control.sent.length,1);
});

test('a conflicting callback during lookup preserves the first identity and saves conflict evidence',async t=>{
  const f=await fixture(t);f.control.lost=true;const x=await f.make(),input=f.lookupInput(x),otherId=randomUUID();
  f.control.hook=async()=>recordEmailWebhook(emailFixtureCallback(emailFixtureEvent(f.control.sent[0].payload,otherId)),f.env,'test_mail');
  const result=await f.lookup(input);assert.equal(result.status,200,JSON.stringify(result));assert.equal(result.receipt.outcome,'conflict');
  assert.equal((await f.db.prepare('SELECT * FROM commerce_email_verified_bindings WHERE request_id=?').bind(x.id).first()).provider_id,otherId);
  assert.equal((await f.call('/internal/commerce/email/resolve',await f.resolveInput(x,input.lookupKey))).status,409);
  const raw=await f.db.prepare('SELECT raw_body FROM commerce_email_lookup_results').first();assert(raw.raw_body.includes(input.providerId));
});

test('stale job revisions, active jobs, unknown dead failures and evidence conflicts cannot be resolved',async t=>{
  const f=await fixture(t);f.control.lost=true;const x=await f.make(),input=f.lookupInput(x);await f.lookup(input);
  const resolve=await f.resolveInput(x,input.lookupKey);
  assert.equal((await f.call('/internal/commerce/email/resolve',{...resolve,expectedUpdatedAt:'2000-01-01T00:00:00.000Z'})).status,409);
  for(const [state,result] of [['running',{}],['dead',{}],['dead',{errorCode:'email_evidence_conflict'}]]){
    await f.db.prepare('UPDATE commerce_jobs SET state=?,result_json=? WHERE id=?').bind(state,JSON.stringify(result),x.job_id).run();
    assert.equal((await f.call('/internal/commerce/email/resolve',resolve)).status,409);
  }
  assert.equal((await f.db.prepare('SELECT COUNT(*) AS n FROM commerce_email_resolutions').first()).n,0);
});

test('operator views are private, environment-bound and omit recipients, raw payloads and credentials',async t=>{
  const f=await fixture(t);f.control.lost=true;const x=await f.make(),input=f.lookupInput(x);await f.lookup(input);
  const list=await f.call('/internal/commerce/email/investigations?environment=sandbox');assert.equal(list.status,200,JSON.stringify(list));assert.equal(list.items[0].id,x.id);
  const detail=await f.call('/internal/commerce/email/investigations/'+x.id+'?environment=sandbox');assert.equal(detail.status,200);assert.equal(detail.lookups[0].lookupKey,input.lookupKey);
  for(const value of [list,detail]){const raw=JSON.stringify(value);assert(!raw.includes('alice@example.test'));assert(!raw.includes('re_fixture'));assert(!raw.includes('<html'));}
  assert.equal((await f.call('/internal/commerce/email/investigations?environment=sandbox&state=unknown')).status,422);
  assert.equal((await f.call('/internal/commerce/email/investigations?environment=production')).status,403);
  assert.equal((await f.call('/internal/commerce/email/investigations?environment=sandbox&environment=sandbox')).status,422);
  await assert.rejects(emailInvestigations(f.env,new URL('https://fixture.test/?environment=sandbox&cursor=bad')),e=>e.status===422);
});

test('lookup adapter rejects redirects, duplicate keys, oversized or malformed responses and never makes a provider write',async()=>{
  const env={...emailFixtureConfiguration(),COMMERCE_EMAIL_RECONCILE:'enabled'},id=randomUUID();let calls=0;
  for(const response of [new Response('',{status:302,headers:{location:'https://evil.test'}}),new Response('{"id":"a","id":"b"}',{status:200}),
    new Response('x'.repeat(98305),{status:200}),new Response(new Uint8Array([255,255]),{status:200})]){
    const result=await retrieveResendEmail(env,id,async(url,options)=>{calls++;assert.equal(url,'https://api.resend.com/emails/'+id);assert.equal(options.method,'GET');assert.equal(options.redirect,'manual');return response;});
    assert.equal(result.outcome,'invalid');
  }
  assert.equal(calls,4);
});

test('database evidence guards reject forged provider identities and later callbacks cannot replace lookup bindings',async t=>{
  const f=await fixture(t);f.control.lost=true;const x=await f.make(),input=f.lookupInput(x);await f.lookup(input);
  const original=await f.db.prepare('SELECT * FROM commerce_email_lookup_results WHERE lookup_key=?').bind(input.lookupKey).first();
  const intent=await f.db.prepare('SELECT * FROM commerce_email_lookups WHERE lookup_key=?').bind(input.lookupKey).first(),second=key();
  await f.db.prepare('INSERT INTO commerce_email_lookups SELECT ?,request_id,provider_id,credential_hash,reader_hash,operator_id,created_at FROM commerce_email_lookups WHERE lookup_key=?').bind(second,input.lookupKey).run();
  for(const data of [{...JSON.parse(original.raw_body),id:randomUUID()},{...JSON.parse(original.raw_body),tags:[]},{...JSON.parse(original.raw_body),to:['foreign@example.test']}]){
    await assert.rejects(f.db.prepare('INSERT INTO commerce_email_lookup_results VALUES(?,?,?,?,?,?,?,?)').bind(second,'matched',200,JSON.stringify(data),original.body_hash,'delivered',original.provider_created_at,original.observed_at).run(),/email_lookup_invalid/);
  }
  await assert.rejects(f.db.prepare('INSERT INTO commerce_email_lookup_bindings VALUES(?,?,?,?,?,?)').bind(x.id,'sandbox',x.profile_id,randomUUID(),second,intent.created_at).run(),/email_lookup_invalid|email_immutable|email_lookup_provider_conflict/);
  await assert.rejects(recordEmailWebhook(emailFixtureCallback(emailFixtureEvent(f.control.sent[0].payload,randomUUID())),f.env,'test_mail'),e=>e.status===409);
  await recordEmailWebhook(emailFixtureCallback(emailFixtureEvent(f.control.sent[0].payload,input.providerId)),f.env,'test_mail');
  assert.equal((await f.db.prepare('SELECT COUNT(*) AS n FROM commerce_email_verified_bindings WHERE request_id=?').bind(x.id).first()).n,1);
});

test('investigation list paging preserves its snapshot and rejects cursors from another filter',async t=>{
  const f=await fixture(t);for(let i=0;i<21;i++)await f.make();
  const base='/internal/commerce/email/investigations?environment=sandbox&state=all',first=await f.call(base);assert.equal(first.status,200,JSON.stringify(first));assert.equal(first.items.length,20);assert(first.nextCursor);
  const newer=await f.make(),last=await f.call(base+'&cursor='+first.nextCursor);assert.equal(last.items.length,1);assert.equal(last.nextCursor,null);
  assert(![...first.items,...last.items].some(r=>r.id===newer.id));assert.equal(new Set([...first.items,...last.items].map(r=>r.id)).size,21);
  assert.equal((await f.call('/internal/commerce/email/investigations?environment=sandbox&cursor='+first.nextCursor)).status,422);
});

test('migration preserves existing email requests, events and bindings',async t=>{
  const f=await fixture(t,{through:31});
  assert.equal((await f.db.prepare("SELECT COUNT(*) AS n FROM sqlite_master WHERE name='commerce_email_lookups'").first()).n,0);
  // Compatibility views let the current sender seed real pre-migration tables.
  // Remove them before applying the migration; no new receipt table exists yet.
  await f.db.prepare('CREATE VIEW commerce_email_verified_bindings AS SELECT request_id,commerce_environment,profile_id,provider_id,created_at FROM commerce_email_provider_bindings').run();
  await f.db.prepare('CREATE VIEW commerce_email_delivery_evidence AS SELECT request_id,kind,occurred_at,received_at AS observed_at,source FROM commerce_email_events').run();
  await f.db.prepare("CREATE VIEW commerce_email_suppressions AS SELECT x.commerce_environment,x.email_hash FROM commerce_email_requests x JOIN commerce_email_events e ON e.request_id=x.id WHERE e.kind IN ('bounced','complained','suppressed')").run();
  const x=await f.make();assert(x);
  const tables=['commerce_email_requests','commerce_email_starts','commerce_email_events','commerce_email_provider_bindings'];
  const before=await Promise.all(tables.map(table=>f.db.prepare('SELECT * FROM '+table+' ORDER BY rowid').all()));
  await f.db.prepare('DROP VIEW commerce_email_verified_bindings').run();await f.db.prepare('DROP VIEW commerce_email_delivery_evidence').run();
  await f.db.prepare('DROP VIEW commerce_email_suppressions').run();
  await applyCommerceSchema(f.db,31,32);
  assert.equal((await f.db.prepare('PRAGMA foreign_key_check').all()).results.length,0);
  for(let i=0;i<tables.length;i++)assert.deepEqual((await f.db.prepare('SELECT * FROM '+tables[i]+' ORDER BY rowid').all()).results,before[i].results);
  assert.equal((await f.lookup(f.lookupInput(x))).receipt.outcome,'matched');
});
