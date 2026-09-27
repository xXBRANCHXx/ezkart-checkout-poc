import test from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {generateKeyPairSync,createHash,createHmac,verify} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {setup} from './fixture.mjs';

const php=process.env.PHP_BINARY||'php',fixture=fileURLToPath(new URL('./doku-bca-snap-fixture.php',import.meta.url));
const keys=generateKeyPairSync('rsa',{modulusLength:2048,publicKeyEncoding:{type:'spki',format:'pem'},privateKeyEncoding:{type:'pkcs8',format:'pem'}});
const credentials={environment:'sandbox',clientId:'MCH-fixture-only',secretKey:'fixture-secret-not-used-remotely',privateKey:keys.privateKey};
const target='/cart/api/doku-snap-webhook.php',account='1900800000347140',time=1790484000;
const binding={environment:'sandbox',externalId:'00000000000000000000000012345678',orderId:'EZK-S-'+'A'.repeat(24),partnerServiceId:'   19008',customerPrefix:'0',amount:58000,name:'Toko café ☕',email:'fixture@example.com',expiresAt:new Date((time+3600)*1000).toISOString().replace('.000Z','Z'),routing:{profileId:'SAC-fixture',splitRuleId:'split-fixture'}};
const response=body=>({body:typeof body==='string'?body:JSON.stringify(body)});
const token=()=>response({responseCode:'2007300',tokenType:'Bearer',accessToken:'fixture-token',expiresIn:900});
const info=()=>({partnerServiceId:binding.partnerServiceId,customerNo:account.slice(5),virtualAccountNo:'   '+account,virtualAccountName:binding.name,
  virtualAccountEmail:binding.email,trxId:binding.orderId,totalAmount:{value:'58000.00',currency:'IDR'},expiredDate:binding.expiresAt,
  virtualAccountTrxType:'C',additionalInfo:{channel:'VIRTUAL_ACCOUNT_BCA',howToPayPage:'https://example.invalid/not-used',howToPayApi:'https://example.invalid/not-fetched'}});
const created=()=>({responseCode:'2002700',responseMessage:'Successful',virtualAccountData:info()});
const notice=()=>{const {totalAmount,expiredDate,...data}=info();return {...data,paidAmount:totalAmount,paymentRequestId:'PJP-fixture-one',trxDateTime:new Date(time*1000).toISOString().replace('.000Z','Z')};};
function run(input={}){
  const result=spawnSync(php,[fixture],{input:JSON.stringify({credentials,binding,...input}),encoding:'utf8',maxBuffer:4000000});
  assert.equal(result.status,0,result.stderr);assert.equal(result.stderr,'');return JSON.parse(result.stdout);
}
function headers(body,{path=target,token='fixture-callback-token',timestamp=new Date(time*1000).toISOString().replace('.000Z','Z'),...overrides}={}){
  const canonical=['POST',path,token,createHash('sha256').update(JSON.stringify(JSON.parse(body))).digest('hex'),timestamp].join(':');
  return {authorization:'Bearer '+token,'x-partner-id':credentials.clientId,'x-external-id':'123456789','x-timestamp':timestamp,'channel-id':'H2H',
    'x-signature':createHmac('sha512',credentials.secretKey).update(canonical).digest('base64'),...overrides};
}
const notification=(data=notice(),options={})=>{const raw=typeof data==='string'?data:JSON.stringify(data);return run({actions:[['notification',raw,headers(raw,options),target,account]]});};
const header=(r,k)=>r.headers.find(x=>x.startsWith(k+': '))?.slice(k.length+2);

test('live authentication verification makes only a token request and returns no secret or capability assertion',()=>{
  const result=run({credentials:{...credentials,environment:'production'},actions:[['authentication'],['authentication']],responses:[token()]});
  assert(result.results.every(r=>r.ok));assert.equal(result.requests.length,1);assert.equal(result.requests[0].url,'https://api.doku.com/authorization/v1/access-token/b2b');
  const proof=result.results[0].result;assert.equal(proof.authenticated,true);assert.equal(proof.environment,'production');assert.equal(proof.credentialFingerprint,result.fingerprint);
  for(const secret of ['fixture-token',credentials.secretKey,'PRIVATE KEY'])assert(!JSON.stringify(result.results).includes(secret));
  const failed=run({actions:[['authentication']],responses:[{status:401,body:'private provider message'}]});assert.equal(failed.results[0].ok,false);assert.equal(failed.requests.length,1);
});

test('the operator connection check validates its environment and reports authentication without activating a provider service',()=>{
  const result=run({credentials:{...credentials,environment:'production'},actions:[['connectionCLI',['--environment=production']]],responses:[token()]});
  const output=result.results[0].result;assert.equal(output.exit,0);assert.equal(output.stdout.authentication.authenticated,true);assert.equal(output.stdout.servicesVerified,false);assert.equal(output.stdout.paymentCreated,false);
  assert.equal(result.requests.length,1);assert(!JSON.stringify(output).includes('fixture-token'));
  const cli=fileURLToPath(new URL('../commerce/doku-check-connection.php',import.meta.url));
  for(const args of [[],['--environment=beta'],['--environment=production','--environment=production'],['--environment=sandbox','--url=https://evil.invalid']]){
    const bad=spawnSync(php,[cli,...args],{encoding:'utf8'});assert.equal(bad.status,1);assert.equal(bad.stdout,'');assert.match(JSON.parse(bad.stderr).error,/Usage:/);
  }
});

test('BCA SNAP creation signs the fixed 1.1 path and original numeric dispatch identity, with no provider-hosted payment page',()=>{
  const result=run({actions:[['payload'],['create'],['debug']],responses:[token(),response(created())]});
  assert(result.results.every(r=>r.ok));assert.equal(result.requests.length,2);
  const [auth,request]=result.requests;
  assert.equal(auth.url,'https://api-sandbox.doku.com/authorization/v1/access-token/b2b');
  assert(verify('RSA-SHA256',Buffer.from(credentials.clientId+'|'+header(auth,'X-TIMESTAMP')),keys.publicKey,Buffer.from(header(auth,'X-SIGNATURE'),'base64')));
  assert.equal(request.url,'https://api-sandbox.doku.com/virtual-accounts/bi-snap-va/v1.1/transfer-va/create-va');
  assert.equal(header(request,'X-EXTERNAL-ID'),binding.externalId);assert.equal(header(request,'CHANNEL-ID'),'H2H');
  const canonical=['POST',new URL(request.url).pathname,'fixture-token',createHash('sha256').update(request.body).digest('hex'),header(request,'X-TIMESTAMP')].join(':');
  assert.equal(header(request,'X-SIGNATURE'),createHmac('sha512',credentials.secretKey).update(canonical).digest('base64'));
  const payload=JSON.parse(request.body);assert.deepEqual(payload,result.results[0].result);
  assert.equal(payload.virtualAccountNo,'   190080');assert.equal(payload.virtualAccountTrxType,'C');assert.equal(payload.totalAmount.value,'58000.00');
  assert.deepEqual(payload.additionalInfo,{channel:'VIRTUAL_ACCOUNT_BCA',virtualAccountConfig:{reusableStatus:false},account:{id:'SAC-fixture',split_rule_id:'split-fixture'}});
  const output=result.results[1].result;assert.equal(output.data.accountNumber,account);assert.equal(output.data.expiresAt,binding.expiresAt);assert.equal(output.evidence.responseBody,JSON.stringify(created()));
  for(const secret of [credentials.secretKey,'fixture-token','PRIVATE KEY'])assert(!JSON.stringify(result.results).includes(secret));
  const prodBinding={...binding,environment:'production',orderId:'EZK-P-'+'A'.repeat(24)},prodResponse=created();prodResponse.virtualAccountData.trxId=prodBinding.orderId;
  const production=run({credentials:{...credentials,environment:'production'},binding:prodBinding,actions:[['create']],responses:[token(),response(prodResponse)]});
  assert.equal(production.results[0].ok,true);assert.equal(new URL(production.requests[1].url).origin,'https://api.doku.com');assert.notEqual(production.fingerprint,result.fingerprint);
});

test('invalid or changed immutable dispatch bindings fail before authentication or payment creation',()=>{
  for(const changes of [{environment:'production'},{credentialFingerprint:'f'.repeat(64)},{externalId:'random-text'},{externalId:'1'.repeat(31)},
    {orderId:'EZK-P-'+'A'.repeat(24)},{partnerServiceId:'19008'},{partnerServiceId:'00019008\n'},{customerPrefix:''},{customerPrefix:'0/other'},
    {amount:0},{amount:58000.1},{amount:'58000'},{amount:100000000001},{name:'x\r\nInjected: y'},{email:'not email'},
    {expiresAt:'2026-02-30T01:00:00Z'},{expiresAt:'2026-09-27T24:00:00Z'},{expiresAt:new Date((time-1)*1000).toISOString().replace('.000Z','Z')},
    {expiresAt:new Date((time+86401)*1000).toISOString().replace('.000Z','Z')},{url:'https://other.invalid'},{reusableStatus:true}]){
    const result=run({binding:{...binding,...changes},actions:[['create']]});assert.equal(result.results[0].ok,false,JSON.stringify(changes));assert.equal(result.requests.length,0);
  }
});

test('creation rejects changed invoices, amounts, currency, account components, reusable billing and expiry',()=>{
  for(const mutate of [r=>r.responseCode='2002600',r=>r.virtualAccountData=null,r=>r.virtualAccountData.trxId='foreign',r=>r.virtualAccountData.totalAmount.value='58000',
    r=>r.virtualAccountData.totalAmount.value=58000,r=>r.virtualAccountData.totalAmount.value='58000.01',r=>r.virtualAccountData.totalAmount.currency='USD',
    r=>r.virtualAccountData.partnerServiceId='   19009',r=>r.virtualAccountData.customerNo=Number(account.slice(5)),r=>r.virtualAccountData.virtualAccountNo='   19008'+'0'.repeat(20),
    r=>r.virtualAccountData.virtualAccountNo='\t'+account,r=>r.virtualAccountData.virtualAccountNo='0'+account,r=>r.virtualAccountData.virtualAccountNo='   1900800000347141',
    r=>r.virtualAccountData.virtualAccountTrxType='O',r=>r.virtualAccountData.additionalInfo.channel='VIRTUAL_ACCOUNT_BNI',r=>r.virtualAccountData.additionalInfo.virtualAccountConfig={reusableStatus:true},
    r=>r.virtualAccountData.additionalInfo.account={id:'SAC-other',split_rule_id:binding.routing.splitRuleId},
    r=>r.virtualAccountData.additionalInfo.account={id:binding.routing.profileId,split_rule_id:'different-rule'},
    r=>r.virtualAccountData.expiredDate='2026-09-27T23:59:59Z',r=>r.virtualAccountData.virtualAccountName='Foreign name',r=>r.virtualAccountData.virtualAccountEmail='foreign@example.com']){
    const body=created();mutate(body);const result=run({actions:[['create']],responses:[token(),response(body)]});assert.equal(result.results[0].ok,false,JSON.stringify(body));assert.equal(result.requests.length,2);
  }
  for(const padding of ['',' ','  ','   ']){const body=created();body.virtualAccountData.virtualAccountNo=padding+account;assert.equal(run({actions:[['create']],responses:[token(),response(body)]}).results[0].ok,true);}
});

test('lost and unsuccessful creates make one provider attempt, expose no response secrets, and never fall back or retry',()=>{
  for(const failure of [{throw:true},{status:500,body:'private-provider-details'},{status:401,body:'private-provider-details'},{status:409,body:'original already exists'},
    response({responseCode:'5002700',private:'private-provider-details'}),response('{"responseCode":"2002700","responseCode":"2002700"}'),response('not json')]){
    const result=run({actions:[['create']],responses:[token(),failure]});assert.equal(result.results[0].ok,false);assert.equal(result.requests.length,2);assert(!JSON.stringify(result.results).includes('private-provider-details'));
  }
});

test('signed callbacks preserve the original charge identity across retries, whitespace, padding and expiry',()=>{
  const data=notice(),raw=JSON.stringify(data,null,2),first=notification(raw).results[0];assert.equal(first.ok,true);
  assert.equal(first.result.data.reference.length,78);assert.equal(first.result.data.accountNumber,account);assert.equal(first.result.data.amount,58000);
  assert.equal(first.result.acknowledgement.responseCode,'2002500');assert.equal(first.result.acknowledgement.virtualAccountData.paymentRequestId,data.paymentRequestId);
  assert.equal(first.result.evidence.body,raw);assert(!JSON.stringify(first).includes('fixture-callback-token'));
  const later=notice();later.virtualAccountNo=account;delete later.trxDateTime;
  const next=notification(later,{'x-external-id':'987654321',timestamp:new Date((time-86400)*1000).toISOString().replace('.000Z','Z')}).results[0];
  assert.equal(next.ok,true);assert.equal(next.result.data.reference,first.result.data.reference);assert.equal(next.result.data.providerPaidAt,null);
  const expired=run({time:time+86400,actions:[['notification',raw,headers(raw),target,account]]});assert.equal(expired.results[0].ok,true);assert.equal(expired.requests.length,0);
  const different=notice();different.paymentRequestId='PJP-fixture-two';assert.notEqual(notification(different).results[0].result.data.reference,first.result.data.reference);
});

test('callbacks reject forged signatures, targets, credentials, headers and future timestamps before returning evidence',()=>{
  const raw=JSON.stringify(notice()),good=headers(raw);
  for(const changes of [{'x-partner-id':'another-client'},{'channel-id':'other'},{'authorization':'Bearer x\r\nInjected: y'},
    {'authorization':'Bearer '+'x'.repeat(2100)},{'x-external-id':'123,456'},{'x-signature':'x'.repeat(86)+'=='},
    {'x-timestamp':'2026-02-30T00:00:00Z'},{'x-timestamp':new Date((time+301)*1000).toISOString().replace('.000Z','Z')},{'x-signature':''}]){
    const result=run({actions:[['notification',raw,{...good,...changes},target,account]]});assert.equal(result.results[0].ok,false);assert.equal(result.requests.length,0);
  }
  for(const path of ['/other','https://evil.invalid'+target,target+'?environment=sandbox',target+'/'])assert.equal(run({actions:[['notification',raw,good,path,account]]}).results[0].ok,false);
  assert.equal(notification(raw,{path:'/wrong-signed-target'}).results[0].reason,'notification_signature');
  const altered=raw.replace('58000.00','58001.00');assert.equal(run({actions:[['notification',altered,good,target,account]]}).results[0].reason,'notification_signature');
});

test('authenticated callbacks still require exact original invoice, amount, account, channel and PJP payment identity',()=>{
  for(const mutate of [n=>n.trxId='EZK-S-'+'B'.repeat(24),n=>n.paidAmount.value='58001.00',n=>n.paidAmount.value=58000,n=>n.paidAmount.currency='USD',
    n=>n.customerNo='10000347140',n=>n.virtualAccountNo='   1900800000347141',n=>n.partnerServiceId='   19009',n=>n.additionalInfo.channel='VIRTUAL_ACCOUNT_BNI',
    n=>n.virtualAccountTrxType='V',n=>n.paymentRequestId='',n=>delete n.paymentRequestId,n=>n.paymentRequestId='x'.repeat(31),
    n=>n.paymentRequestId='bad\nreference',n=>n.trxDateTime='2026-02-30T00:00:00Z',n=>n.trxDateTime=new Date((time+301)*1000).toISOString().replace('.000Z','Z')]){
    const data=notice();mutate(data);assert.equal(notification(data).results[0].ok,false,JSON.stringify(data));
  }
  const raw=JSON.stringify(notice());assert.equal(run({actions:[['notification',raw,headers(raw),target,'1900800000000000']]}).results[0].reason,'account');
  const early=run({actions:[['notification',raw,headers(raw),target]]});assert.equal(early.results[0].ok,true);assert.equal(early.requests.length,0);
});

test('financial JSON minification preserves signed escapes, spaces, Unicode and exact numbers and rejects ambiguity',()=>{
  const body=' { "note" : "café / ☕ \\" hi \\\\ bye\\t", "amount":9007199254740993.00, "escaped":"\\u0061\\/b", "object":{}, "array":[] }\n';
  assert.equal(run({minify:body}).body,'{"note":"café / ☕ \\" hi \\\\ bye\\t","amount":9007199254740993.00,"escaped":"\\u0061\\/b","object":{},"array":[]}');
  for(const raw of ['{"a":1,"a":2}','{"a":1,"\\u0061":2}','{"x":01}','{"x":"\\ud800"}','[]','{} false'])assert(run({minify:raw}).error);
  const raw=JSON.stringify(notice()).replace('"trxId":','"trxId":"foreign","trxId":');
  assert.equal(run({actions:[['notification',raw,headers(JSON.stringify(notice())),target,account]]}).results[0].reason,'notification_json');
});

test('status observations retain pending amount evidence without claiming payment, settlement or permission to recreate',()=>{
  const row=info();delete row.totalAmount;row.paidAmount={value:'58000.00',currency:'IDR'};row.paymentFlagReason={english:'Pending',indonesia:'Belum Terbayar'};
  const pending={responseCode:'2002600',responseMessage:'Successful',virtualAccountData:row,additionalInfo:{acquirer:{id:'BCA'},trxId:binding.orderId}};
  const result=run({actions:[['status',account],['status',account]],responses:[token(),response(pending),response({...pending,virtualAccountData:[]})]});
  assert(result.results.every(r=>r.ok));assert.equal(result.requests.length,3);assert.notEqual(header(result.requests[1],'X-EXTERNAL-ID'),header(result.requests[2],'X-EXTERNAL-ID'));
  assert.equal(result.requests[1].url,'https://api-sandbox.doku.com/orders/v1.0/transfer-va/status');assert.equal(header(result.requests[1],'CHANNEL-ID'),undefined);
  assert.deepEqual(JSON.parse(result.requests[1].body),{partnerServiceId:binding.partnerServiceId,customerNo:account.slice(5),virtualAccountNo:'   '+account});
  for(const r of result.results){assert.equal(r.result.data.paymentConfirmed,false);assert.equal(r.result.data.createRetryAllowed,false);assert.equal(r.result.data.settlementVerified,false);}
  assert.equal(result.results[0].result.evidence.responseBody,JSON.stringify(pending));assert.equal(result.results[1].result.data.records,0);
  for(const mutate of [r=>r.responseCode='2002700',r=>r.virtualAccountData.trxId='foreign',r=>r.additionalInfo.trxId='foreign',r=>r.virtualAccountData.customerNo='bad',r=>r.virtualAccountData.paidAmount.currency='USD']){
    const body=structuredClone(pending);mutate(body);assert.equal(run({actions:[['status',account]],responses:[token(),response(body)]}).results[0].ok,false);
  }
  assert.equal(run({actions:[['status',account,'different-payment']],responses:[token(),response(pending)]}).results[0].ok,false);
});

test('SNAP tooling stays private and the notification endpoint refuses held commerce',async t=>{
  const f=await setup();t.after(()=>f.close());
  const fixture=await fetch(f.base+'/tools/checkout-test/doku-bca-snap-fixture.php');assert.equal(fixture.status,404);assert.equal(await fixture.text(),'');
  const cli=await fetch(f.base+'/tools/commerce/doku-check-connection.php');assert.equal(cli.status,404);assert.equal(await cli.text(),'');
  const endpoint=await fetch(f.base+target,{method:'POST',body:JSON.stringify(notice())});assert.equal(endpoint.status,503);assert.notEqual((await endpoint.json()).responseCode,'2002500');assert.equal((await f.calls()).length,0);
  assert.equal((await fetch(f.base+target)).status,405);
});
