# Rona (Hue) template validation

## Approved native source

The user approved Rona's native builder result on September 16, 2026 and asked to make it a template. The archived inspection has 225 elements and nine sections; SHA-256 `d52fc3385d81f59829797d0c08b87b70c03d11d46f4e63d82f098956c14eb872`.

The installed recipe contains 186 ordinary native elements before conditional adaptation. It retains the rounded peach-and-sage design and editable design photography. Fictional catalog names, dimensions, materials, care claims, branding and simulation notices remain in the approval archive. Applied products use actual catalog data. There is no template-specific renderer or imported source HTML/CSS.

## Draft and catalog checks

New page → Rona (Hue) starts with an empty product card that opens the product picker. Empty drafts save and preview; publish and code export reject them. Connecting one to three products preserves authored content and layout edits, supports undo/redo and survives save/reopen. Optional content and comparison adapt to available products and descriptions. Missing photos are omitted. Six or fewer variants use editable colors or variant names; larger catalogs use a rounded dropdown.

Regression tests cover long and unbroken names, sparse copy, missing images, sold-out variants, independent variant prices, product reconnection, cart actions and ordinary checkout copy. The non-demo export contains normal Ezkart checkout controls and no simulated-purchase message. Explicit local fake-catalog fixtures still identify their demo checkout and cannot place an order.

## Browser review

Two real ZERO products were applied through the public builder tools. At 320, 390, 620, 768, 1024, 1440 and 1920 pixels, the page had no horizontal overflow, broken images or browser errors. Screenshots received a visual review, including the empty mobile draft and populated product section. Independent Hazelnut 550ml and drops variants showed Rp77.000 and Rp20.000; cart subtotal was Rp97.000.

Automated WCAG A/AA checks found zero violations at 390 and 1440 pixels. Cold desktop transfer measured 881,322 bytes and observed CLS was 0.000245. These are local Chromium measurements. Native editor, swatch keyboard behavior, Preview and Open tab were verified during the approved reconstruction; see `rona-builder-validation.md`.

The dedicated Rona template and native color-swatch regressions pass, as does the template regression suite. The package is below the 50 MB hard limit; exact bytes and file hashes are recorded beside `rona-1.0.0.tar.gz`.

## Evidence

Working evidence is saved under `~/.local/share/ezkart-templates/rona/template-verification/`: `quality.json`, screenshots and the real-catalog fixture. The approved recipe, catalog, assets and screenshots are preserved in `cart/admin/templates/rona/preview/`.
