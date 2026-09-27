# Withdrawal payment grants and original receipts

Migration 0057 adds the durable boundary between a cancellable withdrawal and
possible bank payment. A committed grant permanently fences cancellation and
another send authority. Original payment replies are retained independently of
the bank inquiry, with private recovery after failed or lost acknowledgements.
No final payout is inferred from an HTTP success response.

This stage has no merchant payment action, scheduled dispatcher or integrated
provider-payment caller. `COMMERCE_WITHDRAWAL_PAYMENT` remains absent/held on beta.
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

The future transport caller must use this storage before D1 delivery. Both the
helper and CLI return 404 over direct HTTP. Neither stores provider credentials
in a receipt. A partial/unflushed file requires review and is never overwritten.

## Merchant behavior

Protected Wallet history/details distinguish a payment needing review from one
whose original response is recorded. Neither is labelled completed. Cancellation,
bank re-verification and another confirmation are hidden once a grant exists;
the server independently rejects those mutations. Full bank details remain
behind the existing Wallet verification rule. There is no browser send-payment
action in this delivery.

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
The beta rollout is being completed.

The fresh pre-migration export is 726,964 bytes, SHA-256
`6fa4a8602a565b3f2df9b14aa7dfe068eb90e41ff48a43ed7dceae376ac418fa`.
It restores cleanly with unchanged recovery bookmarks. Migration rehearsal
preserves every original row in all 162 exported tables and adds only three
empty tables. Integrity and foreign-key checks pass. Evidence is under
`/home/branch/.local/share/ezkart/beta-01a0d643/payments-before-0057-20260927/`.

## Remaining withdrawal work

The [DOKU transfer contract](https://developers.doku.com/wallet-as-a-service/sub-account/sub-account-v2/integration-guide)
does not expose a transfer-fee quote or payer override. Actual fee billing and
funding still need provider evidence so that Ezkart pays without reducing the
seller's withdrawal. The integrated caller, authenticated status/callback/history
reconciliation, final payout/refund journals, completed-outflow deductions and
live acceptance remain required. No launch gate is closed by this stage.
