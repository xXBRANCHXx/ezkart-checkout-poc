import test from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {generateKeyPairSync,createHash,createHmac} from 'node:crypto';
import {fileURLToPath} from 'node:url';

const php=process.env.PHP_BINARY||'php',fixture=fileURLToPath(new URL('./doku-bca-snap-fixture.php',import.meta.url));
const keys=generateKeyPairSync('rsa',{modulusLength:2048,publicKeyEncoding:{type:'spki',format:'pem'},privateKeyEncoding:{type:'pkcs8',format:'pem'}});
const credentials={environment:'sandbox',clientId:'MCH-routing-fixture',secretKey:'fixture-secret-not-used-remotely',privateKey:keys.privateKey};
const routeBinding={environment:'sandbox',externalId:'00000000000000000000000000009876',orderId:'EZK-S-'+'A'.repeat(24),sellerProfileId:'SAC-seller',platformCashAccount:'2010000002',grossAmount:120000,platformAmount:26250};
const token={body:JSON.stringify({responseCode:'2007300',tokenType:'Bearer',accessToken:'routing-token',expiresIn:900})};
const reply=()=>({responseCode:'2000000',transactionType:'PAYMENT',splitRuleId:'split-fixture',rules:[{type:'FLAT',value:26250,currency:'IDR',accountNumber:2010000002}]});
function run(input={}){
  const result=spawnSync(php,[fixture],{input:JSON.stringify({credentials,routeBinding,...input}),encoding:'utf8',maxBuffer:4000000});
  assert.equal(result.status,0,result.stderr);assert.equal(result.stderr,'');return JSON.parse(result.stdout);
}
const header=(r,k)=>r.headers.find(x=>x.startsWith(k+': '))?.slice(k.length+2);

test('split creation sends one exact flat allocation using its original signed dispatch ID',()=>{
  const response=JSON.stringify(reply()),result=run({actions:[['splitPayload'],['splitCreate']],responses:[token,{body:response}]});
  assert(result.results.every(r=>r.ok),JSON.stringify(result.results));assert.equal(result.requests.length,2);
  const request=result.requests[1];assert.equal(request.url,'https://api-sandbox.doku.com/sub-account/v2.0/split-rules');assert.equal(header(request,'X-EXTERNAL-ID'),routeBinding.externalId);
  assert.deepEqual(JSON.parse(request.body),result.results[0].result);
  const canonical=['POST','/sub-account/v2.0/split-rules','routing-token',createHash('sha256').update(request.body).digest('hex'),header(request,'X-TIMESTAMP')].join(':');
  assert.equal(header(request,'X-SIGNATURE'),createHmac('sha512',credentials.secretKey).update(canonical).digest('base64'));
  assert.deepEqual(result.results[1].result.routing,{profileId:'SAC-seller',splitRuleId:'split-fixture'});assert.equal(result.results[1].result.evidence.responseBody,response);assert.equal(result.results[1].result.settlementVerified,false);
});

test('split identity, scope and exact integer amounts are validated before any provider call',()=>{
  for(const change of [{environment:'production'},{credentialFingerprint:'a'.repeat(64)},{externalId:'x'},{orderId:'EZK-P-'+'A'.repeat(24)},
    {sellerProfileId:'2010000001'},{platformCashAccount:'0201000002'},{platformCashAccount:2010000002},{platformCashAccount:'2010000002.0'},
    {platformAmount:0},{platformAmount:'26250'},{platformAmount:1.5},{grossAmount:0},{grossAmount:100000000001},{amount:1},{url:'https://other.invalid'}]){
    const result=run({routeBinding:{...routeBinding,...change},actions:[['splitCreate']]});assert.equal(result.results[0].ok,false,JSON.stringify(change));assert.equal(result.requests.length,0);
  }
  const result=run({routeBinding:{...routeBinding,grossAmount:1000,platformAmount:1300},actions:[['splitPayload']]});assert.equal(result.results[0].ok,true);assert.equal(result.results[0].result.rules[0].value,1300);
});

test('changed rules and ambiguous numeric or JSON tokens cannot confirm a split',()=>{
  for(const mutate of [r=>r.splitRuleId='',r=>r.transactionType='PURCHASE',r=>r.rules[0].type='PERCENTAGE',r=>r.rules[0].value++,r=>r.rules[0].currency='POINT',
    r=>r.rules[0].accountNumber=2010000001,r=>r.rules[0].extra='ignored',r=>r.rules.push(r.rules[0]),r=>r.rules=null,r=>r.responseCode='5000000']){
    const response=reply();mutate(response);const result=run({actions:[['splitCreate']],responses:[token,{body:JSON.stringify(response)}]});assert.equal(result.results[0].ok,false,JSON.stringify(response));assert.equal(result.requests.length,2);
  }
  for(const raw of [JSON.stringify(reply()).replace('26250','2.625e4'),JSON.stringify(reply()).replace('2010000002','2010000002.0'),JSON.stringify(reply()).replace('"value":','"value":1,"value":')]){
    const result=run({actions:[['splitCreate']],responses:[token,{body:raw}]});assert.equal(result.results[0].ok,false);
  }
});

test('lost or unsuccessful split replies make one attempt without retrying or exposing private provider data',()=>{
  for(const failure of [{throw:true},{status:503,body:'private-provider-message'},{status:409,body:'private-provider-message'},{body:'malformed'}]){
    const result=run({actions:[['splitCreate']],responses:[token,failure]});assert.equal(result.results[0].ok,false);assert.equal(result.requests.length,2);assert(!JSON.stringify(result.results).includes('private-provider-message'));
  }
  const production=run({credentials:{...credentials,environment:'production'},routeBinding:{...routeBinding,environment:'production',orderId:'EZK-P-'+'A'.repeat(24)},actions:[['splitCreate']],responses:[token,{body:JSON.stringify(reply())}]});
  assert.equal(production.results[0].ok,true);assert.equal(production.requests[1].url,'https://api.doku.com/sub-account/v2.0/split-rules');
});

test('new BCA creation refuses missing routing even though historic binding payloads remain readable',()=>{
  const binding={environment:'sandbox',externalId:'0'.repeat(31)+'1',orderId:routeBinding.orderId,partnerServiceId:'   19008',customerPrefix:'0',amount:58000,name:'Fixture',email:'fixture@example.com',expiresAt:'2026-09-27T04:20:00Z'};
  const old=run({binding,actions:[['payload'],['create']]});assert.equal(old.results[0].ok,true);assert.equal(old.results[1].reason,'routing_required');assert.equal(old.requests.length,0);
  for(const routing of [{profileId:'2010000001',splitRuleId:'split'},{profileId:'SAC-seller',splitRuleId:''},{profileId:'SAC-seller',splitRuleId:'split',account:'override'},null]){
    const result=run({binding:{...binding,routing},actions:[['create']]});assert.equal(result.results[0].ok,false);assert.equal(result.requests.length,0);
  }
});
