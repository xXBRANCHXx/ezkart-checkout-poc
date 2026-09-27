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

## Isolated live beta foundation

The new deployment label `beta` uses production providers while keeping public
links on `test.ezkart.id`. It has its own API hostname, service-signature scope,
order-file namespace and default merchant/customer session directories. PHP
rejects TEST/main API URLs and mismatched Worker health responses. Sandbox
credentials and the legacy Executive mode switch cannot change beta's provider
mode. Campaign, email, unsubscribe and shop links retain the workbench origin.

The APAC D1 database `ezkart_beta_database`
(`27bb47cf-c0f0-463c-94e3-44b9b27edcf4`) and buckets `ezkart-beta-public` and
`ezkart-beta-private` are created. All 47 migrations are installed with 144
application tables, zero sellers/orders/captures and no pending migration.
Both buckets report zero objects; the private bucket keeps the default seven-day
incomplete-upload abort rule. The private 420,929-byte baseline export, SHA-256
`3734158dc4fb41d7a4b8acf5f66d6e045b75d8d1e9f4d6fb6b06a70a19be7a4a`,
restores with clean integrity and foreign-key checks. Remote foreign keys are
also clean. TEST/main resource bindings are preserved; no sandbox history was
copied into the real-payment database.

The beta configuration keeps commerce held and has no scheduled provider or
email work. Creating these resources does not cut over the hosted frontend.
Still required before that cutover: owned catalog/settings/assets preparation,
configured/accepted SNAP channels and callback delivery,
hosted private credentials and provider jobs, Executive/operations access and
signed-in merchant/customer acceptance. Existing operator commands restricted
to TEST must gain explicit beta support before they are used for live recovery.

The first beta implementation `c48f178` is pushed to workbench. Its Worker was
deployed at `https://ezkart-api-beta.vincentbranch23.workers.dev`, initial version
`2eeb80ab-a240-4c6f-ae2b-065ac1eb6675` after installing its dedicated private
commerce-service secret. All seven hosted infrastructure/access/hold/CORS checks
pass at 05:39:57 UTC on 27 September. PHP's real cURL health check confirms the
beta environment, all storage bindings and 144 tables. A private runtime-settings
fragment is prepared outside Git with live DOKU credentials and the beta service
secret; it is not installed on Hostinger. No live Biteship key is present in the
local runtime, so shipping credentials and Order API acceptance remain required.

The existing TEST Worker and hosted storefront still report their original TEST/
sandbox configuration, healthy data connectivity and `durable_checkout:false`.
Neither was switched to the new database by this rollout. Main and `ezkart.id`
remain held. No beta buyer, payment, capture, refund or payout was manufactured.

SNAP implementation `905e1aa` is now pushed and deployed to beta Worker version
`b19ccea0-7a24-461b-b6f8-eab602b2648b`. Migration 0048 is installed, bringing the
beta database to 146 application tables. Both new tables are empty; orders and
captures remain zero. The fresh pre-migration export matches the original
baseline. The post-migration 427,889-byte export, SHA-256
`3f6d7860d2f7c3b0ec438e87eaf49532dcd2bd7005dbe6c0bd56ce3775d8d88a`,
restores with clean integrity/foreign keys and every row in the original 144
tables unchanged. Remote foreign keys also pass. Eight beta health/access/hold/
CORS checks pass at 06:18:50 UTC. The Worker retains its dedicated secret,
commerce hold and empty schedule list.

Hostinger's automatic workbench deployment now serves the SNAP endpoint. Four
hosted checks pass at 06:21:06 UTC: GET is denied, a callback cannot acknowledge
while central checkout is held, the original TEST/sandbox data connection is
healthy with 144 tables, and checkout remains held. No TEST or main Worker was
deployed, and no hosted provider/storage mode was changed. Ninety-three relevant
implementation/regression cases pass across the recorded runs.

Verification includes dedicated PHP/Worker beta isolation and destination tests,
99 checkout/callback/admin/email regressions and 25 DOKU contract/reader cases.
The broader Worker checks exposed an old migration fixture using the new refund
column against schema 0035. Its historical seed now adapts only that absent null
field while retaining the old schema and database guards; preservation and the
affected transactional/campaign cases pass. The beta Worker dry run and PHP
syntax checks pass. None of these fixture captures are real provider payments.

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
dashboard reload; its private half is stored outside the repository. The existing
secret is now preserved privately after the owner completed DOKU's OTP. Live B2B
authentication passed at 05:26:29 UTC on 27 September. No secret was rotated or
exposed, and no payment was created. Only the ignored local runtime has these
credentials so far; hosted configuration is unchanged. DOKU's active VA configuration shows
SNAP 1.1, aggregator/DGPC, closed amount and an empty payment-notification URL.
No service or callback setting was changed during that inspection.
The empty Token URL is not itself a DGPC blocker: DOKU's
[integration guide](https://docs.doku.com/get-started/manage-business/set-up-integration)
requires that setting for DIPC.

The [BCA SNAP integration](doku-snap-payments.md) now includes central dispatch,
immutable request bindings, private receipts, the signed public callback and
checkout/payment-page wiring. Migration 0048 preserves the earlier payment
contracts and introduces two tables. Its dispatch grant cannot be replayed;
receipts and captures commit together, including callbacks that arrive before a
create reply. Existing checkout, financial journal and deployment checks pass,
alongside nine new Worker and ten PHP/HTTP/browser cases. Actual channel and
callback acceptance, hosted configuration/cutover, financial settlement and
provider-supported uncertain-result recovery remain required. The flow is not
selected in any hosted runtime.

Implementation `56c6fab` is on workbench and TEST Worker
`32567d92-a27e-42f2-9ff5-9ecd27c2afdb`. Migration 0047 is installed with 144
application tables. Twenty-five Worker checks pass at 04:24:15 UTC and twenty-nine
hosted asset/access/guest checks pass at 04:24:18 UTC on 27 September. Existing
records, legacy evidence and holds remain intact; no migration is pending.
The first ordinary hourly storage-maintenance run completed at 05:17:33 UTC
with zero selected files, zero failures and no inspection warnings. See
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
