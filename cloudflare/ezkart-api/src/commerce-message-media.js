import {commerceHash} from './commerce-orders.js';
import {currentCommerceEnvironment as mode} from './commerce-access.js';
import {reviewImage} from './commerce-review-media.js';
import {messageFail,messageFields,messageKey,messageWritable,messageConversation,messagePhotoId,messageError} from './commerce-messages.js';

export async function uploadMessagePhoto(env,actor,id,input){
  messageWritable(env,actor);messageFields(input,['requestKey','dataUrl']);messageKey(input.requestKey);
  const conversation=await messageConversation(env,actor,id);if(conversation.state==='blocked')messageFail('This conversation is blocked',409);
  const {bytes,mime}=reviewImage(input.dataUrl),hash=[...new Uint8Array(await crypto.subtle.digest('SHA-256',bytes))].map(b=>b.toString(16).padStart(2,'0')).join(''),now=new Date().toISOString();
  const read=()=>env.DB.prepare('SELECT * FROM commerce_message_media WHERE actor_kind=? AND actor_id=? AND commerce_environment=? AND request_key=?').bind(actor.kind,actor.id,mode(env),input.requestKey).first();
  let row=await read();
  if(!row){
    const photoId='mphoto_'+(await commerceHash({mode:mode(env),kind:actor.kind,actor:actor.id,key:input.requestKey})).slice(0,32);
    try{await env.DB.prepare(`INSERT INTO commerce_message_media(id,conversation_id,commerce_environment,actor_kind,actor_id,request_key,content_hash,r2_key,mime_type,size_bytes,created_at,expires_at)
      VALUES(?,?,?,?,?,?,?,?,?,?,?,?)`).bind(photoId,id,mode(env),actor.kind,actor.id,input.requestKey,hash,`message-photos/${mode(env)}/${conversation.seller_id}/${photoId}`,mime,bytes.length,now,new Date(Date.now()+86400000).toISOString()).run();}
    catch(error){if(!await read())messageError(error);}row=await read();
  }
  if(row.content_hash!==hash||row.mime_type!==mime||row.conversation_id!==id)messageFail('This upload reference was already used for another photo',409);
  if(row.state==='deleting'||row.expires_at<=now)messageFail('This photo upload expired. Upload it again.',410);
  if(row.state==='uploading'){
    await env.PRIVATE_ASSETS.put(row.r2_key,bytes,{httpMetadata:{contentType:mime}});
    await env.DB.prepare("UPDATE commerce_message_media SET state='ready' WHERE id=? AND state='uploading'").bind(row.id).run();
    if((await read())?.state!=='ready')messageFail('This photo upload expired. Upload it again.',410);
  }
  await messageConversation(env,actor,id);
  return {photo:{id:row.id,mime,size:bytes.length,expiresAt:row.expires_at}};
}
export async function messagePhoto(env,actor,id,photoId){
  if(!messagePhotoId(photoId))messageFail('Photo not found',404);
  await messageConversation(env,actor,id);
  const read=()=>env.DB.prepare(`SELECT m.* FROM commerce_message_media m WHERE m.id=? AND m.conversation_id=? AND m.commerce_environment=? AND m.state='ready'
    AND (EXISTS(SELECT 1 FROM commerce_message_media_links l WHERE l.media_id=m.id)
      OR (m.actor_kind=? AND m.actor_id=? AND m.expires_at>?))`).bind(photoId,id,mode(env),actor.kind,actor.id,new Date().toISOString()).first();
  const row=await read();if(!row)messageFail('Photo not found',404);
  const object=await env.PRIVATE_ASSETS.get(row.r2_key);await messageConversation(env,actor,id);if(!object||!await read())messageFail('Photo not found',404);
  return new Response(object.body,{headers:{'content-type':row.mime_type,'cache-control':'no-store','x-content-type-options':'nosniff','content-security-policy':"default-src 'none'; sandbox",'content-length':String(object.size)}});
}
export async function cleanupMessagePhotos(env){
  const now=new Date().toISOString(),rows=await env.DB.prepare(`SELECT m.id,m.r2_key,m.expires_at FROM commerce_message_media m WHERE expires_at<=?
    AND NOT EXISTS(SELECT 1 FROM commerce_message_media_links l WHERE l.media_id=m.id) ORDER BY cleanup_at,expires_at,id LIMIT 100`).bind(now).all();
  let removed=0;
  for(const row of rows.results){
    const changed=await env.DB.prepare(`UPDATE commerce_message_media SET state='deleting',cleanup_at=? WHERE id=? AND NOT EXISTS(SELECT 1 FROM commerce_message_media_links WHERE media_id=commerce_message_media.id)`).bind(now,row.id).run();
    if(!changed.meta.changes)continue;await env.PRIVATE_ASSETS.delete(row.r2_key);
    if(Date.parse(row.expires_at)<Date.now()-172800000)await env.DB.prepare("DELETE FROM commerce_message_media WHERE id=? AND state='deleting'").bind(row.id).run();removed++;
  }
  return removed;
}
