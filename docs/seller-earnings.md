# Seller earnings, release and holds

Migration 0054 connects original payment captures, actual provider settlement
and whole-order delivery to the earnings ledger. It adds `seller_available` and
`seller_reserved` liability accounts and immutable earnings assessments. It does
not transfer provider money, execute customer refunds or enable bank withdrawals.

## Original earnings and accounting

The original product subtotal, commission and Rp1,250 admin charge determine the
seller allocation. The last recognized settlement supplies the actual processing
fee. Shipping and platform allocations remain separate, and a later plan or
catalog change cannot alter these amounts. An unknown fee remains unknown;
pending figures explicitly disclose orders whose actual fee is unconfirmed.

Release requires the original allocated primary capture, the latest supported
settlement interpretation, current provider history, and the immutable receipt
for every physical/digital order line. Skipped shipping, partial/native downloads,
payment success or provider account balances alone cannot release earnings.

An available assessment transfers the exact net amount from `seller_pending`
to `seller_available`. Active refunds, returns, payment/fulfillment reviews,
unresolved provider jobs and changed settlement evidence hold that order's
earnings. Already delivered and recognized funds move to `seller_reserved`.
An approved refund is still held; closing physical intake does not establish
financial reconciliation. Declined or withdrawn requests can restore earnings
only when all other original requirements still pass.

This is a hold on the order's net seller earnings, not a complete customer-refund
funding reservation. Partial refund execution, proportional commission reversal,
retained admin fees, shipping refund funding and the actual refund-fee custody
rule still require the separate refund ledger and provider workflow.

Every new assessment posts only the change from its previous available/reserved
amounts. A fee correction adjusts the liability without charging commission,
admin or shipping again. A complete provider void moves released liabilities
back to pending alongside the settlement reversal; it does not invent a customer
refund. Reinstatement requires fresh supported evidence. Negative allocations
remain signed pending amounts and offset other available earnings without being
clipped, rewritten or charged twice. Zero net earnings require no zero-value
journal.

The source assessment, canonical journal and all entries commit together. Source
guards bind current order/capture/environment, prior assessment, amounts, holds
and original evidence. Replacement, update and delete writes are rejected. A
failed earnings entry rolls the originating delivery/refund/order transaction
back, so that its original request can be retried safely.

## Current evidence and automatic updates

Single-order capture, settlement, delivery, refund, return, order-review and
provider-job changes assess earnings inside their original database transaction.
Provider history is shared across many orders, so a history read does not start
an unbounded write across all those orders. Current-evidence checks immediately
exclude stale availability. Bounded reconciliation records the changed holds;
the existing workbench housekeeping invocation processes at most 25 assessments.
It runs only for enabled TEST/beta storage and makes no provider or email calls.

The comparison in `commerce_earnings_positions` checks current source and target
amounts against the latest saved assessment. An unreconciled order cannot report
available earnings. The future withdrawal reservation must recheck this and all
other financial holds in its own transaction; a cached Wallet response is never
spending authority. Provider synchronization and complete withdrawal reservations,
dispatch, reconciliation and actual bank/provider acceptance remain required.

## Private service and recovery

All routes require strict server HMAC, exact environment/store scope and narrow
parameters. Merchant/customer bearer tokens cannot post or read these private
financial sources.

- `GET /internal/commerce/finance/earnings?seller=…&environment=…&orderId=…`
  returns the original order's current evidence, holds and recorded position.
- `GET /internal/commerce/finance/earnings/summary?seller=…&environment=…`
  returns exact decimal strings for available, reserved, pending and negative
  earnings, plus missing accounting, unconfirmed fees and reconciliation counts.
- `GET /internal/commerce/finance/earnings/history?seller=…&environment=…`
  returns monetary updates with a fixed initial sequence `cap`, descending
  `before` and `limit` of 1–50 (default 20). New adjustments do not enter an
  existing cohort. Original provider/collection identifiers are excluded.
- `POST /internal/commerce/finance/earnings/reconcile` accepts `environment`,
  optional `seller`, optional `orderId` with its seller, and `limit` of 1–100
  (default 25). It accepts no amount, fee, delivery or eligibility override.

The settlement and delivery reads now report actual release state and earnings;
delivery catch-up reports whether its own transaction released funds. Available
earnings do not imply a functioning withdrawal service: `withdrawalsEnabled`
remains false and `availableToWithdraw` remains null.

The private command accepts TEST/sandbox or beta/production only:

```sh
php tools/commerce/reconcile-earnings.php \
  --environment=production --seller=SELLER_ID --limit=25
```

Use an optional `--order=ORDER_ID` for one original order. Exit 0 means the
requested scope is caught up, 2 means more remain, and 1 means failure or an
unconfirmed acknowledgement. An unconfirmed write may have committed; inspect
the current position before retrying. Current-source and predecessor guards
prevent a duplicate journal. No provider request is retried, and the command is
unavailable over HTTP.

## Protected Wallet

The existing Wallet proxy checks the current owner, account/store, CSRF token,
factor-bound ten-minute proof and unchanged session before returning financial
data. It obtains scope from the verified server session; browser identifiers do
not select another seller. History pages have the same gate as the initial read.

Wallet shows available, pending, reserved and negative earnings, with clear
unconfirmed-fee/reconciliation messages and a paged order history. It formats
decimal strings with `BigInt`, clears balances on failed reads and hides protected
content when the proof expires. Its figures are order earnings, not a substitute
for DOKU's account balance. The bank withdrawal action remains unavailable.

## Verification and rollout

The financial cases cover both delivery/settlement sequences, complete mixed
delivery, partial downloads, original fee policies, explicit zero and maximum
amounts, negative allocations, refunds/returns, additional captures, provider
job uncertainty, changed history, corrections/voids, concurrent retries,
transaction rollback, immutable guards and populated upgrades. Separate PHP and
desktop/mobile checks cover the actual protected proxy, history pagination,
failed/expired reads and private-command recovery without provider calls.

Local fixture evidence is not live DOKU settlement, real delivery, customer refund
or bank-payout acceptance. All wider beta and main release conditions remain in
[the completion plan](commerce-completion-plan.md). Hosted rollout evidence is
recorded after deployment; no release gate is closed by this document.

The 116 relevant cases pass: 48 financial cases (including 15 new earnings cases),
18 PHP/Wallet cases and 50 order/refund/fulfillment regressions. The final narrow
Wallet layout is checked again at 390px; earnings updates show their amounts
without horizontal scrolling. PHP/JS syntax, the beta dry build and whitespace
checks pass. Logs are `/tmp/ezkart-earnings-finance-final-01a0d643.log`,
`/tmp/ezkart-earnings-refund-rollback-01a0d643.log`,
`/tmp/ezkart-earnings-php-final-01a0d643.log`,
`/tmp/ezkart-earnings-domain-regressions-01a0d643.log` and
`/tmp/ezkart-earnings-ui-final-layout-01a0d643.log`.

The first Cloudflare export failed without a remote mutation. A fresh export
completed and restores cleanly: 684,672 bytes, SHA-256
`a6572ace6bc00ccbff4a61e1ab6e10e3586acbec42f3ae0c546e4cad90f79e98`.
Migration rehearsal preserves every original row in 155 exported tables and adds
only the two account codes and an empty earnings-assessment table. Integrity and
foreign keys pass. Private evidence is under
`/home/branch/.local/share/ezkart/beta-01a0d643/earnings-before-0054-retry-20260927/`.
The owner mailbox search at 13:37 UTC has no matching DOKU support reply; the
original uncertain wallet remains untouched.
