# Hue (Rona) — native builder review

## Result

The September 16, 2026 request to “do hue” commissions the native recreation of the reviewed Rona bath-linen concept. The approved source is preserved under `~/.local/share/ezkart-templates/rona/approved-concept/`. The native version is ready for review; template packaging awaits approval of this version.

- Editor: http://127.0.0.1:46362/cart/admin/?page=sites&edit=rona-native-v1.ezkart.site
- Native storefront preview: http://127.0.0.1:46363/
- Local workspace: `~/.local/share/ezkart-templates/rona/builder/`.
- Nine sections, 225 native elements including section roots.
- Canonical inspection: `rona/native-recipe-review.json`, SHA-256 `d52fc3385d81f59829797d0c08b87b70c03d11d46f4e63d82f098956c14eb872`.
- Authoring: `rona/build-native.py` and `rona/author.mjs`; successful public MCP calls recorded in `rona/builder/calls.jsonl`.

Each section starts blank and is assembled with ordinary typed elements, responsive properties, text ranges, gradients, interaction states and catalog bindings. No concept HTML/CSS import, custom page renderer, iframe, saved-project mutation or export patch was used. Photographs and the SVG brand mark are reused as individual media assets. The proportional towel diagrams are editable containers, lines and labels.

## Design and shopping behavior

The reconstruction preserves the Poppins typography, warm paper background, rounded peach hero, three-product collection, sage material story, size comparison, care guidance, FAQs and closing invitation. Ezkart supplies the shared floating cart and explicit demo checkout. The local fictional catalog contains independently bound bath towels, hand towels and a two-towel set. No live order or payment was submitted.

Color swatches are a reusable builder capability, available in **Product control → Options layout → Color swatches** and through `optionLayout: "swatches"` plus `variantColors`. Each actual variant can receive a color through the inspector. Unmapped variants retain readable names, and changing the connected product clears old mappings. Native radios provide keyboard selection, 44px targets, a visible selected name, sold-out labels and the normal stock gate. Product images, prices and cart items follow the actual selection. Hand-towel choices list its initially selected Sage first; the bath towel starts with Peach.

The shared cart's secondary text now follows the page ink color. Its previous fixed gray failed contrast on the cream background. This fix applies to ordinary exports as well as Rona.

## Validation

- Visual and responsive checks at 320, 390, 620, 768, 900, 1024, 1440 and 1920 CSS pixels: no horizontal overflow, missing images or browser script errors. Desktop and mobile screenshots compared with the approved concept; corrected mobile product-title alignment and restored the desktop material-image height.
- Mobile and desktop journeys: navigation, keyboard color selection, variant-image updates, independent products, three-item cart subtotal Rp617,000, explicit simulated checkout, size-guide tabs and arrow keys, FAQs, and policy dialogs.
- Axe WCAG A/AA: zero detected violations in page scans at 320, 390, 768 and 1440, and populated cart scans at 390 and 1440. These automated checks supplement manual review; they are not exhaustive accessibility certification or real-device testing.
- Actual editor: sidebar text and word-gradient edits; section background, image, swatch-color and layout changes; undo/redo; selecting an actual merchant product for one placement without changing another; save/reopen; gated HTML export; Preview at desktop/tablet/mobile; and Open tab with working interactions.
- Initial loopback transfer approximately 1.21 MB at both 390 and 1440. Observed layout shift: 0 mobile and approximately 0.001 desktop. Export HTML approximately 553 KB including embedded fonts/runtime. Local timing does not predict mobile-network performance.
- Complete builder regression suite: **45 passing, zero failures**. Final focused cart/commerce checks after the touch-target refinement: **4 passing, zero failures**.

Evidence is stored beside the concept in `builder/validation.json`, `builder/performance.json`, `builder/screenshots/` and `editor-verification/checks.json`. The native review catalog and local draft are not merchant publications. The shared builder feature and cart styling are delivered to the test branch; no additional API deployment is needed for these frontend changes.

## Next concept

Before this reconstruction began, the requested professional-business terminal was opened in `/home/branch/Mint-Home/Ezkart-Radish-Labs` with full access and approval policy `never`. It is independently creating its step-one concept in `~/.local/share/ezkart-templates/lajur/`. It has its own review stage and must not be duplicated or confused with Rona's native approval.
