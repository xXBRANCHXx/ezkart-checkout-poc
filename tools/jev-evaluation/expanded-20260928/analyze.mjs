import {readFile,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {parseMessageJSON} from '../../../cloudflare/ezkart-api/src/message-json.js';
import {jevDecision} from '../../../cloudflare/ezkart-api/src/jev-provider.js';
const path=process.argv[2];if(!path)throw Error('Private run receipt required');
const run=JSON.parse(await readFile(path,'utf8')),text=await readFile(new URL('./benchmark.json',import.meta.url),'utf8'),benchmark=JSON.parse(text);
const hash=s=>createHash('sha256').update(s).digest('hex');if(hash(text)!==run.benchmarkSha256)throw Error('Frozen labels changed');
if(hash(await readFile(new URL('../../../cloudflare/ezkart-api/src/jev-provider.js',import.meta.url),'utf8'))!==run.adapterSha256)throw Error('Adapter changed during evaluation');
const results=benchmark.cases.map(c=>{const a=run.attempts.find(a=>a.caseId===c.id);if(!a)throw Error('Unattempted case: '+c.id);let raw=a.result?.outcome||null;if(!raw&&a.diagnostic?.rawOutcome){try{raw=parseMessageJSON(a.diagnostic.rawOutcome);}catch{}}
 const accepted=a.state==='accepted',d=jevDecision(accepted?raw:null,c.input),confidence=typeof raw?.confidence==='number'&&Number.isFinite(raw.confidence)&&raw.confidence>=0&&raw.confidence<=1?raw.confidence:null;
 return {...c,state:a.state,failureCode:a.failureCode||null,rawOutcome:raw,rejectedOutput:a.diagnostic?.rawOutcome||null,confidence,...d,
  verdictMatch:raw?.verdict===c.expected.verdict,usableCorrect:accepted&&raw?.verdict===c.expected.verdict,
  requiredCodeMatch:c.expected.requiredCodes.every(code=>raw?.findings?.some(f=>f.code===code)),
  automaticWrong:d.decisionVerdict!=='escalate'&&d.decisionVerdict!==c.expected.verdict,
  unnecessaryHumanReview:d.decisionVerdict==='escalate'&&c.expected.verdict!=='escalate',
  routingMatch:d.decisionVerdict===c.expected.verdict,
  costMicrousd:a.result?.costMicrousd??a.diagnostic?.costMicrousd??null,
  inputTokens:a.result?.inputTokens??a.diagnostic?.inputTokens??null,outputTokens:a.result?.outputTokens??a.diagnostic?.outputTokens??null};
});
const n=p=>results.filter(p).length;
let accounting=null;try{accounting=JSON.parse(await readFile(new URL('./accounting.json',import.meta.url),'utf8'));}catch{}

const summary={total:results.length,accepted:n(r=>r.state==='accepted'),rejected:n(r=>r.state==='rejected'),unconfirmed:n(r=>r.state==='unconfirmed'),usableCorrect:n(r=>r.usableCorrect),acceptedWrong:n(r=>r.state==='accepted'&&!r.verdictMatch),rawVerdictMatches:n(r=>r.verdictMatch),rawVerdictWrong:n(r=>r.rawOutcome&&!r.verdictMatch),parsedConfidence:n(r=>r.confidence!==null),
 archiveEligible:n(r=>r.decisionVerdict==='needs_change'),noArchive:n(r=>r.decisionVerdict==='clear'),humanReview:n(r=>r.humanReviewRequired),wrongAutomatic:n(r=>r.automaticWrong),falseArchive:n(r=>r.decisionVerdict==='needs_change'&&r.expected.verdict!=='needs_change'),falseClear:n(r=>r.decisionVerdict==='clear'&&r.expected.verdict!=='clear'),unnecessaryHumanReview:n(r=>r.unnecessaryHumanReview),routingExact:n(r=>r.routingMatch),
 highConfidence:n(r=>r.confidence>=0.8),hundredConfidence:n(r=>r.confidence===1),hundredWrong:n(r=>r.confidence===1&&!r.verdictMatch),hundredRejected:n(r=>r.confidence===1&&r.state==='rejected'),unknownCosts:n(r=>r.costMicrousd===null),roundedResponseCostUsd:results.reduce((s,r)=>s+(r.costMicrousd||0),0)/1e6};
const bins=[[0,0.8,'Below 80%'],[0.8,0.9,'80–89%'],[0.9,0.95,'90–94%'],[0.95,1,'95–99%'],[1,1.01,'100%']].map(([lo,hi,label])=>{const rows=results.filter(r=>r.confidence!==null&&r.confidence>=lo&&r.confidence<hi);return {label,n:rows.length,meanConfidence:rows.length?rows.reduce((s,r)=>s+r.confidence,0)/rows.length:null,rawAgreement:rows.length?rows.filter(r=>r.verdictMatch).length/rows.length:null,usableCorrect:rows.length?rows.filter(r=>r.usableCorrect).length/rows.length:null};});
const thresholds=[0.8,0.9,0.95,0.99,1].map(threshold=>{const rows=results.map(r=>({...r,d:jevDecision(r.state==='accepted'?{...r.rawOutcome,confidence:r.confidence>=threshold?1:0}:null,r.input).decisionVerdict}));const count=p=>rows.filter(p).length;return {threshold,automatic:count(r=>r.d!=='escalate'),wrongAutomatic:count(r=>r.d!=='escalate'&&r.d!==r.expected.verdict),humanReview:count(r=>r.d==='escalate')};});
const output={metadata:{model:run.model,policy:run.policyVersion,adapterSha256:run.adapterSha256,benchmarkSha256:run.benchmarkSha256,startedAt:run.startedAt,finishedAt:run.finishedAt,keyUsageBefore:run.keyUsageBefore,keyUsageAfter:accounting?.keyUsageAfter??run.keyUsageAfter,keyUsageDelta:accounting?.keyUsageDelta??(run.keyUsageAfter===undefined?null:run.keyUsageAfter-run.keyUsageBefore),keyRemaining:accounting?.keyRemaining??run.keyRemaining,billingReadAt:accounting?.at??run.keyMetadataAt,initialPostRunUsage:run.keyUsageAfter,reservedUsd:run.reservedMicrousd/1e6,design:benchmark.design,labelBasis:benchmark.labelBasis},summary,bins,thresholds,results};
await writeFile(new URL('./results.json',import.meta.url),JSON.stringify(output,null,2)+'\n');
console.log(JSON.stringify({summary,bins,thresholds,issues:results.filter(r=>r.automaticWrong||!r.usableCorrect).map(r=>({id:r.id,expected:r.expected.verdict,raw:r.rawOutcome?.verdict,confidence:r.confidence,state:r.state,effective:r.decisionVerdict,summary:r.rawOutcome?.summary}))},null,2));
