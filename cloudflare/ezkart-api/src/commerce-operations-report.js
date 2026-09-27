// Aggregate inspection only: no leases, acknowledgements, retries or provider calls.
const emailAttention = namespace => `(SELECT COUNT(*) FROM ${namespace}_requests x
  JOIN commerce_jobs j ON j.id=x.job_id LEFT JOIN ${namespace}_verified_bindings b ON b.request_id=x.id
  WHERE x.commerce_environment=(SELECT environment FROM scope) AND (
    j.state IN ('dead','uncertain','retry')
    OR (b.created_at<strftime('%Y-%m-%dT%H:%M:%fZ',(SELECT observed_at FROM scope),'-15 minutes')
      AND NOT EXISTS(SELECT 1 FROM ${namespace}_delivery_evidence e WHERE e.request_id=x.id
        AND e.kind IN ('delivered','bounced','complained','failed','suppressed')))
    OR EXISTS(SELECT 1 FROM ${namespace}_delivery_evidence e WHERE e.request_id=x.id
      AND e.kind IN ('bounced','complained','failed','suppressed'))))`;

export function commerceOperationsStatement(environment, now) {
  if (!['sandbox','production'].includes(environment)) throw Error('Inspection environment is invalid.');
  if (typeof now !== 'string' || !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(now) || !Number.isFinite(Date.parse(now)) || new Date(now).toISOString() !== now) throw Error('Inspection time is invalid.');
  return `WITH scope AS (SELECT '${environment}' AS environment,'${now}' AS observed_at),
    jobs AS (SELECT *,CASE WHEN kind='campaign.send' AND state='dead' AND attempts=0
      AND json_extract(result_json,'$.cancelled')=1 AND json_extract(result_json,'$.noEffectConfirmed')=1
      THEN 1 ELSE 0 END AS intentionally_cancelled FROM commerce_jobs WHERE commerce_environment=(SELECT environment FROM scope)),
    journals AS (SELECT * FROM commerce_financial_journals WHERE commerce_environment=(SELECT environment FROM scope)),
    orders_in_scope AS (SELECT * FROM orders WHERE commerce_version=1 AND commerce_environment=(SELECT environment FROM scope))
  SELECT json_object(
    'version',1,'observedAt',(SELECT observed_at FROM scope),'environment',(SELECT environment FROM scope),
    'jobs',json_object(
      'total',(SELECT COUNT(*) FROM jobs),
      'uncertain',(SELECT COUNT(*) FROM jobs WHERE state='uncertain'),
      'dead',(SELECT COUNT(*) FROM jobs WHERE state='dead' AND intentionally_cancelled=0),
      'cancelledBeforeSend',(SELECT COUNT(*) FROM jobs WHERE intentionally_cancelled=1),
      'expiredLeases',(SELECT COUNT(*) FROM jobs WHERE state='running' AND (lease_until IS NULL OR lease_until<=(SELECT observed_at FROM scope))),
      'overdue',(SELECT COUNT(*) FROM jobs WHERE state IN ('queued','retry') AND available_at<strftime('%Y-%m-%dT%H:%M:%fZ',(SELECT observed_at FROM scope),'-15 minutes'))),
    'orders',json_object(
      'total',(SELECT COUNT(*) FROM orders_in_scope),
      'paymentReview',(SELECT COUNT(*) FROM orders_in_scope WHERE payment_review=1),
      'stockReview',(SELECT COUNT(*) FROM orders_in_scope WHERE fulfillment_state='stock_review'),
      'shippingReview',(SELECT COUNT(*) FROM orders_in_scope WHERE fulfillment_review=1)),
    'accounting',json_object(
      'captures',(SELECT COUNT(*) FROM commerce_payment_captures WHERE commerce_environment=(SELECT environment FROM scope)),
      'journals',(SELECT COUNT(*) FROM journals),
      'unpostedCaptures',(SELECT COUNT(*) FROM commerce_payment_captures c WHERE c.commerce_environment=(SELECT environment FROM scope)
        AND NOT EXISTS(SELECT 1 FROM journals j WHERE j.kind='capture' AND j.capture_id=c.id)),
      'unallocatedCaptures',(SELECT COUNT(*) FROM journals WHERE kind='capture' AND allocation_state IN ('unallocated','duplicate')),
      'inconsistentJournals',(SELECT COUNT(*) FROM journals j WHERE
        (SELECT COUNT(*) FROM commerce_financial_entries e WHERE e.journal_sequence=j.sequence)!=json_array_length(j.lines_json)
        OR COALESCE((SELECT SUM(e.amount) FROM commerce_financial_entries e WHERE e.journal_sequence=j.sequence),1)!=0
        OR EXISTS(SELECT 1 FROM json_each(j.lines_json) l LEFT JOIN commerce_financial_entries e ON e.journal_sequence=j.sequence AND e.line_number=CAST(l.key AS INTEGER)
          WHERE e.account IS NOT json_extract(l.value,'$.account') OR e.amount IS NOT json_extract(l.value,'$.amount')))),
    'wallets',json_object(
      'enrollments',(SELECT COUNT(*) FROM commerce_wallet_enrollments WHERE commerce_environment=(SELECT environment FROM scope)),
      'confirmedProfiles',(SELECT COUNT(*) FROM commerce_wallet_provider_profiles WHERE commerce_environment=(SELECT environment FROM scope))),
    'email',json_object(
      'transactionalRequests',(SELECT COUNT(*) FROM commerce_email_requests WHERE commerce_environment=(SELECT environment FROM scope)),
      'transactionalAttention',${emailAttention('commerce_email')},
      'campaignRequests',(SELECT COUNT(*) FROM commerce_campaign_email_requests WHERE commerce_environment=(SELECT environment FROM scope)),
      'campaignAttention',${emailAttention('commerce_campaign_email')})
  ) AS report`;
}

const fields = {
  jobs:['total','uncertain','dead','cancelledBeforeSend','expiredLeases','overdue'],
  orders:['total','paymentReview','stockReview','shippingReview'],
  accounting:['captures','journals','unpostedCaptures','unallocatedCaptures','inconsistentJournals'],
  wallets:['enrollments','confirmedProfiles'],
  email:['transactionalRequests','transactionalAttention','campaignRequests','campaignAttention'],
};
export function commerceOperationsWarnings(report) {
  if (report?.version !== 1) throw Error('The operations report is incomplete.');
  for (const [section, names] of Object.entries(fields)) for (const name of names) {
    if (!Number.isSafeInteger(report[section]?.[name]) || report[section][name] < 0) throw Error('The operations report is incomplete.');
  }
  const warnings = [];
  for (const [section,name,code] of [
    ['jobs','uncertain','jobs_uncertain'],['jobs','dead','jobs_dead'],
    ['jobs','expiredLeases','job_leases_expired'],['jobs','overdue','jobs_overdue'],
    ['orders','paymentReview','orders_payment_review'],['orders','stockReview','orders_stock_review'],
    ['orders','shippingReview','orders_shipping_review'],
    ['accounting','unpostedCaptures','capture_journals_missing'],['accounting','unallocatedCaptures','capture_allocations_need_review'],
    ['accounting','inconsistentJournals','financial_journals_inconsistent'],
    ['email','transactionalAttention','transactional_email_attention'],['email','campaignAttention','campaign_email_attention'],
  ]) if (report[section][name] > 0) warnings.push(code);
  return warnings;
}
