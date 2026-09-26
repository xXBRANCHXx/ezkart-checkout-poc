# Financial journal and wallet implementation

The financial implementation starts with a durable journal for verified payment
captures. It is operational accounting, not a provider balance, a completed wallet,
recognized platform profit, or permission to withdraw. Settlement synchronization,
actual processing fees, release/holds, refunds, reconciliation, seller account
mapping and payouts remain part of the full completion scope.

## Capture accounting

Migration 0023 adds an immutable account chart, journals, entries, a capture
accounting view and transactional guards. Inserting a verified capture posts its
journal and all entries inside the same transaction as the payment event and
inventory consumption. Any posting failure rolls back that whole transaction.
A failed notification can be retried with its original key; it cannot leave a
paid order or consumed stock without the corresponding captured-payment entries.

Debits are positive and credits negative. A normal primary capture records:

| Account | Debit | Credit |
| --- | --- | --- |
| Provider receivable | Captured customer payment | — |
| Seller pending | — | Product subtotal less recorded commission and admin |
| Shipping reserve | — | Customer shipping charge |
| Platform commission pending | — | Original per-order commission |
| Platform admin pending | — | Original per-order admin amount |

The processing fee is still unknown. It is not replaced with the mockup's example
estimate or any field on a payment-success notification. The seller amount is
therefore **before actual provider fees**, and is never available funds. A small
order can have a negative seller allocation; this is retained as a debit instead
of being clipped to zero or making the journal unbalanced. Shipping is outside
the commission basis and seller earnings.

The journal uses the order's immutable fee snapshot, not the seller's current
plan. Version, plan, basis points, rounded commission, admin, actual-fee policy
and withdrawal rules must match the recorded policy. An incomplete, unknown or
inconsistent policy puts the entire capture into unallocated receipts, while
preserving its real payment evidence. Additional captures also stay unallocated;
they never create another commission/admin charge or seller allocation.

The account chart classifies platform fee allocations separately from assets,
liabilities and expenses. Those allocations are not an Executive revenue feed.
Account meanings, receipts and postings cannot be changed or deleted, including
through SQLite replacement writes. Correcting a financial fact will require new
balancing entries with their own evidence, not rewriting an old capture.

The capture journal is unique per capture. Later financial event kinds can have
their own journals; the current writer rejects every kind except capture. Source
and entry guards independently bind each line to its immutable capture/order and
the canonical allocation. All lines must exist and sum to zero. A primary and an
additional payment arriving concurrently remain distinct, balanced receipts.

## Service reads and upgrade catch-up

These endpoints require the existing signed server-to-server commerce authority.
An ordinary merchant/customer bearer token is insufficient. All routes enforce
the deployment's commerce environment, narrow parameters and seller scope on
reads. They remain disabled while central commerce storage is held.

- `GET /internal/commerce/finance/summary?seller=...&environment=...`: capture
  coverage, unallocated/additional counts, exact account totals and balance checks.
- `GET /internal/commerce/finance/journals?seller=...&environment=...`: journal
  history, up to 50 rows, with an initial sequence `cap` and descending `before`.
  Newly inserted journals do not enter later pages of an existing cohort.
- `POST /internal/commerce/finance/captures/reconcile`: `{environment, limit}`,
  at most 100 existing captures per transaction, default 50. It accepts no payment,
  fee, account or amount override, and returns remaining coverage. Repeated or
  concurrent batches converge without posting a capture twice.

The migration does not invent old fee policies or payments. Existing captures
need the bounded catch-up operation; until all are posted, `accountingComplete`
is false and `unposted` remains visible. Summary and history amounts use decimal
strings so aggregate rupiah values do not lose precision in JavaScript. Summary
`availableToWithdraw` is null and `settlementConnected` is false: captured volume
and pre-processing allocations cannot become a fictional wallet balance.

`occurredAt` preserves the capture's verification timestamp; `postedAt` records
when it entered the journal. Catch-up does not claim the payment was received
when migration or reconciliation ran. Reads do not create postings.

## Provider contract and remaining financial work

The [Sub-Account financial reader](doku-financial-reader.md) now provides signed,
exact-money provider reads and a private sandbox evidence collector. Its responses
are not yet ingested as settlement journals or linked to seller-owned mappings.
Actual provider-read acceptance and all money-flow work below remain open.

Official DOKU documentation was checked on 25 September 2026. New integrations
should target its actively developed Sub-Account V2. Payment routing uses the
registered profile and optional split-rule ID; routing identifiers need explicit
validation because invalid values can fail silently. Settlement applies the split
after processing fees. A percentage of net settlement would not reproduce the
owner's percentage of product subtotal. The proposed flat platform allocation
still needs its actual provider integration and acceptance.

The transaction-history/status adapter must preserve account scope, correlate
payment, fee and destination rows, distinguish pending and voided records, and
retain enough evidence to reconcile gross, actual fee and all settled allocations.
Provider balance alone is insufficient evidence for an individual order's release.
See [Collect and Route](https://docs.doku.com/wallet-as-a-service/sub-account/collect-and-route),
[API versions](https://developers.doku.com/wallet-as-a-service/sub-account) and
[Sub-Account V2](https://developers.doku.com/wallet-as-a-service/sub-account/sub-account-v2).

The [wallet enrollment flow](wallet-enrollment.md) now implements owner-authorized
seller/provider mapping and fresh verification on every enrollment action. Actual
hosted/provider acceptance and unknown-registration recovery remain open.

Still required: provider-accepted seller mapping, payment routing, actual-fee and
settlement ingestion with corrections, delivery-plus-settlement release, reserves
and disputes, partial/full refunds, negative-balance handling, owner-bound fresh
Wallet verification on every protected action, withdrawal reservations and limits,
beneficiary verification, payout idempotency/recovery, reconciliation and the real
merchant wallet UI. No provider calls or movement of funds are implemented by the
capture journal. No top-level completion/release gate is closed by this stage.

## Verification — 26 September 2026

The complete Worker suite passes all 134 tests. The affected central checkout,
fulfillment, payment, buyer-review and cross-language signing suites pass all
31 tests. Eight journal cases cover original fee policies, duplicate and concurrent
captures, transaction rollback, replacement-write protection, historical catch-up,
seller/environment isolation and stable paging. Exact aggregate money is checked
above JavaScript's safe integer range; individual legacy captures retain the range
already supported by the payment reports. Current checkout amount limits are
unchanged. Small negative seller allocations remain visible and balanced.

The TEST Worker dry build and whitespace checks pass. The private TEST backup
restores successfully, and migration 0023 applies in its original file order with
SQLite integrity `ok`, no foreign-key errors, six account definitions, zero
journals/entries and all eleven financial guards. This validates the migration
against the actual prior TEST schema, in addition to D1-backed fixtures.

Logs: `/tmp/ezkart-financial-journal-api-final-01a0d643.log` and
`/tmp/ezkart-financial-journal-php-final-01a0d643.log`. The pre-migration export is
`/tmp/ezkart-financial-journal-deploy-01a0d643/test-before-0023-20260926.sql`, mode 0600,
401,491 bytes, SHA-256
`6e082a678bb0466e13737ef022bc179594b990742a5058c2ce0930bad4734c3d`.
Hosted rollout evidence follows separately. These tests do not establish actual
provider settlement, available balances, refunds or withdrawals.

### Hosted TEST rollout

Implementation `29ae6fa` is pushed on `agent/ezkart-workbench`. Only migration
0023 was applied to TEST D1, followed by TEST Worker
`2914f73f-d7d2-4719-86dc-e942126fe965`. At 10:06 UTC / 17:06 Jakarta on
26 September, health reports 62 tables and healthy D1/public R2/private R2.
All three financial tables, the accounting view, six account definitions and
eleven guards are present; journal and entry counts remain zero.

Operational counts, review/photo counts and the 15-entry legacy import manifest
are unchanged. Both financial read routes correctly return the existing central
storage hold. No checkout flag, provider capability or maintenance schedule was
changed. Provider settlement, populated hosted accounting, refunds and withdrawals
remain acceptance work. Private deployment and comparison evidence is under
`/tmp/ezkart-financial-journal-deploy-01a0d643/`.
