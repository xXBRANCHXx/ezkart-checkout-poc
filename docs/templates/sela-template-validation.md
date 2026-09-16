# Sela template validation

The user approved the native Sela design on 2026-09-16 and requested packaging.
The approval archive retains its exact 10-section, 354-element composition, source
assets, fictional catalog and screenshots. The merchant recipe has up to 298
ordinary native elements; conditional sections depend on actual catalog data.

## Application and commerce

New page → Sela accepts a store name, one featured catalog product and up to three
additional products. Public `template_apply` accepts the same ordered product IDs.
Application validates every binding before mutation, starts on a blank page and
participates in ordinary history, persistence and export. It creates no products
and publishes nothing.

A real ZERO catalog snapshot supplied the acceptance page. Its two independent
products retain their full names, catalog photos, variant selectors and prices.
Selecting Hazelnut · 550ml produces Rp77.000; adding the pair produces two ordinary
cart lines totaling Rp97.000. The shared checkout was tested in simulation; no
live order or payment was submitted.

Fixtures cover one, two, three and four products; missing photos and descriptions;
long product names and an unbroken store name; eight variants; sold-out products;
availability filters; pair selection; USD cents; mixed-currency rejection;
undo/redo; save/reopen; and absence of fictional merchandise in exports. Optional
editorial sections and links disappear without leaving empty placeholders.
A single pair displays without redundant tabs; its initial state remains visible.

## Responsive and interaction review

The applied ZERO page passes 320, 390, 480, 768, 1024, 1440 and 1920 CSS pixels,
including narrow-screen product names and price rows. Hero, product details,
combined purchase, footer and full-page screenshots were reviewed. Mobile menus
and links were activated. Product dialogs, Escape, variant changes, combined cart
and simulated checkout were exercised with reduced motion enabled.

The actual editor Preview passes desktop 1440, tablet 768 and mobile 390. All
images load, independent product state and combined cart work, Open tab renders
the current page, and Preview can be closed/reopened. Authored draft content is
preserved; only derived preview metadata and timestamps are refreshed.

All **38 builder regression tests pass**. The focused Sela tests also verify visible
checkboxes in the product picker, avoiding the legacy hidden-radio styling.
Existing shared native tests cover keyboard tabs, dialog focus restoration,
cart focus, navigation stacking and native sidebar editability. Coverage is in
Chromium, not every browser or a physical-device lab.

## Accessibility, performance and design

Axe-core WCAG 2 A/AA and 2.1 AA scans report **zero violations** on the real merchant
page and open product dialog at 390 and 1440. The local unthrottled merchant
initial transfer is **652,958 bytes**, measured CLS **0**. Merchant media comes
from the normal catalog media service; demo photography is absent from the page.

Complete package: **3,702,713 bytes**, including preview media, shared runtime and
licensed fonts. The build enforces the 50,000,000-byte limit. Rebuilds may change
this exact byte count when shared code changes.

The approved typography, whitespace, restrained palette and collection-to-pair
shopping sequence remain intact. Ordinary merchant photography and sparse data
were reviewed; no gradients, fabricated trust claims, desk-specific demo facts or
policy promises survive application. Section copy describes actual shopping
behavior. The composition remains usable with motion disabled.

The concept folder holds the public CLI call log, applied draft/export, package
manifest, archive and detailed screenshots/reports under `template-verification/`.
The shared assets are delivered through the test branch. Authenticated hosted
page creation is not claimed by these local real-catalog checks.
