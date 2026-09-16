# PITH · 1.2.0

Approved design: **PITH — Take a Thip**, native polish v2. The user approved making
this version a template. Its original 14-section, 196-element builder recipe,
review screenshots, fictional catalog, generated photography prompts, SVG
wordmarks and licensed fonts are preserved in `preview/`.

## Apply

Choose **New page → PITH** and start editing. Store name and product selection
can be filled in now or later.
Preview the fictional design before creating the editable page. The library and
editor use the same application mechanism. CLI clients can use `template_list`
and `template_apply` on a blank project.

`recipe.json` is a composition of the existing native builder types. The shared
applicator substitutes catalog values, omits unavailable optional nodes, validates
the complete composition and constructs it using `EzkartNative.create`. No concept
HTML, source CSS, custom code, screenshots or iframes become page content.

## Merchant data

One active catalog product is required for publishing. Drafts need no product selection. Names, descriptions, actual photos,
variants, stock, prices and cart/checkout bindings come from that catalog. The
store name replaces both wordmarks. Product and store names remain editable text.
Variant selection is synchronized between all purchase placements. More than six
compact choices use the shared native dropdown.

The bold yellow/ink/ivory palette, condensed headings, asymmetric hero, image
sequence, final purchase, oversized footer wordmark and shared floating cart stay
intact. Long names use a smaller type scale. Product details appear when supplied;
licensed lifestyle and packaging photographs remain available. Missing catalog photos produce a
purposeful product-and-purchase layout. The fictional recipes, flavor comparison,
reviews and policy claims are omitted: the merchant may add real details through
the normal section and element controls. Applied pages have eight to nine sections.

## Preview provenance

`preview/approved-recipe.json` preserves the exact builder inspection used in the
approval archive; its source-local asset URLs are historical references. Their
basenames map to `preview/assets/`. `preview/builder-recipe.json` adds the native header role so the mobile menu keeps the correct navigation layer; `preview/header-update.json` records the public builder calls for that adjustment. `preview/catalog.json` is fictional and is
never loaded by the applicator. Generated bitmap prompts are in
`preview/asset-prompts.json`. SVG logos were authored for the fictional brand.
Anton and DM Sans include their OFL notices. The fictional catalog stays isolated. The licensed lifestyle and packaging
photographs in `design/` may remain on merchant pages.

Build and check the full package, including shared runtime and fonts:

```
node tools/templates/package.mjs pith /path/to/pith-1.2.0.tar.gz
```

The build rejects packages above 50,000,000 bytes. The archive is a versioned
Ezkart package for this builder runtime; it is not a standalone HTML template.

## Drafts and publication

You can choose this template and start editing with no products selected. Use
**Products → Template products** later to connect your catalog. That updates the
shop slots while preserving authored headlines, layout, colors and added content.
The template's licensed design photos remain editable; product cards and purchase
controls use the selected catalog products.

Publishing and exporting code require at least one owned, active product with a purchase action on
the page and available stock (including visible variants). Stock and ownership
are rechecked on the server. Digital products and subscriptions use their existing
availability behavior. An empty or sold-out draft can still be saved and previewed.

For a product-free CLI draft, use `-` instead of product IDs. After editing, call
`template_products` with real product IDs to connect the slots without rebuilding
the design. Original approval archives remain unchanged.

## Empty product card and code export

New pages now start with an empty product card. Click **Choose a product** to
connect your catalog in the editor. Design and Preview work without products.
Publishing, copying HTML, downloading HTML and public CLI export require an
owned active product with stock. The server rechecks both ownership and stock.
The `productSlot` manifest field identifies the editable native card.
