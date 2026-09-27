# Workbench data recovery

The beta database is `ezkart_beta_database`
(`27bb47cf-c0f0-463c-94e3-44b9b27edcf4`). TEST uses
`ezkart_test_database` (`2595f8c1-3e25-422f-9197-91d50a90e131`).
Main is not a recovery target for this work. Keeping these identities explicit
prevents a workbench command from following an accidentally changed `DB` binding.

## Export and local restoration

Run from the repository with Python 3.11+, Node, the installed pinned Wrangler
and the existing Cloudflare login. Choose a new directory under a private parent
outside the repository and all web roots:

```sh
python -B tools/commerce/workbench-backup.py create \
  --deployment=beta \
  --output=/absolute/private/parent/beta-20260927
python -B tools/commerce/workbench-backup.py verify \
  --directory=/absolute/private/parent/beta-20260927
```

The first command checks the remote database's UUID and name, records recovery
bookmarks around one complete SQL export and imports that export into a new local
SQLite database. A successful receipt requires clean integrity and foreign-key
checks. It records schema and per-table typed-row hashes, row counts, file sizes
and SHA-256 digests. Duplicate rows, original job attempts and unknown outcomes
remain intact. A changed bookmark is reported; it is not claimed to identify the
export's exact snapshot. The second command verifies the saved files and repeats
the local restoration without any network access.

The directory is exclusive and mode 0700; files are mode 0600. Existing output,
symlinks, main/unknown targets and conflicting flags are rejected. The restored
SQL cannot attach another database, load extensions or enable writable schema.
Failed runs leave `incomplete.json` with their stage and no success receipt.
Retain the incomplete evidence; use a fresh directory for another attempt.
Operator commands and their source return 404 over the hosted commerce-tools path.

Cloudflare documents that an export briefly blocks other database requests and
can lose precision for large numeric values. This tool rejects a success receipt
if the restored export contains numeric values beyond JavaScript's exact integer
range. Exact monetary strings and original JSON stored as text remain text.
Choose a quiet maintenance window for larger databases; the local rehearsal has
a 512 MiB SQL-file limit. See Cloudflare's
[export limitations](https://developers.cloudflare.com/d1/best-practices/import-export-data/).

## Recovery boundaries

This is a D1 export and local restoration check. It does not restore or back up
R2 object bytes, Supabase Auth, Hostinger sessions/private configuration, secrets,
DNS or a provider's records. The current beta catalog's original object copies
and hashes are preserved with its separate import evidence. Off-device retention,
encrypted credential custody and a full R2/application recovery rehearsal still
need operational acceptance. Do not put any of these private artifacts in Git.

D1's native Time Travel history is separate: Cloudflare documents seven days on
Workers Free and thirty days on Workers Paid. Bookmarks in a local receipt do
not extend that window. Native restoration overwrites the remote database, so
the tool deliberately offers no remote restore command. See
[Time Travel](https://developers.cloudflare.com/d1/reference/time-travel/).

Before an actual incident restore, identify the affected beta revision and
recovery point, preserve the current database/configuration and private incident
evidence, and prepare the concrete target and data-loss assessment for owner
approval. Pause new checkout and any provider/email dispatchers before changing
data. The current new-checkout hold alone does not disable existing-order jobs.

After restoring into an isolated recovery target, verify schema, data, retained
files and account ownership before switching any binding. Restoring D1 does not
undo a payment, wallet registration, shipment, refund, payout or sent email.
Reconcile every externally submitted operation since the recovery point using
its original request identity and provider evidence. A database row restored to
`queued` is not permission to send that operation again. Preserve uncertain
attempts and keep dispatch held until those differences are resolved.

## Verification

Nine isolated tests cover original uncertain attempts, binary/Unicode content,
immutable guards, duplicate flags, wrong database identity, malformed SQL,
foreign-key failures, changed bytes, private paths, dangerous SQL and a lost
export acknowledgement. Run them with:

```sh
python -B -W error::ResourceWarning -m unittest discover \
  -s tools/commerce -p test_workbench_backup.py -v
```

The beta export on 27 September is 630,381 bytes, SHA-256
`2bccefbf3dcb4d474b95e01cda15f1b142b16f0826d3b3041170505ef636dab7`.
All 147 exported tables (146 application tables plus migration history) restore
with clean integrity and foreign keys. The surrounding recovery bookmarks match.
The private receipt and local restoration are under
`/home/branch/.local/share/ezkart/beta-01a0d643/recovery-20260927-0953/`.
Offline re-verification passes. The restored wallet reference, original binding,
uncertain result and single attempt match the earlier private provider/job
observation exactly. Pickup/return settings and the store profile match their
saved merchant-UI evidence, including revisions. Two products, 111 variants and
54 media records remain present; orders, captures and journals remain empty.
No remote restoration, provider call or application data mutation was performed.
