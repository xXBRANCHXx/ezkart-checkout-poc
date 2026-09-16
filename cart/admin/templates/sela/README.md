# Sela · 1.2.0

Approved native design: **Sela**, a whitespace-led product collection with Plus
Jakarta Sans, white and quiet neutral surfaces, clay accents and an editable
product-pair chooser. The exact approved 10-section, 354-element builder recipe,
fictional catalog, screenshots, photography provenance and licensed font are
preserved in `preview/`.

## Apply

Choose **New page → Sela** and start editing. Enter the store name now or later, then choose products from the empty card in the editor. Connect a featured product and up to three more when ready.
The page stays editable
with the ordinary element, section, responsive and product controls. Both the
library and editor use the shared applicator; public CLI tools use the same path.

```
node tools/builder-mcp/examples/template.mjs sela my-collection PRODUCT_A,PRODUCT_B "My store"
```

The recipe uses native elements constructed through `EzkartNative.create`.
It does not import concept HTML/CSS or add custom storefront scripts.

## Catalog behavior

- One to four different active products, all in the same currency.
- Product names, photos, descriptions, prices, variants, availability and cart
  actions bind independently to the selected real catalog products.
- Real descriptions become optional editorial and detail sections. Missing media
  removes the photo and recomposes the layout; it does not leave a placeholder.
- Catalog density adapts to the product count. Availability filters appear only
  when there are both available and sold-out products.
- Two or more products enable the pair chooser. Two products show one pair without
  redundant tabs; three or four products offer two or three choices. Each product
  keeps its own variant selection, and totals use the selected variants' prices.
- Pair purchases add ordinary product lines to the shared floating Ezkart cart.
  Stock validation remains atomic. There are no invented discounts or bundles.
- The store name replaces the demo branding. Fictional desk materials, dimensions,
  packaging, product stories and policies never become merchant content.

The applied page has seven to ten sections depending on available content.
The merchant recipe has at most 298 native elements before optional nodes are
removed. The original composition remains available in the approval archive.

## Provenance and package

`preview/approved-recipe.json` preserves the approved native inspection, including
historical source-local asset URLs. Asset basenames map to `preview/assets/`.
`preview/catalog.json` is a fictional fixture and is never loaded by the
applicator. Generated photographs include prompts and provenance; the authored
SVG logo and Plus Jakarta Sans OFL notice remain with the preview assets.
The fictional preview catalog stays isolated. Licensed artwork copied to `design/` may remain on applied pages.

```
node tools/templates/package.mjs sela /path/to/sela-1.2.0.tar.gz
```

The versioned package includes the shared runtime and fonts. The packager rejects
anything above 50,000,000 bytes. See the repository validation report for measured
commerce, responsive, accessibility and performance checks.

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
