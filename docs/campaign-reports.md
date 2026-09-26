# Campaign delivery and permission reports

The Marketing workspace reports outcomes across published campaigns using the
immutable publication copy and audience. Later draft edits, archiving and send
schedule changes do not change the publication date or published name/subject.
Scheduled and cancelled publications remain visible. Drafts are excluded.

## Periods and outcomes

Choose 7, 30, 90 or 180 days, all history, or inclusive custom publication dates.
Dates use the store's Jakarta, Makassar or Jayapura timezone. A report reference
retains that timezone, period, publication timestamp and insertion boundary for
24 hours. Later settings changes or publications cannot shift its membership.
An equal-length preceding period supplies the comparison; all history has no
comparison. Publication groups are daily, weekly (Monday), monthly or yearly
according to the period length. Twenty campaigns appear per page.

Each report read aggregates one database snapshot. Outcomes remain live between
reads/pages; the workspace retains already loaded rows after a failed page and
ignores late results for a replaced period. Refresh obtains current totals.
The complete CSV described below preserves one immutable snapshot.

The report separates recipients, submitted mail, confirmed delivery, queued and
active sends, retries, cancelled recipients, known unsent messages, unconfirmed
submissions, unresolved reviews, delays, failures, bounces, complaints,
suppression and withdrawals through campaign email links. It uses the same
verified callback/provider investigation evidence as the recipient workspace.
Provider acceptance is not a delivery confirmation. An unresolved submission is
not evidence that mail was never sent. A missing sealed audience or recipient
job fails reporting closed instead of silently lowering the audience count.

Recipients count once within each campaign and again in another campaign.
Confirmed delivery is retained after later adverse evidence, so totals can
overlap. A campaign-link withdrawal counts once per recipient per campaign,
even if the recipient later grants permission and uses the link again. Direct
Email preferences changes are not attributed to a campaign link. Reports and
CSV rows contain no recipient addresses, account IDs or unsubscribe tokens.

## Complete exports and recovery

Before export, the browser preserves an account/store/environment-bound cohort
and random request key in session storage. One D1 batch admits the request,
materializes every matching publication row, and finalizes its exact row count.
Rows contain published identity/copy, captured send schedule/cancellation and
all sixteen outcome counts. Exporting is available to current store members,
including viewers, and remains a reporting operation while sending is held.

A receipt pins the original period, headers, creation/expiry time and row
count. Reads return contiguous pages of up to 500 rows (250 by default).
Database guards prevent replacement, mutation, incomplete finalization and
deletion before expiry. Twenty new exports per store/environment per hour are
allowed; exact retries recover the existing result before applying this limit
or revalidating an expired cohort. Current membership is always checked.

Lost or mismatched acknowledgements retain the original request across reloads.
An interrupted download starts again from the same snapshot. The browser checks
receipt identity, scope, column layout, every ordinal and publication identity,
and the final row count before offering a file. It never downloads a partial
CSV. Formula-like strings receive a literal prefix, including invisible and
compatibility-character prefixes, while preserving the original text.

Corrupt or unreadable browser storage is retained and blocks a new export. A
confirmed expired snapshot or a completed download enables an explicit fresh
export; changing report filters alone never replaces an unresolved request.
Account changes remove the private workspace and suppress late downloads.
The existing hourly maintenance cron removes at most 5,000 expired rows and
100 empty expired headers per pass. A cleanup race cannot turn missing rows
into a successful download.

## Routes and schema

All routes use current merchant authentication, store binding and no-store
responses. The PHP proxy also checks account, CSRF, origin for writes and the
unchanged signed-in session after the Worker response.

| Route | Input |
| --- | --- |
| `GET /v1/commerce/marketing/reports` | `range`, custom `from`/`to`, or original `cohort`; next page adds `cursor` |
| `POST /v1/commerce/marketing/report-exports` | Exact `{cohort,requestKey}` JSON, maximum 3 KB |
| `GET /v1/commerce/marketing/report-exports/{crex_id}` | Optional `after` ordinal and `limit` (1–500) |

Unknown/duplicate query parameters and extra write fields are rejected.
Migration `0038_campaign_reports.sql` adds two tables, two indexes and six
guards; it changes no existing records, views, triggers or provider settings.

## Acceptance boundary

Worker coverage includes real campaign jobs, sends, signed callbacks, verified
operator recovery, permission changes, exact date boundaries, historical copy,
cohort pagination, full exports, failed/uncertain commits, receipt replay,
membership races, immutable records, expiry/cleanup and a populated migration.
The real PHP/browser workflows cover desktop and 390px layouts, universal
dropdowns, period comparison, spreadsheet quoting, export page interruption,
reloads, corrupt storage, malformed receipts, stale reads and session changes.
Provider responses and authenticated browser workflows here use isolated
fixtures; they do not establish actual provider/domain or hosted acceptance.

Campaign-to-order attribution is documented in
[campaign-attribution.md](campaign-attribution.md); verified conversion and gross
payment reporting with separate complete exports is documented in
[campaign-performance.md](campaign-performance.md). Automation triggers,
signed-in hosted/provider acceptance, monitoring and sustained capacity/recovery
exercises remain open. These reports do not complete the full marketing gate or
any production release gate.
