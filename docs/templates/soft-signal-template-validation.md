# Soft Signal template validation

## Approved native source

The user approved the native result with “ok, make it a template. this will be
the last one for a bit.” The archived source has nine sections and 338 editable
native elements. Its SHA-256 is
`f463fafca69e4140acfc97b0049b19c9956672cbca0d26a9dce66ff39cec8cee`.

Soft Signal is installed in New page. Its 266-element recipe retains the approved
evening composition, Manrope, warm photography and interactive scene preview.
Product panels adapt to the merchant's catalog. No source HTML/CSS import,
page-storage mutation, custom renderer or export patch was used.

## Drafts and commerce

New drafts contain an empty product card that opens the product picker. Editing,
save and Preview work without products; publish and code export reject empty and
entirely sold-out shops. Connecting one or two products preserves merchant edits.
Undo/redo and save/reopen are verified.

The product studio opens on the first available product. Product selection,
variants and quantities remain independent, while the universal cart receives the
exact selected quantities. The comparison uses actual availability and each
product's current option price. A single product removes the selector and
comparison; absent photos and descriptions are omitted. Products without photos
use the full shopping area. Long names wrap and mobile navigation stays below
the header when the brand name wraps.

The shared native state stylesheet now supports a state container changing its
own layout, so the studio can switch between products with and without images.
Shared template context provides the initial available product and safe column
values for missing optional slots. Existing templates pass their regressions.

The two design photos remain editable. Brightness controls are identified as a
photo preview, with product features kept in actual product details. Fictional
lamp names, finishes, dimensions, batteries, package contents and review policies
stay in the preview archive. Applied pages use normal Ezkart checkout. Explicit
local fixtures use demo checkout; no merchant product or real order was created.

## Checks

- Public MCP application creates and saves both an empty draft and a connected
  page. The connected page exports through the normal tool. The bounds audit
  reports only the approved, intentionally clipped decorative `finale-orbit`;
  its section has hidden overflow and the page has no horizontal scrolling.
- Dedicated regression covers the empty picker, publish/export gates, preserved
  edits, independent choices, stock limits, photo dialogs, keyboard selection,
  scene controls, policy-dialog focus, no-photo/no-description products, long
  names, sparse catalogs, available second-product initialization and undo/redo.
- All 50 builder tests pass, including existing template, editor, commerce,
  navigation, background, responsive-layout and preview checks.
- Both Worker publication contract tests pass, including server validation of
  ownership/current stock and rejection of publication bypasses.
- Real ZERO catalog data tested at 320, 390, 540, 680, 768, 900, 1024, 1440 and
  1920 px: no horizontal overflow, broken visible images or browser errors.
- Twelve WCAG A/AA and accessibility best-practice scans pass at 390 and 1440 px,
  covering empty drafts, both products, photo dialogs, cart and privacy dialog.
- Independent Hazelnut 550ml × 2 and drops × 1 choices produce Rp174.000 in the
  shared cart. Each product remembers its quantity when switching tabs.
- Desktop/mobile shop, empty-page, complete-page and cart screenshots visually
  reviewed. Additional long-brand and missing-image checks cover mobile menus.
- Cold desktop transfer: 987,632 bytes; observed CLS 0.002118. These are local
  Chromium measurements using catalog media, not production field metrics.

The package, including shared runtime, fonts and approval archive, is below
50 MB. Exact bytes and per-file hashes are recorded beside the artifact.

## Evidence and handoff

`~/.local/share/ezkart-templates/soft-signal-20260916/template-verification/`
contains the real-catalog fixture, exports, screenshots, quality report and test
logs. `template-edge/` contains long-brand and missing-photo checks.
`template-application/logs/` records public MCP application. The installed
`cart/admin/templates/soft-signal/preview/` preserves the native approval,
fictional catalog, images, generation prompts and Manrope's SIL license.
See `soft-signal-builder-validation.md` for the approved reconstruction's editing
and interaction checks.

The user paused the batch after this template. No next concept or terminal is
queued; the agent records that instruction.
