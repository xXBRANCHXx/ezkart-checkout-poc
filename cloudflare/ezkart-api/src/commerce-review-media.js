import {commerceHash} from './commerce-orders.js';
import {reviewFail,reviewFields,reviewMediaId,reviewMode,reviewWritable,buyerReviewLine} from './commerce-reviews.js';
import {publicReviewSql} from './commerce-review-reads.js';

const maximum=1048576;
const error=()=>reviewFail('Choose a valid, still JPEG, PNG or WebP photo of up to 1 MB');
const join=chunks=>{const size=chunks.reduce((n,c)=>n+c.length,0),out=new Uint8Array(size);let offset=0;for(const c of chunks){out.set(c,offset);offset+=c.length;}return out;};
const text=bytes=>String.fromCharCode(...bytes);
const be32=(bytes,at)=>new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength).getUint32(at);
const le32=(bytes,at)=>new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength).getUint32(at,true);
const dimensions=(width,height)=>{if(!width||!height||width>4096||height>4096||width*height>16777216)error();};

// Remove metadata on the server too: browser re-encoding alone is not an
// authorization or privacy boundary. Only inert raster containers are served.
export function reviewImage(value){
  if(typeof value!=='string'||value.length>1400000)error();
  const match=/^data:(image\/(?:jpeg|png|webp));base64,([A-Za-z0-9+/]+={0,2})$/.exec(value);
  if(!match)error();
  let bytes;try{bytes=Uint8Array.from(atob(match[2]),c=>c.charCodeAt(0));}catch{error();}
  if(!bytes.length||bytes.length>maximum)error();
  const mime=match[1];
  if(mime==='image/png'){
    if(bytes.length<45||text(bytes.slice(0,8))!=='\x89PNG\r\n\x1a\n')error();
    const parts=[bytes.slice(0,8)];let offset=8,header=false,pixels=false,end=false;
    while(offset+12<=bytes.length){
      const size=be32(bytes,offset),type=text(bytes.slice(offset+4,offset+8));
      if(size>maximum||offset+size+12>bytes.length||!/^([A-Za-z]){4}$/.test(type)||(!header&&type!=='IHDR')||type==='acTL')error();
      if(type==='IHDR'){if(header||size!==13)error();header=true;dimensions(be32(bytes,offset+8),be32(bytes,offset+12));}
      if(type==='IDAT')pixels=true;
      if(type==='IEND'){if(size||!pixels)error();end=true;}
      // Keep decoding/color chunks; drop text, EXIF, profiles and unknown data.
      if(['IHDR','PLTE','IDAT','IEND','tRNS','gAMA','cHRM','sRGB'].includes(type))parts.push(bytes.slice(offset,offset+size+12));
      else if(type[0]===type[0].toUpperCase())error();
      offset+=size+12;if(end)break;
    }
    if(!end||offset!==bytes.length)error();
    bytes=join(parts);
  }else if(mime==='image/jpeg'){
    if(bytes.length<10||bytes[0]!==255||bytes[1]!==216||bytes.at(-2)!==255||bytes.at(-1)!==217)error();
    const parts=[bytes.slice(0,2)];let offset=2,sized=false,scan=false;
    while(offset<bytes.length-2){
      const start=offset;if(bytes[offset++]!==255)error();while(bytes[offset]===255)offset++;
      const marker=bytes[offset++];
      if(marker===0||marker===216||marker===217||offset+2>bytes.length)error();
      const length=bytes[offset]*256+bytes[offset+1];if(length<2||offset+length>bytes.length)error();
      if([192,193,194].includes(marker)){if(length<8)error();dimensions(bytes[offset+5]*256+bytes[offset+6],bytes[offset+3]*256+bytes[offset+4]);sized=true;}
      else if(marker>=195&&marker<=207&&![196,200,204].includes(marker))error();
      offset+=length;
      if(marker===218){
        if(!sized)error();scan=true;
        // Find the next real marker, preserving stuffed bytes and restart markers.
        while(offset<bytes.length-2){
          if(bytes[offset]===255&&bytes[offset+1]!==0&&!(bytes[offset+1]>=208&&bytes[offset+1]<=215))break;
          offset++;
        }
        parts.push(bytes.slice(start,offset));
      }else if(!(marker>=224&&marker<=239)&&marker!==254)parts.push(bytes.slice(start,offset));
    }
    if(!sized||!scan||offset!==bytes.length-2)error();
    parts.push(bytes.slice(-2));bytes=join(parts);
  }else{
    if(bytes.length<20||text(bytes.slice(0,4))!=='RIFF'||text(bytes.slice(8,12))!=='WEBP'||le32(bytes,4)+8!==bytes.length)error();
    const chunks=[];let offset=12,pixels=0,extended=false;
    while(offset+8<=bytes.length){
      const type=text(bytes.slice(offset,offset+4)),size=le32(bytes,offset+4),end=offset+8+size+(size%2);
      if(end>bytes.length||['ANIM','ANMF'].includes(type))error();
      const chunk=bytes.slice(offset,end),data=chunk.slice(8,8+size);
      if(type==='VP8X'){
        if(extended||pixels||size!==10||(data[0]&2))error();extended=true;
        dimensions(1+data[4]+(data[5]<<8)+(data[6]<<16),1+data[7]+(data[8]<<8)+(data[9]<<16));
        chunk[8]&=~(32|8|4);chunks.push(chunk);
      }else if(type==='VP8 '){
        if(size<10||data[3]!==157||data[4]!==1||data[5]!==42)error();
        dimensions((data[6]+(data[7]<<8))&16383,(data[8]+(data[9]<<8))&16383);pixels++;chunks.push(chunk);
      }else if(type==='VP8L'){
        if(size<5||data[0]!==47)error();dimensions(1+data[1]+((data[2]&63)<<8),1+(data[2]>>6)+(data[3]<<2)+((data[4]&15)<<10));pixels++;chunks.push(chunk);
      }else if(type==='ALPH')chunks.push(chunk);
      else if(!['EXIF','XMP ','ICCP'].includes(type))error();
      offset=end;
    }
    if(offset!==bytes.length||pixels!==1)error();
    bytes=join([bytes.slice(0,12),...chunks]);new DataView(bytes.buffer).setUint32(4,bytes.length-8,true);
  }
  return {bytes,mime};
}
async function mediaHash(bytes){return [...new Uint8Array(await crypto.subtle.digest('SHA-256',bytes))].map(b=>b.toString(16).padStart(2,'0')).join('');}
export async function uploadReviewPhoto(env,user,orderId,input){
  reviewWritable(env);reviewFields(input,['orderItemId','requestKey','dataUrl']);
  if(typeof input.requestKey!=='string'||!/^[a-f0-9]{32}$/.test(input.requestKey))reviewFail('Photo upload reference is invalid');
  const line=await buyerReviewLine(env,user,orderId,input.orderItemId);
  if(!line.eligible)reviewFail('Review photos open after verified payment and delivery',409);
  const {bytes,mime}=reviewImage(input.dataUrl),mode=reviewMode(env),hash=await mediaHash(bytes),now=new Date().toISOString();
  const previous=()=>env.DB.prepare('SELECT * FROM commerce_review_media WHERE owner_auth_user_id=? AND commerce_environment=? AND request_key=?').bind(user.id,mode,input.requestKey).first();
  let row=await previous();
  if(!row){
    const id='rphoto_'+(await commerceHash({mode,owner:user.id,key:input.requestKey})).slice(0,32);
    try{await env.DB.prepare(`INSERT INTO commerce_review_media(id,seller_id,commerce_environment,order_item_id,owner_auth_user_id,request_key,content_hash,r2_key,mime_type,size_bytes,created_at,expires_at)
      VALUES(?,?,?,?,?,?,?,?,?,?,?,?)`).bind(id,line.seller_id,mode,line.id,user.id,input.requestKey,hash,`review-photos/${mode}/${line.seller_id}/${id}`,mime,bytes.length,now,new Date(Date.now()+86400000).toISOString()).run();
    }catch(error){if(!await previous()){if((String(error)+' '+String(error.cause)).includes('review_photo_rate'))reviewFail('You can upload up to 30 review photos per hour. Try again later.',429);throw error;}}
    row=await previous();
  }
  if(row.content_hash!==hash||row.mime_type!==mime||row.order_item_id!==line.id)reviewFail('This upload reference was used for another photo',409);
  if(row.state==='deleting'||(row.expires_at<=now&&!await env.DB.prepare('SELECT media_id FROM commerce_review_media_links WHERE media_id=?').bind(row.id).first()))reviewFail('This photo upload expired. Upload it again.',410);
  if(row.state==='uploading'){
    await env.PRIVATE_ASSETS.put(row.r2_key,bytes,{httpMetadata:{contentType:mime}});
    const updated=await env.DB.prepare("UPDATE commerce_review_media SET state='ready' WHERE id=? AND state='uploading'").bind(row.id).run();
    if(updated.meta.changes!==1&&(await previous())?.state!=='ready')reviewFail('This photo upload expired. Upload it again.',410);
  }
  return {photo:{id:row.id,mime,size:bytes.length,expiresAt:row.expires_at}};
}
export async function reviewPhoto(env,actor,id,photoId){
  if(!reviewMediaId(photoId))reviewFail('Review photo not found',404);
  const mode=reviewMode(env),query=async()=>{
    if(actor.kind==='public')return env.DB.prepare(`SELECT m.* FROM commerce_review_media m JOIN commerce_review_media_links l ON l.media_id=m.id
      JOIN product_reviews r ON r.id=l.review_id JOIN products p ON p.id=r.product_id JOIN sellers s ON s.id=r.seller_id
      WHERE r.id=? AND m.id=? AND r.commerce_environment=? AND m.state='ready' AND ${publicReviewSql}
        AND p.status='active' AND s.status='active' AND EXISTS(SELECT 1 FROM json_each(r.media_json) WHERE value=m.id)`).bind(id,photoId,mode).first();
    if(actor.kind==='merchant')return env.DB.prepare(`SELECT m.* FROM commerce_review_media m JOIN commerce_review_media_links l ON l.media_id=m.id
      JOIN product_reviews r ON r.id=l.review_id WHERE r.id=? AND m.id=? AND r.seller_id=? AND r.commerce_environment=? AND m.state='ready'`)
      .bind(id,photoId,actor.sellerId,mode).first();
    return env.DB.prepare(`SELECT m.* FROM commerce_review_media m WHERE m.id=? AND m.owner_auth_user_id=? AND m.commerce_environment=? AND m.state='ready'
      AND (m.expires_at>? OR EXISTS(SELECT 1 FROM commerce_review_media_links l WHERE l.media_id=m.id))`).bind(photoId,actor.id,mode,new Date().toISOString()).first();
  };
  const row=await query();if(!row)reviewFail('Review photo not found',404);
  const object=await env.PRIVATE_ASSETS.get(row.r2_key);if(!object||!await query())reviewFail('Review photo not found',404);
  return new Response(object.body,{headers:{'content-type':row.mime_type,'cache-control':'no-store','x-content-type-options':'nosniff','content-security-policy':"default-src 'none'; sandbox",'content-length':String(object.size)}});
}
export async function cleanupReviewPhotos(env){
  const now=new Date().toISOString();
  const rows=await env.DB.prepare(`SELECT m.id,m.r2_key,m.expires_at FROM commerce_review_media m WHERE m.expires_at<=?
    AND NOT EXISTS(SELECT 1 FROM commerce_review_media_links l WHERE l.media_id=m.id) ORDER BY m.cleanup_at,m.expires_at,m.id LIMIT 100`).bind(now).all();
  let removed=0;
  for(const row of rows.results){
    const change=await env.DB.prepare(`UPDATE commerce_review_media SET state='deleting',cleanup_at=? WHERE id=?
      AND NOT EXISTS(SELECT 1 FROM commerce_review_media_links l WHERE l.media_id=commerce_review_media.id)`).bind(now,row.id).run();
    if(!change.meta.changes)continue;
    await env.PRIVATE_ASSETS.delete(row.r2_key);
    // Retain a tombstone and repeat deletion for 48 hours in case an interrupted
    // upload was completing when this photo expired.
    if(Date.parse(row.expires_at)<Date.now()-172800000)await env.DB.prepare("DELETE FROM commerce_review_media WHERE id=? AND state='deleting'").bind(row.id).run();
    removed++;
  }
  return removed;
}
