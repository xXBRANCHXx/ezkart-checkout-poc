/* Private, account-owned reusable uploads. Placement embeds a copy in the page. */
const prefix = sellerId => `sellers/${sellerId}/builder-assets/`;
const shape = object => ({
  id: object.key.split('/').at(-1),
  name: object.customMetadata?.name || 'Uploaded image',
  mimeType: object.httpMetadata?.contentType || 'image/webp',
  sizeBytes: object.size,
  createdAt: object.uploaded.toISOString(),
  source: 'Your uploads',
  sha256: object.customMetadata?.sha256 || '',
});

export async function listBuilderAssets(env, seller) {
  const assets = [];
  let cursor;
  do {
    const result = await env.PRIVATE_ASSETS.list({prefix:prefix(seller.id),limit:1000,include:['customMetadata','httpMetadata'],...(cursor ? {cursor} : {})});
    assets.push(...result.objects.map(shape));
    cursor = result.truncated ? result.cursor : undefined;
  } while(cursor);
  // Include images uploaded elsewhere in this account, with authenticated URLs.
  const media = await env.DB.prepare(`SELECT mu.id, mu.mime_type, mu.size_bytes, mu.created_at,
    (SELECT pm.alt_text FROM product_media pm WHERE pm.seller_id = mu.seller_id AND pm.id = mu.id LIMIT 1) AS name
    FROM media_uploads mu WHERE mu.seller_id = ? ORDER BY mu.created_at DESC`).bind(seller.id).all();
  assets.push(...(media.results || []).map(row => ({id:row.id,name:row.name || `Image ${row.id.slice(-6)}`,mimeType:row.mime_type,sizeBytes:row.size_bytes,createdAt:row.created_at,source:'Account uploads',media:true})));
  return assets.sort((a,b) => b.createdAt.localeCompare(a.createdAt));
}

export async function saveBuilderAsset(env, seller, payload, image) {
  if (seller.role === 'viewer') throw new Response('You do not have permission to upload files',{status:403});
  const sha256 = [...new Uint8Array(await crypto.subtle.digest('SHA-256',image.bytes))].map(n=>n.toString(16).padStart(2,'0')).join('');
  const id = `asset_${crypto.randomUUID().replaceAll('-','')}`;
  const name = String(payload.name || 'Uploaded image').replace(/[\u0000-\u001f]/g,'').trim().slice(0,160) || 'Uploaded image';
  const object = await env.PRIVATE_ASSETS.put(prefix(seller.id)+id,image.bytes,{
    httpMetadata:{contentType:image.mimeType},customMetadata:{name,sha256},
  });
  return {...shape(object),name,sha256,mimeType:image.mimeType};
}

export async function serveBuilderAsset(env, seller, id) {
  const object = await env.PRIVATE_ASSETS.get(prefix(seller.id)+id);
  if (!object) throw new Response('Upload not found',{status:404});
  return new Response(object.body,{headers:{'content-type':object.httpMetadata.contentType,'cache-control':'private, max-age=31536000, immutable','x-content-type-options':'nosniff','content-security-policy':"default-src 'none'; sandbox"}});
}
