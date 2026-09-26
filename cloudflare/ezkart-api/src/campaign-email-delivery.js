import {campaignMailLink} from './campaign-attribution.js';
import {commerceHash} from './commerce-orders.js';
import {claimCommerceJobs,finishCommerceJob} from './commerce-jobs.js';
import {campaignEmailConfiguration,emailCredentialHash,verifiedEmailRecipient,sendResendCampaignEmail,emailProviderId} from './email-provider.js';
import {campaignEmailPayload} from './campaign-email-template.js';
import {prepareCampaignUnsubscribe} from './campaign-unsubscribe.js';
import {saveEmailEvent} from './email-events.js';

const fail=(message,status=422)=>{throw new Response(message,{status});};
const invalid=()=>{throw Object.assign(new Error('The campaign recipient needs an operator review.'),{code:'campaign_source_invalid'});};
const at=()=>new Date().toISOString();
const finish=(env,job,workerId,outcome,result,error='')=>finishCommerceJob(env,job.id,{environment:job.environment,workerId,leaseToken:job.leaseToken,outcome,result,error});
async function source(env,job){
  if(job.kind!=='campaign.send'||!Number.isSafeInteger(job.data?.candidateId)||job.data.candidateId<1||!/^cpub_[a-f0-9]{32}$/.test(job.data?.publicationId||''))invalid();
  const row=await env.DB.prepare('SELECT * FROM commerce_campaign_delivery_sources WHERE candidate_id=? AND publication_id=?').bind(job.data.candidateId,job.data.publicationId).first();
  if(!row||row.seller_id!==job.sellerId||row.commerce_environment!==job.environment)invalid();return row;
}
const evidence=(env,job)=>env.DB.prepare(`SELECT x.*,b.provider_id,EXISTS(SELECT 1 FROM commerce_campaign_email_starts a WHERE a.request_id=x.id) AS started
  FROM commerce_campaign_email_requests x LEFT JOIN commerce_campaign_email_verified_bindings b ON b.request_id=x.id WHERE x.job_id=?`).bind(job.id).first();
function ineligible(row,configuration,now=Date.now()){
  if(row.cancelled)return 'cancelled';
  if(row.store_status!=='active')return 'store_closed';
  if(!row.publisher_access||!row.customer_access)return 'access_removed';
  if(!row.consent_allowed)return 'preference_off';
  if(row.current_consent_revision!==row.consent_revision)return 'consent_changed';
  if(JSON.parse(row.data_json).buttonLabel&&!row.current_shop_enabled)return 'shop_disabled';
  if(row.send_at<configuration.start)return 'before_activation';
  if(!Number.isFinite(Date.parse(row.send_at))||Date.parse(row.send_at)<now-86400000)return 'stale';
  return '';
}
const suppressed=(env,environment,emailHash)=>env.DB.prepare('SELECT email_hash FROM commerce_email_suppressions WHERE commerce_environment=? AND email_hash=? LIMIT 1').bind(environment,emailHash).first();
async function skip(env,job,workerId,row,request,reason){
  // Once a network start exists, a later permission change cannot establish
  // that the earlier request was never sent. Keep that uncertainty visible.
  const uncertain=Boolean(request?.started);
  await env.DB.prepare(`INSERT INTO commerce_campaign_email_skips(job_id,candidate_id,request_id,reason,uncertain,source_lease_token,created_at)
    VALUES(?,?,?,?,?,?,?)`).bind(job.id,row.candidate_id,request?.id||null,reason,Number(uncertain),job.leaseToken,at()).run();
  return finish(env,job,workerId,uncertain?'dead':'succeeded',{deliveryId:request?.id||null,skipped:reason,uncertain},uncertain?'An earlier campaign submission needs an operator review.':'');
}
async function changedBeforeStart(env,job,workerId,configuration){
  const row=await source(env,job),request=await evidence(env,job);
  if(request?.provider_id)return finish(env,job,workerId,'succeeded',{deliveryId:request.id,submitted:true});
  const reason=ineligible(row,configuration)||(request&&await suppressed(env,job.environment,request.email_hash)?'suppressed':'');
  return reason?skip(env,job,workerId,row,request,reason):null;
}
export async function deliverCampaignEmailJob(env,job,workerId,fetcher=fetch){
  const configuration=campaignEmailConfiguration(env);
  if(!configuration.ready||configuration.environment!==job.environment)fail('Campaign delivery is not connected',503);
  const row=await source(env,job);let request=await evidence(env,job);
  if(request?.provider_id)return finish(env,job,workerId,'succeeded',{deliveryId:request.id,submitted:true});
  const prior=await env.DB.prepare('SELECT reason,uncertain FROM commerce_campaign_email_skips WHERE job_id=?').bind(job.id).first();
  if(prior)return finish(env,job,workerId,prior.uncertain?'dead':'succeeded',{deliveryId:request?.id||null,skipped:prior.reason,uncertain:Boolean(prior.uncertain)},prior.uncertain?'An earlier campaign submission needs an operator review.':'');
  const reason=ineligible(row,configuration);if(reason)return skip(env,job,workerId,row,request,reason);
  if(row.send_at>at())throw Object.assign(new Error('This campaign is not due yet.'),{code:'campaign_not_due',noEffect:true,retry:true});
  const credentialHash=await emailCredentialHash(env,configuration);
  if(request&&(request.credential_hash!==credentialHash||request.profile_id!==configuration.profile))return skip(env,job,workerId,row,request,'provider_changed');
  if(request&&request.retry_until<=at())return skip(env,job,workerId,row,request,'retry_window_expired');
  let recipient;
  try{recipient=await verifiedEmailRecipient(env,row.auth_user_id,fetcher);}
  catch(error){if(error.code==='email_identity_invalid')return skip(env,job,workerId,row,request,'identity_invalid');throw error;}
  if(recipient.email!==row.email||request&&request.recipient_email!==recipient.email)return skip(env,job,workerId,row,request,'address_changed');
  if(configuration.environment==='sandbox'&&!configuration.allowlist.includes(recipient.email))return skip(env,job,workerId,row,request,'test_recipient');
  const emailHash=await commerceHash({environment:job.environment,email:recipient.email});
  if(await suppressed(env,job.environment,emailHash))return skip(env,job,workerId,row,request,'suppressed');
  if(!request){
    const id='campmail_'+(await commerceHash({candidate:row.candidate_id,publication:row.publication_id,environment:job.environment})).slice(0,32);
    const link=await prepareCampaignUnsubscribe(env,{sellerId:row.seller_id,authUserId:row.auth_user_id,email:recipient.email,reference:id,consentRevision:row.consent_revision});
    const storeLink=JSON.parse(row.data_json).buttonLabel?await campaignMailLink(env,row.publication_id):null;
    const payload=campaignEmailPayload(configuration,{sellerId:row.seller_id,storeName:row.store_name,shopEnabled:Boolean(row.shop_enabled),values:JSON.parse(row.data_json)},recipient.email,id,link.url,storeLink);
    const created=at(),key='ezkart_campaign/'+job.environment+'/'+id;
    try{await env.DB.batch([link.statement,env.DB.prepare(`INSERT INTO commerce_campaign_email_requests(id,job_id,candidate_id,seller_id,commerce_environment,profile_id,credential_hash,source_lease_token,
      sender_email,recipient_email,email_hash,confirmed_at,verified_at,unsubscribe_hash,idempotency_key,request_json,request_hash,template_version,created_at,retry_until)
      VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,'campaign-v1',?,?)`)
      .bind(id,job.id,row.candidate_id,job.sellerId,job.environment,configuration.profile,credentialHash,job.leaseToken,configuration.sender,recipient.email,emailHash,
        recipient.confirmedAt,recipient.verifiedAt,link.tokenHash,key,payload,await commerceHash(payload),created,new Date(Date.parse(created)+23*3600000).toISOString())]);}
    catch(error){
      const changed=await changedBeforeStart(env,job,workerId,configuration);if(changed)return changed;throw error;
    }
    request={id,profile_id:configuration.profile,request_json:payload,idempotency_key:key};
  }
  const attemptId=job.id+':'+job.attempts;
  // Last operation before POST: the database checks fresh consent/ownership,
  // schedule, suppression and the live lease together with the start receipt.
  try{await env.DB.prepare('INSERT INTO commerce_campaign_email_starts(attempt_id,request_id,lease_token,verified_at,created_at) VALUES(?,?,?,?,?)')
    .bind(attemptId,request.id,job.leaseToken,recipient.verifiedAt,at()).run();}
  catch(error){
    if(/campaign_email_start_forbidden/.test(String(error)+' '+String(error.cause||''))){const changed=await changedBeforeStart(env,job,workerId,configuration);if(changed)return changed;}
    throw error;
  }
  const submitted=await sendResendCampaignEmail(env,request.request_json,request.idempotency_key,fetcher),received=at();
  await saveEmailEvent(env,{requestId:request.id,environment:job.environment,profile:request.profile_id,providerId:submitted.id,source:'api',sourceId:attemptId,attemptId,
    kind:'accepted',raw:submitted.raw,hash:await commerceHash(submitted.raw),occurredAt:received,receivedAt:received},'campaign');
  return finish(env,job,workerId,'succeeded',{deliveryId:request.id,submitted:true});
}

// Separate bounded invocations keep campaign work within the D1 query budget.
export async function dispatchCampaignEmails(env,limit=2,fetcher=fetch){
  if(!Number.isSafeInteger(limit)||limit<1||limit>2)fail('Campaign batch is invalid');
  const configuration=campaignEmailConfiguration(env);if(!configuration.ready)return {processed:0,failed:0,held:true};
  const workerId='campaign_'+crypto.randomUUID().replaceAll('-',''),environment=configuration.environment,out={processed:0,failed:0,held:false};
  for(const mode of ['reconcile','execute']){
    const remaining=limit-out.processed-out.failed;if(!remaining)break;
    const jobs=await claimCommerceJobs(env,{environment,workerId,kinds:['campaign.send'],mode,limit:remaining,leaseSeconds:120});
    for(const job of jobs){try{const saved=await deliverCampaignEmailJob(env,job,workerId,fetcher);out[saved.state==='dead'?'failed':'processed']++;}
      catch(error){
        try{
          const saved=await evidence(env,job);
          if(saved?.provider_id&&error.code!=='email_evidence_conflict'){await finish(env,job,workerId,'succeeded',{deliveryId:saved.id,submitted:true});out.processed++;continue;}
          const noEffect=error.noEffect===true&&!saved?.started,permanent=['campaign_source_invalid','email_send_rejected','email_request_invalid','email_evidence_conflict'].includes(error.code);
          const outcome=permanent?'dead':noEffect&&error.retry?'retry':'uncertain';
          await finish(env,job,workerId,outcome,{deliveryId:saved?.id||null,noEffectConfirmed:noEffect,uncertain:!noEffect,errorCode:typeof error.code==='string'?error.code:'campaign_internal_error'},
            permanent?'This campaign recipient needs an operator review.':noEffect?'Recipient verification is temporarily unavailable. A retry is scheduled.':'The campaign submission result needs confirmation. Any retry uses the original message and reference.');
        }catch{/* An expired lease or lost database acknowledgement is recovered by a later claimant. */}
        out.failed++;
      }
    }
  }
  return out;
}

// Only called after the common Resend entrypoint has verified the raw signature.
export async function recordCampaignEmailEvent(env,event,profile){
  const payload=event.payload,data=payload.data,tags=data?.tags,environment=env.APP_ENVIRONMENT==='test'?'sandbox':'production';
  const kinds={'email.sent':'sent','email.delivered':'delivered','email.delivery_delayed':'delayed','email.bounced':'bounced','email.complained':'complained','email.failed':'failed','email.suppressed':'suppressed'};
  if(!Object.hasOwn(kinds,payload.type))return {ignored:true};
  if(!tags||typeof tags!=='object'||Array.isArray(tags)||!/^campmail_[a-f0-9]{32}$/.test(tags.ezkart_delivery||'')||tags.ezkart_purpose!=='campaign'
    ||tags.ezkart_profile!==profile||tags.ezkart_environment!==environment||!emailProviderId(data.email_id))fail('Campaign callback identity is invalid');
  if(typeof payload.created_at!=='string'||!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?(?:Z|[+-]\d{2}:\d{2})$/.test(payload.created_at)
    ||!Number.isFinite(Date.parse(payload.created_at))||Date.parse(payload.created_at)>Date.parse(event.receivedAt)+300000)fail('Campaign callback timestamp is invalid');
  const saved=await env.DB.prepare(`SELECT x.*,EXISTS(SELECT 1 FROM commerce_campaign_email_starts a WHERE a.request_id=x.id) AS started
    FROM commerce_campaign_email_requests x WHERE x.id=? AND x.profile_id=? AND x.commerce_environment=?`).bind(tags.ezkart_delivery,profile,environment).first();
  if(!saved)return {ignored:true};const original=JSON.parse(saved.request_json);
  if(!saved.started||Date.parse(payload.created_at)<Date.parse(saved.created_at)-300000||data.from!==original.from||data.subject!==original.subject
    ||!Array.isArray(data.to)||data.to.length!==1||data.to[0]!==saved.recipient_email)fail('Campaign callback does not match the saved message',409);
  return {ignored:false,...await saveEmailEvent(env,{requestId:saved.id,environment,profile,providerId:data.email_id,source:'webhook',sourceId:event.id,
    kind:kinds[payload.type],raw:event.raw,hash:event.hash,occurredAt:new Date(payload.created_at).toISOString(),receivedAt:event.receivedAt},'campaign')};
}
