import {test} from 'node:test';
import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {Miniflare, convertV4MiniflareOptions} from 'miniflare';
import {cacheLandingSummary, readLandingSummary, listLandingObjects} from '../src/landing-page-index.js';

test('project indexes read summaries, invalidate on saves, and tolerate concurrent edits/deletion', async () => {
 const objects=new Map(),reads=[];
 let revision=0;
 const bucket={
  async get(key){reads.push(key);return objects.get(key)||null;},
  async put(key,value,options={}) {
   const object={key,version:String(++revision),customMetadata:options.customMetadata||{},json:async()=>JSON.parse(value)};
   objects.set(key,object);return object;
  },
 };
 const key='sellers/mine/landing-pages/campaign.json';
 const page={id:'campaign',name:'Old name',state:{preview:'large image data'.repeat(100000)}};
 const summarize=page=>({id:page.id,name:page.name});
 const original=await bucket.put(key,JSON.stringify(page));
 assert.deepEqual(await readLandingSummary(bucket,'mine',original,summarize),summarize(page));
 reads.length=0;
 assert.deepEqual(await readLandingSummary(bucket,'mine',original,summarize),summarize(page));
 assert.ok(!reads.includes(key),'The large editable document is not downloaded again');
 const updated={...page,name:'Current name'};
 const current=await bucket.put(key,JSON.stringify(updated));
 await cacheLandingSummary(bucket,'mine',current,summarize(updated));
 // Simulate a late cache fill from the older request, after the newer save.
 await cacheLandingSummary(bucket,'mine',original,summarize(page));
 assert.deepEqual(await readLandingSummary(bucket,'mine',current,summarize),summarize(updated));
 // A legacy/unindexed page deleted during list enumeration is simply absent.
 const deleted=await bucket.put(key,JSON.stringify(page));objects.delete(key);
 assert.equal(await readLandingSummary(bucket,'mine',deleted,summarize),null);
});

test('metadata listing consumes every R2 cursor even when a page is shorter than the limit',async()=>{
 const calls=[];
 const objects=await listLandingObjects({async list(options){calls.push(options);return options.cursor?{objects:[{key:'b'}],truncated:false}:{objects:[{key:'a'}],truncated:true,cursor:'next'};}},'sellers/mine/');
 assert.deepEqual(objects.map(object=>object.key),['a','b']);
 assert.equal(calls[1].cursor,'next');assert.deepEqual(calls[0].include,['customMetadata']);
});

test('gallery HTML drops scripts and artwork below the thumbnail while retaining visible layout',async t=>{
 const bundle=await build({stdin:{contents:`import {staticLandingPreview} from './src/landing-page-index.js'; export default {fetch(request){return staticLandingPreview(new Response(request.body,{headers:{'content-type':'text/html'}}));}}`,resolveDir:new URL('..',import.meta.url).pathname},bundle:true,write:false,format:'esm',platform:'neutral'});
 const mf=new Miniflare(convertV4MiniflareOptions({modules:true,script:bundle.outputFiles[0].text,compatibilityDate:'2026-08-11'}));
 t.after(()=>mf.dispose());
 const response=await mf.dispatchFetch('https://preview.test/',{method:'POST',body:'<!doctype html><style>.sq-page-preview{color:red}</style><div class="sq-page-preview"><section data-image-page><img width="1080" height="1350" src="first"><img width="1080" height="1350" src="second"><img width="1080" height="1350" src="third"></section><h2>Checkout</h2></div><script src="large-script.js"></script><script>const unused="large commerce data";</script>'});
 const html=await response.text();
 assert.match(html,/src="first"/);assert.match(html,/src="second"/);
 assert.doesNotMatch(html,/third|<script|large commerce/);
 assert.match(html,/<style>.*color:red/);assert.match(html,/<h2>Checkout/);
});
