# Hosted landing pages

Implemented on `agent/ezkart-workbench`, 24 September 2026.

## Merchant behavior

- Preview → Open in new tab saves the current page and its full preview to the
  existing private R2 store, then opens an authenticated HTTPS view. The URL
  survives closing the editor, reopening a tab and refreshing. Other accounts
  cannot read the draft.
- Publish keeps the existing ownership, product, stock and artwork checks. The
  saved publication is served publicly at
  `/<business-slug>/shop/<page-name>` on the current site host. Private previews
  use the same path followed by `/preview`. Spaces in page names become hyphens;
  a separately reserved business address identifies the store without its internal account ID.
  Addresses use the configured shop name, falling back to the business name. A short
  number is added only for a name collision; a reserved address remains stable.
- Publication shows the shareable URL with **View published page** and **Copy link**.
  Preview tabs opened from the same editor switch to the public page when publishing
  succeeds. **View live** beside Publish opens the public page; **Open draft preview**
  remains available for reviewing unpublished edits. The library's Copy URL
  control copies the public link for published pages and the private preview
  link for drafts. Page creation no longer advertises an unconfigured
  `*.ezkart.site` hostname.
- Autosave and preview do not replace the public snapshot. Publishing again
  updates the same public URL. Draft/unpublished pages, missing pages and pages
  belonging to inactive stores return 404 from the public route.
- Existing saved documents and embedded image bytes are preserved. No
  image re-upload, DNS change or public access to private R2 objects is required.
  Migration `0008_seller_page_addresses.sql` reserves unique public business names
  in D1 independently of existing account slugs; no project data is rewritten. Blob URLs remain appropriate for temporary downloads and upload
  decoding; they are no longer used as page addresses.

## Routes and isolation

`GET /v1/landing-pages/:id/view` authenticates the seller and streams the stored
full preview. The existing `/preview` route remains a lightweight, script-free
library thumbnail. The PHP admin proxy allows the view route and checks its requested business
against the signed-in seller. Both hosted PHP routes place
authored HTML inside a full-viewport sandboxed iframe. Hostinger replaces CSP
headers with its own policy, so iframe markup enforces isolation independently
of response headers. The outer document retains the title, description, language
and light/dark PNG favicons. Checkout returns to the durable outer URL, including
for older saved snapshots. The address bar always shows the hosted page URL.

`GET /v1/public/landing-pages/:store/:id` resolves the active seller by its slug
and returns only `publishedHtml` when the saved status is `published`.
`cart/page.php`, reached through the narrow root `.htaccess` rewrite and
`cart/page-route.php`, proxies this route using the configured environment API without
forwarding visitor or merchant credentials. It applies the same sandbox policy,
returns no-store responses, and suppresses indexing on the test environment.
The public route never returns editable state or private preview content.

The readable private-preview route loads the authenticated document with a
same-origin fetch to `/cart/admin`, retaining the existing cookie path. Its
small loader replaces the loading document with the trusted sandboxed shell,
so the address bar and checkout return URL stay readable. It shows a sign-in
link to anonymous visitors. The API rejects a preview requested for a different
business even when the visitor is signed into another account. No session-cookie
scope is broadened. Old public query-string links and authenticated admin-view
links redirect to their readable equivalents; trailing slashes normalize too.
Legacy business addresses containing account IDs also resolve to the same seller
and redirect to its reserved public address. Concurrent reservations and duplicate
business names cannot take ownership of an existing or legacy address.

The rewrite matches only `/<business>/shop/<page>` and its `/preview` suffix;
other site, shop, checkout and admin routes keep their existing behavior.

The workbench uses its test Worker and buckets. A future authorized production
release must apply migration `0008_seller_page_addresses.sql` before deploying
the Worker routes and PHP/JS changes with the existing
production API configuration and buckets. Links derive their hostname from the
site where the merchant publishes; this does not migrate test accounts or
projects into production. No production release or main merge was performed.

## Verification

The full builder suite passed 126 tests. The added Image Stack hosting test
covers publication through the merchant UI, a visitor with a separate browser
context, images and cart controls, simulated checkout, reloads after closing the
editor, private later edits, republishing and copying the actual public URL.
The existing live-preview test now reopens the hosted preview in a fresh context
and verifies media, variants and cart behavior after reloading.

All 14 Worker tests passed. Additional publication assertions cover anonymous
public access, unauthenticated and cross-account draft denial, unpublished and
inactive-store 404s, stable publication during autosave, deletion, seller-scoped
page names and sandbox response headers. A PHP integration test verifies the
configured upstream, no forwarded credentials, HTML-only responses, error
handling, method/path validation and isolation headers. Browser checks also
replace CSP with Hostinger’s observed policy and verify that scripts still cannot
read the parent document or storage, while checkout opens normally and preserves
the return URL. PHP lint and Node syntax
checks passed. Mobile and desktop screenshots are in
`/tmp/ezkart-hosting-review`. No real order or payment was created.

Test Worker deployment: `162918f8-ef3a-400a-ae61-c6f8792a1f65`.
Test D1 migration `0008_seller_page_addresses.sql` applied successfully.

## Readable URL verification — 24 September 2026

Browser coverage verifies the clean public and preview paths, empty query
strings, reloads, publication, copying and cart behavior. The PHP integration
also verifies both legacy redirects, trailing-slash normalization, the preview
sign-in state, actual authentication with a cookie scoped to `/cart/admin`,
checkout returns to the clean URL and wrong-business rejection. The production
rewrite is verified separately on the test host because PHP's development server
uses a small test router. Worker route tests check both derived paths and enforce
the preview's requested business slug.

## Published links and business addresses — 24 September 2026

The publication confirmation, public-link copying, automatic preview-tab switch,
private later edits, republishing, and mobile confirmation layout pass browser
checks. Favicon and live-preview tests pass, along with the 11 required editor
interaction checks. All 14 existing Worker tests and the new D1 address test pass;
the latter verifies concurrent reservations, duplicate names, configured shop names,
legacy ownership, stable links after renaming and suspended-store denial. The PHP
integration verifies both old-business redirects with the actual admin cookie
scope, sandbox isolation and checkout return URLs.
