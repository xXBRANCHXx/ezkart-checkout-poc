# Scheduled workbench backup command

`tools/commerce/workbench-backup-bundle.py` adds encrypted D1 + R2 backups alongside
unchanged `workbench-backup.py create/verify`. Requires Linux, Python 3.11+,
OpenSSL with CMS AES-256-GCM, and the repository's installed Wrangler. It uses the
approved beta/test database UUIDs and bucket names. It cannot target main.

Supply `CLOUDFLARE_ACCOUNT_ID` and `CLOUDFLARE_API_TOKEN` in the operator/scheduler
environment, with D1 export and the necessary selected R2 bucket permissions.
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

This is the schedule-ready invocation; no timer or cron is installed or enabled.
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
after successful recovery. Monitor nonzero exits and retained incomplete runs;
there is no external alert integration.

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
