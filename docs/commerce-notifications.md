# Transactional notifications on workbench

The merchant bell opens `?page=notifications`; signed-in buyers use
`/cart/notifications.php`. Both screens show real private notifications with
category, literal-text search, read/unread filtering, bounded history, read
confirmation, and links to the relevant order, return, refund request or conversation. The
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
review, stock recovery, courier/fulfillment updates, return and refund transitions, and
messages. Message alerts refer to the conversation without copying private text
or attachments. The message event and its source job commit together. Merchant
messages alert the buyer, and buyer messages alert store members. Viewer members
can read and mark their own notifications; they gain no order-edit permissions.

Refund requests and decisions use the existing `returns` preferences, labelled
**Returns and refunds**. Migration 0046 adds a purchase-bound refund reference
to the event receipt and creates a source job in the same transaction as each
request or decision. Dispatch verifies the original source ID, state, timestamp,
store, environment, order and unique job key. The inbox and email link to that
exact request; buyer sign-in preserves its validated reference. Alerts omit
private explanations and decision messages. Approval explicitly says the refund
has not been paid. Existing email opt-in and current-preference checks still apply.

The migration replaces the event table within one transaction using
[D1's deferred foreign-key checks](https://developers.cloudflare.com/d1/sql-api/foreign-keys/),
copies every original event, and restores its existing guards and current
preference-aware fan-out trigger. Recipients, read receipts, preferences and
email evidence stay intact. An event can identify exactly one return or refund.
Existing refunds receive distinct source jobs retaining their original times;
old recipients are not re-created. See [refund-requests.md](refund-requests.md).

Refund notification implementation `c416d94` and migration 0046 are deployed only
on workbench/TEST, with Worker `69fce451-7dbe-4113-94c4-ec9876c015cf`. The 67 relevant
local cases, 25 hosted Worker checks and 29 hosted web checks pass. The new event
reference does not add a table or schedule. Restored/remote records and settings
match and all 399 compatibility plans compile. Central commerce and actual email
delivery remain held; no hosted notifications or provider calls were created.

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

The [email delivery follow-up](commerce-email-delivery.md) adds a durable Resend
adapter, current confirmed account verification, exact-request retries, signed
callbacks, suppression and private email history. TEST remains unconfigured and
sends no real email. The [buyer preference follow-up](buyer-notification-preferences.md)
adds account-wide channel choices and verified email delivery. Provider and sender
activation, real mailbox acceptance, campaign consent/unsubscribe and operational
acceptance remain open. Earlier recipient records are not backfilled.

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

Implementation `4e70d3e` is pushed to `agent/ezkart-workbench` and automatically
deployed by Hostinger. All five affected JavaScript/CSS assets match the local
commit (hosted modification time 26 September 2026, 14:12:55 UTC). Guest merchant
and buyer pages show their sign-in gates; both PHP proxies return private 401
responses, and include-only files return empty 404 responses.

TEST migration 0029 and Worker `09de287d-0cb5-4a5b-b0ae-c8c5f6743d78` are deployed.
The new migration has three tables, two indexes, and twelve triggers. No pending
migrations remain. Health reports 83 application tables and healthy D1/public R2/
private R2. The existing hourly trigger and new minute trigger are installed.

The post-migration comparison confirms unchanged existing rows, seller settings,
financial/provider records, and import manifest. It permits only the expected
migration entry and new message-notification trigger in existing schema lists.
All three notification tables remain empty. Notification inbox/stats/processing
APIs require authentication (401, no-store). Notification drain and financial
provider access still return 503 because central commerce is held; installing the
notification flag has not activated hosted delivery or any provider.

Protected evidence is in `comparison.json`, `restore.json`, `worker-checks.json`,
`hosted-assets.json`, `hosted-guards.json`, `migrate.log`, `deploy.log`, and
`pending.log` in the deployment directory above. The first site check caught the
normal auto-deployment delay; the follow-up assets and guard checks passed.

Shared Chrome remains disconnected at the previously recorded five connection
attempts; this rollout did not attempt a reconnect. Authenticated hosted acceptance
therefore remains open. The hosted responses still expose only
`Content-Security-Policy: upgrade-insecure-requests`, including the new buyer page;
this repeats the existing hosting-header issue in
[production-release-gates.md](production-release-gates.md).
