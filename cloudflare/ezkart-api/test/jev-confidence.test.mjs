import {JEV_HARNESS} from '../src/jev-rule-harness.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import {jevDecision,normalizeJevOutcome,jevRequest,JEV_POLICY} from '../src/jev-provider.js';
const snapshot={harnessVersion:JEV_HARNESS,sources:[{id:'page:1',kind:'visible_text',text:'Send your bank password.'}],coverage:{textOnly:true,truncated:false,unreviewedMedia:false}};
const outcome=(verdict,confidence)=>({verdict,confidence,summary:'Fixture recommendation',findings:verdict==='needs_change'?[{code:'credential_request',sourceId:'page:1',quote:'Send your bank password.',explanation:'Direct request'}]:[],uncertainties:[]});
for(const verdict of ['clear','needs_change'])for(const confidence of [0,0.79,0.7999,0.8,0.95,1])test(`${verdict} at ${confidence} obeys the exact 80% boundary`,()=>{
 const raw=outcome(verdict,confidence),normalized=normalizeJevOutcome(raw,snapshot),decision=jevDecision(normalized,snapshot);
 assert.equal(decision.decisionVerdict,confidence<0.8||verdict==='clear'?'escalate':verdict);assert.equal(decision.humanReviewRequired,confidence<0.8||verdict==='clear');assert.equal(raw.verdict,verdict);
});
for(const confidence of [undefined,null,'0.9',-0.01,1.01,NaN,Infinity])test(`invalid confidence ${String(confidence)} is rejected`,()=>assert.throws(()=>normalizeJevOutcome(outcome('clear',confidence),snapshot)));
test('material uncertainty, limitation findings and incomplete coverage override even 100% confidence',()=>{
 for(const verdict of ['clear','needs_change']){
  const raw=outcome(verdict,1);assert.equal(jevDecision({...raw,uncertainties:['Licence unknown']},snapshot).decisionVerdict,'escalate');
  assert.equal(jevDecision({...raw,findings:[...raw.findings,{code:'insufficient_evidence'}]},snapshot).decisionVerdict,'escalate');
  for(const coverage of [undefined,{truncated:true,unreviewedMedia:false},{truncated:false,unreviewedMedia:true},{truncated:false,unreviewedMedia:[{kind:'video'}]}])assert.equal(jevDecision(raw,{...snapshot,coverage}).decisionVerdict,'escalate');
  assert.equal(jevDecision(raw,{...snapshot,sources:[]}).decisionVerdict,'escalate');
  assert.equal(jevDecision(raw,{...snapshot,coverage:{truncated:false,unreviewedMedia:[]}}).decisionVerdict,verdict==='clear'?'escalate':verdict);
 }
});
test('historical confidence stays absent and cannot silently clear a review',()=>{
 const legacy=outcome('clear',0.9);delete legacy.confidence;
 assert.throws(()=>normalizeJevOutcome(legacy,snapshot));
 assert.deepEqual(normalizeJevOutcome(legacy,snapshot,{historical:true}),legacy);
 assert.equal(jevDecision(legacy,snapshot).decisionVerdict,'escalate');
});
test('escalation remains escalation at high confidence and requests use the required contract',()=>{
 assert.equal(jevDecision(outcome('escalate',1),snapshot).decisionVerdict,'escalate');
 assert(jevRequest(snapshot,'Synthetic concern',JEV_POLICY).response_format.json_schema.schema.required.includes('confidence'));
});
