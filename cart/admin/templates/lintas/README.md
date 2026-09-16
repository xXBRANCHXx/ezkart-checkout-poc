# Lintas · 1.0.0

Lintas (Cross) is the approved everyday storefront: spacious photography, DM Sans,
navy accents, a product collection, comparison, shopping questions and footer.
The exact approved 8-section, 356-element native inspection is preserved in
`preview/approved-recipe.json`, with fictional catalog, screenshots and assets.

## Use

Choose **New page → Lintas**. The product section starts with an empty card.
Click **Choose a product** to connect your own catalog. One to three products are
supported; the page uses normal editable builder elements and the shared cart.
Design photos stay editable. Product names, media, descriptions, variants, prices
and purchases come from the selected products.

```sh
# Start an editable draft without products.
node tools/builder-mcp/examples/template.mjs lintas my-store - "My store"
# Or explicitly connect an existing catalog while applying through the CLI.
node tools/builder-mcp/examples/template.mjs lintas my-store PRODUCT_A,PRODUCT_B "My store"
```

`template_products` reconnects products later while preserving authored text,
colors, layout and added content. Publishing and copying/downloading exported
code require an owned, active product with an available purchase action and stock.
The server checks current catalog ownership and stock. Draft save and Preview
remain available without products.

## Adaptation

- Six to eight sections, up to 217 approved-composition elements before optional
  content is removed. The empty card is made from the shared native primitives.
- One product removes comparison. Two or three show actual product photos,
  names, descriptions and prices; mobile has explicit product tabs.
- Missing photos remove media regions. Missing descriptions remove optional copy
  and the product story. Long names wrap. More than six variants use a dropdown.
- Mixed availability enables URL-preserving availability filters. Independent
  variants update each product's prices and add actions.
- Fictional bag dimensions, capacity, materials, care instructions, policies and
  branding remain in the preview archive. They never become merchant claims.
- Design photos in `design/` may remain; product-card and dialog photography
  binds exclusively to real catalog products.

## Approval and provenance

Native approval: “ok, I like it. You know what to do”, after the empty-group hint
fix. The manifest records the exact inspection hash. `preview/` includes the
original generated photo prompts and source-file provenance, authored SVG logos
and scale drawings, and DM Sans with its OFL license. Historical loopback asset
URLs in the approval inspection map by basename to the archived assets.
No concept HTML/CSS is imported into the merchant page.

```sh
node tools/templates/package.mjs lintas /path/to/lintas-1.0.0.tar.gz
```

The enforced 50,000,000-byte limit includes the shared runtime and fonts.
See `docs/templates/lintas-template-validation.md` for verification.
