import {normalizeSocialHtml} from './landing-social-profiles.js';
import {jevPageHeld} from './jev-reviews.js';
import {sellerPageAddress} from './seller-page-address.js';
import {hostedLandingResponse} from './landing-page-hosting.js';
import {verifyDomainDNS, cloudflareDomain} from './custom-domain-provider.js';
const fail = (message,status=422) => {throw new Response(message,{status});};
const timestamp = () => new Date().toISOString();
const nonce = () => Array.from(crypto.getRandomValues(new Uint8Array(32)), b => b.toString(16).padStart(2,'0')).join('');
export function domainHostname(value) {
  if (typeof value !== 'string' || value !== value.trim() || value.length > 253) fail('Enter a public hostname, without a URL, port or path.');
  const hostname = value.toLowerCase();
  const labels = hostname.split('.');
  if (labels.length < 2 || labels.some(label => !/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(label)) || !/^[a-z]{2,63}$/.test(labels.at(-1))
    || /(?:^|\.)(?:localhost|local|internal|lan|home|invalid|test|example|onion|arpa)$/.test(hostname)
    || /(?:^|\.)(?:example\.(?:com|org|net)|ezkart\.(?:id|site)|workers\.dev|pages\.dev)$/.test(hostname)) fail('Use your own public domain. IP addresses and reserved domains are not supported.');
  return hostname;
}
function config(env) {
  if (!/^[a-f0-9]{32}$/.test(env.CUSTOM_DOMAIN_ZONE_ID || '') || !env.CUSTOM_DOMAIN_CNAME_TARGET || !env.CUSTOM_DOMAIN_API_HOSTS || !env.CUSTOM_DOMAIN_API_TOKEN)
    fail('Custom domain hosting needs operator setup. Your existing page address still works.',503);
  const target = env.CUSTOM_DOMAIN_CNAME_TARGET.toLowerCase();
  if (!/^[a-z0-9.-]+$/.test(target) || !target.includes('.')) fail('Custom domain hosting needs operator setup.',503);
  return target;
}
async function owner(env,seller,advanced=true) {
  if (seller.role !== 'owner') fail('Only the store owner can manage domains.',403);
  const current = await env.DB.prepare("SELECT plan FROM sellers WHERE id=? AND status='active'").bind(seller.id).first();
  if (!current) fail('Store not found.',404);
  if (advanced && current.plan !== 'advanced') fail('Enable Advanced Mode to connect a domain.',409);
}
async function publishedPage(env,sellerId,pageId) {
  const object = await env.PRIVATE_ASSETS.get(`sellers/${sellerId}/landing-pages/${pageId}.json`);
  const page = object ? await object.json() : null;
  if (!page || page.status !== 'published' || !page.publishedHtml) fail('Publish this landing page before connecting its domain.',409);
  return page;
}
const shape = row => ({id:row.id, hostname:row.hostname, pageId:row.page_id, publicPath:row.public_path, state:row.state==='active' && (!row.checked_at || Date.parse(row.checked_at)<Date.now()-86400000)?'needs_check':row.state,
  challengeExpiresAt:row.challenge_expires_at, checkedAt:row.checked_at, providerStatus:row.provider_status, tlsStatus:row.tls_status,
  dns:[{type:'TXT',name:'_ezkart-domain.'+row.hostname,value:row.challenge},{type:'CNAME',name:row.hostname,value:row.cname_target},...JSON.parse(row.validation_json)],
  providerPending:row.provider_state === 'creating'});
export async function listCustomDomains(env,seller) {
  const rows=await env.DB.prepare("SELECT * FROM custom_domains WHERE seller_id=? AND state!='disconnected' ORDER BY created_at DESC").bind(seller.id).all();
  let configured = true; try {config(env);} catch {configured=false;}
  return {domains:rows.results.map(shape),canEdit:seller.role==='owner',configured};
}
export async function enrollCustomDomain(env,seller,payload) {
  await owner(env,seller); const target=config(env), hostname=domainHostname(payload.hostname);
  if (hostname === target || env.CUSTOM_DOMAIN_API_HOSTS.split(',').map(s=>s.trim()).includes(hostname)) fail('Use your own customer domain.');
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(payload.pageId || '') || payload.pageId.length>48) fail('Choose a landing page.');
  await publishedPage(env,seller.id,payload.pageId);
  const address = await sellerPageAddress(env,seller), now=timestamp();
  // Only abandoned, never-provisioned challenges expire automatically.
  await env.DB.prepare("UPDATE custom_domains SET state='disconnected',updated_at=? WHERE hostname=? AND state='pending' AND provider_state='none' AND challenge_expires_at<?").bind(now,hostname,now).run();
  const id='dom_'+crypto.randomUUID().replaceAll('-','');
  try {
    await env.DB.prepare(`INSERT INTO custom_domains(id,seller_id,hostname,page_id,public_path,cname_target,zone_id,challenge,challenge_expires_at,created_at,updated_at)
      SELECT ?,?,?,?,?,?,?,?,?,?,? WHERE EXISTS(SELECT 1 FROM sellers WHERE id=? AND plan='advanced' AND status='active')
      AND (SELECT COUNT(*) FROM custom_domains WHERE seller_id=? AND state!='disconnected')<24`)
      .bind(id,seller.id,hostname,payload.pageId,`/${address.pageSlug}/shop/${payload.pageId}`,target,env.CUSTOM_DOMAIN_ZONE_ID,'ezkart-'+nonce(),new Date(Date.now()+86400000).toISOString(),now,now,seller.id,seller.id).run();
  } catch(error) {if (/UNIQUE/.test(error.message)) fail('This domain already has a connection. Disconnect it first or contact support.',409);throw error;}
  const row=await read(env,seller,id); return shape(row);
}
async function read(env,seller,id) {
  const row=await env.DB.prepare("SELECT * FROM custom_domains WHERE id=? AND seller_id=? AND state!='disconnected'").bind(id,seller.id).first();
  if (!row) fail('Domain connection not found.',404); return row;
}
export async function customDomainAction(env,seller,id,action,transport=fetch) {
  await owner(env,seller,action!=='disconnect'); let row=await read(env,seller,id); const now=timestamp();
  if (action==='disconnect') {
    // Public serving stops before any provider call, even when removal fails.
    await env.DB.prepare("UPDATE custom_domains SET state='disconnecting',ownership_verified_at=NULL,updated_at=? WHERE id=?").bind(now,id).run();
    if (!row.provider_id && row.provider_state==='creating') {
      const recovered=await cloudflareDomain(env,row,'find',transport);
      if (!recovered) fail('Serving is disabled. Provider creation is uncertain; support must reconcile it before releasing this hostname.',503);
      row.provider_id=recovered.id;
      await env.DB.prepare('UPDATE custom_domains SET provider_id=? WHERE id=?').bind(row.provider_id,id).run();
    }
    if (row.provider_id) await cloudflareDomain(env,row,'delete',transport);
    await env.DB.prepare("UPDATE custom_domains SET state='disconnected',updated_at=? WHERE id=?").bind(now,id).run();
    return {disconnected:true};
  }
  config(env);
  if (row.state==='disconnecting') fail('Finish disconnecting this domain first.',409);
  if (action==='renew') {
    await env.DB.prepare("UPDATE custom_domains SET challenge=?,challenge_expires_at=?,ownership_verified_at=NULL,state='pending',updated_at=? WHERE id=? AND state!='disconnecting'")
      .bind('ezkart-'+nonce(),new Date(Date.now()+86400000).toISOString(),now,id).run();
    return shape(await read(env,seller,id));
  }
  if (action!=='verify') fail('Choose a domain action.');
  if (row.state==='suspended' || !row.ownership_verified_at && row.challenge_expires_at<=now) fail('Generate a new ownership code, then update your TXT record.',409);
  await publishedPage(env,seller.id,row.page_id);
  await env.DB.prepare("UPDATE custom_domains SET state='pending' WHERE id=? AND challenge=? AND state='active'").bind(id,row.challenge).run();
  const dns=await verifyDomainDNS(row,transport);
  if (!dns.ownership || !dns.route) {
    await env.DB.prepare("UPDATE custom_domains SET state='pending',ownership_verified_at=NULL,checked_at=?,updated_at=? WHERE id=? AND challenge=? AND state IN ('pending','active')").bind(now,now,id,row.challenge).run();
    fail(!dns.ownership?'Ownership TXT record does not match. Check the DNS instructions.':'CNAME must point directly to the supplied Ezkart target. Disable DNS proxying or flattening.',409);
  }
  if (!row.provider_id) {
    if (row.provider_state==='creating') {
      const recovered=await cloudflareDomain(env,row,'find',transport);
      if (!recovered) fail('Provider creation is still uncertain. Check again later; support can reconcile it without issuing a duplicate request.',503);
      row.provider_id=recovered.id;
    } else {
      const claim=await env.DB.prepare("UPDATE custom_domains SET provider_state='creating',updated_at=? WHERE id=? AND provider_state='none' AND challenge=? AND state='pending' AND challenge_expires_at>? AND EXISTS(SELECT 1 FROM sellers WHERE id=? AND plan='advanced' AND status='active')").bind(now,id,row.challenge,now,seller.id).run();
      if (!claim.meta.changes) fail('Connection changed. Refresh and check again.',409);
      const created=await cloudflareDomain(env,row,'create',transport); row.provider_id=created.id;
    }
    await env.DB.prepare("UPDATE custom_domains SET provider_id=?,provider_state='created' WHERE id=?").bind(row.provider_id,id).run();
  }
  // Creation acknowledgement alone never activates a hostname.
  const provider=await cloudflareDomain(env,row,'get',transport);
  const state=provider.status==='active'&&provider.tls==='active'?'active':'pending';
  const saved=await env.DB.prepare(`UPDATE custom_domains SET state=?,ownership_verified_at=?,provider_status=?,tls_status=?,validation_json=?,checked_at=?,updated_at=?
    WHERE id=? AND challenge=? AND state IN ('pending','active') AND EXISTS(SELECT 1 FROM sellers WHERE id=? AND plan='advanced' AND status='active')`)
    .bind(state,now,provider.status,provider.tls,JSON.stringify(provider.records),now,now,id,row.challenge,seller.id).run();
  if (!saved.meta.changes) fail('Connection changed. Refresh and check again.',409);
  return shape(await read(env,seller,id));
}
export async function customDomainResponse(request,env) {
  // Enabling domain hosting makes the API host allowlist mandatory. A vanity
  // hostname can never reach authenticated API routes or another store's path.
  if (!env.CUSTOM_DOMAIN_API_HOSTS) return env.CUSTOM_DOMAIN_ZONE_ID ? new Response('Domain hosting is unavailable.',{status:503}) : null;
  const url=new URL(request.url), apiHosts=env.CUSTOM_DOMAIN_API_HOSTS.split(',').map(s=>s.trim().toLowerCase());
  if (apiHosts.includes(url.hostname)) return null;
  const absent=()=>new Response('Page not found.',{status:404,headers:{'cache-control':'no-store'}});
  if (!['GET','HEAD'].includes(request.method) || url.port || url.protocol!=='https:') return absent();
  let hostname; try {hostname=domainHostname(url.hostname);} catch {return absent();}
  const row=await env.DB.prepare(`SELECT d.* FROM custom_domains d JOIN sellers s ON s.id=d.seller_id
    WHERE d.hostname=? AND d.state='active' AND d.ownership_verified_at IS NOT NULL AND d.provider_status='active' AND d.tls_status='active'
    AND d.checked_at>? AND d.zone_id=? AND d.cname_target=? AND s.status='active' AND s.plan='advanced'`).bind(hostname,new Date(Date.now()-86400000).toISOString(),env.CUSTOM_DOMAIN_ZONE_ID,env.CUSTOM_DOMAIN_CNAME_TARGET).first();
  if (!row || !['/',row.public_path].includes(url.pathname) || await jevPageHeld(env,row.seller_id,row.page_id)) return absent();
  let page;try {page=await publishedPage(env,row.seller_id,row.page_id);} catch {return absent();}
  const response=hostedLandingResponse(request.method==='HEAD'?null:(await normalizeSocialHtml(page.publishedHtml)).html,{noindex:env.APP_ENVIRONMENT!=='production'});
  response.headers.set('x-ezkart-public-path',row.public_path);return response;
}

// Runs from the existing hourly housekeeping slot, never creates a provider
// resource. Five enrolled identities per invocation bound the provider budget.
export async function recheckCustomDomains(env,transport=fetch) {
  try {config(env);} catch {return {checked:0,unavailable:0,configured:false};}
  const due=await env.DB.prepare(`SELECT d.* FROM custom_domains d JOIN sellers s ON s.id=d.seller_id
    WHERE d.state IN ('active','pending') AND d.provider_id IS NOT NULL AND d.ownership_verified_at IS NOT NULL
    AND d.checked_at<? AND s.plan='advanced' AND s.status='active' ORDER BY d.checked_at LIMIT 5`)
    .bind(new Date(Date.now()-12*3600000).toISOString()).all();
  let unavailable=0;
  for (const row of due.results) {
    try {await customDomainAction(env,{id:row.seller_id,role:'owner'},row.id,'verify',transport);}
    catch {
      unavailable++;
      // Avoid a failing hostname starving the queue. It remains unavailable
      // until a fresh successful check; the challenge guards concurrent renew.
      await env.DB.prepare("UPDATE custom_domains SET state='pending',checked_at=? WHERE id=? AND challenge=? AND state IN ('active','pending')")
        .bind(timestamp(),row.id,row.challenge).run();
    }
  }
  return {checked:due.results.length,unavailable,configured:true};
}
