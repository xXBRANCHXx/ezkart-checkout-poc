// These fields expose delivery state without recipient addresses, credentials,
// provider payloads, or another store member's personal notification choices.
export const emailStatusFields=(job='mj',request='mx',skip='ms',binding='mb')=>`${job}.id AS mail_job_id,${job}.state AS mail_job_state,${job}.available_at AS mail_next_at,
  ${request}.id AS mail_request_id,${skip}.reason AS mail_skip,${skip}.uncertain AS mail_skip_uncertain,${binding}.created_at AS mail_submitted_at,
  (SELECT group_concat(DISTINCT kind) FROM commerce_email_delivery_evidence me WHERE me.request_id=${request}.id) AS mail_events,
  (SELECT MIN(occurred_at) FROM commerce_email_delivery_evidence me WHERE me.request_id=${request}.id AND me.kind='delivered') AS mail_delivered_at,
  (SELECT MAX(observed_at) FROM commerce_email_delivery_evidence me WHERE me.request_id=${request}.id AND me.source='lookup') AS mail_observed_at,
  (SELECT created_at FROM commerce_email_resolutions mr WHERE mr.request_id=${request}.id) AS mail_reconciled_at`;
export const emailStatusJoins=`LEFT JOIN commerce_jobs mj ON mj.seller_id=e.seller_id AND mj.commerce_environment=e.commerce_environment AND mj.job_key='email_recipient:'||r.id AND mj.kind='notification.send'
  LEFT JOIN commerce_email_requests mx ON mx.recipient_id=r.id LEFT JOIN commerce_email_skips ms ON ms.job_id=mj.id LEFT JOIN commerce_email_verified_bindings mb ON mb.request_id=mx.id`;

export function emailDeliveryStatus(row,connected){
  if(!row.email_requested)return {status:'not_requested'};
  const events=String(row.mail_events||'').split(','),result={status:'queued',submittedAt:row.mail_submitted_at||null,deliveredAt:row.mail_delivered_at||null,
    checkedAt:row.mail_observed_at||null,resolvedAt:row.mail_reconciled_at||null};
  if((row.mail_skip_uncertain||row.mail_job_state==='dead')&&!row.mail_reconciled_at)result.status='needs_review';
  else if(events.includes('complained'))result.status='complained';
  else if(events.includes('bounced'))result.status='bounced';
  else if(events.includes('suppressed'))result.status='suppressed';
  else if(events.includes('failed'))result.status='failed';
  else if(events.includes('delivered'))result.status='delivered';
  else if(events.includes('delayed'))result.status='delayed';
  else if(row.mail_submitted_at)result.status='submitted';
  else if(row.mail_skip){result.status='skipped';result.reason=row.mail_skip;}
  else if(!row.mail_job_id)result.status='not_scheduled';
  else if(!connected)result.status='not_connected';
  else if(row.mail_job_state==='uncertain')result.status='checking';
  else if(row.mail_job_state==='retry')result.status='retry';
  else if(row.mail_job_state==='running')result.status='sending';
  if(['queued','checking','retry','sending'].includes(result.status))result.nextAttemptAt=row.mail_next_at;
  return {...result,label:emailStatusText[result.status],...(result.reason?{note:emailSkipText[result.reason]||'This update was not submitted for email delivery.'}:{})};
}

export const emailStatusText={not_requested:'Email not requested',not_connected:'Email requested · service not connected',not_scheduled:'Email not scheduled for this earlier update',
  queued:'Email queued',sending:'Email submission in progress',checking:'Checking email submission',retry:'Email retry scheduled',submitted:'Email accepted by the sending service',
  delivered:'Email accepted by the recipient’s mail server',delayed:'Email delivery delayed',failed:'Email delivery failed',bounced:'Email bounced',complained:'Email complaint received',
  suppressed:'Email blocked by the sending service',needs_review:'Email needs operator review',skipped:'Email skipped'};
const emailSkipText={before_activation:'This update predates email activation.',stale:'This update was too old to send.',store_closed:'The store is no longer active.',access_removed:'Store access changed before sending.',
  preference_off:'Email was turned off before this update was sent.',already_read:'The conversation was already read.',obsolete:'The order no longer needs this reminder.',
  identity_invalid:'A current confirmed account email could not be verified.',address_changed:'The verified account email changed.',suppressed:'An earlier bounce or complaint prevents further email to this address.',
  test_recipient:'This account is outside the approved TEST recipient list.',provider_changed:'The email connection changed before sending.',retry_window_expired:'The safe retry period has ended.',provider_rejected:'The sending service rejected this request.'};
