# Image builder on the workbench

Implemented 24 September 2026 for `agent/ezkart-workbench` and `test.ezkart.id`.

## Merchant flow

Landing pages → New page presents the approved image-builder and visual-builder
comparison. Both choices have example previews. Image pages start with a name,
image uploads, and a catalog product. The visual choice keeps the existing
template and blank-page flow. Existing visual pages retain their editor.

The image editor supports multiple uploads, replacement, ordering, removal,
optional image descriptions, undo/redo, autosave, reopening, and preview. Uploaded
artwork forms the entire page content. It uses one vertical layout, capped at
480 px and centered on wider screens. The fixed purchase controls use the same
Ezkart product, variant, price, stock, cart, and checkout behavior as visual pages.
Drafts may be empty; publication requires artwork and an available owned product.

The chooser and new editor use the account's existing Settings → Regional
preferences → Language selection. English and Bahasa Indonesia are persisted in
`app_users.locale`; uploaded artwork is not translated. This does not translate
the rest of the existing admin application.

## Implementation and limits

- Uses the existing version-6 native page document, history, persistence, and
  publication pipeline. `[data-image-page]` identifies image pages.
- Accepts JPG, PNG, and WebP, up to 15 MiB per input and 20 images per page.
- Optimizes to WebP at up to 1080 px **width**, preserving long poster proportions.
  Images over 40 million pixels or 24,000 px tall require splitting. Optimized
  files over 2 MiB are rejected.
- Limits serialized editable state to 6 MiB, reserving space for its published
  HTML and commerce within the existing 16,000,000-byte project limit. This can
  limit the image count before 20. Uploads use the account's existing private
  asset store; the native page embeds the optimized artwork as current image
  elements do.
- The user's four fictional Kopi Senja images appear only in the chooser and its
  full example, joined in upload order. No demo product
  or artwork is inserted into a merchant's new page.
- `GET/PUT /v1/admin-preferences` reads/updates only the signed-in account's
  language. No database migration is needed.
- Worker publication parsing now decodes HTML attribute entities once before
  reading native commerce JSON. Browser-serialized `&quot;` attributes previously
  failed the server gate. Ownership, stock, and visibility checks still apply.

## Verification

Passed 19 existing merchant UI tests across blank-editor-workflow,
section-actions, grid-snapping, template-drafts, and sidebar-templates. These
cover pointer interactions, section backgrounds, resizing, undo/redo, save/reopen,
template insertion, and narrower editor widths.

Two new Playwright workflows cover image creation, upload, replacement with a
900 × 9000 poster, ordering, removal, undo/redo, saved descriptions, reload,
catalog connection, variant pricing, cart contents, stock rejection, switching
back to visual page creation, and account-language rendering. Output was checked
at 320, 390, 768, and 1440 px; the editor at 320, 390, and 941 px.

Four API tests passed across admin-profile and landing-publication, including
account-language isolation and publication rejection for hidden, foreign, or
unavailable products. Entity-encoded native HTML is included in that coverage.
An actual generated image-page document and saved native state also passed the
Worker publication validator in Miniflare. Node syntax, PHP lint, and whitespace
checks passed. Desktop and mobile screenshots were visually inspected.

The test Worker deployment is `f4ee5abe-9de6-49ae-a3e1-303e04fe9e59` on
`ezkart-api-test`. Merchant UI automation used the local workspace host;
hosted asset delivery is checked separately after the workbench push. This
validation does not create a live order or payment.

## Chooser refinement — 24 September 2026

Replaced the single Sambal example with the four downloaded Kopi Senja images.
The upload illustration shows four separate files; the example stacks all four
without gaps. The chooser no longer shows the question header, subtitle,
shared-checkout banner, or redundant Cancel footer. Its close control and
accessible dialog name remain. The chooser sizes to its contents, with smaller
illustrations in short desktop windows; narrow screens keep vertical scrolling
so content and touch targets remain readable. The following image-page naming
form uses visible standard inputs and a compact dialog.

The original 1024 × 1536 PNGs remain untouched in Downloads. Runtime WebP copies
are 800 × 1200, with a combined size of 432,974 bytes. Their order follows the
download names ending in `12_08_22`, `12_08_24`, `12_08_28`, and `12_08_30`.

Verified the revised chooser at 1894 × 846, 1440 × 900, 1366 × 600,
1024 × 640, 941 × 720, 768 × 900, 390 × 844, and 320 × 700. Both choices
and their buttons fit without scrolling at all six desktop/tablet sizes. The
four-image example is contiguous, both previews open/close, and page creation
still follows account language. Twenty-one unique merchant UI regression tests
passed across the required interaction suites and the image/template workflows.
