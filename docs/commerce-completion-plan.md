# Workbench completion and acceptance

Owner instruction, 25 September 2026: complete the full workbench audit scope to
a production-quality commerce standard. Optional features are to be implemented,
not hidden to make the launch checklist smaller. Work stays on
`agent/ezkart-workbench` and `test.ezkart.id`. The production release hold and the
roughly one-month financial validation period remain in force.

## Completion evidence

An item is complete only when the implemented behavior, its adversarial tests,
and the relevant hosted merchant/customer workflow are verified. Fixture tests
do not establish provider activation, delivery, settlement or operational history.

- [ ] Authoritative D1 orders, customers, items, payments and fulfillment; private
  legacy-order migration with counts, totals and ownership checked; no silent
  file fallback after cutover.
- [ ] Atomic inventory reservations, payment consumption, expiry release,
  cancellation/return adjustments, variant integrity, concurrent checkout and
  merchant-edit conflict protection; auditable stock counts and adjustments.
- [ ] Idempotent checkout, signed provider events, explicit pending/failed/expired
  states, late and out-of-order notifications, refunds/partial refunds, returns,
  reconciliation and recoverable provider/network failures.
- [ ] Seller pickup addresses and contacts, authoritative shipping quotes and
  immutable order origin snapshots, merchant acceptance, pickup, tracking,
  cancellation, return handling and delivery evidence. Biteship account balance
  and live Order API readiness must be verified independently.
- [ ] Immutable fee snapshots, actual provider fees, balanced wallet ledger,
  settlement/delivery release, reserves, withdrawal limits, owner verification,
  payout idempotency, failures/retries, refunds and reconciliation. No estimate
  or sandbox delivery skip may become available funds.
- [ ] Persisted merchant identity/contact/region/notification settings used by
  the storefront and operations; reliable transactional notification delivery,
  retry records and delivery failures visible to operators.
- [ ] Customer profiles, export, saved segments, reviews and their merchant and
  customer workflows, with authorization and consent enforced.
- [ ] Working campaign creation, audiences, scheduling, automation triggers,
  consent/unsubscribe, delivery tracking and meaningful performance reports.
- [ ] Persistent buyer/seller messaging, conversation authorization, attachments,
  unread state, saved replies and honest response statistics.
- [ ] Advanced custom domains and richer analytics with actual entitlements,
  domain ownership/TLS validation, accurate measurements and usable reports.
- [ ] Digital file upload/delivery and customer-bound download authorization;
  subscription billing lifecycle, entitlements, cancellation and failed renewal
  handling with supported provider capabilities.
- [ ] Accurate public product claims and pricing, terms/privacy/support surfaces,
  complete fresh-seller onboarding, seller isolation, accessibility and mobile
  acceptance, backup/restore evidence, monitoring and operational recovery.
- [ ] All applicable suites and hosted end-to-end tests pass on an identified
  release candidate. Sustained financial/wallet validation is recorded. DOKU
  approval, supported production payment/payout acceptance and explicit final
  owner release authorization remain separate gates.

## Implementation sequence

1. Central orders and inventory, authenticated server-to-server commerce API.
2. PHP checkout/callback/admin cutover, legacy import and data reconciliation.
3. Shipping settings and full fulfillment lifecycle.
4. Wallet, financial ledger and reconciliation.
5. Merchant settings, notifications, customer operations, messaging and marketing.
6. Advanced domains/analytics and digital/subscription commerce.
7. Hosted acceptance, recovery exercises and sustained operational validation.

Each delivery must update this record with actual evidence and outstanding work.
Intermediate commits do not certify the whole workbench as ready.

### 25 September: central dashboard reporting

Implemented authenticated D1 dashboard reporting and a merchant workspace for
operational queues, complete-cohort totals, payment trends, recent orders,
product/customer activity and fulfillment context. Reporting periods use Jakarta
order dates; operational queues remain independent of dates. Verified gross
payments, additional captures and unpaid order values remain separate. Saved
item prices determine product totals. Money retains exact integer precision.

The five D1 cases and three PHP/browser cases pass, alongside six adjacent order
read cases, three order-manager browser cases and five existing dashboard and
analytics regressions. The populated browser workflow is inspected at 1360 and
390 pixels, including responsive charts and readable card explanations. Failure,
retry, stale-response, reload, browser-history and order-link behavior are
covered. See [central-dashboard.md](central-dashboard.md) for the read contract.

The workspace is prepared behind the PHP central flag with a read-only TEST
preview. Analytics/payment/customer reads, operational migration and monitored
execution still need completion before the storage switch can be enabled. No
top-level workbench acceptance item is closed by this intermediate stage.

### 25 September: central merchant order manager

Implemented the D1 order-read service and merchant workspace: all-store totals,
server filters, bounded keyset pages, saved commercial/customer/address details,
verified captures, inventory state and paginated activity. Pagination includes
records beyond the old 200-row cap and preserves its insertion watermark across
Next/Previous and reload. Failed/stale responses cannot silently substitute other results.
Central read failures do not fall back to legacy files in this workspace.

Confirmed order payments and additional captures remain separate; monetary
aggregates retain exact integer precision. Authentication, seller/environment
scope and original snapshots are enforced on the server. Migration 0018 adds
read indexes only. The TEST preview is read-only and leaves hosted checkout and
the existing 15-source migration rehearsal unchanged.

The six D1 cases and three PHP/browser cases pass, including desktop/mobile
workflows through the real PHP proxy and Worker. All 43 adjacent Worker cases
(checkout, fulfillment and imports) and eight selected existing PHP/merchant UI
regressions pass. See
[central-order-manager.md](central-order-manager.md) for contracts and limits.
Implementation `3cb8187` plus shared-icon correction `004d748` is deployed to
TEST; Hostinger reports Completed/Current. Migration 0018 is applied and TEST
Worker `913fe317-193a-4c53-98dd-d0d6a3a1cfd4` is deployed. Authenticated
desktop/mobile preview, filter/reload, empty state and health checks pass.
Operational rows remain zero, all six read indexes are present and the 15-entry
legacy receipt is unchanged. The central storage switch remains disabled.
Dashboard, analytics, payment/customer read routing, operational legacy promotion
and monitored execution remain open. This stage does not close the top-level
central commerce or broader workbench acceptance items.

### 25 September: legacy writer drain and consistent source export

Implemented a private TEST freeze/resume controller and a shared PHP writer
gate. Checkout and tracking retain their lease across provider requests;
callbacks, pickup, acceptance and customer ownership claims participate too.
New writes receive retryable responses while a freeze drains admitted work.
The controller exports the complete original byte set, records its digest and
keeps recoverable operation receipts. Old requests cannot reopen a later freeze.
No public endpoint or central activation command is added. Explicit source
configuration prevents CLI execution from exporting a guessed temporary folder.

Eight final PHP/concurrency/browser cases pass, including provider barriers,
crashed writers, controller conflicts, export-before-receipt recovery, damaged
controls, privacy, callback retry responses and cart preservation at desktop
and mobile widths. Ten migration/CLI cases pass, now including D1 retention of
the complete-source fence. The 104-case checkout/fulfillment/shipping regression
run passed 101 initially; all three failures passed targeted rechecks after
removing an unintended directory creation from read-only central routing and
updating one older tracking assertion to include the existing scan status field.
PHP lint (40 files), JavaScript syntax and whitespace checks pass.

Pushed implementation `5ff91a7` to the workbench branch. Hostinger reports
`5ff91a72` Completed / Current (25 September, 16:05 as displayed; 37 seconds).
The authenticated dashboard and orders page load with all 15 legacy orders.
Checkout configuration is HTTP 200, sandbox, `durable_checkout:false`; the new
checkout script is served and both private controller PHP files return 404 over
HTTP. Browser health checks report 47 tables and healthy D1/public/private R2.

The hosted source remains open in legacy mode; this stage does not perform a
live freeze or alter the existing 15-source D1 rehearsal. Final-set reconciliation,
durable operational promotion, central merchant/customer reads and callback
recovery remain required. The existing central flags and provider schedule stay
unchanged, and no top-level completion item closes. See the procedure and limits
in [legacy-order-migration.md](legacy-order-migration.md).

### 25 September: private legacy-order audit and import rehearsal

Implemented and rehearsed the immutable legacy source import in TEST. The audit
accounts for all 15 private sandbox order files, preserving their exact bytes,
references, customer fields and commercial amounts. Four orders contain a
seller ID; four older orders have matching historical store/owner/item evidence;
seven remain sandbox demo history. The two recorded paid orders are demos, with
Rp116,000 recorded paid out of Rp746,000 in total order value. Eight provider
expiry strings lack a timezone and remain explicitly flagged, without choosing
an expiry instant or changing their status.

Migration 0017 stores one immutable receipt, 15 source snapshots and 15 ownership
assessments. A second source read, exact D1 readback and replay passed. Database
guards reject concurrent ownership/SKU changes, conflicting provider references
and partial imports. The CLI recovered the first hosted import through its
original receipt after Wrangler returned a mixed-format response; it now uses
durable readback for write confirmation. No active orders, customers, captures,
reservations, shipments, provider jobs or stock changes were created.

The full 75-test Worker suite passed, followed by all ten final migration/CLI
cases and two final privacy/recovery checks. TEST health reports 47 tables;
central checkout remains disabled. The existing Worker version and provider
schedule remain unchanged. Production/main were not touched. Detailed source
counts, private artifact locations, hashes and procedures are in
[legacy-order-migration.md](legacy-order-migration.md).

No top-level completion item closes here. This is the migration rehearsal;
source-write fencing is implemented in the following stage recorded above, while
the final freeze, reconciliation, operational promotion and merchant/customer/
reference/callback cutover still need hosted verification and remaining
implementation. Refunds, wallet settlement, monitored dispatch and the broader
workbench scope above remain required.

### 25 September: seller shipping addresses and quote binding

Implemented the seller address book, separate pickup/return defaults, confirmed
map pins, courier preferences, versioned saves and immutable save history. The
merchant UI reviews changes, rejects stale edits and recovers the exact original
save after an unreadable response. Central rates use the seller's saved origin;
public quote results contain no pickup contacts. New order snapshots freeze both
addresses. Transactional guards reject a concurrent settings or package-weight
change before inventory or payment work is committed. See
[seller-shipping-settings.md](seller-shipping-settings.md) for contracts and limits.

Local D1 coverage includes concurrent saves/replays, authorization, malformed
addresses and courier choices, address deletion after checkout, stale quotes and
deterministic settings/weight races at reservation time. PHP and browser coverage
includes missing global settings, private-contact redaction, provider-rate
filtering, instant courier pins, rejected quotes during a seller move, stale edits,
lost-save recovery, session-storage failure and desktop/mobile controls. Hosted
acceptance is recorded below after deployment. Legacy-order migration, monitored
dispatch, order-read cutover and broader workbench acceptance remain outstanding.

Hosted acceptance for shipping implementation `cb0b200`:

- Exported a private mode-600 test D1 backup before applying migration 0016.
  Deployed test Worker version `48b75b28-dd87-407e-83f9-d083b52a5561`; health
  reports 44 tables and healthy D1/public R2/private R2 bindings. Production
  was not migrated or deployed.
- Hostinger reports `cb0b200e` Completed / Current for `test.ezkart.id` on the
  workbench branch. The served shipping JavaScript/CSS, admin JavaScript and
  shared address picker match their checked-in SHA-256 hashes.
- Created two explicitly labeled QA addresses through the hosted merchant
  controls, selected different pickup/return defaults, reviewed and saved them,
  and reloaded the page. Replaying the exact original PUT returned its revision-1
  receipt, retaining one save. Checked desktop and 390px layouts and the shared
  dropdown control, with no horizontal overflow.
- Removed both QA addresses through the same controls. The resulting empty
  address book is revision 2 with the original three courier preferences and
  two immutable change records. No pending browser request remains. The original
  product/variant stock-and-revision hash is unchanged:
  `2c9451612b88e613d4dc10bbba8f4b1305ee5de6395e24bf3a70f56049bebb64`.
- Remote aggregates are zero central orders/shipments and zero active shipping
  addresses. Checkout still reports `durable_checkout:false`; gated commerce
  writes return 503. No hosted payment, courier booking or stock reservation was
  created, and the hourly schedule remains unchanged.
- Verification passes: all 66 Worker tests, 21 central checkout/fulfillment
  integration tests, five shipping PHP/browser tests, eight relevant legacy
  checkout/address/browser tests, PHP/JavaScript syntax checks and the test build.
  Inspected local desktop/mobile address editors, map-pin controls, save reviews
  and saved settings. Provider activation and the central cutover remain separate.

Hosted map inspection exposed a merchant-page CSP restriction on the SDK worker
and tile service. The follow-up allows only the shipping page to use the required
worker and tile origin, and treats initial map-data failure as unavailable rather
than confirming an unrendered suggestion. The two shipping browser workflows,
a new unavailable-map test and three customer-address regressions pass; the
browser coverage now checks CSP violations as well as JavaScript errors.

Hostinger reports follow-up `06debd7b` Completed / Current. The hosted shared
picker hash matches the correction. Verified real OpenFreeMap streets/buildings
and entrance confirmation in an isolated visible browser, with no browser errors,
and in the hosted 390px merchant dialog. The shared Chrome tab remains in the
background, so its QA render used a temporary timer-backed animation callback;
it was then reloaded to restore normal browser behavior. No new address was saved
during this map check. The book remains empty at revision 2, with two change
records and no pending operation.

Separate release finding: the hosted response exposes only
`Content-Security-Policy: upgrade-insecure-requests`, whereas the PHP origin
fixture delivers the application's detailed per-page policy. Hosting/edge header
handling needs investigation and deployed-policy verification before release.
This deployment does not certify the intended production security headers.

### 25 September: central commerce foundation

Implemented the D1 order/reservation migration, signed internal service, immutable
commercial snapshots, capture/event records, public available-stock projection,
deadline expiry and transactional outbox with worker leases, retry history and
reconciliation for uncertain provider outcomes. A PHP signing/transport client
is prepared. The existing hosted checkout has not yet been switched from files.

Tests exercise concurrent last-stock checkout, whole-order rollback, duplicate
and out-of-order callbacks, late payment after stock release, multiple real
captures, seller/environment isolation, expiry, exclusive job claims, stale leases,
retry limits and cross-language signatures. See [commerce-storage.md](commerce-storage.md)
for the contract and remaining cutover work. No top-level completion item is
checked off on the basis of this foundation alone.

### 25 September: merchant edits and reserved inventory

Added product revisions checked transactionally, including revisions advanced by
variant sales. Product saves retain variant identities while supporting reorder,
SKU swaps, hiding and adding/removing unreserved options. Holds prevent invalid
stock reductions and variant removal. Products with order history are archived
instead of deleted; viewer accounts cannot mutate the catalog or drafts.

The editor preserves the original revision in drafts, reports stale edits, and
opens a separate current-product draft for comparison. Publishing waits for an
in-flight autosave so it cannot recreate a draft after successful publication.
Local D1 tests cover concurrent saves, payment-versus-edit conflicts, transaction
rollback and seller/role boundaries. The browser workflow covers stale and legacy
drafts, desktop/mobile recovery, separate comparison tabs and the autosave race.
Inventory counts/adjustments, returns, stock-review resolution and the PHP order
cutover remain outstanding; no completion checkbox is advanced by this alone.

Hosted acceptance for commit `391af42`:

- Exported the test D1 database to a private local backup before applying
  migrations 0009 and 0010. Production was not migrated or deployed.
- Deployed test Worker version `cc05b087-bcff-4400-af8b-ed40afb8a36d`.
  `/health` reports D1 and both R2 bindings healthy. Central checkout remains
  disabled; the hourly maintenance schedule is not the future checkout-expiry
  service and must be tightened before cutover.
- Hostinger reports `391af426` completed for `test.ezkart.id` on
  `agent/ezkart-workbench`. Verified the deployed editor contains the new
  conflict handling.
- Created a clearly labeled QA product through the hosted merchant form with
  three uploaded images. A second save advanced its revision and changed stock
  from 10 to 8. Publishing the older editor returned HTTP 409 with
  `catalog_revision_conflict`, retaining its unpublished name and stock inputs.
  The fresh editor read 8 units and successfully published revision 3. Checked
  the conflict warning at 390px width with no horizontal overflow.
- Removed the QA product and its remaining draft; verified no QA records
  remained and both original products still had revision 1.
- Local verification: all 30 Worker tests, the product-editor browser workflow
  (including a held autosave), PHP syntax checks and the test Worker build pass.

### 25 September: inventory workspace and audit trail

Replaced the inventory-count toast with a full merchant workspace: paginated SKU
stock, reservations and availability, configurable alerts, counts, receipts,
damage/loss/corrections, account-saved count drafts and immutable history.
Adjustments commit all selected items together and use request keys to recover
uncertain outcomes without applying stock twice. Original product versions are
retained through count reloads; draft versions continue after clearing to protect
against stale tabs. Catalog mutations and payment consumption also record stock
movements. The former static health labels and 94/100 score now use inventory
and catalog data. The product archive/restore PATCH proxy is repaired and subject
to the same CSRF/MFA checks as other writes.

Verification covers a 100-option count, hidden options without duplicate product
totals, reservations, rollback, concurrent replay, role/seller isolation, draft
conflicts and immutable history. The browser workflow exercises saved counts,
stale stock, lost-response recovery, mobile review and history, and read-only
access. See [inventory-control.md](inventory-control.md) for behavior and API
contracts. Order-linked returns/restocking and late-payment stock-review
resolution remain outstanding, along with the broader commerce work above.

Hosted acceptance for inventory implementation `ad99e76`:

- Exported a private test D1 backup, applied migration 0011, and deployed test
  Worker version `9ab0f5f0-1d09-4213-8ef3-9a886bf633f1`. Health checks report D1
  and both R2 bindings healthy, with 30 tables. The hosted frontend serves the
  inventory workspace and its authenticated proxy. Central checkout remains
  disabled and the existing hourly schedule is unchanged.
- Created a disposable product through the hosted merchant form with three
  images and 10 units. A saved count of 8 survived a reload and reviewed as
  10 → 8 before applying. Replaying the exact submitted request returned the
  same receipt with one count movement and 8 units remaining.
- Received 2 units through the workspace, then changed the alert threshold
  from 15 to 3 on a 390px viewport. Stock remained 10 during the threshold
  update. Reviewed the mobile confirmation and immutable per-item history;
  no horizontal page overflow. Local browser screenshots also cover the full
  mobile stock/history cards and uncertain-response recovery.
- Archived and restored the fixture through the product card actions, proving
  the repaired PATCH proxy works on the hosted site. Deleted the fixture and
  confirmed no QA product draft remained. The submitted inventory draft is
  empty at revision 6; its version tombstone and five audit movements remain
  intentionally. A hash of all original product/variant quantities, hidden
  flags and revisions is identical before and after this acceptance run.
- Loaded inventory in pages of 50, 50 and 11: 111 options, 17 hidden, with
  147,510 physical units. Parent display totals are not counted again.
- Verification: all 34 Worker tests, the final targeted adjustment/draft tests,
  browser inventory and product-conflict workflows, PHP/JavaScript syntax
  checks and the test Worker build pass. The inventory browser fixture now
  also retains cleared-draft versions like the real API. Single-item review
  and confirmation wording was polished after hosted inspection.

### 25 September: late-payment stock recovery

Implemented a merchant review for paid orders whose stock holds were released.
The review compares original order items with current catalog identities and
available quantities. An explicit confirmation and note allocate every original
unit in one transaction, retain released reservations, write immutable stock
movements/receipts and advance fulfillment only when all stock is available.
Competing checkouts keep their reserved units. Versions prevent stale product or
order reviews; one resolution per order and request replay prevent double use.

Four D1 tests cover concurrent recovery, entire-order rollback, preserved holds,
renamed/hidden/archived options, missing original identities, payment concerns,
membership boundaries, paging and immutable records. The browser workflow covers
failed reads, shortages, stale reviews, retained notes, required reconfirmation,
mobile controls and a successful allocation with an unreadable response followed
by exact-payload retry. Inventory requests now time out and retain uncertain
operations for confirmation. The notification outbox supports recovery events;
actual delivery still requires its dispatcher.

This recovery write remains gated by the central checkout cutover. Local
fixtures establish transaction/UI behavior, not a hosted provider-paid order.
Return inspection/restocking, refund alternatives, hosted recovery acceptance
and the broader completion scope remain open.

Test rollout for recovery implementation `b063ecf`:

- Backed up test D1 privately and applied migration 0012. The combined Worker
  version is `531a8c5f-e2b4-4f5b-996d-e00f659f9eb2`, including the concurrent
  Advanced-mode cleanup update `2020e25`. That update was integrated by a clean
  rebase before the final push; its two Worker tests also pass.
- All 38 Worker tests passed before that unrelated integration. The final
  recovery notification-claim check and both inventory browser workflows pass.
  Desktop/mobile screenshots were inspected; the mobile allocation button stays
  visible while order items scroll. PHP/JavaScript syntax and the test build pass.
- Hostinger reports `b063ecfe` completed on the test branch. The hosted recovery
  JavaScript hash matches the checked-in asset, the authenticated review list
  returns no pending central orders, and the empty state renders correctly.
  Inventory still reads 147,510 units. Worker health reports D1/both R2 buckets
  healthy with 32 tables. This is a deployment smoke check, not a paid-order
  recovery acceptance run.
- Central checkout remains disabled. The recovery notification is a durable
  job, with no claim that it has been delivered. No hosted paid-order allocation
  or production release is certified by this rollout.

### 25 September: return requests and physical inspection

Implemented order-linked customer and merchant return requests, approval/decline,
withdrawal, partial/full inspection, and closing unused intake. Received and
saleable units are recorded separately. Atomic restocking preserves original
item identity, reserved quantities, immutable history and stock versions. Claims
bind a guest checkout to a verified Google identity once; customer API responses
exclude private warehouse notes and inventory balances. Both store and buyer
screens retain an uncertain request through tab reloads and sign-in failures.

The merchant Returns workspace is linked from Orders. The buyer section mounts
on tracking when central commerce is enabled. These writes remain gated while
the hosted PHP checkout is still file-backed. Notification jobs are durable and
claimable; their delivery is not yet implemented. Inspection never asserts that
a refund was issued or releases wallet funds. See
[returns-and-inspection.md](returns-and-inspection.md) for the state machine,
ownership, transaction and API contracts, tests, and remaining return/refund work.

No top-level completion checkbox advances on this implementation alone. Hosted
paid-order acceptance, return courier handling, evidence/disputes/policies,
refund execution/reconciliation and the broader workbench remain open.

Local verification: all 48 Worker tests pass, including nine return/ownership
tests and a 52-action paginated history. Merchant/customer browser workflows and
the customer PHP proxy tests pass, including reload and authorization failures
after an uncertain write. Existing inventory/recovery browser workflows, the
address-session proxy and tracking preview checks pass. Desktop/mobile screenshots,
PHP/JavaScript syntax and the test Worker build were checked. A private test D1
export was taken before migration; hosted rollout evidence is recorded separately.

Test rollout for return implementation `bad4c16`:

- Exported test D1 to a private local backup before applying migration 0013.
  Deployed Worker version `68328c35-7906-42f4-a6f4-ed8edae931c4`; health reports
  D1 and both R2 buckets healthy, with 37 tables. The existing hourly maintenance
  schedule remains unchanged and still needs replacement before checkout cutover.
- Hostinger reports `bad4c161` completed on `agent/ezkart-workbench`. Opened Returns
  through the hosted Orders navigation, checked its empty state and filter at
  1440px and 390px widths, and verified no horizontal overflow. Merchant and
  customer JavaScript/CSS hashes match the committed assets. The customer proxy
  correctly rejects an unauthenticated read.
- The authenticated queue returns no central return cases and explicitly reports
  `enabled: false`, `canCreate: false`. The creation control is disabled with a
  visible explanation. The internal order route still reports central commerce
  disabled. No fake paid/delivered order was created for hosted acceptance.
- Both original products retain their stock, variants and revisions. The before
  and after hash is identical, and inventory remains 111 options / 147,510 units.
  This rollout creates no hosted return or stock movement to clean up.
- This is schema/deployment/UI smoke evidence. Customer request, physical intake,
  notification delivery and refund acceptance on a real hosted paid order remain
  pending the central checkout/fulfillment rollout. Production remains untouched.

### 25 September: durable checkout and payment recovery adapters

Prepared the PHP central checkout, signed BCA callback, public payment-status and
verified-customer ownership paths behind the rollout flag. Checkout now recovers
the original intent before consulting a changed catalog or requesting another
paid shipping quote. Migration 0014 stores immutable provider instructions and
binds direct BCA accounts to the original provider request, including callbacks
that arrive before the creation response. Cross-store reuse of a checkout key
is rejected.

The central browser flow persists exact request bytes before sending, survives
reloads and lost responses, and uses a dedicated recovery view when an attempt
is unresolved. Its payment page distinguishes setup, bank instructions and a
validated hosted payment link. A configuration rollback cannot silently turn a
saved central attempt into a new file-backed payment. Unknown provider outcomes
retain their jobs and stock holds; a CLI dispatcher reconciles provider status
without treating a 404 as authorization to create again.

Local verification: all 53 Worker tests, all 10 new PHP/Worker integration and
desktop/mobile browser tests, both cross-language signing tests, and affected
legacy checkout/callback/payment/tracking tests pass. PHP/JavaScript syntax and
the test Worker dry run pass. Reviewed recovery, waiting and hosted-payment
screens at desktop and 390px widths. Provider calls in these tests are fixtures.

This does not check off a completion item. Hosted central checkout is still
disabled. Merchant order/fulfillment cutover, private legacy import, seller
shipping settings, dispatcher installation and monitoring, frequent expiry,
additional payment-channel adapters, missing-instruction recovery, refunds and
financial operations remain necessary. See
[checkout-payment-recovery.md](checkout-payment-recovery.md) for the contract and
specific limitations.

Hosted rollout of `228f584`:

- Exported the test database to a private local backup before applying 0014
  (242,357 bytes; mode 0600). The migration applied successfully to test only.
- Deployed test Worker `6229f248-31c9-4b57-9af9-8eb3b5210f52`; health reports
  39 tables and healthy D1/public R2/private R2. Central order creation still
  returns 503 because the rollout flag is disabled. The hourly schedule has not
  yet been replaced with the required frequent, monitored expiry service.
- Hostinger reports `228f584d` completed on `agent/ezkart-workbench`. The four
  checked frontend assets match their local SHA-256 contents. Hosted checkout
  config reports sandbox and `durable_checkout:false`.
- Existing checkout renders at 390px and 1440px with no horizontal overflow.
  The recovery helper loads, the normal checkout remains usable, an invalid
  payment link shows an explicit error, and the CLI dispatcher returns 404 over
  HTTP. A saved central request is refused with 503 while central mode is off,
  before any payment or file order can be created.
- Original inventory is unchanged: 2 products, 111 options, 147,510 on-hand and
  available units, zero reserved, 3 low-stock options. Catalog quantities and
  revisions retain hash
  `2c9451612b88e613d4dc10bbba8f4b1305ee5de6395e24bf3a70f56049bebb64`.
- Hosted acceptance here is deployment/guard/UI smoke evidence. No paid order,
  provider capture or return was fabricated, and production was not deployed.

### 25 September: central fulfillment and courier recovery

Prepared seller-scoped fulfillment queues, immutable merchant acceptance and
pickup actions, multiple linked shipment attempts after confirmed cancellation,
and an early-callback inbox. Shipment progress and fee/waybill timestamps are
reduced independently. A provider refresh cannot replace newer or pending courier
events. Conflicting progress on an earlier cancelled shipment places the order
under review without rewriting its newer attempt.

The PHP adapter uses saved addresses and packages, binds the first courier
credential fingerprint, verifies provider IDs against the original unique
reference, and reconciles lost create/cancel/storage responses. The bounded CLI
dispatcher processes durable jobs and drains pending matched events. Customer
tracking now reads owned central shipments, retains honest received-only times,
and exposes delivery proof only through authorized tracking.

The merchant workspace includes search/filter/pagination, items and saved
addresses, courier operations, reported fees, multiple attempts, full event
history, review dialogs, per-order request recovery, and desktop/mobile layouts.
No stock or financial effect is inferred from a carrier return or cancellation.
See [central-fulfillment.md](central-fulfillment.md) for the contract and remaining
operator and shipping workflows.

Local verification:

- The complete 61-test Worker suite passed. The final fulfillment checks passed
  all eight domain cases plus a deterministic ninth case that commits delivery
  between shipment/order reads, proving an older shipment snapshot cannot
  overwrite it.
- All 11 central courier PHP/integration/browser cases passed, including
  credential changes, early callbacks, lost create/cancel/storage responses,
  held orders, missing first events and immutable customer ownership. The ten
  central checkout/payment regressions also passed.
- Eight affected legacy checkout/merchant/courier cases passed. Three final
  customer tracking/map/walkthrough regressions and two final central visual
  cases passed after correcting the last-location map label and deduplicating
  repeated customer milestones.
- Desktop 1360px and phone 390px merchant action/detail screens and the customer
  tracking page were visually inspected. Recovery, keyboard dismissal, universal
  dropdown use, unavailable browser storage and horizontal overflow were checked.
- A private remote test database backup was saved before migration:
  `/tmp/ezkart-test-before-fulfillment-01a0d643.sql`, 246,211 bytes, mode 0600.
  Existing catalog stock/revisions still match
  `2c9451612b88e613d4dc10bbba8f4b1305ee5de6395e24bf3a70f56049bebb64`.

This stage does not close a top-level item. Seller pickup settings/quotes, legacy
migration and order-read cutover, monitored execution and notifications, shipping
exceptions/labels and split/scheduled packages, financial refunds and ledger work
remain. Hosted central order processing stays disabled during these changes.

Hosted test rollout:

- Committed/pushed implementation `1ad134d` on `agent/ezkart-workbench`.
  Hostinger reports `1ad134db` **Completed / Current** for `test.ezkart.id`.
- Applied only `0015_central_fulfillment.sql` to the test D1 database and deployed
  test Worker version `57afed4c-6f8d-4392-853f-eff7a46634ef`. Health reports 42
  tables and healthy D1, public R2 and private R2 bindings.
- The authenticated hosted fulfillment list returns 200 with zero rows,
  `enabled:false` and `canWrite:false`. An authenticated, CSRF-protected action
  against a nonexistent QA reference returns 503 before writing. The signed
  commerce entrypoint remains disabled; checkout configuration remains sandbox
  with `durable_checkout:false`.
- Five hosted frontend assets match their source SHA-256 contents. The CLI
  dispatcher returns HTTP 404. The merchant workspace and universal filter were
  checked at 1440px and 390px with no horizontal overflow and no actionable
  fulfillment controls while disabled.
- Remote aggregate checks show zero central orders, shipments, courier events,
  and fulfillment actions. No hosted test payment or pickup was manufactured.
  Catalog inventory/revision hash remains unchanged after QA.
- The hourly Worker schedule is unchanged; fulfillment/payment dispatch and
  timely expiry are still uninstalled/unmonitored cutover gates. Production and
  the main branch remain untouched.

## Atomicity contract

Commerce database changes use D1 transactional batches and database constraints,
not read-then-write stock checks. Orders keep immutable commercial snapshots and
replay keys. Provider network calls happen outside database transactions and
their results are recorded as idempotent events. A lost response must not create
a second charge, stock deduction, shipment, notification or payout.

Cloudflare documents that a failed statement rolls back its entire D1 batch:
https://developers.cloudflare.com/d1/worker-api/d1-database/#batch
