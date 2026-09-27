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
deployment now uses the isolated live beta configuration described below, with
new checkout and scheduled jobs held. Existing sandbox evidence is
preserved. Main and `ezkart.id` remain held.

## Current hosted state — 27 September, 07:49 UTC

Hostinger's private runtime now selects `beta`, production providers and the beta
Worker. Its live DOKU client, secret, signing key and verified parent profile are
installed outside the public root with mode 0600. Reloaded file hashes match the
private prepared configuration; all earlier provider credentials are preserved.
Health confirms beta, live DOKU credentials and connected D1/public R2/private R2
with 146 tables. At 07:45 UTC, central merchant operations were enabled with
`commerce_storage=d1`; new checkout remains separately paused in both PHP and
the Worker. The public checkout configuration returns 503 with `Retry-After: 300`.
An hourly housekeeping schedule is now installed; new checkout, provider
dispatch schedules and email sending remain held. See the storage note below.

A dedicated live Biteship key is now installed in the private hosted runtime and
prepared local settings. At 07:19 UTC its read-only `GET /v1/couriers` succeeds
with 81 courier services. At 07:30 UTC, Biteship approved Order API activation
using the account's original delivered/cancelled sandbox evidence and the store's
configured JNE, J&T and SiCepat couriers. Rates, Order and Tracking all remain
active after reload. No new test or real shipment was created for activation.
The dashboard's live balance is zero; funding and a real shipping journey remain
acceptance gates.
The authenticated live webhook is registered and verified after reload at
07:24 UTC for `order.status`, `order.price` and `order.waybill_id`, targeting the
workbench production callback. No shipment or real delivery was created.

The beta catalog import is complete: five users/stores/memberships, two physical
products, 111 variants, 54 media records, 16 product images, two unbound drafts
and existing address/shipping settings. All 54 original images (1,391,714 bytes)
were copied and verified by SHA-256. Existing triggers stayed enabled; ordinary
catalog revisions advanced, while prices, stock and other catalog fields remained
exact. Beta has 111 explicit opening-stock records and five import audit events.
No TEST orders, financial history or historic stock movements were imported.

The fresh post-import export has SHA-256
`d375aa7e373fcecb222b46d7983d2256a0dd657fabbc069dcc2d20ab83aad90e`.
Every application table matches the rehearsed import, all 146 tables and their
guards are preserved, and remote/restored foreign keys and restored integrity
pass. Orders, captures, seller wallet profiles and money journals remain zero.
Private source/target exports, the guarded SQL and asset/bootstrap/cutover proofs
are in `/home/branch/.local/share/ezkart/beta-01a0d643/` outside Git.

Fresh hosted sign-in exposed a CSP regression: Chrome blocked the local form's
redirect to the configured Auth service. The fix permits only that exact HTTPS
origin and Google for form redirects. Three browser/header cases pass, including
the actual form/redirect chain, blocked foreign destinations, inline/eval guards
and preview isolation. The beta login label now says “Beta admin.” Implementation
`9148660` is pushed and auto-deployed. The owner completed the authenticator
challenge; fresh hosted sign-in now reaches the beta dashboard with two products
and zero orders. Further signed-in merchant/customer acceptance remains open.

The email investigation CLI now supports beta/production while preserving TEST
intent compatibility. Its recovery fingerprint binds the deployment, API and
service secret. Five existing transactional/campaign cases and the added beta
case pass, including lost acknowledgements, reuse of the original receipt and
rejection of another mode/connection before a provider read. Sending remains held.

The new checkout pause is separate from central merchant operations. PHP
`commerce_checkout=held` and Worker `COMMERCE_CHECKOUT=held` prevent new orders;
beta requires an explicit `enabled` setting in both layers to reopen sales.
Original checkout recovery and verified payment callbacks remain available.
The guard runs before provider requests or new reservations, including through
the legacy entry point. Merchant settings and marketing reads continue working.
Four focused cases and the checkout/SNAP/beta regressions pass (30 distinct
cases across the focused and regression runs). Desktop and 390px checks include
the pause and recovery of an existing paid order without provider calls.
The beta Worker build and PHP syntax checks pass. Hosted deployment of this
separate pause is complete: implementation `017e445`, Worker version
`a87edd2b-3903-4de8-859d-226611a0443e`, private hosted settings SHA-256
`ceb4a14bd26fabd00c0cd19e0de67e92fdb92e767a6c2ffb09e24328c677a4a4`.
An authenticated central resume read succeeds without creating an order.
Orders, captures, wallet profiles, financial journals and jobs remain zero.
The original TEST/main bindings and provider credentials are preserved.

The freshly authenticated owner opened Dashboard, Orders, Customers, Analytics,
Marketing, Payments, Messages and Settings against beta with no JavaScript or
HTTP errors and no desktop overflow. A store date-format change was saved,
verified after reload, restored and verified again; both versions appear in
the store history. Products, Shipping settings, Shop and Advanced also load.
These checks are not acceptance of real purchases or provider money movement.

The active store currently has no pickup/return address or public support
email/phone. The owner has been asked for those actual details. Both imported
products also lack descriptions, and imported stock needs a physical count
before sales. DOKU BCA still shows UPDATING after fresh login at 07:44 UTC.
The catalog's obsolete CV-approval and delivery-readiness claims are replaced
with the actual checkout pause and links to inventory/payment/shipping settings.

At 390px, Orders, Customers, Marketing, Messages, Settings and Shipping settings
load without JS errors, visible alerts or page overflow. The corrected product
status strip is auto-deployed and matches the pause on desktop and narrow screens;
its layout is also visually checked in an isolated browser. Shared Chrome's
screenshot capture timed out, so the hosted narrow checks use DOM/layout evidence.

The storage inspector now accepts explicit `--deployment=beta` while retaining
TEST as its default and rejecting main or ambiguous arguments. Its two focused
cases pass. Live beta reports zero uploaded/retained/unavailable files and no
cleanup backlog. Cloudflare's free-account cron limit initially blocked beta's
housekeeping. An inactive TEST email trigger was verified against the deployed
version and reassigned to beta's hourly `:17` housekeeping; the application
versions and stored TEST evidence are unchanged. The first beta maintenance
heartbeat remains pending. See [storage operations](digital-storage-operations.md).

The sections below retain earlier rollout observations; this current-state
record supersedes their historical “not installed” and empty-catalog statements.

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

The live parent balance inquiry passes at 06:31:01 UTC on 27 September with an
exact match to the merchant's own business profile. DOKU returns numeric cash and
point account IDs and no parent pending account. The reader, wallet registration
and original-evidence validators now support exact integer IDs while retaining
strict two-account seller confirmation. Forty-nine affected PHP/Worker checks
pass. Migration 0049 changes one evidence trigger; rehearsing it on the fresh
beta export preserves all 146 tables and six original rows, with clean integrity
and foreign keys. The verified parent is prepared privately for beta; hosted
runtime, payment mode and commerce holds remain unchanged. This is read-only
provider evidence, not acceptance of child registration, routing or payouts.

Implementation `2bdb73e` is pushed to workbench and deployed to beta Worker
`993f0482-1d8c-423f-a989-c7ddd0458136`. Migration 0049 is installed. The private
428,088-byte post-export, SHA-256
`6f28aa3655945bd47bb6bd224f9f609e65be81afbc2983a77dd227cbacc19204`,
restores cleanly and preserves every original row. Remote foreign keys pass;
orders, captures and seller wallet profiles remain zero. Four hosted beta health
and commerce-hold checks pass at 06:39 UTC.

The signed-in production DOKU dashboard was inspected on 27 September. Its
Service page shows active SNAP VAs for BJB, BNC, BNI, BRI, BSI, BSS, BTN, CIMB,
DOKU, Danamon, Maybank, Permata and Sinarmas. BCA SNAP is not in the active list;
it was offered unchecked under Add Service. Its activation request was submitted
at 13:36 Jakarta and now shows **UPDATING**, with no assigned BCA configuration
yet. DOKU's [service activation guidance](https://docs.doku.com/get-started/manage-business/activate-services)
identifies this status as requiring provider review when it persists.
Balance Management and Fund Connector
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
