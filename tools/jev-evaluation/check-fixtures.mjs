import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
const read = name => readFile(new URL(name, import.meta.url), 'utf8');
const benchmark = JSON.parse(await read('benchmark.json'));
const policy = JSON.parse(await read('evaluation-policy.json'));
// Full official-source metadata stays in the trusted application registry/UI.
// Only the policy version, jurisdiction and decision rules go to the model.
const modelPolicy = {version:policy.version,jurisdiction:policy.jurisdiction,
  rules:policy.rules.map(({code,text}) => ({code,text})),archiveEligibleCodes:policy.archiveEligibleCodes};
const schema = JSON.parse(await read('output.schema.json'));
const system = await read('system-prompt.txt');
assert.equal(benchmark.synthetic, true);
assert.equal(benchmark.cases.length, 6);
assert.equal(new Set(benchmark.cases.map(c => c.id)).size, 6);
assert.equal(policy.status, 'owner_approved_starter_policy');
const codes = schema.properties.findings.items.properties.code.enum;
const violations = policy.rules.map(r => r.code);
const sizes = [];
for (const c of benchmark.cases) {
  assert(schema.properties.verdict.enum.includes(c.expected.verdict));
  assert(c.input.revision && c.input.report.text && c.input.sources.length);
  assert.equal(c.input.coverage.textOnly, true);
  assert.equal(new Set(c.input.sources.map(s => s.id)).size, c.input.sources.length);
  for (const source of c.input.sources) {
    assert.match(source.id, /^page:\d+$/);
    assert(source.text && !/https?:\/\//i.test(source.text));
  }
  for (const code of c.expected.requiredCodes) assert(codes.includes(code));
  if (c.expected.archiveRecommended) {
    assert.equal(c.expected.verdict, 'needs_change');
    assert(c.expected.requiredCodes.some(code => violations.includes(code)));
    const evidence = c.expected.evidence;
    assert(evidence.quote.length > 0 && evidence.quote.length <= 500);
    assert(c.input.sources.find(s => s.id === evidence.sourceId)?.text.includes(evidence.quote));
  }
  if (c.input.coverage.unreviewedMedia.length) {
    assert.equal(c.expected.verdict, 'escalate');
    assert.equal(c.expected.archiveRecommended, false);
  }
  // Deliberately exclude expected answers and grading notes from model input.
  const request = {model:'google/gemini-3.1-flash-lite', max_tokens:1000,
    messages:[{role:'system',content:system},{role:'system',content:JSON.stringify(modelPolicy)},
      {role:'user',content:JSON.stringify(c.input)}],
    response_format:{type:'json_schema',json_schema:{name:'jev_review',strict:true,schema}},
    provider:{only:['google-vertex/global'],allow_fallbacks:false,require_parameters:true,
      data_collection:'deny',zdr:true,max_price:{prompt:0.5,completion:2.5}}};
  const bytes = Buffer.byteLength(JSON.stringify(request));
  assert(bytes <= 8000, `${c.id}: ${bytes} input bytes exceeds approved bound`);
  sizes.push({case:c.id,bytes,expected:c.expected.verdict});
}
assert(benchmark.cases.some(c => c.language === 'en'));
assert(benchmark.cases.some(c => c.language === 'id'));
assert.equal(benchmark.workflowChecks.length, 4);
console.log(JSON.stringify({ok:true,syntheticCases:6,modelCalls:0,cases:sizes},null,2));
