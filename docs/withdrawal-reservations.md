# Withdrawal reservations

Migration 0055 adds the central reservation and cancellation part of seller bank
withdrawals. It does not dispatch a bank inquiry or transfer. The merchant
withdrawal button remains unavailable until bank confirmation, durable dispatch,
actual Ezkart-funded transfer fees and outcome reconciliation are integrated.

## Funds and transaction boundary

A new request requires the current store owner, a fresh Wallet verification and
the store's confirmed provider wallet. The server freezes the original amount,
bank code, account number (including leading zeroes), transfer channel, provider
wallet and merchant reference. It accepts whole-rupiah decimal strings from
Rp250,000 through the exact journal representation limit. The upper representation
limit is not a provider or bank transfer limit. No seller transfer fee is deducted.

Inside the insertion transaction, SQL recalculates settled, delivered, currently
reconciled earnings, subtracts negative allocations and all existing withdrawal
reservations, and checks capture/journal completeness. It rechecks the current
owner and proof expiry. A previous Wallet response cannot authorize a reservation.
Distinct concurrent requests cannot spend the same earnings. Exact request-key
replays recover the existing intent; changed amount or destination details cannot
reuse that key, including after cancellation.

The immutable withdrawal and journal commit together: debit `seller_available`,
credit `seller_withdrawal_reserved`. Cancellation posts the exact reverse, with
its own immutable owner/request evidence. A failed journal entry rolls the whole
reservation or cancellation back. No provider cash entry is posted.

Current earnings remain authoritative after reservation. New refund/return holds,
fee corrections, negative allocations or stale provider history immediately reduce
what can be reserved. An existing reservation remains recorded; any uncovered
amount is disclosed as a reservation shortfall. Cancelling it never makes held
or stale earnings spendable. These shortfalls are not treated as completed
payouts or customer refunds.

This stage has no dispatch record or provider caller. When dispatch is connected,
its committed payment grant must prevent cancellation in the same transaction.
A timeout, missing acknowledgement or unsuccessful-looking transport response
cannot release money that may already have left the server. Completed payouts,
confirmed refunds and their journals must also reduce the funding calculation
before real transfers can be enabled.

## Private service and Wallet

All endpoints require the signed commerce service and a current owner with fresh
Wallet proof. They accept strict JSON without unknown fields, are available only
on TEST/beta, and reject browser bearer tokens. No new public merchant action or
scheduled dispatcher is enabled.

- `POST /internal/commerce/finance/withdrawals` accepts `environment`, `seller`,
  `actor`, `requestKey`, `amount` and `bank` (`code`, `accountNumber`, `channel`).
- `POST /internal/commerce/finance/withdrawals/{id}/read` accepts only the owner
  scope and returns the saved request plus current aggregate funding/shortfall.
- `POST /internal/commerce/finance/withdrawals/{id}/cancel` also requires a new
  cancellation `requestKey`. The current owner may cancel a former owner's
  unsubmitted request; ownership changes cannot reuse that original request key.
- `POST /internal/commerce/finance/withdrawals/list` accepts the owner scope and
  optional `cap`, `before`, `limit` (1–50). The first sequence cap fixes the cohort;
  cancellation status stays current. Responses mask bank accounts and exclude
  provider credentials, account mappings and private financial sources.

Protected Wallet reads subtract reservations from available earnings and show
them separately from order holds. They disclose a funding shortfall and continue
to require verification. The existing order history describes each order's
earnings; it does not claim to be completed bank-transfer history.

## Remaining withdrawal work

Connect the [bank adapter](doku-payouts.md) to single-use durable inquiry/payment
grants and original receipts, show and confirm the bank-returned beneficiary,
bind the owner decision to that receipt, recheck authority/funds before dispatch,
fund the actual transfer fee from Ezkart, and reconcile authenticated status,
callbacks and account history into final journals. Complete the owner-facing
request/history/recovery flows and live acceptance before opening withdrawals.

## Verification

Seventy-two relevant cases pass: 46 financial/owner cases and 26 PHP, bank-adapter
and merchant-browser cases. Thirteen reservation cases cover concurrent distinct
and identical requests, uncertain acknowledgements, original bank fields, held or
stale earnings, fee corrections, negative allocations, owner changes, expired
proof, direct SQL source guards, rollback, fixed history, a populated upgrade,
beta references and main rejection. The protected Wallet is verified at 1360px
and 390px; the narrow screenshot was inspected for clipped amounts and controls.
No fixture provider response is live bank acceptance.

The first combined financial run passed 44 of 45 cases; the remaining ownership
case initially omitted the new owner's required user row. After correcting that
fixture, the case passes. An additional direct-source case and the extended
beta/main case pass separately. Logs are
`/tmp/ezkart-withdrawals-finance-final-01a0d643.log`,
`/tmp/ezkart-withdrawals-owner-final-01a0d643.log`,
`/tmp/ezkart-withdrawals-source-guards-01a0d643.log` and
`/tmp/ezkart-withdrawals-php-final-01a0d643.log`. Syntax, whitespace and the beta
Worker dry build pass.

The fresh pre-migration beta export contains 702,376 bytes, SHA-256
`64dfd1e72bf69cadefceb66585fc83181318e3f3a4657457ba144773bddac2b1`.
It restores cleanly with 156 exported tables and unchanged Time Travel bookmarks.
The migration rehearsal preserves every original row and adds only the
`seller_withdrawal_reserved` account plus empty withdrawal/cancellation tables.
Integrity and foreign-key checks pass. Private evidence is in
`/home/branch/.local/share/ezkart/beta-01a0d643/withdrawals-before-0055-20260927/`.
