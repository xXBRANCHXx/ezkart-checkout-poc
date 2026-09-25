# Legacy order migration

## Current boundary

Migration 0017 and `tools/commerce/legacy-import.mjs` implement a private TEST
rehearsal: immutable source files, ownership assessments, counts, amounts and
import receipts in D1. They do **not** activate those records as operational
orders or switch checkout, merchant reads, customer reads or provider callbacks.
The full migration remains open until that cutover is implemented and verified.

No import creates customers, stock reservations, payment captures, provider jobs,
shipments or wallet credits. A historical `PAID` status and a stored
`payment_notification_verified` flag remain historical assertions requiring
financial reconciliation. The original files remain in place.

The legacy PHP writer gate and CLI freeze/resume rehearsal are implemented. The
hosted TEST source has **not** been frozen. Its current import receipt remains an
unfenced rehearsal; neither an old receipt nor a storage configuration flag is
an operational cutover authorization.

## Consistent source capture

`cart/api/legacy-order-storage.php` holds a shared filesystem lease for each
complete legacy write operation. Checkout and tracking retain it across provider
calls even when they release an individual order lock. Signed payment/courier
callbacks, merchant acceptance/pickup, customer ownership claims and every order
save also use the gate. A drain first stops new operations, then waits for all
admitted leases before taking an exclusive lock and reading the source set.
Nested writes from an admitted operation can finish. Kernel locks release after
a process exits; an interrupted provider request can still have an uncertain
outcome and requires reconciliation before promotion.

New checkout/writes and authenticated callbacks return HTTP 503 with
`Retry-After: 30` while paused. Checkout explains the pause and preserves the
cart. Read-only legacy payment status remains available. Private controls and
exports live outside the web root, and the PHP controller refuses HTTP requests
and any environment other than TEST sandbox. Missing gate state means the
existing legacy mode; damaged state fails closed. Read-only routing checks do
not create a legacy storage directory for central commerce.

The controller runs **on the source host**, using the same private configuration
and order directory as PHP. It requires an explicit private `order_storage` or
`midtrans_order_storage` setting and an existing directory outside the application
root. Confirm these match the storefront: CLI execution has no web
`DOCUMENT_ROOT`, so unconfigured CLI defaults cannot be trusted. All source writers must first
be deployed with the gate and older PHP requests must finish. Two matching
directory scans detect changes during capture; they cannot fence old code that
does not participate in the lease protocol. There is no public operator endpoint.

```sh
php tools/commerce/legacy-fence.php status
php tools/commerce/legacy-fence.php freeze --key=<new-32-hex-key> --revision=<current-revision> --wait-ms=10000
```

The state transitions from `legacy` to `draining` to `frozen`, incrementing the
revision at each transition. A timeout or failed export deliberately leaves it
`draining`. Retry the **same key and original revision**, optionally with a
longer wait (maximum 30 seconds). Concurrent controller commands fail promptly.
Completed replays return the original receipt and the **current** state; they
never reapply an old freeze or resume. Always check current mode, epoch and
revision before acting on an old receipt.

The completed receipt identifies `.commerce-freezes/<epoch>/source.json` and its
SHA-256 digest. Directories are mode 700 and exports mode 600. Every JSON entry
must be an explicitly sandbox order whose filename hashes its order reference;
unrecognized files, symlinks and malformed sources stop the export. Limits of
1,000 files, 1 MB per source and 16 MiB in total fail explicitly without omitting
orders. The source JSON bytes are preserved. The envelope additionally contains:

```json
"fence": {"version": 1, "epoch": "<32-hex-key>", "revision": 2, "sourceDigest": "<sha256>"}
```

The source digest hashes `ezkart-legacy-files-v1\nsandbox\n`, followed by sorted
`filename:sha256(original-bytes)\n` lines. The auditor checks this complete set,
and the manifest/import receipt retains its fence. An incomplete subset cannot
claim the same fence. Existing exports are never overwritten with changed data;
a crash between export and receipt commits recovers the same export. Replaying
a receipt also checks that the original export remains unchanged and private.

To reopen legacy writes after a **rehearsal**, read status and explicitly name
the current epoch and revision:

```sh
php tools/commerce/legacy-fence.php resume --key=<new-32-hex-key> --revision=<current-revision> --epoch=<active-freeze-key>
```

Cancelled pending freezes cannot reuse their keys. Historical frozen exports
remain immutable evidence after reopening; they are no longer the live source
set. Resume is refused when central commerce is configured. A configuration
change cannot bypass a draining/frozen gate. No central activation command or
cross-system commit protocol exists yet: implement a durable promotion intent
that disables resume, final-set/ownership reconciliation, central read routing
and provider-event recovery before an actual handover. Do not manually remove
the gate file, enable central flags or treat a successful rehearsal as promotion.

Gate deployment acceptance: Hostinger reports implementation `5ff91a72` on
`agent/ezkart-workbench` Completed / Current at 25 September 16:05 (displayed
time, 37-second deployment). Authenticated dashboard/orders still show 15 legacy
orders. Checkout remains sandbox with `durable_checkout:false`, and both
controller scripts return HTTP 404. The eight local fence tests and ten import
tests pass. Hosted freeze/resume has deliberately not been executed while the
operational handover is unfinished.

## Evidence and ownership

The auditor retains each source JSON string unchanged, its SHA-256 digest and
its original filename. It rejects duplicate JSON keys, mismatched file/order
references, mixed environments, duplicate order/provider references, fractional
quantities or amounts, inconsistent item/subtotal/shipping totals and invalid
creation/update dates. Unknown original fields remain in the preserved source.
Provider expiry strings without a timezone are retained and flagged; the import
does not choose a timezone or expire the order.

Ownership has four explicit outcomes:

- A stored seller ID remains attached to that seller, if it exists in D1.
- A missing seller can be assessed from an original order in the **same source
  set** carrying an explicit seller and matching shop scope, that seller's
  current owner scope, and unambiguous item identities/SKUs. A current SKU match
  alone is insufficient. The assessment records the anchor source hash and
  membership evidence. Conflicting seller anchors remain unresolved.
- Recognized sandbox demo products under `ezkart-demo` remain separate from
  seller commerce, including their recorded paid amounts.
- Unresolved identities are preserved and reported; they are never assigned to
  the operator merely because the operator can view legacy files.

Stored product IDs never silently fall back to a reused SKU. Missing/ambiguous
catalog links do not rewrite historical names, prices, quantities, customer
details or payment references. No customer account is assigned from an email
address during this import.

One SQL INSERT applies an entire reviewed batch. Database triggers check current
ownership, competing SKUs, amounts and source/assessment receipts inside that
transaction. Failure rolls back the batch. Repeating an acknowledged batch is
safe even after later catalog changes. A later source revision gets its own
immutable snapshot; unchanged sources are shared between receipts. Conflicting
provider references across batches are rejected.

The three tables are `commerce_legacy_import_batches`,
`commerce_legacy_sources` and `commerce_legacy_import_entries`. They have no
public, merchant or customer API route. The operator CLI uses the existing
Cloudflare authorization and hardcodes this repository's TEST binding. It
cannot target production or enable central commerce.

## Operator procedure

Keep exports, registries, manifests, SQL, backups and logs outside the repository
and public web root. Use an owned mode-700 directory and mode-600 files. Do not
paste source/customer data, provider instructions or signed backup URLs into
issue descriptions or application logs.

Read the private sandbox order directory through authorized server access. A
source export has this envelope; `source` is the exact UTF-8 file content,
including whitespace, rather than a reserialized order:

```json
{
  "format": "ezkart-private-legacy-source-v1",
  "deployment": "test",
  "environment": "sandbox",
  "sourceDirectory": "ezkart-midtrans-orders-sandbox",
  "entries": [{"filename": "<sha256-of-order-id>.json", "source": "<original JSON text>"}]
}
```

The CLI runs from the repository root:

```sh
node tools/commerce/legacy-import.mjs registry --output /private/audit/registry.json
node tools/commerce/legacy-import.mjs plan --source /private/audit/source.json --registry /private/audit/registry.json --output /private/audit/plan
```

Review the report's counts, totals, original/assessed ownership, reference counts
and issues. The plan directory contains `manifest.json`, `report.json` and the
exact reviewable `import.sql`; existing artifacts are never overwritten. Take a
private TEST D1 backup and apply migration 0017 before staging.

```sh
node tools/commerce/legacy-import.mjs stage --plan /private/audit/plan/manifest.json --expect <reviewed-sha256>
node tools/commerce/legacy-import.mjs verify --plan /private/audit/plan/manifest.json --expect <reviewed-sha256>
```

Staging refreshes the ownership registry and rejects a changed assessment before
writing. It then verifies every stored source byte/hash and assessment, and
compares operational counts and inventory before/after. An unreadable result
requires verification of the **same** digest; do not generate a replacement key
to recover an uncertain write. A receipt is checked before a replay needs any
current catalog evidence.

The audit accepts up to 250 records and a 400 KB manifest; SQL generation also
checks the escaped statement against D1's 100 KB statement limit. Larger
unfenced rehearsals may use reviewed batches, retaining required original
ownership anchors. A fenced source must remain complete; bounded multi-batch
promotion is not implemented and cannot be worked around by trimming its export.
For reconciliation of existing rehearsals, count distinct order references
across batches, not the sum of batch sizes. The limit follows
[Cloudflare's D1 limits](https://developers.cloudflare.com/d1/platform/limits/).

## TEST source audit, 25 September 2026

The authenticated file-manager read found 15 JSON order files in the private
sandbox directory. All filenames match their order-reference hashes. The
current merchant storefront independently confirms the owner scope used by the
four inferred seller assessments.

| Measure | Source audit |
| --- | ---: |
| Orders | 15 |
| Recorded order total | Rp746,000 |
| Recorded paid orders / amount | 2 / Rp116,000 |
| Explicit seller / inferred seller / demo | 4 / 4 / 7 |
| Unresolved seller assessments | 0 |
| Orders with a recorded customer account ID | 3 |
| Provider request IDs / paid references | 15 / 2 |
| Payment expiries without timezone / payment flow not recorded | 8 / 8 |

Both recorded paid orders contain demo products and skipped sandbox delivery.
The eight assessed seller orders are pending. Twelve records lack a stored
customer account ID; their original customer snapshots remain unchanged.

Reviewed manifest digest:
`ba180208c85cea72b82323b7b917e0e3771b143d930f5220665fddffc62777c0`.
Private artifacts live under `/tmp/ezkart-legacy-audit-01a0d643/`; these temporary
copies are not a long-term backup.

Hosted rehearsal acceptance:

- Pushed implementation `e6c9f68` to `agent/ezkart-workbench`. Hostinger reports
  `e6c9f688` Completed / Current on `test.ezkart.id` (25 September, 15:31 as
  displayed by hPanel). Application checkout behavior remains gated as below.
- Exported a mode-600 TEST D1 backup (259,637 bytes) before applying migration
  0017. The existing Worker remains deployed; this change adds operator tooling
  and schema, with no new application API route or provider activation.
- A second private source read at `2026-09-25T08:22:21Z` matched all 15 filenames,
  byte lengths and content hashes. No source order was changed or deleted.
- Applied 0017 to TEST and staged the reviewed manifest. Wrangler's file-import
  output included text around its JSON response; verification of the same
  digest confirmed the transaction had committed. The CLI now checks the exact
  receipt independently of file-import output and reconciles an uncertain write
  before reporting failure, without resubmitting it.
- Every stored source string, SHA-256, filename and ownership assessment matches
  the manifest. Replaying the CLI returns the original receipt. Independent D1
  aggregates show one batch, 15 source snapshots and 15 entries: eight seller,
  seven demo, Rp746,000 total and Rp116,000 recorded paid.
- Orders, customers, captures, reservations, shipments and provider jobs remain
  zero. The full registry's product/variant stock and revision digest before and
  after is `88e074d1dacd0c3a9ff8dd9b861dafdcb5c184c1f700ebab967924b92d7fdf84`.
  This hash covers all registry sellers and differs from the earlier
  merchant-only product response hash.
- Hosted health reports 47 application tables and healthy D1/public R2/private
  R2. Checkout reports `durable_checkout:false`; central writes still return
  503. No production schema, files, provider setting or main branch changed.
- Verification: the complete 75-test Worker suite passed, followed by all ten
  final migration/CLI cases and two final CLI privacy/recovery checks. Coverage
  includes concurrent replay, all-or-nothing rollback, owner changes, cross-store
  SKU ambiguity, original-byte preservation, source revisions, duplicate provider
  references across batches, lost responses, absent receipts and altered readback.
  JavaScript syntax and whitespace checks also pass.

## Still required for cutover

1. After all writers participate in the implemented gate, rehearse it on the
   source host and obtain a final frozen source set for cutover. The existing
   file-manager read is an unfenced snapshot; callbacks and checkouts can still
   change the live files.
2. Reconcile that final set against its staged receipts, including any changed
   records, new records, unresolved ownership or nonstandard provider metadata.
3. Implement operational promotion and D1-only legacy reference projections;
   verify original payment links/instructions, authenticated customer ownership,
   merchant dashboards/lists, provider callback routing and late-payment holds.
   Replayed legacy payments must never deduct stock or credit a wallet twice.
4. Verify the complete PHP/Worker read and write cutover with monitored provider
   dispatch and recovery, with no silent fallback to local files.

These are part of the still-open
[commerce completion plan](commerce-completion-plan.md), alongside refunds,
wallet settlement, messaging, notifications and the other workbench requirements.
