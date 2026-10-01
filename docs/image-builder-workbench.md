# Image builder on the workbench

Implemented 24 September 2026 for `agent/ezkart-workbench` and `test.ezkart.id`.

## Merchant flow

Landing pages → New page presents the approved Image Stack and Page Studio
comparison. Both choices have example previews. Image pages start with a name,
image uploads, and a catalog product. The visual choice keeps the existing
template and blank-page flow. Existing visual pages retain their editor.

The image editor supports multiple uploads, replacement, ordering, removal,
optional image descriptions, undo/redo, autosave, reopening, and preview. Uploaded
artwork forms the entire page content. It uses one vertical layout, capped at
480 px and centered on wider screens. A native product card follows the artwork,
using Page Studio's catalog photo, name, options, price and add-to-cart controls.
Its floating cart opens an opaque bottom sheet and uses the same Ezkart stock
and checkout behavior as visual pages.
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

## Full design preview — 24 September 2026

The visual option is labeled **Design builder** (Indonesian: **Editor desain**).
Its example previously used the 1440 × 1000 first-screen gallery thumbnail,
which left no lower page content to scroll. It now uses the approved native Sela
full-page screenshots: 1440 × 5281 on desktop and 390 × 6134 on phones. These are
compressed WebP copies of `sela/builder/screenshots/{1440,390}-full.png` in the
local template archive, stored separately under `assets/builder-choice/`.

Verified actual mouse-wheel scrolling and reaching the footer at desktop and
phone widths, with the close control still visible and Escape returning focus
to the example button. The image-editor regression also covers this behavior
and the new Indonesian chooser label.

## Approved names — 24 September 2026

The choices are now **Image Stack** and **Page Studio**. Image Stack explains
uploading finished graphics and putting them in order; Page Studio explains
starting with a template or a blank canvas and controlling the layout and each
element. The names appear on the cards, action buttons, accessible preview
labels, example titles, and loading-error fallback. Indonesian accounts see
**Susun Gambar** and **Studio Halaman**, with translated descriptions and actions.
Saved page modes and the underlying editor behavior are unchanged.

## Product card and cart refinement — 24 September 2026

Image Stack now ends with Page Studio's native product card instead of the fixed
purchase strip. Opening an older saved image page upgrades the strip while
preserving its uploaded images, descriptions and selected product. The upgraded
draft saves normally; existing published snapshots change when republished.

The shared cart opens from the bottom on Image Stack, capped at the 480 px page
width on larger screens. It has an opaque white surface, a dimmed backdrop,
scrollable items and a visible checkout footer. The floating button stays hidden
while the sheet is open. Escape, backdrop/close buttons, focus restoration,
quantity limits and the existing checkout remain shared with Page Studio.
Empty theme values are no longer exported over the cart's default colors/fonts.

Upload rows use arrow, replace and trash icons with translated tooltips and
accessible names. Touch controls retain 44 px targets. Native product cards now
also support catalog variants that have names but no separate option groups.

Verification covered 117 unique tests across the complete builder suite. Three
older page-creation tests initially skipped the builder chooser; they passed
after their workflows were updated to choose Page Studio. The image workflow
also verifies reopening and saving an older fixed-strip draft, product-card
variants, opaque bottom-sheet geometry at 320/390/768/1440 px, cart quantities,
stock limits and simulated checkout. Desktop and narrow editor screenshots were
inspected with catalog photos and missing-photo states. Normal slide-up motion,
reduced motion, backdrop dismissal and focus return were checked separately.
This verification used the local merchant UI and exported pages, without placing
an order or collecting payment.


## Navigation and shared controls — 24 September 2026

Image Stack has an optional navigation bar. Merchants can set its name, height
(48–120 px), background/text colors, background transparency, backdrop blur,
and scrolling behavior (off, always visible, or appear when scrolling up).
Up to eight named menu links jump to uploaded images. Links follow persistent
image IDs through reordering and replacement; removing an image removes its link,
and Undo restores both. The optional product button jumps to the connected
catalog card and stays absent when no product is connected. Settings and default
labels follow the account language and survive saving, undo and reopening.

The product button appears beside the page name in the header, above the images.
Enabling it does not turn product artwork into a connected catalog item. If it
is absent, check the Product selection and the navigation setting's guidance:
"Choose a product below to show this button." Removing the connected product
preserves the enabled setting; reconnecting a product restores the button.
`image-cta.test.mjs` verifies these states, video/footer edits, save/reload,
320/390/941/1440 px editor previews, scrolling and local publication. This
fixture evidence does not establish the selected product in a live merchant draft.

The bar uses Page Studio's existing navigation menu, blur and scroll runtime.
Its width remains capped at 480 px, including on desktop. Jump targets account
for the selected header height. Disabling the bar preserves its settings.

Product card options now use the universal native select and its existing
fallback, in both editors and standalone pages. Generated fallback wrappers are
removed from snapshots and exports, then rebuilt by the shared installer.
The obsolete product-only menu styles and keyboard handlers are removed.

The editor no longer inherits the admin panel's 18 px top padding and 1 px
border. Image Stack's cart thumbnails use 80 × 96 px instead of 52 × 60 px on
mobile, with the complete product image contained in the slot.

## Image arrangement — 24 September 2026

Upload cards now use a six-dot drag handle. A compact artwork preview follows
the pointer while a shaded slot with the upload area's dashed border marks the drop position. Neighboring
cards move with a damped spring that preserves velocity when the target changes.
Dragging near the viewport edge scrolls longer lists. Dropping commits one
history step; Escape, pointer cancellation and drops outside the list restore
the original order. Keyboard users pick up with Space or Enter, move with the
arrow keys (or Home/End), and drop with Space or Enter. Reduced motion skips
the animation.

The thumbnail opens image replacement directly, with a Replace overlay on
hover or keyboard focus and a visible caption on touch screens. The trash
control has no button border. English and Indonesian labels are supported.

Verified 17 merchant UI tests across image sorting, image pages, navigation,
blank-editor-workflow, section-actions and grid-snapping. Coverage includes
mouse and touch dragging, cancellation, edge scrolling, keyboard sorting,
replacement, undo/redo, reduced motion and saved order. Desktop and mobile
screenshots were visually inspected; narrow layouts were checked at 320,
390 and 941 px. Review captures are in `/tmp/ezkart-image-sorting-review`.

Verification: 35 unique browser tests passed across navigation, native rendering,
cart, product controls, universal selects, responsive layouts, blank editing,
section actions and grid snapping. The six Image Stack/select tests passed again
in an isolated delivery checkout, including save/reopen, language settings,
480 px width limits, all scroll modes, image targets after reordering, and zero
top gap at 390/941/1440 px. Screenshots of the editor, expanded menu, product card
and cart were reviewed. No real order or payment was created.

## Color responsiveness and correct startup — 24 September 2026

Navbar appearance changes previously rebuilt the entire native page and re-exported
it into the preview iframe. Applying the shared color picker could also re-enter
its close handler through selection updates, repeatedly applying the same change
until the call stack overflowed. The picker now clears its active target before
emitting its final change event.

Image Stack previews colors, text, height, transparency and blur in place. A
frame-coalesced, parent-checked message updates only navbar appearance inside the
existing opaque-origin sandbox. Apply records one history snapshot, updates the
editable document and schedules normal autosave. Cancel restores the preview
without adding a history entry. Images, selected variants, cart contents and
scroll position remain intact. The message listener is installed only in the
editor preview, never in the exported or published page. Structural changes still
use the existing page rebuilding path.

The startup loader now sits outside either editor. Both the tools and canvas stay
hidden until the saved page has loaded, so Page Studio no longer appears briefly
before Image Stack. A delayed-script and delayed-page-data browser check covers
both modes.

A local four-image reproduction under Chromium 4× CPU throttling took 27,321 ms
from Apply to the updated preview before the fix and recorded stack-overflow
errors. The first fixed run took 92 ms. Three repeat runs took 141, 77 and 90 ms,
with zero iframe reloads and no browser errors. These are local reproduction
measurements, not a four-core hardware benchmark or a guarantee for all devices.
All 31 relevant browser tests passed, including the required blank-page, section
and grid workflows, sorting, color controls, live previews, persistence and
universal dropdowns. The neutral startup screen was visually inspected.
