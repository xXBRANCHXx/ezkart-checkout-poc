// Integrity checks, not model calls. Recompute the reported rates from saved evidence.
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {jevDecision,normalizeJevOutcome} from '../../../cloudflare/ezkart-api/src/jev-provider.js';
const raw=await readFile(new URL('./benchmark.json',import.meta.url),'utf8'),b=JSON.parse(raw),d=JSON.parse(await readFile(new URL('./results.json',import.meta.url),'utf8'));
assert.equal(createHash('sha256').update(raw).digest('hex'),d.metadata.benchmarkSha256);
assert.equal(d.results.length,120);assert.equal(new Set(d.results.map(r=>r.id)).size,120);
for(const v of ['clear','needs_change','escalate'])assert.equal(b.cases.filter(c=>c.expected.verdict===v).length,40);
for(const l of ['en','id'])assert.equal(b.cases.filter(c=>c.language===l).length,60);
for(const r of d.results){const original=b.cases.find(c=>c.id===r.id);assert.deepEqual(r.input,original.input);assert.deepEqual(r.expected,original.expected);const o=r.state==='accepted'?normalizeJevOutcome(r.rawOutcome,r.input):null;assert.equal(jevDecision(o,r.input).decisionVerdict,r.decisionVerdict);assert.equal(r.usableCorrect,r.state==='accepted'&&r.rawOutcome.verdict===r.expected.verdict);}
const s=d.summary;assert.equal(s.total,s.usableCorrect+s.acceptedWrong+s.rejected+s.unconfirmed);assert.equal(s.total,s.archiveEligible+s.noArchive+s.humanReview);assert.equal(s.wrongAutomatic,s.falseArchive+s.falseClear);assert.equal(s.total,s.routingExact+s.unnecessaryHumanReview+s.wrongAutomatic);
assert.equal(s.usableCorrect,98);assert.equal(s.acceptedWrong,22);assert.equal(s.falseArchive,9);assert.equal(s.falseClear,0);assert.equal(s.hundredConfidence,91);assert.equal(s.hundredWrong,9);
assert.equal(d.bins.reduce((n,b)=>n+b.n,0),s.parsedConfidence);assert.equal(d.thresholds[0].wrongAutomatic,s.wrongAutomatic);assert.equal(d.thresholds[0].humanReview,s.humanReview);
assert(s.unknownCosts===0);assert(d.metadata.keyUsageDelta>0);assert(Math.abs(s.roundedResponseCostUsd-d.metadata.keyUsageDelta)<120/1e6);
console.log(JSON.stringify({ok:true,verifiedCases:120,modelCalls:0,modelCorrect:s.usableCorrect,modelWrong:s.acceptedWrong,wrongAutomatic:s.wrongAutomatic}));
