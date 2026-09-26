# Marketing automations

Marketing now has saved, versioned automations with event enrollment, delayed
publication, current eligibility checks and actual delivery activity. New rules
start paused. Merchants review a saved version before activation and must pause
it before changing its message, trigger or audience. Archive and restore retain
full history. This implementation does not close the marketing acceptance gate;
sending, central-commerce and production holds remain in force.

## Merchant behavior

| Trigger | Required source | Eligibility before delivery |
| --- | --- | --- |
| Welcome | A new grant after no permission or withdrawal | The same current verified account/address and exact permission revision; at most one publication per automation/contact |
| After payment | A verified primary capture for the owned order | Matching ownership, amount and currency; the order remains paid; additional captures and unverified paid labels do not qualify |
| Expired checkout | A recorded payment-expiry receipt | The checkout remains expired with no primary payment; late payment stops the follow-up |
| Inactivity follow-up | A verified primary capture followed by the chosen delay | The order remains paid and that account has no newer verified purchase, including at another email address; delay is at least one day |

All triggers send promotional email. They require recorded permission at the
source event, unchanged through dispatch, and a currently verified address.
Guest orders and address collection alone do not grant permission. A later
permission grant cannot authorize an earlier payment or expiry. A new welcome
grant can independently qualify. Customer records come from central orders, so
a permission grant without an owned customer order is not enrolled.

The editor supports message copy, delays in minutes/hours/days, repeat intervals,
all customer filters, copying a saved segment, audience preview and explicit
activation review. Zero delay means the next processing check. Saved segments
are copied into the rule; later segment edits do not change it. List filters,
paging, full history and message-source links work at desktop and phone widths
with the universal dropdown control.

Activation captures the current event boundary in the same transaction as its
receipt. Earlier events are excluded. Pause invalidates waiting work from that
version; resume starts a new boundary. An uncertain or in-flight provider
submission retains its evidence and cannot be described as never sent. Pausing
an already paused rule also advances its revision, preventing an older delayed
activation from winning afterward.

Repeat intervals are 1–90 days per rule/account/address. Publication reserves
that interval even if delivery is later stopped. Welcome publishes only once
per rule/contact. Other delays allow up to thirty days; inactivity allows one
day through one year. Work more than 24 hours past its due time is skipped, so
restoring processing does not send a stale backlog.

The detail view shows actual enrollment, waiting, stopping, publication,
submission, verified delivery, skipped and review totals. Activity pages retain
event/due times, rule revision, exact stop reasons and generated-message links.
Provider acceptance is distinct from verified delivery. Later signed delivery
evidence remains visible after pause or cancellation; an uncertain submission
still requires review. Scan/publication issues show their retry time.

## Recovery and authorization

Exact save/action intentions are persisted before sending, scoped to the current
account, store and environment. Reload or an interrupted response recovers the
original request. A recovered receipt also returns the current rule, so an old
activation cannot display a subsequently paused rule as active. Up to twenty
unfinished local drafts are retained.

Malformed storage and mismatched acknowledgements are rejected without replacing
the recovery record. Unavailable storage blocks new saves and activation.
Pause remains available while processing is held or activation is uncertain;
if browser persistence fails, it keeps the original reference in memory and
warns that reload would lose recovery. Session changes invalidate asynchronous
responses and close dialogs. Concurrent edits preserve independent local fields
and require explicit conflict resolution. Discarding a new draft requires review
and is unavailable while its request is unresolved.

Membership and store/environment scope are checked for reads, writes and receipt
recovery. Viewers cannot create new changes but can recover their committed
receipt. Database triggers enforce the revision, role and state rules. An
active-rule emergency pause bypasses ordinary edit limits. Limits are 100 saved
rules, twenty active rules, thirty changes/minute and 200/day per store.

## Durable processing

Migration 0041 adds nine tables for source facts, rules, changes, scans,
enrollments, publication runs, outcomes, detailed stops and processing issues.
New facts are recorded independently of processing configuration. Immutable
payment, expiry and consent receipts establish ownership and time. The source
transaction and fact commit or roll back together. Duplicate callbacks,
additional captures and repeated unchanged grants do not create qualifying
repeat facts. Migration does not backfill historical events.

A scan processes at most fifty source facts for one active rule version. Its
receipt, current order boundary and matching enrollments commit atomically.
Concurrent scans and lost acknowledgements recover one result. Invalid source
evidence preserves the cursor, records an issue and backs off five minutes so
another rule can proceed. Current ownership and permission are checked before
enrollment; later permission cannot authorize earlier activity.

Each processing invocation scans one page, records up to fifty skipped
enrollments, and publishes at most twenty-five distinct contacts for one rule
version. Selection produces deterministic run, campaign and publication IDs.
Immutable copy, selected candidates, campaign seal, durable send jobs and
outcomes commit together. Concurrent pause, changed permission or an invalid
candidate rolls back the publication. Lost acknowledgements recover the original
complete run.

Generated messages reuse campaign delivery, one-click unsubscribe, signed
callbacks, provider investigation and performance attribution. Their copy and
schedule cannot be manually changed; cancellation and delivery history remain
available. Both screens identify the source rule. Campaign publication quotas
remain shared with manual campaigns: ten publications/hour and 100/day per
store, plus draft-change limits. Quota exhaustion records a five-minute retry
without consuming waiting enrollments or blocking another store. These bounds
require capacity acceptance before activation; they are not throughput promises.

Before a provider start, current rule revision/state, store status, publisher
membership, source receipt, order state, account/address, exact consent revision,
audience, repeat interval, due time and storefront button eligibility are checked
again. Database guards on request creation and start recording catch changes
after preparation. The existing sender checks the Auth account's current
verified address. Detailed stops remain immutable even when the shared sender
uses a broader cancellation reason. Previously accepted or uncertain submissions
retain their original retry and investigation contract.

Automation eligibility has a separate indexed lookup. Inlining it into the
manual campaign permission view exceeded D1's expression-depth limit in request
guards. Point delivery/activity reads use indexed recipient evidence and customer
history rather than materializing all store recipients or email events. Existing
raw provider bindings retain priority over recovered bindings; mixed callback
and lookup history is preserved.

## API and controls

The merchant PHP proxy applies existing session, CSRF and store guards to:

- `GET/POST /v1/commerce/marketing/automations`
- `GET /v1/commerce/marketing/automations/:id`
- `GET /v1/commerce/marketing/automations/:id/history`
- `GET /v1/commerce/marketing/automations/:id/activity`
- `POST /v1/commerce/marketing/automations/:id/action`

Lists/activity page at twenty-five rows and history at twenty. Cursors are bound
to authenticated scope and filters. Generated campaign reads include their
rule/run source; save and reschedule attempts return an explicit conflict.
Direct access to the PHP component is refused.

`POST /internal/commerce/automations/process` uses the signed internal commerce
boundary and accepts only the current `environment`. Processing publishes jobs
and never sends provider requests. TEST uses one registered marketing cron,
`0-59/3,1-59/3 * * * *`, with separate invocations: campaign sends retain their
existing :00/:03/:06 cadence and automation processing runs at :01/:04/:07.
Each phase has its own D1 query budget. The phase uses the event's scheduled
time, so delayed execution cannot switch a publishing event into a send event.

The first rollout hit the account's five-cron limit after the Worker upload;
the combined expression replaces the campaign trigger and keeps TEST at four
registered triggers. No account upgrade or other Worker's schedule is needed.
Previous handlers remain during propagation. Cloudflare documents the supported
[range/list syntax](https://developers.cloudflare.com/workers/configuration/cron-triggers/#supported-cron-expressions)
and the event's [scheduled time](https://developers.cloudflare.com/workers/runtime-apis/handlers/scheduled/#properties).

`COMMERCE_MARKETING_AUTOMATIONS=enabled`, central D1 commerce and campaign email
readiness are required for new activation/scanning/publication. The automation
flag holds new work; it does not stop already published emails. Use the existing
`COMMERCE_CAMPAIGN_SEND` hold or pause the rule to stop pending delivery. Existing
starts may already have reached the provider. Automation processing stays unset
on TEST during acceptance. Production configuration is unchanged.

## Verification and remaining acceptance

The final local backend run passes all 141 cases across rule APIs, scanning,
publication/operations and existing campaign publication, delivery, investigation,
delivery reports and performance reports. Coverage includes source rollback,
no backfill, exact receipt recovery, activation/consent boundaries, damaged source
evidence, concurrent scans/checkouts, twenty-five-recipient publication, real
quota fairness, current role/audience, pause/withdrawal/late payment at the final
start, uncertain sends and later delivery evidence. Two actual fixture sends fit
the fifty-query invocation budget. Populated migration tests preserve mixed
legacy evidence and verify indexed point-read plans. Earlier affected
order/payment/consent and customer suites also pass.

Three final processor/cron cases pass after consolidating the trigger. They
execute publication and a real fixture send in distinct invocations, check each
query budget, preserve the send cadence and verify both holds and invalid times.
The adjusted TEST dry-run and syntax/diff checks pass.

All six new PHP/browser cases pass, including desktop/390px workflows, uncertain
saves and activation, pause recovery, conflicts, storage failure/tampering,
role/proxy guards, immutable generated messages and source navigation. Nine
existing marketing cases pass. Of 34 remaining publishing, investigation, report
and performance cases, 33 passed initially; the only failure was an ambiguous
test selector after adding the automation form. Its correctly scoped recovery
case now passes. Syntax, diff, visual layout and TEST dry-run checks are recorded
with rollout evidence.

Provider calls in these tests are intercepted fixtures. Signed-in hosted
merchant/customer workflows, real provider/domain acceptance, monitoring,
retention, sustained delayed/repeat behavior, load/capacity and operational
recovery exercises remain required. Central commerce remains held. All thirteen
top-level completion gates remain open; DOKU approval, the financial validation
period and explicit owner release remain separate conditions.

The fresh private TEST backup is 602,079 bytes, mode 0600, with SHA-256
`6c92784ab09c21d5022a1cb2a1ce08d2bc5787fb6b730dd679f88099a72245d8`.
Its restore preserves every row in all 121 existing physical tables, passes
integrity and foreign-key checks, and compiles all 128 compatibility queries.
Migration 0041 adds 63 objects and changes only the two existing campaign
delivery source/status views. All nine new tables are empty. Current remote
counts match the backup, including fifteen legacy-import entries. Syntax checks
pass for all 25 changed JavaScript/PHP files, and the diff check passes.

## TEST rollout

Implementation `6de734b` and schedule adjustment `105f991` are pushed to
`agent/ezkart-workbench`. Migration 0041 is applied and TEST Worker
`838d462b-0a30-40b5-a9de-532bc4c0ff76` is deployed with four registered cron
triggers. Health reports 129 application tables and healthy D1/public R2/private
R2. All 51 deployed API access/hold checks pass at 23:48:00 UTC on 26 September.

Hostinger's automatic workbench deployment serves the exact nine checked assets
at 23:49:49 UTC. All thirty hosted access, private-component, unsubscribe and
campaign-link checks pass at 23:49:51 UTC. A final remote read after these checks
confirms existing counts/settings and the legacy manifest are unchanged, all
63 new schema objects and two replaced views match the restore, all nine new
tables remain empty, and there are no pending migrations or foreign-key errors.
All 128 compatibility queries still compile. These checks created no hosted
automation, campaign, message, visit, order, payment or export.

The shared Chrome connection remains disconnected; no new connection attempt
was made for this rollout. Signed-in hosted acceptance remains pending. The
merchant response still exposes the hosting-level `upgrade-insecure-requests`
policy rather than PHP's full policy; that existing header issue remains a
release gate. Automation, campaign/email and central-commerce holds are
unchanged. Main, production and draft PR #3 are untouched.
