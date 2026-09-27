import {commerceHash} from './commerce-orders.js';

export const digitalPartBytes=5*1024*1024;
export const digitalMaximumBytes=100*digitalPartBytes;
const iso=()=>new Date().toISOString();
const fail=(message,status=422,code='digital_file_invalid')=>{throw new Response(message,{status,headers:{'x-ezkart-error-code':code}});};
const membership=`EXISTS (SELECT 1 FROM seller_memberships m JOIN sellers s ON s.id=m.seller_id
  WHERE m.seller_id=? AND m.auth_user_id=? AND s.status='active' AND m.role IN ('owner','admin','editor'))`;
const uploadId=id=>{if(!/^dupl_[a-f0-9]{40}$/.test(id||''))fail('File upload not found.',404);return id;};
const digest=async bytes=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes)),b=>b.toString(16).padStart(2,'0')).join('');
const attachable=`u.state='ready' AND (strftime('%Y-%m-%dT%H:%M:%fZ',u.ready_at,'+7 days')>?
  OR EXISTS (SELECT 1 FROM digital_product_versions v WHERE v.upload_id=u.id))`;

function translate(error){
  if(error instanceof Response)throw error;
  const message=String(error?.message||'')+' '+String(error?.cause?.message||'');
  if(message.includes('digital_upload_limit'))fail('Finish an existing upload or try again later. Up to 10 uploads may be in progress, with 20 new uploads per hour and 100 per day.',429,'digital_upload_limit');
  if(message.includes('digital_membership_changed'))fail('Your store access changed. Reload this page.',403,'digital_membership_changed');
  if(message.includes('digital_file_in_use'))fail('This file has been published and must be retained for its product history.',409,'digital_file_in_use');
  if(/digital_file_(?:state|part|incomplete|unavailable)/.test(message))fail('The upload changed or is incomplete. Check its current progress before retrying.',409,'digital_file_conflict');
  throw error;
}

async function access(env,actor,write=false){
  const row=await env.DB.prepare(`SELECT m.role FROM seller_memberships m JOIN sellers s ON s.id=m.seller_id
    WHERE m.seller_id=? AND m.auth_user_id=? AND s.status='active'`).bind(actor.sellerId,actor.id).first();
  if(!row||write&&!['owner','admin','editor'].includes(row.role))fail('You do not have access to change these files.',403,'digital_membership_changed');
  return row;
}
async function rowFor(env,actor,id){
  uploadId(id);await access(env,actor);
  const row=await env.DB.prepare('SELECT * FROM digital_file_uploads WHERE seller_id=? AND id=?').bind(actor.sellerId,id).first();
  if(!row)fail('File upload not found.',404);
  return row;
}
function descriptor(raw){
  if(!raw||typeof raw!=='object'||Array.isArray(raw)||Object.keys(raw).some(k=>!['requestKey','filename','size','parts'].includes(k)))fail('Upload details are invalid.');
  if(!/^[A-Za-z0-9_-]{16,100}$/.test(raw.requestKey||''))fail('Upload request reference is invalid.');
  const name=typeof raw.filename==='string'?raw.filename.normalize('NFC').trim():'';
  if(!name||[...name].length>180||/[\x00-\x1f\x7f-\x9f/\\\u202a-\u202e\u2066-\u2069]/u.test(name)||/^\.+$/.test(name))fail('Use a filename of 1–180 characters without path separators or control characters.');
  if(!Number.isSafeInteger(raw.size)||raw.size<1||raw.size>digitalMaximumBytes)fail('Choose a non-empty file up to 500 MiB.');
  if(!Array.isArray(raw.parts)||raw.parts.length!==Math.ceil(raw.size/digitalPartBytes)||raw.parts.some(h=>typeof h!=='string'||!/^[a-f0-9]{64}$/.test(h)))fail('The file verification manifest is invalid.');
  return {requestKey:raw.requestKey,filename:name,size:raw.size,parts:raw.parts};
}

export async function digitalUpload(env,actor,id){
  const row=await rowFor(env,actor,id);
  const [parts,retained]=await env.DB.batch([
    env.DB.prepare('SELECT part_number,sha256,size_bytes FROM digital_file_parts WHERE upload_id=? ORDER BY part_number').bind(id),
    env.DB.prepare('SELECT 1 FROM digital_product_versions WHERE upload_id=? LIMIT 1').bind(id),
  ]);
  const expiresAt=row.state==='ready'?new Date(Date.parse(row.ready_at)+7*86400000).toISOString():row.expires_at;
  const member=await access(env,actor);
  return {id:row.id,sellerId:row.seller_id,filename:row.filename,size:row.size_bytes,state:row.state,partSize:digitalPartBytes,
    manifest:JSON.parse(row.manifest_json),parts:parts.results.map(p=>({number:p.part_number,sha256:p.sha256,size:p.size_bytes})),
    retained:Boolean(retained.results.length),expired:!retained.results.length&&expiresAt<=iso(),expiresAt:retained.results.length?null:expiresAt,createdAt:row.created_at,readyAt:row.ready_at,
    canEdit:member.role!=='viewer'};
}

async function prepareMultipart(env,actor,row){
  if(row.state!=='preparing')return;
  if(row.expires_at<=iso())fail('This upload expired. Select the file to start a new upload.',410,'digital_upload_expired');
  await access(env,actor,true);
  const multipart=await env.PRIVATE_ASSETS.createMultipartUpload(row.r2_key,{httpMetadata:{contentType:'application/octet-stream',cacheControl:'no-store'},
    customMetadata:{digitalUpload:row.id,requestHash:row.request_hash}});
  let disposition='unknown';
  try{
    const result=await env.DB.prepare(`UPDATE digital_file_uploads SET state='uploading',multipart_id=?
      WHERE id=? AND state='preparing' AND expires_at>? AND ${membership}`)
      .bind(multipart.uploadId,row.id,iso(),actor.sellerId,actor.id).run();
    disposition=result.meta.changes?'saved':'unused';
  }catch(error){
    // The D1 response may be lost after it committed. Never abort the winner.
    const current=await env.DB.prepare('SELECT multipart_id FROM digital_file_uploads WHERE id=?').bind(row.id).first();
    disposition=current?.multipart_id===multipart.uploadId?'saved':'unused';
    if(disposition==='unused')throw error;
  }finally{
    if(disposition==='unused')await multipart.abort();
  }
}

export async function beginDigitalUpload(env,actor,raw){
  await access(env,actor,true);
  const input=descriptor(raw),requestHash=await commerceHash(input),id='dupl_'+(await commerceHash({sellerId:actor.sellerId,key:input.requestKey})).slice(0,40),now=iso();
  let row=await env.DB.prepare('SELECT * FROM digital_file_uploads WHERE id=? AND seller_id=?').bind(id,actor.sellerId).first();
  if(!row){
    try{await env.DB.prepare(`INSERT INTO digital_file_uploads(id,seller_id,actor_auth_user_id,request_key,request_hash,filename,size_bytes,manifest_json,part_count,r2_key,state,created_at,expires_at)
      VALUES (?,?,?,?,?,?,?,?,?,?,'preparing',?,?)`).bind(id,actor.sellerId,actor.id,input.requestKey,requestHash,input.filename,input.size,JSON.stringify(input.parts),input.parts.length,
      `digital/${actor.sellerId}/${id}`,now,new Date(Date.parse(now)+86400000).toISOString()).run();}
    catch(error){row=await env.DB.prepare('SELECT * FROM digital_file_uploads WHERE id=? AND seller_id=?').bind(id,actor.sellerId).first();if(!row)translate(error);}
    row??=await rowFor(env,actor,id);
  }
  if(row.request_hash!==requestHash)fail('This upload reference belongs to a different file. Resume the original file or start a new upload.',409,'digital_replay_conflict');
  // Return the original reference even if an interrupted initiation expired;
  // the merchant can then discard it without creating a replacement request.
  if(row.state!=='preparing'||row.expires_at>iso())await prepareMultipart(env,actor,row);
  return digitalUpload(env,actor,id);
}

async function boundedBytes(request,maximum){
  if(!/^application\/octet-stream(?:;|$)/i.test(request.headers.get('content-type')||''))fail('Send the original file bytes.',415);
  const reader=request.body?.getReader();if(!reader)fail('The file part is empty.');
  const chunks=[];let size=0;
  try{while(true){const {done,value}=await reader.read();if(done)break;size+=value.length;
    if(size>maximum){await reader.cancel();fail('The file part exceeds its expected size.',413);}chunks.push(value);}}
  finally{reader.releaseLock();}
  if(size!==maximum)fail('The file part is incomplete. Retry this part.',422,'digital_part_size');
  const bytes=new Uint8Array(size);let offset=0;for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.length;}
  return bytes;
}

export async function uploadDigitalPart(env,actor,id,number,request){
  await access(env,actor,true);let row=await rowFor(env,actor,id);
  if(!Number.isInteger(number)||number<1||number>row.part_count)fail('File part number is invalid.');
  if(!['uploading','completing','ready'].includes(row.state))fail('This upload is no longer accepting parts.',410,'digital_upload_expired');
  if(row.state!=='ready'&&row.expires_at<=iso())fail('This upload expired. Start a new upload.',410,'digital_upload_expired');
  const size=Math.min(digitalPartBytes,row.size_bytes-(number-1)*digitalPartBytes),bytes=await boundedBytes(request,size),sha256=await digest(bytes);
  if(sha256!==JSON.parse(row.manifest_json)[number-1])fail('The selected file differs from the original upload. Select the same file to resume.',409,'digital_part_mismatch');
  const old=await env.DB.prepare('SELECT etag FROM digital_file_parts WHERE upload_id=? AND part_number=?').bind(id,number).first();
  if(old)return digitalUpload(env,actor,id);
  if(row.state!=='uploading')fail('This file is already being finalized.',409,'digital_file_conflict');
  let part;
  try{part=await env.PRIVATE_ASSETS.resumeMultipartUpload(row.r2_key,row.multipart_id).uploadPart(number,bytes);}
  catch(error){
    row=await rowFor(env,actor,id);
    if(['ready','completing'].includes(row.state)&&await env.DB.prepare('SELECT 1 FROM digital_file_parts WHERE upload_id=? AND part_number=?').bind(id,number).first())return digitalUpload(env,actor,id);
    throw error;
  }
  await access(env,actor,true);
  try{
    // Identical concurrent parts have identical bytes/ETags. A different part
    // cannot reach R2 because the immutable manifest is checked first.
    await env.DB.prepare(`INSERT INTO digital_file_parts(upload_id,part_number,sha256,size_bytes,etag,actor_auth_user_id,created_at)
      SELECT ?,?,?,?,?,?,? WHERE ${membership}
      AND NOT EXISTS (SELECT 1 FROM digital_file_parts WHERE upload_id=? AND part_number=?)`)
      .bind(id,number,sha256,size,part.etag,actor.id,iso(),actor.sellerId,actor.id,id,number).run();
  }catch(error){if(!await env.DB.prepare('SELECT 1 FROM digital_file_parts WHERE upload_id=? AND part_number=?').bind(id,number).first())translate(error);}
  await access(env,actor,true);
  return digitalUpload(env,actor,id);
}

export async function completeDigitalUpload(env,actor,id){
  await access(env,actor,true);let row=await rowFor(env,actor,id);
  if(row.state==='ready')return digitalUpload(env,actor,id);
  if(!['uploading','completing'].includes(row.state)||row.expires_at<=iso())fail('This upload expired or was cancelled. Select the file to start again.',410,'digital_upload_expired');
  try{await env.DB.prepare(`UPDATE digital_file_uploads SET state='completing' WHERE id=? AND state='uploading' AND expires_at>? AND ${membership}`)
    .bind(id,iso(),actor.sellerId,actor.id).run();}catch(error){translate(error);}
  row=await rowFor(env,actor,id);
  if(!['completing','ready'].includes(row.state))fail('This upload changed. Check its current state.',409,'digital_file_conflict');
  if(row.state==='ready')return digitalUpload(env,actor,id);
  const parts=(await env.DB.prepare('SELECT part_number,etag FROM digital_file_parts WHERE upload_id=? ORDER BY part_number').bind(id).all()).results;
  // A lost complete response is recoverable from this upload's unique key and
  // metadata. No other multipart upload is allowed to write parts to this key.
  let object=await env.PRIVATE_ASSETS.head(row.r2_key);
  if(!object){
    try{object=await env.PRIVATE_ASSETS.resumeMultipartUpload(row.r2_key,row.multipart_id).complete(parts.map(p=>({partNumber:p.part_number,etag:p.etag})));}
    catch(error){object=await env.PRIVATE_ASSETS.head(row.r2_key);if(!object)throw error;}
  }
  if(object.size!==row.size_bytes||object.customMetadata?.digitalUpload!==id||object.customMetadata?.requestHash!==row.request_hash)fail('The stored file could not be verified. Contact support with the upload reference.',503,'digital_integrity');
  await access(env,actor,true);
  await env.DB.prepare(`UPDATE digital_file_uploads SET state='ready',ready_at=?,completed_by_auth_user_id=? WHERE id=? AND state='completing' AND expires_at>? AND ${membership}`)
    .bind(iso(),actor.id,id,iso(),actor.sellerId,actor.id).run();
  const result=await digitalUpload(env,actor,id);
  if(result.state!=='ready')fail('The file was not published. Check its upload state before retrying.',409,'digital_file_conflict');
  return result;
}

async function purge(env,row){
  if(row.multipart_id){
    // Abort may report an already completed/aborted upload. Deleting the unique
    // object afterward covers completion racing with cancellation.
    try{await env.PRIVATE_ASSETS.resumeMultipartUpload(row.r2_key,row.multipart_id).abort();}
    catch(error){
      if(!/NoSuchUpload|does not exist|not found|already (?:aborted|completed)|10024/i.test(String(error)))throw error;
    }
  }
  await env.PRIVATE_ASSETS.delete(row.r2_key);
  await env.DB.prepare("UPDATE digital_file_uploads SET state='deleted',deleted_at=? WHERE id=? AND state='deleting'").bind(iso(),row.id).run();
}
export async function cancelDigitalUpload(env,actor,id){
  await access(env,actor,true);let row=await rowFor(env,actor,id);
  if(row.state==='deleted')return digitalUpload(env,actor,id);
  try{await env.DB.prepare(`UPDATE digital_file_uploads SET state='deleting',cancelled_by_auth_user_id=? WHERE id=? AND state NOT IN ('deleting','deleted') AND ${membership}`)
    .bind(actor.id,id,actor.sellerId,actor.id).run();}catch(error){translate(error);}
  row=await rowFor(env,actor,id);
  if(row.state==='deleting')await purge(env,row);
  return digitalUpload(env,actor,id);
}
export async function cleanupDigitalUploads(env,now=iso()){
  const stale=new Date(Date.parse(now)-7*86400000).toISOString();
  const rows=(await env.DB.prepare(`SELECT u.* FROM digital_file_uploads u WHERE u.retained_at IS NULL AND
    ((u.state IN ('preparing','uploading','completing') AND u.expires_at<=?) OR u.state='deleting' OR (u.state='ready' AND u.ready_at<=?))
    AND NOT EXISTS (SELECT 1 FROM digital_product_versions v WHERE v.upload_id=u.id) ORDER BY u.expires_at,u.id LIMIT 5`).bind(now,stale).all()).results;
  let removed=0;
  for(const row of rows){
    const claimed=await env.DB.prepare(`UPDATE digital_file_uploads SET state='deleting' WHERE id=? AND state!='deleted'
      AND NOT EXISTS (SELECT 1 FROM digital_product_versions WHERE upload_id=?)`).bind(row.id,row.id).run();
    if(claimed.meta.changes){await purge(env,row);removed++;}
  }
  return {removed};
}

export async function readyDigitalUpload(env,sellerId,id){
  if(!id)fail('Upload and verify the private product file before publishing.',409,'digital_file_unavailable');
  uploadId(id);
  const row=await env.DB.prepare(`SELECT u.* FROM digital_file_uploads u WHERE u.seller_id=? AND u.id=? AND ${attachable}`).bind(sellerId,id,iso()).first();
  if(!row)fail('Upload and verify the private product file before publishing.',409,'digital_file_unavailable');
  return row;
}
export function digitalVersionStatements(env,sellerId,actorId,productId,upload,now){
  if(!upload)return [env.DB.prepare('DELETE FROM digital_product_files WHERE seller_id=? AND product_id=?').bind(sellerId,productId)];
  const id='dfile_'+crypto.randomUUID().replaceAll('-','');
  return [
    env.DB.prepare(`INSERT INTO digital_product_versions(id,seller_id,product_id,version,upload_id,actor_auth_user_id,created_at)
      SELECT ?,?,?,COALESCE((SELECT MAX(version)+1 FROM digital_product_versions WHERE seller_id=? AND product_id=?),1),?,?,?
      WHERE NOT EXISTS (SELECT 1 FROM digital_product_files f JOIN digital_product_versions v ON v.id=f.version_id WHERE f.seller_id=? AND f.product_id=? AND v.upload_id=?)`)
      .bind(id,sellerId,productId,sellerId,productId,upload.id,actorId,now,sellerId,productId,upload.id),
    env.DB.prepare(`INSERT INTO digital_product_files(seller_id,product_id,version_id) SELECT ?,?,id FROM digital_product_versions WHERE id=?
      ON CONFLICT(product_id) DO UPDATE SET version_id=excluded.version_id`).bind(sellerId,productId,id),
  ];
}
export const digitalCatalogSql=`SELECT f.product_id,v.id,v.version,u.id AS upload_id,u.filename,u.size_bytes,v.created_at
  FROM digital_product_files f JOIN digital_product_versions v ON v.id=f.version_id JOIN digital_file_uploads u ON u.id=v.upload_id
  WHERE f.seller_id=? AND u.state='ready'`;
export const digitalCatalogFile=row=>row?{id:row.id,version:row.version,uploadId:row.upload_id,filename:row.filename,size:row.size_bytes,createdAt:row.created_at}:null;

export async function digitalFileHistory(env,actor,productId,before=Number.MAX_SAFE_INTEGER){
  await access(env,actor);
  if(!/^[A-Za-z0-9][A-Za-z0-9_-]{0,99}$/.test(productId)||!Number.isSafeInteger(before)||before<1)fail('File history reference is invalid.');
  if(!await env.DB.prepare('SELECT 1 FROM products WHERE seller_id=? AND id=?').bind(actor.sellerId,productId).first())fail('Product not found.',404);
  const rows=(await env.DB.prepare(`SELECT v.id,v.version,v.upload_id,v.created_at,u.filename,u.size_bytes,COALESCE(NULLIF(a.display_name,''),'Store member') AS actor_name,
    EXISTS (SELECT 1 FROM digital_product_files f WHERE f.version_id=v.id) AS current
    FROM digital_product_versions v JOIN digital_file_uploads u ON u.id=v.upload_id LEFT JOIN app_users a ON a.auth_user_id=v.actor_auth_user_id WHERE v.seller_id=? AND v.product_id=? AND v.version<?
    ORDER BY v.version DESC LIMIT 21`).bind(actor.sellerId,productId,before).all()).results;
  return {items:rows.slice(0,20).map(r=>({...digitalCatalogFile(r),actorName:r.actor_name,current:Boolean(r.current)})),nextCursor:rows.length>20?rows[19].version:null};
}

export async function digitalMerchantFile(env,actor,id,request){
  const row=await rowFor(env,actor,id);await readyDigitalUpload(env,actor.sellerId,id);
  const rawRange=request.headers.get('range');let start=0,end=row.size_bytes-1,status=200;
  if(rawRange){
    const match=/^bytes=(\d*)-(\d*)$/.exec(rawRange);
    if(!match||!match[1]&&!match[2])fail('Use one valid file range.',416,'digital_range');
    if(!match[1]){const suffix=Number(match[2]);if(!Number.isSafeInteger(suffix)||suffix<1)fail('Invalid file range.',416,'digital_range');start=Math.max(0,row.size_bytes-suffix);}
    else{start=Number(match[1]);end=match[2]?Math.min(Number(match[2]),end):end;}
    if(!Number.isSafeInteger(start)||!Number.isSafeInteger(end)||start<0||start>=row.size_bytes||end<start)fail('The file range is outside this file.',416,'digital_range');
    status=206;
  }
  const object=await env.PRIVATE_ASSETS.get(row.r2_key,status===206?{range:{offset:start,length:end-start+1}}:undefined);
  if(!object?.body||object.size!==row.size_bytes||object.customMetadata?.digitalUpload!==id||object.customMetadata?.requestHash!==row.request_hash)fail('The stored file is unavailable. Contact support with the upload reference.',503,'digital_integrity');
  // Recheck after the storage await; a cancelled unpublished file or revoked
  // member must not receive bytes from an earlier authorization decision.
  try{await access(env,actor);await readyDigitalUpload(env,actor.sellerId,id);}
  catch(error){await object.body.cancel();throw error;}
  const ascii=row.filename.replace(/[^A-Za-z0-9._ -]/g,'_').replace(/^[. ]+|[. ]+$/g,'')||'download';
  const encoded=encodeURIComponent(row.filename).replace(/[!'()*]/g,c=>'%'+c.charCodeAt(0).toString(16).toUpperCase());
  if(request.method==='HEAD')await object.body.cancel();
  return new Response(request.method==='HEAD'?null:object.body,{status,headers:{'content-type':'application/octet-stream','content-length':String(end-start+1),
    'content-disposition':`attachment; filename="${ascii}"; filename*=UTF-8''${encoded}`,'cache-control':'private, no-store','x-content-type-options':'nosniff',
    'content-security-policy':"default-src 'none'; sandbox allow-downloads",'referrer-policy':'no-referrer','accept-ranges':'bytes',
    ...(status===206?{'content-range':`bytes ${start}-${end}/${row.size_bytes}`}:{})}});
}
