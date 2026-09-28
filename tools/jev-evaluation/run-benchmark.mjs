// One explicitly authorized, six-case synthetic run. Never resumes or retries a send.
import {readFile,open,writeFile,rename} from 'node:fs/promises';
import {resolve} from 'node:path';
import {randomBytes} from 'node:crypto';
import {jevRequest,callJev,JEV_MODEL,JEV_POLICY} from '../../cloudflare/ezkart-api/src/jev-provider.js';
const args=Object.fromEntries(process.argv.slice(2).map(v=>{const i=v.indexOf('=');return [v.slice(0,i),v.slice(i+1)];}));
if(!args['--key-file']||!args['--benchmark']||!args['--output'])throw Error('Specify private --key-file, --benchmark and new private --output absolute paths.');
const output=resolve(args['--output']),keyLines=(await readFile(args['--key-file'],'utf8')).split('\n'),line=keyLines.find(v=>/^[A-Z0-9_]*KEY=/.test(v));if(!line)throw Error('Private key configuration missing.');
const secret=line.slice(line.indexOf('=')+1).trim().replace(/^['"]|['"]$/g,''),benchmark=JSON.parse(await readFile(args['--benchmark'],'utf8'));
if(benchmark.synthetic!==true||benchmark.cases.length!==6)throw Error('Exactly six synthetic cases are required.');
const request=async url=>{const r=await fetch(url,{headers:{authorization:'Bearer '+secret},redirect:'error',signal:AbortSignal.timeout(15000)});if(!r.ok)throw Error('Read-only provider verification failed.');return r.json();};
const {data:meta}=await request('https://openrouter.ai/api/v1/key');
if(meta.limit!==5||meta.limit_remaining<0.10||meta.limit_reset!==null||Date.parse(meta.expires_at)<=Date.now())throw Error('Original limited beta key is not ready.');
const endpoints=await request('https://openrouter.ai/api/v1/models/'+JEV_MODEL+'/endpoints'),endpoint=endpoints.data.endpoints.find(e=>e.tag==='google-vertex/global');
if(!endpoint||!endpoint.supported_parameters.includes('structured_outputs')||Number(endpoint.pricing.prompt)>0.0000005||Number(endpoint.pricing.completion)>0.0000025)throw Error('Pinned strict-schema provider/cost changed.');
const state={version:1,synthetic:true,requestKey:randomBytes(16).toString('hex'),model:JEV_MODEL,policyVersion:JEV_POLICY,budgetUsd:0.10,reservedMicrousd:0,keyLimitUsd:meta.limit,keyUsageBefore:meta.usage,startedAt:new Date().toISOString(),records:[],attempts:[]};
const fence=await open(output,'wx',0o600);await fence.writeFile(JSON.stringify(state));await fence.sync();await fence.close();
const persist=async()=>{const temporary=output+'.tmp';await writeFile(temporary,JSON.stringify(state,null,2),{mode:0o600});await rename(temporary,output);};
for(const c of benchmark.cases){
 const payload=jevRequest(c.input,c.input.report.text,JEV_POLICY);state.reservedMicrousd+=10000;
 state.attempts.push({caseId:c.id,startedAt:new Date().toISOString(),state:'started'});await persist();
 try{const result=await callJev(secret,payload,c.input);state.records.push({caseId:c.id,title:c.title,input:c.input,result});state.attempts.at(-1).state='completed';}
 catch(e){state.attempts.at(-1).state='unconfirmed';state.attempts.at(-1).failureCode=/^jev_/.test(e.message)?e.message:'unconfirmed';if(e.diagnostic)state.attempts.at(-1).diagnostic=e.diagnostic;await persist();console.log(JSON.stringify({completed:state.records.length,attempted:state.attempts.length,state:'stopped',reason:state.attempts.at(-1).failureCode}));process.exitCode=1;break;}
 await persist();
 console.log(JSON.stringify({caseId:c.id,state:'completed',verdict:state.records.at(-1).result.outcome.verdict,costMicrousd:state.records.at(-1).result.costMicrousd}));
}
if(state.records.length===6){const latest=(await request('https://openrouter.ai/api/v1/key')).data;state.keyUsageAfter=latest.usage;state.completedAt=new Date().toISOString();await persist();console.log(JSON.stringify({completed:6,actualCostUsd:state.records.reduce((sum,r)=>sum+(r.result.costMicrousd||0),0)/1000000,keyUsageDelta:latest.usage-meta.usage,reservedUsd:0.06}));}
