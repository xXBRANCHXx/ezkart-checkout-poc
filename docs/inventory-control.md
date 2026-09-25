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

## Verification and remaining commerce work

D1 tests cover seller and role isolation, concurrent request replay, entire-batch
rollback, reservation floors, stock-version conflicts, multi-device drafts and
cleared-draft races, immutable history, payment consumption, pagination, hidden
options and a complete 100-option count. Browser tests cover saved-draft reload,
stale-count review, uncertain-response replay, read-only access, protected PHP
proxy requests and desktop/mobile interaction. Mobile stock/history use readable
cards and keep review available while scrolling.

Central PHP checkout has not yet been cut over. Returns, order-linked restocking
and late-payment stock-review resolution are still outstanding. A manual receipt
must not be treated as proof of return inspection, customer refund or settlement.
The full workbench goal and production hold remain in force.
