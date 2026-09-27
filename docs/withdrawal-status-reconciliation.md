# Withdrawal status observations

Migration 0058 connects DOKU's read-only transaction-status API to an existing
withdrawal payment grant. The current owner can check the original transfer from
protected Wallet. The provider reference, credential identity and amount come
from the original payment; browser callers supply only the withdrawal ID.

Each response is saved privately before service delivery, then retained as an
immutable observation with its exact request/response bytes and observation
times. The service independently checks scope, amount, currency, request identity,
dates and unambiguous JSON. A daily request identity cannot acquire different
evidence. Late evidence remains recoverable after owner verification expires.

The Wallet projection uses provider observation times, not arrival order. Reads
that overlap and disagree need review until a definitely later consistent read
supersedes them. Conflicting terminal results, terminal-to-pending regressions,
foreign transaction types and reversal/refund context remain under review.
Original evidence is never replaced. History has a fixed sequence boundary and
bounded pages; raw provider evidence is restricted to the signed service.

Wallet distinguishes DOKU-reported pending, success and failure from completed
reconciliation. All outcomes preserve the reservation, cancellation fence and
single-use payment grant. No status response authorizes a transfer, releases
funds or posts a final payout journal. A second owner can inspect the original
payment without changing its beneficiary or acquiring send authority.

`commerce_withdrawal_status=enabled` permits explicit protected status reads
independently of new-withdrawal and payment-dispatch holds. It remains absent/held
on beta. The existing ten-minute Wallet verification and post-request session
checks apply; expiry clears bank details while preserving the saved observation.
There is no scheduled poller or provider-payment caller in this change.

Signed service routes under `/internal/commerce/finance/withdrawals/{id}/payment`:

- `/status/receipt`: validate and retain the original observation.
- `/status/history`: inspect original evidence with `before`, `cap` and `limit`.

Both require an existing payment grant and reject main. Recovery works while
status reads and payment dispatch are held, without a DOKU read or payment:

```sh
php tools/commerce/finalize-withdrawal-status.php \
  --receipt-file=/absolute/private/withdrawal-status.json
```

The helper and CLI are unavailable over HTTP. Files are created exclusively with
mode 0600 in the configured private recovery directory, flushed before D1
delivery, and never overwritten. Retain files after uncertain acknowledgements;
the command submits the same observation and returns the same digest.

## Provider contract and remaining reconciliation

The [DOKU Sub-Account integration guide](https://developers.doku.com/wallet-as-a-service/sub-account/sub-account-v2/integration-guide)
documents the original-reference status lookup and separate `PAYOUT` and
`PAYOUT_CHARGE` history entries. Status alone does not establish the fee payer,
actual fee funding or matched account cash movements. Complete history/fee
reconciliation, final payout journals and outflow deductions, the integrated
payment caller, provider activation and live acceptance remain required. The
broader completion gates remain open.

## Verification

The focused cases exercise out-of-order and overlapping observations, terminal
conflicts/regressions, original scope and bytes, immutable SQL guards, rollback,
stable evidence paging and a populated beta upgrade. PHP/browser coverage checks
signed read-only transport, original receipt recovery after failed/lost
acknowledgements, independent holds, changed credentials, ownership/CSRF and
expiry after persistence. Desktop and 390px Wallet layouts are inspected.

All 82 relevant cases pass: 46 Worker cases and 36 PHP/merchant/browser cases.
The final suites include the corrected expiry-page selector; all expiry and
recovery checks pass. PHP/JavaScript syntax, whitespace and the beta Worker dry
build pass. Logs are `/tmp/ezkart-withdrawal-status-{worker-final,php-final}-01a0d643.log`
and `/tmp/ezkart-withdrawal-status-regression-first-01a0d643.log`.

The fresh pre-migration export restores 165 tables with unchanged recovery
bookmarks. Its SHA-256 is
`a312fe2f91362a9819f6f8866f2e5105bf0e8feaa8bf3c47439e378e5b4c8ce0`.
Migration rehearsal preserves every original row and adds one empty table;
integrity and foreign-key checks pass. Private evidence is under
`/home/branch/.local/share/ezkart/beta-01a0d643/status-before-0058-20260928/`.
Hosted rollout evidence follows after deployment.
