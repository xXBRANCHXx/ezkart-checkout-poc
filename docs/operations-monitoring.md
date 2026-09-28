# Atomic report collection and independent local watchdog

`tools/commerce/operations-monitor.py` provides two separately scheduled commands.
Neither sends notifications, starts backups, retries commerce work or changes
provider/checkout holds. The collectors feed the existing alert runner; the
watchdog inspects persisted state directly, so a failed collector or alert process
does not have to report its own failure.

## Private configuration and commands

Copy `tools/commerce/systemd/monitor.example.json` outside the checkout with mode
`0600`. Its reports directory must already be `0700`, owned by the service user,
outside the repository and web roots. Use absolute paths for the existing backup
runner configuration and alert state. Each existing private file must be owned
by that user, mode `0600`, regular and without links. The alert state directory
may be absent during initial setup; this is reported as a missing runner.

```sh
python3 -B tools/commerce/operations-monitor.py collect --config=/absolute/private/monitor.json
python3 -B tools/commerce/operations-monitor.py watchdog --config=/absolute/private/monitor.json
```

The collector runs only these fixed existing commands, with the selected `test`
or `beta` deployment:

- `node tools/commerce/operations-report.mjs --deployment=beta --fail-on-warning`
- `python3 -B tools/commerce/workbench-backup-runner.py report --config=/absolute/private/backup-runner.json`

It requires explicit `CLOUDFLARE_API_TOKEN` for the commerce command, so a missing
host credential cannot fall back to interactive Wrangler authentication. Node,
the repository's Wrangler dependencies and read access to the pinned D1 database
must be installed. Backup inspection reads local private state and does not
require Cloudflare/R2 credentials. The configured backup deployment must match.
These dependencies were not configured or exercised against a live service by
this implementation.

Collector timeouts default to 120 seconds for commerce and 15 for backup; maximum
values are 180 and 60 seconds. Stdout is capped at 128 KiB, stderr is discarded,
and the subprocess process group is killed at timeout or completion, including
leftover grandchildren. A failure in one source does not prevent collection of
the other. A separate collector lock prevents overlap without replacing an active
collector's heartbeat.

## Published reports and failure semantics

`commerce.json` and `backup.json` preserve their existing machine-report schema,
original observation time and warning codes. Only known aggregate counters,
fixed states and timestamps are copied. Backup run IDs, receipt fields, arbitrary
extra metadata, credentials and stderr never enter the published reports.
A response must have the selected scope, supported version, valid required fields,
a recent observation time and an exit status matching its warning status.

Each write creates a new private temporary file, flushes and fsyncs it, atomically
replaces the destination and fsyncs the directory. Readers see the old complete
report or the new complete report. Failed replacements preserve the old file;
the process exits with a fixed failure report. An abrupt host/process interruption
can leave a harmless temporary file; it cannot promote a partial report.

A source failure atomically replaces old healthy output with an `exitCode: 1`
marker containing only deployment, source, observation time and a fixed reason:
`collector_credentials_missing`, `collector_timeout`,
`collector_output_too_large`, `collector_command_failed`,
`collector_json_invalid`, `collector_scope_invalid`, `collector_schema_invalid`,
`collector_exit_mismatch`, `collector_clock_invalid` or
`collector_inspection_failed`. The alert consumer retains previously accepted
underlying warnings when it sees this marker. A later fresh successful collection
replaces it normally, allowing the existing alert lifecycle to report recovery.

`collector-status.json` is written before invoking tools and after each source,
with a final completion status. Exit 0 means both observations completed without
source warnings, 2 means observations completed with warnings, and 1 means at
least one inspection or publication failed. No command output is forwarded into
an error message.

## Independent watchdog

A separate process reads these inputs directly, without starting a subprocess,
loading API credentials, calling the alert transport or modifying monitored state:

- Collector start/completion heartbeat and both published report timestamps.
- The backup runner's original `runner-<deployment>/status.json` heartbeat and
  attempt state, even when its report collector is failing.
- The alert SQLite metadata heartbeat through a read-only connection, oldest
  pending event and delivery-review flags, even when the alert process is failing.

It detects missing, malformed, future or stale state; failed/interrupted collector
and backup attempts; absence of any backup success; overdue alert delivery; and
Resend uncertainty requiring review. Default stale age is fifteen minutes,
configurable between one minute and one hour. A legitimately running backup is
allowed through its original deadline, capped at one hour from its start. That
allowance ends at the deadline and never counts as backup success. The watchdog
checks liveness and stored failure state; it does not re-audit financial records
or prove current remote backup durability.

Each pass atomically publishes `watchdog.json` with fixed warning codes, timestamp
and exit status. Exit 2 deliberately fails the watchdog systemd unit, making it
visible to independent local service supervision; exit 1 means its own inspection
could not complete. Exit 0 means no monitored local failure was found. No alert is
sent through the potentially broken alert runner. Recovery replaces the watchdog
report with a fresh healthy observation while previous journal entries remain.

## Templates and remaining installation

The uninstalled `ezkart-monitor.service/.timer` collect every five minutes.
The separate `ezkart-watchdog.service/.timer` check every minute, with no dependency
on the monitored services' successful startup. Templates expect the reviewed
checkout at `%h/ezkart-operations` and configuration at
`%h/.config/ezkart-monitor/monitor.json`. Only the monitor service reads its private
`credentials.env`; the watchdog needs no credential file. Service ceilings are
five minutes and thirty seconds, respectively. A continuously running user
manager and durable local state are required.

Point the alert runner's configured inputs to this same reports directory.
The collector, alert, backup and watchdog templates are not installed or enabled
by this change. Host credentials, paths, operator ownership, recipient and a first
real read-only collection remain installation/acceptance tasks.

An external machine must still monitor host reachability and the freshness of
`watchdog.json`, or another independently accepted escalation channel. A local
watchdog cannot observe its own powered-off host or failed user service manager.
No external watchdog integration or notification route is configured here.

```sh
python3 -B -m unittest discover -s tools/commerce -p test_operations_monitor.py -v
systemd-analyze --user verify tools/commerce/systemd/ezkart-monitor.service tools/commerce/systemd/ezkart-monitor.timer tools/commerce/systemd/ezkart-watchdog.service tools/commerce/systemd/ezkart-watchdog.timer
```

Offline tests cover real bounded subprocesses/process-group cleanup, failure and
recovery, absent credentials, atomic replacement failure, privacy, exact read-only
commands, schema/scope/exit mismatches, oversized output, permissions/overlap,
independent stale/missing/interrupted heartbeats and overdue delivery. No remote
report, backup or notification was executed.
