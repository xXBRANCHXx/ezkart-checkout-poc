import {readLandingPageJson} from './landing-page-storage.js';
import {putJevPage} from './jev-page-state.js';

const prefix = 'landing-page-schedules/';
const pageKey = (seller, page) => `sellers/${seller}/landing-pages/${page}.json`;
const queueKey = (seller, page, schedule) => `${prefix}${schedule.at}/${seller}/${page}/${schedule.id}.json`;
const fail = (message, status = 409) => { throw new Response(message, {status}); };
export const scheduleSummary = schedule => schedule ? Object.fromEntries(['id','at','timezone','sourceUpdatedAt','status','publishedAt','error'].map(key => [key,schedule[key] ?? null])) : null;
const digest = async payload => [...new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(JSON.stringify(payload))))].map(byte => byte.toString(16).padStart(2,'0')).join('');

export function checkedScheduleTime(at, timezone, now = Date.now()) {
  if (typeof at !== 'string' || !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(at) || !Number.isFinite(Date.parse(at)) || new Date(at).toISOString() !== at) fail('Choose a valid publication date.', 400);
  try { if (typeof timezone !== 'string' || timezone.length > 80) throw Error(); new Intl.DateTimeFormat('en', {timeZone:timezone}).format(); }
  catch { fail('Choose a valid timezone.', 400); }
  if (Date.parse(at) < now + 60000 || Date.parse(at) > now + 366 * 86400000) fail('Choose a time at least one minute ahead and within 366 days.', 400);
  return {at, timezone};
}

const write = async (env, seller, page, object) => {
  page.updatedAt = new Date(Math.max(Date.now(),(Date.parse(page.updatedAt)||0)+1)).toISOString();
  const serialized = JSON.stringify(page);
  if (new TextEncoder().encode(serialized).byteLength > 16000000) fail('Landing page project is too large.',413);
  await putJevPage(env,seller,page.id,object.etag,serialized,{
    httpMetadata:{contentType:'application/json; charset=utf-8'},
    customMetadata:{...object.customMetadata,status:page.status,updatedAt:page.updatedAt,publishedAt:page.publishedAt || '',hasSchedule:'1'},
  });
  return page;
};

export async function changeLandingSchedule(env, seller, id, payload, validate) {
  const key = pageKey(seller,id);
  const object = await env.PRIVATE_ASSETS.head(key);
  if (!object) fail('Landing page not found.',404);
  const page = await readLandingPageJson(env.PRIVATE_ASSETS,key);
  if (!/^[a-f0-9-]{36}$/.test(payload.requestId || '') || !['create','reschedule','cancel'].includes(payload.action)) fail('Schedule request is invalid.',400);
  const requestDigest = await digest(payload);
  if (page.scheduleReceipt?.requestId === payload.requestId) {
    if (page.scheduleReceipt.digest !== requestDigest) fail('Use the original schedule request.');
    return page;
  }
  if (payload.sourceUpdatedAt !== page.updatedAt) fail('Your page changed. Reload its saved version before changing the schedule.');
  const old = page.scheduledPublication;
  if (payload.action !== 'create' && (!old || old.status !== 'pending' || payload.scheduleId !== old.id)) fail('The schedule changed or has already started. Refresh before continuing.');
  let next = null;
  if (payload.action !== 'cancel') {
    const time = checkedScheduleTime(payload.at,payload.timezone);
    if (payload.action === 'create') {
      const html = String(payload.html || '');
      const priceBaseline = await validate(seller,html,page.state);
      if (!Array.isArray(priceBaseline) || !priceBaseline.length) fail('The scheduled version has no verified prices. Schedule this version again before publishing.',422);
      next = {...time,id:payload.requestId,status:'pending',html,state:{preview:String(page.state?.preview || '')},priceBaseline,sourceUpdatedAt:page.updatedAt};
    } else next = {...old,...time,id:payload.requestId,status:'pending'};
    // This is a hint, written first. The project is authoritative: orphaned or
    // replaced hints can never publish a different version of a page.
    await env.PRIVATE_ASSETS.put(queueKey(seller,id,next),JSON.stringify({seller,id,scheduleId:next.id,at:next.at}),{httpMetadata:{contentType:'application/json'}});
  }
  page.scheduledPublication = next;
  page.scheduleReceipt = {requestId:payload.requestId,digest:requestDigest,action:payload.action,schedule:scheduleSummary(next)};
  return write(env,seller,page,object);
}

export async function publishDueLandingPages(env, validate, held, now = Date.now()) {
  const due = await env.PRIVATE_ASSETS.list({prefix,limit:10});
  let published = 0, failed = 0, attempted = 0, needsRetry = 0;
  for (const item of due.objects) {
    // ISO timestamps sort first, so future hints do not starve due work.
    const at = item.key.slice(prefix.length,prefix.length + 24);
    if (Date.parse(at) > now) break;
    try {
      const marker = await (await env.PRIVATE_ASSETS.get(item.key)).json();
      const key = pageKey(marker.seller,marker.id), object = await env.PRIVATE_ASSETS.head(key);
      if (!object) { await env.PRIVATE_ASSETS.delete(item.key); continue; }
      const page = await readLandingPageJson(env.PRIVATE_ASSETS,key), schedule = page.scheduledPublication;
      if (!schedule || schedule.id !== marker.scheduleId || schedule.status !== 'pending') { await env.PRIVATE_ASSETS.delete(item.key); continue; }
      if (Date.parse(schedule.at) > now) continue;
      if (++attempted > 3) break;
      let rejection = '';
      try {
        if (await held(env,marker.seller,marker.id)) fail('This page is held. Review its alert before publishing.');
        if (!Array.isArray(schedule.priceBaseline) || !schedule.priceBaseline.length) fail('The scheduled version has no verified prices. Schedule this version again before publishing.',422);
        const currentPrices = await validate(marker.seller,schedule.html,schedule.state);
        if (JSON.stringify(currentPrices) !== JSON.stringify(schedule.priceBaseline)) fail('Product or variant prices changed after scheduling. Review your page and schedule this version again.',422);
      } catch (error) {
        // Storage/provider outages retry later; confirmed stock/setup/hold
        // failures stay visible and require a fresh merchant decision.
        if (!(error instanceof Response) || error.status >= 500) throw error;
        rejection = await error.text();
      }
      if (rejection) {
        page.scheduledPublication = {...schedule,status:'failed',error:rejection};

      } else {
        page.status = 'published'; page.publishedHtml = schedule.html; page.publishedAt = new Date(now).toISOString();
        page.scheduledPublication = {...schedule,status:'published',publishedAt:page.publishedAt};
        delete page.scheduledPublication.html; delete page.scheduledPublication.state;

      }
      await write(env,marker.seller,page,object);
      if (rejection) failed++; else published++;
      await env.PRIVATE_ASSETS.delete(item.key);
    } catch { needsRetry++; /* A concurrent edit/cancel wins its revision; retry this hint. */ }
  }
  if (published || failed || needsRetry) console.info('landing_page_schedule',{published,failed,needsRetry});
  return {published,failed,needsRetry};
}
