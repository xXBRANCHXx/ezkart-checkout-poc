import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {Miniflare,convertV4MiniflareOptions} from 'miniflare';
import {domainHostname,enrollCustomDomain,customDomainAction,customDomainResponse,listCustomDomains} from '../src/custom-domains.js';
import {verifyDomainDNS} from '../src/custom-domain-provider.js';
async function fixture(t){
 const mf=new Miniflare(convertV4MiniflareOptions({modules:true,script:'export default {fetch(){return new Response("ok")}}',compatibilityDate:'2026-08-11',d1Databases:['DB'],r2Buckets:['PRIVATE_ASSETS']}));t.after(()=>mf.dispose());
 const DB=await mf.getD1Database('DB'),PRIVATE_ASSETS=await mf.getR2Bucket('PRIVATE_ASSETS');
 for(const migration of ['0001_core.sql','0002_cloud_catalog.sql','0003_subscription_plan_billing.sql','0008_seller_page_addresses.sql','0069_custom_domains.sql','0079_jev_page_review.sql']){
  const source=(await readFile(new URL('../migrations/'+migration,import.meta.url),'utf8')).replace(/--[^\n]*/g,'');
  const triggers=[...source.matchAll(/CREATE TRIGGER[\s\S]*?END;/g)].map(m=>m[0]);
  for(const sql of [...source.replace(/CREATE TRIGGER[\s\S]*?END;/g,'').split(';').filter(s=>s.trim()),...triggers])await DB.prepare(sql).run();
 }
 for(const id of ['alice','bob']){
  await DB.prepare("INSERT INTO sellers(id,slug,name,status,plan,settings_json,created_at,updated_at) VALUES (?,?,?,'active','advanced','{}','now','now')").bind(id,id,id).run();
  await PRIVATE_ASSETS.put(`sellers/${id}/landing-pages/home.json`,JSON.stringify({status:'published',publishedHtml:'<h1>'+id+'</h1>'}));
 }
 const env={DB,PRIVATE_ASSETS,APP_ENVIRONMENT:'beta',CUSTOM_DOMAIN_ZONE_ID:'a'.repeat(32),CUSTOM_DOMAIN_API_TOKEN:'fixture-token',CUSTOM_DOMAIN_CNAME_TARGET:'shops.ezkart.site',CUSTOM_DOMAIN_API_HOSTS:'api.ezkart.id'};
 const alice={id:'alice',role:'owner'},bob={id:'bob',role:'owner'};
 const f={env,alice,bob,token:'',cname:env.CUSTOM_DOMAIN_CNAME_TARGET,provider:null,creates:0,tls:'pending_validation',remoteError:false};
 f.transport=async(url,opts={})=>{
  const parsed=new URL(url);assert.equal(opts.redirect,'error');
  if(parsed.host==='cloudflare-dns.com'){const type=parsed.searchParams.get('type'),name=parsed.searchParams.get('name');return Response.json({Status:0,Answer:[{name:name+'.',type:type==='TXT'?16:5,data:type==='TXT'?'"'+f.token+'"':f.cname+'.'}]});}
  assert.equal(parsed.host,'api.cloudflare.com');
  if(opts.method==='POST'){f.creates++;const body=JSON.parse(opts.body);f.provider={...body,id:'12345678-1234-1234-1234-123456789abc',status:'active',ssl:{status:f.tls,validation_records:[{txt_name:'_acme-challenge.'+body.hostname,txt_value:'certificate-code'}]}};if(f.onCreate)await f.onCreate();if(f.remoteError)throw Error('timeout');}
  if(opts.method==='DELETE'){if(f.remoteError)throw Error('timeout');f.provider=null;return Response.json({success:true,result:{id:'deleted'}});}
  if(f.provider)f.provider.ssl.status=f.tls;
  return Response.json({success:true,result:parsed.search?[f.provider].filter(Boolean):f.provider});
 };return f;
}
const rejected=(fn,status)=>assert.rejects(fn,e=>e instanceof Response&&e.status===status);
test('hostname validation rejects reserved/IP/SSRF syntax',()=>{
 for(const value of ['127.0.0.1','[::1]','2130706433','localhost','x.local','x.internal','shop.example.com','test.ezkart.id','x.workers.dev','https://shop.brand.com','a.com/path','a.com:443','a.com@127.0.0.1','*.brand.com','a.com.',' a.com','a..com','a_b.com'])assert.throws(()=>domainHostname(value),Response);
 assert.equal(domainHostname('SHOP.BRAND.COM'),'shop.brand.com');
});
test('owner scope, hostile CNAME/Host, pending TLS, isolation, expiry, downgrade, replay and disconnect',async t=>{
 const f=await fixture(t),{env,alice,bob,transport}=f;
 await rejected(()=>enrollCustomDomain(env,{...alice,role:'admin'},{hostname:'shop.brand.com',pageId:'home'}),403);
 await rejected(()=>enrollCustomDomain(env,alice,{hostname:'shop.brand.com',pageId:'missing'}),409);
 const domain=await enrollCustomDomain(env,alice,{hostname:'shop.brand.com',pageId:'home'});f.token=domain.dns[0].value;
 assert.equal(domain.state,'pending');assert.equal(f.token.length,71);
 await rejected(()=>enrollCustomDomain(env,bob,{hostname:domain.hostname,pageId:'home'}),409);
 await rejected(()=>customDomainAction(env,bob,domain.id,'verify',transport),404);
 assert.equal((await listCustomDomains(env,bob)).domains.length,0);
 const request=(host,path='/',headers={})=>new Request('https://'+host+path,{headers});
 assert.equal((await customDomainResponse(request(domain.hostname),env)).status,404);
 f.cname='127.0.0.1.nip.io';await rejected(()=>customDomainAction(env,alice,domain.id,'verify',transport),409);assert.equal(f.creates,0);
 f.cname=env.CUSTOM_DOMAIN_CNAME_TARGET;
 const pending=await customDomainAction(env,alice,domain.id,'verify',transport);assert.equal(pending.state,'pending');assert.equal(pending.tlsStatus,'pending_validation');assert.equal(pending.dns.at(-1).value,'certificate-code');
 f.tls='active';assert.equal((await customDomainAction(env,alice,domain.id,'verify',transport)).state,'active');assert.equal(f.creates,1);
 const hosted=await customDomainResponse(request(domain.hostname),env);
 assert.match(await hosted.text(),/srcdoc="&lt;h1&gt;alice&lt;\/h1&gt;"/);
 assert.doesNotMatch(hosted.headers.get('content-security-policy'),/\bsandbox\b/);
 const head=await customDomainResponse(new Request('https://'+domain.hostname,{method:'HEAD'}),env);
 assert.equal(await head.text(),'');
 for(const path of ['/bob/shop/home','/v1/catalog','/admin'])assert.equal((await customDomainResponse(request(domain.hostname,path),env)).status,404);
 assert.equal((await customDomainResponse(request('unconnected.brand.com','/',{host:domain.hostname,'x-forwarded-host':domain.hostname}),env)).status,404);
 assert.equal(await customDomainResponse(request('api.ezkart.id','/',{host:domain.hostname}),env),null);
 await env.DB.prepare("UPDATE custom_domains SET checked_at='2020-01-01' WHERE id=?").bind(domain.id).run();assert.equal((await customDomainResponse(request(domain.hostname),env)).status,404);
 await customDomainAction(env,alice,domain.id,'verify',transport);
 await assert.rejects(env.DB.prepare("UPDATE custom_domains SET seller_id='bob' WHERE id=?").bind(domain.id).run(),/custom_domain_binding_immutable/);
 await env.DB.prepare("UPDATE sellers SET plan='standard' WHERE id='alice'").run();assert.equal((await customDomainResponse(request(domain.hostname),env)).status,404);
 await env.DB.prepare("UPDATE sellers SET plan='advanced' WHERE id='alice'").run();await rejected(()=>customDomainAction(env,alice,domain.id,'verify',transport),409);
 const renewed=await customDomainAction(env,alice,domain.id,'renew',transport);assert.notEqual(renewed.dns[0].value,f.token);await rejected(()=>customDomainAction(env,alice,domain.id,'verify',transport),409);
 f.token=renewed.dns[0].value;await customDomainAction(env,alice,domain.id,'verify',transport);
 f.remoteError=true;await assert.rejects(customDomainAction(env,alice,domain.id,'disconnect',transport),/timeout/);assert.equal((await customDomainResponse(request(domain.hostname),env)).status,404);
 await rejected(()=>enrollCustomDomain(env,bob,{hostname:domain.hostname,pageId:'home'}),409);
 f.remoteError=false;assert.deepEqual(await customDomainAction(env,alice,domain.id,'disconnect',transport),{disconnected:true});
 const replacement=await enrollCustomDomain(env,bob,{hostname:domain.hostname,pageId:'home'});assert.notEqual(replacement.dns[0].value,renewed.dns[0].value);
});
test('uncertain create recovers original identity without another POST; foreign provider identity fails',async t=>{
 const f=await fixture(t),d=await enrollCustomDomain(f.env,f.alice,{hostname:'shop.brand.com',pageId:'home'});f.token=d.dns[0].value;f.remoteError=true;
 await assert.rejects(customDomainAction(f.env,f.alice,d.id,'verify',f.transport),/timeout/);assert.equal(f.creates,1);
 f.remoteError=false;f.tls='active';assert.equal((await customDomainAction(f.env,f.alice,d.id,'verify',f.transport)).state,'active');assert.equal(f.creates,1);
 f.provider.custom_metadata.ezkart_domain_id='other';await rejected(()=>customDomainAction(f.env,f.alice,d.id,'verify',f.transport),503);
 assert.equal((await customDomainResponse(new Request('https://shop.brand.com'),f.env)).status,404);
});
test('renew during provider creation prevents stale activation',async t=>{
 const f=await fixture(t),d=await enrollCustomDomain(f.env,f.alice,{hostname:'shop.brand.com',pageId:'home'});f.token=d.dns[0].value;f.tls='active';
 f.onCreate=()=>customDomainAction(f.env,f.alice,d.id,'renew',f.transport);
 await rejected(()=>customDomainAction(f.env,f.alice,d.id,'verify',f.transport),409);
 assert.equal((await customDomainResponse(new Request('https://shop.brand.com'),f.env)).status,404);
});
test('DNS exact owner/target and bounded response; never contact customer origins',async()=>{
 const row={hostname:'shop.brand.com',challenge:'fresh',cname_target:'shops.ezkart.site'},hosts=[];
 const result=await verifyDomainDNS(row,async(url,opts)=>{hosts.push(new URL(url).host);assert.equal(opts.redirect,'error');return Response.json({Status:0,Answer:[{name:'attacker.brand.com.',type:16,data:'"fresh"'},{name:'shop.brand.com.',type:5,data:'evil.origin.com.'}]});});
 assert.deepEqual(result,{ownership:false,route:false});assert.deepEqual(hosts,['cloudflare-dns.com','cloudflare-dns.com']);
 await rejected(()=>verifyDomainDNS(row,async()=>new Response(new Uint8Array(1000001))),503);
});
test('disconnect during provider creation prevents stale activation and retains retryable cleanup',async t=>{
 const f=await fixture(t),d=await enrollCustomDomain(f.env,f.alice,{hostname:'shop.brand.com',pageId:'home'});f.token=d.dns[0].value;f.tls='active';
 f.onCreate=async()=>{await f.env.DB.prepare("UPDATE custom_domains SET state='disconnecting',ownership_verified_at=NULL WHERE id=?").bind(d.id).run();};
 await rejected(()=>customDomainAction(f.env,f.alice,d.id,'verify',f.transport),409);
 assert.equal((await customDomainResponse(new Request('https://shop.brand.com'),f.env)).status,404);
 assert.deepEqual(await customDomainAction(f.env,f.alice,d.id,'disconnect',f.transport),{disconnected:true});
});
test('hourly housekeeping refreshes due identities without provisioning',async t=>{
 const {recheckCustomDomains}=await import('../src/custom-domains.js');
 const f=await fixture(t),d=await enrollCustomDomain(f.env,f.alice,{hostname:'shop.brand.com',pageId:'home'});f.token=d.dns[0].value;f.tls='active';
 await customDomainAction(f.env,f.alice,d.id,'verify',f.transport);
 await f.env.DB.prepare("UPDATE custom_domains SET checked_at='2020-01-01' WHERE id=?").bind(d.id).run();
 assert.deepEqual(await recheckCustomDomains(f.env,f.transport),{checked:1,unavailable:0,configured:true});assert.equal(f.creates,1);
 assert.equal((await customDomainResponse(new Request('https://shop.brand.com'),f.env)).status,200);
 await f.env.DB.prepare("UPDATE custom_domains SET checked_at='2020-01-01' WHERE id=?").bind(d.id).run();f.cname='hostile.origin.com';
 assert.equal((await recheckCustomDomains(f.env,f.transport)).unavailable,1);
 assert.equal((await customDomainResponse(new Request('https://shop.brand.com'),f.env)).status,404);
});
