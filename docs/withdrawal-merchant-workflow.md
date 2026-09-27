# Merchant withdrawal requests

The protected Wallet now provides withdrawal requests, bank verification,
bank-returned destination confirmation, cancellation and saved history. This
implements the merchant interface for [reservations](withdrawal-reservations.md)
and [original bank inquiries](withdrawal-bank-inquiries.md). It does not execute
a bank transfer. The deployed beta's request/inquiry execution holds remain in
place until the full withdrawal system is ready.

## Merchant behavior

New requests require a connected seller wallet, current owner verification,
enabled merchant capability, complete accounting and at least Rp250,000 in
available earnings. The server independently rechecks authority and funds inside
the reservation transaction. The amount, bank, account number and channel are
saved before the bank check. Leading zeroes are preserved. The bank-returned
account-holder name is rendered as text and must be reviewed with the original
amount and destination before the owner checks the confirmation box.

The bank catalog contains 125 bank codes and their BI-FAST/Online support from
the [DOKU bank list](https://developers.doku.com/payout/kirim-doku#list-of-supported-banks),
checked on 27 September 2026. DOKU's
[Sub-Account integration guide](https://developers.doku.com/wallet-as-a-service/sub-account/sub-account-v2/integration-guide)
references this catalog for bank-account transfers. PHP rejects unsupported
bank/channel combinations before a reservation is created. The catalog is not
evidence that Ezkart's merchant services are activated. Both selectors use the
existing universal dropdown control.

History masks bank accounts and loads ten requests at a time using a fixed
sequence cohort. Protected details show the full original destination. The
current owner can cancel an unsubmitted request even while new requests are
held; a changed owner cannot reuse the former owner's inquiry or confirmation.
Changed funding disables bank verification/confirmation without losing the
reservation. No screen describes a saved request or bank check as money sent.
The seller fee remains Rp0; Ezkart must fund the actual transfer fee when payment
execution is implemented.

## Recovery and verification expiry

Before a reservation call, the browser persists an opaque request key scoped to
the account, store and environment. It never stores bank details in browser
storage. The new signed `POST /internal/commerce/finance/withdrawals/lookup`
requires fresh current-owner proof and resolves that same original request key.
The merchant proxy supplies the identity and environment; the browser cannot
choose them. A missing or failed acknowledgement never rotates the key. It is
cleared only after a protected detail response recovers the original reservation.

Inquiry retries use the existing grant and saved receipt; they cannot call the
provider again. Confirmations/cancellations retain their own action keys when
the response is uncertain. Closing the dialog clears bank inputs and detail
text. Expired verification, a manual lock or a failed background authentication
check aborts pending requests, closes the dialog and clears protected details
before showing the real verification gate. Late responses cannot restore them.

## Verification

The relevant coverage comprises 25 Worker cases and 31 PHP/merchant/browser
cases. The Worker run passes all 25. The PHP run passes 30 of 31; its expiry
fixture initially retried an email code inside the existing one-minute cooldown.
The corrected focused expiry test passes, including the real cooldown message,
re-verification and preservation of the original receipt. Its further background
lock check also passes. The failed-read case passes after the final availability
message adjustment. No production authentication rule was weakened.

Coverage includes desktop and 390px layouts, bank selection and leading zeroes,
literal rendering of markup in a bank name, required owner confirmation, three
lost-response/reload recovery cases, funding holds, uncertain bank checks,
fixed-cohort history, cancellation while held, unsupported channels and direct
HTTP protection. The initial mobile history clipping was fixed and the focused
history rerun passes. Screenshots were inspected. PHP/JavaScript syntax, whitespace
and the beta Worker dry build pass.

Logs are `/tmp/ezkart-withdrawal-ui-{worker-final,php-final,expiry-final,lock-final,read-failure-final,history-visual}-01a0d643.log`.
These isolated provider fixtures do not establish a real inquiry or transfer.

## Hosted workbench rollout

Implementation `75bfe13` is pushed to `agent/ezkart-workbench`; beta Worker
`281c44d7-2b73-4dac-81ac-d6d9990677e7` is deployed. No migration is required;
the database remains on 0056 with 161 application tables. All 30 hosted API
checks pass at 15:47 UTC on 27 September, including the new lookup's signed
service, expired-proof, missing-proof and unknown-field rejection. Earnings,
captures and money journals remain empty; the original uncertain seller-wallet
registration is unchanged.

At 15:50 UTC, Hostinger serves matching hashes for the withdrawal script, bank
catalog, shared Wallet script/styles and implementation document. Private PHP
partials/helpers and the recovery CLI return 404 over direct HTTP; unsigned
merchant lookup returns 401. In the actual signed-in shared Chrome session, the
Wallet verification gate renders no withdrawal markup, dialog or earnings.
The browser loads the exact tested withdrawal script. No additional owner code
is requested for these held-feature checks. The populated screens remain
verified with isolated merchant fixtures, not a live bank transaction.

The first asset checks encountered normal rollout lag and a cached pre-deployment
404; a unique verification URL and the actual versioned browser script both
resolve to the tested file. Private evidence is
`withdrawal-ui-{hosted,workbench,wallet-gate}-proof.json` under
`/home/branch/.local/share/ezkart/beta-01a0d643/`.
All environment configuration hashes are unchanged. Checkout, provider inquiry,
merchant withdrawal and automatic email holds remain in place; only the existing
hourly housekeeping trigger remains scheduled. TEST/main are not deployed.

## Remaining work

The [payment grant and original receipt](withdrawal-payment-grants.md) now fence
cancellation and repeat send authority, recheck authorization/funding and support
private receipt recovery. Payment execution still needs its integrated caller,
actual Ezkart-funded fees, authenticated outcome reconciliation, completed payout
journals and completed-outflow deductions. Full refund funding/accounting and
live acceptance remain required. This delivery adds no migration, scheduled
dispatch or provider-payment endpoint and closes no top-level launch gate.
