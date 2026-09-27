# Delivery evidence for financial release

Migration 0050 records completion of an entire captured order. It uses the
original purchased items, applied courier evidence and verified complete digital
downloads. A delivery receipt is one requirement for releasing earnings;
**it does not prove provider settlement or create available funds**.

## Evidence and current holds

Every physical item needs committed or recovered stock and a bound courier
shipment. Its immutable applied status event, or dated history from a verified
create/refresh response, must match the recorded delivery. An unbound callback,
stale delivery rejected by the courier state machine, mutable order label or
sandbox shipping skip cannot satisfy this requirement.

Every digital item needs the original purchased file version, the primary
capture entitlement and complete-download evidence for the authorized buyer.
Opening a download, receiving a native browser response or verifying only some
parts is insufficient. Replacing or archiving the current catalog file does not
change the purchased version or an already verified delivery.

Mixed orders wait for all their physical and digital lines, in either completion
order. Unsupported fulfillment types cannot produce a receipt. The immutable
receipt records each line's original quantity and exact source identifiers.
Its confirmation time is the latest time the constituent proofs were verified;
provider delivery timestamps remain separately preserved.

The last digital proof or applied courier event records the receipt inside the
same database transaction. Failure rolls back completion and its receipt
together; an original retry can finish them once. Later equivalent courier
observations do not replace the chosen historical evidence. Replacement writes
cannot rewrite the receipt or its courier/download sources.

Delivery remains a historical fact after a return. The service separately reads
current payment/fulfillment reviews, additional captures, unresolved provider
jobs, courier returns, refund requests and physical return cases. A closed return
is not treated as financially reconciled. These checks do not replace the future
atomic settlement/reserve/refund checks at earnings release or withdrawal.

## Service routes

Both routes require the central server HMAC, explicit environment and store.
Merchant/customer tokens do not authorize them. Input rejects duplicate JSON
keys, extra parameters and unbounded requests.

- `GET /internal/commerce/finance/delivery?seller=…&environment=…&orderId=…`
  returns the original receipt and current holds for that exact order. It always
  reports `settlementVerified: false`, `releaseReady: false` and
  `availableToWithdraw: null` at this implementation stage.
- `POST /internal/commerce/finance/delivery/reconcile` accepts `seller`,
  `environment`, optional `orderId`, and `limit` from 1–100 (default 25). It
  catches up existing complete evidence after an upgrade. It accepts no delivery
  assertion, item override, amount, timestamp or fee. `caughtUp` means all
  currently eligible receipts were recorded, not that all orders were delivered.

No scheduler or provider call is introduced. No merchant balance or payment
journal is changed by these routes. Original evidence stays private to the
service; full file/grant and provider identifiers are not a public wallet API.

## Validation and remaining work

Coverage includes mixed orders in both completion orders, partial/native
downloads, original file versions, early and repeated callbacks, skipped/stale
shipping, returns and refunds, concurrent catch-up, forged/replaced evidence,
rollback recovery, strict input and beta/TEST isolation. Existing financial,
fulfillment, digital-purchase and review cases remain part of verification.

The nine delivery cases pass on the final migration. All 24 affected
fulfillment/digital/review regressions, twelve accounting/refund-evidence cases
and 22 PHP/browser integration cases also pass. The beta Worker dry build and
whitespace checks pass. Logs are `/tmp/ezkart-financial-delivery-ready-01a0d643.log`,
`/tmp/ezkart-financial-delivery-api-final-01a0d643.log` and
`/tmp/ezkart-financial-delivery-php-01a0d643.log`.

The migration is rehearsed on a fresh private beta export before rollout. Order
lookups use indexed captures, shipments and applied events instead of scanning
unrelated orders. This does not establish sustained-load or real delivery
acceptance. Actual provider settlement/fees, reserves, refund accounting,
available-balance posting and withdrawals remain required in
[the financial ledger](financial-journal.md).
