/* Private reusable font uploads. Published pages embed only the fonts they use. */
export const maximumFontBytes = 5 * 1024 * 1024;
const prefix = sellerId => `sellers/${sellerId}/builder-fonts/`;
const invalid = () => { throw new Response('Choose a valid WOFF2, WOFF, TTF, or OTF font.', {status:400}); };

export function decodeFontDataUrl(dataUrl) {
  if (typeof dataUrl !== 'string') invalid();
  if (dataUrl.length > Math.ceil(maximumFontBytes / 3) * 4 + 100) throw new Response('Choose a font up to 5 MB.', {status:413});
  const match = /^data:font\/(woff2|woff|ttf|otf);base64,([A-Za-z0-9+/]+={0,2})$/.exec(dataUrl);
  if (!match || match[2].length % 4) invalid();
  let bytes;
  try { bytes = Uint8Array.from(atob(match[2]), char => char.charCodeAt(0)); } catch { invalid(); }
  if (bytes.length > maximumFontBytes) throw new Response('Choose a font up to 5 MB.', {status:413});
  if (bytes.length < 12) invalid();
  const view = new DataView(bytes.buffer), signature = view.getUint32(0);
  const format = ({0x774f4632:'woff2',0x774f4646:'woff',0x00010000:'ttf',0x4f54544f:'otf'})[signature];
  if (!format || format !== match[1]) invalid();
  const compressed = format === 'woff' || format === 'woff2';
  let variable = false;
  if (compressed && bytes.length < 48) invalid();
  const tables = view.getUint16(compressed ? 12 : 4);
  if (!tables || tables > 256) invalid();
  if (compressed) {
    if (bytes.length < (format === 'woff2' ? 48 : 44) || view.getUint32(8) !== bytes.length || view.getUint16(14) !== 0) invalid();
    if (view.getUint32(16) < 12 || view.getUint32(16) > 50 * 1024 * 1024) invalid();
    if (![0x00010000,0x4f54544f].includes(view.getUint32(4))) invalid();
    if (format === 'woff2' && (!view.getUint32(20) || view.getUint32(20) > bytes.length - 48)) invalid();
  }
  if (format === 'woff2') {
    // WOFF2 exposes table tags without decompressing glyph data. fvar marks a
    // variable font; static faces keep normal browser weight synthesis.
    let offset = 48;
    const length = () => {
      let value = 0;
      for (let i = 0; i < 5; i++) {
        if (offset >= bytes.length) invalid();
        const byte = bytes[offset++];
        if ((!i && byte === 0x80) || value > 0x1ffffff) invalid();
        value = value * 128 + (byte & 127);
        if (!(byte & 128)) return value;
      }
      invalid();
    };
    for (let i = 0; i < tables; i++) {
      if (offset >= bytes.length) invalid();
      const flags = bytes[offset++], index = flags & 63, transform = flags >> 6;
      let tag = '';
      if (index === 63) {
        if (offset + 4 > bytes.length) invalid();
        tag = String.fromCharCode(...bytes.subarray(offset,offset+4)); offset += 4;
      }
      variable ||= index === 47 || tag === 'fvar';
      length();
      if ((index === 10 || index === 11 || tag === 'glyf' || tag === 'loca') ? transform !== 3 : transform !== 0) length();
    }
    if (offset + view.getUint32(20) > bytes.length) invalid();
  }
  if (format !== 'woff2') {
    const start = compressed ? 44 : 12, stride = compressed ? 20 : 16;
    if (start + tables * stride > bytes.length) invalid();
    for (let i = 0; i < tables; i++) {
      const row = start + i * stride, offset = view.getUint32(row + (compressed ? 4 : 8)), length = view.getUint32(row + (compressed ? 8 : 12));
      if (offset < start + tables * stride || offset + length > bytes.length) invalid();
      variable ||= view.getUint32(row) === 0x66766172;
    }
  }
  return {bytes,format,variable,mimeType:`font/${format}`};
}

const shape = object => ({
  id:object.key.split('/').at(-1), name:object.customMetadata?.name || 'My font',
  format:object.customMetadata?.format, mimeType:object.httpMetadata?.contentType,
  variable:object.customMetadata?.variable === 'true',
  sizeBytes:object.size, createdAt:object.uploaded.toISOString(),
});

export async function listBuilderFonts(env, seller) {
  const fonts = []; let cursor;
  do {
    const result = await env.PRIVATE_ASSETS.list({prefix:prefix(seller.id),limit:1000,include:['customMetadata','httpMetadata'],...(cursor ? {cursor} : {})});
    fonts.push(...result.objects.map(shape)); cursor = result.truncated ? result.cursor : undefined;
  } while (cursor);
  return fonts.sort((a,b) => b.createdAt.localeCompare(a.createdAt));
}

export async function saveBuilderFont(env, seller, payload) {
  if (seller.role === 'viewer') throw new Response('You do not have permission to upload fonts.', {status:403});
  const font = decodeFontDataUrl(payload.dataUrl);
  const hash = [...new Uint8Array(await crypto.subtle.digest('SHA-256',font.bytes))].map(n=>n.toString(16).padStart(2,'0')).join('');
  const key = prefix(seller.id) + 'font_' + hash;
  const existing = await env.PRIVATE_ASSETS.head(key);
  if (existing) return shape(existing);
  const name = String(payload.name || 'My font').replace(/[\u0000-\u001f\u007f]/g,'').trim().slice(0,120) || 'My font';
  return shape(await env.PRIVATE_ASSETS.put(key,font.bytes,{httpMetadata:{contentType:font.mimeType},customMetadata:{name,format:font.format,variable:String(font.variable)}}));
}

export async function serveBuilderFont(env, seller, id) {
  const object = await env.PRIVATE_ASSETS.get(prefix(seller.id)+id);
  if (!object) throw new Response('Font not found.', {status:404});
  return new Response(object.body,{headers:{'content-type':object.httpMetadata.contentType,'cache-control':'private, max-age=31536000, immutable','x-content-type-options':'nosniff','content-security-policy':"default-src 'none'; sandbox"}});
}
