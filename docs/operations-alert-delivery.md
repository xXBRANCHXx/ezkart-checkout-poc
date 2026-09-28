# Workbench operations alert delivery

`tools/commerce/operations-alert-runner.py` consumes private JSON files produced
by the existing commerce and backup machine reports. It does not inspect D1,
collect provider evidence, start backups, retry commerce jobs, or change any
financial hold. No destination or schedule is configured by this change.

## Commands and private configuration

Use Python 3.11+ on a Linux host, with a durable local filesystem and outbound
HTTPS. No additional Python package is required. Create the state directory
outside the repository with mode `0700`, owned by the runner user. Copy
`tools/commerce/systemd/alerts.example.json` outside the repository to a `0600`
file and replace its absolute state/report paths. Each input file must be a
regular `0600` file owned by that user, without symlinks or hard links. Report
collectors should write a private temporary file, fsync it, then atomically rename
it over the configured report. Never update a report's observation time unless a
fresh inspection actually completed.

```sh
# Local ingestion only; never sends, even if credentials are present.
python3 -B tools/commerce/operations-alert-runner.py queue --config=/absolute/private/alerts.json

# Delivery-capable runner: use only after the destination has been authorized.
python3 -B tools/commerce/operations-alert-runner.py run --config=/absolute/private/alerts.json

# Read-only outbox and runner-liveness report.
python3 -B tools/commerce/operations-alert-runner.py report --config=/absolute/private/alerts.json
```

Configuration selects `test` or `beta`; state is bound to that deployment.
`inputs` explicitly selects commerce, backup, or both. Their contracts are
commerce report version 2 and backup report version 1. Files are capped at
128 KiB and configured freshness at 60–86400 seconds. The example uses fifteen
minutes. A missing, malformed, failed, stale, regressed, conflicting or future
report creates a fixed input warning and **retains the last accepted underlying
warning codes**. It cannot clear an incident. A fresh valid report can resolve
both its inspection failure and its original warnings.

The destination is an explicit HTTPS URL from private `endpoint` configuration
or `EZKART_ALERT_ENDPOINT`. Authentication is a bearer token from
`EZKART_ALERT_TOKEN` (the two environment variable names may be configured).
There is no default recipient, discovery, command-line credential, webhook
query-token support, or built-in Slack destination. A concrete Resend email
transport is available through the separate configuration below. Missing credentials
leave events queued and report `alert_destination_unconfigured`. Queue ingestion
works without credentials. Use a private `0600` environment file for systemd;
never put credentials into the checked-in example or process arguments.

## Concrete Resend email transport

Use `tools/commerce/systemd/alerts-resend.example.json` as the private configuration
for `transport: "resend"`. A custom receiver is not required for this mode. Supply
these values only through its private environment file:

- `EZKART_ALERT_ENDPOINT`: exactly `https://api.resend.com/emails`.
- `EZKART_ALERT_TOKEN`: an authorized Resend sending API key.
- `EZKART_ALERT_FROM`: one verified sending-domain email address, lowercase.
- `EZKART_ALERT_TO`: the explicitly selected operator email address, lowercase.

None is configured by the example. Sender/recipient are envelope addresses;
email subjects and plain-text bodies contain only sanitized operational codes,
source/deployment, timestamps and the stable alert ID. This creates operational
alerts independently of customer-commerce email jobs and their activation cutoff.

The adapter implements Resend's documented [Send Email API](https://resend.com/docs/api-reference/emails/send-email):
POST `/emails`, bearer authentication, `from`, `to`, `subject`, `text`, tags and
a confirmed provider email ID. It uses the event ID as `Idempotency-Key` and
stores the exact original email body before the first network attempt. Resend
keeps [idempotency keys for 24 hours](https://resend.com/docs/dashboard/emails/idempotency-keys),
so this implementation stops retries after 23 hours from its first durable
attempt, allowing margin for time and request duration. It retains expired
uncertainty with `alert_delivery_needs_review`; it never creates a new key to
resend that uncertain email. Sender, recipient and credential changes also
cannot silently move an unresolved attempt into another recipient/account.
This follows the existing commerce email delivery's conservative retry window.

A successful provider response and UUID are saved atomically with local transport
acknowledgement. The outbox's `delivered` count means **submission accepted by
Resend**, not inbox delivery. Bounces, suppression and human receipt still require
provider monitoring/independent escalation; this slice does not connect alert
emails to the customer-commerce webhook tables. Unknown submissions outside the
retry window require inspection of the original provider request, not reset.
Official API contracts were checked on 28 September 2026. Only local fixtures
were used; no alert email was sent.

## Durable outbox and webhook transport contract

Each warning-set change, recovery and periodic reminder gets a stable event ID
under a durable installation identity. An unchanged warning set produces no
extra event until `reminderSeconds` (default one hour). Warning-code changes
include resolved codes. Fresh healthy initial input produces no event. Payloads
contain only version, stable ID, deployment, one of the fixed source names,
event kind, timestamps and allowlisted warning codes. They never copy customer
identities, source paths, raw receipts, report metadata, credentials, exception
text or provider messages.

SQLite uses full synchronous commits. The process holds an exclusive
nonblocking lock for the entire bounded pass. A persisted attempt precedes each
network request; a crash or lost acknowledgement retries its **same ID and exact
body**. Exponential retry delay is bounded by `maxRetrySeconds`; a pass sends at
most `maxDeliveries` (default four). Earlier uncertain events block later events
so recovery cannot overtake its warning. Destination changes are refused while
an attempted event remains unresolved; token rotation for the same webhook endpoint is
allowed. Resend holds unresolved submissions when the credential changes. Nothing clears or reassigns an uncertain delivery automatically.

For `transport: "webhook"` (the default), the custom endpoint must implement
a durable inbox with this contract:

1. Authenticate `Authorization: Bearer …` and require `Idempotency-Key` to equal
   the JSON body's `id`.
2. Atomically retain each original ID and canonical payload before acknowledging.
   Repeated IDs with the same payload return the original acknowledgement and
   must not create another downstream notification. Different content for an
   existing ID must be rejected. Retain deduplication records for the entire
   lifetime of retryable/restorable outboxes; there is no assumed expiry.
3. Reply with a JSON object such as `{"id":"ezalert_…","accepted":true}` and a
   successful HTTP status only after durable acceptance. The content type must
   be `application/json` and the response body at most 4096 bytes. An empty 2xx,
   wrong ID, false acknowledgement, malformed response or timeout stays uncertain.

Requests use TLS certificate verification. HTTP, userinfo, query strings,
fragments and control characters are rejected. Redirects are never followed.
The configured 1–30 second total deadline includes connection, request and
response processing. The standard HTTP parser also bounds response headers.
“Delivered” means the adapter durably acknowledged the event; it does not prove
that an email/chat message reached a person. A custom webhook recipient adapter must implement
and monitor downstream delivery itself. Resend submission uses the concrete
provider response described above. There is no safe exactly-once delivery
claim without endpoint deduplication.

## Bounds, reporting and ownership

The database retains event history up to `maxEvents` (default 10,000). At capacity,
collection fails explicitly with `alert_outbox_full`, rolling back that pass's
source changes; it does not discard events or claim recovery. Already queued
deliveries can still drain even when collection reaches capacity. Review capacity
and archive the installation under an approved maintenance procedure before
replacing state. Deleting an uncertain outbox or recreating its identity can
produce duplicate external alerts. This runner supplies no automatic deletion.

`report` returns counts and fixed source/runner warning codes. It reports pending
and uncertain delivery, delivery overdue at `overdueSeconds` (default fifteen
minutes), missing destination and absent/stale runner polls. `queue`/`run` return
0 when the runner/outbox has no warning, 2 for pending/configuration/liveness
attention, and 1 for failed inspection or state/configuration errors. A successful
alert delivery does not mean the source commerce warnings are resolved; current
source codes remain in `sources`. There are no customer promises attached to these
internal thresholds.

A separate watchdog must poll `report` and check process exit status. A dead host
or broken sole destination cannot report its own outage through that same path.
Accept a named operator, alternate escalation route and review cadence before
using this as live incident delivery. Refreshing input files is also a separate
dependency: collect `operations-report.mjs --deployment=beta --fail-on-warning`
and `workbench-backup-runner.py report` with their existing private credentials,
then atomically publish their JSON. A collector failure may publish the fixed
`{"exitCode":1}` marker; do not preserve old healthy data with a new timestamp.
Missing/old data is detected even if the collector cannot publish that marker.

## Uninstalled scheduling templates and verification

`tools/commerce/systemd/ezkart-alerts.service` and `.timer` are templates for a
one-minute bounded pass, not an installation. They expect the reviewed repository
at `%h/ezkart-operations`, private configuration under `%h/.config/ezkart-alerts`,
and a `0600` credentials file. The service has a six-minute hard ceiling; runtime
bounds limit at most ten requests of thirty seconds each. Installing/enabling
these templates would authorize real sends once credentials are set, so that is
a separate deployment step. This change installs neither collectors nor timers.

```sh
python3 -B -m unittest discover -s tools/commerce -p test_operations_alert_runner.py -v
systemd-analyze --user verify tools/commerce/systemd/ezkart-alerts.service tools/commerce/systemd/ezkart-alerts.timer
```

The focused fixtures exercise queued/duplicate/changed/recovered/overdue states,
missing and stale reports, failed inspections, report scope and privacy,
uncertain-send retries, crash recovery, endpoint changes, capacity, overlap and
permissions. A local HTTPS server verifies the actual authentication/idempotency
headers, exact acknowledgement, rejected redirects, failed/malformed/oversized
responses, dropped connections, certificate verification and total timeout. The Resend
cases also cover its actual UUID response, frozen retry body, missing recipient,
recipient/account changes and refusal to retry outside the safe idempotency window.
No real destination is configured or contacted by these tests.
