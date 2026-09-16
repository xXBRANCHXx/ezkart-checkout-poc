# Rona (Hue) · 1.0.0

The approved rounded storefront: warm peach gradients, Poppins, spacious product
photography, a sage product story, comparison and practical shopping guidance.
Choose **New page → Rona (Hue)** to begin with an empty product card. Click
**Choose a product** to connect one to three real catalog products.

All content uses ordinary editable native elements. Product names, descriptions,
images, variants, prices and purchase actions come from the selected catalog.
Color choices use editable native swatches; variants without a color mapping show
their names. More than six choices use a dropdown. Missing media and descriptions
are omitted. A single product removes comparison. Product reconnection preserves
authored text, colors, layout and additional content.

The included hero and bathroom photos are editable design imagery. Fictional
product names, dimensions, materials, care claims and simulation notices remain
in the preview archive and do not become merchant claims. Comparison uses real
product photos and descriptions. The shared cart uses normal Ezkart checkout;
only explicit local review fixtures enable simulated checkout.

Draft creation, editing and Preview do not require products. Publishing or
copying/downloading HTML requires an owned, active product with a purchase action
and available stock, verified by the server.

```sh
node tools/builder-mcp/examples/template.mjs rona my-shop - "My shop"
node tools/templates/package.mjs rona /path/to/rona-1.0.0.tar.gz
```

The manifest records the native approval and exact inspection hash. `preview/`
preserves the approved 225-element native inspection, fictional catalog,
photographs, generation prompts, original SVG mark, screenshots and Poppins OFL
license. Asset URLs in the inspection map to archived filenames. Source HTML/CSS
is not imported into applied pages. The package enforces a 50 MB ceiling.

See `docs/templates/rona-template-validation.md` for verification.
