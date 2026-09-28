// OFFLINE regression replay. No inference, provider credentials, HTTP or page actions.
import {readFile,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {jevDecision} from '../../../cloudflare/ezkart-api/src/jev-provider.js';
import {JEV_HARNESS} from '../../../cloudflare/ezkart-api/src/jev-rule-harness.js';
const baseline=new URL('../expanded500-20260928/',import.meta.url),sha=v=>createHash('sha256').update(v).digest('hex');
const fixtureBytes=await readFile(new URL('benchmark.json',baseline)),resultBytes=await readFile(new URL('results.json',baseline)),b=JSON.parse(fixtureBytes),r=JSON.parse(resultBytes),fixtures=new Map(b.cases.map(c=>[c.id,c]));
if(sha(fixtureBytes)!==r.benchmarkSha256)throw Error('Baseline fixture changed');
const counts={cases:0,oldArchiveEligible:0,oldUnsupportedArchives:0,newArchiveEligible:0,newHumanReview:0,newClear:0,newUnsupportedArchives:0,supportedViolationDeferred:0};
const cases=r.attempts.map(a=>{const c=fixtures.get(a.caseId),eligible=a.state==='accepted'?a.result.outcome:null;
 // Opt into the harness explicitly to exercise rule checks. Historical records in
 // the live application lack this marker and go to human review regardless.
 const decision=jevDecision(eligible,{...c.input,harnessVersion:JEV_HARNESS}),bad=c.expected.decisionVerdict!=='needs_change';counts.cases++;
 if(a.decision.decisionVerdict==='needs_change'){counts.oldArchiveEligible++;if(bad)counts.oldUnsupportedArchives++;}
 if(decision.decisionVerdict==='needs_change'){counts.newArchiveEligible++;if(bad)counts.newUnsupportedArchives++;}
 else if(decision.decisionVerdict==='clear')counts.newClear++;else {counts.newHumanReview++;if(!bad)counts.supportedViolationDeferred++;}
 return {caseId:c.id,originalState:a.state,originalVerdict:a.result?.outcome?.verdict||null,originalDecision:a.decision.decisionVerdict,expectedOriginal:c.expected.decisionVerdict,decision};
});
const artifact={offlineOnly:true,newModelCalls:0,pageActions:0,heldOut:false,limitation:'Post-change replay on known synthetic failures; not a fresh or independent accuracy estimate. Current prompt was not run. Authored labels may be disputed.',harnessVersion:JEV_HARNESS,benchmarkSha256:sha(fixtureBytes),savedResultsSha256:sha(resultBytes),harnessSha256:sha(await readFile(new URL('../../../cloudflare/ezkart-api/src/jev-rule-harness.js',import.meta.url))),counts,cases};
await writeFile(new URL('replay.json',import.meta.url),JSON.stringify(artifact,null,2)+'\n');console.log(JSON.stringify({...artifact,cases:undefined},null,2));
