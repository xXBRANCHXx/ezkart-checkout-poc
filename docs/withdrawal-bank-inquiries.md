# Withdrawal bank verification

Migration 0056 connects an existing withdrawal reservation to one DOKU bank
inquiry, durable original evidence and a fresh owner confirmation. It does not
send a bank payment, complete a payout or enable the Wallet withdrawal button.
The [reservation](withdrawal-reservations.md) and [bank adapter](doku-payouts.md)
contracts remain prerequisites.

## Original inquiry and receipt

The signed service resolves the reserved withdrawal's confirmed seller cash
account and checks its credential fingerprint and client ID. In the insertion
transaction, it rechecks the original owner, current active ownership, fresh
Wallet proof, cancellation, accounting completeness and whether current eligible
earnings cover all outstanding reservations. The saved binding fixes the original
amount, destination, channel, merchant reference and separate inquiry/payment
dispatch IDs. No amount or account can be supplied by the browser at this stage.

Only the response to a newly committed grant permits one provider inquiry.
Every replay returns `mayInquire: false`, including when the original grant
acknowledgement was lost before transport. An inquiry failure is not permission
to reuse that grant. A bank inquiry does not move money; an unsubmitted withdrawal
can still be cancelled. A future payment grant must atomically prevent that
cancellation before any transfer transport is connected.

The original request and response bytes, environment, credential fingerprint,
dispatch ID and transport times form the receipt. Strict JSON parsing rejects
duplicate keys and preserves provider account-number tokens. The response must
match the exact original amount, bank, account (including leading zeroes), cash
source, channel and merchant reference. The bank-returned beneficiary and inquiry
reference are retained without substitution. A provider inquiry reference cannot
be reused for a different withdrawal under the same credentials.

The confirmation digest matches the PHP adapter and covers the original evidence
plus the separate payment dispatch ID, including Unicode response content. A
different original receipt cannot replace an accepted one. A late original
receipt can be retained after cancellation without undoing the cancellation.
The first bounded private failure diagnostic is immutable and never authorizes
a retry or certifies a financial outcome.

## Owner confirmation and protected proxy

Confirmation requires the original inquiry digest and current original owner,
with fresh Wallet proof and another atomic check of all reserved funds. Each
confirmation records its original expiry and funding snapshot. Replaying its
request key cannot extend the expiry; a fresh confirmation needs a new key.
The eventual payment grant must recheck current ownership, proof, cancellation
and funding again. Confirmation alone is not dispatch authority or bank delivery.

All private endpoints are POST, require the signed commerce service, reject
queries and unknown JSON fields, and are restricted to TEST/beta:

- `/{id}/inquiry/start` requires owner scope and configured provider identity.
- `/{id}/inquiry/receipt` saves original evidence.
- `/{id}/inquiry/read` exposes original evidence only to private recovery.
- `/{id}/inquiry/diagnostic` saves a bounded stage/reason/status.
- `/{id}/confirm` requires owner scope, request key and inquiry digest.

These paths are under `/internal/commerce/finance/withdrawals`. Private receipt
recovery works while inquiry dispatch is held; it does not manufacture current
owner authorization.

The merchant Wallet proxy now supports reservation, list, detail, cancellation,
inquiry and confirmation actions. It obtains seller/owner/environment/provider
identity only from the verified session and server configuration. Every action
requires current store ownership, matching account/store headers, CSRF and the
separate ten-minute Wallet verification. It checks the unchanged session again
before returning. Protected detail reveals the original full destination for
confirmation; list/reservation/cancellation responses mask the account. Provider
credentials, cash account IDs and raw receipts never reach these responses.
An authoritative saved receipt clears a lost-acknowledgement review response.

## Private recovery and execution holds

PHP saves a valid inquiry receipt to an exclusive mode-0600 file before posting
it to D1. The configured recovery directory must be writable, mode 0700, absolute
and outside the application/document root. Existing conflicting or partial files
are retained for review. Failure cannot trigger another provider inquiry.

To finish storing that same original receipt after a failed acknowledgement:

```sh
php tools/commerce/finalize-withdrawal-inquiry.php \
  --receipt-file=/absolute/private/wd_reference-bank-inquiry.json
```

The command reads the original private grant and verifies the saved binding
before posting the original evidence. It never authenticates to DOKU or calls
the provider. It rejects public-readable files and keeps the source receipt.
Both the helper and command are unavailable over direct HTTP.

The following switches remain absent/held on the deployed beta until the full
withdrawal workflow is ready:

- PHP `commerce_withdrawals=enabled` is required for new reservations, inquiries
  and confirmations. Protected reads/cancellation remain available while held.
- PHP `commerce_withdrawal_inquiry=enabled` and Worker
  `COMMERCE_WITHDRAWAL_INQUIRY=enabled` independently gate new inquiries.
- PHP `commerce_withdrawal_recovery_directory` must name the private directory.
  It is checked before consuming a grant.

Migration 0056 adds no provider-payment grant, caller or schedule. The later
[payment grant](withdrawal-payment-grants.md) fences cancellation and retains
original payment receipts, with payment execution still held. Ezkart-funded
actual transfer fees, final payout/refund journals, completed-outflow deductions,
payment outcome reconciliation and live acceptance remain required before
enabling withdrawals. The [merchant request/confirmation/history workflow](withdrawal-merchant-workflow.md)
is now implemented with original-request recovery and verification-expiry checks.

## Verification

Eleven focused Worker cases cover grant concurrency and replay, exact receipts,
duplicate/numeric JSON, mismatched destinations and amounts, time/reference
constraints, current refund holds, cancellation, owner-proof renewal, immutable
diagnostics, direct database guards, transaction rollback and a populated
0055-to-0056 beta upgrade preserving reservations and money journals.

Merchant integration uses real isolated PHP/Worker/Chrome fixtures and mocked
DOKU transport. It covers the protected proxy, literal Unicode digest agreement,
private receipt permissions, grant/receipt acknowledgement loss, original receipt
recovery while held, provider failure/mismatch and expired owner proof. These
checks are not live DOKU bank acceptance.

All 96 relevant cases pass: the eleven inquiry cases, 28 reservation/earnings
cases, 25 settlement/collection cases, and 32 PHP/adapter/merchant cases. Final
logs are `/tmp/ezkart-bank-inquiry-{finance,provider,php}-final-01a0d643.log`.
The eight initial inquiry cases are in
`/tmp/ezkart-bank-inquiry-first-01a0d643.log`; database/upgrade coverage and the
corrected rollback expectation are in the corresponding `database` and
`rollback-final` logs. PHP/JavaScript syntax, whitespace and the beta Worker
dry build pass.

The fresh pre-migration beta export is 712,841 bytes with SHA-256
`8c87414bb4ef2104d22d79f7b54fe2d5bb4a406d133025bac398c767e32e5bc0`.
Its Time Travel bookmark is unchanged across the snapshot, and local restoration
passes integrity and foreign-key checks. Rehearsing migration 0056
(`caf60e0562256e60422a3cdef09eb6e665cf36d8e2ac7ac650339a008232c502`)
preserves every row in all 158 original tables and adds only the four empty
inquiry/confirmation tables. Private evidence is under
`/home/branch/.local/share/ezkart/beta-01a0d643/inquiries-before-0056-20260927/`.

## Workbench rollout

Implementation `4810fec` is pushed to `agent/ezkart-workbench`; migration 0056
and Worker `34752837-315d-4c1a-8fd1-bc167728c8cd` are deployed only to beta.
Twenty-six hosted checks pass at 15:08 UTC on 27 September, including the held
inquiry gate, signed-service protection, environment/query/proof rejection,
missing-original recovery, unavailable payment routes, zero monetary records
and preservation of the original uncertain wallet.

At 15:09 UTC, Hostinger serves the matching tested documents and Wallet assets,
loads the PHP dependencies, rejects unsigned merchant actions and blocks direct
helper/CLI HTTP access. The actual Wallet verification gate renders no earnings
or wallet-setup content before fresh verification. Populated merchant actions
are covered by isolated fixtures; live bank acceptance remains open.

The post-export is 726,964 bytes with SHA-256
`fe02ad899afa2e5b82d70b8dc07a39e7643ea558f909d4a763f244f9c7dc3721`.
It restores 162 tables with clean integrity/foreign keys and an unchanged Time
Travel bookmark across the export. Of 157 original application tables, 156 are
exactly unchanged. The sole expected change is one user's `updated_at`, from
14:24:10.699 to 15:09:32.533 UTC, caused by the actual merchant-page visit.
Migration history advances from 55 to 56. All four new tables, withdrawals,
captures and money journals remain empty. The original uncertain wallet is
unchanged. Private proofs are `inquiries-{hosted,workbench,wallet-gate}-proof.json`,
`inquiries-post-preservation.json` and `inquiries-after-0056-20260927/` under
the beta evidence directory.

Checkout, merchant withdrawals, provider inquiry execution and automatic email
sending remain held. Only the existing hourly housekeeping schedule runs.
TEST/main deployment configuration hashes are unchanged; neither environment
was deployed or migrated. No live bank inquiry, transfer or refund was submitted.
