# Lintas template validation

## Approved source

The user approved Lintas (Cross) after reviewing its native builder recreation
and the product swatch helper fix. The preserved inspection contains 8 sections
and 356 native elements. SHA-256:
`bfff583a32a171c53637d3514f9cbc591d349e27dec66dcef9af7dde795e30a1`.

The installed recipe uses the common template applicator, editor, CLI, renderer
and cart. It has no template-specific storefront runtime. Merchant adaptation
removes fictional specifications and policies, replaces product imagery and
commerce with real catalog bindings, and retains editable design photography.

## Browser checks

Real ZERO syrup and drops records were applied through the builder. Desktop,
tablet and mobile passed at 320, 390, 560, 768, 1024, 1440 and 1920 pixels, without
horizontal overflow, missing images or browser errors. Full-page and section
screenshots received a separate visual review.

The two real products retain independent variant selections. Hazelnut 550ml
shows Rp77.000; drops shows Rp20.000. The shared cart totals Rp97.000 and completes
the explicitly simulated checkout without placing an order.

Keyboard dialog close restores focus. Mobile navigation and comparison tabs
work. Automated WCAG A/AA checks reported zero violations on the page and product
dialog at 390 and 1440 pixels. Reduced motion remained enabled during the audit.
The cold desktop transfer measured 911,793 bytes; observed CLS was 0.00473.
These are local Chromium measurements, not real-device or field metrics.

Ordinary sidebar text editing, undo/redo, section background, image and layout
edits, save/reopen, live Preview at three sizes, and Open tab passed. Dedicated
regressions cover three products, long unbroken names, missing photos, sparse
copy, sold-out variants, availability filters and URL reload, independent product
choices, single-product adaptation, and empty drafts.

## Empty products and output rules

All four installed templates now start with a clear native empty product card.
The card opens **Products → Template products** in the editor. Empty drafts were
inspected at 320, 390, 768, 1440 and 1920 pixels. Connecting and removing products
preserve authored headline/color changes and work with undo, redo and save.

Publish, Export HTML, Copy HTML, Download HTML and the public CLI export require
an owned active product on the page with available stock. Stock is refreshed
before output; the authenticated Worker validates ownership and stock again for
publication and export authorization. Empty and sold-out drafts still save and
preview. Preview-only renderer access is confined to the loopback test workspace.

The complete builder regression suite passed 44 checks. Both Worker tests passed,
including authenticated export rejection for foreign products, empty pages, stale
stock, and mismatched draft/output purchase elements. The portable cart snippet
passed variant, quantity, custom-content, external HTML fallback and reload checks.

## Evidence

Local working evidence:
`~/.local/share/ezkart-templates/lintas/template-verification/quality.json`,
`screenshots/`, and `exports/lintas-zero-v1.html`;
`~/.local/share/ezkart-templates/lintas/draft-verification/checks.json`.
The native reconstruction report remains `lintas-builder-validation.md`.
Package size and every file hash are recorded alongside `lintas-1.0.0.tar.gz`.
