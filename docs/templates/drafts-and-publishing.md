# Template drafts and publication — 2026-09-16

## Required behavior

A merchant can create, edit, preview and save a template without choosing any
products. Licensed template design imagery may stay on the page. Product cards,
variant choices, prices and cart actions connect to the merchant's selected
catalog products. Unconnected draft purchases are disabled.

**Products → Template products** connects those slots later. A generated baseline
allows the applicator to update catalog fields while preserving edited text,
colors, spacing, added content and deleted elements. It uses ordinary native
constructors, history and persistence. It does not import concept HTML/CSS.
The public `template_products` CLI tool follows the same path.

Publishing requires at least one owned, active product with a purchase control on
the page. A physical product must have positive stock in its base item or a visible
variant. Hidden variants cannot qualify. Digital products and subscriptions retain
the existing active/available behavior because they have no physical stock count.
This digital interpretation was stated while implementing the user's stock rule.

The editor refreshes the catalog before publishing. The Worker independently
queries the authenticated seller's active D1 products and variants. It parses
actual purchase elements in both the draft and published HTML; product IDs in
settings, comments, scripts, hidden ancestors or image-only elements do not count.
The server rejects publication with HTTP 422 before writing the page. Replacing
published HTML also invokes this check even when the request omits `status`.
Autosave can continue on empty or sold-out drafts without replacing the previous
published snapshot. This is a publication gate, not an automatic unpublish action
when normal sales exhaust stock.

## Verification

- All **41 builder tests pass**, plus **2 Worker tests**. The focused draft test
  was repeated after the final form-focus and optional-selection polish.
- The draft flow exercises creation with an empty catalog, late product selection,
  preservation of an edited headline/color, save/reopen, undo/redo, unbinding,
  current stock, hidden variants and all three templates.
- An authenticated Worker integration test uses signed test JWTs, local D1 and R2.
  It rejects another seller's product and forged client stock, allows valid
  publication, rejects later HTML replacement, and preserves the earlier snapshot
  during draft autosaves. No merchant page was published for testing.
- PITH, Sela and Takar were checked as empty drafts and real ZERO product pages at
  320, 390, 768, 1440 and 1920 pixels: no overflow, broken images or script errors.
  Axe WCAG A/AA scans found no violations in the six page states.
- Editor product-panel screenshots and desktop/mobile exports were visually
  reviewed. Sela's design-photo link now points to the collection, instead of
  labeling the template photo as a selected merchant product.
- JavaScript syntax and the Worker deployment build pass. PHP CLI is unavailable
  locally; PHP changes only add the shared script tag and product-panel markup.

## Packages and delivery

| Template | Version | Complete package size |
| --- | --- | --- |
| PITH | 1.1.0 | 4,165,830 bytes |
| Sela | 1.1.0 | 3,822,557 bytes |
| Takar | 1.1.0 | 6,342,262 bytes |

All packages include shared runtime, fonts, design imagery and preview archives,
and pass the enforced 50,000,000-byte ceiling. Original native approval archives
are unchanged. Design assets are copied from those documented sources and remain
separate from fictional preview catalog data. Historical 1.0 validation reports
record their original packaging behavior; this report describes 1.1.

The test Worker deployment is `b19bbe7e-23cf-4d55-93d7-70a8acef5bbd`.
Its health response confirms test D1 and both R2 bindings. UI/template assets are
shipped on `agent/ezkart-workbench` to the test site. No production deployment or
merchant publication is part of this change.
