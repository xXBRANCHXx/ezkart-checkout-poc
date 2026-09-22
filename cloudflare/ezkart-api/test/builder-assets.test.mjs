import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {build} from 'esbuild';
import {Miniflare,convertV4MiniflareOptions} from 'miniflare';

test('asset uploads persist privately, list account media, enforce ownership and survive abandoned-media cleanup',async t => {
  const key=await crypto.subtle.generateKey({name:'ECDSA',namedCurve:'P-256'},true,['sign','verify']);
  const publicKey={...await crypto.subtle.exportKey('jwk',key.publicKey),kid:'asset-test',alg:'ES256',use:'sig'};
  const bundle=await build({entryPoints:[new URL('../src/index.js',import.meta.url).pathname],bundle:true,write:false,format:'esm',platform:'neutral'});
  const mf=new Miniflare(convertV4MiniflareOptions({modules:true,script:bundle.outputFiles[0].text,compatibilityDate:'2026-08-11',d1Databases:['DB'],r2Buckets:['PUBLIC_ASSETS','PRIVATE_ASSETS'],bindings:{APP_ENVIRONMENT:'test',SUPABASE_URL:'https://auth.fixture.test'},outboundService:async()=>Response.json({keys:[publicKey]})}));
  t.after(()=>mf.dispose());
  const db=await mf.getD1Database('DB');
  for(const migration of ['0001_core.sql','0002_cloud_catalog.sql']) {
    const sql=await readFile(new URL('../migrations/'+migration,import.meta.url),'utf8');
    for(const statement of sql.replace(/--[^\n]*/g,'').split(';').filter(s=>s.trim()))await db.prepare(statement).run();
  }
  for(const id of ['alice','bob']) {
    await db.prepare("INSERT INTO app_users(id,auth_user_id,created_at,updated_at) VALUES (?,?,'now','now')").bind(id,id).run();
    await db.prepare("INSERT INTO sellers(id,slug,name,status,created_at,updated_at) VALUES (?,?,?,'active','now','now')").bind('seller_'+id,id,id).run();
    await db.prepare("INSERT INTO seller_memberships(seller_id,auth_user_id,role,created_at) VALUES (?,?,'owner','now')").bind('seller_'+id,id).run();
    await db.prepare("INSERT INTO media_uploads(id,seller_id,r2_key,mime_type,size_bytes,created_by_auth_user_id,created_at) VALUES (?,?,?,'image/png',1,?,'2000-01-01')").bind('logo_'+id,'seller_'+id,'logo_'+id,id).run();
  }
  async function token(id) {
    const head=Buffer.from(JSON.stringify({alg:'ES256',kid:publicKey.kid})).toString('base64url');
    const body=Buffer.from(JSON.stringify({iss:'https://auth.fixture.test/auth/v1',sub:id,aud:'authenticated',exp:Math.floor(Date.now()/1000)+3600})).toString('base64url');
    const signature=await crypto.subtle.sign({name:'ECDSA',hash:'SHA-256'},key.privateKey,new TextEncoder().encode(head+'.'+body));
    return head+'.'+body+'.'+Buffer.from(signature).toString('base64url');
  }
  const alice=await token('alice'),bob=await token('bob');
  const call=(access,path='/v1/assets',payload)=>mf.dispatchFetch('https://api.fixture.test'+path,{method:payload?'POST':'GET',headers:{...(access?{authorization:'Bearer '+access}:{}),'content-type':'application/json'},...(payload?{body:JSON.stringify(payload)}:{})});
  assert.equal((await call('')).status,401);
  const dataUrl='data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jF1cAAAAASUVORK5CYII=';
  const response=await call(alice,'/v1/assets',{name:'My artwork.png',dataUrl});
  assert.equal(response.status,201);
  const {asset}=await response.json();
  assert.equal(asset.name,'My artwork.png');
  assert.match(asset.sha256,/^[a-f0-9]{64}$/);
  let list=(await (await call(alice)).json()).assets;
  assert.equal(list.find(a=>a.id===asset.id).name,asset.name);
  assert.equal(list.find(a=>a.id===asset.id).sha256,asset.sha256);
  assert.ok(list.some(a=>a.id==='logo_alice' && a.media));
  assert.ok(!list.some(a=>a.id==='logo_bob'));
  assert.ok(!(await (await call(bob)).json()).assets.some(a=>a.id===asset.id));
  const image=await call(alice,'/v1/assets/'+asset.id);
  assert.equal(image.status,200);
  assert.match(image.headers.get('cache-control'),/^private/);
  assert.equal(image.headers.get('content-type'),'image/png');
  assert.deepEqual(Buffer.from(await image.arrayBuffer()),Buffer.from(dataUrl.split(',')[1],'base64'));
  assert.equal((await call(bob,'/v1/assets/'+asset.id)).status,404);
  assert.equal((await call('','/v1/assets/'+asset.id)).status,401);
  assert.equal((await call(alice,'/v1/public/media/'+asset.id)).status,404);
  assert.equal((await call(alice,'/v1/assets',{name:'bad',dataUrl:'data:text/html;base64,SGVsbG8='})).status,400);
  await db.prepare("UPDATE seller_memberships SET role='viewer' WHERE auth_user_id='alice'").run();
  assert.equal((await call(alice,'/v1/assets',{name:'Forbidden',dataUrl})).status,403);
  assert.equal((await call(alice)).status,200);
  await (await mf.getWorker()).scheduled({cron:'17 * * * *'});
  assert.equal((await call(alice,'/v1/assets/'+asset.id)).status,200,'Reusable files are retained even before they are placed on a page');
});
