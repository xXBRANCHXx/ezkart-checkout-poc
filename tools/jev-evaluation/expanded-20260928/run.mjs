// Owner-requested diagnostic only. Fixed 120 synthetic cases, original receipt, no retries.
import {readFile,writeFile,open,rename} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {jevRequest,callJev,jevDecision,JEV_MODEL,JEV_POLICY} from '../../../cloudflare/ezkart-api/src/jev-provider.js';
const args=Object.fromEntries(process.argv.slice(2).map(a=>{const i=a.indexOf('=');return [a.slice(0,i),a.slice(i+1)];}));
if(!args['--key-file']||!args['--output'])throw Error('Private absolute --key-file and fresh --output required.');
const benchmarkText=await readFile(new URL('./benchmark.json',import.meta.url),'utf8'),benchmark=JSON.parse(benchmarkText),hash=s=>createHash('sha256').update(s).digest('hex');
if(!benchmark.synthetic||benchmark.cases.length!==120||new Set(benchmark.cases.map(c=>c.id)).size!==120)throw Error('Expected frozen 120 unique synthetic cases.');
const requests=benchmark.cases.map(c=>jevRequest(c.input,c.input.report.text,JEV_POLICY));
const file=await readFile(args['--key-file'],'utf8'),line=file.split('\n').find(s=>/^[A-Z0-9_]*KEY=/.test(s));if(!line)throw Error('Missing private key.');
const secret=line.slice(line.indexOf('=')+1).trim().replace(/^['"]|['"]$/g,'');
const metadata=async path=>{const r=await fetch('https://openrouter.ai/api/v1/'+path,{headers:{authorization:'Bearer '+secret},redirect:'error',signal:AbortSignal.timeout(15000)});if(!r.ok)throw Error('Provider metadata read failed');return (await r.json()).data;};
const before=await metadata('key');if(before.limit!==5||before.limit_reset!==null||before.limit_remaining<1.20||Date.parse(before.expires_at)<=Date.now())throw Error('Dedicated $5 key/cap is not ready.');
const endpoints=await metadata('models/'+JEV_MODEL+'/endpoints'),endpoint=endpoints.endpoints.find(e=>e.tag==='google-vertex/global');if(!endpoint?.supported_parameters.includes('structured_outputs')||Number(endpoint.pricing.prompt)>0.0000005||Number(endpoint.pricing.completion)>0.0000025)throw Error('Pinned provider contract or price changed.');
const state={version:1,synthetic:true,benchmarkSha256:hash(benchmarkText),adapterSha256:hash(await readFile(new URL('../../../cloudflare/ezkart-api/src/jev-provider.js',import.meta.url),'utf8')),model:JEV_MODEL,policyVersion:JEV_POLICY,budgetUsd:1.2,maxAttempts:120,startedAt:new Date().toISOString(),keyUsageBefore:before.usage,reservedMicrousd:0,attempts:[]};
const output=args['--output'],fence=await open(output,'wx',0o600);await fence.writeFile(JSON.stringify(state));await fence.sync();await fence.close();
const persist=async()=>{await writeFile(output+'.tmp',JSON.stringify(state,null,2),{mode:0o600});await rename(output+'.tmp',output);};
let consecutiveUnknown=0;
for(let i=0;i<benchmark.cases.length;i++){
 const c=benchmark.cases[i];if(state.reservedMicrousd+10000>1200000)throw Error('Reservation limit');
 const a={caseId:c.id,state:'started',startedAt:new Date().toISOString(),requestSha256:hash(JSON.stringify(requests[i]))};state.attempts.push(a);state.reservedMicrousd+=10000;await persist();
 try{a.result=await callJev(secret,requests[i],c.input);a.state='accepted';a.decision=jevDecision(a.result.outcome,c.input);consecutiveUnknown=0;}
 catch(e){a.failureCode=/^jev_/.test(e.message)?e.message:'unconfirmed';a.state=e.diagnostic?'rejected':'unconfirmed';if(e.diagnostic)a.diagnostic=e.diagnostic;a.decision=jevDecision(null,c.input);consecutiveUnknown=e.diagnostic?0:consecutiveUnknown+1;}
 a.completedAt=new Date().toISOString();await persist();
 console.log(JSON.stringify({attempt:i+1,caseId:c.id,state:a.state,verdict:a.result?.outcome?.verdict,confidence:a.result?.outcome?.confidence,decision:a.decision.decisionVerdict,failureCode:a.failureCode}));
 if(consecutiveUnknown>=3){state.stopReason='Three consecutive unavailable outcomes; no retry.';break;}
}
state.finishedAt=new Date().toISOString();try{const after=await metadata('key');state.keyUsageAfter=after.usage;state.keyRemaining=after.limit_remaining;state.keyMetadataAt=new Date().toISOString();}catch{state.metadataReadFailed=true;}
await persist();console.log(JSON.stringify({attempts:state.attempts.length,accepted:state.attempts.filter(a=>a.state==='accepted').length,rejected:state.attempts.filter(a=>a.state==='rejected').length,unconfirmed:state.attempts.filter(a=>a.state==='unconfirmed').length,reservedUsd:state.reservedMicrousd/1e6,keyUsageDelta:state.keyUsageAfter===undefined?null:state.keyUsageAfter-state.keyUsageBefore}));
