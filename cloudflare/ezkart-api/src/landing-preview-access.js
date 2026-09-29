// Shared preview credentials are kept outside editable/exportable page documents.
export const previewAccessPath = (seller, page) => `sellers/${seller}/landing-preview-access/${page}.json`;
export const previewSessionSeconds = 3600;
const encoder = new TextEncoder();
const hex = bytes => Array.from(bytes, byte => byte.toString(16).padStart(2, '0')).join('');
const random = () => hex(crypto.getRandomValues(new Uint8Array(16)));
const normalize = value => typeof value === 'string' ? value.trim().replace(/[-\s]/g, '').toLowerCase() : '';
const signingKey = secret => crypto.subtle.importKey('raw', encoder.encode(secret), {name:'HMAC', hash:'SHA-256'}, false, ['sign', 'verify']);
const signature = async (secret, message) => hex(new Uint8Array(await crypto.subtle.sign('HMAC', await signingKey(secret), encoder.encode(message))));
const message = (seller, page, expires, nonce) => JSON.stringify(['preview-v1', seller, page, expires, nonce]);

export async function readPreviewAccess(bucket, seller, page) {
  const object = await bucket.get(previewAccessPath(seller, page));
  return object ? {record: await object.json(), etag: object.etag} : null;
}

export async function managePreviewAccess(bucket, seller, page, rotate = false) {
  const current = await readPreviewAccess(bucket, seller, page);
  if (current && !rotate) return current.record;
  const record = {key: random().match(/.{8}/g).join('-'), secret: random(), updatedAt: new Date().toISOString()};
  const saved = await bucket.put(previewAccessPath(seller, page), JSON.stringify(record), {
    onlyIf: current ? {etagMatches: current.etag} : {etagDoesNotMatch:'*'},
    httpMetadata: {contentType:'application/json'},
  });
  if (!saved) {
    if (!rotate) return (await readPreviewAccess(bucket, seller, page))?.record;
    throw new Response('The preview key changed. Reload and try again.', {status:409});
  }
  return record;
}

export async function unlockPreview(record, seller, page, key, now = Date.now()) {
  if (!record || !/^[a-f0-9]{32}$/.test(normalize(key))) return null;
  // Compare fixed-size MACs without a character-by-character key comparison.
  const actual = await signature(record.secret, normalize(key));
  const expected = await signature(record.secret, normalize(record.key));
  let difference = 0;
  for (let index = 0; index < actual.length; index++) difference |= actual.charCodeAt(index) ^ expected.charCodeAt(index);
  if (difference) return null;
  const expires = Math.floor(now / 1000) + previewSessionSeconds;
  const nonce = random();
  return `${expires}.${nonce}.${await signature(record.secret, message(seller, page, expires, nonce))}`;
}

export async function validPreviewSession(record, seller, page, token, now = Date.now()) {
  if (!record || typeof token !== 'string' || !/^\d{10}\.[a-f0-9]{32}\.[a-f0-9]{64}$/.test(token)) return false;
  const [expiry, nonce, mac] = token.split('.');
  const expires = Number(expiry), seconds = Math.floor(now / 1000);
  if (expires <= seconds || expires > seconds + previewSessionSeconds) return false;
  return crypto.subtle.verify('HMAC', await signingKey(record.secret), Uint8Array.from(mac.match(/../g), byte => parseInt(byte,16)), encoder.encode(message(seller, page, expires, nonce)));
}
