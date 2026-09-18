# Ezkart builder MCP

A local MCP server that drives the actual landing-page editor with Playwright. Its tools call the editor's native component, layout, history, persistence, and HTML export operations. Projects remain editable in Ezkart; there is no separate template renderer.

## Setup

Requires Node.js 20+ and Chromium:

```sh
cd tools/builder-mcp
npm ci
npx playwright install chromium
codex mcp add ezkart-builder -- node /absolute/path/to/Ezkart/tools/builder-mcp/server.mjs
```

Restart the Codex session to discover the registered tools. Other MCP clients can launch the same command with stdio transport. See the [official MCP server SDK](https://ts.sdk.modelcontextprotocol.io/server) and [Codex MCP setup](https://learn.chatgpt.com/docs/extend/mcp?surface=cli).

`EZKART_WORKSPACE` overrides the default `~/.local/share/ezkart-builder`. `EZKART_HEADED=true` displays Chromium; `EZKART_PORT` optionally fixes the loopback editor port. Projects are JSON files under `projects/`; generated storefronts go under `exports/`.

## Catalog and checkout

Place `catalog.json` in the workspace with the same product objects returned by the authenticated Ezkart `/v1/catalog` endpoint. Include:

```json
{
  "products": [],
  "storageScope": "your-store-checkout-scope",
  "mediaBase": "https://your-test-api.example",
  "publicBase": "https://your-test-store.example/cart/admin/"
}
```

`mediaBase` resolves catalog media. `publicBase` supplies the real checkout origin and fallback font URLs for standalone exports. Set it before exporting a storefront for use outside this local workspace. Only product IDs in this catalog can be attached to a project. Catalog data is supplied explicitly; the server does not read browser cookies or cloud credentials.

## Tools

- `catalog_list`, `project_list`, `project_create`, `project_open`
- `component_list`, `page_inspect`
- `section_add`, `section_update`, `section_move`, `section_remove`
- `native_add`, `native_update`, `native_inspect`, `native_move`
- `element_add`, `element_update`, `product_grid_update`, `navigation_set`, `theme_update`
- `device_set`, `page_audit`, `page_screenshot`
- `undo`, `redo`, `project_save`, `page_export`

A typical session creates a project with catalog product IDs, adds `hero-split` and `product-collection`, configures navigation and a palette, inspects element IDs, edits individual elements, checks all devices, and exports. `page_inspect` lists editable text fields so `element_update` can target a specific FAQ answer, comparison cell, or heading. Layout edits follow `page_inspect`: grid coordinates for grid elements, and pixel offsets with optional width/height for flow elements. Both use the same selection, drag, resize, history, and save controls. `section_update` accepts exact padding per device.

The library has 24 editable section compositions: 15 grid compositions in `cart/admin/builder-components.js` and nine responsive compositions adapted from the user-owned Ezkart.id in `cart/admin/builder-showcase-data.js`. The latter preserve the reference’s DOM layout while exposing native editable content groups; they do not embed the page in an iframe. The five navigation compositions are Studio, Masthead, Centered brand, Shop index, and Essential. Surface, positioning, and scroll behavior remain independently editable in the inspector.

The completed ZERO example can be recreated through the MCP protocol with `node examples/zero-studio.mjs unique-project-id`. It requires the two corresponding ZERO products in the connected catalog and creates a new draft. Every section in that example is native and editable; it does not add a template selector.

`element_update` also accepts `autoHeight: false` when you want a manually sized text element. The inspector exposes the same “Fit height to content” control.

**Legacy reference import:** the previous Ezkart.id remake used source-derived HTML/CSS registered as components. That preserves the appearance but does not demonstrate construction from the builder’s ordinary controls. Keep it for compatibility with saved drafts; do not use it as the builder-only authoring example.

The current Ezkart.id reconstruction uses `node examples/ezkart-id.mjs unique-project-id`. It starts with blank sections and calls `native_add` for typed containers, rich text, buttons, icons, images, accordions and video. The editable recipe is `examples/ezkart-native.json`; it contains content and inspector properties, without source HTML, CSS selectors, source classes, or custom JavaScript. The example records its public MCP calls under workspace `logs/` and creates a new draft, refusing to overwrite an existing project.

The **Flexible elements** group in Add exposes these same primitives. Their inspector includes:

- Nested flex/grid containers, exact sizing, margins, padding, alignment, positioning and container sizing.
- Rich text ranges: select words on the canvas or in the Text field, then apply a solid color or gradient. Other words keep their existing style.
- Background or text gradients with up to eight layers and twelve stops per layer, editable angles, radial centers and stop positions. These fills apply to buttons too.
- Custom minimum/maximum width breakpoints and named interaction states, with separate responsive overrides for each state.
- Show/hide controls, state switches, links, accordions, accessible video dialogs and play/pause controls. Video includes poster, captions URL or embedded WebVTT, loop, mute and autoplay controls.
- Proportional composition scaling and scroll tilt/travel that respect reduced motion.

Canvas and inspector appearance edits default to **All screen sizes** in desktop
preview, **Tablet only** in tablet preview, and **Mobile only** in mobile preview.
Switching previews restores that preview's default. Choose **Desktop only** when
a desktop change should stay independent. Text, images and links stay shared.
**All screen sizes** changes a property everywhere, including removing its
existing overrides. Section height handles remain specific to the active preview.
Managed device rules live in `responsive` with a `device` marker and render after
authored breakpoints: mobile through 600px, tablet above 600px through 900px, and
desktop above 900px. Existing template rules remain intact until edited.
Programmatic `native_update` still edits base properties or explicitly supplied
responsive rules.

### Product controls for custom layouts

Add → **Product control** exposes catalog-bound images, variant choices, selected
names/descriptions/prices, add-to-cart buttons and cart buttons as separate native
elements. Use `native_add` with `type: "commerce"`, a `productId`, and a `part` of
`image`, `options`, `title`, `description`, `price`, `quantity`, `availability`, `add` or `cart`. Layout and
typography use the same `props` and `responsive` controls as other elements.

Set the same `group` on controls that should share variant and quantity choices. The product ID is
also part of that connection: placing a different product with the same group
does not change the first product. Leave `group` blank for independent selections.
The inspector exposes the group, product, label, `optionLayout` (`compact`, `cards`, `detailed`, `select` or `swatches`),
price prefix/suffix and `showPrice` on purchase buttons. These controls export
through the existing cart and checkout flow; they contain no custom page code.

**Quantity selector** (`part: "quantity"`) provides labeled minus/plus buttons and
an editable whole-number field. It clamps to the selected physical variant's stock,
disables sold-out choices, and shares quantities with purchase buttons in the same
product/group. Quantities remain independent between variants and products.
The shared cart adds the exact quantity or reports that the remaining stock is
insufficient; it does not silently add fewer items. **Stock availability**
(`part: "availability"`) shows the configured label for available stock and
“Sold out” otherwise. **Side by side with prices** (`optionLayout: "cards"`)
shows variant names and prices in compact cards. `detailed` keeps stacked descriptions.
Text-only product controls can use `tag: "span"` inside a native heading or table cell.

Color swatches use `variantColors`, a map of actual variant IDs to six-digit hex
colors, for example `{"peach":"#dda385","sage":"#a5b19a"}`. The inspector
provides a color picker for each visible variant and **Use name** to return to a
text choice. Unmapped variants keep their readable names. Swatches use native
radio controls with 44px targets, keyboard selection and a visible selected name.
Changing the connected product in the inspector clears its old color mapping.

**Variant shown here** pins an image, price, name, description or purchase button
to a real catalog variant. Set `variantId` to that variant's ID, or leave it empty
to follow the shopper's choice. This supports side-by-side sizes, licenses and
pack options without hardcoded prices. Missing or hidden variants are unavailable;
sold-out physical variants disable purchase. Changing the connected product in
the inspector clears the old variant. Publication and export recheck that specific
variant's availability and ownership on the server.

Native comparison tables use container tags `table`, `thead`, `tbody`, `tfoot`
and `tr`, plus text tags `th`, `td` and `caption`. Set matching Layout → Display
values (`table`, `table-row`, `table-cell`, etc.). `tableScope: "row" | "col"`
identifies a header; the inspector exposes **Table header for**. Table layout,
border collapse and spacing are ordinary property controls. Containers with
scrolling overflow become keyboard-focusable; add an accessible label to give a
scrollable comparison region a useful name.

New templates use the [shared floating cart](../../docs/storefront-cart-pattern.md)
outside navigation. The exporter supplies it when no merchant-placed cart control
exists. It uses the shared drawer, maintains its item count and stays clear of
native fixed purchase bars and ordinary catalog purchase controls.

### Tabs, filters, dialogs and product sets

Containers expose **Advanced settings → Tabs & filters**. Set `initialState`,
`stateMode` (`tabs` or `filter`) and an optional `stateParam` to remember a filter
in the URL. Buttons use `action: {type: "state", scope: "container-id", target:
"version"}`. Elements whose alternate appearances follow that container use
`stateScope`; a tab panel also sets `statePanel` to its version name. Separate
groups keep independent choices, including after duplication. Tabs support
arrow keys, Home/End, and correctly connected accessible panels. State actions can set
`disableWhenActive: true` (Click action → Disable when this state is selected)
for bounded controls such as one/two-portion selectors. Focus moves to an enabled
sibling when the selected button becomes disabled. If a state change hides its trigger,
focus moves to an available visible control in the same group.

Links can reset a filtered group before navigating. In **Click action**, choose
**Open link**, enter the **Interaction group ID**, and set **Show group version
before opening link**. The tool model is
`action: {type: "link", target: "#product", scope: "collection", revealState: "all"}`.
This reveals the destination before anchor scrolling and updates the group's URL
choice without changing unrelated tabs or filters.

Choose the `dialog` HTML element on a native container under **Structure &
accessibility**, then use **Click action → Open dialog / Close dialog** with its
ID. Fill it with ordinary editable text, images and product controls. Alt-click
opens it modelessly in the editor, allowing sidebar edits. Storefront dialogs
use modal focus, Escape/backdrop dismissal, scroll locking and focus restoration.
An anchor provides direct URL access. An editor-open dialog exports closed.

**Product control → Show** includes **Product name**, **Combined price** and
**Add a set of products**. Select the included catalog products using the
checkboxes. Public tools expose `productIds`, with the same `group` used by
individual variant controls. Set purchase buttons can display their total with `showPrice: true`.
Prices sum the selected variants; unavailable or
mixed-currency sets disable purchase. Adding a set creates separate ordinary
cart lines, and a stock limit rejects the whole addition without partial changes.
Plus Jakarta Sans is bundled under its included SIL license and embedded in
ordinary exports when used. Typography exposes `fontOpticalSizing: "auto" | "none"`
so a variable font can preserve a chosen design size instead of changing its shapes
as heading sizes grow.

Native containers also expose **Show while scrolling**. `scrollVisibility` accepts
an `after` element ID and `hideWhile` IDs. Combined with ordinary fixed positioning,
this supports an editable purchase bar that hides around other purchase controls.
The exporter uses the browser's popover layer for fixed bars and hides them while
the cart is open. Native sticky headers retain their configured stacking order.

Anton, DM Sans, Plus Jakarta Sans and Manrope are available in the native font field alongside Poppins.
Licensed font files are embedded in exports when used.

For a **local fictional concept only**, the explicit workspace catalog may set
`demoCheckout: true`, `currency` and `locale`. Product media uses the normal
`media: [{id}]` and variant `imageUploadId` fields, resolved against `mediaBase`.
Demo checkout collects no payment or personal information and never navigates to
a live checkout. These workspace settings do not change a hosted merchant store.

`native_inspect` returns the hierarchy and saved control values. `native_update` edits those values, and `native_move` reparents a node. Canvas selection, drag/resize, duplication, history, save/reload and export use the same typed model. The native section exporter preserves its own spacing and breakpoints instead of applying grid defaults.
Component thumbnails are screenshots of these actual components, using the existing Ezkart marketing illustration. To regenerate them, run `node scripts/build-previews.mjs` (requires ImageMagick). Its illustrative product fixture exists only in a temporary workspace. To refresh the reference source, run `node scripts/build-showcase.mjs`; an optional directory argument reads a previously retrieved `index.html`, `styles.css`, and `overview-id.vtt` instead. Review any upstream content changes before committing generated files.

## Authoring from a blank canvas

Run `node examples/buatanmu.mjs unique-project-id` to create the original Ezkart page using only public MCP calls. The example adds empty sections and individual native elements, plus the ordinary Studio navigation. It supplies content, images, links, palette values and grid positions; no page HTML, CSS, iframe or source-derived component. Its call log is saved under `logs/` in the workspace.

- `section_add` with `component: "blank"` matches Add → Blank section.
- `element_add` matches the Add panel's native heading, text, button, image, divider, marquee and navigation elements.
- Section background → Gradient exposes linear, radial and soft blends, two colors, base color, angle, strength and radial center. `section_update.gradient` uses those same saved values. The old imported closing gradient migrates into these controls when opened.
- Typography exposes heading levels, vertical alignment and separate font sizes for desktop, tablet and mobile. `element_update.headingLevel`, `style.alignItems` and device-specific `style.fontSize` match those controls.
- `element_update.action`, `buttonRole`, `inset` and logo `src` expose the existing link, button role, padding and logo image settings.
- Fit height to content works in blank sections as well as compositions, including exported text wrapping and buttons. Section anchors, solid colors and responsive type survive export.

## Local behavior

Commands are serialized. Switching projects saves the current project first. Writes use an atomic file replacement. The editor HTTP server listens only on loopback, checks Host and Origin, and requires a random request token for writes. Project IDs cannot escape the workspace directory. Tools return errors for invalid IDs, unsupported edits, and unavailable catalog products.

This server saves local drafts and HTML exports. It does not publish or deploy pages. The native editor can open a project once its JSON is saved to the authorized store's existing landing-page storage. The current local backend supports catalog reads and page saves; cloud uploads and custom-code library writes require the hosted editor.

The editor's **Preview** button renders the current canvas through the same
sandboxed preview shell as the hosted editor, including changes made since the
last save. Desktop, tablet, mobile and **Open tab** work locally. Configure
`mediaBase` to allow images and video from a separate local asset server in the
embedded preview.

`page_audit` checks section bounds, missing images, headings, and section destinations. It supplements browser review; it is not a complete accessibility or commerce audit.

## Verification

```sh
npm test
```

Integration tests run the MCP protocol and the real browser editor. They cover persistence across project switches and restarts, history, invalid edits, all native compositions, navigation replacement, panel/canvas fit, responsive export and FAQ expansion, workspace request boundaries, catalog image sizing, native reference editing and duplication, per-device sizing, embedded fonts, navigation, and the film dialog.

## Installed landing-page templates

**New page** in both the editor and landing-page library offers a blank canvas or
an installed template. PITH supports one featured product, Sela one to four, and
Takar one to three. Product selection is optional for drafts. Enter a store name
now or edit it later; the composition uses ordinary native elements.
Unsupported demo recipes, claims and policies are omitted. Every purchase
placement shares the real product's variant selection and Ezkart cart.

CLI example (uses the catalog in `EZKART_WORKSPACE`):

```sh
node examples/template.mjs pith my-launch REAL_PRODUCT_ID "My store"
node examples/template.mjs sela my-collection PRODUCT_A,PRODUCT_B "My store"
```

This calls `project_create`, `template_apply`, `project_save`, `page_export` and
`page_audit` and saves a tool-call log. `template_list` describes installed designs
and their catalog requirements. Pass `productIds` in display order, with the featured product first; legacy `productId` remains supported. All selected products must use the same currency. `template_apply` requires a blank page, validates
all content before applying, and participates in normal undo/redo. It never
changes the catalog or publishes a page. Read [Sela's package notes](../../cart/admin/templates/sela/README.md) or [PITH's package notes](../../cart/admin/templates/pith/README.md)
for the approved design, provenance, merchant-data behavior and package command.

### Product-free template drafts

All templates can be applied with `productIds: []`. The CLI example accepts `-`
in place of its product-ID argument. These are private editable drafts. Licensed
template design images remain, and purchase slots wait for a real product.
`template_products` connects selected catalog IDs later while preserving design
edits. The editor exposes the same action in **Products → Template products**.
Publication requires an owned active product on the page with an available
purchase action; physical products need stock in a visible variant or the base
product. The Worker rechecks the authoritative catalog on every publish request.
