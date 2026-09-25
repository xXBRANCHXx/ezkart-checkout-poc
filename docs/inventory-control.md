# Inventory control

Inventory lives in D1. The merchant workspace at `?page=inventory` reads physical
products and variants, including hidden options, and shows on-hand, reserved and
available quantities separately. A product with variants contributes its options
once; its calculated display total is not another stock item. Archived products
remain countable through the archive filter. Digital/subscription products are
excluded from physical counts.

## Merchant workflow

Choose physical count, stock received, damaged stock, lost stock, record
correction or alert threshold. Enter quantities only for checked items; untouched
rows remain blank. Counts/corrections set a total. Receipts add units. Damage/loss
remove units and require an explanation. Alert edits change the stored threshold
without changing stock. The default threshold is 15 available units.

Up to 100 selected items form one atomic adjustment, even across pages. The review
shows before and after values. Every product revision is checked before any line
changes. Stock cannot be reduced below active reservations. A stale count retains
its entries and asks the merchant to review current quantities. Refreshed data
does not silently replace the count's original versions.

A count draft autosaves to the authenticated merchant's account and can be resumed
on another device. Draft writes use a separate version. Clearing or submitting
retains a version tombstone so an old tab cannot overwrite a newer draft. Conflicts
keep local entries available until the merchant reloads the saved draft. A lost
successful draft-save response can be retried with the same version and content.

Every submitted adjustment has a stable request key and immutable receipt. A
network failure with an uncertain outcome locks the attempted payload for retry;
retrying the same request returns its existing receipt rather than applying the
quantity again. Changing a previously used key's content is a conflict. Viewers
can inspect quantities and history but cannot modify counts, drafts or thresholds.

## Audit history

Migration `0011_inventory_adjustments.sql` creates immutable stock movements and
adjustment receipts, configurable per-option policies, and versioned account
count drafts. Opening rows identify the pre-existing catalog balances and do not
claim a physical count was performed.

Application catalog create/edit/duplicate/delete writes log each physical option
inside the same D1 batch as the catalog mutation. Payment consumption records its
movement inside the reservation transition. Manual changes record the actor,
reason, note, before/after quantities and reference. History is seller-scoped and
uses cursor pagination. Deleting a product preserves its past movements; deleted
option history is also retained. Direct database maintenance is outside the
application workflow and requires a separately recorded operational change.

## API

The normal merchant JWT and seller membership authorize these routes:

- `GET /v1/inventory`: `q`, `status=active|archived|all`,
  `level=all|low|zero`, `limit=1..100`, and the returned opaque `cursor`.
- `GET /v1/inventory/history`: optional `product`, `variant`, numeric history
  `cursor`, and `limit=1..100`. An empty variant selects the product's base option.
- `GET|PUT|DELETE /v1/inventory/draft`: writes include `revision`; PUT also
  includes `payload`. A cleared draft can return its revision with `payload:null`.
- `POST /v1/inventory/adjustments`: `{requestKey, kind, note, items,
  draftRevision?}`. Each item supplies `{productId, variantId, revision, quantity}`.
  A supplied draft version must still match when the adjustment commits.

The PHP proxy permits only these inventory paths and named query parameters.
Writes require the merchant session, CSRF token and the existing MFA gate. The
catalog status PATCH route now passes those same checks; it previously could not
pass through the proxy at all.

## Paid orders needing stock

Late payment after expiry/cancellation retains its verified payment while
fulfillment waits in `stock_review`. The inventory page now lists these orders
and compares every original order item with current physical stock, its catalog
identity, reservations and availability. A note and explicit confirmation are
required. A shortage, missing original option, payment concern, stale order or
changed product version prevents allocation. Renamed, hidden or archived options
can fulfill an existing paid promise when their original identities still exist.
Another SKU is never silently substituted.

Migration `0012_stock_review_recovery.sql` adds immutable resolution receipts and
one-use allocations. An allocation consumes all original quantities together,
records stock movements, advances product/order versions and queues a recovery
notification. Original released reservations remain unchanged. Database guards
protect other checkout holds and roll back the entire allocation on any shortage.
One resolution per order plus request-key replay protects both concurrent clicks
and lost responses. Notification dispatch is still a separate unfinished task.

The merchant proxy supports `GET /v1/inventory/reviews?limit=20&cursor=...` and
`GET|POST /v1/inventory/reviews/:orderId`. POST includes `requestKey`, order
`revision`, `note`, `confirmed:true`, and every original `orderItemId` with its
reviewed `productRevision`. Viewer accounts can inspect but cannot allocate.
The write requires central commerce to be enabled. Failed reads can be reloaded;
conflicts retain notes and require a new confirmation. Uncertain writes retry
the identical payload, including successful responses whose JSON was truncated.
Inventory requests have bounded timeouts. Allocation does not refund a payment,
book a courier, mark delivery or make wallet funds available.

## Verification and remaining commerce work

D1 tests cover seller and role isolation, concurrent request replay, entire-batch
rollback, reservation floors, stock-version conflicts, multi-device drafts and
cleared-draft races, immutable history, payment consumption, pagination, hidden
options and a complete 100-option count. Browser tests cover saved-draft reload,
stale-count review, uncertain-response replay, read-only access, protected PHP
proxy requests and desktop/mobile interaction. Mobile stock/history use readable
cards and keep review available while scrolling.

Central PHP checkout has not yet been cut over. Recovery allocation has D1 and
browser coverage, including competing paid orders, entire-order rollback,
original option identity, role/seller isolation, stale reviews and lost responses.
Hosted paid-order recovery awaits that cutover. Returns, order-linked restocking
and the refund alternative for unfulfillable orders remain outstanding. A manual
receipt must not be treated as proof of return inspection, customer refund or
settlement. The full workbench goal and production hold remain in force.
