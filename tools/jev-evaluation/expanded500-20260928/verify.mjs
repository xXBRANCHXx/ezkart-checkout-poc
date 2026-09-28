import {readFile} from 'node:fs/promises';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {normalizeJevOutcome,jevDecision} from '../../../cloudflare/ezkart-api/src/jev-provider.js';
const base=new URL('./',import.meta.url),sha=x=>createHash('sha256').update(x).digest('hex');
const bt=await readFile(new URL('benchmark.json',base),'utf8'),b=JSON.parse(bt),r=JSON.parse(await readFile(new URL('results.json',base),'utf8'));
assert.equal(sha(bt),r.benchmarkSha256);assert.equal(b.cases.length,500);assert.equal(r.attempts.length,500);assert.equal(new Set(r.attempts.map(a=>a.caseId)).size,500);assert.equal(r.actions,0);
assert.equal(sha(await readFile(new URL('../../../cloudflare/ezkart-api/src/jev-provider.js',base))),r.adapterSha256);
for(const a of r.attempts){const c=b.cases.find(c=>c.id===a.caseId);assert(c);if(a.rawResponseSha256){const raw=await readFile(new URL('responses/'+a.caseId+'.json',base));assert.equal(sha(raw),a.rawResponseSha256);}
for(const im of c.input.images||[]){assert.equal(sha(await readFile(new URL(im.path||im.file,base))),im.sha256);}
if(a.state==='accepted'){normalizeJevOutcome(a.result.outcome,c.input);assert.deepEqual(jevDecision(a.result.outcome,c.input),a.decision);}else assert.equal(a.decision.decisionVerdict,'escalate');}
assert(r.attempts.reduce((s,a)=>s+a.reservedMicrousd,0)<=r.totalReservationMicrousd);
console.log('PASS: 500 frozen cases, unique one-send receipts, source/image/response hashes, validation and backend replay.');
