# Lintas (Cross) — native builder review

## Result

The September 16, 2026 request “now do cross” commissions the native recreation of the reviewed Lintas everyday-bag concept. The standalone concept is preserved in `~/.local/share/ezkart-templates/lintas/approved-concept/`. The reconstruction is ready for native review; it has **not** been installed as a template or published.

- Editor: http://127.0.0.1:46352/cart/admin/?page=sites&edit=lintas-native-v1.ezkart.site
- Export preview: http://127.0.0.1:46353/
- Local workspace: `~/.local/share/ezkart-templates/lintas/builder/`.
- Eight sections; 356 native elements including section roots.
- Canonical inspection: `lintas/native-recipe-review.json`, SHA-256 `bfff583a32a171c53637d3514f9cbc591d349e27dec66dcef9af7dde795e30a1`.
- Authoring: `lintas/build-native.py`, `lintas/author.mjs`; successful public tool calls in `lintas/builder/calls.jsonl`.

Every section starts blank and is composed with public builder operations. No source HTML/CSS import, iframe, template-specific rendering, saved-page JSON patch or export patch was used. Existing reusable controls support the complete composition. A shared keyboard fix moves focus to the next visible state control when the previous trigger is hidden or disabled; regression coverage includes both directions of the measurement toggle. Individual photographs, the original logo and product-diagram SVG assets are reused as media. Dimensions, diagram scale, packing lists, layout and interactions remain native controls.

## Shopping and interaction

Three independently bound fictional products, variants, prices, stock states, catalog filters with URL persistence, mobile navigation, product dialogs, explicit photo choices, measurement visibility, responsive size comparison, native FAQs, contact/policy dialogs and Ezkart’s shared floating cart work in the normal exported storefront. The fixture catalog explicitly enables demo checkout and is separate from merchant catalog data.

The native version uses Ezkart’s shared cart and checkout. Quantities can be changed in the cart; it does not reproduce the concept’s separate checkout application or shipping examples. Variant guidance is presented together beside the native choices, with actual price and availability updating when selected. No live order or payment was submitted.

## Validation

- Layout and visual inspection at 320, 390, 560, 768, 1024, 1440 and 1920 CSS pixels: no horizontal overflow, missing images or browser script errors. Desktop and mobile full-page/section screenshots compared with the approved reference.
- Interaction checks at 320, 390, 768, 1440 and 1920: catalog filters and reload persistence; measurement toggle (including keyboard focus after each change) and mobile comparison; photo switching; sold-out purchase disabled; independent variant prices; dialog focus wrap, Escape and return focus; FAQ; cart and explicit demo checkout.
- Axe WCAG A/AA: zero automated violations in page, product-dialog and information-dialog states at 390 and 1440. These are browser checks, not exhaustive accessibility certification or real-device testing.
- Editor: text and word gradients edited through the ordinary sidebar; undo/redo; background, image and layout edits; an actual merchant product selected for one placement without changing the other; save/reopen; ordinary export; actual Preview button at desktop/tablet/mobile; Open tab and commerce.
- Initial local transfer: approximately 1.38 MB at 390 and 1.54 MB at 1440, under the 3 MB target. Observed layout shift: 0 mobile, approximately 0.0007 desktop. Export HTML is about 0.75 MB, including embedded fonts/runtime. Loopback measurements do not predict mobile-network timing.

Evidence lives beside the concept under `builder/layout.json`, `builder/interaction-validation.json`, `builder/performance.json`, `builder/screenshots/` and `editor-verification/checks.json`. Local catalog records and working previews are not deployed to the test site.

The full builder regression suite passes: **41 tests, zero failures** (`node --test --test-concurrency=1 tools/builder-mcp/test/*.test.mjs`). No server behavior changed in this work.

## Following concept

The skill and collection brief now preserve the user’s updated direction: Ezkart-inspired rounded sections and controls, soft gradients, clean typography, generous whitespace and an approachable professional storefront. This overrides older blanket gradient/radius restrictions and the repeated sharp-corner studio/editorial direction. The following concept awaits its own commission.

## Editor placeholder correction

The user’s review exposed an editor-only issue missed by the first visual pass: empty decorative containers inherited the “Add an element to this group” helper. A 10px product color swatch therefore contained a 96px-high pseudo-element that overlapped the product action. The shared editor now reserves that guidance for content-sized layout groups and leaves explicitly sized shapes, rules and spacers alone. Normal Add → Layout group still shows its guidance.

The actual Lintas editor was checked again on desktop, tablet and mobile: all three swatches remain 10 × 10px, with no overflowing helper or dashed placeholder outline. Coverage includes creation, sizing, responsive/state dimensions, undo, save/reload and storefront rendering. Evidence: `lintas/builder/empty-group-review/`.

After this correction, the complete builder suite passes **42 tests, zero failures**.
