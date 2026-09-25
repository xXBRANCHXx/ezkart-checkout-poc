# Purchase reviews: buyer workflow and API

This delivery implements the buyer workflow on order tracking and the review API.
The merchant moderation workspace, public review browser and product-editor
preview still need integration and acceptance. The customer-operations completion
gate remains open. The existing central-commerce flag controls all review writes
and the buyer controls; this delivery does not enable checkout or providers.

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

- Merchant review search, reply, moderation, evidence/history and conflict/retry
  controls through the real merchant UI, including viewer and mobile acceptance.
- Public product review browsing/filtering, photos and replies, plus accurate
  product-editor preview (including removal of its hardcoded 5.0 claim).
- Hosted signed-in buyer/merchant/public acceptance after central cutover. The
  shared Chrome connection remains unavailable after its approved reconnect
  timed out; no repeated connection attempt is made by this delivery.
- Provider-backed delivery acceptance, the wider commerce completion plan,
  financial validation month, DOKU approval and owner production release.

Production and `main` remain untouched. TEST rollout evidence is recorded below
after the migration and deployment are verified.
