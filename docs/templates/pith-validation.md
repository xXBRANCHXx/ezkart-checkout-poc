# PITH template validation

Approved source: **PITH — Take a Thip**, native polish v2. The user requested
making this builder version a template on 2026-09-15. The source design and
photography are preserved separately from the applied merchant recipe.

## Application

- New page in both the library and editor offers Blank page and PITH, with a
  design preview, store name and featured catalog product.
- CLI application uses `template_list` / `template_apply`; it requires a blank
  project and uses the same native constructor and normal history/export paths.
- Application is validated before mutation. No catalog products are created or
  changed. Existing pages remain intact. The new page remains a draft.
- Missing descriptions and secondary photos remove their sections and navigation
  links. Unsupported fictional ingredients, comparisons, reviews and policies
  are omitted. Long names wrap; large variant catalogs use a native dropdown.
- The header uses the normal native header role. Its menu remains above content;
  existing sticky/fixed/reference headers retain their tested stacking behavior.
- Local library previews now persist the actual saved design, matching the hosted
  library's normal preview flow.

## Checks

All **35 builder regression tests pass**. Automated browser checks cover creation from both entry points, real catalog
binding, ordinary sidebar text editing, section-color editing, undo/redo,
save/reopen, isolated existing pages, invalid inputs, sparse products, missing
photos, long unbroken names, many variants, sold-out controls, synchronized price
and option state, cart content, and readable responsive exports.

The merchant acceptance run used an isolated copy of the connected ZERO catalog.
It applied PITH through public MCP tools, then checked 320, 390, 480, 768, 1024,
1440 and 1920 CSS pixels. Hero/footer/full-page screenshots were visually reviewed.
Mobile navigation links were clicked, not merely checked for visibility. Selecting
Hazelnut · 550ml updated the real Rp77.000 price and cart line. Closing the cart
restored focus to Add to cart. The shared checkout path was exercised in local
simulation; no live order or payment was submitted.

Both the approved PITH source and the ZERO application passed the actual editor's
Preview at 1440/768/390, variant/photo/price updates, cart, simulated checkout,
Open tab, and closing/reopening Preview. Authored content remained unchanged.

Axe-core's WCAG 2 A/AA and 2.1 AA scan found no violations on the applied merchant
page at 390px. Keyboard controls, menu activation, modal closing/focus restoration
and reduced motion were checked. This is Chromium browser coverage, not a claim
of testing every browser or physical device.

Local unthrottled initial transfer for the merchant application: **745,021 bytes**;
measured CLS: **0**. The demo assets are absent from the applied page. Merchant
photos use the normal catalog media service. Complete package size is recorded
by `tools/templates/package.mjs` including preview media, shared runtime and fonts;
it is approximately **3.7 MB**, under the enforced 50,000,000-byte ceiling.

The concept folder holds the public call log, project/export, size manifest,
archive, screenshots and detailed results under `template-verification/`.
The next concept is queued in the template skill; it has not been started.
