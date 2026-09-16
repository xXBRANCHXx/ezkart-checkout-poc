# Lane (Lajur) native builder validation

## Source and reconstruction

The user commissioned native reconstruction of revised Lajur version 2, referred to as Lane. This follows the specific rejection of version 1's framed hero and excessive rounded cards. The approved reference is preserved under `~/.local/share/ezkart-templates/lajur/approved-concept/`.

The native page has 11 sections and 563 ordinary elements: open photographic hero, format strip and introduction, three document samples with reading dialogs, three independent catalog products with coordinated license choices, semantic comparison table, usage steps, practical details, FAQ, closing gradient and footer. The page was created through public MCP operations starting with blank sections. No concept HTML/CSS was imported; no custom renderer, script, iframe, project-storage patch or export patch was used.

The canonical native inspection is `native-recipe-review.json`, SHA-256 `d2609e443f8e6a852ee64a22194db411f2ed94f55c76b9faa613bbb737fff13e`. The public recipe, tool-call journal, exports and assets remain in the concept folder.

## Commerce and page copy

The page no longer claims all purchases are simulated. Fictional-shop notices were removed from the storefront, FAQ and policy copy. License prices and purchase buttons bind actual catalog variant IDs, with no hardcoded purchase prices. The license switch changes all three offers together, and adding different license choices produces separate, correctly priced cart items.

The local reconstruction uses an explicitly isolated fictional catalog. Its shared cart identifies simulated checkout before any order action; no real payment or order was submitted. Ordinary merchant storefronts use normal Ezkart checkout. This native review is not yet an installed template: packaging requires approval and will replace the fictional shop catalog with an empty native product card and merchant selection.

Reusable builder additions expose **Variant shown here**, semantic table tags and row/column headers, keyboard-scrollable containers, and vertical tab keys. Missing/hidden fixed variants are unavailable; sold-out fixed variants disable purchase. The server publication/export gate rechecks that particular variant, rather than allowing another stocked variant to qualify a sold-out fixed purchase control.

## Validation

- Responsive exports at 320, 390, 650, 768, 900, 1024, 1440 and 1920 pixels: no page overflow, broken visible images or browser errors. Desktop, tablet and mobile screenshots were visually compared with the approved concept.
- Mobile menu closes after navigation. Sticky navigation remains above later sections. Keyboard tabs, reading dialogs, Escape/focus restoration, the real DOCX download, FAQ, policy dialogs and horizontal table scrolling work.
- Team Proposal Rp249.000 + Team Proyek Rp349.000 + single-business Lengkap Rp329.000 total Rp927.000 in the shared cart. Individual catalog variants remain correctly bound after switching license tabs.
- WCAG A/AA automated checks: zero violations on the page, reading dialog and cart at 390 and 1440 pixels. Reduced motion was enabled for interaction review.
- Ordinary sidebar edits to headline text, word gradient, section background, photo, product/variant and table cell passed; undo/redo, save/reopen, gated export, live Preview at desktop/tablet/mobile, and Open tab passed.
- Full builder regression suite: 47 passing checks. Five relevant checks were rerun after the final shared accessibility changes and passed. Both Worker publication tests passed, including unavailable fixed-variant rejection and authenticated ownership/stock validation.
- Cold local Chromium initial transfer: 1,119,692 bytes at 390px; 1,189,706 at 1440px. Observed CLS: 0 and 0.00233 respectively. These are local measurements, not field results.

## Review links

- Editor: http://127.0.0.1:46372/cart/admin/?page=sites&edit=lajur-native-v1.ezkart.site
- Native export: http://127.0.0.1:46373/

Evidence: `builder/layout.json`, `builder/journeys.json`, `builder/performance.json`, `builder/screenshots/`, and `editor-verification/checks.json` in the Lajur concept folder. The retained editor process keeps the local draft reviewable. No production page was published.

The fixed-variant publication/export validation was deployed to the **test** Worker, version `3871f86d-fc1a-401b-915f-7e3b5a0b6ed5`. Production was not deployed.
