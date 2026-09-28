# Withdrawal payment grants and original receipts

Migration 0057 adds the durable boundary between a cancellable withdrawal and
possible bank payment. A committed grant permanently fences cancellation and
another send authority. Original payment replies are retained independently of
the bank inquiry, with private recovery after failed or lost acknowledgements.
No final payout is inferred from an HTTP success response.

The merchant payment action and integrated provider caller are implemented.
`COMMERCE_WITHDRAWAL_PAYMENT` remains absent/held on beta, as does the matching
PHP `commerce_withdrawal_payment` switch.
Do not enable it until actual Ezkart-funded fees, authenticated outcome
reconciliation, final accounting and the complete transport workflow are ready.
The grant is infrastructure for that workflow, not evidence of operational
seller withdrawals. Main rejects these operations even if its flag is enabled.

## Execution boundary

Only the response to a newly committed grant returns `mayPay: true`. Every
replay returns false, including when the original acknowledgement was lost
before the caller could send anything. There is one immutable grant per original
withdrawal; its inquiry/payment external IDs, credential identity, confirmed
beneficiary, amount, channel and bank account cannot change.

The insertion transaction checks the current original owner and fresh Wallet
proof, the latest unexpired bank confirmation, its original inquiry digest,
the confirmed provider wallet and current funding for all outstanding requests.
An earlier confirmation cannot be revived with a newer caller proof. Refunds,
changed settlement or incomplete journals prevent a new grant. Cancellation and
grant creation are fenced in the same database transaction; concurrent attempts
cannot both succeed. New bank confirmations are also blocked after the grant.

The reservation remains posted. Missing replies, timeouts, HTTP 409, diagnostics
and even an accepted payment response do not clear it or authorize another send.
If no transport actually occurred after an uncertain grant acknowledgement,
resolution still needs authoritative outcome evidence; the system does not
guess that the absence of a receipt means no money moved.

## Original response and private recovery

### Original platform account

Migration 0059 freezes the configured platform wallet's enrollment identity in
every new payment grant. Its active store, distinct confirmed cash account,
provider parent, client and credential fingerprint are checked inside the grant
transaction. Browser/service payloads cannot choose the platform account.
Private grant/recovery responses identify the original account and the fixed
Ezkart-paid fee policy, with `providerFundingVerified: false`. Configuration
changes cannot replace that account or renew send authority. Merchant details
do not expose the platform account.

Earlier grants receive a null account reference. They are never backfilled from
current configuration and remain non-retryable. Their original receipt/status
recovery continues working. This preserves uncertain historical transport while
requiring review of missing fee-account provenance.

This binding does not quote a fee, reserve platform money, establish DOKU's
billing account or prove fee funding. Those facts and matched payout accounting
are still required before payment execution can be enabled.

All 29 affected cases pass: 24 Worker cases and five PHP/merchant/browser cases.
Coverage includes configuration changes, injected/same-seller/inactive provider
accounts, direct SQL guards and a populated 0058 upgrade, plus original payment
and status recovery. JavaScript syntax, whitespace and the beta dry build pass.
The fresh beta export restores 166 tables; migration rehearsal preserves all
original columns and rows while adding the nullable identity and its new-source
guard. Private evidence is under `platform-before-0059-20260928/` in the beta
evidence directory. Implementation `0bb4a9d`, migration 0059 and beta Worker
`58cc2856-fe8a-4c3e-b73b-a18e0b589ea3` are deployed. All 42 hosted checks pass
at 17:27 UTC on 27 September; matching workbench source/access checks pass at
17:28. No UI or merchant authentication behavior changes in this migration.

The post-export restores 166 tables, SHA-256
`6dc494857705e79408884ac61330604b658dcd3cc187b81cc64848e1103e2d9e`.
Every original application column and row across 165 tables is unchanged. Only
the intended nullable column, its insertion guard and migration-history entry
are added. There are no payment grants, and original wallet records, deployment
configuration and private runtime are unchanged. Proofs are
`withdrawal-platform-{hosted,workbench}-proof.json`,
`withdrawal-platform-post-preservation.json` and `platform-after-0059-20260928/`
under the private beta directory. Payment, checkout and automatic sending holds
remain. TEST/main are untouched.

### Original payment evidence

The service validates the original eight-field transport envelope, exact request
bytes, original dispatch ID, credential/environment scope, destination, amount,
currency, source account, bank-returned name and timestamps. It independently
revalidates the saved inquiry. Provider payment and bank references remain
separate from the inquiry reference. Duplicate JSON keys, floating-point account
tokens, invalid dates and contradictory original bytes are rejected.

A receipt digest binds the response to its exact original owner confirmation and
inquiry. PHP's escaped Unicode line separators are preserved in the canonical
payment request. Replays recover only identical evidence. Receipts, grants and
the first bounded diagnostic are immutable; a late receipt may still be recorded
after authority or funding has changed without claiming a new authorization.

Signed private operations under `/internal/commerce/finance/withdrawals/{id}`:

- `/payment/start`: fresh owner scope, original confirmation and server provider
  identity; independently held.
- `/payment/receipt`: original transport evidence; never creates a missing grant.
- `/payment/read`: original binding, inquiry, confirmation, payment receipt and
  diagnostic, with `mayPay: false`.
- `/payment/diagnostic`: bounded first-stage/reason/status; no retry authority.

`cart/api/commerce-withdrawal-payments.php` provides exclusive mode-0600 receipt
storage with flush/fsync and an immutable original file. Its private envelope
also preserves the withdrawal and confirmation identities. Recovery rechecks
them against the service before finalizing the original receipt. It works while
dispatch is held and performs no DOKU authentication or request:

```sh
php tools/commerce/finalize-withdrawal-payment.php \
  --receipt-file=/absolute/private/withdrawal-bank-payment.json
```

The transport caller uses this storage before D1 delivery. Both the
helper and CLI return 404 over direct HTTP. Neither stores provider credentials
in a receipt. A partial/unflushed file requires review and is never overwritten.

## Merchant behavior

Protected Wallet history/details distinguish a payment needing review from one
whose original response is recorded. Neither is labelled completed. Cancellation,
bank re-verification and another confirmation are hidden once a grant exists;
the server independently rejects those mutations. Full bank details remain
behind the existing Wallet verification rule. After a fresh bank confirmation,
the merchant explicitly acknowledges the amount/destination and submits “Send
bank transfer”. That form appears only when the PHP payment switch is enabled;
the Worker independently requires its own switch and original current authority.

The PHP caller obtains one durable grant, sends the exact original inquiry's
payment, exclusively saves its private receipt, then finalizes it in D1. A lost
grant response consumes the authority without retrying DOKU. An unknown provider
outcome also cannot be resent. Repeating a saved dispatch only recovers its
original receipt or reports review. Recovery works with payment dispatch held
and without loading provider credentials. Provider acceptance is displayed as
“Transfer response saved”; the existing status/history reconciliation alone can
establish completed payout accounting.

Five focused PHP/Worker/browser cases cover one-send behavior, private receipt
recovery during a storage outage, lost grant acknowledgements, unknown provider
outcomes, held configuration, CSRF/input restrictions and explicit mobile
confirmation. These are local fixture tests. Platform-paid fee funding, DOKU
service activation, authenticated callbacks and live bank acceptance remain open.

## Verification and rollout

The twelve focused Worker cases cover single-use grants, concurrent cancellation,
original proof/confirmation, funding changes, destination/evidence substitution,
Unicode request bytes, provider-reference reuse, immutable diagnostics, rollback,
database guards, a populated 0056 upgrade, beta scope and explicit main rejection.
The payment-granted Wallet and fresh-process private recovery cases pass, including
both missing and lost storage acknowledgements. All 80 relevant cases pass:
37 Worker cases (36 in the combined run and the additional focused main check)
and 43 PHP/adapter/merchant cases. PHP/JavaScript syntax, whitespace and the beta
Worker dry build pass. No local fixture response is live bank acceptance.

Logs are `/tmp/ezkart-payment-grants-{worker-final,main,php-final,ui-final}-01a0d643.log`.
The final mobile review includes the changed-owner/funding-shortfall message;
it never offers cancellation for a payment already granted. Its focused rerun
passes and the screenshot was inspected.

The fresh pre-migration export is 726,964 bytes, SHA-256
`6fa4a8602a565b3f2df9b14aa7dfe068eb90e41ff48a43ed7dceae376ac418fa`.
It restores cleanly with unchanged recovery bookmarks. Migration rehearsal
preserves every original row in all 162 exported tables and adds only three
empty tables. Integrity and foreign-key checks pass. Evidence is under
`/home/branch/.local/share/ezkart/beta-01a0d643/payments-before-0057-20260927/`.

Implementation `8960126`, migration 0057 and beta Worker
`581b21e5-81a0-4b49-99a2-0e714b089c3a` are deployed. All 37 hosted API checks
pass at 16:23 UTC on 27 September, including held payment dispatch, signed-service
access, environment/query rejection and evidence that cannot invent a grant.
At 16:24, Hostinger serves matching source hashes, private helper/CLI routes are
inaccessible, and unsigned merchant lookup is rejected. The actual signed-in
Wallet gate renders no protected withdrawal/earnings markup and loads the exact
tested script. No additional Wallet code is requested.

The post-export is 738,673 bytes, SHA-256
`a312fe2f91362a9819f6f8866f2e5105bf0e8feaa8bf3c47439e378e5b4c8ce0`.
It restores 165 tables with clean integrity/foreign keys and unchanged recovery
bookmarks. Of 161 original application tables, 159 are exactly unchanged. The
other changes are one user's ordinary `updated_at` refresh and the existing
16:17 housekeeping record (zero selected/removed/failed files). Migration history
advances from 56 to 57. All three new tables, withdrawals, captures, money journals
and earnings assessments remain empty; original wallet records are unchanged.

Private proofs are `payment-grants-{hosted,workbench,wallet-gate}-proof.json`,
`payment-grants-post-preservation.json` and `payments-after-0057-20260927/` under
the same private directory. Checkout, payment/inquiry dispatch, merchant
withdrawals and automatic email sending remain held. The existing hourly
housekeeping schedule is unchanged. TEST/main are not deployed or migrated.

## Remaining withdrawal work

The [DOKU transfer contract](https://developers.doku.com/wallet-as-a-service/sub-account/sub-account-v2/integration-guide)
does not expose a transfer-fee quote or payer override. Actual fee billing and
funding still need provider evidence so that Ezkart pays without reducing the
seller's withdrawal. The subsequent [reconciliation stage](withdrawal-reconciliation.md)
implements matched status/history, payout journals and completed-outflow deductions.
The integrated caller, actual fee provisioning, authenticated callbacks,
unsupported reversals, refund accounting and live acceptance remain required.
No launch gate is closed by this stage.

## Funded grants (0077)

New grants require the actual merchant fee contract and atomically reserve its
inclusive channel ceiling against both released company commission and current
company cash. Original contract/balance identity survives config changes; old
grants receive no invented funding. See [fee funding and activation](transfer-fee-funding.md)
for exact settings and supported direct-company-billing semantics. Seller-source
charging remains held pending its explicit funding/reimbursement implementation.
No transport flag was enabled.
