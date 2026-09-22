# Merchant analytics

The Analytics overview links to dedicated Revenue, Orders, Payments, and Products
reports through `?page=analytics&report=…`. The report navigation preserves the
selected date range and chart grouping. Each report has a CSV download; detailed
tables support server-side search, sorting, and pagination in groups of 20.
Payment methods and order-status breakdowns link to the matching report records.
Individual order links open the actual order or its Payments entry.

## Data and definitions

- Records are scoped to the authenticated active seller before aggregation or
  export. Legacy owner access retains its existing demo-order scope. An identity
  failure shows an unavailable state and blocks export rather than showing zeros.
- Every report uses **order creation date in Asia/Jakarta** and current payment
  and fulfillment status. This is an order-cohort report, not a cash-settlement
  statement. A later payment updates the period in which its order was created.
- Revenue is the total on paid orders, including shipping. Product payments use
  saved order subtotals. Average paid order is revenue divided by paid orders.
- Payment rate is paid orders divided by all orders; failure rate uses failed
  orders. Undefined rates and averages appear as `—`, not zero. Median time to
  pay uses only orders with a paid timestamp at or after creation and shows its
  sample size. Pending and creating orders contribute to unresolved value.
- Products aggregate stable product IDs resolved from the seller catalog or saved
  snapshots. Variants contribute quantities and value to the same product but
  count an order only once. Item values use the saved line prices and quantities;
  they may differ from order subtotals when adjustments apply. Product and buyer
  images use the existing real-image/profile resolvers.
- Fulfillment uses the shared dashboard queue classification. A courier booking
  is processing until pickup, delivered orders leave the shipped stage, and
  sandbox shipping skips are identified separately.

Presets are 7, 30, 90, and 180 days, plus all history or inclusive custom dates.
The current day is included. Invalid custom dates show an error and the default
30-day range. Undated records are excluded with a count; future-dated orders are
excluded. Previous periods have the same number of days immediately before the
selected period. All-time views have no comparison. Grouped comparison buckets
align by elapsed day, so partial calendar months do not compare different spans.
Daily grouping is available up to 90 days; periods longer than 730 days use months.

Charts provide pointer inspection, a keyboard-operable range control, and a data
table with exact amounts. An isolated previous-period data point remains visible.
CSV exports contain all report rows, independent of table filters or pagination,
and escape untrusted spreadsheet formulas. Files use numeric IDR amounts and
include the report date range.

No traffic, advertising attribution, profit, refund, or provider settlement metrics
are manufactured from order records. Report definitions explain these limits.

## Verification

`tools/checkout-test/checkout.test.mjs` covers Jakarta boundaries, invalid and
empty periods, comparisons, variant grouping, real images, payment timing,
authenticated exports, seller isolation, formula escaping, detail navigation,
table filtering/pagination, and desktop/mobile layouts. These fixtures validate
application behavior; they do not simulate provider settlement or traffic feeds.
