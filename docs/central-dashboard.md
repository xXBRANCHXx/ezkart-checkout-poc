# Central merchant dashboard

The dashboard reads authoritative central orders through
`GET /v1/commerce/dashboard`. It replaces the private-file reporting path when
PHP central commerce is enabled. A signed-in TEST merchant can inspect it at
`?page=dashboard&dashboard-preview=1` without switching checkout storage. The
preview preserves its mode in links to the central order manager. Both previews
show processing as unavailable when PHP central storage is disabled, even if
the separate Worker flag has already been enabled.

## Reporting contract

The API resolves the active merchant seller from authentication and derives the
commerce environment from the deployment. It accepts only `range` (`7`, `30`,
`90`, `all`) and `group` (`daily`, `weekly`, `monthly`, `yearly`), with defaults of
30 days and daily grouping. Unknown or duplicate parameters fail. Viewer roles
can read, and all writes to this route fail. The PHP proxy preserves these
boundaries. No source-file fallback is used when a central read fails.

Only `commerce_version=1` orders in that seller/environment are included. Import
rehearsals, demo sources, another seller's records and production orders in TEST
are excluded. The response contains counts, money, chart buckets, the latest
five orders, five leading products, three leading catalog activities and saved
customer names/location labels. It omits phone numbers, emails, street
addresses, authentication IDs, payment instructions and raw provider payloads.

Reporting periods use order creation dates and Asia/Jakarta calendar boundaries,
including the current day. A payment confirmed later contributes to the order's
original reporting period; this is a live order-cohort report, not a cash-receipt
report. Operational queues cover all dates independently. The dashboard and
order manager share their seller/environment scope, capture policy and queue
definitions, including unresolved stock/payment/shipment conflicts.

The first query captures the insertion watermark and oldest applicable order.
All eight reporting queries then execute in one D1 batch over that watermark.
An intervening insertion cannot widen the chart's cohort. Existing order states
and verified captures remain live. Totals are calculated over the entire cohort;
the bounded recent-order and product lists never determine the headline totals.
Monthly and yearly grouping keep long histories readable without truncating
their totals. Weeks start Monday, including across calendar-year boundaries.

Confirmed amounts count primary verified order captures, including their
original gross amount if the order is later refunded. A paid label alone does
not create confirmed money. Additional captures are separate, and unpaid,
failed/expired and cancelled order amounts are labeled separately. Fees,
refunds, settlement and available wallet funds are not inferred from this
report. Courier bookings use the latest attempt with a provider reference and
are not described as delivery evidence.

Money aggregates remain decimal integer strings from SQLite through the API.
The browser uses `BigInt` for amounts and chart scaling; average paid-order
amounts use integer rounding. Product totals use saved item prices and names,
grouped by stable product ID. Current catalog photos are optional decoration
from the existing authenticated catalog; changing a photo cannot change saved
commercial details or reporting totals. Query work still grows with a seller's
history; these correctness checks do not establish production-scale capacity.

## Merchant behavior and checks

The dashboard retains operational queues, payment and order metrics, trend
charts, recent orders, leading products, all eight payment states, amount
breakdowns, customer activity, catalog activity, fulfillment context, catalog
reviews and landing-page summaries. Queue links use all dates, while reporting
links carry their period into the central order manager. The header search opens
the full server-side order search.

Periods/grouping survive reload and browser history. Unapplied filter edits do
not affect Refresh. Failed initial reads show an explicit error and unavailable
values; failed later reads retain the original report with its dates and a
stale-report explanation. Delayed requests cannot overwrite a newer selection.
Charts offer an exact-value table, adapt their dimensions on viewport changes,
keep readable mobile labels and use an explicit empty state when no payment has
been confirmed. Card explanations wrap instead of disappearing behind ellipses.
Selectors use the existing universal control; the sidebar promotion is unchanged.

Five D1 cases cover merchant/viewer authorization and isolation, 241 historical
orders beyond the former cap, full-cohort totals, original item data, separate
captures, Jakarta boundaries, all four chart groupings, multi-decade history,
integer precision beyond the JavaScript safe range, and real payment/acceptance
queue transitions without additional stock changes. Three PHP/browser cases
cover desktop/mobile rendering, optional photos, period/history/reload, chart
values and resize, order links/search, source-file exclusion, proxy restrictions,
outages and stale responses. Six adjacent order-read API cases, three central
order-manager browser cases and five existing dashboard/analytics PHP/browser
regressions also pass.

This stage does not activate central checkout. Analytics, payment/customer read
adapters, operational legacy promotion, monitored dispatch, wallet completion
and the remaining workbench acceptance gates stay open.

## TEST deployment — 25 September 2026

Implementation `125af2a` is committed and pushed to `agent/ezkart-workbench`.
The TEST Worker is deployed as `2e92c29a-d052-46db-b385-ba2da456aff8`. No
migration or storage-flag change is part of this deployment. Public HTTPS reads
confirm that the hosted dashboard JavaScript/CSS and updated order-manager
JavaScript exactly match the committed files. The dashboard API rejects an
unauthenticated request with 401. At 17:27 Jakarta time, Worker health reports
47 application tables and passing D1/public R2/private R2 checks.

Post-deployment D1 reads confirm zero operational orders, customers, captures,
reservations, shipments and jobs. The existing import receipt retains 15 entries
and manifest digest
`ba180208c85cea72b82323b7b917e0e3771b143d930f5220665fddffc62777c0`.

Authenticated hosted browser acceptance is still pending: Chrome's shared
connection ended, and the single explicit reconnect attempt timed out after
300 seconds. Browser review requires restoring that connection with Chrome's
new approval; no request is currently running. The passing populated
desktop/mobile tests use the real PHP proxy and
local Worker fixture; they are not a claim that the hosted signed-in view has
already been inspected. No second browser connection or reconnect loop is used.
