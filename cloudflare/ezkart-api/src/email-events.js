const conflict=message=>{throw Object.assign(new Response(message,{status:409}),{code:'email_evidence_conflict'});};

export async function saveEmailEvent(env,event,purpose='transactional'){
  const table=purpose==='transactional'?'commerce_email_events':purpose==='campaign'?'commerce_campaign_email_events':null;
  if(!table)throw new Error('Unknown email evidence purpose');
  const same=await env.DB.prepare(`SELECT request_id,body_hash,provider_id,kind FROM ${table} WHERE commerce_environment=? AND profile_id=? AND source=? AND source_id=?`)
    .bind(event.environment,event.profile,event.source,event.sourceId).first();
  if(same){if(same.request_id!==event.requestId||same.body_hash!==event.hash||same.provider_id!==event.providerId||same.kind!==event.kind)conflict('This email callback already has different evidence');return {duplicate:true};}
  try{await env.DB.prepare(`INSERT INTO ${table}(request_id,commerce_environment,profile_id,provider_id,source,source_id,attempt_id,kind,raw_json,body_hash,occurred_at,received_at)
    SELECT ?,?,?,?,?,?,?,?,?,?,?,? WHERE NOT EXISTS(SELECT 1 FROM ${table} WHERE commerce_environment=? AND profile_id=? AND source=? AND source_id=?)`)
    .bind(event.requestId,event.environment,event.profile,event.providerId,event.source,event.sourceId,event.attemptId||null,event.kind,event.raw,event.hash,event.occurredAt,event.receivedAt,
      event.environment,event.profile,event.source,event.sourceId).run();}
  catch(error){if(/email_(event_invalid|provider_conflict|immutable)/.test(String(error)+' '+String(error.cause||'')))conflict('Email delivery evidence does not match the saved request');throw error;}
  // A concurrent duplicate can win the insert. It must still be identical.
  const saved=await env.DB.prepare(`SELECT request_id,body_hash,provider_id,kind FROM ${table} WHERE commerce_environment=? AND profile_id=? AND source=? AND source_id=?`)
    .bind(event.environment,event.profile,event.source,event.sourceId).first();
  if(!saved||saved.request_id!==event.requestId||saved.body_hash!==event.hash||saved.provider_id!==event.providerId||saved.kind!==event.kind)conflict('Email delivery evidence changed while being saved');
  return {duplicate:false};
}
