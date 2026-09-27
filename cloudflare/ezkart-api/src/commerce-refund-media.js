import {commerceHash,commerceStorageEnabled} from './commerce-orders.js';
import {currentCommerceEnvironment as mode} from './commerce-access.js';
import {refundDetail} from './commerce-refunds.js';

export const refundAttachmentBytes=5*1024*1024;
export const refundAttachmentJsonBytes=6994000;
const fail=(message,status=422)=>{throw new Response(message,{status});};
const hashBytes=async bytes=>[...new Uint8Array(await crypto.subtle.digest('SHA-256',bytes))].map(n=>n.toString(16).padStart(2,'0')).join('');
function originalFile(input){
  if(!input||typeof input!=='object'||Array.isArray(input)||Object.keys(input).some(k=>!['filename','caption','dataUrl'].includes(k)))fail('Evidence details are invalid.');
  const {filename,caption='',dataUrl}=input;
  if(typeof filename!=='string'||filename.length<1||filename.length>160||filename!==filename.trim()||/[\u0000-\u001f\u007f/\\<>:"|?*]/.test(filename)||/^\./.test(filename))fail('Use a filename without folders or special characters.');
  if(typeof caption!=='string'||caption.length>500||/[\u0000-\u0008\u000b-\u001f\u007f]/.test(caption))fail('Describe the file in up to 500 characters.');
  if(typeof dataUrl!=='string'||dataUrl.length>Math.ceil(refundAttachmentBytes/3)*4+100)fail('Choose a JPG, PNG, WebP or PDF file up to 5 MiB.',413);
  const comma=dataUrl.indexOf(','),head=dataUrl.slice(0,comma),encoded=dataUrl.slice(comma+1);
  const mime=/^data:(image\/jpeg|image\/png|image\/webp|application\/pdf);base64$/.exec(head)?.[1];
  if(!mime||!encoded||encoded.length%4||/[^A-Za-z0-9+/=]/.test(encoded)||!/^[^=]*={0,2}$/.test(encoded))fail('Choose a JPG, PNG, WebP or PDF file.');
  let binary;try{binary=atob(encoded);}catch{fail('The file encoding is invalid.');}
  if(!binary.length||binary.length>refundAttachmentBytes)fail('Files must be no larger than 5 MiB.',413);
  if(btoa(binary)!==encoded)fail('The file encoding is invalid.');
  const bytes=Uint8Array.from(binary,c=>c.charCodeAt(0)),starts=(...values)=>values.every((v,i)=>bytes[i]===v),end=bytes.slice(-12);
  const valid=mime==='image/png'?starts(137,80,78,71,13,10,26,10)&&bytes.length>=45&&[0,0,0,0,73,69,78,68,174,66,96,130].every((v,i)=>end[i]===v):
    mime==='image/jpeg'?starts(255,216,255)&&bytes.length>=12&&bytes.at(-2)===255&&bytes.at(-1)===217:
    mime==='image/webp'?starts(82,73,70,70)&&binary.slice(8,12)==='WEBP'&&bytes.length>=20&&new DataView(bytes.buffer).getUint32(4,true)+8===bytes.length:
    /^%PDF-[12]\.[0-9]/.test(binary.slice(0,8))&&/%%EOF[\t\r\n ]*$/.test(binary.slice(-1024));
  const extension=mime==='image/jpeg'?/\.jpe?g$/i:mime==='image/png'?/\.png$/i:mime==='image/webp'?/\.webp$/i:/\.pdf$/i;
  if(!valid||!extension.test(filename))fail('The original file must match its JPG, PNG, WebP or PDF filename.');
  return {filename,caption,mime,bytes};
}
function databaseFailure(error){
  const text=String(error)+' '+String(error?.cause||'');
  if(text.includes('refund_actor_forbidden'))fail('Your access to this refund changed. Reload this page.',403);
  if(text.includes('refund_attachment_limit'))fail('Each side can attach up to 10 files to this request. Retry an original upload or use another existing file.',409);
  if(text.includes('refund_attachment_rate'))fail('You can add up to 20 evidence files per hour. Try again later.',429);
  throw error;
}
async function verifiedObject(env,row){
  const object=await env.PRIVATE_ASSETS.get(row.r2_key);
  if(!object)return null;
  if(object.size!==row.size_bytes)fail('The original evidence file needs a storage review.',503);
  const bytes=new Uint8Array(await object.arrayBuffer());
  if(await hashBytes(bytes)!==row.content_hash)fail('The original evidence file needs a storage review.',503);
  return bytes;
}
export async function uploadRefundAttachment(env,actor,id,input,expectedOrder=''){
  const detail=await refundDetail(env,actor,id,expectedOrder);
  if(!commerceStorageEnabled(env))fail('Refund evidence is not available yet.',503);
  if(!detail.canUploadEvidence)fail('Your account can view refund evidence but cannot add files.',403);
  const {filename,caption,mime,bytes}=originalFile(input),contentHash=await hashBytes(bytes);
  const requestHash=await commerceHash({filename,caption,mime,size:bytes.length,contentHash});
  const attachmentId='rattach_'+(await commerceHash({mode:mode(env),refund:id,actor:actor.kind,user:actor.id,requestHash})).slice(0,32);
  const read=()=>env.DB.prepare('SELECT * FROM commerce_refund_attachments WHERE id=? AND refund_id=? AND commerce_environment=?').bind(attachmentId,id,mode(env)).first();
  let row=await read();
  if(!row){
    const refund=await env.DB.prepare('SELECT seller_id FROM commerce_refunds WHERE id=?').bind(id).first(),now=new Date().toISOString();
    try{await env.DB.prepare(`INSERT INTO commerce_refund_attachments(id,refund_id,seller_id,commerce_environment,actor_kind,actor_auth_user_id,
      request_hash,content_hash,r2_key,filename,mime_type,size_bytes,caption,created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)`)
      .bind(attachmentId,id,refund.seller_id,mode(env),actor.kind,actor.id,requestHash,contentHash,`refund-evidence/${mode(env)}/${refund.seller_id}/${attachmentId}`,filename,mime,bytes.length,caption,now).run();}
    catch(error){if(!await read())databaseFailure(error);}row=await read();
  }
  if(row.request_hash!==requestHash||row.content_hash!==contentHash)fail('The saved evidence does not match this original file.',409);
  // The reservation precedes storage. Exact concurrent retries have identical
  // bytes and metadata; a stored original is verified and never replaced.
  const stored=await verifiedObject(env,row);
  if(row.state==='ready'&&!stored)fail('The original evidence file needs a storage review.',503);
  if(row.state==='uploading'){
    if(!stored)await env.PRIVATE_ASSETS.put(row.r2_key,bytes,{httpMetadata:{contentType:mime}});
    try{await env.DB.prepare("UPDATE commerce_refund_attachments SET state='ready',ready_at=? WHERE id=? AND state='uploading'").bind(new Date().toISOString(),row.id).run();}
    catch(error){databaseFailure(error);}
  }
  return refundDetail(env,actor,id,expectedOrder);
}
export async function refundAttachment(env,actor,id,attachmentId,expectedOrder=''){
  await refundDetail(env,actor,id,expectedOrder);
  const row=await env.DB.prepare("SELECT * FROM commerce_refund_attachments WHERE id=? AND refund_id=? AND commerce_environment=? AND state='ready'").bind(attachmentId,id,mode(env)).first();
  if(!row)fail('Evidence file not found.',404);
  const bytes=await verifiedObject(env,row);if(!bytes)fail('The original evidence file needs a storage review.',503);
  await refundDetail(env,actor,id,expectedOrder);
  return new Response(bytes,{headers:{'content-type':row.mime_type,'content-length':String(bytes.length),'cache-control':'no-store',
    'content-disposition':`attachment; filename="evidence.${row.mime_type==='application/pdf'?'pdf':row.mime_type.split('/')[1]}"; filename*=UTF-8''${encodeURIComponent(row.filename).replaceAll("'",'%27')}`,
    'x-content-type-options':'nosniff','content-security-policy':"default-src 'none'; sandbox",'x-ezkart-file-sha256':row.content_hash}});
}
