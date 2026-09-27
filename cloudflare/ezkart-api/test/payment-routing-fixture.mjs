import assert from 'node:assert/strict';
import {randomBytes} from 'node:crypto';

export async function seedRoutingWallets(f,{environment='sandbox',fingerprint='a'.repeat(64),clientId='MCH-FIXTURE-SNAP',platformParent='BRN-fixture',wallets}={}){
  const ids={};
  for(const [user,number,parent] of wallets||[['alice','1','BRN-fixture'],['bob','2',platformParent]]){
    const base='/internal/commerce/finance/wallet',seller='seller_'+user;
    const enrolled=await f.call(base,{environment,seller,action:'enroll',requestKey:randomBytes(16).toString('hex'),
      actor:{id:user,email:user+'@example.test',proofExpiresAt:new Date(Date.now()+550000).toISOString()}});
    assert.equal(enrolled.status,200,enrolled.error);const id=enrolled.enrollment.id;ids[user]=id;
    const registration=(await f.call(base+'/registrations/'+id+'?environment='+environment)).registration;
    const result=await f.call('/internal/commerce/jobs/claim',{environment,workerId:'routing_wallet_fixture',kinds:['wallet.register'],jobId:registration.jobId,mode:'execute',limit:1,leaseSeconds:120});
    assert.equal(result.jobs.length,1);const job=result.jobs[0];
    const path=base+'/registrations/'+id;
    const bound=await f.call(path+'/bind',{environment,workerId:'routing_wallet_fixture',leaseToken:job.leaseToken,credentialFingerprint:fingerprint,clientId,parentProfileId:parent});
    assert.equal(bound.status,200,bound.error);
    const profileId='SAC-'+user,accounts=[{type:'DOKU_MERCHANT_IDR',currency:'IDR',accountNo:'201000000'+number},
      {type:'DOKU_MERCHANT_PENDING_IDR',currency:'IDR',accountNo:'203000000'+number}];
    const receipt=await f.call(path+'/receipt',{environment,credentialFingerprint:fingerprint,registrationBody:JSON.stringify({responseCode:'2000000',parentProfileId:parent,profileId,accounts})});
    assert.equal(receipt.status,200,receipt.error);
    const saved=await f.call(path+'/record',{environment,credentialFingerprint:fingerprint,confirmationBody:JSON.stringify({responseCode:'2000000',profileId,name:user,
      accounts:accounts.map(a=>({...a,balance:{available:'0.00',reserved:'0.00'}}))})});
    assert.equal(saved.status,200,saved.error);
    const done=await f.call('/internal/commerce/jobs/'+job.id+'/finish',{environment,workerId:'routing_wallet_fixture',leaseToken:job.leaseToken,outcome:'succeeded',result:{recorded:true}});
    assert.equal(done.status,200,done.error);
  }
  return ids;
}

export function splitEvidence(binding,extra={}){
  const request={transactionType:'PAYMENT',rules:[{type:'FLAT',value:binding.platformAmount,currency:'IDR',accountNumber:Number(binding.platformCashAccount)}]};
  const timestamp=new Date().toISOString().replace(/\.\d{3}Z$/,'Z');
  return {environment:binding.environment,credentialFingerprint:binding.credentialFingerprint,externalId:binding.externalId,operation:'split-rules',
    requestedAt:timestamp,observedAt:timestamp,requestBody:JSON.stringify(request),responseBody:JSON.stringify({responseCode:'2000000',splitRuleId:'split-'+binding.orderId.slice(-24),...request}),...extra};
}

export async function prepareFixtureRoute(f,order,job,{environment='sandbox',workerId='fixture_snap_worker',fingerprint='a'.repeat(64),clientId='MCH-FIXTURE-SNAP'}={}){
  const path='/internal/commerce/snap-payments/'+order.id+'/route';
  const bound=await f.call(path+'/bind',{environment,workerId,leaseToken:job.leaseToken,credentialFingerprint:fingerprint,clientId});
  assert.equal(bound.status,200,bound.error);assert.equal(bound.mayCreateRule,true);
  const result=await f.call(path+'/receipt',{environment,evidence:splitEvidence(bound.binding)});
  assert.equal(result.status,200,result.error);return result;
}
