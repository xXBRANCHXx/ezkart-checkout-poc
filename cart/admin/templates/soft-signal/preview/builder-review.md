# Soft Signal native builder review

Soft Signal’s approved lighting-store concept is recreated through public builder MCP tools and ready for native review. Template packaging awaits the user’s approval of this result.

## Review and provenance

- Editor: http://127.0.0.1:46392/cart/admin/?page=sites&edit=soft-signal-native-v1.ezkart.site
- Storefront: http://127.0.0.1:46393/
- Concept folder: `~/.local/share/ezkart-templates/soft-signal-20260916`
- Approved concept archive: `approved-concept-soft-signal-v1/`.
- Nine blank native sections, 338 editable elements. `native-recipe.json` and `builder/calls.jsonl` retain the authoring operations. `review-native-inspection.json` freezes the saved controls; `builder/exports/soft-signal-native-v1.html` is the normal, unmodified export.
- Inspection SHA-256: `f463fafca69e4140acfc97b0049b19c9956672cbca0d26a9dce66ff39cec8cee`.
- Export SHA-256: `16a7050df28814d06f4f9eed698b5c8a052f6c6680741e6a0c65e2e20f0eac37` (720,687 bytes).

The reconstruction preserves the blue-hour hero, Manrope typography, paper shop, two-model selector, independent package and quantity choices, photo enlargement, three-level dinner-light preview, comparison table, care disclosures, warm closing section and policy dialogs. Each shop placement uses normal catalog image, name, option, description, price, stock and purchase controls. The source’s individual photos and lamp mark remain editable assets. No concept HTML/CSS, source-derived component, page-state mutation, custom page script or export patch was used.

## Verification

- 320, 390, 540, 680, 768, 900, 1024, 1440 and 1920 px: no horizontal overflow, missing visible images or browser errors.
- 36 accessibility scans across the page, photo dialog, cart and policy dialog: zero WCAG A/AA and best-practice violations.
- Keyboard model tabs, URL persistence, comparison links that reveal the selected model, independent package and quantity choices, variant-sensitive descriptions/prices, sold-out dock controls, exact cart quantities/subtotals, three brightness levels, mobile navigation, disclosures, dialog focus restoration and explicit demo checkout pass.
- Long catalog names, empty descriptions, missing media and all-sold-out products pass at 320 and 768 px. Long labels retain readable model numbers/finishes; photo captions leave clearance around enlargement controls. Normal-motion touch operation and landscape cart access pass.
- Eleven editor checks verify ordinary sidebar text, word gradient, background, image, fixed variant, real merchant product and spacing edits; undo/redo; save/reopen; normal export; three-size Live Preview; and Open tab. Verification uses an isolated workspace and does not change the review draft.
- Initial transfer: 889,329 bytes at 390 px and 1,047,607 bytes at 1440 px. Measured CLS: 0.0847 / 0.0022. Mobile measurement used 4× CPU slowdown and 40 ms network latency. These are local measurements, not production performance.
- All 49 builder regression tests and both Worker publication tests pass. New quantity coverage includes inspector changes, undo, persistence, embedded Manrope, linked/independent controls, per-variant quantities, integer/stock limits, keyboard focus, sold-out controls and atomic cart rejection when remaining stock is insufficient.

The native bounds audit flags the closing circle because its box extends below the section. This is the approved, intentionally cropped decoration: the section has `overflow: hidden`, the circle ignores pointer input, and viewport measurements show no overflow. Other sections report no bounds issues.

## Reusable builder additions

- **Quantity selector** follows the connected product, shared group and chosen variant. The normal inspector exposes it alongside other product controls. Plus/minus and direct entry clamp to stock and preserve focus; the universal cart receives the exact quantity.
- **Stock availability** reports availability for the current variant.
- **Side by side with prices** presents selectable catalog option names and prices without repeating the full product description.
- Inline catalog text can sit inside semantic headings and table cells.
- Manrope is available in normal typography controls and embedded in exports, with the SIL OFL license retained.

## Scope

This is a local native review draft with isolated fictional catalog fixtures and explicitly simulated checkout. No real order was placed. It is not a template or published page. The next approved packaging step must provide an empty product card, retain licensed design imagery separately from product data, and preserve the existing owned-product and stock gates for publication and code export. No Worker implementation changed in this step.
