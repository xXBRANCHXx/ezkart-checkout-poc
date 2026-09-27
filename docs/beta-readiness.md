# Workbench beta preparation

Owner instruction, 27 September 2026: DOKU has approved Ezkart; prepare everything
for beta/soft-launch and keep all work on `agent/ezkart-workbench` / `test.ezkart.id`.
Do not push main, merge PR #3 or deploy `ezkart.id`. The separate month of financial
validation and explicit final production-release decision remain recorded in
[production-release-gates.md](production-release-gates.md).

Business approval is owner-confirmed. The owner also confirmed approval for all
needed services, including payments, Sub-Account and Kirim DOKU payouts. Technical
registration, credentials and working provider contracts still need evidence.
The owner clarified that the target is **live DOKU on workbench**. The current
deployment still uses sandbox, with central checkout and provider execution held;
that is the starting state, not the requested beta. Prepare separate beta storage
for real orders/payments, live provider credentials and supported adapters, while
preserving existing sandbox evidence. Main and `ezkart.id` remain held.

## Work required for the beta candidate

| Area | Implemented foundation | Acceptance still required |
| --- | --- | --- |
| Purchases and stock | Central immutable orders, atomic reservations, recoverable payment jobs, fulfillment and physical returns | Hosted cutover, legacy ownership/count reconciliation, full signed-in physical/digital purchase and failure journeys |
| Refunds | Purchase allocations, store decisions, buyer/store notifications and original delivery/return evidence | Provider-supported execution, unknown-result recovery, confirmed refund evidence, fee reversals, item access effects and reconciliation |
| Wallet | Balanced capture journal, seller enrollment and original provider balance/history receipts | Actual settlement/fee ingestion and corrections, delivery-plus-settlement release, reserves, negative balances, withdrawal reservations and verified payouts |
| Digital files | Immutable versions, private buyer grants, complete-download proof, reviews and full 500 MiB local transfer/recovery | Hosted signed-in and real-device transfers, storage monitoring/recovery, refund effects and subscription lifecycle |
| Store/customer operations | Persistent settings, customer workspace, consent, messaging, notifications, campaigns and reporting | Hosted fresh-seller/customer acceptance, actual enabled delivery and failure monitoring, domain/analytics acceptance and accessibility/mobile review |
| Operations | Private TEST database backups and restoration rehearsals, guarded deployment checks | Identified beta revision, recovery runbooks, monitored execution, alert ownership, sustained financial validation and final acceptance report |

Continue completing the full scope in
[commerce-completion-plan.md](commerce-completion-plan.md). Optional features are
not removed from that scope to make the checklist appear complete. A row here
is not a closed top-level gate.

## Financial policy now confirmed

- Seller earnings need both confirmed delivery and provider settlement. A verified
  complete download is sufficient digital delivery; access or a started response
  is insufficient.
- Confirmed refunds reverse Ezkart commission proportionally. Keep the original
  admin fee. Allocate against the original purchase and original fee snapshot;
  cumulative reversals cannot exceed the commission originally charged.
- The actual provider refund-processing fee belongs to whoever currently holds
  the proceeds. The boundary between an available wallet and completed seller
  payout is awaiting clarification. This charge allocation is not enabled.
- Seller withdrawals start at Rp250,000; Ezkart covers the seller transfer fee.
  Original payment fees, refund-processing fees and withdrawal fees are distinct.

## Current evidence and limits

The signed-in production DOKU dashboard was inspected on 27 September. Its
Service page shows active SNAP VAs for BJB, BNC, BNI, BRI, BSI, BSS, BTN, CIMB,
DOKU, Danamon, Maybank, Permata and Sinarmas. BCA SNAP is not in the active list;
it is offered unchecked under Add Service. Balance Management and Fund Connector
are unchecked and disabled in that dialog. The Sub Account list is empty. These
observations do not establish that the separately approved payout/Sub-Account
capabilities are technically provisioned.

The production API Keys page initially said the merchant public key had not
been set. A dedicated production public key is now registered and matched after
dashboard reload; its private half is stored outside the repository. Retrieval
of the existing secret is being completed through DOKU's own OTP prompt; no
secret is being rotated. DOKU's active VA configuration shows
SNAP 1.1, aggregator/DGPC, closed amount and an empty payment-notification URL.
No service or callback setting was changed during that inspection.
The empty Token URL is not itself a DGPC blocker: DOKU's
[integration guide](https://docs.doku.com/get-started/manage-business/set-up-integration)
requires that setting for DIPC.

The typed [BCA SNAP adapter](doku-snap-payments.md) now passes 25 contract/reader
cases and 15 wallet/signing regression cases. Its central dispatch, durable
callback and checkout wiring remain required before selecting it for real orders.

Implementation `56c6fab` is on workbench and TEST Worker
`32567d92-a27e-42f2-9ff5-9ecd27c2afdb`. Migration 0047 is installed with 144
application tables. Twenty-five Worker checks pass at 04:24:15 UTC and twenty-nine
hosted asset/access/guest checks pass at 04:24:18 UTC on 27 September. Existing
records, legacy evidence and holds remain intact; no migration is pending.
The read-only storage inspection correctly reports that the first ordinary
hourly maintenance run has not yet been observed. See
[digital-storage-operations.md](digital-storage-operations.md) and
[refund-requests.md](refund-requests.md).

The maximum-size buyer exercise uploaded 100 actual original parts, purchased the
file in an isolated fixture, recovered a lost halfway receipt without another
grant or retransferring verified bytes, and saved all 524,288,000 bytes with an
exact streamed hash. Order, stock and accounting remained unchanged by delivery.
The merchant exercise uploaded, resumed, published and saved a full-size original
file through the editor/PHP path. These use local R2 and isolated Chromium at
390px; they do not establish mobile-device or hosted network capacity. The full
checkout regression passes all 308 executed cases; its two opt-in capacity cases
were verified separately.

One explicit shared-Chrome reconnect succeeded on 27 September. The existing
TEST merchant session and owner-approved DOKU dashboard session are accessible;
signed-in hosted acceptance and provider configuration review are in progress.
No beta invitations, real payment/refund/payout, production deployment or main
push are established by this readiness record.
