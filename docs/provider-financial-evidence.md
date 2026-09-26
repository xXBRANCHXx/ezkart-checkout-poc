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

Balances require both confirmed IDR accounts and exclude point accounts. History
requests are bounded to twenty rows, pages 0–999 and windows up to 31 days.
Each row must lie within the requested window and pages must be newest first,
preserving microseconds. Unknown transaction-type names are retained; unknown
status or mutation values are rejected.

## Sandbox collection

With an authorized TEST environment, central storage, a confirmed enrollment and
the matching registered SNAP credentials, run the private CLI:

```sh
php tools/commerce/collect-provider-evidence.php \
  --environment=sandbox --seller=SELLER_ID \
  --from=2026-09-25T00:00:00+07:00 --to=2026-09-26T00:00:00+07:00 \
  --max-pages=10
```

The CLI accepts TEST/sandbox only, validates the completed time window before
provider access, and cannot run over HTTP. It gets the account mapping from the
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
is reported by that invocation; there is no global synchronization watermark or
durable completed-window certification yet. No scheduler is activated.

The standalone private-file [observation command](doku-financial-reader.md)
remains available with its existing defaults. The shared observer now accepts a
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
