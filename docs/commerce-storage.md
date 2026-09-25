# Central commerce storage

## Current rollout status

The Worker has a D1 order/reservation service and a durable provider-job outbox.
The existing hosted PHP checkout, callback handlers and merchant order screens
have **not yet been cut over**. Applying the schema or deploying this Worker
alone does not complete that integration or make wallets operational.

On 25 September, migrations 0009/0010 and Worker version
`cc05b087-bcff-4400-af8b-ed40afb8a36d` were deployed to test only, alongside
workbench commit `391af42`. Hosted product edit/revision acceptance passed.
`COMMERCE_STORAGE=d1` is not enabled. See the completion record for the QA
procedure and cleanup; commerce cutover remains a separate unfinished step.

Inventory migration 0011 and test Worker version
`9ab0f5f0-1d09-4213-8ef3-9a886bf633f1` are also deployed. Hosted count-draft
recovery, idempotent count submission, receipts, alert changes, history and
catalog archive/restore passed. This extends inventory control without enabling
the central checkout or provider-job dispatchers.

Migration 0012 and test Worker version
`531a8c5f-e2b4-4f5b-996d-e00f659f9eb2` add explicit late-payment stock allocation
and include the concurrent Advanced-mode cleanup update. The allocation write
still requires the central commerce switch. Its hosted paid-order acceptance
is pending; the local D1/browser tests are recorded separately.

Migration 0013 and test Worker version
`68328c35-7906-42f4-a6f4-ed8edae931c4` add verified customer order ownership,
return requests, and immutable physical inspections/restocks. The hosted test
frontend serves implementation `bad4c16`; central order processing is still
disabled. See [returns-and-inspection.md](returns-and-inspection.md). Refunds,
return shipping, financial reconciliation, and paid-order hosted acceptance are
not completed by this deployment.

Migration 0014 and test Worker version
`6229f248-31c9-4b57-9af9-8eb3b5210f52` add immutable payment instructions and
cross-store checkout-key protection. Frontend implementation `228f584` is
deployed to test. PHP checkout/callback/read adapters and the CLI payment
dispatcher are prepared and locally tested, but `COMMERCE_STORAGE=d1` remains
disabled and the dispatcher is not installed as a monitored hosted service.
See [checkout-payment-recovery.md](checkout-payment-recovery.md) for unresolved
provider-instruction recovery and the remaining migration/fulfillment gates.

Migration 0015 and test Worker version
`57afed4c-6f8d-4392-853f-eff7a46634ef` add immutable fulfillment actions, linked
shipment attempts, credential bindings and a durable courier inbox. Frontend
implementation `1ad134d` is deployed to test and its gated merchant workspace was
verified at desktop/mobile widths. PHP courier callbacks, bounded execution and
owned customer tracking are prepared and tested. Central storage is still
disabled; no central orders or shipments were created during hosted QA. See
[central-fulfillment.md](central-fulfillment.md) for route contracts, recovery,
known limits and remaining shipping/operator workflows.

Migration 0016 and current test Worker version
`48b75b28-dd87-407e-83f9-d083b52a5561` add seller shipping configuration and
transactional quote-origin/weight checks. Frontend implementation `cb0b200` is
deployed to test. Hosted address save/reload, separate defaults, request replay
and cleanup passed; the current address book is empty at revision 2, with its
two QA audit records retained. Central storage remains disabled. See
[seller-shipping-settings.md](seller-shipping-settings.md).

The full completion scope and acceptance gates remain in
[commerce-completion-plan.md](commerce-completion-plan.md).

Migration 0017 is applied to TEST. Its private legacy-import rehearsal preserves
15 original source records and their ownership assessments under one immutable
receipt. Recorded totals reconcile to Rp746,000 overall and Rp116,000 paid;
eight records are assessed as seller history and seven as sandbox demos. This
does not promote them to active orders, create captures/stock movements or
activate central checkout. Operational counts remain zero and the storage flag
remains disabled. See [legacy-order-migration.md](legacy-order-migration.md) for
the audit, replay verification and remaining source fencing/promotion work.

## Data and invariants

Migration `0009_commerce_orders.sql` extends the existing `orders` and
`order_items` tables; it does not import private JSON order files or synthesize
provider records. New central orders have `commerce_version=1`.

- Orders retain immutable item prices, quantities, customer/shipping snapshots,
  plan/commission/admin rules and the checkout request hash. Shipping is excluded
  from commission. Actual provider processing fees remain unknown until settlement.
- A checkout key is unique across sellers within a commerce environment (0014). Repeating
  the same request returns its original order; changing the commercial request
  under that key is a conflict. Expiry is not part of the commercial hash.
- `stock_quantity` means physical units on hand. Active reservations reduce
  public availability. Verified payment commits a reservation and deducts the
  stock once. Expiry/cancellation releases a hold without changing units on hand.
- Order creation, all line reservations, the creation event and the provider job
  are one database transaction. Database triggers reject overselling even when
  competing requests passed their initial product read simultaneously.
- Only a verified DOKU success with the exact order amount, currency and
  environment records a capture. Failed attempts do not undo success. Repeated
  notifications do not consume stock again. Distinct real captures on the same
  order are retained and flagged for review, not treated as additional sales.
- A paid notification after an expired/cancelled hold creates `stock_review`.
  The payment is retained without overselling another buyer's stock. Explicit
  merchant reallocation is implemented in the inventory workspace. The refund
  alternative and hosted recovery acceptance remain required.
- Revision-checked event batches serialize racing updates. Events, captures,
  reservation identities and commercial snapshots cannot be rewritten.
- Deadline expiry uses a bounded, set-based database batch. It records expiry,
  releases every hold, queues an order-state notification and stops unstarted
  payment jobs atomically. Loading an order does not change its state.

## Internal API

These routes require `COMMERCE_STORAGE=d1` and a server-only
`COMMERCE_SERVICE_SECRET` of at least 32 random bytes. Keep separate secrets in
test and production. No merchant/customer access token authorizes these routes.

| Method | Route | Purpose |
| --- | --- | --- |
| POST | `/internal/commerce/orders` | Reserve an authoritative checkout |
| POST | `/internal/commerce/checkouts/resume` | Recover the original checkout key and intent before re-quoting |
| GET | `/internal/commerce/orders/:id?environment=sandbox&seller=:seller` | Read one seller's order |
| POST | `/internal/commerce/orders/:id/events` | Apply an idempotent payment/checkout event |
| POST | `/internal/commerce/jobs/claim` | Lease due jobs for execution or reconciliation |
| POST | `/internal/commerce/jobs/:id/finish` | Persist the result of the current lease |

Headers: `X-Ezkart-Environment` (deployment), `X-Ezkart-Timestamp` (Unix seconds),
`X-Ezkart-Request-Id` (32 lowercase hex characters), `X-Ezkart-Signature`
(lowercase hex HMAC-SHA256). The canonical message contains these newline-separated
values, without a trailing newline:

```text
v1
test
POST
/internal/commerce/orders
<timestamp>
<request-id>
<lowercase hex SHA256 of the exact request body bytes>
```

The target includes its query exactly. Requests outside a 120-second clock window
are rejected. Request bodies are capped at 64 KB including streamed requests.
`cart/api/commerce-client.php` implements the same contract with verified HTTPS,
no redirects, bounded response size and no local-file fallback after cutover.
Transient retries must reuse checkout/event keys; signing nonces may change.

Create accepts `sellerId`, `environment`, `checkoutKey`, `checkout`, `customer`, `items`,
`shipping` and `expiresAt`. Each item supplies `productId`, optional `variantId`,
integer `quantity`, and `expectedPrice`; D1 supplies the authoritative product
price, identity and weight. Existing variant products require an explicit option.
Shipping contains the server-validated quote amount and origin/destination
snapshots; only sandbox may use `{amount:0, skipped:true}`.
`checkout` contains the normalized browser `intentHash`, `paymentFlow` and `shop`.
The payment request ID and immutable session are returned by internal order reads.
The PHP central checkout, callback, payment read and dispatcher adapters are
prepared behind the switch; see [checkout-payment-recovery.md](checkout-payment-recovery.md)
for their contract, tests and remaining hosted cutover gates.

Events accept `sellerId`, `environment`, `eventKey`, `type`, `data`.
Initial supported events are `payment.created`, `payment.create_failed`,
`payment.failed`, `payment.expired`, `payment.succeeded`, `checkout.cancelled`.
Success data must include `provider:"doku"`, `verified:true`, `amount`,
`currency:"IDR"`, and the immutable provider transaction `reference`.
The PHP callback adapter must independently verify DOKU's signature before making
that assertion; HMAC authorization does not replace provider-signature checking.

## Provider jobs

A payment creation job retains a stable `providerRequestId`. Claims use atomic
database updates, unique leases and attempt records. Only the worker that owns
the unexpired lease can record its result. Duplicate identical completion is
safe; altered completion is rejected. Payment creation cannot be acknowledged
before its provider details are recorded on the order.

If a worker crashes, times out or loses a response, the job enters `uncertain`.
It is claimed with `mode:"reconcile"`; it is not blindly sent again. A normal
retry requires `noEffectConfirmed:true`, uses exponential backoff and stops at
the attempt limit. The dispatcher must establish that claim using provider
status/reconciliation. Exhausted uncertain work remains visible for operator
resolution. Attempts preserve worker, mode, timing and result history.

The payment and whole-order shipping dispatchers are implemented behind the
central-storage flag and require monitored hosted installation. Notification and
payout delivery remain outstanding. A queued job is not evidence that a message,
shipment or payout was sent.

## Catalog concurrency

Apply `0010_catalog_revisions.sql` with the matching Worker and product editor.
Catalog responses include `revision`; edits to existing products must send the
revision of the product originally loaded. The first statement of the D1 save
batch asserts that revision. Product or variant changes, including a payment's
stock deduction, advance it. A conflict returns HTTP 409 with
`code: "catalog_revision_conflict"` and rolls back the entire save.

Editor drafts retain `baseRevision`; a legacy draft with no version cannot take
the latest version automatically. The conflict screen opens a fresh editor in a
separate tab with a separate draft ID so the merchant can compare and reapply
changes. Publishing waits for any outstanding draft save before deleting the
published draft. Existing fields are temporarily disabled during publication.

Variant updates retain their IDs and creation timestamps. `sort_order` is now a
stable unique slot; `options_json.position` records presentation order, with the
old slot as a fallback for existing rows. SKU swaps and reorderings are atomic.
Removing a held variant, reducing stock below reservations, or changing a held
physical product to another type fails without partial updates. Products with
order history must be archived instead of deleted. Viewer memberships cannot
write products, drafts or catalog images.

Inventory counts, manual adjustments, alert thresholds, account drafts and
immutable stock history and explicit late-payment allocation are now implemented
separately; see [inventory-control.md](inventory-control.md). Order-linked return
restocking and the refund alternative for unfulfillable paid orders remain
required before the commerce cutover.

## Required before activating the test cutover

1. Complete central merchant/dashboard/payment/customer order lists and private
   legacy-reference projections. Rehearse the prepared checkout, payment,
   fulfillment, callback and customer-tracking adapters together. Finish
   per-seller shipping configuration and quotes before activation.
2. Extend the implemented physical return inspection/restocking flow with return
   policies/evidence, return shipping and financial refunds, including orders
   that cannot be fulfilled. Include hosted late-payment allocation acceptance
   and retain the catalog/inventory concurrency regression coverage.
3. Exercise the implemented source-write fence on TEST and complete the legacy
   import with final-set
   reconciliation, operational promotion and original-reference read/callback
   handling. The private 0017 snapshot rehearsal checks counts, paid totals,
   ownership evidence and provider references; it does not finish that cutover.
   The private freeze/resume controller drains complete PHP operations and
   preserves a hashed export. Durable operational promotion must disable resume
   before activation; that cross-system handover protocol remains unfinished.
   Legacy records must not reserve stock again or become new ledger credits.
4. Apply migrations to **test only**, deploy the test Worker, provision matching
   private service secrets and enable `COMMERCE_STORAGE=d1` / PHP
   `commerce_storage=d1` together after verification. No production initialization
   or activation follows from these instructions.
5. Configure bounded, frequent deadline processing and a monitored provider-job
   dispatcher. Verify lost-response recovery and operator alerts on the hosted
   test environment, then verify merchant/customer flows on desktop and mobile.

## Verification

- `npm test` in `cloudflare/ezkart-api` uses real SQLite/D1 through Miniflare,
  including concurrent requests, constraints, batch rollback and HTTP authorization.
- `PHP_BINARY=<php> node --test tools/checkout-test/commerce-signing.test.mjs`
  verifies byte-for-byte PHP/Worker signing, Unicode, exact targets and rejection
  of malformed requests.
- These checks do not contact payment providers, book couriers or send messages.
  Hosted cutover and full provider acceptance remain outstanding.
