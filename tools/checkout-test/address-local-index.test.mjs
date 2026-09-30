import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,writeFile,rm,readFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {spawnSync} from 'node:child_process';
import {setup} from './fixture.mjs';

const coordinates={latitude:-6.1957601,longitude:106.8214547};
const record=(overrides={})=>({osm:'N123',coordinate:coordinates,precision:'address',properties:{name:'Delivery building',street:'Jalan Teluk Betung',housenumber:'12',postcode:'10230',city:'Jakarta',localities:['Tanah Abang','Jakarta','DKI Jakarta']},...overrides});
async function indexedFixture(t,records){
  const directory=await mkdtemp(join(tmpdir(),'ezkart-owned-map-'));t.after(()=>rm(directory,{recursive:true,force:true}));
  const input=join(directory,'records-input.jsonl'),output=join(directory,'index');
  await writeFile(input,records.map(r=>JSON.stringify(r)).join('\n')+'\n');
  const built=spawnSync('python3',['tools/geocoding/build_index.py','--input',input,'--output',output,'--fixture-jsonl'],{encoding:'utf8'});
  assert.equal(built.status,0,built.stdout+built.stderr);
  const f=await setup({EZKART_ADDRESS_GEOCODING_DIRECTORY:output,EZKART_CLOUDFLARE_API_URL:'https://ezkart-api-test.fixture.workers.dev'});t.after(()=>f.close());
  const cookie=f.customerCookie(),auth={Cookie:`${cookie.name}=${cookie.value}`};
  const csrf=(await f.request('/cart/admin/customer-addresses.php',undefined,auth)).data.csrf;
  return {...f,index:output,search:(address,components)=>f.request('/cart/api/address-search.php',{address,components},{...auth,'X-Ezkart-CSRF':csrf})};
}

test('self-hosted PHP lookup returns the mapped building and local district without any external geocoder call or database extension',async t=>{
  const f=await indexedFixture(t,[record()]);
  const response=await f.search('Jl. Teluk Betung No. 12, Jakarta, 10230',{address:'Jl. Teluk Betung No. 12',location:'Jakarta',postalCode:'10230'});
  assert.equal(response.status,200,JSON.stringify(response.data));
  assert.equal(response.data.results.length,1);
  assert.deepEqual(response.data.results[0].coordinate,coordinates);
  assert.equal(response.data.results[0].auto_select,true);
  assert.equal(response.data.results[0].provider,'ezkart');
  const named=await f.search('Delivery building, Jakarta');assert.equal(named.data.results[0].auto_select,true);assert.deepEqual(named.data.results[0].coordinate,coordinates);
  assert.equal(f.cli('require '+JSON.stringify(join(process.cwd(),'cart/api/address-local-index.php'))+'; echo ez_local_geocoder_available() ? "yes" : "no";'),'yes');
  assert(!(await f.calls()).some(c=>/photon|hereapi|googleapis/.test(c.url)));
});

test('owned address index refuses mismatched house/city/postcode, supports neighborhood lookup and never interpolates a missing house',async t=>{
  const f=await indexedFixture(t,[record(),record({osm:'W999',precision:'street',properties:{name:'Jalan Teluk Betung',street:'Jalan Teluk Betung',housenumber:'',postcode:'',city:'Jakarta',localities:['Tanah Abang','Jakarta']}})]);
  for(const text of ['Jalan Teluk Betung 12, Surabaya, 10230','Jalan Teluk Betung 12, Surabaya, DKI Jakarta, 10230','Jalan Teluk Betung 12, Jakarta, 60111','Jalan Teluk Betung 120, Jakarta, 10230']){
    const result=await f.search(text);assert.equal(result.status,200);
    assert(result.data.results.every(p=>!p.auto_select&&p.precision!=='address'),text+JSON.stringify(result.data));
  }
  const local=await f.search('Jalan Teluk Betung 12, Tanah Abang, 10230');assert.equal(local.data.results[0].auto_select,true);
  const missing=await f.search('Jalan Teluk Betung 999, Jakarta, 10230');
  assert(missing.data.results.every(p=>p.precision==='street'&&!p.auto_select));
  assert(!(await f.calls()).some(c=>c.url.includes('photon')));
});

test('named places are discoverable but an address shared by distinct mapped buildings requires a choice',async t=>{
  const f=await indexedFixture(t,[record(),record({osm:'N124',coordinate:{latitude:-6.196,longitude:106.822}}),record({osm:'N125',precision:'place',properties:{name:'Museum Cerita',aliases:['Muscer'],street:'',housenumber:'',postcode:'',city:'Jakarta',localities:['Jakarta']}})]);
  const ambiguous=await f.search('Jalan Teluk Betung 12, Jakarta');
  assert.equal(ambiguous.data.results.length,2);assert(ambiguous.data.results.every(p=>!p.auto_select));
  const named=await f.search('Museum Cerita, Jakarta');assert.equal(named.data.results[0].name,'Museum Cerita');assert.equal(named.data.results[0].precision,'place');assert.equal(named.data.results[0].auto_select,true);
  const alias=await f.search('Muscer, Jakarta');assert.equal(alias.data.results[0].name,'Museum Cerita');assert.equal(alias.data.results[0].auto_select,true);
});

test('corrupt active map data does not silently fall back to the public demo',async t=>{
  const f=await indexedFixture(t,[record()]);
  await writeFile(join(f.index,'manifest.json'),'{broken');
  assert.equal((await f.search('Jalan Teluk Betung 12, Jakarta')).status,503);
  assert(!(await f.calls()).some(c=>c.url.includes('photon')));
});


test('street-prefix variants and missing postcodes do not hide another matching building',async t=>{
  const f=await indexedFixture(t,[record(),record({osm:'N126',coordinate:{latitude:-6.196,longitude:106.822},properties:{...record().properties,street:'Teluk Betung',postcode:''}})]);
  for(const address of ['Jalan Teluk Betung 12, Jakarta, 10230','Teluk Betung No. 12, Jakarta, 10230']) {
    const found=await f.search(address);assert.equal(found.status,200);assert.equal(found.data.results.length,2);assert(found.data.results.every(r=>!r.auto_select));
  }
});


test('structured fields retain mapped block identifiers and commas inside street metadata',async t=>{
  const examples=[['Jalan Cemerlang, Kp. Tegalwangi RT 04 RW 02 Gang Haji Moch. Zein','13-15'],['Jalan Sinar Mas Land Boulevard','Blok H No. 7'],['Jalan Wonogiri - Ponorogo','Keringan RT01 / RW01']];
  const f=await indexedFixture(t,examples.map(([street,housenumber],i)=>record({osm:'N'+(200+i),properties:{...record().properties,street,housenumber}})));
  for(const [street,housenumber] of examples){const components={address:street+' No. '+housenumber,location:'Jakarta',postalCode:'10230'};const found=await f.search(Object.values(components).join(', '),components);assert.equal(found.status,200);assert.equal(found.data.results.length,1);assert.equal(found.data.results[0].auto_select,true);assert.deepEqual(found.data.results[0].coordinate,coordinates);}
});
