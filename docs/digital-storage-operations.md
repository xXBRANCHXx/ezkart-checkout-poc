# Digital storage operations

The existing hourly maintenance schedule removes at most five eligible unpublished
uploads per invocation. An incomplete upload expires after 24 hours; a completed
unpublished upload after seven days. A published version is retained permanently
under the current policy, even after catalog deletion or replacement. Purchased
files, expired buyer grants and refund requests do not authorize deletion.

## Recovery and monitoring

Migration 0047 adds four operational columns on the existing upload record,
one retry index and a singleton maintenance heartbeat. Original upload identities,
bytes, parts, versions and purchase evidence are not rewritten. No new cron,
public endpoint, provider operation or commerce activation flag is introduced.

Each attempt fences publication in D1 and records its time/count and next retry
before touching R2. One failed storage deletion leaves the upload in `deleting`
with the fixed `cleanup_unconfirmed` code; it no longer aborts the remaining
bounded batch. Retry waits one hour. A lost R2 deletion response can retry the
same immutable object key; an already absent multipart upload/object is safe.
Provider messages and private object names are excluded from the operational report.

A twenty-minute database lease serializes overlapping invocations. A lost lease
acknowledgement performs no storage deletion and recovers after expiry. Each
successful run records completion and selected/removed/failed counts. An
interrupted process leaves its unfinished heartbeat and attempted-upload state.
The report distinguishes unobserved, stale, interrupted, partial and failed runs.
Its last-run record is bounded to one row; per-upload retry metadata is retained
with the existing immutable upload history.

Publication is rechecked when claiming a selected file. A version published
between selection and claim survives. Once a claim has fenced the file as
`deleting`, publication is rejected by the existing transaction guard. Cleanup
does not revoke purchases, rewrite delivery receipts or touch money/stock.

## Read-only workbench inspection

With the repository's existing Cloudflare TEST access:

```sh
node tools/commerce/digital-storage-report.mjs --fail-on-warning
node tools/commerce/digital-storage-report.mjs --deployment=beta --fail-on-warning
```

The command runs one fixed aggregate D1 query against TEST by default or the
explicitly selected beta database. Beta reports its production provider mode;
`--deployment=production` and any main target remain rejected. It accepts no SQL,
object key or mutation argument. It exposes counts,
decimal-string byte totals, due/deferred/unconfirmed cleanup and the last heartbeat.
It prints no filename, account identity, buyer, grant, private storage path or
provider response. There is no new HTTP interface.

Exit 0 means the requested inspection completed (and, with `--fail-on-warning`,
no listed warnings were present). Exit 2 means warnings are present under that
flag; exit 1 means the inspection was not confirmed. Missing/stale maintenance,
an expired running lease, incomplete cleanup, uncertain outcomes and more than
one hourly batch of due work are explicit warnings. Inspect saved state and the
private Worker logs before retrying an uncertain operation. Never delete a
published file or edit its original records to clear an alert.

Byte totals describe D1-recorded ready files and verified in-progress parts.
They exclude unrecorded orphan multipart uploads, R2 billing overhead and replicas;
they are not a bill or remaining quota. R2's existing seven-day incomplete-upload
lifecycle still handles unrecorded orphan initiations. Five files per hour is an
operational limit to monitor as stores grow. A healthy empty run proves scheduling,
not deletion capacity under real traffic or a completed disaster-recovery exercise.

## Verification

Six maintenance cases pass: continuing after failure with fair retries; concurrent
leases and lost claim acknowledgements; publication races and uncertain R2 deletion;
read-only inspection and failed/stale heartbeats; populated migration; and the
nineteen-query maximum for a five-file batch. The eight original file cases and
eleven digital commerce cases also pass. Published purchase bytes, original
accounting and file history survive cleanup unchanged.

The fresh private TEST backup is 694,485 bytes, SHA-256
`c3ff4374b11176d4e5c61c0e672577a7d8b44adad2e953563571b1ab115c585c`.
Restoration/migration preserves original records in 144 physical tables with
clean integrity/foreign-key checks and all 417 captured compatibility plans.
It changes the upload table only by adding four operational columns and adds
the retry index and heartbeat table. Syntax, diff and TEST dry-run checks pass.

Implementation `56c6fab` is pushed to workbench. TEST migration 0047 and Worker
`32567d92-a27e-42f2-9ff5-9ecd27c2afdb` are installed. All twenty-five Worker checks
pass at 04:24:15 UTC and all twenty-nine hosted asset/access/guest checks pass at
04:24:18 UTC on 27 September. Final remote verification matches the restored
schema, preserves original record counts/settings/legacy evidence, compiles all
417 query plans and finds no pending migration or foreign-key error.

The initial inspection at 04:24:14 UTC reports zero uploaded files and no
maintenance heartbeat, with `maintenance_not_observed` and warning exit 2.
Deployment followed the ordinary hourly :17 run. The next scheduled invocation
started at 05:17:32 UTC and completed at 05:17:33 UTC on 27 September, selecting
zero files and reporting zero failures. The read-only report returned no warnings
and exit 0. This establishes the ordinary schedule and empty-run heartbeat.
No synthetic file, cleanup invocation, purchase,
delivery or money movement was created for hosted verification. Financial and
provider holds remain unchanged.

On 27 September, beta selection and rejection of main/duplicate/conflicting flags
pass two focused inspection cases. The live beta inspection at 07:59 UTC reports
zero uploads, retained files, cleanup backlog and unavailable purchase files,
with `maintenance_not_observed` because beta had no schedule yet.

The first scheduling attempt reached Cloudflare's five-cron free-account limit.
The deployed TEST version was checked: it has no commerce-storage activation,
email-send activation or Resend key, so its `*/2 * * * *` email trigger does no
work. That inactive trigger was removed and its slot reassigned to beta's hourly
`:17` housekeeping. Both trigger updates succeeded without uploading application
code or changing data, provider configuration, TEST's other three schedules or
main's schedule. Beta's first ordinary run still needs to be observed. This
schedule does not enable transactional or campaign email delivery.
