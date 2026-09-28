# Ezkart commission treasury — reservation component

Migration 0070 adds a separate company treasury projection and reservation ledger.
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
payment failure. No treasury dispatch route exists in this phase, so cancellation
is safe here; a future single-use payment grant must fence cancellation in the
same database transaction before any provider send is possible.

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
API output masks the number and always reports `verified:false` in this phase.
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
look up the original request key first. This phase makes no DOKU requests and
cannot have a provider transfer result to retry. It returns
`reserved_pending_bank_verification`, `mayPay:false`, `payoutConfirmed:false`,
`withdrawableCommission:null` and `executionAvailable:false` truthfully.

## Concrete next implementation

Add the company-specific Transfer Inquiry grant/typed caller and retained
original receipt, verify the returned bank/name against the pinned destination,
and require fresh operator confirmation of that original inquiry. Then add an
immutable, single-use treasury payment grant and typed low-level transfer caller,
private original-response storage, receipt-only recovery after lost local
acknowledgement, and status/history reconciliation with company payout journals.
Unknown grant or provider outcomes must never resend a transfer; cancellation
must be fenced once payment authority is consumed. Seller grant/earnings
assumptions must not be reused. Add an owner-facing treasury screen on these APIs.

Before actual payment authority can be enabled, the company bank and dedicated
platform account still need real verification, and the commission release/reserve
policy plus actual transfer-fee funding/custody contract must be resolved. No
fee quote, payer override, cash-funding proof, release policy or universal refund
recovery is invented by this phase. These missing contracts block dispatch;
they do not establish that the rest of the caller/recovery code is complete.

Focused tests exercise original commission isolation, two sellers in one pool,
concurrent reservations, lost local acknowledgements, immutable destinations,
role/MFA changes, stale/corrected/voided settlements, refunds and confirmed
reversals, balanced-but-misattributed journals, bounded source capacity,
transaction rollback and migration preservation. All provider evidence in these
tests is isolated fixture data, never live financial acceptance.
