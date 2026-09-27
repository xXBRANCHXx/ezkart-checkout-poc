# Digital checkout and verified download records

Workbench implementation, 27 September 2026. This implements the central API
contract. The storefront/PHP purchase flow, customer download screen, mobile
storage/resume behavior and signed-in hosted acceptance still need integration.
Central-commerce and provider holds remain in place. Subscription billing,
allocated refunds and wallet release are separate unfinished work.

## Purchase identity and physical fulfillment

Digital checkout requires the current real file version in `expectedFileVersion`.
The order transaction freezes that version, filename, size, option, quantity and
price in the original order item. A transaction guard rejects a concurrent file,
price, option or store change and rolls back the entire order. Exact checkout
retries retain the first purchase even after the catalog changes. A replacement,
archived product or hidden option cannot replace the buyer's purchased file.

A digital-only order uses `shipping: {kind: "none", amount: 0, skipped: false}`
in both environments. It needs no address, pickup settings, physical weight or
inventory reservation. It cannot use the sandbox shipping bypass. Physical items
cannot enter a no-shipping order. Mixed orders retain the authoritative quote and
reserve/consume only physical items. Late-payment stock recovery and courier
acceptance also operate only on physical items; PHP sends only those items to
the courier. Every item remains in the payment total and original fee snapshot.

## Payment and buyer access

The first verified primary capture creates one immutable entitlement per digital
order item in the same transaction as payment state. An additional payment never
duplicates it. Guest purchases must be permanently claimed through the existing
verified-account service. A matching submitted email, another seller, or knowing
an order/grant identifier does not authorize access. Current order ownership,
environment, payment state and file availability are rechecked after storage
awaits. Purchased versions do not depend on current merchant membership or an
active catalog listing.

Download grants expire after 24 hours and always require the same authenticated
buyer. They are not public bearer links. A durable request key recovers the same
grant after an uncertain reply. Twenty new grants per item/buyer/hour and three
hundred byte requests per grant/hour are bounded in the database; exact grant
retries do not spend another creation. HEAD requests are read-only. Historical
grants and evidence are currently retained; operational retention/monitoring is
still an acceptance task.

Payment review and full refunds prevent further access. Until the allocated
refund lifecycle is implemented, a partially refunded order has an explicit
`refund_review` hold with support guidance. This is not a completed partial-refund
or per-item revocation implementation, and does not erase delivery history.

## Completed-download evidence

The owner selected a **verified complete download** as sufficient digital
delivery on 27 September. Settlement remains independently required for earnings
release. Download availability, a GET/HEAD, or a PHP server receiving bytes does
not establish buyer delivery.

The verification protocol uses the original ordered five-MiB part manifest. Each
part response first checks its real bytes against the merchant's frozen SHA-256.
A fresh random 32-byte nonce is durably attached to that grant and part. The
expected proof is kept private in D1. The client calculates:

```text
SHA256(UTF8("ezkart-digital-part-v1\n" + grantId + "\n" +
            decimalPartNumber + "\n" + lowercaseHexNonce + "\n")
       || originalPartBytes)
```

Knowing a published checksum alone is insufficient. Proofs from another grant or
part cannot be reused. The API accepts an immutable part receipt only when the
proof matches and the buyer/payment/grant remain eligible. The final required
part atomically creates one immutable delivery record, including buyer, grant and
verification time. Concurrent acknowledgements and retries after a lost result
cannot duplicate it. The grant, purchase and entitlement provide the original
version and capture chain. This establishes possession of all original bytes;
it does not attest that the buyer opened the file or saved it in a particular
folder. The upcoming client must acknowledge only after receiving, checking and
storing each complete part, and must handle interrupted storage/network writes.

The original authenticated attachment endpoint supports whole files, one byte
range and HEAD, but never marks a verified delivery. Raw response-start records
are deliberately separate from completed-download evidence. Delivery receipts
do not post accounting entries, mark courier delivery or create available funds.
Order-level release still needs the full delivery/settlement/refund rules.

## API and schema

All routes below require a verified buyer session and current central-commerce
availability. Paths and query parameters are strict; JSON writes are bounded and
reject ambiguous duplicate object keys.

| Method | Path below `/v1/customer/orders/{order}/downloads` | Result |
| --- | --- | --- |
| GET | `/` (without trailing slash) | Purchased files, access and delivery state |
| POST | `/{item}/grants` | Recoverable grant, body `{requestKey}` |
| GET | `/{item}/grants/{grant}` | Manifest, saved challenges, verified progress |
| GET, HEAD | `/{item}/grants/{grant}/file` | Authenticated attachment, no delivery acknowledgement |
| GET | `/{item}/grants/{grant}/parts/{number}` | Original part bytes and nonce/checksum headers |
| POST | `/{item}/grants/{grant}/parts/{number}/receipt` | Verify `{proof}` and return saved progress |

Migration `0043_digital_commerce.sql` adds seven tables and 31 indexes/triggers.
It replaces three existing shipping/fulfillment triggers to scope physical checks
correctly, preserving their other conditions. Existing records are not rewritten.
The old generic `entitlements` scaffold still authorizes nothing.

## Verification and remaining acceptance

Local D1/R2 cases cover exact checkout and file identity, actual multipart bytes,
physical/mixed orders, late payment, variants, production-shaped no-shipping
fixtures, owner and environment isolation, cancelled/changed access, immutable
evidence, corruption, forged/reused proofs, concurrent requests, expiry, limits
and ambiguous replies. Financial checks compare original journals and every
entry before/after download verification. Existing order, shipping, fulfillment,
financial and file-storage regression suites are also exercised. PHP tests cover
the actual mixed-order courier payload and the existing checkout and desktop/
mobile order manager.

The fresh private TEST export is 664,953 bytes, SHA-256
`4e1106f5bd48387f91728d1970472a477a0c2e598c52a1d48f7ce9f3f8568c85`.
Restoration preserves every record in 134 existing physical tables, passes
integrity and foreign-key checks, adds 38 objects and changes only the three
intended triggers. All 204 captured compatibility query plans compile.

Implementation `c768151` is pushed to workbench. TEST migration 0043 and Worker
`27598d28-23ce-4c35-8a7b-99fc2224afc6` are installed. Eleven new digital cases,
thirty-three existing order cases, twenty-seven financial/order-read/shipping/
fulfillment cases, eight private-file cases and twenty-five PHP cases pass.
The two strengthened path/proof access cases also pass. The Worker dry-run,
syntax and diff checks pass. Hosted checks on 27 September pass: sixty-five
Worker checks at 01:31:02 UTC, thirteen asset hashes at 01:30:58 UTC and thirty-five
access/header guards at 01:31:01 UTC. Final remote verification matches the
restored schema and all 204 plans, preserves existing counts/settings/legacy
evidence, and finds no pending migration or foreign-key error. All seven new
tables remain empty. The central-commerce/provider holds are unchanged.

Outstanding: storefront/PHP checkout integration, buyer download/save/resume
screens, verified client-side persistence before acknowledgement, maximum-size
and mobile transfers, signed-in hosted acceptance, allocated digital refunds,
subscription lifecycles, storage operations and financial release/settlement.
All thirteen top-level completion gates remain open.
