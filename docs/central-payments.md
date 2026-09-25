# Central merchant payments

The Payments workspace reads the seller's complete D1 payment history when the
PHP central flag is enabled. Signed-in TEST users can inspect it at
`?page=payments&payment-preview=1` without switching checkout. Central reads never
load legacy order files. Refresh, Wallet navigation, provider setup information
and payment reports remain available.

## Read contract

`GET /v1/commerce/payments` accepts `limit`, `cursor`, `state`, `evidence`,
`review`, `method`, `q`, `from` and `to`. Unknown, duplicate, oversized and invalid
parameters are rejected. Authentication supplies the seller membership, including
read-only viewer access. Deployment selects the environment; only that seller's
version-1 central orders participate. These endpoints perform no commerce writes.

The list uses bounded keyset pages (25 in the UI, maximum 50 in the API). Its
insertion frontier persists across Next, Previous and reload; refresh includes
new orders. Existing states remain current, so a live status change can alter
filter membership. Inclusive dates use order creation time in Asia/Jakarta.
An omitted bound remains open. Summary cards and method shares cover all orders
in the selected dates, independent of the table filters.

Search includes order IDs, customer names/emails, primary and additional capture
references, provider request references and saved payment methods. Method search
accepts spaces or underscores. Filters distinguish all eight payment states,
verified/unverified/additional captures and review status. Method options show
the 20 most used methods; additional method orders are explicitly counted, remain
searchable, and have a complete breakdown in the paginated Payments report.

Primary captures count once per order. Additional captures remain separate;
refunded orders retain gross captures, and a paid label alone supplies no verified
money. Awaiting amounts count unpaid creating/pending orders. Money is returned
as decimal strings and formatted with BigInt; average payment uses integer
rounding. Empty averages and rates are unavailable rather than zero.

Review includes explicit payment-review flags, additional captures, and unresolved
creating/pending orders with uncertain/dead payment requests or expired/missing
running leases. An old uncertain request alone does not flag an already paid
order. These indicators are evidence for investigation, not refund or retry
authorization and not proof of provider settlement.

`GET /v1/commerce/payments/:order` returns saved customer name/email, exact order
and capture totals, safe provider-session references, aggregated request status,
and the first 20 capture/attempt/event entries. The independent `/captures`,
`/attempts` and `/events` continuations accept `limit` and `cursor`, maximum 50.
Each history has an insertion frontier that excludes subsequent backdated
inserts across every continuation. Cursors bind seller, environment, order and
history kind; every request rechecks seller scope. Foreign records return 404.

Raw worker errors, request/result payloads, lease tokens, worker identities,
payment URLs, virtual-account instructions, customer phone numbers and auth IDs
are excluded. Displayed references and names use text nodes. No payment creation,
provider retry, refund, reconciliation or payout action is added by these reads.

## Merchant behavior and acceptance

The UI has server filters, provider-reference search, stable pagination, deep
links, independent history paging, detail reload, explicit errors and retries.
A failed page request retains the previous page and navigation; a new filter
clears stale totals while loading. Refresh uses applied filters. Late responses
cannot replace a newer selection or reopen closed details. Order/report links
retain the central TEST preview. Universal dropdowns and the existing sidebar
announcement design are preserved. Large exact amounts remain readable on mobile.

Six D1 cases cover seller/environment/version scope, viewers, 241-order paging,
date boundaries, references/methods, exact large amounts, duplicate captures,
paid labels without evidence, uncertain/overdue requests, privacy, independent
histories, backdated insertion frontiers and absence of commerce writes. Four
PHP/browser cases exercise the real Worker and PHP proxy at 1360 and 390 pixels,
including failed reads/pages/history, reload, stale replies, filtering, deep
links, XSS-like text, legacy exclusion, CSRF/read-only proxy guards and exact
amounts above the JavaScript safe integer range. Screenshots are inspected.
All ten adjacent central order/dashboard/analytics browser cases and the six
adjacent order-read API cases also pass through the updated shared routes/proxy.

Signed-in hosted acceptance remains pending shared Chrome. The owner approved
the latest connection; its log reached WebSocket connected, then browser
initialization timed out. No repeated reconnect, direct CDP connection or shared
service restart is used. Local acceptance does not replace the hosted check.

This stage does not activate the central flags or complete the wider payment
lifecycle. Merchant refund/dispute/reconciliation workflows, actual provider
fees, ledger/settlement/payout acceptance, buyer consent/review workflows, operational
migration, monitored provider dispatch and representative capacity testing remain
open under the full workbench completion plan and production release hold.

## TEST deployment — 25 September 2026

Implementation `9d99eec` is pushed to `agent/ezkart-workbench`. TEST Worker
`b11833b1-2dba-4bdb-9ec0-f54f196e318a` is deployed. No migration is required;
the schema remains through 0019. Health at 18:47 Jakarta reports 49 application
tables and healthy D1/public/private R2. All five payment read routes return 401
without authentication. Hosted HTTPS hashes of `commerce-payments.js`,
`commerce-payments.css` and `admin.js` match the implementation at 18:48 Jakarta.
Hostinger's signed-in deployment view and merchant acceptance remain unverified
while shared Chrome is disconnected.

Before/after TEST readbacks confirm zero operational orders, customers, captures,
reservations, shipments, provider jobs and analytics export receipts/rows. All
six existing export guards remain present. The 15-entry legacy import receipt
and manifest
`ba180208c85cea72b82323b7b917e0e3771b143d930f5220665fddffc62777c0`
are unchanged. Private logs, aggregate readbacks and served-asset hashes are in
`/tmp/ezkart-payments-deploy-01a0d643/`. The central flags remain disabled, the
hourly maintenance schedule is unchanged, and production/main are untouched.

Final acceptance includes six payment API cases, six adjacent order API cases,
and 14 browser cases across Payments, Orders, Dashboard and Analytics. The
desktop/mobile Payments workflow also passes after the final detail-scroll and
report-link corrections; the final screenshots are inspected.
