# Melo template validation

## Approved native source

The user approved Melo's native builder result with “ok, make that a template.”
The saved draft was re-inspected before packaging and matched the reviewed
363-element, nine-section composition. The approval archive SHA-256 is
`2b48a6a1aeec0b16bf99f950f47395c913a90fcc99422bfd67ec5212ff7904a7`.

Melo is installed in New page. Its recipe contains 298 native elements before
conditional adaptation and retains the approved art direction and editable design
imagery. Applied pages use catalog bindings instead of fictional kit data. No
source HTML/CSS import, page-storage mutation, custom renderer or export patch
was used.

## Drafts and commerce

New drafts start with one empty product card that opens the normal product picker.
Draft save and Preview work without products; publish and code export reject an
empty or entirely sold-out shop. Connect one to three products later while
preserving text, colors and layout edits. Undo/redo and save/reopen are verified.

Each product's card and detail dialog share its variant selection, price, media
and stock. Products remain independent. Missing photos and descriptions are
omitted. Availability filters appear for mixed stock availability; collection
links reset those filters. The mint detail section shows actual product names,
descriptions and prices, with keyboard tabs when two products are present. Sparse
catalogs remove unused cards, dialogs and tabs. Empty drafts omit this section.

Fictional product names, kit contents, dimensions, instructions, age limits and
shipping/return promises remain in the preview archive. Applied pages contain
ordinary shopping guidance and use Ezkart's universal cart and checkout. Only
explicit local fixtures enable simulated checkout; no real order was placed.

## Checks

- Public MCP application: both an empty draft and a two-product page save with
  zero page-audit issues. The connected page exports through the normal tool.
- Dedicated regression: empty card/picker, publish/export gates, preserved edits,
  independent variants, synchronized dialogs, availability filters, URL reset,
  sold-out actions, keyboard tabs, long names, no-photo/no-description products,
  sparse catalogs, undo/redo and package budget.
- All 13 template regression checks pass across Melo and existing templates.
- Both Worker publication contract checks pass, including ownership/current-stock
  validation, empty drafts, export authorization and publication-bypass attempts.
- Real ZERO catalog data tested at 320, 390, 540, 680, 768, 900, 1024, 1440 and
  1920 px: no horizontal overflow, broken visible images or browser errors.
- Two WCAG A/AA and accessibility best-practice scans: zero violations at 390 and
  1440 px. Empty mobile and populated desktop/mobile screenshots visually reviewed.
- Independent Hazelnut 550ml and drops choices show Rp77.000 and Rp20.000; the
  shared cart totals Rp97.000.
- Cold desktop transfer: 1,203,620 bytes; observed CLS 0.000565. These are local
  Chromium measurements with real product media, not production field metrics.

The complete package is below the 50 MB limit. Exact bytes and per-file hashes
are recorded beside `melo-1.0.0.tar.gz` in the concept folder.

## Evidence

`~/.local/share/ezkart-templates/melo-punch-20260916/template-verification/` contains
the real-catalog fixture, quality report, exports and comparison screenshots.
`template-application/logs/` contains public MCP application calls. The installed
`cart/admin/templates/melo/preview/` preserves the native approval, photos,
fictional fixture, asset provenance and font license. See also
`melo-builder-validation.md` for the approved reconstruction's editing and
interaction checks.
