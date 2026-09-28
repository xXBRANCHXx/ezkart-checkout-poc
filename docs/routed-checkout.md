# Routed DOKU Checkout on workbench

This adds DOKU's payment window for QRIS, ShopeePay and one-time card SALE while keeping
Ezkart's cart, order and native BCA SNAP VA option. It creates one original
Checkout session, with its original Sub-Account and flat split rule. No live
payment, provider activation or financial hold changes were performed by this
implementation.

## Documented provider contracts

Reviewed 28 September 2026:

- [Sub-Account compatibility](https://docs.doku.com/wallet-as-a-service/sub-account#payment-method-compatibility): QRIS/card support is through Checkout; VA also supports direct API.
- [Collect & Route](https://docs.doku.com/wallet-as-a-service/sub-account/collect-and-route): Checkout `/checkout/v1/payment` accepts `additionalInfo.account.id` and `split_rule_id`. Routing is verified later from original account history; session acceptance alone does not prove settled routing.
- [Checkout backend](https://developers.doku.com/accept-payments/doku-checkout/integration-guide/backend-integration): invoice, amount, method allowlist, SALE, payment URL/token/expiry. `additional_info.override_notification_url` is the separate snake-case Checkout option.
- [Frontend](https://developers.doku.com/accept-payments/doku-checkout/integration-guide/frontend-integration): `loadJokulCheckout(payment.url)` displays the provider payment window. No documented routed Checkout QR payload/image extraction was found; generic direct Generate QR does not establish Sub-Account routing.
- [Notifications](https://developers.doku.com/get-started-with-doku-api/notification/http-notification-sample-non-snap) and [best practice](https://developers.doku.com/get-started-with-doku-api/notification/best-practice): authenticated server notifications update the order. Browser close, redirect or success messages cannot mark payment paid. Failed attempts do not terminate Checkout because a shopper may change methods.

## Frozen choices and recognition

`checkout-config.php` publishes `payment_choices` (`bca_va`, `doku_checkout`, `shopeepay`)
and `hosted_payment_methods` (`QRIS`, `CREDIT_CARD`, `EMONEY_SHOPEEPAY`). Optional POST
`payment_choice` is included in the original intent hash and immutable snapshot.
The server chooses the flow; arbitrary shopper flow names are not accepted.
Same-key changes are rejected, and original intent replay precedes current
configuration lookup. Old requests without the field preserve their old hash.

New grants require active original seller/platform destinations, the configured
platform store, original credentials and confirmed original split rule. Production
also requires current seller onboarding. A saved grant fences another create;
unknown dispatch cannot be reset or sent again.

The callback is `/cart/api/doku-hosted-webhook.php`, with exact-path non-SNAP
HMAC authentication over the original body. Worker receipt normalization binds
invoice, exact amount, allowed method and original credentials. QRIS channel
`QRIS_DOKU` maps to configured `QRIS`. Cards support approved one-time `SALE`
with response code `00`; AUTHORIZE/VOID/refund events cannot capture money.
The transaction date must be no earlier than the immutable binding minus a local
five-minute clock tolerance and no more than five minutes in the future. Delayed
signed deliveries remain accepted.

A local invoice-scoped correlation hash uses documented economic facts: merchant,
environment, invoice, channel, acquirer, transaction date and QRIS account/approval
or card original request/approval. It is explicitly **not a DOKU-issued globally
unique charge ID**. Delivery Request-Id and delivery timestamp are excluded.
Identical facts replay once; different paid facts after a primary payment enter
the existing extra-payment/review path without another fulfillment. Immutable
receipt, capture, stock and balanced journal are committed atomically. Unexpected
raw card numbers/security codes are rejected before receipt storage.

## Fees, settlement and remaining activation

The original pricing snapshot retains its existing commission and admin policy,
with `processingFeePolicy=actual_provider_fee`. No BCA fee is copied to QRIS/cards
and no estimate is promoted to an actual charge. A valid callback recognizes gross
payment only. Actual settlement still needs the original merchant invoice,
provider history group, frozen credential, seller/platform profiles, cash and
pending accounts, split rule, complete collections, exact credits and explicit
`SETTLEMENT_FEE`. Missing fee evidence stays unresolved; unknown does not mean
zero. Delivery, refund/return and payout funding/release holds remain applicable.

Activation is separate from code delivery. Confirm BCA SNAP, QRIS/card methods
actually active for the merchant, Collect & Route approved, both original wallet
profiles and server-pinned company destination configured, and DOKU notification
configuration matching the callback. BCA/QRIS approval does not establish Collect
& Route activation. Preserve existing production/main and money-dispatch holds.

For an authorized beta rollout, after schema 0078 and matching PHP/Worker/frontend
code are installed:

1. Configure a persistent private directory outside public roots, owner-only mode
   0700, as `commerce_payment_recovery_directory` (environment variable
   `EZKART_COMMERCE_PAYMENT_RECOVERY_DIRECTORY`). Back it up privately; receipt
   files are 0600 and contain order/customer/provider data.
2. Keep existing actual production credentials, SNAP signing material and native
   BCA partner service/customer prefix settings. Set
   `doku_production_payment_flow=routed_hosted` and explicit comma-list
   `doku_production_checkout_methods` only after those merchant methods are
   approved. `VIRTUAL_ACCOUNT_BCA` exposes native BCA; `QRIS,CREDIT_CARD` expose
   the QRIS/card choice; `EMONEY_SHOPEEPAY` exposes the separate ShopeePay choice.
   Each ShopeePay session allows only `EMONEY_SHOPEEPAY`; QRIS/card sessions
   exclude it. There is no default configured method or automatic activation. Sandbox uses sandbox-prefixed
   settings and cannot share production bindings.
3. Enable new checkout only under the existing paid-beta activation procedure.
   Exercise one authorized original payment per approved method and verify its
   authenticated callback and actual settlement fee/account history before any
   release. This document does not itself authorize those real payments.

## Original-response recovery

Before storage acknowledgement, the PHP dispatcher saves a successful create
response and frozen binding to the private directory as
`ORDER_ID-checkout.json`. Internal receipt upload retries the identical evidence;
never the provider create. A later dispatcher pass may finalize this original
receipt. To recover without current provider credentials or another provider call:

```sh
php tools/commerce/finalize-hosted-payment.php --receipt-file=/private/ORDER_ID-checkout.json
```

The CLI checks the exact original binding and calls internal storage only. It is
not accessible over HTTP. Preserve the original file on failure. Signed callbacks
also recover a paid order even when the create reply was never stored. If the
provider reply itself was lost before the private receipt exists, the original
binding remains uncertain: callbacks may confirm payment, but another Checkout
create is prohibited. Current public status documentation does not expose the
original hosted payment URL/token for a no-payment lost-create case; resolve that
original invoice with DOKU, without replacing it or fabricating success.

## ShopeePay — 28 September 2026

The shopper can select **ShopeePay** when explicitly configured by the server.
The choice is frozen in the original intent and order snapshot, and the Worker
rejects a binding whose method list contradicts that choice. Existing bound
sessions recover with their original methods. ShopeePay-only configurations also
freeze the default for older callers omitting `payment_choice` without changing
their request hash. QRIS guidance explains that ShopeePay can pay QRIS too.

The [Checkout request](https://developers.doku.com/accept-payments/doku-checkout/integration-guide/backend-integration)
uses `EMONEY_SHOPEEPAY`, whereas the documented
[non-SNAP notification](https://developers.doku.com/get-started-with-doku-api/notification/http-notification-sample-non-snap)
uses channel `EMONEY_SHOPEE_PAY`, service `EMONEY`, and acquirer `SHOPEE_PAY`.
The adapter maps only that documented channel to the original allowed method.
Success requires the original-request identifier; optional ShopeePay status fields
must agree with success if present. The local charge correlation uses the
invoice-scoped original request and acquirer, excluding delivery IDs and optional
issuer fields so redelivery cannot cause another capture. Pending/failed events
cannot mark an order paid. Browser redirects and popup closure remain non-authoritative.

Account activation is **unconfirmed**: the current DOKU dashboard inspection
rendered navigation but no service/settings content, including in the existing
user tab. No activation request or configuration change was made. Before enabling
`EMONEY_SHOPEEPAY`, confirm actual merchant activation, Collect & Route and the
original seller/company wallets; verify the actual hosted app handoff and live
payment/settlement during authorized beta acceptance. Fixtures establish our
integration behavior, not DOKU's live account readiness.

Verification: the hosted payment, payment-choice and popup suites passed all
23 checks; the ShopeePay-only PHP checkout/default-choice check passed, and two
additional QRIS/ShopeePay settlement checks passed with mismatched binding
rejection. Desktop (1360px) and mobile (390px) screenshots were inspected with no
clipping. PHP syntax, JavaScript syntax and the actual beta Worker dry-run passed.
The ten broader central-checkout regression checks also passed. These tests use
isolated provider fixtures and create no real charges.

Deployment: implementation `d11f928` is pushed to `agent/ezkart-workbench`.
The beta Worker is version `b40f99f0-25c8-463e-8407-5ecc601a7674`; its health
check confirms beta D1/public R2/private R2 and 209 application tables.
At 08:53 UTC on 28 September, hosted `cart.js` matched the committed source.
No migration or provider configuration change was needed. Checkout remains
`checkout_paused`; activation and actual ShopeePay payment acceptance are still
pending. Main and `ezkart.id` were not deployed.
