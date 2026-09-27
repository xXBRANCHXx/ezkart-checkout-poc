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
    orders_in_scope AS (SELECT * FROM orders WHERE commerce_version=1 AND commerce_environment=(SELECT environment FROM scope)),
    sync_jobs AS (SELECT *,ROW_NUMBER() OVER(PARTITION BY credential_fingerprint,platform_enrollment_id ORDER BY created_at DESC,id DESC) AS latest
      FROM commerce_payout_sync_jobs WHERE commerce_environment=(SELECT environment FROM scope)),
    payout_grants AS (SELECT g.*,COALESCE(p.reconciled,0) AS reconciled FROM commerce_withdrawal_payment_grants g
      LEFT JOIN commerce_payout_positions p ON p.withdrawal_id=g.withdrawal_id WHERE g.commerce_environment=(SELECT environment FROM scope))
  SELECT json_object(
    'version',2,'observedAt',(SELECT observed_at FROM scope),'environment',(SELECT environment FROM scope),
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
    'payoutSync',json_object(
      'jobs',(SELECT COUNT(*) FROM sync_jobs),
      'active',(SELECT COUNT(*) FROM sync_jobs WHERE state IN ('queued','running','retry')),
      'reviewGroups',(SELECT COUNT(*) FROM sync_jobs WHERE latest=1 AND state='review'),
      'expiredLeases',(SELECT COUNT(*) FROM sync_jobs WHERE state='running' AND lease_until<=(SELECT observed_at FROM scope)),
      'overdue',(SELECT COUNT(*) FROM sync_jobs WHERE state IN ('queued','retry') AND available_at<strftime('%Y-%m-%dT%H:%M:%fZ',(SELECT observed_at FROM scope),'-15 minutes')),
      'unreconciledPayouts',(SELECT COUNT(*) FROM payout_grants WHERE reconciled=0),
      'unassignedAccounts',(SELECT COUNT(*) FROM payout_grants WHERE platform_enrollment_id IS NULL),
      'outsideWindow',(SELECT COUNT(*) FROM payout_grants WHERE reconciled=0 AND created_at<strftime('%Y-%m-%dT%H:%M:%fZ',(SELECT observed_at FROM scope),'-31 days','+10 minutes')),
      'staleSettlements',(SELECT COUNT(*) FROM commerce_settlement_scopes s JOIN commerce_settlement_source_freshness f ON f.assessment_sequence=s.sequence
        WHERE s.commerce_environment=(SELECT environment FROM scope) AND f.current=0
          AND NOT EXISTS(SELECT 1 FROM commerce_settlement_assessments later WHERE later.capture_id=s.capture_id AND later.sequence>s.sequence))),
    'payoutRunner',json((SELECT json_object('state',state,'startedAt',started_at,'seenAt',seen_at,'leaseUntil',lease_until,'finishedAt',finished_at,
      'runs',runs,'failedRuns',failed_runs,'interruptedRuns',interrupted_runs,'lastFailureAt',last_failure_at)
      FROM commerce_payout_sync_runner WHERE commerce_environment=(SELECT environment FROM scope))),
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
  payoutSync:['jobs','active','reviewGroups','expiredLeases','overdue','unreconciledPayouts','unassignedAccounts','outsideWindow','staleSettlements'],
  email:['transactionalRequests','transactionalAttention','campaignRequests','campaignAttention'],
};
export function commerceOperationsWarnings(report) {
  if (report?.version !== 2) throw Error('The operations report is incomplete.');
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
    ['payoutSync','reviewGroups','payout_sync_review'],['payoutSync','expiredLeases','payout_sync_leases_expired'],
    ['payoutSync','overdue','payout_sync_overdue'],['payoutSync','unreconciledPayouts','payouts_need_reconciliation'],
    ['payoutSync','unassignedAccounts','payout_accounts_unassigned'],['payoutSync','outsideWindow','payout_history_outside_window'],
    ['payoutSync','staleSettlements','settlement_sources_stale'],
  ]) if (report[section][name] > 0) warnings.push(code);
  if(!Object.hasOwn(report,'payoutRunner'))throw Error('The operations report is incomplete.');
  const runner=report.payoutRunner,now=Date.parse(report.observedAt);
  if(runner===null)warnings.push('payout_runner_not_observed');
  else{
    const states=['running','held','idle','completed','retry','review','failed'];
    if(!states.includes(runner?.state)||['runs','failedRuns','interruptedRuns'].some(k=>!Number.isSafeInteger(runner[k])||runner[k]<0)
      ||['startedAt','seenAt','leaseUntil'].some(k=>typeof runner[k]!=='string'||!Number.isFinite(Date.parse(runner[k])))
      ||['finishedAt','lastFailureAt'].some(k=>runner[k]!==null&&(typeof runner[k]!=='string'||!Number.isFinite(Date.parse(runner[k]))))
      ||(runner.finishedAt===null)!==(runner.state==='running'))throw Error('The runner report is incomplete.');
    if(now-Date.parse(runner.seenAt)>15*60000)warnings.push('payout_runner_overdue');
    if(runner.state==='running'&&Date.parse(runner.leaseUntil)<=now)warnings.push('payout_runner_interrupted');
    if(runner.state==='failed')warnings.push('payout_runner_failed');
    if(runner.state==='held')warnings.push('payout_runner_held');
  }
  return warnings;
}
