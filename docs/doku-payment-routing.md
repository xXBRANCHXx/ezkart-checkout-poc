# DOKU payment routing and original fee allocations

New SNAP payments require a confirmed seller Sub-Account and an independently
confirmed platform fee Sub-Account under the same DOKU parent and credentials.
The dispatcher creates one flat split rule, records its original accepted
response, then attaches the seller profile and that rule to the BCA request.
Creating a rule or payment account does not prove routing at settlement, actual
fees, delivery, or available earnings.

## Provider contract

Checked against DOKU's [Sub-Account V2 guide](https://developers.doku.com/wallet-as-a-service/sub-account/sub-account-v2),
[split-rule API](https://developers.doku.com/wallet-as-a-service/sub-account/sub-account-v2/integration-guide)
and [Collect and Route guide](https://docs.doku.com/wallet-as-a-service/sub-account/collect-and-route)
on 27 September 2026. The fee is deducted before splitting at settlement; the
payment request supplies a seller profile ID and an accepted split-rule ID.
Invalid routing identifiers can fail silently, so a successful payment callback
is insufficient financial routing evidence.

The fixed `POST /sub-account/v2.0/split-rules` request uses `transactionType:
PAYMENT` and one `FLAT` IDR rule. Its numeric amount is the original order's
shipping plus commission plus Rp1,250 admin charge. Commission comes from the
immutable product-subtotal fee snapshot. A later plan change does not alter it.
The actual provider fee is neither estimated into the rule nor charged twice.
Negative seller allocations are not clipped; provider behavior when fees leave
less than the flat allocation still requires acceptance before enabling checkout.

The returned transaction type, rule type, amount, currency and destination must
match exactly. Fractional rupiah, exponent tokens, changed account identifiers,
extra destinations and duplicate JSON keys cannot confirm a rule. Original
request/response bytes and the separate numeric dispatch ID remain private.

The BCA request adds `additionalInfo.account.id` and
`additionalInfo.account.split_rule_id`. An explicitly different echoed route is
rejected. An absent echo is not invented into proof of settlement. Historic
unrouted bindings remain usable for their original payment callbacks/status
reads; new account creation without routing is refused.

## Central configuration and dispatch

`COMMERCE_PLATFORM_WALLET_SELLER` identifies an **Ezkart-controlled, dedicated fee
wallet's store**, whose enrollment has a verified registration and matching
independent balance inquiry. This is a private Worker deployment setting, never
a checkout field or merchant-selected destination. It must not name an unrelated
merchant or the purchasing store's own seller wallet. The integration does not
assume the parent cash account accepts split allocations. Both selected cash
accounts must be distinct confirmed Sub-Accounts with the same pinned parent,
client and credential fingerprint.

The setting is not installed on live beta while provider account provisioning
remains unresolved. Missing configuration or either unconfirmed wallet prevents
dispatch. No platform wallet is registered by this payment code, and it never
repeats the original uncertain owner enrollment.

Migration 0051 adds immutable `commerce_payment_route_bindings` and
`commerce_payment_route_receipts`. The first split dispatch grant belongs to the
current payment job's execute lease. Seller/platform enrollments, original
allocation and credential identity cannot later change. The payment's existing
dispatch grant is issued only after its matching split receipt is accepted.
Database guards independently enforce the mapping, fee snapshot and prerequisite.

The existing signed service exposes two narrow POST routes:

- `/internal/commerce/snap-payments/:orderId/route/bind`: environment, current
  worker/lease and provider identity only. The service derives every destination
  and amount. Only the first committed binding returns `mayCreateRule: true`.
- `/internal/commerce/snap-payments/:orderId/route/receipt`: environment and the
  original typed adapter's evidence. Repeating identical evidence is idempotent;
  a different result cannot replace it. The envelope is bounded to 40 KB, with
  each original JSON body at most 16 KB.

The private existing payment read includes routing state. Public payment and
merchant reads do not gain credential fingerprints or original provider receipts.

| Interruption | Recovery |
| --- | --- |
| Missing split-bind acknowledgement | Preserve the dispatch; do not send or repeat a split request |
| Missing/malformed/unsuccessful split reply | Keep the original rule dispatch uncertain; no payment account is created |
| Lost accepted-receipt acknowledgement | Retry only the identical internal receipt |
| Accepted rule, payment not yet dispatched | Reconciliation can retry only the payment stage with the same saved rule |
| Payment account already dispatched | Existing SNAP no-repeat recovery rules still apply |
| Rule response recovered after order expiry | Preserve original evidence; expiry still prevents a new payment account |

A recovered response must pass the same original-request checks. Rebinding,
changing credentials, choosing another account or creating another split rule
is not an unknown-result recovery path. The documented API does not provide an
automatic lookup for a lost split-create response; that case requires provider
reconciliation against the original dispatch identity.

## Acceptance still required

Provision and verify the actual seller and dedicated Ezkart fee Sub-Accounts,
then configure the platform mapping. Verify BCA activation and the actual routed
purchase through pending cash, fee deduction and both destination credits.
Exercise small/negative seller allocations with DOKU's supported behavior.
Ingest settlement/corrections and actual fees, combine them with confirmed
delivery, and finish reserves, refunds, withdrawals and financial recovery.
Checkout, dispatch schedules, email sending and the main release remain held.
Local provider fixtures cannot establish any of those live acceptance results.

## Verification — 27 September 2026

All 143 relevant cases pass: 20 Worker routing/SNAP cases, 34 PHP contract and
payment integration cases, 54 related checkout/Wallet/reader/payout regressions,
and 35 shared order/job/checkout-hold cases. Coverage includes simultaneous
dispatch and receipt replays, exact original allocations after plan changes,
missing/foreign wallets, wrong echoed routing, lost responses, payment-only
recovery using an already accepted rule, historical unrouted callbacks, strict
service boundaries and transaction rollback. PHP syntax, the beta Worker dry
build and whitespace checks also pass.

The fresh private beta export is 640,433 bytes, SHA-256
`bdf886523be6924c5475cbfdc9cba2ad4adc42f87e5598ff1c8384ea56e80525`.
It restores cleanly. Applying 0051 locally preserves all 148 original exported
tables exactly, passes integrity/foreign-key checks and leaves both new tables
empty. No remote restoration or provider action is part of this rehearsal.

Private backups and rehearsal evidence are under
`/home/branch/.local/share/ezkart/beta-01a0d643/routing-before-0051-20260927/`.
Test logs begin `/tmp/ezkart-payment-routing-` and end `-01a0d643.log`.

## Hosted beta rollout

Implementation `3e884e0` and migration 0051 are deployed to isolated beta Worker
`9b49f151-e8c5-44aa-9df8-86c128cf4ee3`. Ten hosted service checks pass at
11:39:47 UTC, including new route authorization/environment/missing-order checks
and exact preservation of the original uncertain wallet registration. No routing
grant, split receipt, delivery receipt or available earnings were created.

The post-migration export restores 150 tables including migration history, with
clean integrity and foreign keys. Every row of all 147 original application
tables matches the pre-migration export. Both new routing tables are empty.
The 650,688-byte export has SHA-256
`29fdf6b3c9a24b0f124c87446fdd349af1a5013c4b37e76ca2c6dc252c8907a6`.

At 11:42:29 UTC, hosted PHP health confirms live beta and 149 application tables;
checkout returns its expected 503 pause. The routing document matches the pushed
implementation byte-for-byte, and the callback loads the new PHP dependencies
and rejects GET with its expected 405. These are deployment/access checks, not
real routed-purchase or settlement acceptance. The platform destination is still
unconfigured; only the existing hourly housekeeping schedule is active. Email,
provider dispatch schedules and main release holds are unchanged. TEST and main
resources were not changed by this rollout.

Private evidence is in `payment-routing-hosted-proof.json`,
`payment-routing-preservation-proof.json`, `payment-routing-workbench-proof.json`
and `routing-after-0051-20260927/receipt.json` under the beta evidence directory.
