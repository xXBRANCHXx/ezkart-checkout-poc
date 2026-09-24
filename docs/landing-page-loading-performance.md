# Landing-page loading — 24 September 2026

The gallery used to read every full project from R2 for its index, then read a
full project again before serving each preview. Opening the editor also waited
for the complete index and component library before fetching the selected page.
The PHP shell fetched the catalog, which the browser immediately fetched again.

The selected document now starts loading before the builder scripts finish
downloading. The editor consumes that request once, reuses the safely encoded
catalog from the authenticated PHP response, and loads the project index and
component library in the background. Late index responses preserve newer loaded
or saved documents. Creating a page still waits for the index/capacity check.

R2 now stores small derived project summaries keyed to the source object's
version. Legacy pages fill the cache on their first list read; subsequent reads
avoid their image-heavy state and publication HTML. Preview metadata comes from
one paginated listing. A failed summary write does not lose a saved project, and
stale summaries are rebuilt against the current object version.

Gallery previews check the parent object's metadata without downloading it.
They remove nonfunctional scripts and Image Stack artwork starting below the
first 1,000 pixels; the gallery viewport is shorter than that. The full editor,
interactive preview, export and saved project are preserved. Conditional ETags
return 304s, a render parameter refreshes existing browser caches, and PHP accepts
compressed upstream responses. The existing private authorization and sandbox
remain in place.

## Verification

- All 124 pre-existing builder cases passed in the full 125-case run. The new
  startup case initially asserted during the loader's fade-out and counted an
  autosave PUT as a second download. After correcting those test assertions,
  all three cases in `image-preview.test.mjs` passed, including the new case.
- The new browser case holds the index and component responses indefinitely,
  opens Image Stack, edits and saves its navigation, then releases the older
  index response. Only one GET downloads the selected document.
- All 13 Worker cases passed, including cache invalidation/races, pagination,
  authenticated previews, 304 responses, deleted-parent handling, publication
  rules, product stock, and seller isolation. Worker dry-run and PHP lint passed.
- Merchant UI checks covered blank-page creation, separate sections, backgrounds,
  text/images, pointer dragging/resizing, undo/redo, and save/reopen at desktop
  and narrow widths. The Image Stack canvas was visually inspected at 941px.
- A four-image coffee-page gallery response fell from 967,768 to 600,760 bytes
  (38%). After image decode, its 1440 × 800 first-screen screenshots matched
  byte for byte with scripts disabled, as in the gallery sandbox.
- Three controlled startup runs with 4× CPU slowdown and API delays of 1,500ms
  (index), 1,000ms (components), 200ms (catalog), and 600ms (document) had medians
  of 7,935ms before and 6,249ms after. A normal-speed profiling run took 1,549ms.
  These local figures are not production or merchant-session timings; the
  comparison ran alongside regression tests. Artifacts are in
  `/home/branch/ezkart-loading-review-2026-09-24/`.

Delivery is restricted to `agent/ezkart-workbench`, `test.ezkart.id`, and the
test Worker. No production release is authorized. The existing Chrome debugging
connection timed out, so the user's authenticated session was not reloaded or
measured; hosted asset versions and the test API health are checked separately.

## Follow-up: the loading screen still stayed too long

The initial change left two costs on the critical path. The parser-blocking
startup script ran after stylesheets, and the editor still fetched roughly two
dozen separate JavaScript files. A hosted-assets probe with local page data took
about 3.4 seconds to finish loading some startup scripts. Read-only inspection of
`image-stack-test-i` in the test bucket also found that all four images occurred
twice in the 2 MB editable document.

The startup request now runs in the head before CSS. Landing pages use a single
CSS bundle and a deferred JS bundle, with separate gallery/editor manifests.
The manifest only contains allowlisted public repository assets. PHP generates
fingerprinted static bundles atomically; every source modification time and size
contributes to the fingerprint, so future edits invalidate browser caches without
a separate build step. Read-only hosting falls back to the public bundle endpoint. Existing source
order and relative URLs are preserved; native CSS stays isolated in asset cards.
Map/dashboard JavaScript is no longer loaded on landing-page screens.

An authenticated `/v1/landing-pages/:id/editor` endpoint transfers each embedded
image once, reconstructing the exact editable JSON in the browser. It excludes
the publication snapshot, which is not needed for editing. Full saved projects,
autosave payloads, exports and publication storage retain their original format.
For the inspected test page, the response fell from 2,024,758 to 1,065,913 bytes;
gzip fell from 1,466,310 to 738,823 bytes (50%). Deep comparison confirmed lossless
reconstruction of every editable field. The account data was read for diagnosis
and was not edited or checked into the repository.

Verification:

- 14 Worker tests passed, including lossless transfer, authorization, missing
  projects, publication preservation, and existing ownership/stock checks.
- Authenticated PHP shell/bundle checks and the shop appearance/checkout browser
  test passed. Checks cover fingerprinted static files, fallback redirects,
  path rejection, catalog bootstrap, the new proxy route, and a real PHP editor
  opening and rendering an isolated native asset preview without errors.
- The broad builder run passed 122/125 cases. One mock still intercepted only
  the old document route; it was updated for `/editor` and passed. Two tests hit
  timeouts under full concurrency. All 13 cases in the follow-up run passed at
  concurrency 2, including those two, blank-editor workflows, grid interaction,
  Image Stack sorting/navigation/save/reopen, and a new test that holds both
  bundles indefinitely while confirming the selected document fetch starts.
- PHP lint, JavaScript syntax checks, Worker dry-run, and diff checks passed.
- The local Workspace serves the same bundle manifest and transfer format as
  hosted PHP. Actual merchant-session timing remains unavailable because Chrome's
  debugging connection does not respond. Hosted-asset tests use a copied page
  and controlled API responses, not the merchant's authenticated browser.

The first hosted bundle measurement exposed inefficient dynamic CDN compression:
the editor JS transferred 561,928 bytes. Explicit whole-response gzip and
`no-transform` were also recompressed by the host. The final implementation
therefore serves generated static files, using the host's static asset pipeline
instead of relying on its dynamic response compression. Generated files stay out
of Git and contain only the existing public scripts/styles.
