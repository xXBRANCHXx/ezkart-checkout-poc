// Synthetic diagnostic only; no page writes. Every send is fenced and never retried.
import {readFile,writeFile,open,rename,mkdir} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {jevRequest,callJev,jevDecision,JEV_MODEL,JEV_POLICY} from '../../../cloudflare/ezkart-api/src/jev-provider.js';
const base=new URL('./',import.meta.url),sha=x=>createHash('sha256').update(x).digest('hex');
const benchmarkText=await readFile(new URL('benchmark.json',base),'utf8'),benchmark=JSON.parse(benchmarkText);
const cases=benchmark.cases; if(cases.length!==500||new Set(cases.map(c=>c.id)).size!==500)throw Error('Expected 500 unique cases');
const requests=[];let total=0;
for(const c of cases){
 const s=structuredClone(c.input);
 for(const im of s.images||[]){const bytes=await readFile(new URL(im.path||im.file,base)); if(bytes.readUInt32BE(16)>384||bytes.readUInt32BE(20)>384||bytes.length>100000)throw Error('Image contract'); if(im.sha256&&im.sha256!==sha(bytes))throw Error('Image hash');im.sha256=sha(bytes);im.dataUrl='data:image/png;base64,'+bytes.toString('base64');delete im.path;delete im.file;}
 const p=jevRequest(s,c.reportText,JEV_POLICY);p.provider.max_price={prompt:.25,completion:1.5};
 const bounded=structuredClone(p);if(Array.isArray(bounded.messages[1].content))bounded.messages[1].content=bounded.messages[1].content.filter(x=>x.type!=='image_url');
 // Serialized UTF-8 byte count + 2048 wrapper/schema margin; 8192 per tiny PNG
 // exceeds Google's documented Gemini 3 default1120 and ultra-high2240 tokens.
 const textBytes=Buffer.byteLength(JSON.stringify(bounded));const inputBound=textBytes+2048+(s.images?.length||0)*8192;
 const reserve=Math.ceil(inputBound*.25+p.max_tokens*1.5);total+=reserve;requests.push({snapshot:s,payload:p,reserve,inputBound,textBytes});
}
const preflight={cases:500,images:cases.filter(c=>c.input.images?.length).length,totalReservationMicrousd:total,maxTextBytes:Math.max(...requests.map(r=>r.textBytes)),benchmarkSha256:sha(benchmarkText),adapterSha256:sha(await readFile(new URL('../../../cloudflare/ezkart-api/src/jev-provider.js',base))),priceCeiling:{prompt:.25,completion:1.5},maxTokens:2000};
console.log(JSON.stringify(preflight));if(!process.argv.includes('--send')){await writeFile(new URL('preflight.json',base),JSON.stringify(preflight,null,2));process.exit();}
const opts=Object.fromEntries(process.argv.filter(a=>a.includes('=')).map(a=>[a.slice(0,a.indexOf('=')),a.slice(a.indexOf('=')+1)]));
if(!opts['--key-file']||!opts['--output']||!opts['--deployed-reservation'])throw Error('Required private paths and deployed reservation');
if(total>Number(opts['--deployed-reservation'])||total>3100000)throw Error('Aggregate reservation not funded');
const line=(await readFile(opts['--key-file'],'utf8')).split('\n').find(x=>/^[A-Z0-9_]*KEY=/.test(x));const key=line.slice(line.indexOf('=')+1).trim().replace(/^['"]|['"]$/g,'');
const metadata=async path=>{const r=await fetch('https://openrouter.ai/api/v1/'+path,{headers:{authorization:'Bearer '+key},redirect:'error',signal:AbortSignal.timeout(15000)});if(!r.ok)throw Error('Metadata failed');return(await r.json()).data;};
const before=await metadata('key'),endpoint=(await metadata('models/'+JEV_MODEL+'/endpoints')).endpoints.find(e=>e.tag==='google-vertex/global');
if(before.limit!==5||before.limit_reset!==null||before.limit_remaining<total/1e6||Date.parse(before.expires_at)<=Date.now()||endpoint?.context_length!==1048576||!endpoint.supported_parameters.includes('structured_outputs')||Number(endpoint.pricing.prompt)>.00000025||Number(endpoint.pricing.completion)>.0000015)throw Error('Budget/provider contract');
const output=opts['--output'],rawDir=output+'.responses';const state={...preflight,model:JEV_MODEL,policy:JEV_POLICY,synthetic:true,startedAt:new Date().toISOString(),keyUsageBefore:before.usage,keyLimit:before.limit,endpoint,actions:0,attempts:[]};
const fence=await open(output,'wx',0o600);await fence.writeFile(JSON.stringify(state));await fence.sync();await fence.close();await mkdir(rawDir,{mode:0o700});
const persist=async()=>{await writeFile(output+'.tmp',JSON.stringify(state,null,2),{mode:0o600});await rename(output+'.tmp',output);};
let unknown=0;
for(let i=0;i<500;i+=4){
 const batch=cases.slice(i,i+4).map((c,j)=>({case:c,request:requests[i+j],attempt:{caseId:c.id,state:'started',startedAt:new Date().toISOString(),requestSha256:sha(JSON.stringify(requests[i+j].payload)),reservedMicrousd:requests[i+j].reserve}}));state.attempts.push(...batch.map(b=>b.attempt));await persist();
 await Promise.all(batch.map(async({case:c,request:r,attempt:a})=>{
 const transport=async(url,init)=>{const response=await fetch(url,init);const body=await response.arrayBuffer();const raw=Buffer.from(body);await writeFile(rawDir+'/'+c.id+'.json',raw,{flag:'wx',mode:0o600});a.rawResponseSha256=sha(raw);a.httpStatus=response.status;return new Response(raw,{status:response.status,headers:response.headers});};
 try{a.result=await callJev(key,r.payload,r.snapshot,transport);a.state='accepted';a.decision=jevDecision(a.result.outcome,r.snapshot);}catch(e){a.state=e.diagnostic?'rejected':'unconfirmed';a.failureCode=e.message;if(e.diagnostic)a.diagnostic=e.diagnostic;a.decision=jevDecision(null,r.snapshot);}
 a.completedAt=new Date().toISOString();const cost=a.result?.costMicrousd??a.diagnostic?.costMicrousd;const tokens=a.result?.inputTokens??a.diagnostic?.inputTokens;if(cost>r.reserve||tokens>r.inputBound)state.stopReason='Observed bound violation';
 }));await persist();unknown=batch.every(b=>b.attempt.state==='unconfirmed')?unknown+4:0;
 console.log(JSON.stringify({completed:state.attempts.length,accepted:state.attempts.filter(a=>a.state==='accepted').length,unknown:state.attempts.filter(a=>a.state==='unconfirmed').length}));if(unknown>=4||state.stopReason){state.stopReason||='Four unavailable outcomes; no retry';break;}
}
state.finishedAt=new Date().toISOString();try{const after=await metadata('key');state.keyUsageAfter=after.usage;state.keyRemaining=after.limit_remaining;}catch{state.metadataUnavailable=true;}await persist();
