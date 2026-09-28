# Ezkart commission treasury

Migrations 0070, 0072, 0073, 0075 and 0077 add company commission reservations, bank inquiries, confirmations, durable transfer grants and actual-outflow accounting.
It reserves only original order commission supported by current verified routed
settlements. It does not move money, mark a company bank as verified, or treat
platform cash as withdrawable commission. Seller withdrawals and their journal
accounts are unchanged.

DOKU's [Collect and Route guide](https://docs.doku.com/wallet-as-a-service/sub-account/collect-and-route)
and [V2 integration contract](https://developers.doku.com/wallet-as-a-service/sub-account/sub-account-v2/integration-guide)
were checked on 28 September 2026. A routed Sub-Account receives its split at
settlement; paying that cash to a bank requires Transfer Inquiry then Transfer
Payment. Main-bank automatic settlement belongs to payments without
`additionalInfo.account`; knowing Ezkart's registered bank does not establish
an automatic sweep of its commission Sub-Account.

## What the code does

`commerce_treasury_commissions` links each primary allocated capture to its
original platform enrollment, original commission snapshot, latest settlement
assessment, current provider-source verification and cumulative confirmed
commission reversals. Shipping and Rp1,250 admin amounts are excluded. A provider
balance, seller earnings or the larger mixed platform cash credit cannot replace
these sources. Totals use SQLite integer arithmetic and API money values are
decimal strings; integer overflow fails the query, never converts a balance to a
floating-point approximation.

Only currently settled, unflagged allocations without outstanding refund/return
issues contribute eligible commission. Pending, unresolved, voided or stale
settlements contribute zero. A corrected settlement must pass the existing
current-source verifier again. Eligible commission from another seller never
restores a held capture's commission. Unattributed captures, incomplete or
misattributed journals, and any open refund or confirmed-but-unreconciled refund
funding in the mapped pool prevent new reservations. Confirmed commission
reversals lower the net projection using their exact original amounts. The
existing refund funding boundary has no release mechanism yet, so its hold is
preserved.

A reservation freezes an amount, original platform enrollment, original company
bank configuration, destination hash, original request key, partner reference,
operator identity and a per-capture source manifest. Its two balanced entries in
`commerce_treasury_entries` move only between `commission_unreserved` and
`commission_reserved`. This is a reservation subledger, not a cash movement or a
new recognition of revenue in the general financial journals. Atomic SQL checks
current sources and outstanding reservations before inserting the intent and
entries. Concurrent requests cannot reserve the same money twice. Source
manifests exceeding 200 KB cause an explicit `commission_source_capacity_exceeded`
hold; paging/chunked provenance is a future scaling task.

Later holds or reversals preserve the original intent and expose a reservation
shortfall. Cancellation releases exactly its original reservation and leaves
immutable cancellation entries. There is no expiry-based release or assumed
payment failure. A payment grant atomically fences cancellation before any provider send. An inquiry alone does not move funds or prevent cancellation.

## Authorization and server-owned destination

All routes require an authenticated, signature-verified Supabase user, `aal2`
and TOTP within ten minutes. The user must also be a current Ezkart `reviewer`
in the existing audited support registry **and** appear in the private
`COMMERCE_TREASURY_OPERATORS` comma-separated auth-user-ID setting. Store ownership
or an email/domain match does not grant treasury access. JWT proof and registry
checks follow the existing fresh-MFA pattern; SQL rechecks the current registry
and proof expiry at reservation/cancellation time. A signed service HMAC cannot
act as an operator or invent provider evidence.

`COMMERCE_PLATFORM_WALLET_SELLER` must identify the active Ezkart-controlled store
with its independently confirmed dedicated platform Sub-Account. Treasury does
not register a wallet or touch the original uncertain registration.

`COMMERCE_TREASURY_BANK` is private server-owned JSON with exactly these fields:
`configurationId`, `code`, `accountNumber`, `channel` (`BI_FAST` or `ONLINE`) and
`beneficiaryName`. The operator must populate it from the actual company bank
record. No bank details were supplied or configured by this implementation.
The name is an **expected** beneficiary, not a verified inquiry result. There is
no client bank editor, seller-bank lookup, or caller-supplied destination field.
Summary output masks the number and does not call configured details verified. Intent detail separately shows the actual returned inquiry holder and digest. Confirmation requires that returned name to match the pinned company name exactly; differences require review.
Changing configuration cannot retarget an existing intent; reads show
`configurationChanged` and retain the original hash and destination suffix.

## Operator API and lost acknowledgements

| Route | Input / result |
| --- | --- |
| `GET /v1/treasury/commissions` | Current commission projection, held source counts, reserved amounts, shortfall, masked configured destination and explicit execution blockers. |
| `POST /v1/treasury/intents` | Only `requestKey` (32 hex) and `amount` (positive whole-rupiah decimal string). Returns original intent and source provenance. |
| `POST /v1/treasury/intents/lookup` | Only original `requestKey`; recovers a committed reservation after a lost reply. |
| `GET /v1/treasury/intents/:id` | Reads original immutable intent and its current funding projection. |
| `POST /v1/treasury/intents/:id/cancel` | Only a fresh cancellation `requestKey`; atomically releases the original reservation. |

Identical reserve/cancel replays are idempotent; changed parameters or actors
cannot replace the original. Database failure while posting either entry rolls
back the entire reservation. A response timeout never requires a new intent:
look up the original request key first. Grant replays always return false send authority. A provider receipt never sets `payoutConfirmed:true`.

## Owner bank workflow

`cart/admin/?page=treasury` is linked beside Ezkart reviews. The native page shows exact commission amounts, masked company bank, original reservations, returned inquiry holder, fresh confirmation, cancellation and original receipt recovery. It has no seller bank editor or manual-paid action. Current session CSRF and same-origin checks protect forms. The existing authenticator flow returns to the original treasury intent. Worker operator allowlist, registry and fresh TOTP checks apply on every owner request.

| Route | Purpose |
| --- | --- |
| `POST /v1/treasury/intents/:id/inquiry/start` | Fresh owner JWT, provider fingerprint/client, original one-send inquiry grant. |
| `POST /v1/treasury/intents/:id/confirm` | Fresh owner JWT, `requestKey` and original `inquiryDigest`; exact company holder match. |
| `POST /v1/treasury/intents/:id/payment/start` | Fresh owner JWT, original confirmation and provider identity; single payment grant subject to execution policy. |
| `POST /internal/commerce/finance/treasury/:id/{inquiry,payment}/read` | Signed service only; original binding, identity, confirmation and receipt. Never renews send authority. |
| `POST /internal/commerce/finance/treasury/:id/{inquiry,payment}/receipt` | Signed service only; strict original response validation and immutable idempotent receipt. |

Before grants, current source availability, original eligible captures, operator authority/proof, active company wallet, pinned bank hash and provider identity are rechecked. Later pooled commission cannot replace an original held capture. SQL repeats source and authority checks atomically. Payments retain the inquiry binding, both original external IDs, bank/name/reference, source snapshot and fresh confirmation. Grants and receipts reject replacement/deletion.

`cart/api/commerce-treasury-bank.php` uses the existing typed `EzDokuPayoutClient` at documented fixed DOKU V2 endpoints. Treasury uses `EZK-TREASURY-*` and exact positive whole-rupiah amounts; seller withdrawals retain their Rp250,000 minimum. There are no arbitrary URLs, fee guesses, automatic retry or channel fallback. Timeout, invalid response and lost acknowledgement produce an unknown outcome that cannot be resent.

PHP `commerce_treasury_inquiry` / `commerce_treasury_payment` and Worker `COMMERCE_TREASURY_INQUIRY` / `COMMERCE_TREASURY_PAYMENT` all default held. No flag was enabled. Migration 0077 derives release from current settlement and verified delivery, and requires an actual company-billed fee contract plus atomic fee budget. Enabling flags alone cannot bypass these checks; see [fee funding](transfer-fee-funding.md).

## Original private receipt recovery

Set `commerce_treasury_recovery_directory` to a writable mode-0700 directory outside repository/document roots. Original documents use `try_<40 hex>-inquiry.json` or `try_<40 hex>-payment.json`; they are exclusively created mode0600, flushed and fsynced before Worker delivery. A partial/unreadable receipt remains held for review and cannot be replaced. The directory must be durable and included in private backups.

```sh
php tools/commerce/finalize-treasury-receipt.php --receipt-file=/absolute/private/original-payment.json
```

Recovery compares the private receipt with the original signed Worker grant read and submits only the original evidence. It never authenticates to DOKU, loads current bank configuration, requires an owner session or renews send authority. It works after role/configuration changes and while flags are held. Retain receipts after successful recovery. Missing responses require future matched status/history review, never another payment attempt.

## Remaining execution requirements

Matched original company status/history collection, immutable provider-outcome assessment and confirmed actual-outflow accounting are implemented below. New transfer funding and release eligibility remain held. Matched successes consume the original reservation; explicit VOID failures remain reserved. No provider call, deployment, bank configuration or flag enablement was performed.

Before actual payment authority can be enabled, the company bank and dedicated
platform account still need real verification, and the commission release/reserve
policy plus actual transfer-fee funding/custody contract must be resolved. No
fee quote, payer override, cash-funding proof, release policy or universal refund
recovery is invented by this phase. These missing contracts block dispatch through the empty eligibility view; the typed caller and original-receipt recovery paths are implemented and fixture tested.

Focused tests exercise original commission isolation, two sellers in one pool,
concurrent reservations, lost local acknowledgements, immutable destinations,
role/MFA changes, stale/corrected/voided settlements, refunds and confirmed
reversals, balanced-but-misattributed journals, bounded source capacity,
transaction rollback and migration preservation. All provider evidence in these
tests is isolated fixture data, never live financial acceptance.

Phase-two fixtures cover concurrent one-send grants, exact company holder, enabled-flag policy holds, post-grant cancellation fences, altered/duplicate financial evidence, revoked-authority recovery, typed transfer transport, private-file permissions, lost delivery and unknown-outcome no-resend. Only isolated fixtures replace the empty eligibility view; no such writer ships.


## Original status/history and immutable outcomes (0073)

The DOKU [V2 integration contract](https://developers.doku.com/wallet-as-a-service/sub-account/sub-account-v2/integration-guide) was checked again on 28 September 2026. `transactions-status` returns merchant reference, amount, transaction type/status/date and debit cancellation context. It does **not** return source account or destination bank. `transaction-history-list` scopes rows to the requested account and returns provider/merchant references, mutation/type, amount, channel and outcome; it also has **no destination bank fields**. A `PAYOUT_CHARGE` row records a fee mutation; the contract does not establish which mixed company funds legally fund it, commission custody or release entitlement.

For those reasons, `matched_success` requires the original strict transfer receipt to bind the company bank, a matching successful PAYOUT status and exactly one matching successful cash DEBIT principal plus one explicit resolved PAYOUT_CHARGE in the original company account collection. Principal, reference, source pocket, amount, IDR, channel, timing and any foreign/extra group rows are checked. Missing transfer receipt remains `destination_not_confirmed_by_transfer_receipt` even when status/history suggest success. No bank destination is invented from a status read. A missing/duplicate charge is unknown; `observedFee` stays nullable. An explicit successful zero-value charge can report `"0"`; absence cannot.

All raw responses remain immutable. Every status observation uses the original provider fingerprint/client/reference and a distinct request ID; strict financial JSON rejects ambiguous numeric/duplicate-key evidence. Overlapping conflicting frontiers, terminal regressions, conflicting terminal outcomes, refund/cancellation context, wrong transaction types, pending results, unknown references and unsupported rows stay held. Arrival order never replaces provider observation order.

An outcome assessment pins the complete exhausted company cash **and pending** collection, exact original status sequence frontier and original transfer receipt digest. It appends a new result rather than modifying an old one. A later overlapping or related history read, a new status, or a late original transfer receipt makes the older assessment noncurrent immediately. Reconciliation of stale/incomplete collections is rejected; a previously saved result is still visible with `provider_evidence_changed`. A provider reference already bound to seller payout/settlement or another company receipt cannot support a company match. Shared closed-window endpoints are checked and counted once without erasing genuine duplicate legs.

`matched_failure` means an original failed status and explicit VOID principal/fee observations agree; it does not authorize reserve release. FAILED rows alone do not prove the debit was removed. Migration 0075 adds accounting for source-confirmed successful company outflows, described below. Failed, ambiguous and stale outcomes still cannot release a reservation. Seller earnings, minimums and reserve-account semantics are not reused. Execution additionally requires the source-derived release and funded fee grant introduced by 0077.

Signed internal routes:

| Route suffix under `/internal/commerce/finance/treasury/:id/` | Purpose |
| --- | --- |
| `observations/scope` | Original transfer binding and original company enrollment/profile/cash/pending accounts; independent of current pinned configuration or owner role. |
| `status/receipt` | Save original typed status evidence. |
| `status/history` | Bounded immutable history with fixed sequence cap and current provider frontier. |
| `outcome/reconcile` | Only original `collectionId` and `statusCap`; append immutable source-derived classification. |
| `outcome/read` | Current outcome, nullable fee, original evidence provenance and accounting hold. |

The owner screen shows the latest observed status and source-current outcome, separate from payment confirmation and cash accounting.

### Bounded read-only collection and recovery

`commerce_treasury_observations` defaults held; no setting was enabled. With separately approved actual provider reads, the CLI runs the existing typed status, balance and history readers against only the original company account. It takes no bank override, seller override, arbitrary URL, transfer capability or accounting override.

```sh
php tools/commerce/sync-treasury-observations.php --intent=try_<40hex> --environment=production --run=<32hex> --mode=collect --max-pages=10 --max-reads=20
php tools/commerce/sync-treasury-observations.php --intent=try_<40hex> --environment=production --run=<same32hex> --mode=recover --max-pages=10 --max-reads=20
```

Use sandbox only with the TEST deployment; beta uses production identity. A private locked run is stored beneath `commerce_treasury_recovery_directory`. Before requesting the next provider response, each read is committed atomically as a mode0600 file in a mode0700 directory. Run scope, company identity, pagination/window plan, collection input and outcome input cannot change. Collection uses at most 12 contiguous 31-day windows, at most 40 pages per original pocket and a bounded per-invocation read budget. A budget pause resumes the same run and never repeats successful reads. A retained provider failure stops the same run; another explicitly requested read run may be needed. Read failures never authorize transfer retries.

`recover` replays saved response bytes and D1 finalization only, without loading provider credentials or making DOKU calls. If it reaches an unsaved read, it stops and requires explicit collection. Recovery works with dispatch/observation flags held. An unsaved or unknown transfer response is never replaced by a second transfer. New shared company history can invalidate earlier settlement/payout source snapshots; the collector reports `sharedHistoryRefreshRequired:true` and does not silently rewrite related accounting.

## Confirmed actual company outflows (0075)

A successful provider transfer that has already happened must remain in the cash
ledger even while new transfer authorization is held. The existing original
receipt binds the bank; the complete company-account history proves both the
principal debit and the actual company fee. Migration 0075 therefore recognizes
only a current `matched_success` with an explicit actual charge, including a
provider-observed zero charge. It never uses a guessed fee or caller-supplied
amount. Principal plus fee must fit the exact integer journal range.

`outcome/reconcile` atomically saves its assessment and immutable recognition.
The general financial journal debits `company_bank_transfer_clearing` for the
principal, debits `platform_withdrawal_fee` for the actual expense, and credits
`provider_cash_platform` for their sum. Commission revenue is not recorded a
second time. The clearing account records DOKU's confirmed bank transfer; it is
not a fabricated bank statement or a manual-paid switch.

The reservation is **consumed**, not restored to available commission. Owner
output includes `paidCommission`, `paidTransferFees`, `recognizedPrincipal`,
`recognizedFee`, `reservationConsumed`, and current `reconciled` state. The
commission pool deducts recognized company principal and actual company/seller
transfer fees before admitting another reservation. Shipping, admin allocation
and seller earnings are never added to that commission budget. An actual fee
larger than the remaining commission is still booked honestly and creates a
visible shortfall instead of spending someone else's allocation silently.

A refreshed exact match with a changed actual charge posts only the fee delta.
An unchanged result posts no duplicate cash journal. Later missing fees,
contradictory status or stale history preserve the last recognized principal and
fee and hold new availability. Original identities, cancellation fences and
no-resend behavior remain intact. Recognition and every journal line reject
replacement, alteration and deletion. Replaying a current pre-0075 assessment
through the same reconciliation route can append its missing recognition; the
migration does not guess or auto-finalize old observations.

### Exact remaining dispatch work and activation order

The owner has already decided that Ezkart pays withdrawal fees and seller
withdrawals start at Rp250,000. That decision is not a missing input. The DOKU
[V2 bank transfer request](https://developers.doku.com/wallet-as-a-service/sub-account/sub-account-v2/integration-guide)
contains no fee quote or billing-account override. Before releasing payment
execution, the actual merchant contract must establish the charged account and
inclusive fee ceiling for each supported channel, including tax. In particular,
a seller-source transfer cannot be assumed to charge the Ezkart account just
because Ezkart owes the fee. If DOKU charges the seller source, an explicit
company-to-seller funding/reimbursement workflow is required; none is invented
by this migration.

Migration 0077 implements immutable contract identity, atomic fee reservations,
actual company cash proof and conservative delivered/settled release for the
supported direct-company-billing contract. Exact settings, provider facts,
unsupported seller-source charging and activation steps are in
[transfer fee funding](transfer-fee-funding.md).
