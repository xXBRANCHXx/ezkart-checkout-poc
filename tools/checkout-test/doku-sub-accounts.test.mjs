import test from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {generateKeyPairSync,createHash,createHmac,verify} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {mkdtempSync,chmodSync,readFileSync,writeFileSync,statSync,mkdirSync,symlinkSync,rmSync,readdirSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {setup} from './fixture.mjs';

const php=process.env.PHP_BINARY||'php',fixture=fileURLToPath(new URL('./doku-sub-accounts-fixture.php',import.meta.url));
const keys=generateKeyPairSync('rsa',{modulusLength:2048,publicKeyEncoding:{type:'spki',format:'pem'},privateKeyEncoding:{type:'pkcs8',format:'pem'}});
const credentials={environment:'sandbox',clientId:'MCH-fixture-only',secretKey:'fixture-secret-not-used-remotely',privateKey:keys.privateKey};
const profile='SAC-1234-1790416800000',account='2010000001',pending='2030000001';
const from='2026-09-25T00:00:00Z',to='2026-09-26T00:00:00Z';
const response=body=>({body:typeof body==='string'?body:JSON.stringify(body)});
const token=()=>response({responseCode:'2007300',tokenType:'Bearer',accessToken:'fixture-token',expiresIn:900});
const balance=()=>({responseCode:'2000000',profileId:profile,name:'Toko ☕',accounts:[
  {type:'DOKU_MERCHANT_IDR',currency:'IDR',accountNo:account,balance:{available:'95000.00',reserved:'5000.00'}},
  {type:'DOKU_MERCHANT_PENDING_IDR',currency:'IDR',accountNo:pending,balance:{available:'120000.00',reserved:'0.00'}},
  {type:'DOKU_MERCHANT_POINT',currency:'POINT',accountNo:'2040000001',balance:{available:'0.00',reserved:'0.00'}},
]});
const row=(extra={})=>({mutationType:'CREDIT',transactionType:'PAYMENT',amount:120000,currency:'IDR',status:'SUCCESS',dateTime:'2026-09-25T12:00:00+07:00',remark:'Pembayaran ☕',partnerReferenceNo:'order-fixture',referenceNo:'doku-fixture',channel:'VIRTUAL_ACCOUNT_BCA',...extra});
const history=(rows=[row()])=>response({responseCode:'2000000',detailData:rows});
const status=(extra={})=>({responseCode:'2000000',partnerReferenceNo:'order-fixture',transactionType:'PAYMENT',latestTransactionStatus:'00',latestTransactionDesc:'success',transactionDate:'2026-09-25T12:00:00+07:00',amount:{value:'120000.00',currency:'IDR'},refundHistory:[],...extra});
function run(input,{expectErrorOutput=false}={}){
  const result=spawnSync(php,[fixture],{input:JSON.stringify({credentials,...input}),encoding:'utf8',maxBuffer:12000000});
  assert.equal(result.status,0,result.stderr);
  if(!expectErrorOutput)assert.equal(result.stderr,'');
  const parsed=JSON.parse(result.stdout);if(expectErrorOutput)parsed.errorOutput=JSON.parse(result.stderr);return parsed;
}
const readBalance=(body,overrides={})=>run({actions:[['balances',profile]],responses:[token(),response(body)],...overrides});
const readHistory=body=>run({actions:[['history',account,from,to]],responses:[token(),response(body)]});
const header=(request,name)=>request.headers.find(line=>line.startsWith(name+': '))?.slice(name.length+2);

test('DOKU SNAP reads use independently verified RSA and HMAC signatures with pinned origins and private evidence',()=>{
  const data=run({actions:[['balances',profile],['history',account,from,to,0,50],['status','order-fixture'],['debug']],responses:[token(),response(balance()),history(),response(status())]});
  assert(data.results.every(r=>r.ok));assert.equal(data.requests.length,4);
  const auth=data.requests[0],timestamp=header(auth,'X-TIMESTAMP');
  assert.equal(auth.url,'https://api-sandbox.doku.com/authorization/v1/access-token/b2b');assert.equal(auth.body,'{"grantType":"client_credentials"}');
  assert(verify('RSA-SHA256',Buffer.from(credentials.clientId+'|'+timestamp),keys.publicKey,Buffer.from(header(auth,'X-SIGNATURE'),'base64')));
  const external=[];
  for(const request of data.requests.slice(1)){
    const path=new URL(request.url).pathname,canonical=['POST',path,'fixture-token',createHash('sha256').update(request.body).digest('hex'),header(request,'X-TIMESTAMP')].join(':');
    assert.equal(header(request,'X-SIGNATURE'),createHmac('sha512',credentials.secretKey).update(canonical).digest('base64'));
    assert.equal(header(request,'Authorization'),'Bearer fixture-token');assert.equal(header(request,'X-PARTNER-ID'),credentials.clientId);
    assert.match(header(request,'X-EXTERNAL-ID'),/^\d{32}$/);external.push(header(request,'X-EXTERNAL-ID'));
  }
  assert.equal(new Set(external).size,3);assert.deepEqual(JSON.parse(data.requests[2].body),{accountNo:account,fromDateTime:from,toDateTime:to,pageSize:'50',pageNumber:'0'});
  const evidence=data.results[0].result.evidence;assert.equal(evidence.responseBody,JSON.stringify(balance()));assert.equal(evidence.credentialFingerprint,data.fingerprint);
  assert(!JSON.stringify(data.results).includes('fixture-token'));assert(!JSON.stringify(data.results).includes(credentials.secretKey));assert(!JSON.stringify(data.results).includes('PRIVATE KEY'));
  const production=readBalance(balance(),{credentials:{...credentials,environment:'production'}});assert.equal(new URL(production.requests[0].url).host,'api.doku.com');assert.notEqual(data.fingerprint,production.fingerprint);
  assert.notEqual(data.fingerprint,readBalance(balance(),{credentials:{...credentials,secretKey:'a-different-private-fixture-secret'}}).fingerprint);
});

test('tokens expire conservatively and authentication failures never trigger an implicit request retry',()=>{
  const data=run({actions:[['balances',profile],['advance',869],['balances',profile],['advance',1],['balances',profile]],responses:[token(),response(balance()),response(balance()),token(),response(balance())]});
  assert(data.results.every(r=>r.ok));assert.equal(data.requests.filter(r=>r.url.includes('access-token')).length,2);
  const failed=run({actions:[['balances',profile],['balances',profile]],responses:[token(),{status:401,body:'private provider failure'},token(),response(balance())]});
  assert.equal(failed.results[0].reason,'http');assert.equal(failed.results[1].ok,true);assert.equal(failed.requests.length,4);
  for(const change of [{expiresIn:30},{expiresIn:'1e3'},{accessToken:'token\r\nInjected: yes'},{tokenType:'Mac'},{responseCode:'2000000'}]){
    const raw={responseCode:'2007300',tokenType:'Bearer',accessToken:'fixture-token',expiresIn:900,...change};
    const result=run({actions:[['balances',profile]],responses:[response(raw)]});assert.equal(result.results[0].reason,'token');assert.equal(result.requests.length,1);
  }
});

test('financial numbers stay exact above JavaScript precision and cash, pending, reserved and void records stay distinct',()=>{
  const b=balance();b.accounts[0].balance.available='9007199254740993.00';b.accounts[0].balance.reserved='-50.00';
  const result=readBalance(b).results[0].result.data;assert.equal(result.accounts.DOKU_MERCHANT_IDR.available,'9007199254740993');assert.equal(result.accounts.DOKU_MERCHANT_IDR.reserved,'-50');assert.equal(Object.keys(result.accounts).length,2);
  let raw=JSON.stringify({responseCode:'2000000',detailData:['SUCCESS','PENDING','FAILED','VOID'].map((s,n)=>row({status:s,amount:'EXACT',mutationType:n%2?'DEBIT':'CREDIT',transactionType:n?'SPLIT_TRANSACTION':'PAYMENT'}))}).replaceAll('"EXACT"','9007199254740993.00');
  const read=readHistory(raw);assert.equal(read.results[0].ok,true);const rows=read.results[0].result.data.items;
  assert.deepEqual(rows.map(r=>r.status),['SUCCESS','PENDING','FAILED','VOID']);assert(rows.every(r=>r.amount==='9007199254740993'));assert.equal(rows.length,4);assert.equal(rows[0].dateTime,'2026-09-25T05:00:00.000000Z');assert.equal(read.results[0].result.evidence.responseBody,raw);
  for(const amount of ['1.25','1e3','9223372036854775808','-1.00','00.00']){
    const invalid=readHistory({responseCode:'2000000',detailData:[row({amount})]});assert.equal(invalid.results[0].reason,'amount');
  }
});

test('balance responses must match the requested profile and unambiguous IDR account identities',()=>{
  for(const mutate of [b=>b.profileId='SAC-another-seller',b=>b.accounts.pop()&&b.accounts.pop(),b=>b.accounts[1].accountNo=account,b=>b.accounts[1].type='DOKU_MERCHANT_IDR',b=>b.accounts[0].currency='POINT',b=>b.accounts[0].accountNo='https://other.test',b=>b.accounts[0].balance.available='1.10']){
    const b=balance();mutate(b);assert.equal(readBalance(b).results[0].ok,false);
  }
  const invalid=run({actions:[['balances','bad\r\nprofile'],['history','https://other.test',from,to],['history',account,'2026-02-30T00:00:00Z',to],['history',account,from,to,1000],['history',account,from,to,0,101]],responses:[]});
  assert(invalid.results.every(r=>!r.ok));assert.equal(invalid.requests.length,0);
});

test('history refuses malformed, out-of-window, unordered and foreign-currency evidence',()=>{
  const cases=[{detailData:{}},{detailData:[row({currency:'POINT'})]},{detailData:[row({status:'UNKNOWN'})]},{detailData:[row({mutationType:'ADJUST'})]},
    {detailData:[row({dateTime:'2026-09-27T00:00:00Z'})]},{detailData:[row({dateTime:'2026-09-25T24:00:00Z'})]},
    {detailData:[row(),row({dateTime:'2026-09-25T18:00:00+07:00'})]},{detailData:[row({referenceNo:null})]}];
  for(const extra of cases)assert.equal(readHistory({responseCode:'2000000',...extra}).results[0].ok,false);
  const full=run({actions:[['history',account,from,to,0,1],['history',account,from,to,1,1]],responses:[token(),history(),history([])]});
  assert.equal(full.results[0].result.data.exhausted,false);assert.equal(full.results[1].result.data.exhausted,true);assert.equal(JSON.parse(full.requests[2].body).pageNumber,'1');
  const fee=row({transactionType:'SETTLEMENT_FEE',mutationType:'DEBIT',amount:4750});delete fee.partnerReferenceNo;
  const feeRead=readHistory({responseCode:'2000000',detailData:[fee]}).results[0];assert.equal(feeRead.ok,true);assert.equal(feeRead.result.data.items[0].partnerReferenceNo,null);assert.equal(feeRead.result.data.items[0].referenceNo,'doku-fixture');
});

test('transaction status preserves refund history and rejects ambiguous references or unsupported outcomes',()=>{
  for(const code of ['00','03','04','05','06']){
    const body=status({latestTransactionStatus:code,refundHistory:[{refundNo:'refund-one',refundStatus:'00',refundAmount:{value:'25000.00',currency:'IDR'},transactionDate:'2026-09-25T14:00:00+07:00',reason:'Partial return'}]});
    const result=run({actions:[['status','order-fixture']],responses:[token(),response(body)]});assert.equal(result.results[0].result.data.latestTransactionStatus,code);assert.equal(result.results[0].result.data.refundHistory[0].amount,'25000');
  }
  for(const extra of [{partnerReferenceNo:'some-other-order'},{latestTransactionStatus:'07'},{latestTransactionStatus:null},{latestTransactionDesc:'void'},{amount:{value:'120000.00',currency:'USD'}},{refundHistory:{}},{refundHistory:null}]){
    assert.equal(run({actions:[['status','order-fixture']],responses:[token(),response(status(extra))]}).results[0].ok,false);
  }
  const noHistory=status();delete noHistory.refundHistory;
  const observed=run({actions:[['status','order-fixture']],responses:[token(),response(noHistory)]});assert.equal(observed.results[0].result.data.refundHistoryPresent,false);
});

test('strict financial JSON rejects duplicate keys, invalid syntax and nesting without touching quoted amounts',()=>{
  const good=run({json:'{"amount":9007199254740993.00,"remark":"price: 1e999, \\"quoted\\"","flag":true,"other":null,"rows":[]}'});
  assert.equal(good.value.amount.value,'9007199254740993.00');assert.equal(good.value.remark,'price: 1e999, "quoted"');assert.equal(good.value.flag,true);assert.equal(good.value.other,null);
  for(const json of ['{"a":1,"a":2}','{"a":1,"\\u0061":2}','{"x":{"a":null,"a":3}}','{"x":01}','{"x":1,}','{"x":[1,]}','{"x":NaN}','{"x":"\\ud800"}','{"x":"\\q"}','{} true','[]','{"x":'+ '['.repeat(35)+'0'+']'.repeat(35)+'}'])assert(run({json}).error,json);
});

test('transport, oversized and unsuccessful responses fail closed without leaking provider bodies',()=>{
  for(const next of [{status:500,body:'private provider details'},{status:302,body:'redirect to evil'},{throw:true},response('{"responseCode":"2000000","responseCode":"5000000"}'),response({responseCode:'5000000',private:'sensitive'}),response(' '.repeat(2000001))]){
    const result=run({actions:[['balances',profile]],responses:[token(),next]});assert.equal(result.results[0].ok,false);assert.equal(result.requests.length,2);assert(!JSON.stringify(result.results).includes('private provider details'));assert(!JSON.stringify(result.results).includes('sensitive'));
  }
  for(const changes of [{environment:'https://other.test'},{clientId:'key\r\nInjected: yes'},{secretKey:'short'},{privateKey:'not a key'}]){
    const result=run({credentials:{...credentials,...changes},actions:[['balances',profile]]});assert.equal(result.reason,'configuration');assert.deepEqual(result.requests,[]);
  }
});

const hundred=()=>Array.from({length:100},(_,n)=>row({referenceNo:'provider-'+n,partnerReferenceNo:'order-'+n}));
test('provider observations exhaust both bound accounts and preserve durable evidence without claiming a settlement snapshot',()=>{
  const b=balance();b.accounts[0].balance.available='100000.00';
  const result=run({actions:[['observe',profile,from,to,3]],responses:[token(),response(balance()),history(hundred()),history([row({referenceNo:'last',partnerReferenceNo:'last-order'})]),history([row({status:'VOID'})]),response(b)]});
  assert.equal(result.results[0].ok,true);const report=result.results[0].result;
  assert.equal(report.coverage.DOKU_MERCHANT_IDR.rows,101);assert.equal(report.coverage.DOKU_MERCHANT_PENDING_IDR.rows,1);assert.equal(report.pagesExhausted,true);
  assert.equal(report.balancesChanged,true);assert.equal(report.atomicSnapshot,false);assert.equal(report.settlementVerified,false);assert.equal(result.observations.length,5);
  assert.deepEqual(result.observations.map(r=>r.kind),['balance_before','history_page','history_page','history_page','balance_after']);
  assert.equal(JSON.parse(result.requests[4].body).accountNo,pending);
  const identical=run({actions:[['observe',profile,from,to,1]],responses:[token(),response(balance()),history([row(),row()]),history([]),response(balance())]});
  assert.equal(identical.results[0].ok,true);assert.equal(identical.results[0].result.coverage.DOKU_MERCHANT_IDR.rows,2);
});

test('bounded observations expose truncation and stop at changing accounts, unstable pages or failed evidence storage',()=>{
  const limited=run({actions:[['observe',profile,from,to,1]],responses:[token(),response(balance()),history(hundred()),history([]),response(balance())]});
  assert.equal(limited.results[0].result.pagesExhausted,false);assert.equal(limited.requests.length,5);
  const changed=balance();changed.accounts[0].accountNo='2010000099';
  const scenarios=[
    {responses:[token(),response(balance()),history([]),history([]),response(changed)],reason:'account_changed',observations:4},
    {responses:[token(),response(balance()),history(hundred()),history(hundred())],reason:'history_overlap',observations:3},
    {responses:[token(),response(balance()),history(hundred()),history([row({dateTime:'2026-09-25T18:00:00+07:00'})])],reason:'history_order',observations:3},
    {responses:[token(),response(balance()),history([])],failWriteAt:2,reason:'RuntimeException',observations:2},
  ];
  for(const scenario of scenarios){
    const result=run({actions:[['observe',profile,from,to,3]],...scenario});assert.equal(result.results[0].reason,scenario.reason);assert.equal(result.observations.length,scenario.observations);assert.equal(result.requests.length,scenario.responses.length);
  }
  const invalid=run({actions:[['observe',profile,from,to,0],['observe',profile,'2026-02-30T00:00:00Z',to,1]]});assert(invalid.results.every(r=>!r.ok));assert.equal(invalid.requests.length,0);
});

test('the observation CLI creates private complete evidence and preserves bounded-incomplete coverage',t=>{
  const directory=mkdtempSync(join(tmpdir(),'ezkart-doku-observation-'));chmodSync(directory,0o700);t.after(()=>rmSync(directory,{recursive:true,force:true}));
  for(const full of [false,true]){
    const output=join(directory,full?'bounded.jsonl':'exhausted.jsonl');
    const args=['--environment=sandbox','--profile='+profile,'--from='+from,'--to='+to,'--max-pages=1','--output='+output];
    const data=run({actions:[['auditCLI',args]],responses:[token(),response(balance()),history(full?hundred():[]),history([]),response(balance())]});
    const outcome=data.results[0].result;assert.equal(outcome.exit,full?2:0);assert.equal(outcome.stdout.pagesExhausted,!full);
    assert.equal(statSync(output).mode&0o777,0o600);const raw=readFileSync(output,'utf8'),rows=raw.trim().split('\n').map(JSON.parse);
    assert.equal(rows[0].kind,'started');assert.equal(rows.at(-1).kind,'finished');assert.equal(rows.at(-1).settlementVerified,false);assert.equal(rows.at(-1).responses,4);
    assert(!raw.includes('fixture-token'));assert(!raw.includes(credentials.secretKey));assert(!raw.includes('PRIVATE KEY'));
    for(const row of rows.filter(r=>r.evidence)){assert.equal(row.evidence.environment,'sandbox');assert.equal(row.evidence.credentialFingerprint,data.fingerprint);assert.doesNotThrow(()=>JSON.parse(row.evidence.responseBody));}
  }
  const failedOutput=join(directory,'failed.jsonl'),args=['--environment=sandbox','--profile='+profile,'--from='+from,'--to='+to,'--output='+failedOutput];
  const failed=run({actions:[['auditCLI',args]],responses:[token(),response(balance()),{status:500,body:'private-provider-error'}]},{expectErrorOutput:true});
  assert.equal(failed.results[0].result.exit,1);assert.equal(failed.errorOutput.error,'http');
  const raw=readFileSync(failedOutput,'utf8'),rows=raw.trim().split('\n').map(JSON.parse);
  assert.deepEqual(rows.map(r=>r.kind),['started','balance_before','failed']);assert.equal(rows.at(-1).responses,1);assert(!raw.includes('private-provider-error'));assert.equal(statSync(failedOutput).mode&0o777,0o600);
});

test('the standalone observation CLI rejects production, public output, overwrites and invalid windows before reading credentials',t=>{
  const directory=mkdtempSync(join(tmpdir(),'ezkart-doku-cli-'));chmodSync(directory,0o700);t.after(()=>rmSync(directory,{recursive:true,force:true}));
  const command=fileURLToPath(new URL('../commerce/observe-doku.php',import.meta.url));
  const base=['--environment=sandbox','--profile='+profile,'--from='+from,'--to='+to];
  const existing=join(directory,'exists.jsonl');writeFileSync(existing,'keep this unchanged',{mode:0o600});
  mkdirSync(join(directory,'public_html'),{mode:0o700});symlinkSync(existing,join(directory,'link.jsonl'));
  const cases=[
    [...base,'--output='+existing],[...base,'--output='+join(directory,'link.jsonl')],
    [...base,'--output='+join(directory,'public_html','bad.jsonl')],
    [...base,'--output='+join(tmpdir(),'must-not-create-ezkart.jsonl')],
    [...base.filter(s=>!s.startsWith('--environment=')),'--environment=production','--output='+join(directory,'bad.jsonl')],
    [...base,'--output='+join(directory,'bad.jsonl'),'--max-pages=41'],
    [...base.filter(s=>!s.startsWith('--from=')),'--from=2026-02-30T00:00:00Z','--output='+join(directory,'bad.jsonl')],
    [...base,'--output='+join(directory,'bad.jsonl'),'--to='+to],
  ];
  for(const args of cases){
    const result=spawnSync(php,[command,...args],{encoding:'utf8',env:{...process.env,EZKART_DOKU_SANDBOX_CLIENT_ID:'fixture',EZKART_DOKU_SANDBOX_SECRET_KEY:'fixture-not-a-real-secret',EZKART_DOKU_SANDBOX_SNAP_PRIVATE_KEY:'invalid-fixture-key'}});
    assert.equal(result.status,1,result.stdout);assert.equal(result.stdout,'');const error=JSON.parse(result.stderr);assert.equal(error.ok,false);assert.notEqual(error.error,'configuration');
  }
  assert.equal(readFileSync(existing,'utf8'),'keep this unchanged');assert.deepEqual(readdirSync(directory).sort(),['exists.jsonl','link.jsonl','public_html']);
});

test('the observation command is unavailable over HTTP and cannot trigger provider reads',async t=>{
  const f=await setup();t.after(()=>f.close());
  for(const path of ['/tools/commerce/observe-doku.php','/tools/checkout-test/doku-sub-accounts-fixture.php'])
    for(const method of ['GET','POST']){
      const result=await fetch(f.base+path+'?environment=sandbox&profile='+profile,{method});
      assert.equal(result.status,404);assert.equal(await result.text(),'');
    }
  assert.deepEqual(await f.calls(),[]);
});
