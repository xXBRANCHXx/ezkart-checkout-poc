# DOKU seller bank payouts

Workbench contract implementation, 27 September 2026. The bank-transfer adapter
exists; **seller withdrawals are not operational**. There is no public payout
route, caller, schedule or available-balance writer in this change. Checkout and
all existing money-execution holds remain in place.

## Provider contract

The [DOKU Sub-Account V2 guide](https://developers.doku.com/wallet-as-a-service/sub-account/sub-account-v2)
and [API contract](https://developers.doku.com/wallet-as-a-service/sub-account/sub-account-v2/integration-guide)
were checked on 27 September. A bank payout needs an inquiry followed by a
payment with the same merchant reference, the inquiry's provider reference and
its confirmed beneficiary name. The adapter accepts only IDR bank transfers
with an explicit BI_FAST or ONLINE channel. It cannot route to points, another
sub-account or an e-wallet. No channel fallback is attempted.

`cart/api/doku-payout.php` reuses the existing RSA token and HMAC request
transport. Environment, credential fingerprint, seller cash account, bank code,
bank account, whole-rupiah amount, merchant reference and two distinct dispatch
IDs form the server-owned binding. The two provider requests use fixed V2 paths.
No URL, currency, transfer type, callback or fee override is accepted.

The Rp250,000 seller minimum is enforced before any provider request. Amounts
are decimal strings, including above JavaScript's exact integer range, up to
SQLite's signed integer limit. This is a representation limit, not a claim
that DOKU permits a transfer that large. Bank limits and actual released funds
remain separate checks. The full requested amount is sent to the beneficiary;
no seller withdrawal fee is subtracted.

The inquiry's complete original request/response and transport metadata are
revalidated before payment. All returned transfer fields must match the request.
Bank account leading zeroes and the original beneficiary name are preserved.
A confirmation digest covers those original bytes and both dispatch identities;
changing an amount, destination, name, credential or dispatch ID invalidates it.
That digest is an integrity binding, **not owner authentication or proof of
funds**. Only a trusted durable receipt can supply the original evidence.

Payment retains separate inquiry, provider-transfer and bank references. The
response must match the original transfer and beneficiary. Its processing date
must be valid and consistent with the inquiry. A successful HTTP response is
returned as private evidence with `payoutConfirmed: false`; it does not clear a
reservation or post a completed payout. The actual provider fee remains null.
Unexpected, incomplete, mismatched or unsuccessful replies and timeouts do not
permit a retry. There are no automatic re-inquiries, retries or credential/channel
fallbacks. This adapter alone does not fence separate calls or process restarts.

## Required integration before real use

The central withdrawal workflow must:

1. Resolve the confirmed seller/provider mapping and its cash account. Determine
   available funds from settled and delivered earnings, actual fees, refunds,
   disputes, negative balances and existing reservations.
2. Require the current owner and fresh Wallet verification. Persist the original
   withdrawal intent and reserve its funds atomically; concurrent requests must
   not spend the same earnings.
3. Persist separate inquiry/payment dispatch grants and original private receipts.
   Each provider call needs a committed, single-use grant before transport.
4. Show the bank-confirmed beneficiary and original amount for owner confirmation.
   Bind that decision to the inquiry digest and recheck owner verification at
   dispatch. The client does not impose an invented DOKU inquiry expiry.
5. Reconcile authenticated provider status, notifications and account history.
   Missing acknowledgement, HTTP 409, timeout or malformed replies stay uncertain;
   none is evidence that no money moved. Preserve the original reference.
6. Record the actual transfer charge as an Ezkart expense, including its actual
   funding source. Prevent a provider debit from silently charging the seller.
   Confirm this behavior with DOKU; the inquiry/payment schema has no fee quote.
7. Post final balanced journals and release reservations only with the necessary
   confirmed outcome. Complete merchant history, operator recovery and live
   acceptance before enabling withdrawals.

These requirements depend on the remaining
[settlement and release ledger](financial-journal.md) and
[seller fee policy](seller-fees-and-payouts.md). The original uncertain live wallet
registration must not be resubmitted to exercise this adapter.

## Verification

Ten isolated PHP/HTTP cases pass: signed paths and durable request IDs; explicit
production/ONLINE configuration using mocked transport; minimum and exact-money
boundaries; beneficiary and account isolation; raw receipt/digest binding;
malformed and duplicate JSON; processing dates; lost/duplicate/failed responses;
and inaccessible test fixtures. Every provider response is a local fixture.
No bank inquiry or transfer was submitted to live DOKU by this work.

All 42 existing Sub-Account reader, BCA SNAP and central Wallet cases pass with
the shared transport addition. PHP syntax and whitespace checks pass. These
checks do not establish provider activation or completed bank delivery.
