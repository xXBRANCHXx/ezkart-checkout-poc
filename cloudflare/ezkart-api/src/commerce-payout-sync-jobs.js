import {commerceEnvironment,commerceHash} from './commerce-orders.js';
import {payoutSyncScope} from './commerce-payout-sync.js';

const fail=(message,status=422)=>{throw new Response(message,{status});};
const validId=x=>typeof x==='string'&&/^[A-Za-z0-9_-]{3,100}$/.test(x);
const hex=x=>typeof x==='string'&&/^[a-f0-9]{32}$/.test(x);
const fields=(x,keys)=>{if(!x||typeof x!=='object'||Array.isArray(x)||Object.keys(x).some(k=>!keys.includes(k)))fail('Synchronization job parameters are invalid');};
function scope(env,input,keys){
  fields(input,['environment',...keys]);commerceEnvironment(env,input.environment);
  if(!['test','beta'].includes(env.APP_ENVIRONMENT))fail('Provider synchronization is unavailable on this deployment',503);
}
function enabled(env){if(env.COMMERCE_WITHDRAWAL_SYNC!=='enabled')fail('Provider synchronization is held',503);}
const view=r=>r?{id:r.id,withdrawalId:r.withdrawal_id,environment:r.commerce_environment,state:r.state,attempts:r.attempts,
  failures:r.failures,maxPages:r.max_pages,storageId:r.storage_id,leaseUntil:r.lease_until,availableAt:r.available_at,lastError:r.last_error,
  result:r.result_json?JSON.parse(r.result_json):null,createdAt:r.created_at,updatedAt:r.updated_at,mayPay:false}:null;
const job=(env,id,environment)=>env.DB.prepare('SELECT * FROM commerce_payout_sync_jobs WHERE id=? AND commerce_environment=?').bind(id,environment).first();

async function enqueue(env,id,withdrawalId,environment){
  const original=await env.DB.prepare('SELECT * FROM commerce_withdrawal_payment_grants WHERE withdrawal_id=? AND commerce_environment=?').bind(withdrawalId,environment).first();
  if(!original?.platform_enrollment_id)fail('The original confirmed payout accounts are required',409);
  const previous=await job(env,id,environment);
  if(previous){if(previous.withdrawal_id!==withdrawalId)fail('This synchronization request belongs to another withdrawal',409);return {job:view(previous),replayed:true};}
  const now=new Date().toISOString();
  try{await env.DB.prepare(`INSERT INTO commerce_payout_sync_jobs(id,withdrawal_id,commerce_environment,credential_fingerprint,platform_enrollment_id,state,available_at,created_at,updated_at)
      VALUES(?,?,?,?,?,'queued',?,?,?)`).bind(id,withdrawalId,environment,original.credential_fingerprint,original.platform_enrollment_id,now,now,now).run();}
  catch(error){
    const current=await job(env,id,environment);if(current?.withdrawal_id===withdrawalId)return {job:view(current),replayed:true};
    if(/UNIQUE constraint/.test(String(error)))return {job:null,busy:true,replayed:false};throw error;
  }
  return {job:view(await job(env,id,environment)),replayed:false};
}

export async function requestPayoutSync(env,input){
  scope(env,input,['withdrawalId','requestKey']);enabled(env);
  if(typeof input.withdrawalId!=='string'||!/^wd_[a-f0-9]{40}$/.test(input.withdrawalId)||!hex(input.requestKey))fail('Original withdrawal and request key are required');
  const id=(await commerceHash({operation:'payout-sync',environment:input.environment,withdrawal:input.withdrawalId,key:input.requestKey})).slice(0,32);
  return enqueue(env,id,input.withdrawalId,input.environment);
}

export async function schedulePayoutSync(env,input){
  scope(env,input,['limit']);const limit=input.limit??4;if(!Number.isInteger(limit)||limit<1||limit>10)fail('Synchronization schedule size is invalid');
  if(env.COMMERCE_WITHDRAWAL_SYNC!=='enabled')return {held:true,queued:0,providerCalls:0};
  const now=new Date().toISOString(),cutoff=new Date(Date.now()-12*31*86400000+600000).toISOString();
  const due=(await env.DB.prepare(`WITH candidates AS (
    SELECT g.*,ROW_NUMBER() OVER(PARTITION BY g.commerce_environment,g.credential_fingerprint,g.platform_enrollment_id
      ORDER BY COALESCE(p.reconciled,0),g.created_at DESC,g.withdrawal_id) AS position,
      (SELECT id FROM commerce_payout_sync_jobs j WHERE j.commerce_environment=g.commerce_environment AND j.credential_fingerprint=g.credential_fingerprint
        AND j.platform_enrollment_id=g.platform_enrollment_id ORDER BY j.created_at DESC,j.id DESC LIMIT 1) AS last_job
    FROM commerce_withdrawal_payment_grants g LEFT JOIN commerce_payout_positions p ON p.withdrawal_id=g.withdrawal_id
    WHERE g.commerce_environment=? AND g.platform_enrollment_id IS NOT NULL AND g.created_at>=?
      AND NOT EXISTS(SELECT 1 FROM commerce_payout_sync_jobs a WHERE a.commerce_environment=g.commerce_environment
        AND a.credential_fingerprint=g.credential_fingerprint AND a.platform_enrollment_id=g.platform_enrollment_id AND a.state IN ('queued','running','retry'))
  ) SELECT c.withdrawal_id FROM candidates c LEFT JOIN commerce_payout_sync_jobs j ON j.id=c.last_job
    WHERE c.position=1 AND (j.id IS NULL OR j.available_at<=? OR c.created_at>j.created_at
      OR (j.state='completed' AND EXISTS(SELECT 1 FROM commerce_withdrawal_payment_grants x JOIN commerce_payout_positions p ON p.withdrawal_id=x.withdrawal_id
        WHERE x.commerce_environment=c.commerce_environment AND x.credential_fingerprint=c.credential_fingerprint
          AND x.platform_enrollment_id=c.platform_enrollment_id AND p.needs_review=1)))
    ORDER BY COALESCE(j.available_at,c.created_at),c.withdrawal_id LIMIT ?`).bind(input.environment,cutoff,now,limit).all()).results;
  let queued=0;for(const row of due){const result=await enqueue(env,crypto.randomUUID().replaceAll('-',''),row.withdrawal_id,input.environment);if(result.job&&!result.replayed)queued++;}
  return {held:false,queued,providerCalls:0};
}

export async function claimPayoutSync(env,input){
  scope(env,input,['workerId','storageId','claimKey']);enabled(env);
  if(!validId(input.workerId)||!validId(input.storageId)||!hex(input.claimKey))fail('Worker, storage and claim identity are invalid');
  const replay=async()=>{
    const prior=await env.DB.prepare(`SELECT a.worker_id,a.storage_id,j.* FROM commerce_payout_sync_attempts a
      JOIN commerce_payout_sync_jobs j ON j.id=a.job_id WHERE a.lease_token=?`).bind(input.claimKey).first();
    if(!prior)return null;
    if(prior.worker_id!==input.workerId||prior.storage_id!==input.storageId||prior.commerce_environment!==input.environment)fail('This claim belongs to another worker or storage location',409);
    const active=prior.state==='running'&&prior.lease_token===input.claimKey&&prior.lease_until>new Date().toISOString();
    return {job:active?{...view(prior),leaseToken:input.claimKey}:null,replayed:true,mayPay:false};
  };
  const prior=await replay();if(prior)return prior;
  const now=new Date().toISOString(),until=new Date(Date.now()+120000).toISOString();
  await env.DB.batch([
    env.DB.prepare(`UPDATE commerce_payout_sync_attempts SET finished_at=?,outcome='expired'
      WHERE finished_at IS NULL AND EXISTS(SELECT 1 FROM commerce_payout_sync_jobs j WHERE j.id=job_id
        AND j.lease_token=commerce_payout_sync_attempts.lease_token AND j.commerce_environment=? AND j.state='running' AND j.lease_until<=?)`).bind(now,input.environment,now),
    env.DB.prepare(`UPDATE commerce_payout_sync_jobs SET state=CASE WHEN failures>=7 THEN 'review' ELSE 'retry' END,
      failures=MIN(8,failures+1),last_error='lease_expired',available_at=CASE WHEN failures>=7 THEN '9999-12-31T00:00:00.000Z' ELSE ? END,updated_at=?
      WHERE commerce_environment=? AND state='running' AND lease_until<=?`).bind(now,now,input.environment,now),
    env.DB.prepare(`UPDATE commerce_payout_sync_jobs SET state='running',attempts=attempts+1,storage_id=COALESCE(storage_id,?),
      lease_owner=?,lease_token=?,lease_until=?,completion_hash=NULL,updated_at=?
      WHERE id=(SELECT id FROM commerce_payout_sync_jobs WHERE commerce_environment=? AND state IN ('queued','retry') AND available_at<=?
        AND failures<8 AND (storage_id IS NULL OR storage_id=?)
        AND NOT EXISTS(SELECT 1 FROM commerce_payout_sync_attempts WHERE lease_token=?) ORDER BY available_at,created_at,id LIMIT 1)`)
      .bind(input.storageId,input.workerId,input.claimKey,until,now,input.environment,now,input.storageId,input.claimKey),
    env.DB.prepare(`INSERT INTO commerce_payout_sync_attempts(job_id,attempt,lease_token,worker_id,storage_id,started_at)
      SELECT id,attempts,lease_token,lease_owner,storage_id,? FROM commerce_payout_sync_jobs WHERE lease_token=? AND lease_owner=?
        AND state='running' AND NOT EXISTS(SELECT 1 FROM commerce_payout_sync_attempts WHERE lease_token=?)`).bind(now,input.claimKey,input.workerId,input.claimKey),
  ]);
  return {...(await replay()||{job:null,mayPay:false}),replayed:false};
}

async function lease(env,input,keys=[]){
  scope(env,input,['id','workerId','storageId','leaseToken',...keys]);
  if(!hex(input.id)||!hex(input.leaseToken)||!validId(input.workerId)||!validId(input.storageId))fail('Synchronization lease is invalid');
  const row=await job(env,input.id,input.environment);if(!row)fail('Synchronization run was not found',404);
  if(row.lease_token!==input.leaseToken||row.lease_owner!==input.workerId||row.storage_id!==input.storageId)fail('This worker does not own the original synchronization run',409);
  return row;
}

export async function heartbeatPayoutSync(env,input){
  const row=await lease(env,input);enabled(env);const now=new Date().toISOString(),until=new Date(Date.now()+120000).toISOString();
  if(row.state!=='running'||row.lease_until<=now)fail('The synchronization lease expired',409);
  const saved=await env.DB.prepare(`UPDATE commerce_payout_sync_jobs SET lease_until=?,updated_at=? WHERE id=? AND state='running'
    AND lease_token=? AND lease_owner=? AND storage_id=? AND lease_until>? RETURNING id`).bind(until,now,row.id,input.leaseToken,input.workerId,input.storageId,now).first();
  if(!saved)fail('The synchronization lease changed',409);
  return {id:row.id,leaseUntil:until,mayPay:false};
}

export async function finishPayoutSync(env,input){
  const row=await lease(env,input,['result']);const r=input.result;
  fields(r,['state','reason','providerCalls','coveredWithdrawals','coveredOrders','reviewReasons','planTruncated','sharedHistoryReview']);
  if(!['synchronized','review','incomplete','error'].includes(r.state)||typeof r.reason!=='string'||!/^[a-z_]{1,64}$/.test(r.reason)
    ||(r.providerCalls!==null&&(!Number.isInteger(r.providerCalls)||r.providerCalls<0||r.providerCalls>50)))fail('Synchronization result is invalid');
  for(const [name,pattern,size] of [['coveredWithdrawals',/^wd_[a-f0-9]{40}$/,101],['coveredOrders',/^EZK-[SP]-[A-F0-9]{24}$/,100],['reviewReasons',/^[a-z_]{1,64}$/,32]])
    if(!Array.isArray(r[name])||r[name].length>size||new Set(r[name]).size!==r[name].length||r[name].some(x=>typeof x!=='string'||!pattern.test(x)))fail('Synchronization coverage is invalid');
  if(typeof r.planTruncated!=='boolean'||!r.sharedHistoryReview||Object.keys(r.sharedHistoryReview).sort().join(',')!=='payouts,settlements'
    ||Object.values(r.sharedHistoryReview).some(x=>!Number.isSafeInteger(x)||x<0))fail('Shared history result is invalid');
  const hash=await commerceHash(r);
  if(row.completion_hash){if(row.completion_hash!==hash)fail('This lease already has a different result',409);return {job:view(row),replayed:true,mayPay:false};}
  const now=new Date().toISOString();if(row.state!=='running'||row.lease_until<=now)fail('The synchronization lease expired',409);
  const payouts=(await env.DB.prepare(`SELECT g.withdrawal_id,p.reconciled FROM commerce_withdrawal_payment_grants g
    LEFT JOIN commerce_payout_positions p ON p.withdrawal_id=g.withdrawal_id WHERE g.withdrawal_id IN (SELECT value FROM json_each(?))
      AND g.commerce_environment=? AND g.credential_fingerprint=? AND g.platform_enrollment_id=?`)
    .bind(JSON.stringify(r.coveredWithdrawals),input.environment,row.credential_fingerprint,row.platform_enrollment_id).all()).results;
  const orders=(await env.DB.prepare(`SELECT b.order_id,e.reconciled,EXISTS(
      SELECT 1 FROM commerce_settlement_assessments a JOIN commerce_settlement_results r ON r.assessment_sequence=a.sequence AND r.state='settled'
      JOIN commerce_settlement_source_freshness f ON f.assessment_sequence=a.sequence AND f.current=1
      WHERE a.capture_id=c.id AND NOT EXISTS(SELECT 1 FROM commerce_settlement_assessments later WHERE later.capture_id=c.id AND later.sequence>a.sequence)) AS settled
    FROM commerce_payment_route_bindings b
    JOIN commerce_payment_captures c ON c.order_id=b.order_id AND c.capture_kind='order_payment'
    LEFT JOIN commerce_earnings_positions e ON e.capture_id=c.id WHERE b.order_id IN (SELECT value FROM json_each(?))
      AND b.commerce_environment=? AND b.credential_fingerprint=? AND b.platform_enrollment_id=?`)
    .bind(JSON.stringify(r.coveredOrders),input.environment,row.credential_fingerprint,row.platform_enrollment_id).all()).results;
  if(payouts.length!==r.coveredWithdrawals.length||orders.length!==r.coveredOrders.length)fail('Synchronization coverage differs from the original provider group',409);
  if(r.state==='synchronized'&&(!r.coveredWithdrawals.includes(row.withdrawal_id)||payouts.some(x=>!x.reconciled)||orders.some(x=>!x.reconciled||!x.settled)
    ||r.planTruncated||r.reviewReasons.length||r.sharedHistoryReview.payouts||r.sharedHistoryReview.settlements))fail('The covered financial sources are not reconciled',409);
  if(r.state==='synchronized'){
    const current=await payoutSyncScope(env,row.withdrawal_id,{environment:input.environment});
    if(current.sharedHistoryReview.payouts||current.sharedHistoryReview.settlements)fail('Shared financial sources changed before completion',409);
  }
  const failures=r.state==='error'?Math.min(8,row.failures+1):row.failures;
  const state=r.state==='synchronized'?'completed':r.state==='incomplete'||(r.state==='error'&&failures<8)?'retry':'review';
  // Incomplete runs keep their ID. A completed observation pass can request a
  // later fresh run for provider processing/temporary reads, never a payment.
  const temporary=r.state==='review'&&!r.planTruncated&&!r.sharedHistoryReview.payouts&&!r.sharedHistoryReview.settlements
    &&r.reviewReasons.length>0&&r.reviewReasons.every(x=>['provider_read_failed','payout_not_observed','payment_not_observed','provider_pending','provider_status_unresolved','provider_legs_missing','fee_outcome_unresolved','sources_changed_or_incomplete','provider_evidence_changed','overlapping_results'].includes(x));
  const delay=state==='completed'?21600:state==='retry'?(r.state==='incomplete'?15:Math.min(3600,15*2**failures)):temporary?300:null;
  const available=delay===null?'9999-12-31T00:00:00.000Z':new Date(Date.now()+delay*1000).toISOString();
  const result=JSON.stringify(r),error=state==='completed'?null:r.reason;
  let saved;
  try{saved=await env.DB.batch([
    env.DB.prepare(`UPDATE commerce_payout_sync_jobs SET state=?,failures=?,completion_hash=?,result_json=?,last_error=?,available_at=?,updated_at=?
      WHERE id=? AND state='running' AND lease_token=? AND lease_owner=? AND storage_id=? AND lease_until>? AND completion_hash IS NULL RETURNING *`)
      .bind(state,failures,hash,result,error,available,now,row.id,input.leaseToken,input.workerId,input.storageId,now),
    env.DB.prepare(`UPDATE commerce_payout_sync_attempts SET finished_at=?,outcome=?,result_json=? WHERE job_id=? AND lease_token=?
      AND finished_at IS NULL AND EXISTS(SELECT 1 FROM commerce_payout_sync_jobs WHERE id=? AND completion_hash=? AND lease_token=?)`)
      .bind(now,r.state==='incomplete'?'continue':r.state==='synchronized'?'completed':r.state,result,row.id,input.leaseToken,row.id,hash,input.leaseToken),
  ]);}catch(error){if(/payout_sync_completion_changed/.test(String(error)))fail('Financial sources changed before synchronization completion',409);throw error;}
  if(!saved[0].results.length){const current=await job(env,row.id,input.environment);if(current?.lease_token===input.leaseToken&&current.completion_hash===hash)return {job:view(current),replayed:true,mayPay:false};fail('The synchronization lease changed',409);}
  return {job:view(saved[0].results[0]),replayed:false,mayPay:false};
}

export async function listPayoutSync(env,input){
  scope(env,input,['limit','before']);const limit=input.limit??20;
  if(!Number.isInteger(limit)||limit<1||limit>50||input.before!==undefined&&(typeof input.before!=='string'||input.before.length>100))fail('Synchronization list boundary is invalid');
  const rows=(await env.DB.prepare(`SELECT * FROM commerce_payout_sync_jobs WHERE commerce_environment=? AND (?='' OR created_at||'/'||id<?)
    ORDER BY created_at DESC,id DESC LIMIT ?`).bind(input.environment,input.before||'',input.before||'',limit+1).all()).results;
  const counts=(await env.DB.prepare('SELECT state,COUNT(*) AS count FROM commerce_payout_sync_jobs WHERE commerce_environment=? GROUP BY state').bind(input.environment).all()).results;
  const outside=await env.DB.prepare(`SELECT COUNT(*) AS count FROM commerce_withdrawal_payment_grants g LEFT JOIN commerce_payout_positions p ON p.withdrawal_id=g.withdrawal_id
    WHERE g.commerce_environment=? AND g.created_at<? AND COALESCE(p.reconciled,0)=0`).bind(input.environment,new Date(Date.now()-12*31*86400000+600000).toISOString()).first();
  const last=rows[Math.min(rows.length,limit)-1];
  return {items:rows.slice(0,limit).map(view),nextBefore:rows.length>limit?last.created_at+'/'+last.id:null,
    counts:Object.fromEntries(counts.map(x=>[x.state,x.count])),outsideWindow:outside.count,held:env.COMMERCE_WITHDRAWAL_SYNC!=='enabled',providerCalls:0,mayPay:false};
}

export async function payoutSyncHousekeeping(env){
  if(!['test','beta'].includes(env.APP_ENVIRONMENT)||env.COMMERCE_WITHDRAWAL_SYNC!=='enabled')return {held:true,queued:0,providerCalls:0};
  return schedulePayoutSync(env,{environment:env.APP_ENVIRONMENT==='test'?'sandbox':'production',limit:4});
}
