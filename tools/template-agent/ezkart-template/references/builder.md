# Recreate a concept through the real builder

Read this for step two. Resolve `repo` to the Ezkart checkout. Read `tools/builder-mcp/README.md`, then inspect the live tool schemas and relevant native element definitions. The MCP server drives the actual editor with Playwright; its tools call the same editing model as the canvas and inspector.

## CLI access

Use installed `ezkart-builder` MCP tools if available. For command-line authoring, create a Node `.mjs` driver that launches `tools/builder-mcp/server.mjs` with the MCP SDK. The existing `tools/builder-mcp/examples/ezkart-id.mjs` demonstrates this transport and a typed element recipe. Study the driver, not its visual design. Do not use the older source-import workflow or clone the example storefront.

Dependencies live under `tools/builder-mcp/node_modules`; install them with `npm ci` in that directory if absent. If the authoring driver lives in the concept folder, resolve the SDK explicitly from the repository so imports work:

```js
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import { join } from 'node:path';

const repo = process.env.EZKART_REPO;
if (!repo) throw new Error('Set EZKART_REPO to the Ezkart checkout.');
const resolve = createRequire(join(repo, 'tools/builder-mcp/package.json'));
const { Client } = await import(pathToFileURL(resolve.resolve('@modelcontextprotocol/sdk/client/index.js')));
const { StdioClientTransport } = await import(pathToFileURL(resolve.resolve('@modelcontextprotocol/sdk/client/stdio.js')));
const client = new Client({ name: 'ezkart-template-author', version: '1.0.0' });
await client.connect(new StdioClientTransport({
  command: process.execPath,
  args: [join(repo, 'tools/builder-mcp/server.mjs')],
  env: { ...process.env, EZKART_WORKSPACE: process.env.EZKART_WORKSPACE },
}));
try {
  // Invoke public tools with client.callTool({ name, arguments }, undefined,
  // { timeout: 180000 }). Check isError; persist every successful call.
  // Author and verify the native draft here, then project_save and page_export.
} finally {
  await client.close();
}
```

Run the completed driver with a dedicated workspace:

```bash
EZKART_REPO="$repo" EZKART_WORKSPACE="$concept_dir/builder" node "$concept_dir/author.mjs"
```

Record each tool call as it succeeds, not just after the entire build, so failed runs can be inspected and resumed. Use new project IDs for new reconstructions; use `project_open` for deliberate revisions. Do not rerun creation over an existing draft. Tool failures stop dependent calls until corrected.

## Data and composition

- `catalog_list` reads only the workspace's explicit catalog. Use a dedicated preview-only `catalog.json` for fictional products if the reconstruction still needs them. This catalog fixture is separate from page state and must never replace a merchant's catalog. For applied-template testing, configure real catalog data as described in the README.
- `project_create` starts a draft with the selected product IDs. `section_add` with `component: "blank"` creates empty sections. `native_add` builds typed containers, headings, text, buttons, images, product cards, accordions and other supported elements. `native_update` changes their existing inspector properties, fill, responsive rules and actions.
- Build nested flex/grid layouts and content-driven heights where appropriate. Raw inspector properties such as `paddingTop`, `gridTemplateColumns` and breakpoint values are allowed; CSS selectors, source classes, style sheets and custom scripts are not.
- `navigation_set`, `theme_update`, `section_update`, `native_move` and product controls are useful public operations. Use `native_inspect` and `page_inspect` to confirm saved structure. Use meaningful section and element names so the resulting sidebar makes sense.
- Retain native product cards and real product bindings; do not recreate commerce as disconnected text, prices and decorative buttons. Check independent product placement, long names, variants and content-driven card height.
- Use `project_save` and `page_export`. Do not write project storage by hand, alter exports to improve fidelity, or add template-only rendering code. A generated export is evidence of the builder's output, not the source to edit.

## Review and handoff

`device_set`, `page_screenshot` and `page_audit` help inspect the draft, but do not replace visual and interaction checks. Wait for device frame transitions before measuring geometry. Test the exported storefront at the exact widths required by the design brief, including navigation overlap and every product action. Check saved/reopened UI editability as well as visual fidelity.

The MCP editor is local and its URL lasts only while the server process stays alive. For an interactive review, keep a driver/MCP session running, use `EZKART_PORT` if a stable port is useful, and open the actual local editor URL. `EZKART_HEADED=true` shows the automation browser; it does not keep that browser alive after the client closes. A standalone export can be served persistently with the skill's preview helper after placing its HTML and required assets in a separate review directory. Do not say a closed editor URL is ready for review.

The existing server creates local drafts and exports, not cloud deployments. Keep local status clear. If the user requests a hosted test draft, use the authorized store's supported save/import workflow. Do not invent a publishing command or write into production storage.
