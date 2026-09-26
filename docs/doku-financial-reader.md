# DOKU financial evidence reader

The capture journal records verified customer payments. Settlement reconciliation
also needs independently observed provider accounts, fees, splits and statuses.
`cart/api/doku-sub-accounts.php` implements the read side of Sub-Account V2;
`doku-financial-observation.php` collects bounded, private evidence across both
IDR accounts. Neither module changes a provider account or financial ledger.

## Provider contract

Checked against DOKU's official documentation on 26 September 2026:

- [Sub-Account V2 integration](https://developers.doku.com/wallet-as-a-service/sub-account/sub-account-v2/integration-guide):
  balance inquiry, zero-based history pages, transaction status and refund history.
- [B2B tokens](https://developers.doku.com/accept-payments/direct-api/snap/integration-guide/get-token-api/b2b):
  RSA SHA-256 authentication with the merchant's registered signing key.
- [SNAP symmetric signatures](https://developers.doku.com/get-started-with-doku-api/signature-component/snap/symmetric-signature):
  HMAC SHA-512 covering the exact target, token, body hash and timestamp.
- [Account and history semantics](https://developers.doku.com/wallet-as-a-service/sub-account/sub-account-v2):
  pending cash is separate from cash available at the provider; each account also
  has its own reserved balance. History retains VOID rows, and a mutation's
  direction is relative to the queried account.

## Implemented behavior

Only balance, history and status paths are callable. Origins are pinned to the
selected environment; URLs cannot be supplied by an HTTP caller. TLS verification,
redirect refusal, timeouts and a 2 MB response cap apply to the default transport.
Tokens stay in the reader object, expire conservatively and are removed after an
HTTP authentication rejection. There is no implicit retry. Every history/status
request uses a new numeric request ID.

Financial JSON rejects duplicate keys, malformed strings and excessive nesting.
Numbers retain their exact original decimal spelling until validated; money is
returned as whole-rupiah strings, including above JavaScript's safe integer range.
Fractional rupiah, exponential money notation and values outside signed 64-bit
storage are rejected. Balances preserve negative values rather than hiding them.
Non-cash point accounts cannot become IDR amounts.

A balance response must identify the requested profile and exactly one cash and
one pending IDR account. History retains all four statuses, both mutation directions,
unknown transaction types and same-page duplicate rows as evidence. It requires
valid timestamps, newest-first order and the requested date window. Transaction
status requires an exact partner reference, known status code, IDR amount and
unambiguous refund entries. Refund records are observations, not executed refunds.

The observer queries account numbers obtained from the verified profile response,
records each response before continuing, and checks those identities again at the
end. Overlapping or reordered pages stop the observation; a failed evidence write
stops further provider requests. A page budget exposes incomplete coverage. Even
exhausted pages are not an atomic provider snapshot: late changes and backfills
still require overlapping synchronization and transaction-level reconciliation.

## Private sandbox observation

The server-only configuration uses the existing `doku_sandbox_client_id` and
`doku_sandbox_secret_key`, plus `doku_sandbox_snap_private_key` containing the PEM
private key whose public key is registered with DOKU. These stay outside version
control. Existing payment credentials alone do not establish SNAP readiness.

Create a private directory outside the repository, with mode 0700, then run:

```sh
php tools/commerce/observe-doku.php \
  --environment=sandbox \
  --profile=SAC-5716-1789721857135 \
  --from=2026-09-25T00:00:00+07:00 \
  --to=2026-09-26T00:00:00+07:00 \
  --max-pages=10 \
  --output=/absolute/private/directory/doku-observation.jsonl
```

The example profile is the existing isolated sandbox account recorded in
[commerce-sandbox-setup.md](commerce-sandbox-setup.md). This command was not run
against DOKU during this delivery. It accepts sandbox only, windows up to 31 days,
and 1–40 pages per account, 100 rows per page. It is unavailable over HTTP.

Output is created exclusively with mode 0600. Existing files, symlinks, common web
directories and repository paths are refused. JSONL records contain the query,
exact original response, normalized values, request ID, time and credential
fingerprint. No token, secret or private key is included. Each record is flushed
and synchronized to disk. A failed observation retains prior evidence and a failure
record; a crash without a final record must be treated as unfinished.

Exit 0 means both accounts returned short final pages. Exit 2 means a page budget
was reached. Exit 1 means validation, provider, storage or consistency failure.
Every completed report explicitly states `atomicSnapshot:false` and
`settlementVerified:false`. Provider balances are never seller withdrawable funds.

## Verification and remaining integration

Thirteen reader/observer/CLI tests plus both existing commerce signing tests pass.
They independently verify RSA/HMAC signatures, token expiry, exact large numeric
JSON, account/reference scope, statuses, paging, evidence retention, storage failure,
private output, forbidden arguments and the HTTP denial. All five PHP sources pass syntax checks.
Log: `/tmp/ezkart-doku-reader-delivery-01a0d643.log`.

Local configuration inspection found existing sandbox client/secret slots but no
SNAP private key. Hosted key registration/configuration and actual provider reads
remain unverified. Shared Chrome still reports disconnected, with the same five
prior connection attempts; this delivery did not reconnect it or alter credentials.

Still required: seller-owned provider enrollment/mapping, payment routing and split
verification, durable synchronization, capture-to-provider correlation, settlement
and actual-fee postings/corrections, delivery release, holds, refunds, payouts and
merchant wallet workflows. This reader closes none of those acceptance gates.
