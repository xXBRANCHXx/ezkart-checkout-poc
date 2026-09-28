// Only fixed Cloudflare API/DoH endpoints are contacted. Customer DNS never
// supplies a fetch destination, origin, zone, provider identifier or credential.
const fail = message => { throw new Response(message, {status:503}); };
async function responseJSON(response) {
  if (!response.ok) fail('Domain provider is unavailable. Try checking again.');
  const reader = response.body?.getReader();
  if (!reader) fail('Domain provider returned an empty response.');
  const chunks = []; let size = 0;
  try { for (;;) { const {value,done} = await reader.read(); if (done) break; size += value.byteLength;
    if (size > 1000000) {await reader.cancel(); fail('Domain provider response is too large.');} chunks.push(value);
  }} finally {reader.releaseLock();}
  const bytes = new Uint8Array(size); let offset = 0;
  for (const chunk of chunks) {bytes.set(chunk,offset);offset += chunk.byteLength;}
  const text = new TextDecoder().decode(bytes);
  try { return JSON.parse(text); } catch { fail('Domain provider returned an invalid response.'); }
}
export async function dnsRecords(name, type, transport = fetch) {
  const url = new URL('https://cloudflare-dns.com/dns-query');
  url.searchParams.set('name', name); url.searchParams.set('type', type);
  const data = await responseJSON(await transport(url.href, {headers:{accept:'application/dns-json'}, redirect:'error', signal:AbortSignal.timeout(10000)}));
  if (data.Status === 3) return [];
  if (data.Status !== 0 || data.TC) fail('DNS lookup is unavailable. Try checking again.');
  const code = type === 'TXT' ? 16 : 5;
  return (data.Answer || []).filter(row => row.type === code && row.name?.toLowerCase().replace(/\.$/, '') === name.toLowerCase()).map(row => row.data);
}
export async function verifyDomainDNS(row, transport = fetch) {
  const [txt, cname] = await Promise.all([dnsRecords('_ezkart-domain.' + row.hostname, 'TXT', transport), dnsRecords(row.hostname, 'CNAME', transport)]);
  return {
    ownership: txt.some(value => value === '"' + row.challenge + '"'),
    route: cname.some(value => value.toLowerCase().replace(/\.$/, '') === row.cname_target),
  };
}
export async function cloudflareDomain(env, row, operation, transport = fetch) {
  if (!env.CUSTOM_DOMAIN_API_TOKEN || row.zone_id !== env.CUSTOM_DOMAIN_ZONE_ID) fail('Domain hosting needs operator configuration.');
  const root = 'https://api.cloudflare.com/client/v4/zones/' + row.zone_id + '/custom_hostnames';
  let url = root, method = 'GET', body;
  if (operation === 'create') {
    method = 'POST'; body = JSON.stringify({hostname:row.hostname, ssl:{method:'txt',type:'dv',settings:{min_tls_version:'1.2'}}, custom_metadata:{ezkart_domain_id:row.id}});
  } else if (operation === 'find') url += '?hostname=' + encodeURIComponent(row.hostname) + '&per_page=50';
  else {
    if (!/^[a-f0-9-]{36}$/.test(row.provider_id || '')) fail('Domain provider identity is unavailable.');
    url += '/' + row.provider_id;
    if (operation === 'delete') method = 'DELETE';
  }
  const response = await transport(url, {method, headers:{authorization:'Bearer ' + env.CUSTOM_DOMAIN_API_TOKEN,'content-type':'application/json'}, ...(body ? {body}:{}), redirect:'error',signal:AbortSignal.timeout(15000)});
  if (operation === 'delete' && response.status === 404) return null;
  const data = await responseJSON(response);
  if (!data.success) fail('Domain provider could not complete the request. Check again or contact support.');
  if (operation === 'delete') return null;
  const result = operation === 'find' ? data.result?.find(item => item.hostname === row.hostname && item.custom_metadata?.ezkart_domain_id === row.id) : data.result;
  if (!result && operation === 'find') return null;
  if (!result || result.hostname !== row.hostname || result.custom_metadata?.ezkart_domain_id !== row.id || !/^[a-f0-9-]{36}$/.test(result.id || '') || (row.provider_id && result.id !== row.provider_id) || result.custom_origin_server || result.custom_origin_sni)
    fail('Domain provider binding does not match this connection. Contact support.');
  const records = [];
  const ownership = result.ownership_verification;
  if (ownership?.type === 'txt' && typeof ownership.name === 'string' && typeof ownership.value === 'string') records.push({type:'TXT',name:ownership.name,value:ownership.value});
  for (const record of result.ssl?.validation_records || []) if (record.txt_name && record.txt_value) records.push({type:'TXT',name:record.txt_name,value:record.txt_value});
  return {id:result.id,status:result.status || 'pending',tls:result.ssl?.status || 'pending',records};
}
