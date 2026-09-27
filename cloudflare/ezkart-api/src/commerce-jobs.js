import {commerceEnvironment, commerceHash} from './commerce-orders.js';
import {notificationSourceKinds} from './notification-policy.js';

const fail = (message, status = 422) => { throw new Response(message, {status}); };
const kinds = ['payment.create', 'shipment.create', 'shipment.cancel', 'shipment.refresh', ...notificationSourceKinds, 'notification.send', 'campaign.send', 'payout.create', 'wallet.register'];
const boundedNotificationKinds=[...notificationSourceKinds,'notification.send','campaign.send'];
const validId = value => typeof value === 'string' && /^[A-Za-z0-9_-]{3,100}$/.test(value);
const view = row => ({id: row.id, sellerId: row.seller_id, orderId: row.order_id, environment: row.commerce_environment,
  kind: row.kind, state: row.state, data: JSON.parse(row.payload_json), attempts: row.attempts,
  leaseToken: row.lease_token, leaseUntil: row.lease_until, mode: row.lease_mode,
  result: row.result_json ? JSON.parse(row.result_json) : null});

export async function claimCommerceJobs(env, input) {
  const environment = commerceEnvironment(env, input.environment);
  if (!validId(input.workerId)) fail('Worker identity is invalid');
  if (!Array.isArray(input.kinds) || !input.kinds.length || input.kinds.length > kinds.length || input.kinds.some(kind => !kinds.includes(kind))) fail('Job kinds are invalid');
  const mode = input.mode || 'execute';
  if (!['execute', 'reconcile'].includes(mode)) fail('Job mode is invalid');
  const orderId=input.orderId||'';
  if(typeof orderId!=='string'||(orderId&&!/^EZK-[SP]-[A-F0-9]{24}$/.test(orderId)))fail('Job order is invalid');
  const jobId=input.jobId||'';
  if(typeof jobId!=='string'||(jobId&&!validId(jobId)))fail('Job reference is invalid');
  const limit = input.limit ?? 5, seconds = input.leaseSeconds ?? 90;
  if (!Number.isInteger(limit) || limit < 1 || limit > 10 || !Number.isInteger(seconds) || seconds < 15 || seconds > 120) fail('Job lease is invalid');
  const now = new Date().toISOString(), until = new Date(Date.now() + seconds * 1000).toISOString();
  const token = crypto.randomUUID();
  const result = await env.DB.batch([
    env.DB.prepare(`UPDATE commerce_job_attempts SET finished_at = ?, outcome = 'uncertain', error = 'Worker lease expired'
      WHERE finished_at IS NULL AND EXISTS (SELECT 1 FROM commerce_jobs j WHERE j.id = commerce_job_attempts.job_id
        AND j.lease_token = commerce_job_attempts.lease_token AND j.commerce_environment = ?
        AND j.state = 'running' AND j.lease_until <= ?)`).bind(now, environment, now),
    env.DB.prepare(`UPDATE commerce_jobs SET state = CASE WHEN kind IN (SELECT value FROM json_each(?)) AND attempts>=maximum_attempts THEN 'dead' ELSE 'uncertain' END,
      last_error = 'Worker lease expired; review the saved result before retrying',
      lease_token = NULL, lease_owner = NULL, lease_until = NULL, lease_mode = NULL, updated_at = ?
      WHERE commerce_environment = ? AND state = 'running' AND lease_until <= ?`).bind(JSON.stringify(boundedNotificationKinds), now, environment, now),
    env.DB.prepare(`UPDATE commerce_jobs SET state = 'running', attempts = attempts + 1,
      lease_token = ?, lease_owner = ?, lease_until = ?, lease_mode = ?, completion_hash = NULL, updated_at = ?
      WHERE id IN (SELECT id FROM commerce_jobs WHERE commerce_environment = ?
        AND kind IN (SELECT value FROM json_each(?)) AND available_at <= ?
        AND ((? = 'execute' AND state IN ('queued', 'retry') AND attempts < maximum_attempts)
          OR (? = 'reconcile' AND state = 'uncertain' AND attempts < maximum_attempts))
        AND (?='' OR order_id=?)
        AND (?='' OR id=?)
        AND (?='reconcile' OR kind!='payment.create' OR EXISTS (SELECT 1 FROM orders o WHERE o.id=commerce_jobs.order_id AND o.checkout_state='creating' AND o.expires_at>?))
        AND (?='reconcile' OR kind!='shipment.create' OR EXISTS (SELECT 1 FROM commerce_shipments s JOIN orders o ON o.id=s.order_id
          WHERE s.id=json_extract(commerce_jobs.payload_json,'$.shipmentId') AND s.order_id=commerce_jobs.order_id
            AND (s.provider_id IS NOT NULL OR (o.checkout_state='paid' AND o.payment_review=0 AND o.fulfillment_review=0 AND s.state='queued'))))
        ORDER BY available_at, created_at, id LIMIT ?) RETURNING *`)
      .bind(token, input.workerId, until, mode, now, environment, JSON.stringify(input.kinds), now, mode, mode, orderId, orderId, jobId, jobId, mode, now, mode, limit),
    env.DB.prepare(`INSERT INTO commerce_job_attempts (id, job_id, attempt, lease_token, worker_id, mode, started_at)
      SELECT id || ':' || attempts, id, attempts, lease_token, lease_owner, lease_mode, ? FROM commerce_jobs
      WHERE lease_token = ? AND lease_owner = ? AND commerce_environment = ? AND state = 'running'`).bind(now, token, input.workerId, environment),
  ]);
  return result[2].results.map(view);
}

export async function finishCommerceJob(env, jobId, input) {
  const environment = commerceEnvironment(env, input.environment);
  if (!validId(input.workerId) || !validId(jobId) || !validId(input.leaseToken)) fail('Job identity is invalid');
  const outcomes = ['succeeded', 'retry', 'uncertain', 'dead'];
  if (!outcomes.includes(input.outcome)) fail('Job outcome is invalid');
  const result = input.result ?? {};
  if (!result || typeof result !== 'object' || Array.isArray(result) || JSON.stringify(result).length > 10000) fail('Job result is invalid');
  const error = input.error || '';
  if (typeof error !== 'string' || error.length > 500) fail('Job error is invalid');
  const hash = await commerceHash({outcome: input.outcome, result, error});
  const row = await env.DB.prepare('SELECT * FROM commerce_jobs WHERE id = ? AND commerce_environment = ?').bind(jobId, environment).first();
  if (!row) fail('Job not found', 404);
  if (row.lease_token !== input.leaseToken || row.lease_owner !== input.workerId) fail('This worker no longer owns the job', 409);
  if (row.completion_hash) {
    if (row.completion_hash !== hash) fail('This job lease already has a different result', 409);
    return view(row);
  }
  const now = new Date().toISOString();
  if (row.state !== 'running' || row.lease_until <= now) fail('This job lease has expired', 409);
  if (row.kind === 'payment.create' && input.outcome === 'succeeded') {
    const recorded = await env.DB.prepare(`SELECT order_id FROM commerce_payment_sessions WHERE order_id=?
      UNION ALL SELECT order_id FROM commerce_payment_captures WHERE order_id=? AND capture_kind='order_payment' LIMIT 1`).bind(row.order_id,row.order_id).first();
    if (!recorded) fail('Record the provider payment details on the order before completing this job', 409);
  }
  if(notificationSourceKinds.includes(row.kind)&&input.outcome==='succeeded'&&!await env.DB.prepare('SELECT id FROM commerce_notification_events WHERE job_id=?').bind(row.id).first()){
    fail('Record the notification and its recipients before completing this job',409);
  }
  if(row.kind==='notification.send'&&input.outcome==='succeeded'&&!await env.DB.prepare(`SELECT x.id FROM commerce_email_requests x JOIN commerce_email_verified_bindings b ON b.request_id=x.id WHERE x.job_id=?
    UNION ALL SELECT job_id FROM commerce_email_skips WHERE job_id=? AND uncertain=0 LIMIT 1`).bind(row.id,row.id).first()){
    fail('Record the email submission or a confirmed no-send decision before completing this job',409);
  }
  if(row.kind==='campaign.send'&&input.outcome==='succeeded'&&!await env.DB.prepare(`SELECT x.id FROM commerce_campaign_email_requests x JOIN commerce_campaign_email_verified_bindings b ON b.request_id=x.id WHERE x.job_id=?
    UNION ALL SELECT job_id FROM commerce_campaign_email_skips WHERE job_id=? AND uncertain=0 LIMIT 1`).bind(row.id,row.id).first()){
    fail('Record the campaign submission or a confirmed no-send decision before completing this job',409);
  }
  if(row.kind==='wallet.register'&&input.outcome==='succeeded'){
    const recorded=await env.DB.prepare(`SELECT p.enrollment_id FROM commerce_wallet_provider_profiles p JOIN commerce_wallet_enrollments e ON e.id=p.enrollment_id
      WHERE e.job_id=? AND e.commerce_environment=?`).bind(row.id,environment).first();
    if(!recorded)fail('Record the verified wallet account before completing this job',409);
  }
  if(row.kind==='wallet.register'&&input.outcome==='retry'){
    const bound=await env.DB.prepare(`SELECT b.enrollment_id FROM commerce_wallet_provider_bindings b JOIN commerce_wallet_enrollments e ON e.id=b.enrollment_id WHERE e.job_id=?`).bind(row.id).first();
    if(bound)fail('A bound wallet registration requires reconciliation before retrying',409);
  }
  if(row.kind==='payment.create'&&input.outcome==='retry'
    &&await env.DB.prepare('SELECT order_id FROM commerce_snap_payment_bindings WHERE job_id=?').bind(row.id).first()){
    fail('A dispatched SNAP payment requires reconciliation before retrying',409);
  }
  if(row.kind==='payment.create'&&input.outcome==='retry'
    &&await env.DB.prepare(`SELECT b.order_id FROM commerce_payment_route_bindings b WHERE b.job_id=?
      AND NOT EXISTS(SELECT 1 FROM commerce_payment_route_receipts r WHERE r.order_id=b.order_id)`).bind(row.id).first()){
    fail('An uncertain split rule requires reconciliation before retrying',409);
  }
  if(row.kind.startsWith('shipment.')&&input.outcome==='succeeded'){
    const shipmentId=JSON.parse(row.payload_json).shipmentId;
    const shipment=await env.DB.prepare('SELECT * FROM commerce_shipments WHERE id=? AND order_id=? AND commerce_environment=?').bind(shipmentId,row.order_id,environment).first();
    if(!shipment?.provider_id||shipment.state==='queued')fail('Record the verified courier result before completing this job',409);
    if(row.kind==='shipment.cancel'&&shipment.state!=='cancelled')fail('The courier has not confirmed cancellation',409);
    if(row.kind==='shipment.refresh'){
      const recorded=await env.DB.prepare("SELECT id FROM commerce_shipping_inbox WHERE shipment_id=? AND source='refresh' AND applied_at IS NOT NULL AND received_at>=? LIMIT 1").bind(shipmentId,row.updated_at).first();
      if(!recorded)fail('Record a current tracking response before completing this job',409);
    }
  }
  // Only a proven no-effect failure can enter ordinary retry. Network timeout,
  // missing response or a crashed worker requires a provider-status check.
  if (input.outcome === 'retry' && result.noEffectConfirmed !== true) fail('Confirm the provider performed no action before retrying', 409);
  const exhausted = row.attempts >= row.maximum_attempts && (input.outcome === 'retry' || (input.outcome === 'uncertain' && boundedNotificationKinds.includes(row.kind)));
  const state = exhausted ? 'dead' : input.outcome;
  const delay = state === 'retry' ? Math.min(3600, 15 * 2 ** Math.min(row.attempts - 1, 8)) : state === 'uncertain' ? 60 : 0;
  const available = new Date(Date.now() + delay * 1000).toISOString();
  const saved = await env.DB.batch([env.DB.prepare(`UPDATE commerce_jobs SET state = ?, result_json = ?, completion_hash = ?,
    last_error = ?, available_at = ?, updated_at = ? WHERE id = ? AND commerce_environment = ?
    AND state = 'running' AND lease_token = ? AND lease_owner = ? AND lease_until > ? AND completion_hash IS NULL RETURNING *`)
    .bind(state, JSON.stringify(result), hash, error, available, now, jobId, environment, input.leaseToken, input.workerId, now),
    env.DB.prepare(`UPDATE commerce_job_attempts SET finished_at = ?, outcome = ?, result_json = ?, error = ?
      WHERE job_id = ? AND lease_token = ? AND worker_id = ? AND finished_at IS NULL
      AND EXISTS (SELECT 1 FROM commerce_jobs WHERE id = ? AND commerce_environment = ? AND lease_token = ? AND completion_hash = ?)`)
      .bind(now, state, JSON.stringify(result), error, jobId, input.leaseToken, input.workerId, jobId, environment, input.leaseToken, hash),
  ]);
  const updated = saved[0];
  if (!updated.results.length) {
    const current = await env.DB.prepare('SELECT * FROM commerce_jobs WHERE id = ? AND commerce_environment = ?').bind(jobId, environment).first();
    if (current?.lease_token === input.leaseToken && current.lease_owner === input.workerId && current.completion_hash === hash) return view(current);
    fail('This job changed while its result was being saved', 409);
  }
  return view(updated.results[0]);
}
