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

## Atomicity contract

Commerce database changes use D1 transactional batches and database constraints,
not read-then-write stock checks. Orders keep immutable commercial snapshots and
replay keys. Provider network calls happen outside database transactions and
their results are recorded as idempotent events. A lost response must not create
a second charge, stock deduction, shipment, notification or payout.

Cloudflare documents that a failed statement rolls back its entire D1 batch:
https://developers.cloudflare.com/d1/worker-api/d1-database/#batch
