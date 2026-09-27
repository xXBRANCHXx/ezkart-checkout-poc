# Purchase-linked refund requests

Workbench implementation, 27 September 2026. Buyers and store editors can open
refund requests against original paid purchases. The store can approve or decline
the exact request; the buyer can withdraw it before a decision. This implements
request allocation and review, not provider execution, refunded-payment evidence,
financial reversal or digital entitlement revocation. Central checkout remains held.

## Original amounts and decisions

Each request binds one original central order and its full primary verified IDR
capture. Item amounts are positive whole rupiah, capped at the original unit price
times quantity. Shipping is a separate amount capped at the original shipping
charge. Physical and digital items can share a request; subscriptions are excluded.
A request can cover some of an item's price or only shipping. Return inspection
and stock adjustments remain in the separate physical return workflow.

Requested and approved amounts reserve the original purchase allocation. The
transaction checks every item and shipping amount against all existing active
requests, so concurrent attempts cannot overclaim. Decline and withdrawal release
that allocation without deleting history. A catalog price change, file replacement
or archived product cannot change the purchased amount. At most twenty new
requests per order per hour are accepted; exact retries do not spend another slot.

There is no automatic refund policy or delivery prerequisite for opening a request:
an undelivered item or unreadable file can be reported. Approval accepts the exact
amount requested. It cannot silently reduce that amount or mark money returned.
Payment-review holds and orders already marked partly/fully refunded require
support review until actual refund evidence and allocations are integrated.

## Authority, history and recovery

Buyer access uses the permanent verified order owner. Submitted email addresses,
account fields and identifiers cannot transfer ownership. Store access requires
current active membership; viewers are read-only. Only the store can approve or
decline. A buyer can withdraw a requested case; a merchant can withdraw only a
request that merchant originally opened. Approved cases retain their allocation
pending the separate processing lifecycle.

Migration 0045 adds three tables and fifteen indexes/triggers. Original requests,
item allocations and actions are immutable. Inserting a request projects all
items in the same transaction. Inserting a decision checks current order state,
membership and revision before updating its projection. Direct edits, deletes
and replacement writes are rejected. A failed projection leaves no orphan request.

Request keys belong to the authenticated actor, and request hashes include the
original details, order, action and environment. Exact retries return the current
saved case; an older retry cannot undo a later withdrawal or decision. Queues
use a fixed initial sequence boundary and scoped cursors. Browser responses omit
capture IDs, actor account IDs, request keys and hashes.

Both PHP proxies revalidate account, session, store/ownership and environment.
Writes require same-origin CSRF protection. After network work, a changed session
suppresses even a successful late response. Paths, filters, JSON fields and body
sizes are bounded; ambiguous JSON and duplicate query keys are rejected.

The buyer section is on order tracking; the merchant Refunds workspace is linked
from Orders. Both use the shared dropdown control. Before submitting, the browser
saves and reads back an account-scoped recovery record with a SHA-256 checksum.
A browser lock serializes confirmation across tabs. Reloads and lost responses
recover the same original body and key. Unavailable or damaged storage stops new
writes. An uncertain result keeps controls locked to that request. A definite
conflict requires reviewing saved state before changing the request; creation
draft amounts and explanation survive that review. Session changes hide details
and preserve the pending retry for the original account.

## Verification and acceptance

Eight API cases cover allocation races, original amounts, exact recovery, live
authorization, stale decisions, direct mutation guards, projection rollback,
strict input, fixed paging and rate limits. Five PHP/browser cases cover desktop
1360px/mobile 390px buyer and merchant journeys, lost replies across reloads,
stale approval, damaged/unavailable storage, forged scope and late session changes.
Original accounting entries, stock, payment state and download access stay intact.

The financial journal, digital download and order-manager regressions pass with
these cases (35 cases). Fifteen existing buyer review and digital checkout cases
also pass. The affected PHP/JS syntax, diff and TEST Worker dry-run checks pass.
Both desktop and mobile layouts were visually inspected. These are isolated
fixtures; no provider refund was requested or accepted.

The fresh private TEST backup is 680,604 bytes, SHA-256
`342329c6a6df53b170e3a7282b91bbc1a3328dcfd9301c15f63d342b6ba75726`.
It restores every existing record in 141 physical tables with clean integrity and
foreign-key checks. Migration 0045 adds eighteen objects and changes none of the
existing objects. All 351 captured compatibility plans compile against the restore.

Still required: dispute evidence and decision workflows,
owner-authorized execution with fresh financial verification,
provider capability and amount checks, unknown-outcome recovery, verified refund
receipts, fee/ledger reversals, precise digital-access effects, and reconciliation.
Approval never creates a provider job that could execute later without that
separate authorization and evidence contract. Signed-in hosted acceptance and
all wider commerce, provider and production-release gates remain open.

## Request and decision notifications

Migration 0046 adds durable source jobs for request, approval, decline and
withdrawal. Each job commits with its original request or decision. Delivery
requires the source's exact identity, original timestamp, state, order, store,
environment and unique key, plus a live lease. A lost acknowledgement reuses its
saved event and recipients. Approval alerts explicitly state that money has not
been returned; they change no financial or payment state.

Buyer and merchant inboxes and emails link to the exact authorized request.
The buyer's validated request link survives sign-in. Private request notes and
decision messages are not copied into alerts. Existing `returns` in-app/email
preferences apply, displayed as **Returns and refunds**. No preference, email
consent, provider connection or send flag is enabled by this addition.

Six new API cases cover original request/decision sources, replay, lost delivery
acknowledgements, forged receipts, preference snapshots and current opt-out,
email destinations, and a populated migration. Three decision notifications fit
within the existing D1 query allowance. Forty-two refund, email and buyer
preference API cases pass, as do the ten existing notification API cases.
Fifteen affected PHP/browser cases pass, including the new desktop/mobile
request links, sign-in continuation and foreign-account rejection.
Desktop 1360px and narrow 390px inboxes were visually
inspected. These tests use isolated local fixtures and mocked email transport.

The fresh private pre-0046 TEST backup is 691,831 bytes, SHA-256
`9f76d3f81edf268701094e5a0da14400dfcd000848a47577fc8ee2c8c5fc925e`.
Restoration preserves every original record in 144 physical tables with clean
integrity/foreign-key checks. The migration changes only the event table and its
source/completion guards, and adds one index and two source triggers. All 399
captured compatibility plans compile. A separate populated D1 rehearsal preserves
an existing event, both recipients, a read receipt, saved preferences and queued
email while backfilling two refund source jobs. All wider completion gates stay open.

## TEST rollout

Implementation `52c4954` is pushed on workbench. Migration 0045 and TEST Worker
`f85a8f22-8a9a-4632-8203-ab9c12183e76` are installed, with 143 healthy application
tables. Nineteen Worker checks pass at 03:10:56 UTC and twenty-three hosted checks
at 03:10:57 UTC on 27 September. Private refund routes require authentication;
new assets match; existing physical checkout remains usable at 1360px and 390px;
central checkout stays disabled. Final remote verification matches restoration,
compiles all 351 plans and preserves existing counts, settings and legacy evidence.
The three new tables remain empty. No hosted refund, decision or provider request
was created. Shared Chrome remains disconnected, with signed-in acceptance pending.

Notification implementation `c416d94` is pushed on workbench. Migration 0046 and
TEST Worker `69fce451-7dbe-4113-94c4-ec9876c015cf` are installed; health remains
143 application tables. Twenty-five Worker checks pass at 03:34:25 UTC and
twenty-nine hosted checks at 03:36:13 UTC on 27 September. Changed frontend assets
match the commit and the hosted buyer sign-in retains the exact order/refund link.
Notification/email source endpoints preserve authentication and commerce holds.
Existing physical checkout works at both widths. Remote verification compiles
all 399 plans, matches the restored schema and preserves existing counts, settings
and legacy evidence. No migrations are pending. Refund and notification tables
remain empty; no hosted alert, email, refund or provider operation was created.
Private rollout artifacts are under `/tmp/ezkart-refund-notifications-deploy-01a0d643/`.

## Purchase and delivery evidence during review

Refund detail now shows the original capture amount and confirmation time,
payment/shipping review flags, provider-bound courier delivery, and each requested
digital item's original file name, version, size and verified complete-download
time. A partial or native download does not qualify. File replacement, catalog
archival and another item's delivery cannot replace the purchased evidence.
Sandbox shipping skips and mutable order labels do not prove courier delivery.

The latest twenty related returns show only the refund's item lines and their
actual received/inspected quantities. Older omitted cases are identified. A store
member can open each exact return for its complete history. Buyer and merchant
summaries omit private warehouse notes, storage keys, download grants, provider
references and account identities. The display distinguishes the date a return
was requested from its current state. Inspection is not refund-payment evidence.
Existing authorization is checked again after the evidence read.

All eighteen relevant cases pass: eight refund regressions, four evidence API
cases and six PHP/browser cases. The original complete download, native/partial
access, replacement, separate items, fixture courier lifecycle, inspections,
foreign actors, revoked membership, held/skipped orders and bounded return history
are covered. Desktop 1360px and mobile 390px buyer/store views and return links
were visually inspected. Reading this context changes no requests, stock or
financial entries. No new migration or provider operation is needed.

The fresh private TEST backup is 694,485 bytes, SHA-256
`c3ff4374b11176d4e5c61c0e672577a7d8b44adad2e953563571b1ab115c585c`.
Its 144 physical tables restore unchanged with clean integrity/foreign-key checks;
all 407 captured compatibility plans compile. Syntax, diff and Worker dry-run
checks pass. All thirteen wider gates stay open.

Evidence implementation `d81262d` is pushed to workbench and TEST Worker
`8eff8633-cacf-467d-8779-8f2e9ad3df08` is deployed without a migration.
Twenty-five Worker checks pass at 03:54:12 UTC and twenty-nine hosted checks at
03:56:18 UTC on 27 September. All thirteen checked assets match their source;
private route guards, buyer sign-in continuation and physical checkout at both
widths pass. Central commerce and notification/email sending remain held. Final
remote verification preserves existing counts, settings and legacy evidence,
compiles all 407 plans, and finds no foreign-key errors or pending migration.
No hosted refund, order, delivery or provider operation was created. Signed-in
hosted acceptance still awaits the shared Chrome connection. Private rollout
artifacts are under `/tmp/ezkart-refund-evidence-deploy-01a0d643/`.

## Provider execution constraints checked on 27 September

The current central payment adapter accepts verified BCA virtual-account captures.
It does not establish card or QRIS refund capability. DOKU documents separate
non-card refund flows using disbursement or a refund service, requiring an
appropriate destination and funding. Payment receipt alone must not select a
refund destination or authorize a transfer. See
[DOKU's refund terms and flows](https://docs.doku.com/accept-payments/finance-and-settlement/refund-and-chargeback/refund-and-chargeback).

DOKU's [card refund API](https://developers.doku.com/accept-payments/direct-api/non-snap/card/refund)
binds the original invoice, original payment/capture request ID and refund amount.
Its response can distinguish online and manual refund types; a successful manual
request still requires processing. Those semantics cannot be generalized to the
existing BCA flow. Provider account capabilities, completion evidence and safe
unknown-outcome recovery remain to be implemented and accepted.

The owner has been asked how to reverse Ezkart commission/admin fees and who
bears actual provider refund fees. Those policies remain undecided; no fee
reversal or refund-processing charge allocation is implemented by this stage.
