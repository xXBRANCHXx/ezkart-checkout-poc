import test from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {generateKeyPairSync,createHash,createHmac,verify} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {setup} from './fixture.mjs';

const php=process.env.PHP_BINARY||'php',fixture=fileURLToPath(new URL('./doku-payout-fixture.php',import.meta.url));
const keys=generateKeyPairSync('rsa',{modulusLength:2048,publicKeyEncoding:{type:'spki',format:'pem'},privateKeyEncoding:{type:'pkcs8',format:'pem'}});
const credentials={environment:'sandbox',clientId:'MCH-fixture-only',secretKey:'fixture-secret-not-used-remotely',privateKey:keys.privateKey};
const time=1790496000,timestamp=new Date(time*1000).toISOString().replace('.000Z','Z');
const binding={environment:'sandbox',partnerReferenceNo:'EZK-PAYOUT-S-'+'a'.repeat(40),fromAccount:'1234567890',
  beneficiaryBankCode:'CENAIDJA',beneficiaryAccountNumber:'0001234567890123456789',amount:'250000',channel:'BI_FAST',
  inquiryExternalId:'00000000000000000000000000000001',paymentExternalId:'00000000000000000000000000000002'};
const beneficiary='PT Contoh Café Indonesia / Cabang Yogyakarta';
const response=body=>({body:typeof body==='string'?body:JSON.stringify(body)});
const token=()=>response({responseCode:'2007300',tokenType:'Bearer',accessToken:'fixture-token',expiresIn:900});
// The V2 contract specifies a success-code family, not a fixed inquiry/payment code.
const inquiry=(input=binding)=>({responseCode:'2000000',responseMessage:'Successful',referenceNo:'inquiry-fixture-one',
  partnerReferenceNo:input.partnerReferenceNo,type:'BANK_ACCOUNT',channel:input.channel,fromAccount:input.fromAccount,
  beneficiaryBankCode:input.beneficiaryBankCode,beneficiaryAccountNumber:input.beneficiaryAccountNumber,
  beneficiaryAccountName:beneficiary,amount:{value:input.amount+'.00',currency:'IDR'}});
const payment=(input=binding)=>({...inquiry(input),referenceNo:'payment-fixture-one',referenceNumber:'bank-fixture-one',transactionDate:timestamp});
const action=(operation,extra={})=>({operation,...extra});
const header=(request,name)=>request.headers.find(x=>x.startsWith(name+': '))?.slice(name.length+2);
function run(input={}){
  const result=spawnSync(php,['-n',fixture],{input:JSON.stringify({credentials,binding,time,...input}),encoding:'utf8',maxBuffer:8000000});
  assert.equal(result.status,0,result.stderr);assert.equal(result.stderr,'');return JSON.parse(result.stdout);
}
function payWith(options={}){
  return run({actions:[action('inquire'),action('pay',options)],responses:[token(),response(inquiry()),response(payment())]});
}

test('bank inquiries and payments sign their fixed V2 paths with the same reference and distinct persisted dispatch IDs',()=>{
  const result=run({actions:[action('payload'),action('inquire'),action('paymentPayload'),action('pay'),action('debug')],responses:[token(),response(inquiry()),response(payment())]});
  assert(result.results.every(r=>r.ok),JSON.stringify(result.results));assert.equal(result.requests.length,3);
  const [auth,read,write]=result.requests;
  assert.equal(auth.url,'https://api-sandbox.doku.com/authorization/v1/access-token/b2b');
  assert(verify('RSA-SHA256',Buffer.from(credentials.clientId+'|'+header(auth,'X-TIMESTAMP')),keys.publicKey,Buffer.from(header(auth,'X-SIGNATURE'),'base64')));
  for(const [request,operation,id] of [[read,'transfer-inquiry',binding.inquiryExternalId],[write,'transfer-payment',binding.paymentExternalId]]){
    assert.equal(request.url,'https://api-sandbox.doku.com/sub-account/v2.0/'+operation);
    assert.equal(header(request,'X-EXTERNAL-ID'),id);assert.equal(header(request,'CHANNEL-ID'),undefined);
    const canonical=['POST',new URL(request.url).pathname,'fixture-token',createHash('sha256').update(request.body).digest('hex'),header(request,'X-TIMESTAMP')].join(':');
    assert.equal(header(request,'X-SIGNATURE'),createHmac('sha512',credentials.secretKey).update(canonical).digest('base64'));
  }
  const sent=JSON.parse(write.body);assert.deepEqual(JSON.parse(read.body),result.results[0].result);
  assert.deepEqual(sent,result.results[2].result);assert.equal(sent.partnerReferenceNo,binding.partnerReferenceNo);
  assert.equal(sent.type,'BANK_ACCOUNT');assert.deepEqual(sent.amount,{value:'250000.00',currency:'IDR'});
  assert.equal(sent.beneficiaryAccountNumber,binding.beneficiaryAccountNumber);assert.equal(sent.beneficiaryAccountName,beneficiary);
  assert.equal(sent.referenceNo,'inquiry-fixture-one');assert(!('fee' in sent));assert(!('callbackUrl' in sent));
  const receipt=result.results[3].result;assert.equal(receipt.data.amount,'250000');assert.equal(receipt.data.referenceNo,'payment-fixture-one');
  assert.equal(receipt.data.inquiryReferenceNo,'inquiry-fixture-one');assert.equal(receipt.data.bankReferenceNo,'bank-fixture-one');
  assert.equal(receipt.data.payoutConfirmed,false);assert.equal(receipt.data.actualProviderFee,null);
  assert.equal(receipt.evidence.requestBody,write.body);assert.equal(receipt.evidence.responseBody,JSON.stringify(payment()));
  for(const secret of ['fixture-token',credentials.secretKey,'PRIVATE KEY'])assert(!JSON.stringify(result.results).includes(secret));
});

test('production destination and the ONLINE channel are explicit and never fallback from BI_FAST',()=>{
  const input={...binding,environment:'production',partnerReferenceNo:'EZK-PAYOUT-P-'+'a'.repeat(40),channel:'ONLINE'};
  const result=run({credentials:{...credentials,environment:'production'},binding:input,actions:[action('inquire'),action('pay')],responses:[token(),response(inquiry(input)),response(payment(input))]});
  assert(result.results.every(r=>r.ok));assert.equal(result.requests.length,3);
  for(const request of result.requests)assert.equal(new URL(request.url).origin,'https://api.doku.com');
  assert.equal(JSON.parse(result.requests[2].body).channel,'ONLINE');
  assert.notEqual(result.fingerprint,run({actions:[action('debug')]}).fingerprint);
});

test('invalid bindings, sub-minimum amounts and caller-selected routing overrides fail before any network access',()=>{
  for(const change of [{environment:'production'},{credentialFingerprint:'f'.repeat(64)},{partnerReferenceNo:'EZK-PAYOUT-P-'+'a'.repeat(40)},
    {partnerReferenceNo:'other'},{fromAccount:1234567890},{fromAccount:'1'.repeat(11)},{fromAccount:'123\n'},
    {beneficiaryBankCode:'cenaidja'},{beneficiaryBankCode:'CENAIDJA\r\nX: y'},{beneficiaryAccountNumber:12345},{beneficiaryAccountNumber:'1'.repeat(23)},
    {beneficiaryAccountNumber:'123-456'},{beneficiaryAccountNumber:''},{amount:250000},{amount:250000.1},{amount:'249999'},
    {amount:'0'},{amount:'-250000'},{amount:'0250000'},{amount:'250000.00'},{amount:'2.5e5'},{amount:'250000\n'},
    {amount:'9223372036854775808'},{channel:'DOKU_WALLET'},{channel:''},{channel:null},
    {inquiryExternalId:'1'.repeat(31)},{paymentExternalId:'text'},{paymentExternalId:binding.inquiryExternalId},
    {url:'https://evil.invalid'},{type:'DOKU_SUB_ACCOUNT'},{currency:'POINT'},{beneficiaryAccountName:beneficiary},{withdrawalFee:2500}]){
    const result=run({binding:{...binding,...change},actions:[action('inquire')]});
    assert.equal(result.results[0].ok,false,JSON.stringify(change));assert.equal(result.requests.length,0);
  }
});

test('exact rupiah strings survive both transfer steps above JavaScript precision and at the SQLite limit',()=>{
  for(const amount of ['250001','9007199254740993','9223372036854775807']){
    const input={...binding,amount};
    const result=run({binding:input,actions:[action('inquire'),action('pay')],responses:[token(),response(inquiry(input)),response(payment(input))]});
    assert(result.results.every(r=>r.ok),amount);assert.equal(result.results[1].result.data.amount,amount);
    assert.equal(JSON.parse(result.requests[2].body).amount.value,amount+'.00');
  }
});

test('inquiry receipts reject foreign identity, amount, bank, type, currency, channel and ambiguous JSON',()=>{
  for(const mutate of [r=>r.partnerReferenceNo='foreign',r=>r.type='DOKU_NON_FIAT',r=>r.channel='ONLINE',r=>r.fromAccount='1234567891',
    r=>r.beneficiaryBankCode='BRINIDJA',r=>r.beneficiaryAccountNumber='1234567890123456789',r=>r.beneficiaryAccountNumber=12345,
    r=>r.amount.value='250000',r=>r.amount.value=250000,r=>r.amount.value='250000.01',r=>r.amount.currency='POINT',
    r=>r.referenceNo='',r=>r.referenceNo='r'.repeat(65),r=>r.beneficiaryAccountName='',r=>r.beneficiaryAccountName='x\nInjected',
    r=>r.beneficiaryAccountName='x'.repeat(257),r=>delete r.channel,r=>r.responseCode='2020000']){
    const body=inquiry();mutate(body);const result=run({actions:[action('inquire')],responses:[token(),response(body)]});
    assert.equal(result.results[0].ok,false,JSON.stringify(body));assert.equal(result.requests.length,2);
  }
  const raw=JSON.stringify(inquiry());
  for(const body of [raw.replace('"referenceNo":','"referenceNo":"foreign","referenceNo":'),raw.replace('"250000.00"','250000.00'),'not json',raw+' true']){
    assert.equal(run({actions:[action('inquire')],responses:[token(),response(body)]}).results[0].ok,false);
  }
  const numeric=inquiry();numeric.fromAccount=Number(binding.fromAccount);
  const result=run({actions:[action('inquire')],responses:[token(),response(numeric)]});
  assert.equal(result.results[0].ok,true);assert.equal(result.results[0].result.data.fromAccount,binding.fromAccount);
});

test('confirmation binds the immutable inquiry and both dispatch IDs before payment authentication or transfer',()=>{
  for(const extra of [{digest:''},{digest:'f'.repeat(64)},{binding:{amount:'250001'}},{binding:{environment:'production'}},
    {binding:{credentialFingerprint:'f'.repeat(64)}},{binding:{partnerReferenceNo:'EZK-PAYOUT-S-'+'b'.repeat(40)}},
    {binding:{fromAccount:'1234567891'}},{binding:{beneficiaryAccountNumber:'0001234567890123456788'}},
    {binding:{beneficiaryBankCode:'BRINIDJA'}},{binding:{channel:'ONLINE'}},
    {binding:{inquiryExternalId:'0'.repeat(32)}},{binding:{paymentExternalId:'0'.repeat(32)}},
    {evidence:{environment:'production'}},{evidence:{credentialFingerprint:'f'.repeat(64)}},
    {evidence:{operation:'transfer-payment'}},{evidence:{externalId:binding.paymentExternalId}},
    {evidence:{responseBody:JSON.stringify({...inquiry(),beneficiaryAccountName:'Different Beneficiary'})}},
    {evidence:{responseBody:JSON.stringify({...inquiry(),referenceNo:'another-inquiry'})}},
    {evidence:{requestBody:'{}'}},{evidence:{responseBody:'{}'}},{evidence:{arbitrary:true}},
    {evidence:{requestedAt:'2026-02-30T00:00:00Z'}},{evidence:{observedAt:'2026-09-27T24:00:00Z'}},
    {evidence:{requestedAt:new Date((time+1)*1000).toISOString()}},
    {evidence:{observedAt:new Date((time+301)*1000).toISOString()}}]){
    const result=payWith(extra);assert.equal(result.results[0].ok,true);
    assert.equal(result.results[1].ok,false,JSON.stringify(extra));assert.equal(result.requests.length,2);
  }
  const missing=run({actions:[action('pay')]});assert.equal(missing.results[0].ok,false);assert.equal(missing.requests.length,0);
  const late=payWith({time:time+901,digest:'f'.repeat(64)});assert.equal(late.requests.length,2,'bad confirmation must not refresh the token');
});

test('payment receipts retain separate inquiry/bank/provider references and reject altered beneficiaries or processing times',()=>{
  for(const mutate of [r=>r.partnerReferenceNo='foreign',r=>r.fromAccount='1234567891',r=>r.beneficiaryAccountNumber='0001234567890123456788',
    r=>r.beneficiaryAccountName=beneficiary.toUpperCase(),r=>r.beneficiaryBankCode='BRINIDJA',r=>r.amount.value='247500.00',r=>r.amount.currency='USD',
    r=>r.channel='ONLINE',r=>r.type='DOKU_WALLET',r=>r.referenceNumber='',r=>delete r.referenceNumber,r=>delete r.transactionDate,
    r=>r.transactionDate='2026-02-30T00:00:00Z',r=>r.transactionDate=new Date((time+301)*1000).toISOString(),
    r=>r.transactionDate=new Date((time-301)*1000).toISOString()]){
    const body=payment();mutate(body);
    const result=run({actions:[action('inquire'),action('pay')],responses:[token(),response(inquiry()),response(body)]});
    assert.equal(result.results[0].ok,true);assert.equal(result.results[1].ok,false,JSON.stringify(body));assert.equal(result.requests.length,3);
  }
  const body=payment();body.transactionDate='2026-09-27T15:00:00.123456+07:00';
  const result=run({actions:[action('inquire'),action('pay')],responses:[token(),response(inquiry()),response(body)]});
  assert.equal(result.results[1].ok,true);assert.equal(result.results[1].result.data.transactionDate,'2026-09-27T08:00:00.123456Z');
});

test('lost, duplicate and unsuccessful transfers make one attempt with no retry, fallback or private diagnostic disclosure',()=>{
  for(const failure of [{throw:true},{status:500,body:'private-provider-details'},{status:401,body:'private-provider-details'},
    {status:403,body:'private-provider-details'},{status:409,body:'original transfer already exists'},
    response({responseCode:'5000000',private:'private-provider-details'}),response('not json')]){
    const result=run({actions:[action('inquire'),action('pay')],responses:[token(),response(inquiry()),failure]});
    assert.equal(result.results[0].ok,true);assert.equal(result.results[1].ok,false);assert.equal(result.requests.length,3);
    assert(!JSON.stringify(result.results).includes('private-provider-details'));assert(!JSON.stringify(result.results).includes('Fixture-only private diagnostic'));
    assert.equal(new URL(result.requests[2].url).pathname,'/sub-account/v2.0/transfer-payment');
  }
  const auth=run({actions:[action('inquire')],responses:[{status:401,body:'private-provider-details'}]});
  assert.equal(auth.results[0].ok,false);assert.equal(auth.requests.length,1);
});

test('inquiry digests survive storage field order but preserve original response bytes',()=>{
  const first=run({actions:[action('inquire')],responses:[token(),response(inquiry())]});
  const receipt=first.results[0].result;
  const reordered=Object.fromEntries(Object.entries(receipt.evidence).reverse());
  const next=run({actions:[action('paymentPayload',{evidence:reordered,digest:receipt.data.inquiryDigest})]});
  assert.equal(next.results[0].ok,true);assert.equal(next.requests.length,0);
  const pretty={...reordered,responseBody:JSON.stringify(inquiry(),null,2)};
  const changed=run({actions:[action('paymentPayload',{evidence:pretty,digest:receipt.data.inquiryDigest})]});
  assert.equal(changed.results[0].reason,'payout_confirmation');assert.equal(changed.requests.length,0);
});

test('payout fixture is inaccessible over HTTP and the adapter itself performs no action when requested',async t=>{
  const f=await setup();t.after(()=>f.close());
  const fixture=await fetch(f.base+'/tools/checkout-test/doku-payout-fixture.php');assert.equal(fixture.status,404);assert.equal(await fixture.text(),'');
  for(const method of ['GET','POST']){
    const adapter=await fetch(f.base+'/cart/api/doku-payout.php',{method,...(method==='POST'?{body:JSON.stringify(binding)}:{})});
    assert.equal(await adapter.text(),'');assert.equal((await f.calls()).length,0);
  }
});

test('treasury uses its own original reference and exact whole commission amount without the seller withdrawal minimum',()=>{
  for(const amount of ['1','1000','249999','9007199254740991']){
    const input={...binding,partnerReferenceNo:'EZK-TREASURY-S-'+'b'.repeat(40),amount};
    const result=run({binding:input,actions:[action('inquire'),action('pay')],responses:[token(),response(inquiry(input)),response(payment(input))]});
    assert(result.results.every(r=>r.ok),JSON.stringify(result.results));assert.equal(JSON.parse(result.requests[2].body).amount.value,amount+'.00');
  }
});
