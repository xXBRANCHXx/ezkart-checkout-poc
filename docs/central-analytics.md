# Central merchant analytics

The existing five analytics reports now have an authenticated D1 adapter. The
PHP central flag selects it automatically; signed-in TEST users can inspect it
without switching checkout at `?page=analytics&analytics-preview=1`. Central
reads never load legacy order files. An unavailable or invalid central report
shows an error and a reset link, including during preview navigation.

## Reports and calculations

`GET /v1/commerce/analytics` accepts `report`, `range`, `from`, `to`, `group`,
`cohort`, `q`, `status`, `stage`, `method`, `sort` and `table_page`. Unknown and
duplicate API/proxy parameters are rejected. Seller identity comes from the
authenticated membership, including viewer access; deployment selects sandbox
or production. Only that seller/environment's version-1 orders participate.

The overview, revenue, orders, payments and products reports preserve preset
7/30/90/180-day periods, all history and inclusive custom dates. Creation dates
use Asia/Jakarta. Invalid and future timestamps are excluded and counted. An
invalid custom period fails explicitly. Previous periods have equal day lengths;
partial-month comparison buckets align by elapsed day. All history has no
previous comparison. Daily charts beyond 90 days become weekly, weekly charts
beyond 730 days become monthly, and histories beyond 20 years become yearly.

A 24-hour cohort reference fixes the insertion frontier and date window across
navigation, grouping and table pages. It is a validated pagination reference,
not an authorization credential; every query still authenticates and scopes the
seller/environment. Existing order states remain current. Applying the period
again refreshes the frontier. Table totals and rows are filtered/sorted in D1;
pages contain at most 20 records, with stable tie breakers and last-page clamping.
Summary cards and charts always cover the entire selected cohort. Live status
changes can change membership or ranking between table requests.

Gross verified payments count primary captures once per order. Additional
captures remain separate, refunded orders retain their gross captured value,
and a paid label alone supplies no verified money. Product totals use saved
line prices and quantities, with distinct order counts per stable product ID
across options. Historical product names remain independent of current catalog
names/prices; current photos are optional decoration. Missing product identity
uses the individual saved line identity rather than inventing a name-based merge.

Payment methods come from saved provider sessions, never the requested flow.
Missing sessions show “Not selected.” Payment duration is the median interval
between creation and primary capture verification, including notification delay;
only nonnegative valid intervals contribute, and the sample count is shown.
Empty rates/averages are unavailable rather than zero. All eight payment states
and the shared fulfillment classifications are available.

Monetary sums stay integer decimal strings in D1/API/PHP/CSV. Averages round using
integer arithmetic. Exact cards, chart inspection and data tables retain digits
beyond JavaScript's safe range. Chart geometry, abbreviated axes and percentage
comparisons are approximate presentation calculations. Oversized amount cards
use extra horizontal space. No settlement, net refund, fee or wallet value is
inferred from these reports.

## Complete CSV snapshots

Migration `0019_analytics_exports.sql` adds export receipts and immutable rows.
`POST /v1/commerce/analytics/exports` accepts only report, cohort and a 32-hex
request key. The browser proxy requires its normal authenticated session and
CSRF token. The database admits, materializes and finalizes the complete report
in one transaction. There is no partial ready export. A retry recovers the same
snapshot; reusing its key for another request conflicts. Concurrent creation
cannot duplicate rows. Table filters do not constrain exports.

`GET /v1/commerce/analytics/exports/:id?after=0&limit=500` returns contiguous,
bounded immutable rows (maximum 1,000 per response). Foreign exports are 404;
expired owned exports are 410. Snapshots last 24 hours. New snapshot creation is
limited transactionally to 20 per seller/environment/hour; retries are exempt.
The hourly maintenance task deletes up to 5,000 expired rows and 100 emptied
receipts per run. Export retention and cleanup backlog need monitoring before
activation at production volumes.

The browser verifies snapshot identity, row count and contiguous ordinals,
assembles CSV only after every chunk succeeds, and retries the original request
after a lost creation response. It downloads no partial file. UTF-8 CSV includes
report dates, snapshot creation time, currency and exact decimal amounts. Formula
defenses prefix risky text after checking invisible/whitespace prefixes and
Unicode compatibility signs; quotes and newlines use CSV escaping. Customer
names, emails, phone numbers and payment instructions are not export columns.

## Acceptance and remaining limits

Seven real-D1 cases cover auth/scope/viewers, 242 selected historical orders,
comparison boundaries, odd/even medians, multiple saved options per product,
canonical/invalid/future dates, multi-decade grouping, large integers, provider
sessions, filtering/pagination, insertion frontiers, all report exports, replay,
concurrent creation, rollback, retention, cleanup and rate limits. Four PHP and
isolated-browser cases exercise all reports at desktop/mobile sizes, chart
inspection, filters, reload, paging, method/order links, complete chunked CSV,
lost-response recovery, formula-like names, preview isolation, outages, proxy
CSRF and exact large amounts through the rendered page and download.

Adjacent dashboard/order reads and existing legacy analytics/date regressions
also pass. These are correctness tests, not a production capacity benchmark.
Aggregation/materialization cost grows with history; browser CSV assembly uses
memory proportional to the download. Representative maximum datasets, timeout
behavior, storage/cleanup capacity and supported-device memory remain release
acceptance work. Refund accounting, customer workspace read routing, hosted
payment workspace acceptance,
operational migration and monitored provider execution remain separate tasks.
The central storage flags stay disabled, and no top-level workbench gate closes.

Hosted signed-in analytics acceptance is pending shared Chrome access. After the
owner indicated readiness, one further broker reconnect timed out; it was not
retried in a loop. Local browser acceptance does not replace the hosted check.

## TEST deployment — 25 September 2026

Implementation `1201985` is pushed to `agent/ezkart-workbench`. Only migration
0019 was pending; it is now applied to TEST. The pre-migration D1 export is
`/tmp/ezkart-analytics-deploy-01a0d643/test-before-0019.sql`, mode 600, 359,939
bytes, SHA-256
`fb7d6c74bdea074622d6beceaa96e692df303c9d11fd0c3051c71991fe72364a`.
Private deployment logs and aggregate readbacks are in the same directory.

TEST Worker `54e77e60-0047-4ea7-b6d2-b9fac82a6a44` is deployed. Health at
18:09 Jakarta reports 49 application tables and healthy D1/public/private R2.
Unauthenticated analytics and export routes return 401. Hosted HTTPS hashes of
`commerce-analytics.js`, `analytics.css` and `admin.js` match `1201985`.
This confirms served assets; Hostinger's signed-in deployment view and hosted
merchant acceptance are not claimed while shared Chrome is disconnected.

Remote aggregate reads confirm all six export guards, zero export receipts/rows
and zero operational orders, customers, captures, reservations, shipments and
provider jobs. The 15-entry legacy receipt and manifest
`ba180208c85cea72b82323b7b917e0e3771b143d930f5220665fddffc62777c0`
remain unchanged. The central flags remain disabled. The hourly schedule is
unchanged; it now also performs bounded export cleanup. No production database,
Worker, storefront or main-branch change is part of this delivery.

All three existing central order-manager browser cases and all three central
dashboard browser cases also pass through the updated shared PHP proxy.
