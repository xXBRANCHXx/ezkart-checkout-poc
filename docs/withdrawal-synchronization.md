# Withdrawal provider synchronization

The private workbench command now connects an original payout grant to a DOKU
status read, the original wallets' complete cash/pending histories, payout
reconciliation, and related settlement/earnings reconciliation. It never
calls a transfer, refund, registration or inquiry operation.

Migration 0061 adds a durable queue and a bounded PHP dispatcher. The existing
hourly Worker housekeeping can schedule eligible work when explicitly enabled;
the PHP runner's recurring installation and operational alerting remain open.
Provider callback authentication, actual payment execution, Ezkart-funded
transfer fees and live owner/provider acceptance also remain separate work.
The beta's collection flag and payment execution remain held.

## Original scope

The signed-service `POST /internal/commerce/finance/withdrawals/{id}/payout/sync-scope`
accepts only `environment`. It reads the seller and platform accounts from the
original withdrawal/payment grant, including both pending accounts. Changing the
configured platform seller cannot replace either account. Legacy grants without
a confirmed original platform account require review.

Version 2 plans include up to 100 captured orders and 100 other granted withdrawals
sharing the original platform account and credentials, across sellers. Every
seller account comes from its original route or withdrawal. The shared platform
is collected once, with each covered seller collected once, to avoid repeatedly
invalidating another seller's supporting settlement. The plan selects a common history window
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
  --run=32_LOWERCASE_HEX --mode=collect --max-pages=10 --max-reads=20
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
then, in collect mode, performs only missing reads. A read budget of 1–50 stops
the pass without replacing its intent, window or saved evidence. Version 2 also
retains a bounded failure reason/status for failed provider reads, keeping replay
order stable; a fresh run is needed to retry those reads. Original version 1
intents retain their original plan, layout and recovery behavior. All provider
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

After collecting the original wallets, the command reconciles the target payout,
the plan's other granted payouts and captured orders, then catches up each
order's earnings. Missing delivery remains held even when settlement is current.
Principal and fee corrections
use the existing immutable payout/settlement journals and replay identities.

The final response re-reads current payout state and counts stale settlement and
payout assessments sharing either account, including records outside this pair.
Unresolved records, a truncated plan, new concurrent evidence or remaining shared
history work produce exit 2 for review. Missing/unsafe files, storage or provider
failure produce exit 1. Exit 0 means this bounded run and its covered related work
are reconciled; it does not certify all sellers, enable withdrawals or prove a
live money movement. Output includes no bank/account identifiers or raw evidence.

Long-window/history aggregation, groups exceeding the plan limits, callback
wake-ups, recurring runner installation and alerting remain necessary for
continuous operation. Existing balance holds continue to exclude stale evidence
from available earnings in the meantime.

## Durable queue and bounded dispatcher

Signed-service POST routes under `/internal/commerce/finance/payout-sync/` provide
`request`, `schedule`, `claim`, `heartbeat`, `finish` and paged `list` operations.
All reject main, unknown fields and unsigned callers. Worker
`COMMERCE_WITHDRAWAL_SYNC=enabled` is required for creating/claiming work; list
remains available while held. None of these routes calls a provider.

Only one queued/running/retry job may exist for an original platform, credentials
and environment. A job's ID is its stable private run ID. The first claim binds
the private receipt storage identity permanently; another storage location cannot
resume it. Claims last 120 seconds and the runner renews them while working.
An expired claim closes its immutable attempt and resumes the same run. Eight
failed/expired attempts require review. Exact claim and finish acknowledgements
can be replayed; a different result cannot replace a completed attempt.

The dispatcher additionally requires PHP `commerce_withdrawal_sync=enabled`,
`commerce_withdrawal_sync_storage` (a stable 3–100 character storage identifier)
and the private recovery directory. These remain unset/held in beta.

```sh
php tools/commerce/payout-sync-dispatch.php --once --max-reads=20
```

Each invocation schedules at most four groups and claims one job with a fixed
40-page limit. A read-budget pause schedules the same run after 15 seconds.
Transient provider outcomes schedule a fresh observation run after five minutes;
successful groups are checked again after six hours or when changed evidence
requires review. Permanent financial inconsistencies, oversized plans and stale
shared work remain visible for operator review. The list includes unreconciled
grants outside the supported history window and never includes lease tokens.

Completion rechecks covered payout and settlement/earnings state, with a database
trigger checking again inside the completion write. Concurrent changed evidence
cannot commit a false completed result. Exact finish payloads are saved privately
as `queue-finish-<lease>.json`; replay uses the signed `finish` route and the same
payload. After lease expiry, resume the original job on its bound receipt storage.
No queue operation can reopen the original grant's payment authority.

The dispatcher exits 0 for held/no-work/completed, 2 for retry/review, and 1 for
dispatch failure. Installing a recurring process must preserve private storage
and retain/alert on these outcomes; a one-off invocation is not proof that
continuous operation is installed or monitored.

## Verification

`tools/checkout-test/payout-sync.test.mjs` exercises the actual PHP command,
SNAP read adapters and D1 Worker together: completed outflows, actual fee
correction deltas, interrupted responses, lost/prolonged acknowledgement outages,
recovery without provider credentials, two related payouts, incomplete coverage,
seller-paid fee rejection, private files and concurrent run exclusion.
It also covers bounded resume, cached failures, original version 1 recovery,
two sellers sharing one platform, lost queue acknowledgements and fresh checks
after a provider-pending outcome. `test/commerce-payout-sync-jobs.test.mjs`
checks concurrent claims, storage binding, lease expiry, failure limits,
completion races, periodic selection, review visibility and held deployments.
`test/commerce-payout-sync.test.mjs` checks immutable account scope, stale shared
work, legacy grants and service/deployment isolation. Provider, collection,
payment/status and payout regression suites remain part of verification.

Hosted acceptance and the identified implementation/Worker version are recorded
in [beta readiness](beta-readiness.md). Fixture results do not establish DOKU
activation, actual fee funding, bank delivery or sustained operational history.
