# Returns and physical inspection

This stage implements customer/merchant return requests and audited physical
intake for central commerce orders. It does not complete the refund, return
courier, dispute, settlement, or central checkout rollout. Test writes remain
behind `COMMERCE_STORAGE=d1`, which is still disabled on the hosted test service.
The separate [refund request workspace](refund-requests.md) records original
purchase amounts and store decisions for physical and digital items. Approval
does not issue money or substitute for this physical inspection history.

## Request and intake rules

An eligible order has a recorded order-payment capture and consumed inventory.
Customers can request returns after confirmed delivery. Store editors can also
open a case for a courier return (`return_in_transit` or `returned`). Late paid
orders whose stock was never consumed cannot generate a restock credit.

Requests select original order item IDs and quantities. Across all cases, active
requests reserve their requested quantities. Declined, withdrawn, or closed
intakes retain only quantities already received. A received unit can never be
returned a second time. Customer notes and original order snapshots stay immutable.

| State | Allowed next step | Stock effect |
| --- | --- | --- |
| Requested | Store approves or declines; buyer/store withdraws | None |
| Approved | Store records a partial/full inspection or closes unused intake | Only inspected saleable units can be added |
| Receiving | Store records another partial/full inspection or closes unused intake | Only newly inspected saleable units can be added |
| Inspected | Physical intake is complete; financial decision remains separate | No further intake |
| Declined / withdrawn | Request history retained; unused allowance released | None |
| Closed | Remaining intake stopped; received units permanently retained | Existing inspection movements remain |

An inspection requires a private note and confirmation that the goods were
physically received. Each line records **received now** and **restock now**;
their difference is kept out of saleable stock. Zero-arrival lines are omitted.
The merchant may record receipt of a missing original catalog option, but may
not substitute another SKU to restock it. Renamed, hidden, and archived original
options keep their identities. Hidden variant stock is not added to the visible
parent total.

Restock writes, immutable inspection/action receipts, product stock movements,
case/order revisions, and the notification job commit in one D1 transaction.
Case/order/product versions reject stale reviews. Every operation has a durable
request key; retries return its existing result without another stock addition.
An old product editor or inventory count cannot overwrite a return restock.

The merchant's public message is visible in the customer's return history.
Private inspection notes, stock versions, stock balances, and warehouse receipts
are excluded from customer responses. Inspecting a parcel does not change the
payment state, mark a refund paid, release wallet funds, or book a courier.

## Ownership and authorization

Migration `0013_returns_and_inspection.sql` adds immutable order ownership bindings,
return requests/items/actions/inspections, and database guards. It also prevents
mutation of original central-order customer and shipping snapshots. A future
delivery correction must be a separate audited record, not an overwritten snapshot.

The signed PHP service can claim a guest checkout for a server-verified Google
identity whose verified email matches the original order. An original checkout
account ID takes precedence over email. A successful claim is immutable; a second
account cannot take it by matching an email later. A browser JWT's email alone is
never sufficient to claim a guest order.

Customer routes require the bound account or the original checkout account.
The customer PHP proxy checks the verified session, CSRF/origin for writes, and
the source Google/MFA session for borrowed logins. It keeps tokens server-side,
signs only its trusted session identity, and rechecks the customer session before
returning private data. A sign-in change after a write is an uncertain result,
not proof that the write failed. Store viewers can read but cannot create or
change cases; database writes recheck active store membership.

## API and screens

- `POST /internal/commerce/orders/:order/claim`: signed service only, with the
  deployment's commerce environment and trusted customer ID/email.
- `GET /v1/returns`: merchant queue, `state=open|all|<state>`, `limit=1..50`, and
  cursor pagination. Includes seller identity and write availability.
- `GET /v1/returns/orders/:order`: original items and remaining return allowance.
  `POST` creates a request with `requestKey`, `orderRevision`, `reason`, `note`,
  and original `items[{orderItemId,quantity}]`.
- `GET /v1/returns/:return`: case, items, permitted actions and history.
  `POST` takes `requestKey`, case `revision`, `orderRevision`, `kind`, and the
  customer-facing `message`. Inspection also requires `privateNote`, `confirmed`,
  and `items[{orderItemId,received,restocked,productRevision}]`; a product revision
  is required only for a positive restock quantity.
- Customer equivalents are `/v1/customer/orders/:order/returns` and
  `/v1/customer/orders/:order/returns/:return`, with create and withdrawal only.
  The list includes original order eligibility and pages of 25 requests.
- History pages contain at most 50 actions, newest first; `historyCursor` is
  passed as `before` to retrieve earlier actions. Quantities always represent
  the current case, not a historical balance reconstructed from one history page.

The workbench Orders page links to Returns. Its queue, request form, partial
inspection form, and history adapt to narrow screens. The buyer section is
mounted on order tracking when central commerce is enabled, outside the visual
tracking sandbox. Both use the universal dropdown controls and render messages
as text. API errors can be reloaded without discarding inspection entries;
updated inspections require confirmation again.

Before sending a write, each browser tab preserves its exact pending request in
session storage, scoped to seller or customer/order identity. A timeout,
unreadable successful response, or later loss of authorization during a retry
keeps that key and payload for confirmation. The UI blocks another operation
until the outcome is resolved. This protects ordinary reloads in the same tab;
it is not a cross-device draft service. The server's request records remain
authoritative even if browser storage is manually cleared.

## Verification and remaining acceptance

Local D1 tests cover guest ownership races, original-account precedence, spoofed
JWT email, signed-service authorization, seller/customer/viewer boundaries,
unpaid/unconsumed/ineligible fulfillment states, request replay and quota races,
partial inspections, kept-out quantities, immutable records, action/history
pagination, missing/hidden/archived catalog options, stock-edit conflicts,
whole-batch rollback, and claimable notification jobs. Delivery state in these
tests is explicitly a local fixture, not provider delivery evidence.

Browser tests cover both request workflows, review/approval/inspection/withdrawal,
read failures, stale versions with retained inputs, mobile layouts, unreadable
successful responses, tab reload recovery, and authorization loss during retry.
The PHP proxy tests verify signatures, trusted identity, CSRF/origin, borrowed
Google sessions, and private token handling. Screenshots are inspected locally.

Hosted paid-order return acceptance still requires the checkout, legacy migration,
fulfillment events, and dispatcher cutover. Return shipping labels/tracking,
evidence attachments, configurable return windows/policies, financial refund
approval/execution/reconciliation, customer disputes, and notification delivery
remain unfinished. They are part of the full workbench scope, not optional
exceptions. No production release or DOKU readiness is certified by this stage.
