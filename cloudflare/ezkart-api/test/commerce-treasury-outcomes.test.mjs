import test from 'node:test';
import assert from 'node:assert/strict';
import {setupEarningsFixture,key} from './earnings-fixture.mjs';
import {refundProcessingClaims as claims} from './refund-processing-fixture.mjs';
const bank={configurationId:'company-v1',code:'CENAIDJA',accountNumber:'001234567890',channel:'BI_FAST',beneficiaryName:'Fixture Ezkart Company'};
const ok=r=>{assert.equal(r.status,200,r.error||JSON.stringify(r));return r;};
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

let external=700000;
async function ready(t,{withReceipt=true}={}){
 const f=await setup(t),{r}=await inquire(f),c=await confirm(f,r);
 await f.db.prepare('DROP VIEW commerce_treasury_execution_eligibility').run();await f.db.prepare('CREATE VIEW commerce_treasury_execution_eligibility AS SELECT id AS intent_id FROM commerce_treasury_intents').run();
 const g=ok(await f.start('payment',{confirmationId:c.confirmationId}));if(withReceipt)ok(await f.internal('payment','receipt',{evidence:evidence(g,'payment')}));
 const path='/internal/commerce/finance/treasury/'+f.id,call=(action,input={})=>f.call(path+'/'+action,{environment:f.environment,...input});
 const at=new Date().toISOString();
 const statusEvidence=(code='00',extra={},times={})=>{const now=new Date().toISOString();return {environment:f.environment,credentialFingerprint:g.binding.credentialFingerprint,operation:'transactions-status',externalId:String(external++).padStart(32,'0'),requestedAt:now,observedAt:now,requestBody:JSON.stringify({partnerReferenceNo:g.binding.partnerReferenceNo}),responseBody:JSON.stringify({responseCode:'2000000',partnerReferenceNo:g.binding.partnerReferenceNo,transactionType:'PAYOUT',latestTransactionStatus:code,amount:{value:g.binding.amount+'.00',currency:'IDR'},transactionDate:at,...extra}),...times};};
 const status=async(code='00',extra={},times={})=>{ok(await call('status/receipt',{evidence:statusEvidence(code,extra,times)}));const history=await call('status/history');assert.equal(history.ok,true);return history.cap;};
 const row=(type='PAYOUT',amount='1000',status='SUCCESS',extra={})=>({referenceNo:'fixture-payment',partnerReferenceNo:g.binding.partnerReferenceNo,transactionType:type,mutationType:'DEBIT',amount,currency:'IDR',status,dateTime:at,channel:g.binding.channel,...extra});
 const collect=async({principal=[row()],fees=[row('PAYOUT_CHARGE','2500')],pending=[],other=[],options={}}={})=>{
  const legs=f.legs(f.p);legs.platformCash.push(...principal,...fees,...other);legs.platformPending.push(...pending);for(const values of Object.values(legs))values.sort((a,b)=>b.dateTime.localeCompare(a.dateTime));
  return f.collect(f.p,legs,{from:new Date(Date.parse(f.p.order.createdAt)-360000).toISOString(),...options});
 };
 const reconcile=(pair,cap)=>call('outcome/reconcile',{collectionId:pair.platformCollectionId,statusCap:cap});
 return {...f,g,call,status,statusEvidence,row,collectOutcome:collect,reconcileOutcome:reconcile};
}
test('complete original company history plus matching bank receipt/status records immutable success but no cash journal or reservation release',async t=>{
 const f=await ready(t),before=(await f.db.prepare('SELECT COUNT(*) n FROM commerce_financial_journals').first()).n,cap=await f.status(),pair=await f.collectOutcome();
 const r=ok(await f.reconcileOutcome(pair,cap));assert.equal(r.outcome.state,'matched_success');assert.equal(r.outcome.observedFee,'2500');assert.equal(r.outcome.payoutConfirmed,false);assert.equal(r.outcome.reservationReleased,false);
 assert.equal(ok(await f.reconcileOutcome(pair,cap)).replayed,true);assert.equal((await f.db.prepare('SELECT COUNT(*) n FROM commerce_financial_journals').first()).n,before);
 assert.equal((await f.db.prepare('SELECT reserved_commission FROM commerce_treasury_funds WHERE platform_enrollment_id=(SELECT platform_enrollment_id FROM commerce_treasury_intents WHERE id=?)').bind(f.id).first()).reserved_commission,1000);
 for(const table of ['commerce_treasury_status_observations','commerce_treasury_outcome_assessments','commerce_treasury_outcome_results'])await assert.rejects(f.db.prepare('DELETE FROM '+table).run(),/immutable/);
 assert.equal((await f.api('/intents/'+f.id+'/cancel',{requestKey:key()})).status,409);
 const detail=ok(await f.api('/intents/'+f.id));assert.equal(detail.outcome.state,'matched_success');
 // A later overlapping cash history invalidates the source immediately, even before collection finalization.
 await f.history([],{accountNo:f.g.binding.fromAccount,fromDateTime:pair.from,toDateTime:pair.to},{seller:'seller_bob',requestedAt:new Date().toISOString(),observedAt:new Date().toISOString()});
 assert.equal(ok(await f.call('outcome/read')).outcome.reason,'provider_evidence_changed');assert.equal(ok(await f.call('outcome/read')).outcome.payoutConfirmed,false);
});
test('missing, duplicate, foreign and pending legs cannot become zero fees or completed company payouts',async t=>{
 const f=await ready(t),cap=await f.status();
 for(const [changes,reason] of [[{fees:[]},'actual_fee_unknown_or_ambiguous'],[{fees:[f.row('PAYOUT_CHARGE','0')]},'matched_success'],[{principal:[f.row(),f.row()]},'principal_duplicate'],[{principal:[f.row('PAYOUT','999')]},'principal_details_mismatch'],[{principal:[f.row('PAYOUT','1000','PENDING')]},'provider_outcome_unresolved'],[{principal:[f.row('PAYOUT','1000','SUCCESS',{referenceNo:'other-provider'})]},'receipt_reference_mismatch'],[{principal:[],pending:[f.row()]},'principal_missing_or_ambiguous']]){
  const pair=await f.collectOutcome(changes),r=ok(await f.reconcileOutcome(pair,cap));assert.equal(r.outcome.reason,reason);if(changes.fees?.length===0)assert.equal(r.outcome.observedFee,null);assert.equal(r.outcome.payoutConfirmed,false);
 }
 const pair=await f.collectOutcome();assert.equal((await f.call('outcome/reconcile',{collectionId:pair.sellerCollectionId,statusCap:cap})).status,409);
});
test('unknown original payment and contradictory or stale statuses remain held; later receipt can support a new immutable assessment',async t=>{
 const f=await ready(t,{withReceipt:false});const e=f.statusEvidence();assert.equal((await f.call('status/receipt',{evidence:{...e,responseBody:e.responseBody.replace('1000.00','1001.00')}})).status,409);
 const cap=await f.status(),pair=await f.collectOutcome(),first=ok(await f.reconcileOutcome(pair,cap));assert.equal(first.outcome.reason,'destination_not_confirmed_by_transfer_receipt');
 ok(await f.internal('payment','receipt',{evidence:evidence(f.g,'payment')}));assert.equal(ok(await f.call('outcome/read')).outcome.sourceCurrent,false);
 const second=ok(await f.reconcileOutcome(pair,cap));assert.notEqual(second.assessmentId,first.assessmentId);assert.equal(second.outcome.state,'matched_success');
 const changed=await f.status('06'),updated=await f.collectOutcome({principal:[f.row('PAYOUT','1000','VOID')]});assert.equal((await f.reconcileOutcome(updated,cap)).status,409);
 assert.equal(ok(await f.reconcileOutcome(updated,changed)).outcome.reason,'contradictory_terminal_status');
 const original=ok(await f.call('observations/scope'));assert.equal(original.original.account.cashAccount,f.g.binding.fromAccount);assert.equal(original.mayPay,false);
});
test('explicit void failure is an observation only; incomplete or overlapping status frontiers cannot release reservations',async t=>{
 const f=await ready(t,{withReceipt:false}),cap=await f.status('06'),pair=await f.collectOutcome({principal:[f.row('PAYOUT','1000','VOID')],fees:[f.row('PAYOUT_CHARGE','0','VOID')]});
 const r=ok(await f.reconcileOutcome(pair,cap));assert.equal(r.outcome.state,'matched_failure');assert.equal(r.outcome.observedFee,null);assert.equal(r.outcome.reservationReleased,false);
 const pending=await f.status('03'),later=await f.collectOutcome();assert.match(ok(await f.reconcileOutcome(later,pending)).outcome.reason,/terminal_regression|overlapping_status/);
 const bad=await f.collectOutcome({options:{from:new Date(Date.parse(f.p.order.createdAt)-1000).toISOString()}});assert.equal((await f.reconcileOutcome(bad,pending)).status,409);
});
