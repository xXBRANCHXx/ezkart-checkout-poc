import {commerceEnvironment,commerceHash} from './commerce-orders.js';
import {emailLookupConfiguration,emailCredentialHash,emailReaderHash,emailProviderId,retrieveResendEmail} from './email-provider.js';
import {reviewCursor,readReviewCursor} from './commerce-reviews.js';

const fail=(message,status=422)=>{throw new Response(message,{status});};
const key=value=>typeof value==='string'&&/^[a-f0-9]{32}$/.test(value);
const requestId=value=>typeof value==='string'&&/^email_[a-f0-9]{32}$/.test(value);
const operator=value=>typeof value==='string'&&/^[A-Za-z0-9][A-Za-z0-9_-]{2,95}$/.test(value);
const now=()=>new Date().toISOString();
const fields=(input,allowed)=>{if(!input||typeof input!=='object'||Array.isArray(input)||Object.keys(input).some(k=>!allowed.includes(k)))fail('Email investigation request is invalid');};
const kindFor=Object.freeze({sent:'sent',delivered:'delivered',delivery_delayed:'delayed',bounced:'bounced',complained:'complained',failed:'failed',suppressed:'suppressed',opened:'accepted',clicked:'accepted'});
const outcomeNotes={matched:'The provider record matches the saved email request.',not_found:'The provider did not return this reference. This does not prove that no email was sent.',
  unavailable:'The provider lookup was unavailable. Delivery remains unresolved.',rejected:'The provider rejected the lookup. Check the reader key permissions and account.',
  invalid:'The provider response could not be verified.',mismatch:'The provider record does not match this email request.',conflict:'A different provider identity is already recorded. Operator investigation is required.'};
const receipt=row=>row?{lookupKey:row.lookup_key,outcome:row.outcome,status:row.http_status,kind:row.kind,observedAt:row.observed_at,note:outcomeNotes[row.outcome]}:null;
const resolution=row=>row?{resolutionKey:row.resolution_key,requestId:row.request_id,lookupKey:row.lookup_key,operator:row.operator_id,previousState:row.previous_state,resolvedAt:row.created_at}:null;
async function load(env,id,environment){
  const row=await env.DB.prepare(`SELECT x.*,b.provider_id,j.state AS job_state,j.updated_at AS job_updated_at,j.result_json AS job_result,j.last_error,
    (SELECT MIN(created_at) FROM commerce_email_starts WHERE request_id=x.id) AS first_start,
    (SELECT MAX(created_at) FROM commerce_email_starts WHERE request_id=x.id) AS last_start
    FROM commerce_email_requests x JOIN commerce_jobs j ON j.id=x.job_id LEFT JOIN commerce_email_verified_bindings b ON b.request_id=x.id
    WHERE x.id=? AND x.commerce_environment=?`).bind(id,environment).first();
  if(!row)fail('Email request not found',404);return row;
}
function providerTimestamp(value){
  if(typeof value!=='string'||!/^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?(?:Z|[+-]\d{2}:\d{2}|\+00)$/.test(value))return null;
  const date=Date.parse(value.replace(' ','T').replace(/\+00$/,'+00:00'));return Number.isFinite(date)?new Date(date).toISOString():null;
}
function match(row,lookup,result,observedAt){
  const data=result.data,original=JSON.parse(row.request_json),created=providerTimestamp(data?.created_at);
  if(!data||Array.isArray(data)||data.object!=='email'||data.id!==lookup.provider_id||data.from!==original.from||data.subject!==original.subject
    ||!Array.isArray(data.to)||data.to.length!==1||data.to[0]!==row.recipient_email||data.scheduled_at!=null
    ||['cc','bcc','reply_to'].some(k=>data[k]!=null&&(!Array.isArray(data[k])||data[k].length))
    ||!Array.isArray(data.tags)||data.tags.length!==3||original.tags.some(tag=>!data.tags.some(t=>t?.name===tag.name&&t.value===tag.value))
    ||!created||Date.parse(created)<Date.parse(row.first_start)-300000||Date.parse(created)>Date.parse(row.last_start)+300000||Date.parse(created)>Date.parse(observedAt)+300000){
    return {outcome:'mismatch',kind:null,created:null};
  }
  if(!Object.hasOwn(kindFor,data.last_event))return {outcome:'invalid',kind:null,created:null};
  return {outcome:'matched',kind:kindFor[data.last_event],created};
}
function databaseFailure(error){
  const detail=String(error)+' '+String(error.cause||'');
  if(detail.includes('email_lookup_rate'))fail('Too many investigations. Wait before checking again.',429);
  if(/email_lookup_provider_conflict|email_resolution_invalid|email_immutable|email_lookup_invalid/.test(detail))fail('The email evidence changed or does not permit this action. Reload the investigation.',409);
  throw error;
}
export async function lookupEmail(env,input,fetcher=fetch){
  fields(input,['environment','requestId','providerId','lookupKey','operator']);const environment=commerceEnvironment(env,input.environment);
  if(!requestId(input.requestId)||!emailProviderId(input.providerId)||!key(input.lookupKey)||!operator(input.operator))fail('Email investigation identity is invalid');
  const row=await load(env,input.requestId,environment);
  let lookup=await env.DB.prepare('SELECT * FROM commerce_email_lookups WHERE lookup_key=?').bind(input.lookupKey).first();
  if(lookup&&(lookup.request_id!==input.requestId||lookup.provider_id!==input.providerId||lookup.operator_id!==input.operator))fail('This lookup reference already belongs to a different investigation',409);
  const existing=lookup&&await env.DB.prepare('SELECT * FROM commerce_email_lookup_results WHERE lookup_key=?').bind(input.lookupKey).first();
  if(existing)return {receipt:receipt(existing),replayed:true};
  const configuration=emailLookupConfiguration(env);if(!configuration.ready)fail('Email investigation is not connected',503);
  const credentialHash=await emailCredentialHash(env,configuration),readerHash=await emailReaderHash(env,configuration);
  if(row.profile_id!==configuration.profile||row.credential_hash!==credentialHash||lookup&&lookup.reader_hash!==readerHash)fail('The saved email uses a different provider connection. Restore its original connection before investigating.',409);
  if(!row.first_start)fail('No submission was started for this request',409);
  if(row.provider_id&&row.provider_id!==input.providerId)fail('Use the saved provider email reference',409);
  if(!lookup){
    try{await env.DB.prepare(`INSERT INTO commerce_email_lookups(lookup_key,request_id,provider_id,credential_hash,reader_hash,operator_id,created_at)
      SELECT ?,?,?,?,?,?,? WHERE NOT EXISTS(SELECT 1 FROM commerce_email_lookups WHERE lookup_key=?)`)
      .bind(input.lookupKey,row.id,input.providerId,credentialHash,readerHash,input.operator,now(),input.lookupKey).run();}catch(error){databaseFailure(error);}
    lookup=await env.DB.prepare('SELECT * FROM commerce_email_lookups WHERE lookup_key=?').bind(input.lookupKey).first();
    if(!lookup||lookup.request_id!==row.id||lookup.provider_id!==input.providerId||lookup.operator_id!==input.operator||lookup.reader_hash!==readerHash)fail('This lookup reference changed while being saved',409);
  }
  const prior=await env.DB.prepare('SELECT * FROM commerce_email_lookup_results WHERE lookup_key=?').bind(input.lookupKey).first();
  if(prior)return {receipt:receipt(prior),replayed:true};
  // This adapter issues only GET. An interrupted read may safely repeat with
  // the same intent; concurrent readers return whichever durable result won.
  const result=await retrieveResendEmail(env,input.providerId,fetcher),observedAt=now();
  let checked=result.outcome==='received'?match(row,lookup,result,observedAt):{outcome:result.outcome,kind:null,created:null};
  const hash=result.raw===null?null:await commerceHash(result.raw);
  const save=()=>env.DB.prepare(`INSERT INTO commerce_email_lookup_results(lookup_key,outcome,http_status,raw_body,body_hash,kind,provider_created_at,observed_at)
    SELECT ?,?,?,?,?,?,?,? WHERE NOT EXISTS(SELECT 1 FROM commerce_email_lookup_results WHERE lookup_key=?)`)
    .bind(input.lookupKey,checked.outcome,result.status,result.raw,hash,checked.kind,checked.created,observedAt,input.lookupKey).run();
  try{await save();}catch(error){
    // A callback may bind an incompatible ID while the GET is in flight. Keep
    // its response as conflict evidence, without changing the earlier binding.
    if((String(error)+' '+String(error.cause||'')).includes('email_lookup_provider_conflict')){checked={outcome:'conflict',kind:null,created:null};await save();}
    else {
      const committed=await env.DB.prepare('SELECT * FROM commerce_email_lookup_results WHERE lookup_key=?').bind(input.lookupKey).first();
      if(committed)return {receipt:receipt(committed),replayed:true};throw error;
    }
  }
  const saved=await env.DB.prepare('SELECT * FROM commerce_email_lookup_results WHERE lookup_key=?').bind(input.lookupKey).first();
  if(!saved)fail('The provider lookup result could not be saved. Retry the original lookup reference.',503);
  return {receipt:receipt(saved),replayed:false};
}
export async function resolveEmail(env,input){
  fields(input,['environment','requestId','lookupKey','resolutionKey','expectedUpdatedAt','operator']);const environment=commerceEnvironment(env,input.environment);
  if(!requestId(input.requestId)||!key(input.lookupKey)||!key(input.resolutionKey)||!operator(input.operator)
    ||typeof input.expectedUpdatedAt!=='string'||!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(input.expectedUpdatedAt))fail('Email resolution identity is invalid');
  const row=await load(env,input.requestId,environment);
  const saved=await env.DB.prepare('SELECT * FROM commerce_email_resolutions WHERE resolution_key=? OR request_id=?').bind(input.resolutionKey,row.id).first();
  if(saved){if(saved.resolution_key!==input.resolutionKey||saved.request_id!==row.id||saved.lookup_key!==input.lookupKey||saved.operator_id!==input.operator||saved.previous_updated_at!==input.expectedUpdatedAt)fail('This email already has a different resolution',409);
    return {resolution:resolution(saved),replayed:true};}
  if(row.job_updated_at!==input.expectedUpdatedAt)fail('The delivery job changed. Reload the investigation before resolving it.',409);
  if(!['dead','uncertain','retry'].includes(row.job_state))fail('This delivery job does not need a resolution or is still running',409);
  try{await env.DB.prepare(`INSERT INTO commerce_email_resolutions(resolution_key,request_id,lookup_key,operator_id,previous_state,previous_result,previous_error,previous_updated_at,created_at)
    SELECT ?,?,?,?,?,?,?,?,? WHERE NOT EXISTS(SELECT 1 FROM commerce_email_resolutions WHERE resolution_key=?)`)
    .bind(input.resolutionKey,row.id,input.lookupKey,input.operator,row.job_state,row.job_result||'{}',row.last_error,row.job_updated_at,now(),input.resolutionKey).run();}
  catch(error){
    const committed=await env.DB.prepare('SELECT resolution_key FROM commerce_email_resolutions WHERE resolution_key=?').bind(input.resolutionKey).first();
    if(committed)return resolveEmail(env,input);databaseFailure(error);
  }
  const final=await env.DB.prepare('SELECT * FROM commerce_email_resolutions WHERE resolution_key=?').bind(input.resolutionKey).first();
  if(!final)fail('The resolution could not be saved. Retry its original reference.',503);
  if(final.request_id!==row.id||final.lookup_key!==input.lookupKey||final.operator_id!==input.operator||final.previous_updated_at!==input.expectedUpdatedAt)fail('This resolution reference already has a different result',409);
  return {resolution:resolution(final),replayed:false};
}
export async function emailInvestigations(env,url,id=null){
  const allowed=id?['environment','cursor']:['environment','cursor','state'];
  for(const name of url.searchParams.keys())if(!allowed.includes(name)||url.searchParams.getAll(name).length!==1)fail('Investigation filters are invalid');
  const environment=commerceEnvironment(env,url.searchParams.get('environment')),state=url.searchParams.get('state')||'attention';
  if(!['attention','all'].includes(state)||id!==null&&!requestId(id))fail('Investigation filters are invalid');
  const scope=await commerceHash({environment,state,id,view:'email_investigations'}),cursor=url.searchParams.has('cursor')?readReviewCursor(url.searchParams.get('cursor'),scope):null;
  if(cursor&&(!Number.isSafeInteger(cursor.cap)||!Number.isSafeInteger(cursor.before)||cursor.before<1||cursor.cap<cursor.before-1))fail('Investigation page is invalid');
  if(id){
    const row=await load(env,id,environment);
    const max=(await env.DB.prepare('SELECT COALESCE(MAX(rowid),0) AS id FROM commerce_email_lookups WHERE request_id=?').bind(id).first()).id;
    const cap=cursor?.cap??max,before=cursor?.before??cap+1;
    const lookups=await env.DB.prepare(`SELECT l.rowid,l.lookup_key,l.provider_id,l.operator_id,l.created_at,r.outcome,r.http_status,r.kind,r.observed_at
      FROM commerce_email_lookups l LEFT JOIN commerce_email_lookup_results r ON r.lookup_key=l.lookup_key
      WHERE l.request_id=? AND l.rowid<=? AND l.rowid<? ORDER BY l.rowid DESC LIMIT 21`).bind(id,cap,before).all();
    const items=lookups.results.slice(0,20).map(l=>({lookupKey:l.lookup_key,providerId:l.provider_id,operator:l.operator_id,createdAt:l.created_at,receipt:l.outcome?receipt(l):null}));
    return {request:{id:row.id,sellerId:row.seller_id,environment,profile:row.profile_id,providerId:row.provider_id||null,jobId:row.job_id,state:row.job_state,updatedAt:row.job_updated_at,
      createdAt:row.created_at,retryUntil:row.retry_until,startedAt:row.first_start,lastError:row.last_error},lookups:items,
      resolution:resolution(await env.DB.prepare('SELECT * FROM commerce_email_resolutions WHERE request_id=?').bind(id).first()),
      nextCursor:lookups.results.length>20?reviewCursor({v:1,scope,cap,before:lookups.results[19].rowid}):null,lookupEnabled:emailLookupConfiguration(env).ready};
  }
  const max=(await env.DB.prepare('SELECT COALESCE(MAX(rowid),0) AS id FROM commerce_email_requests WHERE commerce_environment=?').bind(environment).first()).id;
  const cap=cursor?.cap??max,before=cursor?.before??cap+1;
  const rows=await env.DB.prepare(`SELECT x.rowid,x.id,x.seller_id,x.profile_id,x.created_at,j.state,j.updated_at,b.provider_id,
    (SELECT MAX(r.observed_at) FROM commerce_email_lookup_results r JOIN commerce_email_lookups l ON l.lookup_key=r.lookup_key WHERE l.request_id=x.id) AS checked_at
    FROM commerce_email_requests x JOIN commerce_jobs j ON j.id=x.job_id LEFT JOIN commerce_email_verified_bindings b ON b.request_id=x.id
    WHERE x.commerce_environment=? AND x.rowid<=? AND x.rowid<? AND (?='all' OR j.state IN ('dead','uncertain','retry')
      OR (b.created_at<strftime('%Y-%m-%dT%H:%M:%fZ','now','-15 minutes') AND NOT EXISTS(SELECT 1 FROM commerce_email_delivery_evidence e WHERE e.request_id=x.id AND e.kind IN ('delivered','bounced','complained','failed','suppressed')))
      OR EXISTS(SELECT 1 FROM commerce_email_delivery_evidence e WHERE e.request_id=x.id AND e.kind IN ('bounced','complained','failed','suppressed')))
    ORDER BY x.rowid DESC LIMIT 21`).bind(environment,cap,before,state).all();
  return {items:rows.results.slice(0,20).map(r=>({id:r.id,sellerId:r.seller_id,profile:r.profile_id,createdAt:r.created_at,state:r.state,updatedAt:r.updated_at,providerId:r.provider_id||null,checkedAt:r.checked_at})),
    nextCursor:rows.results.length>20?reviewCursor({v:1,scope,cap,before:rows.results[19].rowid}):null,lookupEnabled:emailLookupConfiguration(env).ready};
}
