# Melo · 1.0.0

The approved craft-shop design, with warm paper and coral tones, DM Sans, arched
photography and open product cards. Choose **New page → Melo** to start with an
empty product card. **Choose a product** connects one to three catalog products.

The template uses ordinary editable native elements. Product images, names,
descriptions, variant choices, prices and purchase buttons bind to the selected
catalog. Detail dialogs share each card's variant choice. Availability filters
appear when the collection contains both available and sold-out products. The
mint section displays the actual details and prices of up to two products.
Missing photos, descriptions and unused slots are omitted. A single product has
one card and no comparison tabs. Product reconnection preserves merchant edits.

The two included design photos remain editable. Fictional kit names, contents,
measurements, care instructions, shipping promises and demo checkout notices stay
in `preview/`. Applied pages use normal Ezkart checkout and its universal cart.

Drafts can be created, edited, saved and previewed without a product. Publishing
or copying/downloading page code requires an owned, active product with an
available purchase action; physical products require stock. The server validates
ownership and current availability.

```sh
node tools/builder-mcp/examples/template.mjs melo my-shop - "My shop"
node tools/templates/package.mjs melo /path/to/melo-1.0.0.tar.gz
```

The manifest identifies the approved native version and its exact inspection
hash. `preview/` retains the 363-element inspection, fictional catalog, photos,
asset provenance, generation prompts, original logo, screenshots and DM Sans's
SIL license. `asset-map.json` maps review URLs to archived images. The applied
298-element recipe adapts this composition to the merchant's catalog, with no
source HTML/CSS import or template-specific renderer. The package includes the
shared runtime and fonts and enforces the 50 MB limit.

See `docs/templates/melo-template-validation.md` for verification.
