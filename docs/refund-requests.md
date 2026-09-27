# Purchase-linked refund requests

Workbench implementation, 27 September 2026. Buyers and store editors can open
refund requests against original paid purchases. The store can approve or decline
the exact request; the buyer can withdraw it before a decision. This implements
request allocation and review, not provider execution, refunded-payment evidence,
financial reversal or digital entitlement revocation. Central checkout remains held.

## Original amounts and decisions

Each request binds one original central order and its full primary verified IDR
capture. Item amounts are positive whole rupiah, capped at the original unit price
times quantity. Shipping is a separate amount capped at the original shipping
charge. Physical and digital items can share a request; subscriptions are excluded.
A request can cover some of an item's price or only shipping. Return inspection
and stock adjustments remain in the separate physical return workflow.

Requested and approved amounts reserve the original purchase allocation. The
transaction checks every item and shipping amount against all existing active
requests, so concurrent attempts cannot overclaim. Decline and withdrawal release
that allocation without deleting history. A catalog price change, file replacement
or archived product cannot change the purchased amount. At most twenty new
requests per order per hour are accepted; exact retries do not spend another slot.

There is no automatic refund policy or delivery prerequisite for opening a request:
an undelivered item or unreadable file can be reported. Approval accepts the exact
amount requested. It cannot silently reduce that amount or mark money returned.
Payment-review holds and orders already marked partly/fully refunded require
support review until actual refund evidence and allocations are integrated.

## Authority, history and recovery

Buyer access uses the permanent verified order owner. Submitted email addresses,
account fields and identifiers cannot transfer ownership. Store access requires
current active membership; viewers are read-only. Only the store can approve or
decline. A buyer can withdraw a requested case; a merchant can withdraw only a
request that merchant originally opened. Approved cases retain their allocation
pending the separate processing lifecycle.

Migration 0045 adds three tables and fifteen indexes/triggers. Original requests,
item allocations and actions are immutable. Inserting a request projects all
items in the same transaction. Inserting a decision checks current order state,
membership and revision before updating its projection. Direct edits, deletes
and replacement writes are rejected. A failed projection leaves no orphan request.

Request keys belong to the authenticated actor, and request hashes include the
original details, order, action and environment. Exact retries return the current
saved case; an older retry cannot undo a later withdrawal or decision. Queues
use a fixed initial sequence boundary and scoped cursors. Browser responses omit
capture IDs, actor account IDs, request keys and hashes.

Both PHP proxies revalidate account, session, store/ownership and environment.
Writes require same-origin CSRF protection. After network work, a changed session
suppresses even a successful late response. Paths, filters, JSON fields and body
sizes are bounded; ambiguous JSON and duplicate query keys are rejected.

The buyer section is on order tracking; the merchant Refunds workspace is linked
from Orders. Both use the shared dropdown control. Before submitting, the browser
saves and reads back an account-scoped recovery record with a SHA-256 checksum.
A browser lock serializes confirmation across tabs. Reloads and lost responses
recover the same original body and key. Unavailable or damaged storage stops new
writes. An uncertain result keeps controls locked to that request. A definite
conflict requires reviewing saved state before changing the request; creation
draft amounts and explanation survive that review. Session changes hide details
and preserve the pending retry for the original account.

## Verification and acceptance

Eight API cases cover allocation races, original amounts, exact recovery, live
authorization, stale decisions, direct mutation guards, projection rollback,
strict input, fixed paging and rate limits. Five PHP/browser cases cover desktop
1360px/mobile 390px buyer and merchant journeys, lost replies across reloads,
stale approval, damaged/unavailable storage, forged scope and late session changes.
Original accounting entries, stock, payment state and download access stay intact.

The financial journal, digital download and order-manager regressions pass with
these cases (35 cases). Fifteen existing buyer review and digital checkout cases
also pass. The affected PHP/JS syntax, diff and TEST Worker dry-run checks pass.
Both desktop and mobile layouts were visually inspected. These are isolated
fixtures; no provider refund was requested or accepted.

The fresh private TEST backup is 680,604 bytes, SHA-256
`342329c6a6df53b170e3a7282b91bbc1a3328dcfd9301c15f63d342b6ba75726`.
It restores every existing record in 141 physical tables with clean integrity and
foreign-key checks. Migration 0045 adds eighteen objects and changes none of the
existing objects. All 351 captured compatibility plans compile against the restore.

Still required: notification delivery for these requests, return/dispute evidence
integration, owner-authorized execution with fresh financial verification,
provider capability and amount checks, unknown-outcome recovery, verified refund
receipts, fee/ledger reversals, precise digital-access effects, and reconciliation.
Approval never creates a provider job that could execute later without that
separate authorization and evidence contract. Signed-in hosted acceptance and
all wider commerce, provider and production-release gates remain open.
