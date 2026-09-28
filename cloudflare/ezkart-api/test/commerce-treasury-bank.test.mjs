import test from 'node:test';
import assert from 'node:assert/strict';
import {setupEarningsFixture,key} from './earnings-fixture.mjs';
import {refundProcessingClaims as claims} from './refund-processing-fixture.mjs';
const bank={configurationId:'company-v1',code:'CENAIDJA',accountNumber:'001234567890',channel:'BI_FAST',beneficiaryName:'Fixture Ezkart Company'};
const ok=r=>{assert.equal(r.status,200,r.error);return r;};
async function setup(t,options={}){
 const f=await setupEarningsFixture(t,{bindings:{COMMERCE_TREASURY_OPERATORS:'bob',COMMERCE_TREASURY_BANK:JSON.stringify(bank),COMMERCE_TREASURY_INQUIRY:'enabled',COMMERCE_TREASURY_PAYMENT:'enabled',...options}});
 ok(await f.call('/internal/commerce/support/access',{environment:f.environment,authUserId:'bob',role:'reviewer',requestKey:key(),operator:'Local fixture',reason:'Treasury fixture.'}));
 const api=(path,input,extra={})=>f.merchant('/v1/treasury'+path,input,{seller:'bob',claims:claims(),method:input===undefined?'GET':'POST',...extra});
 const p=await f.payment();await f.settle(p);const reserved=ok(await api('/intents',{requestKey:key(),amount:'1000'})),id=reserved.intent.id;
 const identity=await f.db.prepare('SELECT credential_fingerprint AS credentialFingerprint,client_id AS clientId FROM commerce_wallet_provider_bindings WHERE enrollment_id=(SELECT platform_enrollment_id FROM commerce_treasury_intents WHERE id=?)').bind(id).first();
 const start=(stage,input={})=>api('/intents/'+id+'/'+stage+'/start',{...identity,...input});
 const internal=(stage,action,input={})=>f.call('/internal/commerce/finance/treasury/'+id+'/'+stage+'/'+action,{environment:f.environment,...input});
 return {...f,api,id,identity,start,internal,p};
}
function evidence(g,stage='inquiry',name=bank.beneficiaryName){
 const b=g.binding,request={partnerReferenceNo:b.partnerReferenceNo,type:'BANK_ACCOUNT',channel:b.channel,amount:{value:b.amount+'.00',currency:'IDR'},fromAccount:b.fromAccount,beneficiaryBankCode:b.beneficiaryBankCode,beneficiaryAccountNumber:b.beneficiaryAccountNumber};
 if(stage==='payment'){request.referenceNo='fixture-inquiry';request.beneficiaryAccountName=name;}
 const at=new Date().toISOString(),response={...request,responseCode:'2000000',referenceNo:stage==='inquiry'?'fixture-inquiry':'fixture-payment',beneficiaryAccountName:name,...(stage==='payment'?{referenceNumber:'fixture-bank',transactionDate:at}:{})};
 return {environment:b.environment,credentialFingerprint:b.credentialFingerprint,operation:'transfer-'+stage,externalId:b[stage+'ExternalId'],requestedAt:at,observedAt:at,requestBody:JSON.stringify(request),responseBody:JSON.stringify(response)};
}
async function inquire(f){const g=ok(await f.start('inquiry')),e=evidence(g),r=ok(await f.internal('inquiry','receipt',{evidence:e}));return {g,e,r};}
async function confirm(f,r){return ok(await f.api('/intents/'+f.id+'/confirm',{requestKey:key(),inquiryDigest:r.digest}));}

test('original company inquiry grants send once, preserves response, confirms exact holder and keeps payment policy held',async t=>{
 const f=await setup(t);const results=await Promise.all([f.start('inquiry'),f.start('inquiry')]);results.forEach(ok);assert.equal(results.filter(r=>r.mayInquire).length,1);
 const g=results.find(r=>r.mayInquire);assert.equal(g.binding.partnerReferenceNo,'EZK-TREASURY-S-'+f.id.slice(4));assert.equal(g.binding.amount,'1000');
 assert.equal((await f.start('inquiry',{clientId:'changed'})).status,409);const e=evidence(g),r=ok(await f.internal('inquiry','receipt',{evidence:e}));
 assert.equal(ok(await f.internal('inquiry','receipt',{evidence:e})).replayed,true);
 const wrong={...e,responseBody:e.responseBody.replace('fixture-inquiry','different')};assert.equal((await f.internal('inquiry','receipt',{evidence:wrong})).status,409);
 const c=await confirm(f,r);assert.equal((await f.start('payment',{confirmationId:c.confirmationId})).status,503);
 assert.equal((await f.db.prepare("SELECT COUNT(*) n FROM commerce_treasury_bank_grants WHERE stage='payment'").first()).n,0);
 const detail=ok(await f.api('/intents/'+f.id));assert.equal(detail.intent.state,'bank_inquiry_recorded');assert.equal(detail.bank[0].beneficiaryName,bank.beneficiaryName);assert.equal(detail.intent.payoutConfirmed,false);
 ok(await f.api('/intents/'+f.id+'/cancel',{requestKey:key()}));assert.equal((await f.start('payment',{confirmationId:c.confirmationId})).status,409);
});
test('fixture-only released policy exercises one transfer grant, unknown fence, original recovery and immutable successful response',async t=>{
 const f=await setup(t),{r}=await inquire(f),c=await confirm(f,r);
 // No such writer or eligibility exists in the deployed schema.
 await f.db.prepare('DROP VIEW commerce_treasury_execution_eligibility').run();await f.db.prepare('CREATE VIEW commerce_treasury_execution_eligibility AS SELECT id AS intent_id FROM commerce_treasury_intents').run();
 const sent=await Promise.all([f.start('payment',{confirmationId:c.confirmationId}),f.start('payment',{confirmationId:c.confirmationId})]);sent.forEach(ok);assert.equal(sent.filter(x=>x.mayPay).length,1);
 const g=sent.find(x=>x.mayPay);assert.equal(ok(await f.api('/intents/'+f.id)).intent.state,'transfer_outcome_unknown');
 assert.equal((await f.api('/intents/'+f.id+'/cancel',{requestKey:key()})).status,409);
 const e=evidence(g,'payment');for(const change of [{externalId:g.binding.inquiryExternalId},{responseBody:e.responseBody.replace('1000.00','1001.00')},{responseBody:e.responseBody.replace('"responseCode":','"responseCode":"2000000","responseCode":')}])assert.notEqual((await f.internal('payment','receipt',{evidence:{...e,...change}})).status,200);
 // Current operator removal and platform configuration/state cannot rewrite recovery identity.
 ok(await f.call('/internal/commerce/support/access',{environment:f.environment,authUserId:'bob',role:'revoked',requestKey:key(),operator:'Fixture',reason:'Revoke original operator.'}));
 await f.db.prepare("UPDATE sellers SET status='suspended' WHERE id='seller_bob'").run();
 const original=ok(await f.internal('payment','read'));assert.equal(original.mayPay,false);assert.deepEqual(original.binding,g.binding);
 const receipt=ok(await f.internal('payment','receipt',{evidence:e}));assert.equal(receipt.payoutConfirmed,false);assert.equal(ok(await f.internal('payment','receipt',{evidence:e})).replayed,true);
 for(const table of ['grants','receipts','confirmations'])await assert.rejects(f.db.prepare('DELETE FROM commerce_treasury_bank_'+table).run(),/treasury_bank_immutable/);
});
test('wrong beneficiary name is shown but cannot authorize transfer; stale authority and held capture fail before dispatch',async t=>{
 const f=await setup(t);assert.equal((await f.api('/intents/'+f.id+'/inquiry/start',f.identity,{claims:{aal:'aal1'}})).status,401);
 const g=ok(await f.start('inquiry')),r=ok(await f.internal('inquiry','receipt',{evidence:evidence(g,'inquiry','Foreign Company')}));
 assert.equal((await f.api('/intents/'+f.id+'/confirm',{requestKey:key(),inquiryDigest:r.digest})).status,409);
 const n=ok(await f.api('/intents',{requestKey:key(),amount:'1000'}));await f.refund(f.p);
 assert.equal((await f.api('/intents/'+n.intent.id+'/inquiry/start',f.identity)).status,409);
});
