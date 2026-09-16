# Takar template validation

The user approved the native Takar design on 2026-09-16 and requested packaging.
Its exact 9-section, 395-element native composition is preserved in the approval
archive with the fictional catalog, screenshots, photography provenance and font
license. The merchant recipe contains up to 208 native elements in six to eight
sections, depending on product count and available descriptions.

## Application and commerce

**New page → Takar** takes a store name, one featured product and up to two more
catalog products. Public `template_apply` uses the same applicator, validates
bindings before mutation and participates in ordinary history, save and export.
All generated elements have normal inspector controls and descriptive layer names.
Application creates no products and publishes nothing.

The acceptance page uses two actual ZERO catalog products. Their full product
names, photos, variants and prices remain independently bound. Selecting
Hazelnut · 550ml changes the syrup price to Rp77.000. Adding it with the default
ZERO Drops variant creates two normal cart lines totaling Rp97.000. Checkout was
verified in simulation; no live order or payment was submitted.

Fixtures cover one, two and three products; missing photos and descriptions;
long product names and an unbroken store name; eight variants; sold-out stock;
USD cents; independent choices on different products; undo/redo; save/reopen;
and absence of fictional pantry details in exports. The second product's Large
variant produces $25.75 and a combined $46.25 total with the first product's
selected $20.50 variant. All three product slots support variant selectors.

The comparison section uses the first two actual products. The final purchase
adds those products individually; a one-product page has a single-product action.
Missing data removes optional content and links. Fictional recipes, ingredients,
quantities, claims and policies are isolated in the preview archive.

## Responsive and interaction review

The applied ZERO page passes 320, 390, 480, 768, 1024, 1440 and 1920 CSS pixels
with no overflow or missing images. Hero, product dialogs, comparison, footer and
full-page screenshots were reviewed. Mobile navigation, variant selection, dialog
Escape, combined purchase and simulated checkout work with reduced motion.

The actual editor Preview responds successfully at desktop 1440, tablet 768 and
mobile 390. Product images load, variants update prices, the cart works, Open tab
renders the current page, and Preview can be closed/reopened. Saved authored
content remains unchanged. Preview timestamps/version metadata and ordering of
derived preview class names are excluded from that comparison.

All **40 builder regression tests pass**. Coverage includes native keyboard tabs, dialog focus
restoration, cart focus, navigation stacking, inspector editing and existing
PITH/Sela behavior. Automated execution uses Chromium; these checks do not claim
a complete browser or physical-device lab.

## Accessibility, performance and design

Axe-core WCAG 2 A/AA and 2.1 AA reports zero violations on the real merchant page
and its open product dialog at 390 and 1440. Local unthrottled initial transfer:
**818,261 bytes**. Measured cumulative layout shift: **0**.

Complete package: **6,168,993 bytes**, including shared runtime, preview media
and licensed fonts. The packager enforces the 50,000,000-byte ceiling. Future
shared-code changes may alter this exact byte count.

The approved green typography, wide image, purchase strip, shop shelf and tabbed
interaction remain coherent with ordinary catalog photography. Native controls
provide the entire composition. Restrained surfaces, practical copy and deliberate
spacing carry the design without decorative gradients, fabricated trust claims
or motion-dependent content. No demo assets load on applied merchant pages.

The concept folder holds the public CLI application log, saved merchant project,
export, screenshots, quality report, live Preview report and package manifest under
`template-verification/`. Shared assets are delivered through the test branch;
local real-catalog checks do not claim authenticated hosted page creation.
