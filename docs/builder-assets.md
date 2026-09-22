# Builder asset gallery

The builder's **Assets** rail opens a searchable library. Essentials contains the existing basic elements. Text, Bulletins, Accordions, Diagrams, and Code artwork each contain three curated compositions. Sections contains all existing section presets and the navigation picker; Saved retains merchant-created reusable code components.

Click an asset to add it to the selected area, or drag it onto a section. Section presets drop before or after the target section. Artwork and uploads go inside the destination, including existing grid sections and native containers. Placement uses the normal selection, inspector, undo/redo, responsive layout, persistence, and export paths.

All 15 artwork presets are ordinary native trees defined in `cart/admin/builder-assets.js`. Text, labels, colors, spacing, borders, and layout remain editable. Code artwork is styled text, not executable code. The gallery renders the same trees as scaled previews outside the page document. New presets should stay few, visually distinct, and useful; keep three per category until there is a reason to expand.

## Uploads

**Uploads** shows reusable account files, existing catalog/media uploads, and embedded images recovered from saved landing-page drafts. Content hashes avoid showing a placed copy of a new upload twice. Search includes upload filenames and originating page names. Refresh reloads the library. Upload files individually, select multiple files, or drop files into the Uploads panel.

The current supported file types are PNG, JPEG, WebP, GIF, and AVIF. Files up to 8 MB can be selected; larger images are optimized, and the stored image must fit the existing 2 MB media limit. Upload failures are shown per file. Gallery uploads are private objects under the seller's `builder-assets/` prefix in R2, with their filename and content hash in metadata. They survive ordinary abandoned-product-image cleanup. The authenticated `/v1/assets` API lists and uploads files; `/v1/assets/:id` retrieves only the active seller's files. Viewer roles can read but cannot upload.

Placing an upload embeds its image bytes in the saved page, matching existing builder uploads. The gallery itself does not make private files public. Page preview and export contain the embedded image and do not need an authenticated library URL. The existing overall page size and publication gates still apply.

The local builder workspace implements the same upload contract using its private `uploads/` folder. No database migration is required for this feature.

## Verification

`tools/builder-mcp/test/assets-library.test.mjs` covers category browsing and search, all 15 preset insertions and mobile fit, actual drag-and-drop into native and existing grid sections, inline editing, keyboard disclosures in export, undo/redo, save/reopen, uploads across pages, and narrow editor controls. Set `EZKART_ASSET_SCREENSHOTS` to a directory to capture gallery and canvas screenshots.

`cloudflare/ezkart-api/test/builder-assets.test.mjs` covers the authenticated upload/list/read API, seller isolation, account media discovery, viewer permissions, exact image bytes, and retention. Run the broader builder suite whenever shared placement or rendering behavior changes.

Validation on 22 September 2026: the three gallery tests and all seven Worker tests passed. The wider builder run passed 76 of 78 checks on its first run. Its obsolete “+ New page” selector was updated to the current accessible name; the seven checks in that file then passed. An intermittent Sela save failure passed on a focused rerun of both Sela checks. PHP syntax checks and the Worker dry build also passed. Gallery previews were inspected at 1600, 941, and 390 px; every preset was checked in desktop and mobile canvas layouts.
