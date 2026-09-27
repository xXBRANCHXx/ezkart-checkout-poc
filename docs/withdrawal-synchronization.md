# Withdrawal provider synchronization

The private workbench command now connects an original payout grant to a DOKU
status read, both original wallets' complete cash/pending histories, payout
reconciliation, and the related settlement/earnings reconciliation. It never
calls a transfer, refund, registration or inquiry operation.

This is an operator-driven synchronization run. Recurring dispatch, provider
callback authentication, actual payment execution, actual Ezkart-funded transfer
fees and real owner/provider acceptance remain separate work. The beta's
collection flag and payment execution remain held.

## Original scope

The signed-service `POST /internal/commerce/finance/withdrawals/{id}/payout/sync-scope`
accepts only `environment`. It reads the seller and platform accounts from the
original withdrawal/payment grant, including both pending accounts. Changing the
configured platform seller cannot replace either account. Legacy grants without
a confirmed original platform account require review.

The plan includes up to 100 captured orders and 100 other observed withdrawals
using that original account pair. It selects a common completed history window
covering the selected orders and payout grants. DOKU's 31-day window limit remains
enforced; the original target's grant cannot be truncated to fit. Oversized plans
are reported as incomplete. A current grant older than the supported window
needs an extended-history reconciliation design; this command cannot certify it.

Each collection can contain at most 40 pages of 20 rows per pocket. Short-page
exhaustion is required on all four pockets before payout accounting. Duplicate
pages, changed accounts and incomplete evidence keep the run under review.
The existing collection and financial source validators remain authoritative.

## Durable runs and recovery

Configure `commerce_withdrawal_recovery_directory` as a private, writable 0700
directory outside the public root and checkout. Provider collection additionally
requires `commerce_withdrawal_sync=enabled`. Neither setting is enabled in beta.

Run only against TEST/sandbox or beta/production:

```sh
php tools/commerce/sync-withdrawal-payout.php \
  --environment=production --withdrawal=wd_ORIGINAL_ID \
  --run=32_LOWERCASE_HEX --mode=collect --max-pages=10
```

The operator supplies one stable run ID. The run acquires an exclusive process
lock and writes an immutable intent containing the original scope, related work
and page budget. Original typed provider responses, exact D1 observation bodies,
the fixed status boundary, history window, collection manifests and payout input
are saved as 0600 files. A flushed temporary file is linked atomically into place;
an existing original is never replaced. These files contain private bank/account
information and provider references, but no provider secret or bearer token.

Every provider response is saved before its D1 delivery or the next provider
read. Lost D1 acknowledgements replay the exact saved bytes. A prolonged outage
stops further provider reads; resuming the same run first recovers saved work and
then, in collect mode, performs only missing reads. A failed read that produced
no saved response may be tried again explicitly in collect mode. All provider
operations here are reads; this does not grant payment retry authority.

Recovery defaults to no provider access and works while collection is held or
the original provider credentials are unavailable:

```sh
php tools/commerce/sync-withdrawal-payout.php \
  --environment=production --withdrawal=wd_ORIGINAL_ID \
  --run=THE_SAME_32_HEX --mode=recover --max-pages=10
```

Recovery stops if it reaches a response that was never saved. Use the same run
in collect mode to complete its missing reads. A new provider check uses a new
run ID; reusing an old ID cannot replace its observation times or page budget.
Private receipt files must be preserved through deployment and backup/recovery.
The helper and command return 404 when requested directly over HTTP.

## Accounting and remaining shared work

After collecting both wallets, the command reconciles the target payout, the
plan's other observed payouts and its captured orders, then catches up each
order's earnings. This prevents a new history collection from leaving the same
account pair's supporting earnings silently stale. Principal and fee corrections
use the existing immutable payout/settlement journals and replay identities.

The final response re-reads current payout state and counts stale settlement and
payout assessments sharing either account, including records outside this pair.
Unresolved records, a truncated plan, new concurrent evidence or remaining shared
history work produce exit 2 for review. Missing/unsafe files, storage or provider
failure produce exit 1. Exit 0 means this bounded run and its covered related work
are reconciled; it does not certify all sellers, enable withdrawals or prove a
live money movement. Output includes no bank/account identifiers or raw evidence.

Automatic selection of subsequent runs, cross-seller shared-platform sweeps,
long-window/history aggregation, callback wake-ups and scheduling/alerting remain
necessary for continuous operation. Existing balance holds continue to exclude
stale evidence from available earnings in the meantime.

## Verification

`tools/checkout-test/payout-sync.test.mjs` exercises the actual PHP command,
SNAP read adapters and D1 Worker together: completed outflows, actual fee
correction deltas, interrupted responses, lost/prolonged acknowledgement outages,
recovery without provider credentials, two related payouts, incomplete coverage,
seller-paid fee rejection, private files and concurrent run exclusion.
`test/commerce-payout-sync.test.mjs` checks immutable account scope, stale shared
work, legacy grants and service/deployment isolation. Provider, collection,
payment/status and payout regression suites remain part of verification.

Hosted acceptance and the identified implementation/Worker version are recorded
in [beta readiness](beta-readiness.md). Fixture results do not establish DOKU
activation, actual fee funding, bank delivery or sustained operational history.
