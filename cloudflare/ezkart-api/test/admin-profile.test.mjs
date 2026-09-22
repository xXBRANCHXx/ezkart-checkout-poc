import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { build } from 'esbuild';
import { Miniflare, convertV4MiniflareOptions } from 'miniflare';

test('admin profile logos persist privately, enforce ownership and keep storefront and landing branding separate', async t => {
  const key=await crypto.subtle.generateKey({name:'ECDSA',namedCurve:'P-256'},true,['sign','verify']);
  const publicKey={...await crypto.subtle.exportKey('jwk',key.publicKey),kid:'profile-test',alg:'ES256',use:'sig'};
  const bundle=await build({entryPoints:[new URL('../src/index.js',import.meta.url).pathname],bundle:true,write:false,format:'esm',platform:'neutral'});
  const mf=new Miniflare(convertV4MiniflareOptions({
    modules:true,script:bundle.outputFiles[0].text,compatibilityDate:'2026-08-11',
    d1Databases:['DB'],r2Buckets:['PUBLIC_ASSETS','PRIVATE_ASSETS'],
    bindings:{APP_ENVIRONMENT:'test',SUPABASE_URL:'https://auth.fixture.test'},
    outboundService:async()=>Response.json({keys:[publicKey]}),
  }));
  t.after(()=>mf.dispose());
  const db=await mf.getD1Database('DB'), bucket=await mf.getR2Bucket('PUBLIC_ASSETS');
  for(const migration of ['0001_core.sql','0002_cloud_catalog.sql']) {
    const sql=await readFile(new URL('../migrations/'+migration,import.meta.url),'utf8');
    for(const statement of sql.replace(/--[^\n]*/g,'').split(';').filter(s=>s.trim()))await db.prepare(statement).run();
  }
  const branding={storefront:{logoId:'shop_logo',name:'Shop branding'},landingPreference:'preserve-me'};
  for(const id of ['alice','bob']) {
    await db.prepare("INSERT INTO app_users(id,auth_user_id,created_at,updated_at) VALUES (?,?,'now','now')").bind(id,id).run();
    await db.prepare("INSERT INTO sellers(id,slug,name,status,settings_json,created_at,updated_at) VALUES (?,?,?,'active',?,'now','now')").bind('seller_'+id,id,id,JSON.stringify(branding)).run();
    await db.prepare("INSERT INTO seller_memberships(seller_id,auth_user_id,role,created_at) VALUES (?,?,'owner','now')").bind('seller_'+id,id).run();
    await db.prepare("INSERT INTO media_uploads(id,seller_id,r2_key,mime_type,size_bytes,created_by_auth_user_id,created_at) VALUES (?,?,?,'image/png',1,?,'2000-01-01')").bind('logo_'+id,'seller_'+id,'logo_'+id,id).run();
    await bucket.put('logo_'+id,'fixture');
  }
  async function token(id) {
    const head=Buffer.from(JSON.stringify({alg:'ES256',kid:publicKey.kid})).toString('base64url');
    const body=Buffer.from(JSON.stringify({iss:'https://auth.fixture.test/auth/v1',sub:id,aud:'authenticated',exp:Math.floor(Date.now()/1000)+3600})).toString('base64url');
    const signature=await crypto.subtle.sign({name:'ECDSA',hash:'SHA-256'},key.privateKey,new TextEncoder().encode(head+'.'+body));
    return head+'.'+body+'.'+Buffer.from(signature).toString('base64url');
  }
  const alice=await token('alice'),bob=await token('bob');
  async function call(access='',payload) {
    const response=await mf.dispatchFetch('https://api.fixture.test/v1/admin-profile',{
      method:payload===undefined?'GET':'PUT',
      headers:{...(access?{authorization:'Bearer '+access}:{}),'content-type':'application/json'},
      ...(payload===undefined?{}:{body:JSON.stringify(payload)}),
    });
    return {status:response.status,...await response.json()};
  }
  assert.equal((await call()).status,401);
  assert.deepEqual((await call(alice)).profile,{logoId:'',canEdit:true});
  assert.equal((await call(alice,{logoId:'logo_bob'})).status,422);
  for(const logoId of [null,12,'https://example.com/logo.png','../logo_bob'])assert.equal((await call(alice,{logoId})).status,422);
  assert.equal((await call(alice,{})).status,422);
  const saved=await call(alice,{logoId:'logo_alice'});
  assert.equal(saved.status,200);
  assert.equal((await call(alice)).profile.logoId,'logo_alice');
  assert.equal((await call(bob)).profile.logoId,'');
  const settings=JSON.parse((await db.prepare("SELECT settings_json FROM sellers WHERE id='seller_alice'").first()).settings_json);
  assert.deepEqual(settings,{...branding,adminProfile:{logoId:'logo_alice'}});
  assert.equal((await mf.dispatchFetch('https://api.fixture.test/v1/public/media/logo_alice')).status,404,'Admin-only logo is not published as storefront media');
  const privateLogo=await mf.dispatchFetch('https://api.fixture.test/v1/media/logo_alice',{headers:{authorization:'Bearer '+alice}});
  assert.equal(privateLogo.status,200);
  assert.match(privateLogo.headers.get('cache-control'),/^private/);
  assert.equal((await mf.dispatchFetch('https://api.fixture.test/v1/media/logo_alice',{headers:{authorization:'Bearer '+bob}})).status,404);
  await (await mf.getWorker()).scheduled({cron:'17 * * * *'});
  assert.ok(await db.prepare("SELECT id FROM media_uploads WHERE id='logo_alice'").first(),'Saved profile logo survives cleanup');
  await db.prepare("UPDATE seller_memberships SET role='viewer' WHERE auth_user_id='alice'").run();
  assert.equal((await call(alice)).profile.canEdit,false);
  assert.equal((await call(alice,{logoId:''})).status,403);
  await db.prepare("UPDATE seller_memberships SET role='owner' WHERE auth_user_id='alice'").run();
  assert.equal((await call(alice,{logoId:''})).profile.logoId,'');
  assert.deepEqual(JSON.parse((await db.prepare("SELECT settings_json FROM sellers WHERE id='seller_alice'").first()).settings_json),{...branding,adminProfile:{logoId:''}});
  await (await mf.getWorker()).scheduled({cron:'17 * * * *'});
  assert.equal(await db.prepare("SELECT id FROM media_uploads WHERE id='logo_alice'").first(),null,'Removed logo can be cleaned up');
});
