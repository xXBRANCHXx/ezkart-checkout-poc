# Central fulfillment and courier recovery

Prepared on `agent/ezkart-workbench`, September 2026. This is one part of the
[workbench completion plan](commerce-completion-plan.md), not an authorization to
enable central checkout or release production.

## Merchant and customer behavior

Orders → **Fulfillment** opens a seller-scoped queue. Merchants can search by
reference or customer and filter preparation, transit, delivery, and exceptions.
The detail view shows the original items, paid delivery charge, saved origin and
destination, all shipment attempts, reported courier fees, and paginated events.
Viewers can read these records but cannot change them.

Only a paid, allocated, shippable order without a payment or fulfillment hold can
be accepted or booked. Pickup requires acceptance and complete saved addresses.
The merchant reviews addresses and package contents before requesting pickup.
The server rechecks membership, revision, payment and stock allocation in the
same transaction that records the action and its job. The browser saves the exact
action before sending it; a missing response, reload, or subsequent rejection
reuses its original key. Recovery requests remain separate for each order.

Cancellation requests cancel a **courier pickup**, not the paid order. A confirmed
cancellation allows another linked shipment with a new sequence/reference.
Carrier returns and cancellations never refund money or restore stock. Physical
return inspection and financial refund workflows have separate responsibilities.

Customer tracking reads the same shipment after verified, immutable ownership
checks. The public payment poll does not expose courier identities, proof links,
history, coordinates or customer contact details. Dated scans keep their provider
time; undated updates show when they were received. Repeated equivalent events
are condensed in the customer journey and retained in the merchant audit history.
Only coordinates supplied with dated courier scans become package locations.
Provider delivery-proof links are available to the authorized customer and seller.

## Data and ordering

Migration `0015_central_fulfillment.sql` adds acceptance/review fields and three
tables:

- `commerce_fulfillment_actions`: immutable actor, original revision, action,
  request hash, and receipt.
- `commerce_shipments`: one record per pickup attempt with an immutable order,
  seller, environment, sequence, reference, credential fingerprint and provider
  binding. A new attempt requires every earlier attempt to be cancelled.
- `commerce_shipping_inbox`: immutable normalized courier events with a separate
  monotonic receipt sequence and application acknowledgment. Unknown provider
  IDs remain pending until a verified pickup response binds them.

Provider status cannot move backward through completed milestones. Delivery may
advance into a return journey. A dated pickup after cancellation puts the order
under fulfillment review without replacing the current shipment attempt.
Fee and tracking fields have independent time markers; a delayed fee cannot
replace a newer fee simply because shipment status has not changed. Unsequenced
metadata can populate an empty value; an authoritative, revision-checked courier
read can correct it. The quoted customer charge remains unchanged.

An inbox drain applies at most 25 events for one provider ID in a transaction.
Concurrent updates use the order revision as their serialization boundary. A
provider GET response cannot replace an update committed after the GET started,
or skip an unapplied callback already in the inbox. The dispatcher also drains
up to five matched provider backlogs before and after its job pass.

## Courier execution

`cart/api/commerce-fulfillment.php` uses the order's frozen origin, destination,
service, prices, quantities and weights. It does not rebuild the package from the
current catalog or current global warehouse configuration. API credentials remain
server-side. Their SHA-256 fingerprint is bound before the first provider request;
recovery with a changed credential stops for review rather than creating a pickup
in another account. Fingerprints are not returned to the merchant/customer UI.
Credential rotation for outstanding shipments needs a verified operator procedure;
automatic credential rebinding is intentionally not implemented.

Biteship documents a unique `reference_id` and duplicate-reference error
`40002060`. Recovery reuses the original reference. A duplicate error's provider
ID is retrieved and its `reference_id` checked before binding; an ID alone is
insufficient evidence. A missing reference in a successful create response also
requires that verified read. See [Create an Order](https://biteship.com/en/docs/api/orders/create)
and [Retrieve an Order](https://biteship.com/en/docs/api/orders/retrieve).

Known bound shipments never trigger another create request. A crash between
provider binding and saving its first event recovers through a provider read.
If an unresolved creation has no provider ID and the order is now on hold, its
reconciliation job remains visible but performs no new create request.

Cancellation reads the original shipment before using Biteship's documented
`POST /v1/orders/:id/cancel` with a reason. A lost cancellation response is checked
with GET before another cancellation is considered. A courier already past pickup
produces an explicit operation exception. See [Delete an Order](https://biteship.com/en/docs/api/orders/delete).

Authenticated `order.status`, `order.price` and `order.waybill_id` callbacks enter
the inbox even if creation has not yet returned. A price event needs the total
`price`; an omitted total is not inferred from `shippment_fee` or replaced with
zero. Receipt time is never represented as a provider timestamp. See
[Webhook overview](https://biteship.com/en/docs/api/webhook/overview).

## Routes and scheduled execution

Merchant routes are authenticated `GET /v1/fulfillment`, `GET /v1/fulfillment/:id`
and `POST /v1/fulfillment/:id`. The PHP proxy keeps the existing session and CSRF
checks. A POST carries `requestKey`, `revision`, `kind`, and an optional `note`.
Kinds are `accept`, `pickup`, `cancel_pickup`, and `refresh`. Tracking refreshes
are limited to one new request per shipment per two minutes.

Signed internal routes are:

- `GET /internal/commerce/shipments/:id?environment=...`
- `POST /internal/commerce/shipments/:id/account`, `/bind`, and `/refresh`
- `POST /internal/commerce/shipping-events` and `/shipping-events/drain`
- `POST /internal/commerce/orders/:id/tracking` with the verified customer ID
- Existing job claim/finish endpoints for `shipment.create`, `shipment.cancel`,
  and `shipment.refresh`

`php tools/commerce/fulfillment-dispatch.php --once` processes at most five
reconciliations and five executions, claiming one fresh 120-second lease at a
time. HTTP invocation returns 404. A pass exits 2 for unresolved or dead work,
1 for an execution failure, and 0 when the work it processed succeeded. Exit 0
does **not** establish that exhausted jobs or unmatched inbox events are clear;
the scheduler must monitor those backlogs separately.

Successful create/cancel/refresh jobs require the corresponding persisted courier
evidence. Timeouts, malformed success, mismatched identities, missing storage
acknowledgments and lost responses remain uncertain. A lease expiring is not
permission for an ordinary retry. Existing maximum attempts remain in force;
exhausted work is visible in the merchant attention queue and needs operator review.

## Controlled beta activation

The central beta path uses seller shipping settings and the existing order/job
store. Booking and cancellation require both PHP
`EZKART_COMMERCE_FULFILLMENT=enabled` and Worker
`COMMERCE_FULFILLMENT=enabled`; beta defaults to held. A hold leaves callbacks,
owned tracking reads, existing action replay and tracking refresh jobs available.
The dispatcher does not consume create/cancel attempts while held. Resumption
keeps the original references. See [the shipping activation procedure](beta-shipping-readiness.md)
for settings, account funding/entitlement facts and focused local evidence.
Actual booking and delivery observation occurs during controlled beta; local
fixtures do not represent a live pickup or delivery. Public main release remains
held independently.

The implementation currently books one whole-order package per attempt. Split
shipments, package dimensions/insurance options, scheduled pickup selection,
label printing and return-label operations still need their product workflows;
they are not implied by this adapter.
