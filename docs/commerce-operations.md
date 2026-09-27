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

The command does not install a scheduler or send alerts. Before opening the beta
to buyers, a named operator, review cadence and alert destination still need
acceptance. Automatic email delivery and the existing checkout/provider holds
remain independent. No outgoing message is authorized by invoking this report.

## Verification

Six D1-backed cases cover environment isolation, unchanged jobs, private output,
expired leases and due work, historical capture catch-up, balanced but incorrect
journal lines, order review flags, additional captures, transactional/campaign
delivery evidence, intentional campaign cancellation, invalid arguments and
incomplete responses. Provider transport in these cases is isolated and mocked.

The first beta inspection at 10:02 UTC on 27 September reports exactly one
uncertain job: the preserved wallet registration. There are no orders, captures,
journals or application email requests. `--fail-on-warning` correctly returns 2;
the command does not retry or change the wallet attempt.
