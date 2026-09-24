# Hosted landing pages

Implemented on `agent/ezkart-workbench`, 24 September 2026.

## Merchant behavior

- Preview → Open in new tab saves the current page and its full preview to the
  existing private R2 store, then opens an authenticated HTTPS view. The URL
  survives closing the editor, reopening a tab and refreshing. Other accounts
  cannot read the draft.
- Publish keeps the existing ownership, product, stock and artwork checks. The
  saved publication is served publicly at
  `/cart/page.php?store=<store-slug>&page=<page-id>` on the current site host.
- The link icon beside Publish opens that public page. The library's Copy URL
  control copies the public link for published pages and the private preview
  link for drafts. Page creation no longer advertises an unconfigured
  `*.ezkart.site` hostname.
- Autosave and preview do not replace the public snapshot. Publishing again
  updates the same public URL. Draft/unpublished pages, missing pages and pages
  belonging to inactive stores return 404 from the public route.
- Existing saved documents and embedded image bytes are preserved. No schema
  migration, image re-upload, DNS change or public access to private R2 objects
  is required. Blob URLs remain appropriate for temporary downloads and upload
  decoding; they are no longer used as page addresses.

## Routes and isolation

`GET /v1/landing-pages/:id/view` authenticates the seller and streams the stored
full preview. The existing `/preview` route remains a lightweight, script-free
library thumbnail. The PHP admin proxy allows the new view route. Both hosted PHP routes place
authored HTML inside a full-viewport sandboxed iframe. Hostinger replaces CSP
headers with its own policy, so iframe markup enforces isolation independently
of response headers. The outer document retains the title, description, language
and light/dark PNG favicons. Checkout returns to the durable outer URL, including
for older saved snapshots. The address bar always shows the hosted page URL.

`GET /v1/public/landing-pages/:store/:id` resolves the active seller by its slug
and returns only `publishedHtml` when the saved status is `published`.
`cart/page.php` proxies this route using the configured environment API without
forwarding visitor or merchant credentials. It applies the same sandbox policy,
returns no-store responses, and suppresses indexing on the test environment.
The public route never returns editable state or private preview content.

The workbench uses its test Worker and buckets. A future authorized production
release must include the Worker routes and PHP/JS changes with the existing
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

Test Worker deployment: `026844ce-d3ef-4e91-ac7f-ab2d312c7472`.
