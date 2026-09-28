# Scheduled workbench backup command

`tools/commerce/workbench-backup-bundle.py` adds encrypted D1 + R2 backups alongside
unchanged `workbench-backup.py create/verify`. Requires Linux, Python 3.11+,
OpenSSL with CMS AES-256-GCM, and the repository's installed Wrangler. It uses the
approved beta/test database UUIDs and bucket names. It cannot target main.

Supply `CLOUDFLARE_ACCOUNT_ID` and a `CLOUDFLARE_API_TOKEN` authorized for D1
export, plus separate `R2_ACCESS_KEY_ID` and `R2_SECRET_ACCESS_KEY` for R2's S3
API. The R2 credentials need Object Read & Write scoped to the selected beta/test
public and private buckets. The adapter only writes the private backup prefix.
These variables are operator dependencies; an existing interactive Wrangler
login does not provision them for the scheduler. No worker credentials were
available or read during implementation.
No credentials are read from private account files, generated, or stored in
receipts. Supply an existing **public RSA recovery certificate**; its private key
must stay separately held. Backup creation never requires that key.

Use one stable, owner-only state directory per scheduler installation, outside
Git and web roots. Create the parent privately before the first run. Example
paths below are placeholders:

```sh
python -B tools/commerce/workbench-backup-bundle.py archive --once \
  --deployment=beta --state-directory=/absolute/private/backup-state \
  --certificate=/absolute/public/recovery-certificate.pem
```

This is the single-run invocation. The recurring runner and reviewable timer
configuration are described below; nothing is installed or enabled by this command.
Use the same state directory on every invocation. An exclusive nonblocking
`flock` covers the entire run and retention, separately for beta/test. The OS
releases the lock after exit or a crash; do not remove its lock file. This is a
single-host lock, not a distributed lease across multiple scheduler hosts.

The default deadline is 900 seconds (`--timeout-seconds`, maximum 86400). Asset
bounds default to `--max-pages=100` per bucket, `--max-objects=10000` total,
`--max-object-bytes=33554432`, and `--max-total-bytes=268435456`. Objects are
streamed. The existing 512 MiB SQL rehearsal limit remains; a bundle/expanded
archive is capped at 2 GiB and asset count cannot exceed 20000. Exceeding any
bound fails closed. Choose limits within available private disk space.

Each new run uses an exclusive timestamp/UUID directory. It verifies D1 identity,
exports and rehearses SQL locally, paginates both buckets, compares object sizes
and ETags, and compares inventories before/after download. All descendants of
`operations/backups/` are excluded. Original keys and returned listing/HTTP/custom
metadata are recorded privately. These are separate D1/R2 observations, not an
atomic snapshot across services.

The archive includes D1 recovery evidence, R2 bytes, and a hash manifest. OpenSSL
seals it using CMS AES-256-GCM and RSA-OAEP/SHA-256. The only uploaded object is
ciphertext at this fixed, unique key:

`operations/backups/ezkart-workbench-v1/{beta|test}/{timestamp-uuid}/snapshot.cms`

The run records upload intent before sending bytes, rejects an existing key, uses
`If-None-Match: *`, downloads the uploaded object, and compares exact size/SHA-256.
Only then does it atomically save private `receipt.json`. Exit zero reports that
verified backup; it does **not** claim offline decryption was performed. Files
are 0600, directories 0700. After success, SQL/assets/plaintext tar staging is
removed; ciphertext and private hash/asset manifests remain. This is ordinary
file removal, not secure erasure. Failed runs retain staging and stage evidence.

## Interrupted runs and retention

`state.json` is updated atomically at each stage. `incomplete.json` records caught
failures; even an abrupt kill leaves the last durable stage. For `upload_intent`
or `readback`, use the recorded run ID:

```sh
python -B tools/commerce/workbench-backup-bundle.py recover --once \
  --deployment=beta --state-directory=/absolute/private/backup-state \
  --run-id=TIMESTAMP-UUID
```

Recovery verifies the existing local ciphertext and exact remote readback. It
never retries an upload or deletes anything. Missing/different remote bytes
remain unverified; preserve evidence and start a fresh run with a new key.
Earlier failures require a fresh run. Original failure evidence remains even
after successful recovery. The runner/report below exposes failure and overdue state;
there is no configured external alert destination.

Default `--retain=0` deletes nothing. Explicit `--retain=N` (N >= 1) keeps the new
verified copy and N-1 most recently completed eligible copies. Retention first
rechecks the new copy, then considers only this tool/environment's private local
success receipts with exact allowed keys and matching remote ciphertext hashes.
It never scans a remote prefix for deletion candidates. Historical one-off
backups, untracked objects, incomplete runs, changed ciphertext and application
objects are excluded. Losing local receipts therefore disables their eligibility.
After an acknowledged remote deletion, the matching old local ciphertext is
removed; small manifests/receipts and deletion evidence remain. Failed-run
artifacts are never automatically pruned. A retention failure exits nonzero and
records `retention-incomplete.json`; the new verified backup remains usable.

## Offline verification and restore

Keep the private receipt with the ciphertext, or copy both into a private recovery
workspace. Restore requires the separately held private key as a 0600 file:

```sh
python -B tools/commerce/workbench-backup-bundle.py restore --deployment=beta \
  --ciphertext=/absolute/private/snapshot.cms \
  --receipt=/absolute/private/receipt.json \
  --private-key=/absolute/separate/recovery-key.pem \
  --output=/absolute/private/new-restoration
```

The output must be new. Restore checks the receipt/environment/ciphertext hash,
requires authenticated GCM CMS, and waits for successful OpenSSL authentication
before parsing any plaintext. Untrusted decrypt output is removed on failure.
It checks exact archive members and hashes, rejects traversal/links/duplicates,
rehearses D1 again and checks every asset. It uses no network and never modifies
remote databases/assets. Independent key custody and whole-application recovery
remain operational responsibilities; this does not back up external auth,
provider records, hosting configuration or runtime secrets.

Focused offline tests (ephemeral test keys and fake provider/storage only):

```sh
python -B -W error::ResourceWarning -m unittest discover -s tools/commerce -p test_workbench_backup.py -v
python -B -W error::ResourceWarning -m unittest discover -s tools/commerce -p test_workbench_backup_bundle.py -v
```

## Provider contract and credentials

The object adapter uses the documented R2 S3 endpoint at
`https://<account>.r2.cloudflarestorage.com`, SigV4 region `auto`, and streamed
raw bytes. It has no network retries and refuses redirects. ListObjectsV2 uses
`list-type=2`, `max-keys`, URL-encoded object keys and opaque continuation tokens;
missing truncation status or a missing continuation token fails closed. GET
metadata headers, including `x-amz-meta-*`, are kept privately with each asset.
S3 listing ETag/size/last-modified/storage class are also retained. Listing does
not return custom metadata; it is captured from each object's GET response.

The prior REST transport encoded slashes in object paths, assumed a JSON upload
acknowledgement, and relied on an undocumented REST conditional upload. Current
REST documentation requires literal slashes and caps uploads at 300 MB. S3
explicitly supports conditional PutObject, so this command sends a signed
`If-None-Match: *` and checks HTTP 200; deletion checks HTTP 204, including empty
bodies. Existing object collisions, failed requests and lost acknowledgements
are never retried. The existing exact ciphertext readback remains mandatory.

Contract sources checked 28 September 2026:

- [Cloudflare S3 compatibility](https://developers.cloudflare.com/r2/api/s3/api/)
- [Cloudflare R2 authentication and bucket-scoped permissions](https://developers.cloudflare.com/r2/api/tokens/)
- [Cloudflare REST Get Object](https://developers.cloudflare.com/api/resources/r2/subresources/buckets/subresources/objects/methods/get/)
- [Cloudflare REST Upload Object](https://developers.cloudflare.com/api/resources/r2/subresources/buckets/subresources/objects/methods/upload/)
- [S3 ListObjectsV2 response and pagination](https://docs.aws.amazon.com/AmazonS3/latest/API/API_ListObjectsV2.html)
- [AWS SigV4 canonicalization and published signature fixtures](https://docs.aws.amazon.com/AmazonS3/latest/developerguide/sig-v4-header-based-auth.html)

This supports the selected buckets' default jurisdiction. Jurisdiction-specific
endpoints and temporary session credentials are not configured by this slice.
The transport is checked against official request contracts and offline HTTP
fixtures, including an independent published AWS signature. No authenticated R2
backup was performed; operator credentials and a first real verified run remain
required.

## Recurring execution and machine-readable monitoring

`workbench-backup-runner.py run --config=/absolute/private/runner.json` performs
at most one due backup. The config must be a 0600 regular file owned by the runner
user. Copy `tools/commerce/systemd/runner.example.json` to a private location,
replace its absolute paths and retain its explicit beta/test selection. The
certificate contains only the public RSA recovery certificate; keep the private
key separately. The state directory must already exist as 0700 outside repository
and web roots. Use exactly one host and one stable state directory per deployment.

The default interval is 24 hours, failure retry delay one hour, overdue grace one
hour and deadline 15 minutes. Runs are capped at one hour. Each five-minute poll
updates `runner-<deployment>/status.json` and creates no backup when one is not
due. Last attempt, last verified success and last failure survive restarts. A
private per-attempt record is retained; a later successful run does not erase old
failure evidence. A failed retention phase still records the verified new copy
as last success while reporting the attempt as failed. No receipt means no success.

A separate nonblocking runner lock covers due selection and state updates; the
archive/recovery lock still excludes manual overlapping archive work. Overlap
returns `overlap_skipped` without changing the active attempt or starting work.
Missed intervals coalesce into one new snapshot; there is no catch-up loop. After
a crash, the next poll records the abandoned attempt as interrupted and respects
the retry delay before a fresh identity. It may recognize an already durable
local verified receipt but never uploads the original key or automatically
recovers an uncertain upload. Manual `recover` remains the path for remote
readback of that original evidence. The runner reports its own scheduled
attempts; manually recovered copies do not silently reset its schedule.

Read-only JSON monitoring needs no Cloudflare credentials and makes no remote
calls:

```sh
python3 -B tools/commerce/workbench-backup-runner.py report \
  --config=/absolute/private/runner.json
```

Exit 0 means the saved schedule has no current warnings; 2 means warnings; 1
means execution/inspection failed. The schema contains `observedAt`, `lastSeenAt`,
`lastAttempt`, `lastSuccess`, `lastFailure`, `nextDueAt`, `due`, `running`, and
`warnings`. It omits credentials, object keys, provider bodies and private paths.
Poll it independently every five minutes alongside `operations-report.mjs`.
`backup_runner_not_observed`, `backup_runner_overdue` (no poll in 15 minutes),
`backup_never_succeeded`, `backup_overdue` (interval plus grace), `backup_failed`,
`backup_interrupted`, `backup_clock_invalid` and `backup_runner_inspection_failed`
are actionable signals. An active bounded run is not a successful backup.
An external monitor must poll even when the runner host is down and treat a
missing report as failure; the local timer cannot alert about its own dead host.
No alert is sent by either command, and external alert routing remains an
operator step.

## Reviewable Linux user-service installation

The supplied service expects the integrated checkout and installed Wrangler
at `$HOME/ezkart-operations` (adjust the service before installation if different),
Python 3.11+, Node on the user service PATH, and OpenSSL. Copy the reviewed
`runner.example.json` as `$HOME/.config/ezkart-backup/runner.json` with mode 0600
in a 0700 directory. Supply a separate 0600 `credentials.env` in that directory
with the four environment variable names above; do not put credentials in Git,
command arguments or the example JSON. The runner fails durably when API
credentials are missing; it never performs an interactive login.

After credentials, public certificate, private state and paths are ready, these
are the coordinator/operator installation commands, **not executed by this
implementation**:

```sh
install -d -m 700 "$HOME/.config/systemd/user"
install -m 600 tools/commerce/systemd/ezkart-backup.service "$HOME/.config/systemd/user/ezkart-backup.service"
install -m 600 tools/commerce/systemd/ezkart-backup.timer "$HOME/.config/systemd/user/ezkart-backup.timer"
systemd-analyze --user verify "$HOME/.config/systemd/user/ezkart-backup.service" "$HOME/.config/systemd/user/ezkart-backup.timer"
systemctl --user daemon-reload
systemctl --user enable --now ezkart-backup.timer
```

The persistent calendar timer coalesces missed five-minute polls, and systemd
does not start a second instance while its oneshot service is running. The
runner remains the authority for backup due time. `KillMode=control-group`
bounds child processes if the service exceeds its hard timeout; its attempt
record then remains available for the next report. This user service needs a
continuously running user manager (operator-managed lingering or a continuously
logged-in service account) and a host that stays online. Verify the installed
service PATH and first real receipt before treating it as operational. Do not
install a second host against the same buckets as a substitute for a distributed
lease; this implementation provides single-host locking only.

Run all focused offline cases:

```sh
python -B -W error::ResourceWarning -m unittest discover -s tools/commerce -p 'test_workbench_backup*.py' -v
systemd-analyze --user verify tools/commerce/systemd/ezkart-backup.service tools/commerce/systemd/ezkart-backup.timer
```
