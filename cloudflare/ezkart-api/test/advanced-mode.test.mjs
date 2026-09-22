import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { build } from 'esbuild';
import { Miniflare, convertV4MiniflareOptions } from 'miniflare';

test('Advanced persists per store, enforces permissions, and changes page and product limits', async t => {
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
  for(const migration of ['0001_core.sql','0002_cloud_catalog.sql','0005_product_limit.sql','0007_advanced_product_limit.sql']) {
    const sql=await readFile(new URL('../migrations/'+migration,import.meta.url),'utf8');
    const clean=sql.replace(/--[^\n]*/g,'');
    const triggers=[...clean.matchAll(/CREATE TRIGGER[\s\S]*?END;/g)].map(m=>m[0]);
    for(const statement of [...clean.replace(/CREATE TRIGGER[\s\S]*?END;/g,'').split(';').filter(s=>s.trim()),...triggers])await db.prepare(statement).run();
  }
  for (const id of ['alice', 'bob']) {
    await db.prepare("INSERT INTO app_users(id,auth_user_id,created_at,updated_at) VALUES (?,?,'now','now')").bind(id,id).run();
    await db.prepare("INSERT INTO sellers(id,slug,name,status,settings_json,created_at,updated_at) VALUES (?,?,?,'active',?,'now','now')").bind('seller_'+id,id,id,JSON.stringify({keep:true})).run();
    await db.prepare("INSERT INTO seller_memberships(seller_id,auth_user_id,role,created_at) VALUES (?,?,'owner','now')").bind('seller_'+id,id).run();
  }
  async function token(id) {
    const head=Buffer.from(JSON.stringify({alg:'ES256',kid:publicKey.kid})).toString('base64url');
    const body=Buffer.from(JSON.stringify({iss:'https://auth.fixture.test/auth/v1',sub:id,aud:'authenticated',exp:Math.floor(Date.now()/1000)+3600})).toString('base64url');
    const signature=await crypto.subtle.sign({name:'ECDSA',hash:'SHA-256'},key.privateKey,new TextEncoder().encode(head+'.'+body));
    return head+'.'+body+'.'+Buffer.from(signature).toString('base64url');
  }
  const alice=await token('alice'),bob=await token('bob');
  async function call(path, payload, access = alice, method = payload === undefined ? 'GET' : 'PUT') {
    const response = await mf.dispatchFetch('https://api.fixture.test/v1/' + path, {
      method, headers: { ...(access ? {authorization:'Bearer '+access} : {}), 'content-type':'application/json' },
      ...(payload === undefined ? {} : {body:JSON.stringify(payload)}),
    });
    return {status:response.status, ...await response.json()};
  }
  assert.equal((await call('advanced-mode',undefined,'')).status,401);
  assert.deepEqual((await call('advanced-mode')).plan,{enabled:false,canEdit:true,limits:{landingPages:6,products:10},commissionPercent:5});
  for(const payload of [{},{enabled:'yes'},{enabled:true},{enabled:true,commissionPercent:5}])
    assert.equal((await call('advanced-mode',payload)).status,422);
  for(const role of ['viewer','editor','admin']) {
    await db.prepare("UPDATE seller_memberships SET role=? WHERE auth_user_id='alice'").bind(role).run();
    assert.equal((await call('advanced-mode')).plan.canEdit,false);
    assert.equal((await call('advanced-mode',{enabled:true,commissionPercent:6})).status,403);
  }
  await db.prepare("UPDATE seller_memberships SET role='owner' WHERE auth_user_id='alice'").run();
  const page={name:'Campaign',status:'draft',state:{version:6},products:[]};
  for(let i=0;i<6;i++)assert.equal((await call('landing-pages/page-'+i,page)).status,200);
  assert.equal((await call('landing-pages/page-6',page)).status,409);
  async function insertProduct(i) {
    return db.prepare("INSERT INTO products(id,seller_id,type,title,price_amount,created_at,updated_at) VALUES (?,'seller_alice','digital','Fixture product',100000,'now','now')").bind('product_'+i).run();
  }
  for(let i=0;i<10;i++)await insertProduct(i);
  await assert.rejects(insertProduct(10),/seller_product_limit/);
  assert.equal((await call('products/product_10',{})).status,409);
  assert.equal((await call('products/product_0/duplicate',{},alice,'POST')).status,409);
  assert.deepEqual((await call('advanced-mode',{enabled:true,commissionPercent:6})).plan,{enabled:true,canEdit:true,limits:{landingPages:24,products:50},commissionPercent:6});
  assert.equal((await call('advanced-mode')).plan.enabled,true);
  assert.equal((await call('advanced-mode',undefined,bob)).plan.enabled,false);
  assert.equal((await call('me')).user.active_seller.plan,'advanced');
  assert.deepEqual(JSON.parse((await db.prepare("SELECT settings_json FROM sellers WHERE id='seller_alice'").first()).settings_json),{keep:true});
  await db.prepare("INSERT INTO media_uploads(id,seller_id,r2_key,mime_type,size_bytes,created_by_auth_user_id,created_at) VALUES ('media_capacity','seller_alice','capacity','image/png',1,'alice','now')").run();
  const product={name:'Extra digital product',type:'digital',price:100000,digitalFileName:'guide.pdf',imageUploadIds:['media_capacity']};
  assert.equal((await call('products/product_10',product)).status,200,'Advanced can save its eleventh product through the API');
  for(let i=6;i<24;i++)assert.equal((await call('landing-pages/page-'+i,page)).status,200);
  assert.equal((await call('landing-pages/page-24',page)).status,409);
  for(let i=11;i<49;i++)await insertProduct(i);
  const concurrent=await Promise.allSettled([insertProduct(49),insertProduct(50)]);
  assert.equal(concurrent.filter(r=>r.status==='fulfilled').length,1,'One last product slot');
  assert.equal((await call('products/product_51',{})).status,409);
  assert.equal((await call('products/product_0/duplicate',{},alice,'POST')).status,409);
  assert.equal((await call('advanced-mode',{enabled:false})).status,409,'Over-limit stores keep Advanced and all content');
  assert.equal((await call('advanced-mode')).plan.enabled,true);
  assert.equal((await call('landing-pages/page-0',{...page,name:'Edited at limit'})).status,200);
  assert.equal((await call('landing-pages/another',page)).status,409);
  assert.equal((await call('products/another',{})).status,409);
  assert.equal((await call('products/product_10',{...product,name:'Edited at limit'})).status,200,'Existing products stay editable at the limit');
  await db.prepare("INSERT INTO products(id,seller_id,type,title,price_amount,created_at,updated_at) VALUES ('product_0','seller_alice','digital','Updated',100000,'now','now') ON CONFLICT(id) DO UPDATE SET title=excluded.title").run();
  assert.equal((await db.prepare("SELECT COUNT(*) AS count FROM products WHERE seller_id='seller_alice'").first()).count,50);
  assert.equal((await call('landing-pages')).pages.length,24);
  // Make room explicitly; the toggle itself never deletes inventory or pages.
  await db.prepare("DELETE FROM products WHERE seller_id='seller_alice' AND id NOT IN ('product_0','product_1','product_2','product_3','product_4','product_5','product_6','product_7','product_8','product_9')").run();
  assert.equal((await call('advanced-mode',{enabled:false})).status,409,'Page allowance is checked independently');
  const privateBucket=await mf.getR2Bucket('PRIVATE_ASSETS');
  for(let i=6;i<24;i++)await privateBucket.delete(`sellers/seller_alice/landing-pages/page-${i}.json`);
  assert.equal((await call('advanced-mode',{enabled:false})).plan.commissionPercent,5);
  assert.equal((await call('landing-pages/another',page)).status,409);
  assert.equal((await call('products/another',{})).status,409);
  assert.equal((await call('landing-pages/page-0',{...page,name:'Edited on Basic'})).status,200);
});
