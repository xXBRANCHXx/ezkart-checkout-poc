import {commerceHash} from './commerce-orders.js';
import {claimCommerceJobs,finishCommerceJob} from './commerce-jobs.js';
import {emailConfiguration,emailCredentialHash,verifiedEmailRecipient,sendResendEmail,emailProviderId,verifyResendWebhook} from './email-provider.js';
import {notificationEmailPayload} from './email-template.js';

const fail=(message,status=422)=>{throw new Response(message,{status});};
const conflict=message=>{throw Object.assign(new Response(message,{status:409}),{code:'email_evidence_conflict'});};
const invalid=()=>{throw Object.assign(new Error('The email source needs an operator review.'),{code:'email_source_invalid'});};
const at=()=>new Date().toISOString();
const finish=(env,job,workerId,outcome,result,error='')=>finishCommerceJob(env,job.id,{environment:job.environment,workerId,leaseToken:job.leaseToken,outcome,result,error});
async function source(env,job){
  if(job.kind!=='notification.send'||!Number.isSafeInteger(job.data?.recipientId)||job.data.recipientId<1)invalid();
  const row=await env.DB.prepare(`SELECT r.id AS recipient_id,r.actor_kind,r.actor_id,r.email_requested,r.created_at AS recipient_created_at,
    e.seller_id,e.commerce_environment,e.category,e.title,e.body,e.data_json,e.occurred_at,e.order_id,e.conversation_id,e.return_id,e.suppression,
    s.name AS store_name,s.status AS store_status,
    CASE WHEN r.actor_kind='merchant' THEN EXISTS(SELECT 1 FROM seller_memberships m WHERE m.seller_id=e.seller_id AND m.auth_user_id=r.actor_id)
      ELSE EXISTS(SELECT 1 FROM commerce_conversations c WHERE c.id=e.conversation_id AND c.buyer_auth_user_id=r.actor_id)
        OR EXISTS(SELECT 1 FROM orders o LEFT JOIN commerce_order_owners owner ON owner.order_id=o.id WHERE o.id=e.order_id
          AND COALESCE(owner.auth_user_id,NULLIF(json_extract(o.customer_snapshot_json,'$.authUserId'),''))=r.actor_id) END AS has_access,
    CASE WHEN r.actor_kind='merchant' THEN COALESCE((SELECT json_extract(p.preferences_json,'$.'||e.category||'.email')
      FROM commerce_notification_preferences p WHERE p.seller_id=e.seller_id AND p.auth_user_id=r.actor_id),0) ELSE COALESCE((SELECT json_extract(p.preferences_json,'$.'||e.category||'.email') FROM commerce_buyer_notification_preferences p WHERE p.auth_user_id=r.actor_id),0) END AS email_enabled,
    EXISTS(SELECT 1 FROM commerce_message_reads mr WHERE mr.conversation_id=e.conversation_id AND mr.actor_kind=r.actor_kind AND mr.actor_id=r.actor_id
      AND mr.event_id>=json_extract(e.data_json,'$.eventId')) AS message_read,
    CASE WHEN e.category='payment_pending' THEN NOT EXISTS(SELECT 1 FROM orders o WHERE o.id=e.order_id AND o.checkout_state IN ('creating','pending')
      AND o.expires_at>strftime('%Y-%m-%dT%H:%M:%fZ','now')) ELSE 0 END AS obsolete
    FROM commerce_notification_recipients r JOIN commerce_notification_events e ON e.id=r.event_id JOIN sellers s ON s.id=e.seller_id WHERE r.id=?`)
    .bind(job.data.recipientId).first();
  if(!row||!row.email_requested||row.seller_id!==job.sellerId||row.commerce_environment!==job.environment||row.suppression)invalid();
  return row;
}
async function evidence(env,job){
  return env.DB.prepare(`SELECT x.*,b.provider_id,EXISTS(SELECT 1 FROM commerce_email_starts a WHERE a.request_id=x.id) AS started
    FROM commerce_email_requests x LEFT JOIN commerce_email_provider_bindings b ON b.request_id=x.id WHERE x.job_id=?`).bind(job.id).first();
}
function ineligible(row,configuration,now=Date.now()){
  if(row.store_status!=='active')return 'store_closed';
  if(!row.has_access)return 'access_removed';
  if(!row.email_enabled)return 'preference_off';
  if(row.occurred_at<configuration.start)return 'before_activation';
  if(!Number.isFinite(Date.parse(row.occurred_at))||Date.parse(row.occurred_at)<now-86400000)return 'stale';
  if(row.message_read)return 'already_read';
  if(row.obsolete)return 'obsolete';
  return '';
}
async function skip(env,job,workerId,row,request,reason){
  // A previous network start means the mail may already have been submitted.
  // A preference/address change cannot convert that uncertainty into "not sent".
  const uncertain=Boolean(request?.started);
  await env.DB.prepare(`INSERT INTO commerce_email_skips(job_id,recipient_id,request_id,reason,uncertain,source_lease_token,created_at)
    VALUES(?,?,?,?,?,?,?)`).bind(job.id,row.recipient_id,request?.id||null,reason,Number(uncertain),job.leaseToken,at()).run();
  return finish(env,job,workerId,uncertain?'dead':'succeeded',{deliveryId:request?.id||null,skipped:reason,uncertain},uncertain?'An earlier email submission needs an operator review.':'');
}
async function saveEvent(env,event){
  const same=await env.DB.prepare('SELECT request_id,body_hash,provider_id,kind FROM commerce_email_events WHERE commerce_environment=? AND profile_id=? AND source=? AND source_id=?')
    .bind(event.environment,event.profile,event.source,event.sourceId).first();
  if(same){if(same.request_id!==event.requestId||same.body_hash!==event.hash||same.provider_id!==event.providerId||same.kind!==event.kind)conflict('This email callback already has different evidence');return {duplicate:true};}
  try{await env.DB.prepare(`INSERT INTO commerce_email_events(request_id,commerce_environment,profile_id,provider_id,source,source_id,attempt_id,kind,raw_json,body_hash,occurred_at,received_at)
    SELECT ?,?,?,?,?,?,?,?,?,?,?,? WHERE NOT EXISTS(SELECT 1 FROM commerce_email_events WHERE commerce_environment=? AND profile_id=? AND source=? AND source_id=?)`)
    .bind(event.requestId,event.environment,event.profile,event.providerId,event.source,event.sourceId,event.attemptId||null,event.kind,event.raw,event.hash,event.occurredAt,event.receivedAt,
      event.environment,event.profile,event.source,event.sourceId).run();}
  catch(error){if(/email_(event_invalid|provider_conflict|immutable)/.test(String(error)+' '+String(error.cause||'')))conflict('Email delivery evidence does not match the saved request');throw error;}
  // A concurrent duplicate can win the insert. It must still be identical.
  const saved=await env.DB.prepare('SELECT request_id,body_hash,provider_id,kind FROM commerce_email_events WHERE commerce_environment=? AND profile_id=? AND source=? AND source_id=?')
    .bind(event.environment,event.profile,event.source,event.sourceId).first();
  if(!saved||saved.request_id!==event.requestId||saved.body_hash!==event.hash||saved.provider_id!==event.providerId||saved.kind!==event.kind)conflict('Email delivery evidence changed while being saved');
  return {duplicate:false};
}

export async function deliverEmailJob(env,job,workerId,fetcher=fetch){
  const configuration=emailConfiguration(env);
  if(!configuration.ready||configuration.environment!==job.environment)fail('Email delivery is not connected',503);
  const row=await source(env,job);let request=await evidence(env,job);
  if(request?.provider_id)return finish(env,job,workerId,'succeeded',{deliveryId:request.id,submitted:true});
  const prior=await env.DB.prepare('SELECT reason,uncertain FROM commerce_email_skips WHERE job_id=?').bind(job.id).first();
  if(prior)return finish(env,job,workerId,prior.uncertain?'dead':'succeeded',{deliveryId:request?.id||null,skipped:prior.reason,uncertain:Boolean(prior.uncertain)},prior.uncertain?'An earlier email submission needs an operator review.':'');
  const reason=ineligible(row,configuration);if(reason)return skip(env,job,workerId,row,request,reason);
  const credentialHash=await emailCredentialHash(env,configuration);
  if(request&&(request.credential_hash!==credentialHash||request.profile_id!==configuration.profile))return skip(env,job,workerId,row,request,'provider_changed');
  if(request&&request.retry_until<=at())return skip(env,job,workerId,row,request,'retry_window_expired');
  let recipient;
  try{recipient=await verifiedEmailRecipient(env,row.actor_id,fetcher);}
  catch(error){if(error.code==='email_identity_invalid')return skip(env,job,workerId,row,request,'identity_invalid');throw error;}
  if(request&&request.recipient_email!==recipient.email)return skip(env,job,workerId,row,request,'address_changed');
  if(configuration.environment==='sandbox'&&!configuration.allowlist.includes(recipient.email))return skip(env,job,workerId,row,request,'test_recipient');
  const emailHash=await commerceHash({environment:job.environment,email:recipient.email});
  if(await env.DB.prepare(`SELECT x.id FROM commerce_email_requests x JOIN commerce_email_events e ON e.request_id=x.id
    WHERE x.commerce_environment=? AND x.email_hash=? AND e.kind IN ('bounced','complained','suppressed') LIMIT 1`).bind(job.environment,emailHash).first())return skip(env,job,workerId,row,request,'suppressed');
  if(!request){
    const id='email_'+(await commerceHash({recipient:row.recipient_id,environment:job.environment})).slice(0,32),created=at();
    const payload=notificationEmailPayload(configuration,row,recipient.email,id),key='ezkart_email/'+job.environment+'/'+row.recipient_id;
    await env.DB.prepare(`INSERT INTO commerce_email_requests(id,job_id,recipient_id,seller_id,commerce_environment,profile_id,credential_hash,source_lease_token,
      sender_email,recipient_email,email_hash,confirmed_at,verified_at,idempotency_key,request_json,request_hash,template_version,created_at,retry_until)
      VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,'notification-v1',?,?)`)
      .bind(id,job.id,row.recipient_id,job.sellerId,job.environment,configuration.profile,credentialHash,job.leaseToken,configuration.sender,recipient.email,emailHash,
        recipient.confirmedAt,recipient.verifiedAt,key,payload,await commerceHash(payload),created,new Date(Date.parse(created)+23*3600000).toISOString()).run();
    request={id,profile_id:configuration.profile,request_json:payload,idempotency_key:key};
  }
  const attemptId=job.id+':'+job.attempts;
  // This is the last database operation before the external side effect. Its
  // trigger rechecks the lease, membership, preferences, read state and blocks.
  try{await env.DB.prepare('INSERT INTO commerce_email_starts(attempt_id,request_id,lease_token,verified_at,created_at) VALUES(?,?,?,?,?)')
    .bind(attemptId,request.id,job.leaseToken,recipient.verifiedAt,at()).run();}
  catch(error){if(/email_start_forbidden/.test(String(error)+' '+String(error.cause||''))){
    const current=await source(env,job),saved=await evidence(env,job),changed=ineligible(current,configuration);
    if(saved?.provider_id)return finish(env,job,workerId,'succeeded',{deliveryId:saved.id,submitted:true});
    if(changed)return skip(env,job,workerId,current,saved,changed);
  }throw error;}
  const submitted=await sendResendEmail(env,request.request_json,request.idempotency_key,fetcher),received=at();
  await saveEvent(env,{requestId:request.id,environment:job.environment,profile:request.profile_id,providerId:submitted.id,source:'api',sourceId:attemptId,attemptId,
    kind:'accepted',raw:submitted.raw,hash:await commerceHash(submitted.raw),occurredAt:received,receivedAt:received});
  return finish(env,job,workerId,'succeeded',{deliveryId:request.id,submitted:true});
}

// Each invocation is deliberately bounded. Email has its own cron invocation so
// the in-app dispatcher and mail retries do not share the free D1 query budget.
export async function dispatchEmails(env,limit=2,fetcher=fetch){
  if(!Number.isSafeInteger(limit)||limit<1||limit>2)fail('Email batch is invalid');
  const configuration=emailConfiguration(env);if(!configuration.ready)return {processed:0,failed:0,held:true};
  const workerId='mail_'+crypto.randomUUID().replaceAll('-',''),environment=configuration.environment,out={processed:0,failed:0,held:false};
  for(const mode of ['reconcile','execute']){
    const remaining=limit-out.processed-out.failed;if(!remaining)break;
    const jobs=await claimCommerceJobs(env,{environment,workerId,kinds:['notification.send'],mode,limit:remaining,leaseSeconds:120});
    for(const job of jobs){try{const saved=await deliverEmailJob(env,job,workerId,fetcher);out[saved.state==='dead'?'failed':'processed']++;}
      catch(error){
        try{
          const saved=await evidence(env,job);
          if(saved?.provider_id&&error.code!=='email_evidence_conflict'){await finish(env,job,workerId,'succeeded',{deliveryId:saved.id,submitted:true});out.processed++;continue;}
          const noEffect=error.noEffect===true&&!saved?.started,permanent=['email_source_invalid','email_send_rejected','email_request_invalid','email_evidence_conflict'].includes(error.code);
          const outcome=permanent?'dead':noEffect&&error.retry?'retry':'uncertain';
          await finish(env,job,workerId,outcome,{deliveryId:saved?.id||null,noEffectConfirmed:noEffect,uncertain:!noEffect},
            permanent?'This email needs an operator review.':noEffect?'Recipient verification is temporarily unavailable. A retry is scheduled.':'The email submission result needs confirmation. Any retry uses the original request and key.');
        }catch{/* A lost database acknowledgement or expired lease is recovered by a later claimant. */}
        out.failed++;
      }
    }
  }
  return out;
}

export async function recordEmailWebhook(request,env,profile){
  if(!['test','production'].includes(env.APP_ENVIRONMENT))fail('Email callback environment is not configured',503);
  const event=await verifyResendWebhook(request,env,profile),payload=event.payload;
  const kinds={'email.sent':'sent','email.delivered':'delivered','email.delivery_delayed':'delayed','email.bounced':'bounced','email.complained':'complained','email.failed':'failed','email.suppressed':'suppressed'};
  if(!Object.hasOwn(kinds,payload.type))return {ignored:true};
  const data=payload.data,tags=data?.tags,environment=env.APP_ENVIRONMENT==='test'?'sandbox':'production';
  if(!tags||typeof tags!=='object'||Array.isArray(tags)||!/^email_[a-f0-9]{32}$/.test(tags.ezkart_delivery||''))return {ignored:true};
  if(tags.ezkart_profile!==profile||tags.ezkart_environment!==environment||!emailProviderId(data.email_id))fail('Email callback identity is invalid');
  if(typeof payload.created_at!=='string'||!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?(?:Z|[+-]\d{2}:\d{2})$/.test(payload.created_at)
    ||!Number.isFinite(Date.parse(payload.created_at))||Date.parse(payload.created_at)>Date.parse(event.receivedAt)+300000)fail('Email callback timestamp is invalid');
  const saved=await env.DB.prepare(`SELECT x.*,EXISTS(SELECT 1 FROM commerce_email_starts a WHERE a.request_id=x.id) AS started
    FROM commerce_email_requests x WHERE x.id=? AND x.profile_id=? AND x.commerce_environment=?`).bind(tags.ezkart_delivery,profile,environment).first();
  if(!saved)return {ignored:true};
  const original=JSON.parse(saved.request_json);
  if(!saved.started||Date.parse(payload.created_at)<Date.parse(saved.created_at)-300000||data.from!==original.from||data.subject!==original.subject||!Array.isArray(data.to)||data.to.length!==1||data.to[0]!==saved.recipient_email)fail('Email callback does not match the saved request',409);
  return {ignored:false,...await saveEvent(env,{requestId:saved.id,environment,profile,providerId:data.email_id,source:'webhook',sourceId:event.id,
    kind:kinds[payload.type],raw:event.raw,hash:event.hash,occurredAt:new Date(payload.created_at).toISOString(),receivedAt:event.receivedAt})};
}
