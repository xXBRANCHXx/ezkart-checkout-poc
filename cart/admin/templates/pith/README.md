# PITH · 1.0.0

Approved design: **PITH — Take a Thip**, native polish v2. The user approved making
this version a template. Its original 14-section, 196-element builder recipe,
review screenshots, fictional catalog, generated photography prompts, SVG
wordmarks and licensed fonts are preserved in `preview/`.

## Apply

Choose **New page → PITH**, enter a store name and select a catalog product.
Preview the fictional design before creating the editable page. The library and
editor use the same application mechanism. CLI clients can use `template_list`
and `template_apply` on a blank project.

`recipe.json` is a composition of the existing native builder types. The shared
applicator substitutes catalog values, omits unavailable optional nodes, validates
the complete composition and constructs it using `EzkartNative.create`. No concept
HTML, source CSS, custom code, screenshots or iframes become page content.

## Merchant data

One active catalog product is required. Names, descriptions, actual photos,
variants, stock, prices and cart/checkout bindings come from that catalog. The
store name replaces both wordmarks. Product and store names remain editable text.
Variant selection is synchronized between all purchase placements. More than six
compact choices use the shared native dropdown.

The bold yellow/ink/ivory palette, condensed headings, asymmetric hero, image
sequence, final purchase, oversized footer wordmark and shared floating cart stay
intact. Long names use a smaller type scale. Product details, second-photo and
third-photo sections appear only when that data exists. Missing photos produce a
purposeful text-and-purchase layout. The fictional recipes, flavor comparison,
reviews and policy claims are omitted: the merchant may add real details through
the normal section and element controls. Applied pages have six to nine sections.

## Preview provenance

`preview/approved-recipe.json` preserves the exact builder inspection used in the
approval archive; its source-local asset URLs are historical references. Their
basenames map to `preview/assets/`. `preview/builder-recipe.json` adds the native header role so the mobile menu keeps the correct navigation layer; `preview/header-update.json` records the public builder calls for that adjustment. `preview/catalog.json` is fictional and is
never loaded by the applicator. Generated bitmap prompts are in
`preview/asset-prompts.json`. SVG logos were authored for the fictional brand.
Anton and DM Sans include their OFL notices. Preview assets never ship to the
customer-facing merchant page.

Build and check the full package, including shared runtime and fonts:

```
node tools/templates/package.mjs pith /path/to/pith-1.0.0.tar.gz
```

The build rejects packages above 50,000,000 bytes. The archive is a versioned
Ezkart package for this builder runtime; it is not a standalone HTML template.
