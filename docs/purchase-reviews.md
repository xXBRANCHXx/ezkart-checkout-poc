# Purchase reviews: buyer, merchant and public workflows

The buyer workflow on order tracking, merchant review workspace, public shop
review browser and product-editor ratings are implemented. Controlled PHP/browser
acceptance passes; signed-in hosted acceptance remains outstanding. The wider
customer-operations completion gate remains open. The existing central-commerce
flag controls review writes and buyer controls; these deliveries do not enable
checkout or providers.

## Purchase and identity

One review belongs to one original order item. New reviews require a physical
product, a central order, its full primary verified payment capture, committed
inventory or a recorded recovery allocation, and an account-bound courier
shipment with delivery evidence. Skipped sandbox shipping and a courier return
without delivery do not qualify. Refunds or returns after delivery do not erase
the buyer's experience. Digital and subscription eligibility awaits their real
delivery workflows.

Migration 0022 adds permanent `commerce_shipments.delivered_at`. Accepted delivery
events preserve that time across later returns. Dated history from a verified read
of the same bound shipment can establish an earlier delivery without rewinding
the current status. The migration backfills currently delivered, provider-bound
shipments; it does not guess delivery for old returns. Later updates cannot remove
or replace the saved delivery time.

Buyer authorization uses the permanent order claim, falling back to its original
authenticated checkout identity. Matching a customer master record or a token's
email is insufficient. The PHP proxy revalidates the current Google identity,
confirmed email and MFA on every request, then claims a guest order through the
signed service if needed. The Worker receives the verified user's bearer token.
Browser identity/environment fields are rejected. CSRF/origin, session-version
checks before requests and a final session check prevent writes or disclosures
from a page belonging to an earlier login. Borrowed merchant sessions are
revalidated without copying their tokens into the customer session.

## Content and changes

Ratings are integers from one to five. Titles allow 120 characters, body text
3,000, and public names 50. The buyer explicitly chooses their public name;
checkout contact details are never copied into it. A review may contain up to six
photos. Verified reviews publish automatically at every rating. Historical reviews
keep their existing visibility and remain unverified, including after approval.
Historical text is preserved even when it exceeds the newer submission limits.

The existing `product_reviews` table is a projection of immutable
`commerce_review_changes`. Revision compare-and-swap, request hashes and per-actor
request keys make retries safe. Inserting the receipt applies the entire review
transactionally. Ownership, purchase eligibility, active merchant membership,
content authorship and photo attachment are checked inside database triggers.
Direct changes/deletions are blocked. Products with reviews must be archived
instead of deleting their history. Migration 0022 adds three tables and 14 guards.

A buyer can edit, withdraw, and republish their review. Merchants can reply,
remove a reply, hide with a structured reason and buyer-visible explanation,
restore visibility, or approve a pending historical review. Merchant actions
cannot alter buyer text, stars or photos, or republish a buyer withdrawal. A reply
records the content revision it answers: after a buyer edit, an older reply stays
in private history but disappears publicly until the merchant updates it.
Buyer edits do not silently remove an existing moderation decision.

Every retry returns its original receipt and the current review. Replaying an
older publication therefore cannot undo a subsequent withdrawal. History includes
every revision, with a fixed initial revision boundary for paging. It omits actor
account IDs, authentication tokens and request hashes/keys from browser responses.

## Photos

Browser uploads accept still JPEG, PNG and WebP, resize to at most 1,600 pixels
on the longest edge, and re-encode before uploading. The server independently
checks raster container structure and dimensions, rejects animation/active
formats, limits processed files to 1 MB and removes image metadata. Accepted
containers are not treated as proof that their depicted content is appropriate.

Photos are stored in private R2 with an owner, environment, original item, content
hash and retry key. At most 30 new uploads per account/environment/hour are allowed
transactionally; retries reuse their existing slot. Interrupted storage writes
retain an uploading record for retry. Draft uploads expire after 24 hours unless
attached to a review. `commerce_review_media_links` retains indexed attachment
history, including photos later removed from the public review.

Public image reads require the photo to be in the currently published review,
with an active product and store. Visibility is checked again after object fetch.
Hidden, withdrawn and removed photos stop being available from old public URLs.
Buyer/merchant reads remain scoped; image responses use `no-store` and `nosniff`.
There are no direct public R2 URLs. An attached image remains private evidence in
review history after withdrawal or moderation.

The existing hourly cleanup processes up to 100 unattached expired uploads per
run. A deleting state prevents later attachment. Objects are removed and deletion
is repeated for a 48-hour tombstone period to cover interrupted uploads; checked
timestamps rotate the batch so tombstones do not starve newer expired drafts.
Attached history is retained. This does not introduce an additional cron.

## Routes and reads

- `GET/POST /v1/customer/orders/:order/reviews`: original items/eligibility and
  buyer publication or withdrawal. Mutations take item, kind, revision and key;
  publication also takes rating, title, body, publicName and photos.
- `GET /v1/customer/orders/:order/reviews/:review/history`: bounded private history.
- `POST /v1/customer/orders/:order/review-media`: retryable image upload.
- `GET /v1/customer/review-media/:photo`: owner's private image, including drafts.
- `GET /v1/commerce/reviews`: seller/environment list with rating, photo, product,
  state, reply-needed, search and newest/oldest filters.
- `GET/POST /v1/commerce/reviews/:review`: merchant detail or moderated change.
- `GET /v1/commerce/reviews/:review/history` and `/:review/media/:photo`: private
  seller evidence. Viewer memberships cannot change reviews.
- `GET /v1/public/reviews?product=:product`: published list, rating distribution,
  exact rating sum and count, with rating/photo/date-order filters.
- `GET /v1/public/reviews/:review/media/:photo`: visibility-controlled image.

Public results exclude order references, private moderation, saved stale replies
and buyer identity IDs. Lists page up to 50 items using immutable creation time,
ID and an initial insertion boundary. Backdated new inserts do not join later
pages. Cursors bind to their seller/product, environment and filters. Existing
content and visibility remain live, so refresh includes intervening changes.
Overall published summaries stay distinct from filtered matching counts. Catalog
and storefront rating fields use the same visibility and environment rules, and
expose the original rating sum rather than rounded averages of product scores.

The buyer uses `/cart/admin/customer-reviews.php`, which validates its narrow
query contract and proxies bounded JSON bodies or private photo bytes. New Worker
review writes enforce actual streamed byte limits even without Content-Length.
The general signed-service request-size limit is unchanged.

## Buyer interaction and validation

The tracking screen supports keyboard rating choices, safe text rendering, photo
upload/removal/enlargement, edit, withdrawal and paginated history. Failed history
pages retain earlier results and their cursor. The original uncertain operation
stays in memory with its request key; controls remain locked until confirmation
is retried. Navigating away with a draft or pending operation prompts the buyer.
Private drafts are not saved to local storage. A conflict retains the draft,
shows the latest saved review and requires an explicit comparison before saving
against it. Login changes clear private content and revoke image object URLs.

Eleven new Worker cases cover eligibility, delivery/history, ownership, legacy
upgrade, complete paging, rating totals, cross-environment isolation, concurrent
changes, replay, moderation/reply versions, transactional rollback, private media,
metadata stripping, quota races, interrupted storage and orphan cleanup. Four
real PHP/browser cases cover desktop/mobile publication, images and enlargement,
withdrawal, lost replies, draft conflicts, login changes and paginated history.
The broader checkout/catalog/shipping/profile regression run passes 50 additional
Worker cases. Eighteen adjacent consent/fulfillment PHP/browser cases and the
existing dashboard/rating regression also pass: 84 unique cases in total.

Desktop and 390px screenshots are inspected, with no horizontal overflow or
hidden actions. PHP/JavaScript syntax and the TEST Worker dry build pass. Fixture
coverage proves these controlled workflows, not a provider delivery in hosting.

## Remaining acceptance and integration

- Hosted signed-in buyer/merchant acceptance after central cutover, and populated
  public review/photo acceptance against hosted delivery records. Public empty
  states and filter navigation are verified as recorded below. The shared Chrome
  connection remains unavailable after its approved reconnect timed out; no
  repeated connection attempt is made by this delivery.
- Provider-backed delivery acceptance, the wider commerce completion plan,
  financial validation month, DOKU approval and owner production release.

Production and `main` remain untouched.

## Merchant workspace and public browsing — 25 September 2026

The Customers → Reviews tab now has store-wide rating totals, search, product,
visibility, star, reply and photo filters, date ordering and complete pagination.
Details show the original order, current review, scoped photo evidence and complete
immutable history. Merchants can reply, remove replies, explain moderation,
restore visibility and approve historical reviews. Drafts survive switching
reviews; saving a reply preserves a separate moderation draft. Conflicts require
comparing the latest saved review, and uncertain writes retain the identical
request/key with editing locked until confirmation. Discard and close controls
are explicit, with keyboard focus returned to the originating review.

Merchant review JSON and images pass through the existing PHP proxy. Reads and
writes bind to the page's account and CSRF token, with another session check after
the upstream response. A changed login clears private review content and images.
Viewer roles and the held PHP rollout flag disable editing; the proxy also rejects
writes before forwarding them when PHP commerce storage is held. Both proxies
reject duplicate, nested, unknown and invalid query parameters. The merchant proxy
also bounds review request bodies.

Public shop cards show actual ratings/counts and open a review browser with star
distribution, filters, replies, verified/historical labels and photo enlargement.
Product/filter links survive reloads. Failed pages retain their previous results
and cursor; failed filter retries retain the requested filters. Closing a viewer
discards late replies and releases image object URLs. Enlarging a photo fetches
it again, so a previously loaded thumbnail cannot bypass a newer hide/withdrawal.
The public PHP proxy forwards no buyer authentication or private merchant fields.

Product previews no longer claim a fixed 5.0. New products show no reviews;
unavailable reads show an explicit error and retry. Existing and archived products
use the merchant API's product-specific published summary, distinct from overall
store totals and current filters. Archived review evidence remains accessible to
the merchant. Login changes close that private viewer and clear its ratings.

Thirty-five unique cases pass for this delivery: 12 Worker cases (11 review cases
and storefront), 11 new merchant/public/product browser cases, seven existing
customer cases, four buyer-review cases and the existing dashboard regression.
Coverage includes complete paging/history, failed reads, lost write replies,
conflicts, retained drafts, late responses, viewer/rollout restrictions, changed
logins, safe text, public image visibility and cart persistence. Desktop and 390px
layouts, native and fallback universal dropdowns, and mobile product previews are
checked. Screenshots are inspected; PHP/JavaScript syntax and TEST dry build pass.
No migration is needed for this stage.

Logs: `/tmp/ezkart-review-workspace-api-01a0d643.log` (12),
`/tmp/ezkart-review-workspace-final-01a0d643.log` (22),
`/tmp/ezkart-review-workspace-dashboard-01a0d643.log` (one), and
`/tmp/ezkart-product-reviews-final-01a0d643.log` (one overlapping expanded product
preview check). Screenshots: `/tmp/ezkart-review-workspace-01a0d643/`.
These fixtures establish application behavior, not hosted login or live provider
delivery, and do not close the broader customer or release gates.

### Workspace TEST rollout

Implementation `10513a7` is committed and pushed to `agent/ezkart-workbench`.
TEST Worker `457a1f1b-fbee-4f4b-ad0f-4c844ebb6f6d` is deployed at the existing
TEST URL. The existing `17 * * * *` schedule is unchanged. No migration,
storage-flag change, provider activation or production deployment was performed.

At 15:00:24 UTC / 22:00 Jakarta, all nine served merchant/shared/public/shop assets
match the implementation commit byte-for-byte. Health reports 59 application
tables with D1, public R2 and private R2 healthy. Public review API and PHP proxy
reads return 200 with honest zero counts. Anonymous merchant API/proxy, buyer
review and private-photo requests return 401. Before/after D1 query results are
identical: orders, customers, captures, reservations, shipments, jobs, consents,
consent changes, reviews, review changes and photo records remain zero. The
15-entry legacy import and manifest
`ba180208c85cea72b82323b7b917e0e3771b143d930f5220665fddffc62777c0`
remain unchanged.

At 15:01:29 UTC / 22:01 Jakarta, an isolated anonymous browser verified the already
enabled hosted shop at 1360px and 390px: actual empty rating labels, opening the
review viewer, choosing a star filter through the native dropdown, reloading its
shareable link and closing it. No horizontal overflow or page errors were found;
both screenshots are inspected. This read-only check created no orders/reviews
and did not use or reconnect the user's Chrome. It does not establish populated
review/photo or signed-in merchant/buyer acceptance.

Private rollout evidence is in `/tmp/ezkart-review-workspace-deploy-01a0d643/`:
before/after D1 results, deployment log/version, asset hashes, public endpoint
results, hosted browser report and screenshots. Shared-browser status remains
disconnected with five attempts, no active/queued work and the same recorded
300-second initialization timeout. No reconnect was attempted. The final held
rollout copy check also passes in `/tmp/ezkart-review-workspace-held-01a0d643.log`
(an overlapping case, not added to the 35-case total).

## TEST deployment — 25 September 2026

Implementation `b9bcf42` is committed and pushed to `agent/ezkart-workbench`.
Migration 0022 is applied to TEST D1
`2595f8c1-3e25-422f-9197-91d50a90e131`. TEST Worker
`63c60345-a741-4181-aeb4-c99705c2ace6` is deployed at
`https://ezkart-api-test.vincentbranch23.workers.dev`.

The private pre-migration backup is
`/tmp/ezkart-reviews-deploy-01a0d643/test-before-0022.sql`, mode 0600,
379,387 bytes, SHA-256
`697d039f79c66bea15312defdcbca422de0af4d77a6de4dcfb7fe2f33c28b22b`.
Only migration 0022 was pending. All three new tables are empty and all 14 guards
are present. Orders, customers, captures, reservations, shipments, jobs, consent
records and reviews remain zero. The 15 legacy import entries and manifest
`ba180208c85cea72b82323b7b917e0e3771b143d930f5220665fddffc62777c0`
are unchanged.

At 14:09:17 UTC / 21:09 Jakarta, health reports 59 application tables with D1,
public R2 and private R2 healthy. An existing active product's public review read
returns an honest empty list and zero count. Anonymous merchant review, buyer
review and private-image reads return 401. At 14:08:37 UTC the hosted buyer
JavaScript/CSS hashes match `b9bcf42`, and the PHP proxy also rejects anonymous
access with 401. No central-storage flag or provider setting was activated.

The shared-browser status is still disconnected, with no queued work and the
same fifth connection attempt's 300-second initialization timeout. No reconnect
was attempted. These read-only hosted checks do not establish signed-in buyer,
merchant or public browsing acceptance.

Private rollout metadata is in `/tmp/ezkart-reviews-deploy-01a0d643/`. Validation
logs are `/tmp/ezkart-reviews-api-regressions-01a0d643.log` (60 cases),
`/tmp/ezkart-reviews-api-final-01a0d643.log` (11 final review cases),
`/tmp/ezkart-reviews-migration-final-01a0d643.log` (upgrade recheck),
`/tmp/ezkart-reviews-php-regressions-01a0d643.log` (22 cases),
`/tmp/ezkart-reviews-buyer-final-01a0d643.log` (four final buyer cases) and
`/tmp/ezkart-reviews-dashboard-01a0d643.log` (one existing rating regression).
Overlapping reruns are counted once in the 84-case total.
