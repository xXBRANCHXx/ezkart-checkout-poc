# Central commerce storage

## Current rollout status

The Worker has a D1 order/reservation service and a durable provider-job outbox.
The existing hosted PHP checkout, callback handlers and merchant order screens
have **not yet been cut over**. Applying the schema or deploying this Worker
alone does not complete that integration or make wallets operational.

The full completion scope and acceptance gates remain in
[commerce-completion-plan.md](commerce-completion-plan.md).

## Data and invariants

Migration `0009_commerce_orders.sql` extends the existing `orders` and
`order_items` tables; it does not import private JSON order files or synthesize
provider records. New central orders have `commerce_version=1`.

- Orders retain immutable item prices, quantities, customer/shipping snapshots,
  plan/commission/admin rules and the checkout request hash. Shipping is excluded
  from commission. Actual provider processing fees remain unknown until settlement.
- A checkout key is unique within a seller and commerce environment. Repeating
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
  The payment is retained without overselling another buyer's stock. Merchant
  resolution, refund and inventory reallocation workflows are still required.
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

Create accepts `sellerId`, `environment`, `checkoutKey`, `customer`, `items`,
`shipping` and `expiresAt`. Each item supplies `productId`, optional `variantId`,
integer `quantity`, and `expectedPrice`; D1 supplies the authoritative product
price, identity and weight. Existing variant products require an explicit option.
Shipping contains the server-validated quote amount and origin/destination
snapshots; only sandbox may use `{amount:0, skipped:true}`.

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

Outbox kinds for shipping, notifications and payouts establish the common queue
contract. Their actual provider dispatchers are outstanding; a queued job is
not evidence that a message, shipment or payout was sent.

## Required before activating the test cutover

1. Finish PHP checkout, provider dispatch, callback, order read/list, customer
   tracking and merchant-action adapters; preserve private legacy references.
2. Finish product-edit revision protection and reservation-preserving variant
   edits; finish inventory adjustments and stock-review resolution.
3. Build and rehearse an idempotent legacy import. Compare order counts, paid
   totals, owners and provider references. Legacy records must not reserve stock
   again or become new ledger credits.
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
