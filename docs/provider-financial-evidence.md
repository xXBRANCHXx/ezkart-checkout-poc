# Durable provider financial evidence

Confirmed seller wallets can now collect DOKU balance and transaction-history
responses into private central storage. These are observations, not settlement
entries, order releases or available funds. They provide original evidence for
the next reconciliation stage.

## Scope and storage

Migration 0025 adds immutable observation receipts and their derived balance and
history rows. Each receipt belongs to an already confirmed seller wallet and its
pinned credential fingerprint. The service verifies the requested profile or
account against that mapping. Changed accounts, another store's accounts, a new
credential identity or the wrong environment are rejected.

Receipts retain exact request and response bodies, provider request ID,
request/observation/receipt times, hash and normalized facts. A provider request
ID is unique for that credential fingerprint and UTC request day. Replaying the
same evidence after a lost acknowledgement returns its existing receipt;
different evidence under that identity is rejected. Receipt and all derived rows
commit atomically. Updates, deletes and replacement inserts are blocked.

JSON number tokens keep their original spelling until validated. Money becomes
whole-rupiah decimal strings, including above JavaScript's safe integer range.
Balances retain negative values. Fractional/exponential money, duplicate keys,
invalid Unicode, excessive size/depth and out-of-range amounts are rejected.
Normalized values are derived on the Worker from original response bytes, never
accepted as a second caller-provided version of the response.

History rows retain their position within each observed page. Repeated rows are
preserved. A later VOID or changed status is another observation; it cannot erase
the earlier evidence. Missing merchant references remain missing. A shared DOKU
reference is not assumed to identify one unique row or one Ezkart order. Observation
rows must never be summed as if they were a deduplicated money ledger.

Migration 0052 adds immutable collection receipts and their original observation
links. A receipt binds one confirmed wallet and credential identity to a balance
before collection, sequential pages for both IDR accounts, and a balance after
collection. Source IDs are the only caller input. The Worker and database reject
missing/reordered pages, different windows or page sizes, cross-page overlap,
backwards transaction dates, mixed wallets and histories whose end was still in
the future when collection began. Identical rows within one page remain intact.

Every collection retains its exact source IDs, time window, per-account counts,
page exhaustion and whether its surrounding balances changed. A full final page
at the page budget is recorded as partial. Even exhausted pages with unchanged
balances do not establish an atomic snapshot: DOKU uses offset pagination, and
later status changes or corrections require new observations. There is no global
synchronization watermark and no change to available funds or money journals.

## Service contract

All routes require the existing server HMAC and central-storage configuration:

- `GET /internal/commerce/finance/provider-account?seller=…&environment=sandbox`
  returns the confirmed account mapping to the collector.
- `POST /internal/commerce/finance/provider-evidence` accepts the store,
  environment and signed adapter's evidence envelope. Only balance and history
  operations are allowed; no supplied amount, account mapping or settlement flag
  overrides the original response.
- `GET /internal/commerce/finance/provider-evidence?seller=…&environment=sandbox`
  reads normalized observations with stable `cap`/`before` paging, up to twenty
  receipts per page. It always reports `settlementVerified: false` and
  `availableToWithdraw: null`.
- `POST /internal/commerce/finance/provider-collections` seals an ordered list of
  4–82 `observationIds`, together with `seller` and `environment`. Completeness,
  amounts and wallet mappings cannot be supplied or overridden. Concurrent or
  lost-acknowledgement retries return the same original collection.
- `GET /internal/commerce/finance/provider-collections?seller=…&environment=sandbox`
  provides stable `cap`/`before` paging, at most twenty summaries per page. Add
  `/fcol_…` before the query to read one scoped collection and its source IDs.
  Both forms retain `atomicSnapshot: false`, `settlementVerified: false` and
  `availableToWithdraw: null`.

Balances require both confirmed IDR accounts and exclude point accounts. History
requests are bounded to twenty rows, pages 0–999 and windows up to 31 days.
Each row must lie within the requested window and pages must be newest first,
preserving microseconds. Unknown transaction-type names are retained; unknown
status or mutation values are rejected.

## Workbench collection

With an authorized TEST environment, central storage, a confirmed enrollment and
the matching registered SNAP credentials, run the private CLI:

```sh
php tools/commerce/collect-provider-evidence.php \
  --environment=sandbox --seller=SELLER_ID \
  --from=2026-09-25T00:00:00+07:00 --to=2026-09-26T00:00:00+07:00 \
  --max-pages=10
```

The CLI accepts TEST/sandbox or beta/production only. For the isolated live beta,
use `--environment=production` with its beta API and private credentials. Main's
production deployment is rejected, as are mixed deployment/provider/API settings.
It validates the completed time window before provider access and cannot run
over HTTP. It gets the account mapping from the
service rather than accepting a profile or account number from its caller. It
checks the credential fingerprint before the first DOKU request.

The collector records a balance, every observed history page for both IDR
accounts, then another balance. Every response must persist before another
provider read. One lost storage acknowledgement retries only that exact receipt.
A continued storage failure stops collection. A provider error, changed account,
cross-page overlap or inconsistent ordering stops the run while preserving
already-recorded responses. Same-page identical rows remain intact.

`--max-pages` is 1–40 per account. A page budget yields exit 2 and an incomplete
report; exhausted pages yield exit 0. A failed run yields exit 1. None proves an
atomic snapshot or settlement. The CLI prints counts and coverage, without bank
account numbers, raw provider responses or credentials. Completion/partial status
and the durable `collectionId` are reported by that invocation. The final receipt
and all source links commit atomically. A collection failure leaves the individual
observations available and cannot create a completed-window receipt. No scheduler
is activated.

After two failed finalization acknowledgements, stderr contains a recovery JSON
document with `pendingCollection` and the original response IDs. Keep this file
private (mode 0600), then retry only that document:

```sh
php tools/commerce/finalize-provider-collection.php \
  --receipt-file=/absolute/private/pending-collection.json
```

This command performs no DOKU request. It accepts only TEST/sandbox or
beta/production, rejects main and mixed origins, and preserves the receipt on
failure. Replaying it cannot duplicate a collection or replace original provider
observations. Exit 0 means exhausted pages; exit 2 still means partial coverage.

The standalone private-file [observation command](doku-financial-reader.md)
accepts explicit TEST/sandbox or beta/production and rejects main/mixed settings
before provider access. It records deployment/provider identity in its new private
files and never writes the database. The shared observer now accepts a
bounded page size; the central collector uses twenty rows to stay within the
signed service envelope.

## Reconciliation work still required

DOKU documents separate collection, settlement, fee and split events. A balance
does not prove an order is releasable. The next stage needs tested correlation of
those events and corrections, plus delivery, refunds, disputes, reserves and
payout accounting. Unknown groups stay unresolved. See
[Collect and Route](https://docs.doku.com/wallet-as-a-service/sub-account/collect-and-route)
and [Sub-Account V2 history](https://developers.doku.com/wallet-as-a-service/sub-account/sub-account-v2/integration-guide).

No real provider request, data collection, routing change or money movement was
performed during this delivery. Real sandbox/provider acceptance, operational
monitoring and the sustained validation period remain open. No top-level commerce
or production release gate is closed by this evidence layer.

## Verification

The collection implementation passes nine new Worker cases, including the
maximum 82-response/1,600-row partial collection, database guard enforcement,
concurrent finalization, source-link rollback and populated beta migration.
Six PHP/Worker collection integrations cover ordinary collection, partial reads,
provider changes, beta isolation, lost acknowledgements and private recovery
without another DOKU request. Fifteen existing evidence/journal cases and sixteen
reader/observer cases also pass. All provider responses in these tests are
isolated fixtures. Checkout, provider dispatch and email holds remain unchanged.

Logs are `/tmp/ezkart-provider-collections-worker-01a0d643.log`,
`/tmp/ezkart-provider-collections-capacity-01a0d643.log`,
`/tmp/ezkart-provider-collections-php-01a0d643.log`,
`/tmp/ezkart-provider-collections-recovery-01a0d643.log`,
`/tmp/ezkart-provider-collections-worker-regression-01a0d643.log` and
`/tmp/ezkart-provider-collections-reader-01a0d643.log`. The recovery-focused run
corrects the first integration run's test expectation: storage retries make
central service requests, while making no provider requests.

The fresh beta export contains 650,688 bytes, SHA-256
`96df786363ee17ea776381fee43aa7999818ebb6f0377bccff2e67710e1de7e7`.
Its local restore and migration 0052 rehearsal preserve every row of all 150
original exported tables. Integrity passes, foreign keys are clean and both new
tables are empty. Private export, restoration and comparison evidence are in
`/home/branch/.local/share/ezkart/beta-01a0d643/collections-before-0052-20260927/`.

### Hosted beta collection rollout — 27 September 2026

Implementation `e5a16c6` is pushed to workbench. Migration 0052 is installed only
on beta D1; Worker `33dce2ab-f9ac-444d-a26d-6203f58ece81` is deployed. All nine
hosted service checks pass at 12:10 UTC: health, empty collection paging, scoped
missing receipt, unsigned/wrong-environment/bad-query rejection, refusal to seal
without a confirmed wallet, unchanged empty journals and preservation of the
original uncertain enrollment. No collection or money entry was created.

The fresh post-export contains 660,934 bytes, SHA-256
`945fc2c7c6e5a898ce30a20cca411614b05b9f2c0689429340ca2c04c4c5c27f`.
All 152 exported tables restore cleanly. Every row in the 149 original application
tables is unchanged, migration 0052 is recorded and both new tables are empty.
The proof is `provider-collections-preservation-proof.json` in the private beta
directory; the export is in `collections-after-0052-20260927/`.

At 12:12 UTC, hosted workbench health confirms live beta, connected storage and
151 application tables. The served source matches implementation `e5a16c6`, PHP
dependencies load, recovery remains unavailable over HTTP, and checkout still
returns the explicit pause. Provider/email execution holds and the hourly storage
schedule are unchanged. TEST and main resources are untouched by this rollout.

### Earlier evidence-layer verification

On 27 September the beta extension passes all four focused PHP/Worker cases.
The added case verifies live-mode history reads, durable original receipts,
unchanged money journals and rejection of mismatched mode/deployment/API settings
before provider access. All provider responses in these cases are isolated
fixtures. The log is `/tmp/ezkart-beta-provider-evidence-01a0d643.log`.

Six Worker cases cover strict JSON and exact values, service/mapping boundaries,
concurrent replay, immutable rows, changed identities/statuses, duplicate records,
rollback, and stable private paging. Three PHP/Worker integrations cover durable
collection, lost acknowledgements, truncation, storage failures, account changes,
partial evidence and the CLI's environment/HTTP restrictions. Initial logs are
`/tmp/ezkart-provider-evidence-api-01a0d643.log` and
`/tmp/ezkart-provider-evidence-php-01a0d643.log`.

The complete Worker suite passes all 148 tests. All 31 affected PHP, signing,
reader and Wallet integration/browser checks pass. PHP syntax, the TEST dry build
and whitespace checks pass. Full logs are
`/tmp/ezkart-provider-evidence-api-final-01a0d643.log` and
`/tmp/ezkart-provider-evidence-php-final-01a0d643.log`; the final strict-date checks
also run in `/tmp/ezkart-provider-evidence-api-focused-01a0d643.log`.

The fresh TEST export at
`/tmp/ezkart-provider-evidence-deploy-01a0d643/test-before-0025.sql` is mode 0600,
423,017 bytes, SHA-256
`7504db02d6b1a9a1879f1ccafe9af19cda09583c0efbdaf927b8bbfbd0c8c9b6`.
It restores with migration 0025 applied in original file order: integrity `ok`,
no foreign-key errors, three empty evidence tables and ten guards, with every
pre-existing table count unchanged.

### Hosted TEST rollout — 26 September 2026

Implementation `ef9ee24` is pushed on workbench. Only 0025 was pending and applied
to TEST D1, followed by Worker `2eea36c1-0220-4049-827b-9e371fb1d751`. At 11:41 UTC
/ 18:41 Jakarta, health reports 70 tables and healthy D1/public R2/private R2.
The three evidence tables remain empty and all ten guards are present. Existing
wallet/operational/financial counts and the 15-entry legacy import manifest are
unchanged, with no foreign-key errors.

Both provider-evidence routes retain the central-storage hold (503). The hosted
collector returns an empty 404 over HTTP. The hourly maintenance schedule and
all activation flags are unchanged. Private rollout and comparison artifacts are
under `/tmp/ezkart-provider-evidence-deploy-01a0d643/`. These checks do not establish
populated hosted reconciliation or real provider acceptance.
