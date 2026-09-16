# Takar · 1.0.0

Approved native design: **Takar**, an approachable storefront with DM Sans,
restrained green accents, a wide hero image, a product shelf and a tabbed shopping
section. The exact approved 9-section, 395-element builder recipe, fictional
catalog, screenshots, image provenance and licensed font remain in `preview/`.

## Apply

Choose **New page → Takar**, enter your store name, select a featured catalog
product and optionally add two more products. The page remains editable with
ordinary section, element, responsive and product controls. The editor, page
library and public CLI all use the same native applicator.

```
node tools/builder-mcp/examples/template.mjs takar my-store PRODUCT_A,PRODUCT_B "My store"
```

The recipe instantiates ordinary `EzkartNative.create` elements. It does not import
concept HTML/CSS or add custom storefront scripts.

## Catalog behavior

- One to three different active products, all in the same currency.
- The first product supplies the featured image and purchase strip. Every product
  has its own real catalog photos, name, description, variants, price and stock.
- Variant selectors appear wherever a selected product has variants, including
  the second and third cards and their product dialogs.
- Missing images remove photo regions and recompose the layout. Missing
  descriptions remove optional text and the featured product story.
- Two or more products enable the tabbed comparison of the first two products.
  The shelf and individual dialogs present every selected product.
- The final purchase adds the first two products as ordinary cart lines, with a
  total calculated from their independently selected variants. With one product,
  it becomes a normal single-product purchase. There is no invented discount.
- Purchases use the shared Ezkart floating cart and normal checkout. Combined
  purchases validate stock before adding either product.
- Merchant branding replaces the fictional wordmark. Demo ingredients, recipes,
  quantities, food claims and policies never become merchant content.

The applied page has six to eight sections and up to 208 native elements before
optional nodes are removed. The fictional recipe section becomes a useful
comparison of actual products. Layer names describe those merchant elements.

## Provenance and package

`preview/approved-recipe.json` preserves the exact native approval inspection,
including historical source-local asset URLs. Asset basenames map to
`preview/assets/`. The fictional `preview/catalog.json` is never loaded by the
applicator. Image prompts and provenance accompany the generated photographs;
the authored logo and DM Sans OFL notice remain with the archived assets.
Applied merchant pages do not load demo assets.

```
node tools/templates/package.mjs takar /path/to/takar-1.0.0.tar.gz
```

The package includes shared runtime and licensed fonts. Its enforced limit is
50,000,000 bytes. The repository validation report documents the real-catalog,
responsive, accessibility, commerce and editor Preview checks.
