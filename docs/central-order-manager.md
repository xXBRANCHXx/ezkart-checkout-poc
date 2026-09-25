# Central merchant order manager

The central order manager reads authoritative D1 orders with server-side search,
payment/fulfillment/date filters, keyset pagination, full-store totals and saved
order details. It replaces the private-file/200-row manager when PHP central
commerce is enabled. A signed-in TEST merchant can inspect the prepared workspace
at `?page=orders&order-preview=1` while checkout remains on the existing rollout.
The preview cannot change storage mode or activate a provider.

This stage does not switch hosted checkout or promote the private legacy import.
Dashboard, analytics, payment and customer read adapters still require cutover.
The whole application must not enable central commerce until those adapters,
operational migration, monitored dispatch and the other acceptance gates pass.

## Reads and isolation

| Method | Merchant route | Result |
| --- | --- | --- |
| GET | `/v1/commerce/orders` | Filtered page, matching count, all-store counts/amounts, queue totals |
| GET | `/v1/commerce/orders/:id` | Saved customer, item, address and price snapshots; captures, activity, inventory state, pending-operation summaries |
| GET | `/v1/commerce/orders/:id/captures` | Older verified payment records |
| GET | `/v1/commerce/orders/:id/activity` | Older order events, without raw event payloads |

Every route authenticates the merchant and resolves its active seller on the
server. Seller and commerce environment are never chosen by query parameters.
Viewer accounts may read; these routes accept no mutations. The PHP proxy
preserves authorization/CSRF boundaries and admits only these bounded read paths.
Unauthenticated reads fail, and another seller's order/history returns 404.

The list accepts `state`, `queue`, `q`, `from`, `to`, `order`, `limit` and `cursor`.
Search covers the saved order reference, customer name/email/phone, item names,
SKUs and option names. Punctuation is literal; it is never interpolated as SQL.
Text matching uses SQLite's case-insensitive ASCII `lower` comparison; broader
Unicode search and indexed full-text search remain future scale improvements.
Dates are validated calendar days in Asia/Jakarta, with inclusive through dates
converted to an exclusive UTC bound. Expired, cancelled, partially refunded and
refunded states are explicit instead of being relabeled as failed.

Pages contain at most 50 orders (25 in the UI). The first read records an insert
watermark. Cursors bind that watermark, seller, environment, filters and the
created-at/ID position. Equal timestamps remain deterministic, and a new order
cannot slip into a later page, including an insertion with an older timestamp.
Server-provided cursors support both Next and Previous after a reload or a shared
link while preserving the same set. Refresh
starts a new set. Existing payment and shipping states remain live: this is not
a historical snapshot of mutable order states. Matching/all-store totals are
computed in D1 over the complete captured set, independently of page size.

All-store counts, matching count, queue counts and one page are read in one D1
batch. Order details, their item snapshots, inventory and initial histories also
use one batch. Capture and event histories have independent bounded cursors and
insert watermarks. Metadata, provider request IDs, payment-account instructions,
service credentials, raw event JSON and customer authentication IDs are omitted.
Only `commerce_version=1` operational orders are included; immutable import
rehearsals and unresolved/demo legacy history are not presented as new sales.

Confirmed totals count the primary verified capture once per order. Additional
captures are retained separately for review. Aggregate rupiah amounts are
decimal integer strings from SQLite, formatted with JavaScript `BigInt` so a
large history cannot silently lose precision. These are gross payment records;
the read workspace does not calculate available funds, refunds or settlement.
Unknown provider outcomes and active stock/payment/shipment conflicts enter the
attention queue. A retired payment-create job after an early verified payment
does not make a paid order require review. Shipment-job concerns use the current
shipment attempt, not a superseded pickup.

Migration 0018 adds scoped order, item, capture, operation and event indexes. It
adds no operational rows, provider jobs or financial entries. Search across
saved item/customer text still scans a seller's candidate set; keyset pagination
does not imply a full-text index or measured high-volume production capacity.

## Merchant behavior and verification

The manager preserves applied filters in the URL, supports Next/Previous,
reloadable order links, independent history loading and the header search field.
It shows loading/error/empty states explicitly. A failed page read retains the
previous page and retries the same position. Late responses cannot replace newer
filters or selected details, including the initial list for an order link.
Unapplied filter edits cannot change pagination or the saved view URL.
A central read failure never loads private files
into this workspace. Saved addresses/prices remain visible after catalog edits.
Fulfillment, stock review and returns use their existing authorized workspaces.

Six real-D1 cases cover authentication, viewer access, seller/history isolation,
226 records with tied timestamps and a late insertion, exact large totals,
literal search, date boundaries, terminal states, original snapshots, duplicate
payments, queues and independent history pagination. Three PHP/browser cases
cover the actual proxy and Worker, desktop/mobile navigation, reload, failed-page
retry, central-read outages, legacy-file exclusion, XSS text rendering and stale
list/detail responses. Screenshots are inspected at 1360 and 390 pixels.
Additional checkout/fulfillment/import and existing merchant UI regressions are
recorded in the completion plan.
