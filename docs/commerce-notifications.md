# Transactional notifications on workbench

The merchant bell opens `?page=notifications`; signed-in buyers use
`/cart/notifications.php`. Both screens show real private notifications with
category, literal-text search, read/unread filtering, bounded history, read
confirmation, and links to the relevant order, return, or conversation. The
merchant bell polls unread counts on visible pages. Notifications do not mark
themselves read just because the inbox was opened.

Merchant Settings now supplies the personal channel preferences used by delivery.
Existing read/write holds remain authoritative. Delivery requires **both**
`COMMERCE_STORAGE=d1` and `COMMERCE_NOTIFICATIONS=enabled` (`scheduled` is an
equivalent fixture/operator value). Neither flag connects an email provider.

## Sources and delivery

Migration `0029_commerce_notifications.sql` adds immutable source receipts,
per-recipient delivery records, and read confirmations. An alert and every
recipient record commit in one D1 transaction. Recipients are captured from
current store membership, permanent order ownership, or conversation ownership.
Each merchant record includes the exact personal preference revision and the
in-app/email choices used by the transaction. A later preference change applies
to future delivery; retries reuse the original receipt.

Sources are verified payment/order-state events, additional-payment or stock
review, stock recovery, courier/fulfillment updates, return transitions, and
messages. Message alerts refer to the conversation without copying private text
or attachments. The message event and its source job commit together. Merchant
messages alert the buyer, and buyer messages alert store members. Viewer members
can read and mark their own notifications; they gain no order-edit permissions.

Scheduled sources:

- An unpaid order older than 30 minutes produces at most one reminder. The
  delivery transaction checks that it is still unpaid and unexpired. A completed
  or expired order suppresses the queued reminder.
- Weekly activity uses a Monday-to-Monday Jakarta period, becoming eligible at
  09:00 WIB the following Monday. It reports current active products without a
  provider-confirmed paid order in that period, with up to ten product names.
  The active catalog is read at processing time; this is not a historical catalog
  snapshot. Each store/period has one source job. Weekly delivery defaults off.

The TEST minute cron schedules up to 50 eligible pending reminders and 50 weekly
store summaries per pass, then dispatches **at most three source jobs**. The
existing `17 * * * *` housekeeping cron is retained. Source requests only persist
their jobs; delivery runs separately so it does not consume checkout's D1 query
budget. Three-job batches leave headroom beneath the 50-query free invocation
limit. See [Cloudflare's D1 limits](https://developers.cloudflare.com/d1/platform/limits/).
This conservative workbench schedule is not a production throughput or latency
guarantee; backlog/load tests and a higher-throughput runner remain release work.

A signed commerce-service request can process a bounded batch at
`POST /internal/commerce/notifications/drain` with
`{environment:"sandbox",limit:3,schedule:false}`. All parameters are validated
before scheduling. This uses the existing service authentication and commerce
hold; it is not a browser or unauthenticated endpoint.

## Recovery and visibility

Source jobs retain leases and immutable attempt history. An event receipt is
required before marking a notification job successful. An expired worker cannot
insert an event. If a delivery acknowledgement or job completion is lost, the
next attempt checks the receipt and completes the existing delivery without
duplicating recipients or using new preferences. Expired/exhausted notification
attempts become visible review items; financial/provider jobs retain their
existing reconciliation behavior.

The merchant's **Store delivery activity** view lists queued, processing,
retrying, uncertain, exhausted, and processed updates. It exposes no recipient
identities, private message contents, service payloads, or raw provider errors.
An inbox delivery count does not mean the recipient read the alert. Suppressed
reminders and closed-store deliveries are explicit. Exhausted sources require an
operator investigation; this view does not silently reset or resend them.

Read confirmations are monotonic and idempotent. Foreign recipient IDs reject
the whole request. Live membership/ownership is checked again in the database
write. Losing a read acknowledgement supports retrying the same IDs; a reload
reads the stored outcome. A stale inbox response cannot undo a newer confirmed
read. Private PHP proxies bind merchant account/store/CSRF or the buyer session
version, recheck sign-in after upstream work, and discard private results if the
account changes in flight. The buyer's reused merchant sign-in is also rechecked.

## Remaining acceptance

Email currently records **requested intent only**, labeled “service not
connected.” There is no claim of submission or delivery, no connected provider,
and no real email is sent. The owner question about an existing transactional
email service is still open. Verified addresses, provider adapter and credentials,
template/content acceptance, signed delivery callbacks, bounce/complaint handling,
retry/reconciliation, and appropriate consent/unsubscribe behavior remain open.

The combined Settings/notifications gate remains unchecked. Hosted authenticated
acceptance, actual scheduled delivery after central cutover, alerting for stalled
or exhausted jobs, retention policy, and sustained backlog/latency testing remain
required. Work stays on `agent/ezkart-workbench`; DOKU approval, sustained financial
validation, and explicit owner release authorization still apply.

## Validation

Worker tests exercise real source lifecycles, preference snapshots, cross-store
and buyer isolation, expired leases, completion proof, acknowledgement loss,
concurrent delivery/read requests, access revoked during a write, retry
exhaustion, closed stores, scheduling boundaries, obsolete reminders, strict
inputs, and the query budget. PHP/browser tests exercise desktop and 390-pixel
inboxes, actual links, universal selects, filters/history, lost acknowledgements,
late/stale responses, Google sign-in boundaries, merchant/buyer sign-in changes,
safe weekly product text, and the commerce hold. Screenshots are visually checked.

Verification passed: 172 tests in the complete Worker suite, followed by all ten
notification tests including the additional real-cron check (173 distinct Worker
checks); 33 affected PHP/browser checks; ten PHP and fifteen JavaScript syntax
checks; a TEST Worker dry run; and `git diff --check`. Logs are under
`/tmp/ezkart-notices-{api-release,api-final,ui-release,build}-01a0d643.log`.
Desktop and narrow screenshots are under `/tmp/ezkart-notices-ui-01a0d643/`.

A fresh TEST backup (`457989` bytes; SHA-256
`cf3b049a30c6fe0a962abd58f02ac0ab8a5c4fa622b312424843582d2cf2612b`)
restores in its original order with migration 0029. Integrity is `ok`, foreign
keys are intact, and all old table counts and seller settings are unchanged.
The three new notification tables are empty. The backup and read-only comparison
artifacts are private under `/tmp/ezkart-notices-deploy-01a0d643/`.

Hosted rollout evidence follows after deployment.
