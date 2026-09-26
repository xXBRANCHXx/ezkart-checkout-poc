# Campaign visits, conversion and verified payments

Marketing now offers **Visits and verified payments** alongside the existing
delivery and permission report. It uses immutable publication copy, anonymous
campaign visits, durable order attribution and verified payment captures.
Scheduled and cancelled publications remain visible; later draft edits do not
rewrite their names, subjects or publication dates.

## Reporting dates and definitions

Periods, store timezones, publication boundaries, pagination and comparison
dates follow [campaign-reports.md](campaign-reports.md). The selected dates are
**publication dates**. Outcomes include all recorded activity for those
publications as of the read, including later payments. They are not sales
restricted to the selected payment dates. Older publication cohorts have had
longer to convert. Refresh updates outcomes; an export preserves one snapshot.

| Metric | Meaning |
| --- | --- |
| Campaigns with tracked links | Publications with a mapped link and a durable send-start receipt |
| Campaigns with older untracked links | Publications with an older started message whose store button has no tracking mapping; a mixed publication can also have tracked links |
| Recorded link visits | Recorded anonymous link requests, including repeated navigation and possible automated email checks |
| Visits without measurement | Requests beyond the recorded-visit limits; these still open the store without an attribution reference |
| Attributed checkouts | Orders created with a valid, owned campaign visit reference |
| Verified paid orders | Attributed orders with an exact primary `order_payment` capture matching order ownership, environment, amount and IDR currency |
| Visits with a paid order | Distinct attributed visit hashes with at least one verified paid order |
| Visit conversion | Visits with a paid order divided by recorded visits; zero recorded visits displays an em dash |
| Gross paid | Primary captured amounts for those verified orders |
| Gross product sales | Their immutable product subtotals |
| Paid shipping | Their immutable shipping amounts |
| Additional payments for review | Additional captures on attributed orders, excluded from gross sales |

A repeated callback, multiple recipients or several orders from one visit do
not multiply conversion or payment totals. An order marked paid without a
primary capture is excluded from verified sales. A subsequent refund does not
erase gross paid: these figures are before refunds, provider fees and other
costs, and are not net revenue, settled balances or withdrawable funds.

Attribution follows the current reference for seven days as documented in
[campaign-attribution.md](campaign-attribution.md). Direct later navigation
without it is unattributed. Older untracked messages and requests beyond the
measurement limits are excluded from conversion. Neither recorded visits nor
conversion measures unique people, email opens or proven human engagement.

## Integrity and exact amounts

Each read aggregates visits and orders separately in one database snapshot,
then joins their publication totals. Missing publication seals, audience jobs,
visit evidence or inconsistent order/payment ownership prevent reporting rather
than silently reducing totals. Actual corrupt evidence requires operator review.
The performance query checks audience integrity without computing unused delivery
outcomes. An order/capture-kind index bounds payment lookups to each order.

Monetary aggregation stays in SQLite integer arithmetic. APIs and saved CSV
cells use canonical decimal strings; the browser formats them with `BigInt`.
Amounts beyond JavaScript's safe integer range remain exact. Integer overflow
or invalid evidence fails the request; it never becomes a rounded sales figure.
No recipient email, account, order ID, visit hash/token or provider identifier
appears in report rows or exports.

## Complete exports and recovery

Performance has separate report references, export IDs (`cpex_`), tables and
browser recovery records. Existing delivery receipts and their 23-column CSVs
remain readable and unchanged. The new CSV has 19 columns: publication ID,
campaign ID, frozen name and subject, publication/scheduled times, cancellation,
the seven counts and four amounts above, and conversion percentage.

Creation admits an original request, saves every matching row and finalizes its
exact contiguous row count in one transaction. Lost acknowledgements, concurrent
retries and interrupted pages recover that same snapshot. Later payments,
filter changes, switching report views or reloading cannot replace it. Current
store membership is checked for creation, recovery and every page, including
viewer access. Report access does not activate sending or central commerce.

The browser verifies receipt identity, account/store/environment, headers,
ordinals, amount strings, conversion and final row count before downloading.
Corrupt storage, mismatched receipts and partial pages retain recovery data and
produce no partial CSV. Spreadsheet formula prefixes are escaped. A completed
download or confirmed expiry permits an explicit fresh export.

Snapshots remain available for 24 hours, with twenty new snapshots per
store/environment/hour. Exact retries recover before the new-snapshot limit or
cohort expiry check. Hourly maintenance removes at most 5,000 expired rows and
100 empty expired headers per invocation. A cleanup race cannot produce a
successful truncated export.

| Route | Input |
| --- | --- |
| `GET /v1/commerce/marketing/performance` | `range`, custom `from`/`to`, or original `cohort`; next page adds `cursor` |
| `POST /v1/commerce/marketing/performance-exports` | Exact `{cohort,requestKey}` JSON, maximum 3 KB |
| `GET /v1/commerce/marketing/performance-exports/{cpex_id}` | Optional `after` ordinal and `limit` (1–500) |

Worker and PHP routes enforce current membership, store/environment scope,
strict methods/parameters and no-store responses. PHP also binds CSRF/account
identity and rechecks the session after the Worker response. Migration 0040
adds two tables, three indexes and six guards without changing existing records,
schema objects or service/provider settings.

## Validation and acceptance boundary

The final backend report run passes all thirteen new performance cases and
fourteen existing delivery-report cases. Coverage includes real fixture orders,
primary and additional payment callbacks, refund states, repeated visit
conversion, date/frontier boundaries, legacy mixed link coverage, exact large
amounts, malformed evidence, scope changes, transaction rollback, concurrent and
uncertain exports, retention and populated migration. The focused legacy
attribution and indexed payment-query checks also pass.

All eighteen performance/delivery PHP/browser cases and twenty-five existing
marketing, publishing, investigation and proxy cases pass. Desktop and 390px
workflows cover report selection, universal filters, recovery, membership loss,
spreadsheet safety and complete downloads. Final visual verification corrected
narrow metric cards that split a currency amount mid-number. Syntax, diff and
TEST dry-run checks pass.

The fresh private TEST backup is 592,629 bytes with SHA-256
`21babb0c2fc583cbd89a6fa99230afb4d9d8cd805ee2d4c636866b163d503ce2`.
It restores every row in 119 existing physical tables unchanged, with valid
integrity and no foreign-key errors. Migration 0040 adds eleven objects, changes
no existing object, and all 77 accumulated compatibility query plans compile.

Provider responses and signed-in local workflows use isolated fixtures.
Marketing automation, signed-in hosted/provider acceptance, monitoring and
sustained capacity/recovery validation remain open. All thirteen workbench
completion gates and existing sending, central-commerce and production holds
remain open. This report does not establish settled money or release readiness.

## TEST rollout, 27 September Jakarta time

Implementation `1eba342` is pushed to `agent/ezkart-workbench`. Migration 0040
is applied and TEST Worker `557297dc-3dd6-4cdb-9511-3a06f7a769ec` is deployed.
All 44 Worker health/access/hold checks pass at 21:45:47 UTC on 26 September.
The current TEST database has 120 application tables and no pending migrations.

Hostinger serves all eight checked assets exactly as committed, with the last
modified times 21:46:19–20 UTC. After the initial probe observed the preceding
deployment, the next check confirms all assets at 21:47:20 UTC and all 23 hosted
access/unsubscribe/link guards at 21:47:21 UTC. These are public and unauthenticated
checks in an independently launched browser, not signed-in merchant acceptance.

Post-deployment comparison preserves all prior table counts, seller settings
and the legacy import manifest. All eleven added schema objects match the
restored backup; foreign-key checks are clean and all 77 query plans compile.
Both new export tables remain empty. Verification created no hosted campaigns,
messages, visits, orders, payments or exports, and changed no provider flags.

The shared-browser status still reports the prior timed-out connection, with
six attempts and no new attempt during this delivery. Signed-in hosted checks
remain pending. Main, production and draft PR #3 are untouched.
