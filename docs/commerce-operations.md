# Workbench commerce inspection

Run the read-only report with the repository's existing Cloudflare access:

```sh
node tools/commerce/operations-report.mjs --deployment=beta --fail-on-warning
node tools/commerce/digital-storage-report.mjs --deployment=beta --fail-on-warning
```

The commerce command requires an explicit `test` or `beta` selection, pins the
database UUID and queries the corresponding sandbox or production records. It
accepts no SQL, job ID, retry, reset or provider action. One aggregate query reads
the records and the response must confirm zero rows written. Output contains
counts, the observation time and fixed warning codes, without seller/buyer
identities, addresses, request bodies, credentials or provider messages. The
command has no hosted HTTP interface and requires the current workbench schema.

## Signals and response

| Signal | Meaning and next step |
| --- | --- |
| `jobs_uncertain` | A result is unknown. Inspect the original request and attempt through its private recovery workflow; never reset it or submit a new identity. |
| `jobs_dead` | Work exhausted its retries or stopped with a failure. Review its saved outcome before deciding a recovery action. Campaigns deliberately cancelled before their first send are counted separately. |
| `job_leases_expired` | A running job has a missing/expired lease. Inspect the attempted external action before using its existing reconciliation path. Inspection itself does not expire or reclaim the lease. |
| `jobs_overdue` | Queued/retry work has been due for more than fifteen minutes. Check deployment holds and the appropriate dispatcher before treating this as an outage. Future scheduled work is excluded. |
| `orders_payment_review`, `orders_stock_review`, `orders_shipping_review` | Open the affected orders in the authorized merchant workspace and resolve the recorded payment, stock or courier evidence. Do not fabricate provider success or delivery. |
| `capture_journals_missing` | A verified capture lacks its journal. Use the existing bounded capture reconciliation workflow after checking the deployment and saved capture. |
| `capture_allocations_need_review` | Additional receipts or captures with an unrecognized original fee policy remain in suspense. Do not count them as seller earnings. |
| `financial_journals_inconsistent` | Entry counts, balances or individual lines disagree with the immutable journal. Keep financial execution held and preserve incident evidence; do not edit original accounting to clear the alert. |
| `transactional_email_attention`, `campaign_email_attention` | The existing email investigation rules identify a retry/unknown/exhausted job, submission without final evidence after fifteen minutes, or failed/bounced/complained/suppressed delivery. Use the corresponding private investigation command and original email identity. |
| `payout_sync_review`, `payout_sync_leases_expired`, `payout_sync_overdue` | The latest shared-platform run needs review, a live job lease expired, or queued/retry work is more than fifteen minutes overdue. Resume the original run on its original receipt storage; no payment retry is authorized. Superseded historical review jobs do not create a current review alert. |
| `payouts_need_reconciliation`, `payout_accounts_unassigned`, `payout_history_outside_window`, `settlement_sources_stale` | Existing payout grants or settlement sources need reconciliation, original account review or extended history. These signals describe stored evidence and do not establish current DOKU balances. |
| `payout_runner_not_observed`, `payout_runner_overdue`, `payout_runner_interrupted`, `payout_runner_failed` | No scheduled runner has been recorded, no pulse arrived for fifteen minutes, its lease expired, or its latest pass failed. Check the host cron output and private runner receipt before continuing the original queue work. |
| `payout_runner_held` | The scheduler is running with provider collection held. This is an explicit execution hold, not evidence that live money flows are accepted. |
| `refund_reviews_stale` | An open refund review has had no update for 48 hours. An authorized reviewer should inspect its original evidence and any outstanding information request. This threshold is not a customer response-time promise. |

Email signals include saved callbacks and verified provider lookups. Later
delivery evidence clears the missing-delivery condition, while a later bounce or
complaint remains actionable. Historical failures are retained; this report is
not an incident acknowledgement system. The standalone owner connection email
is outside these application delivery records and is not counted as an order email.

Exit 0 means inspection completed; with `--fail-on-warning`, it also means none
of the listed warning conditions was present. Exit 2 means at least one warning
was found under that flag. Exit 1 means inspection was not confirmed. Missing or
malformed data cannot be reported as healthy.

This reports application records, not DOKU provisioning, current provider
balances, settlement, withdrawable funds, live shipping readiness or launch
acceptance. Empty records do not prove those services work. Continue the
[storage checks](digital-storage-operations.md),
[recovery procedures](workbench-recovery.md) and
[beta acceptance](beta-readiness.md).

## Execution and ownership

Run both reports before a beta acceptance session and after a deployment affecting
commerce. During a money-flow exercise, retain timestamped reports with its
original provider evidence. A failed report is an operational issue, not an
invitation to enable a held dispatcher or repeat an unknown financial request.

The command does not install a scheduler or send alerts. The separate
[payout runner](withdrawal-synchronization.md#scheduled-runner-and-liveness) records
a bounded heartbeat, and report version 2 includes that state plus current queue
and financial reconciliation signals. Migration 0064 also adds open refund review
counts, cases awaiting each party and the 48-hour stale-case signal. Read-only inspection never renews a lease
or clears an alert. Before opening the beta
to buyers, a named operator, review cadence and alert destination still need
acceptance. Automatic email delivery and the existing checkout/provider holds
remain independent. No outgoing message is authorized by invoking this report.

## Verification

Six baseline D1-backed cases cover environment isolation, unchanged jobs, private output,
expired leases and due work, historical capture catch-up, balanced but incorrect
journal lines, order review flags, additional captures, transactional/campaign
delivery evidence, intentional campaign cancellation, invalid arguments and
incomplete responses. Provider transport in these cases is isolated and mocked.
Five runner/queue inspection cases additionally cover stale and expired liveness,
held execution, immutable storage, overlapping starts, exact completions, migration
preservation and exclusion of superseded review results. PHP integration covers
the actual scheduled command and original receipt recovery without repeated reads.

The first beta inspection at 10:02 UTC on 27 September reports exactly one
uncertain job: the preserved wallet registration. There are no orders, captures,
journals or application email requests. `--fail-on-warning` correctly returns 2;
the command does not retry or change the wallet attempt.

At 19:57 UTC, the runner-enabled report identifies that same uncertain wallet and
`payout_runner_not_observed`. The first normal Hostinger cron pass at 20:00:02
records a held heartbeat with no failures, interruptions or provider calls.
The 20:00:34 read-only report then returns exactly `jobs_uncertain` and
`payout_runner_held`, with no reconciliation backlog. Warning exit 2 is intentional:
scheduler liveness does not clear the uncertain wallet or enable provider reads.
External alert delivery and operational ownership are still unaccepted.


## Host backup signal adapter

The backup host supplies a separate read-only JSON report (no schema migration):

```sh
python3 -B tools/commerce/workbench-backup-runner.py report --config=/absolute/private/runner.json
```

Poll this alongside the commerce report every five minutes. Exit 2 and the
`backup_*` warning codes expose missing/overdue scheduler polls, never-successful
or overdue backups, failed/interrupted attempts and clock problems. Exit 1 or a
missing host response is an inspection failure. Last attempt, verified success
and original failure are recorded durably; the report does not contact R2 or
establish fresh remote durability. A successful commerce report does not imply
healthy host backups. See [backup runner and installation](workbench-backup-command.md#recurring-execution-and-machine-readable-monitoring)
for the schema, timer, credential dependencies and remaining alert-routing step.

## Durable external alert outbox

The [alert runner](operations-alert-delivery.md) now ingests private commerce and
backup machine-report files, queues warning changes/recoveries/reminders and
supports bounded authenticated HTTPS delivery with durable original IDs and
explicit endpoint deduplication. Missing/stale inputs and overdue delivery remain
visible. Its `queue` command never sends. The delivery adapter, input collectors,
recipient, credentials, independent watchdog and schedule still require an
accepted installation; none is configured or enabled by this implementation.
