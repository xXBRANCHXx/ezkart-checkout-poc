import {commerceEnvironment,commerceHash} from './commerce-orders.js';

const fail=(message,status=422)=>{throw new Response(message,{status});};
function scope(env,input,fields=[]){
  if(!input||typeof input!=='object'||Array.isArray(input)||Object.keys(input).some(x=>!['environment',...fields].includes(x)))fail('Runner parameters are invalid');
  commerceEnvironment(env,input.environment);
  if(!['test','beta'].includes(env.APP_ENVIRONMENT))fail('Synchronization runners are unavailable on this deployment',503);
}
function identity(input){
  if(typeof input.storageId!=='string'||!/^[A-Za-z0-9_-]{3,100}$/.test(input.storageId)
    ||typeof input.runId!=='string'||!/^[a-f0-9]{32}$/.test(input.runId))fail('Runner identity is invalid');
}
const row=(env,environment)=>env.DB.prepare('SELECT * FROM commerce_payout_sync_runner WHERE commerce_environment=?').bind(environment).first();
const view=x=>x?{runId:x.run_id,storageId:x.storage_id,state:x.state,startedAt:x.started_at,seenAt:x.seen_at,leaseUntil:x.lease_until,
  finishedAt:x.finished_at,runs:x.runs,failedRuns:x.failed_runs,interruptedRuns:x.interrupted_runs,lastFailureAt:x.last_failure_at,
  result:x.result_json?JSON.parse(x.result_json):null}:null;

export async function startPayoutSyncRunner(env,input){
  scope(env,input,['storageId','runId']);identity(input);
  const previous=await row(env,input.environment);
  if(previous&&previous.storage_id!==input.storageId)fail('The runner belongs to another private receipt storage',409);
  if(previous?.run_id===input.runId)return {runner:view(previous),owned:previous.state==='running'&&previous.lease_until>new Date().toISOString(),replayed:true,mayPay:false};
  const now=new Date().toISOString(),until=new Date(Date.now()+600000).toISOString();
  await env.DB.prepare(`INSERT INTO commerce_payout_sync_runner(commerce_environment,storage_id,run_id,state,started_at,seen_at,lease_until)
    VALUES(?,?,?,'running',?,?,?) ON CONFLICT(commerce_environment) DO UPDATE SET
      run_id=excluded.run_id,state='running',started_at=excluded.started_at,seen_at=excluded.seen_at,lease_until=excluded.lease_until,
      finished_at=NULL,result_hash=NULL,result_json=NULL,runs=commerce_payout_sync_runner.runs+1,
      interrupted_runs=commerce_payout_sync_runner.interrupted_runs+CASE WHEN commerce_payout_sync_runner.state='running' THEN 1 ELSE 0 END,
      last_failure_at=CASE WHEN commerce_payout_sync_runner.state='running' THEN excluded.started_at ELSE commerce_payout_sync_runner.last_failure_at END
    WHERE commerce_payout_sync_runner.storage_id=excluded.storage_id AND commerce_payout_sync_runner.run_id!=excluded.run_id
      AND (commerce_payout_sync_runner.state!='running' OR commerce_payout_sync_runner.lease_until<=excluded.started_at)`)
    .bind(input.environment,input.storageId,input.runId,now,now,until).run();
  const current=await row(env,input.environment);
  if(current.storage_id!==input.storageId)fail('The runner belongs to another private receipt storage',409);
  return {runner:view(current),owned:current.run_id===input.runId&&current.state==='running',replayed:false,mayPay:false};
}

async function original(env,input,extra=[]){
  scope(env,input,['storageId','runId',...extra]);identity(input);const saved=await row(env,input.environment);
  if(!saved)fail('The synchronization runner was not found',404);
  if(saved.storage_id!==input.storageId||saved.run_id!==input.runId)fail('The original runner has changed',409);
  return saved;
}

export async function pulsePayoutSyncRunner(env,input){
  await original(env,input);const now=new Date().toISOString(),until=new Date(Date.now()+600000).toISOString();
  const saved=await env.DB.prepare(`UPDATE commerce_payout_sync_runner SET seen_at=?,lease_until=?
    WHERE commerce_environment=? AND storage_id=? AND run_id=? AND state='running' AND lease_until>? RETURNING run_id`)
    .bind(now,until,input.environment,input.storageId,input.runId,now).first();
  if(!saved)fail('The synchronization runner lease expired or changed',409);
  return {runId:input.runId,leaseUntil:until,mayPay:false};
}

export async function finishPayoutSyncRunner(env,input){
  const saved=await original(env,input,['result']),r=input.result;
  if(!r||typeof r!=='object'||Array.isArray(r)||Object.keys(r).sort().join(',')!=='processed,providerCalls,queued,reason,state'
    ||!['held','idle','completed','retry','review','failed'].includes(r.state)
    ||!['held','nothing_due','completed','needs_retry','review_required','dispatch_failed'].includes(r.reason)
    ||(r.queued!==null&&(!Number.isInteger(r.queued)||r.queued<0||r.queued>4))
    ||(r.processed!==null&&(!Number.isInteger(r.processed)||r.processed<0||r.processed>1))
    ||(r.providerCalls!==null&&(!Number.isInteger(r.providerCalls)||r.providerCalls<0||r.providerCalls>50)))fail('Runner result is invalid');
  const reasons={held:'held',idle:'nothing_due',completed:'completed',retry:'needs_retry',review:'review_required',failed:'dispatch_failed'};
  if(reasons[r.state]!==r.reason||(['held','idle'].includes(r.state)&&(r.processed!==0||r.providerCalls!==0))
    ||(['completed','retry','review'].includes(r.state)&&r.processed!==1))fail('Runner outcome is inconsistent');
  const hash=await commerceHash(r);
  if(saved.result_hash){if(saved.result_hash!==hash)fail('The original runner result cannot change',409);return {runner:view(saved),replayed:true,mayPay:false};}
  const now=new Date().toISOString();
  // An exact saved completion may recover after lease expiry if no newer run
  // has replaced it. This records liveness only; it grants no provider action.
  const current=await env.DB.prepare(`UPDATE commerce_payout_sync_runner SET state=?,seen_at=?,finished_at=?,lease_until=?,
      result_hash=?,result_json=?,failed_runs=failed_runs+?,last_failure_at=CASE WHEN ?=1 THEN ? ELSE last_failure_at END
    WHERE commerce_environment=? AND storage_id=? AND run_id=? AND state='running' AND result_hash IS NULL RETURNING *`)
    .bind(r.state,now,now,now,hash,JSON.stringify(r),r.state==='failed'?1:0,r.state==='failed'?1:0,now,input.environment,input.storageId,input.runId).first();
  if(!current){const retry=await row(env,input.environment);if(retry?.run_id===input.runId&&retry.result_hash===hash)return {runner:view(retry),replayed:true,mayPay:false};fail('The synchronization runner changed',409);}
  return {runner:view(current),replayed:false,mayPay:false};
}

export async function payoutSyncRunnerStatus(env,input){
  scope(env,input);return {runner:view(await row(env,input.environment)),held:env.COMMERCE_WITHDRAWAL_SYNC!=='enabled',mayPay:false};
}
