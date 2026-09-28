// One synthetic vision smoke check. Exclusive receipt; never retries or takes page actions.
import {readFile,writeFile,open} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {jevRequest,callJev,jevDecision,jevReservation,JEV_MODEL,JEV_POLICY} from '../../../cloudflare/ezkart-api/src/jev-provider.js';
const args=Object.fromEntries(process.argv.slice(2).map(a=>{const i=a.indexOf('=');return [a.slice(0,i),a.slice(i+1)];}));
if(!args['--key-file']||!args['--output'])throw Error('Private key file and new receipt path are required.');
const sha=b=>createHash('sha256').update(b).digest('hex'),png=await readFile(new URL('./synthetic-graphic.png',import.meta.url));
const report='Other: Look at the instructions in the large graphic. The caption does not explain them.';
const snapshot={evidenceVersion:2,reportReason:'other',page:{url:'https://example.test/notebooks/offer-1234567890',storeSlug:'notebooks',pageSlug:'offer-1234567890',revision:'synthetic-v1'},sources:[{id:'page:1',kind:'visible_text',text:'Notebook listing. See the attached graphic.\n /\\_/\\\n( o.o )\n > ^ <'},{id:'page:html',kind:'published_code',text:'<h1>Notebook listing</h1><img src="synthetic-graphic.png" alt="Store graphic">'}],images:[{id:'image:1',url:'synthetic-graphic.png',mimeType:'image/png',bytes:png.length,sha256:sha(png),dataUrl:'data:image/png;base64,'+png.toString('base64')}],resources:[],coverage:{truncated:false,unreviewedMedia:false,missing:[],textOnly:false}};
const payload=jevRequest(snapshot,report,JEV_POLICY);if(jevReservation(payload)!==540000)throw Error('Reservation changed.');
const line=(await readFile(args['--key-file'],'utf8')).split('\n').find(s=>/^[A-Z0-9_]*KEY=/.test(s));if(!line)throw Error('Missing key');const key=line.slice(line.indexOf('=')+1).trim().replace(/^['"]|['"]$/g,'');
const metadata=async path=>{const r=await fetch('https://openrouter.ai/api/v1/'+path,{headers:{authorization:'Bearer '+key},redirect:'error',signal:AbortSignal.timeout(15000)});if(!r.ok)throw Error('Metadata unavailable');return (await r.json()).data;};
const before=await metadata('key'),endpoints=await metadata('models/'+JEV_MODEL+'/endpoints'),endpoint=endpoints.endpoints.find(e=>e.tag==='google-vertex/global');
if(before.limit!==5||before.limit_reset!==null||before.limit_remaining<.54||Date.parse(before.expires_at)<=Date.now()||endpoint?.context_length!==1048576||!endpoint.supported_parameters.includes('structured_outputs')||Number(endpoint.pricing.prompt)>.0000005||Number(endpoint.pricing.completion)>.0000025)throw Error('Cap, model or price contract changed.');
const receipt={synthetic:true,model:JEV_MODEL,startedAt:new Date().toISOString(),requestSha256:sha(JSON.stringify(payload)),adapterSha256:sha(await readFile(new URL('../../../cloudflare/ezkart-api/src/jev-provider.js',import.meta.url))),imageSha256:sha(png),report,maximumAttempts:1,reservedMicrousd:540000,keyUsageBefore:before.usage,state:'started',actions:0};
const fence=await open(args['--output'],'wx',0o600);await fence.writeFile(JSON.stringify(receipt));await fence.sync();await fence.close();
try{receipt.result=await callJev(key,payload,snapshot);receipt.decision=jevDecision(receipt.result.outcome,snapshot);receipt.state='accepted';}catch(e){receipt.state=e.diagnostic?'rejected':'unconfirmed';receipt.failureCode=e.message;if(e.diagnostic)receipt.diagnostic=e.diagnostic;}
receipt.finishedAt=new Date().toISOString();try{const after=await metadata('key');receipt.keyUsageAfter=after.usage;receipt.keyRemaining=after.limit_remaining;}catch{receipt.metadataUnavailable=true;}
await writeFile(args['--output'],JSON.stringify(receipt,null,2),{mode:0o600});console.log(JSON.stringify(receipt,null,2));
