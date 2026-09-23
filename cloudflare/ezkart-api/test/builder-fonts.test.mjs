import {decodeFontDataUrl} from '../src/builder-fonts.js';
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {build} from 'esbuild';
import {Miniflare,convertV4MiniflareOptions} from 'miniflare';

test('font imports validate each format, deduplicate files and enforce account ownership',async t => {
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
  const call=(access,path='/v1/fonts',payload)=>mf.dispatchFetch('https://api.fixture.test'+path,{method:payload?'POST':'GET',headers:{...(access?{authorization:'Bearer '+access}:{}),'content-type':'application/json'},...(payload?{body:JSON.stringify(payload)}:{})});
  assert.equal((await call('')).status,401);
  const imported=[];
  for(const format of ['woff2','woff','ttf','otf']) {
    const bytes=await readFile(new URL(`fixtures/fonts/sample.${format}`,import.meta.url));
    const dataUrl=`data:font/${format};base64,${bytes.toString('base64')}`;
    const payload={name:`My ${format} font`,dataUrl};
    const response=await call(alice,'/v1/fonts',payload);assert.equal(response.status,201,await response.clone().text());
    const {font}=await response.json();imported.push({font,payload,bytes});
    assert.equal(font.name,payload.name);assert.equal(font.format,format);assert.equal(font.sizeBytes,bytes.length);
    assert.match(font.id,/^font_[a-f0-9]{64}$/);
    assert.equal((await (await call(alice,'/v1/fonts',payload)).json()).font.id,font.id,'The same file is reused');
    const asset=await call(alice,'/v1/fonts/'+font.id);assert.equal(asset.status,200);assert.equal(asset.headers.get('content-type'),`font/${format}`);
    assert.match(asset.headers.get('cache-control'),/^private/);assert.equal(asset.headers.get('x-content-type-options'),'nosniff');
    assert.deepEqual(Buffer.from(await asset.arrayBuffer()),bytes);
    assert.equal((await call(bob,'/v1/fonts/'+font.id)).status,404);
    assert.equal((await call('','/v1/fonts/'+font.id)).status,401);
    assert.equal((await call(alice,'/v1/public/media/'+font.id)).status,404);
  }
  assert.equal((await (await call(alice)).json()).fonts.length,4);
  assert.deepEqual((await (await call(bob)).json()).fonts,[]);
  assert.ok(!(await (await call(alice,'/v1/assets')).json()).assets.some(asset=>asset.id.startsWith('font_')),'Fonts do not appear as images');
  const bad=[
    'data:text/html;base64,SGVsbG8=',
    'data:font/woff2;base64,SGVsbG8=',
    imported[0].payload.dataUrl.replace('font/woff2','font/ttf'),
    'data:font/woff2;base64,'+imported[0].bytes.subarray(0,12).toString('base64'),
    'data:font/otf;base64,'+imported[3].bytes.subarray(0,48).toString('base64'),
  ];
  for(const dataUrl of bad)assert.equal((await call(alice,'/v1/fonts',{name:'bad',dataUrl})).status,400);
  assert.equal((await call(alice,'/v1/fonts',{name:'large',dataUrl:'data:font/ttf;base64,'+Buffer.alloc(5*1024*1024+1).toString('base64')})).status,413);
  assert.equal((await (await call(alice)).json()).fonts.length,4,'Rejected files never enter the library');
  await db.prepare("UPDATE seller_memberships SET role='viewer' WHERE auth_user_id='alice'").run();
  assert.equal((await call(alice,'/v1/fonts',imported[0].payload)).status,403);
  assert.equal((await call(alice)).status,200);
  await (await mf.getWorker()).scheduled({cron:'17 * * * *'});
  assert.equal((await call(alice,'/v1/fonts/'+imported[0].font.id)).status,200,'Reusable fonts survive abandoned-media cleanup');
});

test('all bundled WOFF2 containers validate and variable faces retain weight axes',async()=>{
  const base=new URL('../../../cart/admin/assets/fonts/',import.meta.url),{families}=JSON.parse(await readFile(new URL('builder-fonts.json',base),'utf8'));
  for(const family of families)for(const face of family.faces){
    const bytes=await readFile(new URL(face.file,base)),font=decodeFontDataUrl('data:font/woff2;base64,'+bytes.toString('base64'));
    assert.equal(font.format,'woff2');
    if(face.weight.includes(' '))assert.ok(font.variable,`${family.name} keeps variable weights`);
    if(family.name==='Pacifico')assert.equal(font.variable,false,'Static fonts retain synthetic bold support');
  }
});
