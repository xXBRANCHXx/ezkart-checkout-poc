# Seller Campaigns

Campaigns is a separate seller workspace at `/cart/admin/?page=campaigns`.
Analytics and Marketing keep their existing pages and data models. Marketing's
email publications are separate from these seller-named tracking campaigns.

## Workflow

Start a campaign with one or more existing landing pages. Each included page can
have up to 40 source URLs, with free-text source names (no traffic taxonomy).
Source names are unique within a campaign/page; the same name can be used on
other pages. Database triggers enforce the 40-link limit under concurrent saves.
Every URL has an opaque, independent identifier. Create and source-save requests
are idempotent; the UI preserves unconfirmed requests across reloads in the same
tab. End is idempotent and final. Existing links continue to open their page after
ending, but create no new campaign attribution.

Campaigns retain their original page names and paths for historical context.
Draft pages can be included, but their URLs become usable only after publishing.
Deleted/unpublished/held landing pages keep their reporting history and remain
subject to the existing public-hosting rules.

## Definitions

- Visitors: distinct tracked visits with a recorded landing `page_view`.
- Unique visitors: distinct anonymous browser-cookie IDs, hashed and scoped to
  seller/environment. This is not cross-device person identification. Cookie
  blocking, clearing and automated browsers affect these counts.
- Orders: attributed orders with a server-verified `order_payment` capture.
  Client events cannot create paid orders or monetary values. Extra captures do
  not multiply orders, units or sales.
- Sales: gross paid product subtotal, excluding shipping, before refunds/fees.
  AOV is sales divided by paid orders; units use saved paid order lines.
- Conversion: visits with a paid order divided by recorded landing visits.
- Checkout completion: checkout visits with a paid order divided by checkout
  visits. Multiple orders in a visit do not inflate either conversion rate.
- Abandoned checkouts: checkout visits without a paid order once the 24-hour
  visit window expires, or at campaign end. Still-open visits are not abandoned.
- Time: cumulative foreground time from each document, sent every 15 seconds and
  on visibility/exit. Per-document maxima prevent heartbeat duplication; sums
  include landing and checkout documents. Abrupt closes and blocked requests
  can undercount. Overlapping foreground windows can overcount human attention.
- Funnel: distinct visits with each observed step, including server-verified
  completion. Steps are independent; digital orders skip shipping, and browser
  event gaps can make the funnel non-monotonic. Drop-off is shown only when the
  previous observed step is nonzero and at least as large as the next.

## Campaign windows and attribution

The active reporting window is the server start instant through the saved end
instant (or the report's current observation instant for active campaigns).
Both order creation and payment verification must fall within that window.
Payments verified after ending are excluded, even for checkouts begun earlier.
Daily averages use inclusive calendar dates in Asia/Jakarta: September 1–18 is
18 days forever. This is explicitly labeled in comparisons; same-day campaigns
use one day. Rates are recomputed across visits, not summed from source rates.

Each link opening starts a 24-hour anonymous visit. Its bearer reference follows
the hosted landing page's checkout return URL into the original immutable
checkout intent. Order insertion atomically binds attribution only for the same
seller/environment, a currently active campaign, and an unexpired visit. A retry
cannot retag an existing order. Direct untagged later visits are unattributed.
Public-hosted landing pages are instrumented without changing saved builder
content or relaxing the authored HTML sandbox. Preview pages are not tracked.

## Event storage and boundaries

Migration `0083_tracking_campaigns.sql` adds separate campaigns, page snapshots,
sources, visits, raw events and order-attribution tables. Raw events are retained;
there is no automatic expiry deletion of these reporting records. Visit expiry
closes attribution/event intake rather than deleting history.

Additional stored events: product interaction, add-to-cart, variant selection,
scroll depth, page exit, engagement heartbeats and payment-setup errors. Bounded
properties include product/variant IDs, foreground time, viewport dimensions,
load timing, phase and error code. Visit dimensions include coarse device/browser,
accepted language, referrer hostname and bounded UTM source/medium/campaign.
Never collect arbitrary form fields, customer text, addresses, full referrer URLs,
IP addresses or payment credentials in these event records. Version fields allow
future interpretation. Payments and other commerce evidence stay in their existing
server records.

Events are replay-safe by event ID, limited to 2,000 per visit and 10,000 visits
per source/hour. Measurement is best effort: failure or a protection limit must
never prevent shopping. Public events require an unguessable valid visit token;
PHP forwards them through the existing signed service boundary. Anonymous events
are behavioral evidence, not proof of a person or payment. Reports aggregate in
D1 and do not expose visitor identifiers or raw customer records to the browser.

## Verification and release

Backend coverage: ownership/environment scope, role checks, page ownership,
idempotent saves, duplicate source labels, simultaneous limit-boundary requests,
per-page source independence, event deduplication, cross-page unique visitors,
verified payment/order attribution, late-payment exclusion, ended windows, and
inclusive Jakarta dates.

Browser/PHP coverage: create/select pages/add sources/end/compare, original-save
recovery, retained Analytics navigation, desktop and 390px layouts, sandboxed
landing instrumentation, checkout return-link propagation, PHP signed event
forwarding, immutable checkout retries and verified paid reporting. Existing
landing-hosting, email attribution, checkout and Analytics tests provide regression
coverage. Screenshots are local fixtures, not merchant traffic or live payments.

Only workbench/test and beta are eligible for this change. `main` and `ezkart.id`
remain under the recorded production release hold. This feature adds analytics;
it does not activate providers, send messages or initiate real payments.

### 29 September 2026 validation

- 3 campaign backend tests and 3 browser/PHP campaign tests passed.
- Landing-hosting regression passed, including tracking query preservation and
  isolation when hosting headers are replaced.
- 52 existing commerce-order, email-attribution and Analytics checks were run:
  51 passed initially. The remaining Analytics test seeded a production-mode
  row without the now-required declared onboarding. Its fixture was updated to
  complete the existing onboarding flow; the isolated rerun passed. No Analytics
  implementation change was needed.
- PHP lint, JavaScript syntax checks, Worker bundle checks and `git diff --check`
  passed. Desktop and phone screenshots were inspected.
- Beta migration 0083 applied successfully. The old sandbox backend has unrelated
  pending migrations and was left on its historical runtime. Current workbench
  delivery targets the beta backend, with its existing runtime variables preserved.
- Beta Worker version `e086ec37-04d5-4d8c-931b-530a6d42322c` deployed;
  its plaintext runtime variables were compared with the previous deployment and
  preserved. Health reports all three storage checks healthy and 219 tables;
  unauthenticated Campaigns API access returns 401. No beta migrations remain.
- Feature commit `9f76974` was pushed to both origin and the workbench deployment
  mirror. Follow-up UI polish keeps the selected status visible, removes stale
  comparison selections after refresh, and wraps long source names/URL fallbacks.
