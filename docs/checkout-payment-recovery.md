# Checkout and payment recovery

This implementation is prepared behind `COMMERCE_STORAGE=d1`. The hosted test
switch is still disabled. A successful fixture test is not a completed commerce
cutover, provider activation, actual settlement, or financial release acceptance.

## Durable checkout

The central checkout requires a random 128-bit browser request key, the item
prices reviewed by the customer, and the reviewed total. It freezes the exact
request in tab session storage before sending it. If recovery storage cannot be
written, no payment request is sent. An uncertain request keeps the same bytes
and key across reloads, errors and later validation failures.

PHP normalizes and hashes the browser intent. It looks up that intent before
reading the current catalog or requesting a paid delivery quote. A known order
therefore keeps its original price, quote, customer ownership, product option
identities and payment request even if the catalog or customer login changes.
A new order checks both the product prices and final delivery-inclusive total.
Option identity is independent of merchant SKUs, which may be duplicated.
The shipping origin snapshot uses an explicit field allowlist; provider API
keys are never copied into an order.

Migration `0014_checkout_payment_sessions.sql` makes request keys unique across
all sellers within the commerce environment. A key cannot silently start a
second store's order. The intent hash allows recovery without changing the
original immutable commercial snapshot. Conflicting use of a key returns 409.

The browser uses its own payment page for all central orders, including an order
still waiting for provider setup. A missing response does not produce a new
attempt. Returning to checkout shows a recovery screen with the saved total;
it does not replace it with an empty or re-priced catalog total. Only an
explicit server terminal state clears the saved attempt. Local countdown
expiry alone does not. Central attempts are rejected if a rollout rollback
would otherwise send them through the legacy file checkout.

## Provider requests and evidence

The transactional outbox owns the original DOKU request ID. Checkout leases only
its own order's job. An expired or terminal order cannot start a new payment job.
The CLI dispatcher leases one job immediately before execution, giving it a
fresh 120-second lease. Leases and completion records prevent concurrent workers
from independently creating the same payment.

Payment instructions are stored in an immutable table. Direct BCA account
numbers are bound to the original request and order, including when a verified
callback arrives before the create response. A later mismatched account or
request is rejected transactionally. Hosted URLs must match the environment's
allowlisted DOKU HTTPS hosts and checkout paths. DOKU's compact hosted expiry is
interpreted in Asia/Jakarta and stored as an absolute timestamp. Late
instructions cannot reopen released inventory.

The BCA callback adapter verifies the provider signature before accessing the
signed commerce service, then validates invoice, amount, currency, channel,
account and charge identity. It derives capture identity from the original
channel request and bank reference; a notification's changing request ID is not
a new charge. Immutable event data retains the bank reference. Retries with
additional timestamps or either documented identifier-array spelling deduplicate.
Distinct verified bank charges remain separate evidence and flag the order for
payment review without consuming more stock.

Unknown provider failures and lost database acknowledgments remain uncertain.
They do not mark an order failed or release its reservation. Completion requires
stored payment instructions or a verified primary capture. Reconciliation can
acknowledge a callback that preceded a lost creation response.

The dispatcher uses DOKU's signed GET status endpoint with no body digest. It
waits at least a minute before a status lookup and between uncertain attempts.
Neither a 404 nor a non-final failure authorizes another create call. See
[DOKU status API](https://developers.doku.com/get-started-with-doku-api/check-status-api/non-snap)
and [notification samples](https://developers.doku.com/get-started-with-doku-api/notification/http-notification-sample-non-snap).
Treating 404 conservatively is our safety decision; the documentation does not
establish it as proof of no provider effect.

## Operation and remaining cutover gates

`tools/commerce/payment-dispatch.php --once` is a CLI-only bounded pass: up to
five reconciliation jobs and five new payment jobs, claimed one at a time.
Invoke it with the same private runtime configuration and deployment-specific
service secret as PHP checkout. Its output contains counts, not customer data.
Exit 2 indicates processed uncertain/dead jobs; exit 1 is a dispatcher failure.
It is **not installed or scheduled on Hostinger yet**. Empty successful passes
do not establish that exhausted uncertain jobs have been resolved; operator
backlog monitoring is still required.

Before switching hosted checkout:

- Import and reconcile private legacy orders, totals, ownership and provider
  identities; adapt merchant order reads and actions to the central records.
- Complete central fulfillment, seller origin settings, shipment callbacks,
  tracking projection and customer order history. Current central payment reads
  do not refresh legacy shipment files.
- Install and monitor the payment dispatcher, frequent expiry processing,
  operational backlog visibility, recovery escalation and transactional notices.
- Recover provider-created instructions when status responses omit the original
  account expiry or hosted URL. Such cases currently remain uncertain for review.
- Add and verify transaction-identity adapters for every additional production
  payment channel, refunds and settlement. The central callback adapter in this
  stage supports BCA virtual-account successes only. Other successful channels
  fail for retry/review; they are not silently marked paid.
- Exercise callback-before-response, dropped responses, authenticated customer
  access, migration rollback, provider failures, late payments and reconciliation
  against the hosted release candidate. Fixture evidence does not satisfy this.
- Maintain the production hold, DOKU approval and sustained financial/wallet
  testing requirements in `production-release-gates.md`.

Demo catalog entries are preview-only under central checkout; actual checkout
requires a D1-backed store product. No hosted financial or stock records are
fabricated to make these acceptance gates pass.

## Verification

`cloudflare/ezkart-api/test/commerce-orders.test.mjs` exercises request recovery,
cross-store keys, immutable sessions, racing mismatched accounts, expired-order
dispatch, and callback-before-response alongside the existing stock, returns
and outbox invariants. The common real-D1 fixture is in `commerce-fixture.mjs`.

`tools/checkout-test/central-checkout.test.mjs` connects the actual PHP checkout,
signed service transport, callback and dispatcher to that local Worker/database.
Only provider calls are fixtures. It covers privacy and ownership, original
quotes, dropped order and instruction responses, uncertain creation, bank-charge
deduplication, hosted URL/expiry, disabled-storage rollback, signed status
reconciliation, browser storage failures, and desktop/mobile recovery.

The status reconciliation test simulates the elapsed-minute read projection;
it does not modify immutable D1 order timestamps. Browser screenshots distinguish
saved checkout recovery, pending setup and a usable hosted payment session.
