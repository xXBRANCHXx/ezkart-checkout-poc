# Soft Signal · 1.0.0

An evening storefront with deep blue, warm paper, rust accents, Manrope and
photographic scenes. Choose **New page → Soft Signal** to start with an empty
product card. **Choose a product** connects one or two catalog products.

The template uses ordinary editable native elements. Product tabs, names,
descriptions, photos, variants, availability, quantities and prices bind to the
selected catalog. Each product remembers its own choices in the universal cart.
The comparison shows actual availability and the selected option's price.
The first available product is shown initially. Missing photos and descriptions
are omitted; a product without a photo uses the full shopping area. One product
removes the selector and comparison. Reconnecting products preserves design edits.

The two included scene photos remain editable, and the scene's brightness buttons
still work. The copy identifies this as a photo preview. Fictional lamp features,
specifications, product images and review policies remain in `preview/`. Applied
pages use the merchant's catalog and normal Ezkart checkout.

Drafts can be created, edited, saved and previewed without a product. Publishing
or copying/downloading page code requires an owned, active product with an
available purchase action; physical products require stock. The server validates
ownership and current availability.

```sh
node tools/builder-mcp/examples/template.mjs soft-signal my-shop - "My shop"
node tools/templates/package.mjs soft-signal /path/to/soft-signal-1.0.0.tar.gz
```

The manifest identifies the approved native version and exact inspection hash.
`preview/` retains the 338-element inspection, fictional catalog, design and
product photos, asset provenance, generation prompts, logos, screenshots and
Manrope's SIL license. `asset-map.json` maps review URLs to archived assets. The
applied recipe has 266 native elements before conditional adaptation. There is
no source HTML/CSS import or template-specific renderer. Packaging includes the
shared runtime and fonts and enforces the 50 MB ceiling.

See `docs/templates/soft-signal-template-validation.md` for verification.
