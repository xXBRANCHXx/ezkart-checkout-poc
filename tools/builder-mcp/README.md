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
- `element_update`, `product_grid_update`, `navigation_set`, `theme_update`
- `device_set`, `page_audit`, `page_screenshot`
- `undo`, `redo`, `project_save`, `page_export`

A typical session creates a project with catalog product IDs, adds `hero-split` and `product-collection`, configures navigation and a palette, inspects element IDs, edits individual elements, checks all devices, and exports. `page_inspect` lists editable text fields so `element_update` can target a specific FAQ answer, comparison cell, or heading. Layout edits follow `page_inspect`: grid coordinates for grid elements, and pixel offsets with optional width/height for flow elements. Both use the same selection, drag, resize, history, and save controls. `section_update` accepts exact padding per device.

The library has 24 editable section compositions: 15 grid compositions in `cart/admin/builder-components.js` and nine responsive compositions adapted from the user-owned Ezkart.id in `cart/admin/builder-showcase-data.js`. The latter preserve the reference’s DOM layout while exposing native editable content groups; they do not embed the page in an iframe. The five navigation compositions are Studio, Masthead, Centered brand, Shop index, and Essential. Surface, positioning, and scroll behavior remain independently editable in the inspector.

The completed ZERO example can be recreated through the MCP protocol with `node examples/zero-studio.mjs unique-project-id`. It requires the two corresponding ZERO products in the connected catalog and creates a new draft. Every section in that example is native and editable; it does not add a template selector.

`element_update` also accepts `autoHeight: false` when you want a manually sized text element. The inspector exposes the same “Fit height to content” control.

The Ezkart.id reference can be recreated with `node examples/ezkart-id.mjs unique-project-id`. It builds nine native sections through MCP, uses the original marketing illustrations, and attaches no catalog products. Exported fonts and captions are self-contained. Navigation, the responsive demonstration, FAQ disclosures, and the accessible film dialog share their runtime with the editor.

Component thumbnails are screenshots of these actual components, using the existing Ezkart marketing illustration. To regenerate them, run `node scripts/build-previews.mjs` (requires ImageMagick). Its illustrative product fixture exists only in a temporary workspace. To refresh the reference source, run `node scripts/build-showcase.mjs`; an optional directory argument reads a previously retrieved `index.html`, `styles.css`, and `overview-id.vtt` instead. Review any upstream content changes before committing generated files.

## Local behavior

Commands are serialized. Switching projects saves the current project first. Writes use an atomic file replacement. The editor HTTP server listens only on loopback, checks Host and Origin, and requires a random request token for writes. Project IDs cannot escape the workspace directory. Tools return errors for invalid IDs, unsupported edits, and unavailable catalog products.

This server saves local drafts and HTML exports. It does not publish or deploy pages. The native editor can open a project once its JSON is saved to the authorized store's existing landing-page storage. The current local backend supports catalog reads and page saves; cloud uploads and custom-code library writes require the hosted editor.

`page_audit` checks section bounds, missing images, headings, and section destinations. It supplements browser review; it is not a complete accessibility or commerce audit.

## Verification

```sh
npm test
```

Integration tests run the MCP protocol and the real browser editor. They cover persistence across project switches and restarts, history, invalid edits, all native compositions, navigation replacement, panel/canvas fit, responsive export and FAQ expansion, workspace request boundaries, catalog image sizing, native reference editing and duplication, per-device sizing, embedded fonts, navigation, and the film dialog.
