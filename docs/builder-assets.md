# Builder asset gallery

The builder's **Assets** rail opens four libraries: **Elements**, **Sections**, **Uploads**, and **Saved**. A purpose filter replaces the former row of category pills. Search spans all four libraries, including upload filenames and saved components. Controls use the Ezkart coral accent; cards show the designs with short names and descriptions available on hover.

Elements starts with compact essentials, followed by 14 families with three designs each: text, buttons, bulletins, features, reviews, FAQ/accordions, diagrams, pricing/services, numbers/details, people/team, contact, closing invitations, footers, and code artwork. Sections organizes the existing 24 presets and navigation picker by purpose, alongside 27 whole-section versions of the new compositions. Existing quotes, FAQs, and closing sections appear beside their new variants.

The expand button in the Assets header switches between a compact two-column gallery and a wider three-column gallery on desktop. Its preference survives reloads. Width stays within the viewport at narrow sizes, and other builder panels retain their original width. The expansion control, search, library tabs, and purpose filter stay available while scrolling.

Click an asset to add it to the selected area, or drag it onto a section. Section presets drop before or after the target section. Artwork and uploads go inside the destination, including existing grid sections and native containers. Placement uses the normal selection, inspector, undo/redo, responsive layout, persistence, and export paths.

All 42 artwork presets are ordinary native trees defined in `cart/admin/builder-assets.js`. Text, labels, colors, spacing, borders, and layout remain editable. Code artwork is styled text, not executable code. The gallery renders the same trees as scaled previews outside the page document. New presets should stay few, visually distinct, and useful; keep three per family until there is a reason to expand. Whole-section variants wrap the same native composition in a responsive native section and use the ordinary section insertion and history path. Review quotes, names, prices, and statistics are explicit placeholders. Contact and other link buttons are configurable through the normal action inspector. These compositions do not add automatic review collection, form submission, or booking integrations; the existing Embed tool accepts provider widgets. The legacy signup element is labeled “Signup layout” to reflect its behavior.

## Uploads

**Uploads** shows reusable account files, existing catalog/media uploads, and embedded images recovered from saved landing-page drafts. Content hashes avoid showing a placed copy of a new upload twice. Search includes upload filenames and originating page names. Refresh reloads the library. Upload files individually, select multiple files, or drop files into the Uploads panel.

The current supported file types are PNG, JPEG, WebP, GIF, and AVIF. Files up to 8 MB can be selected; larger images are optimized, and the stored image must fit the existing 2 MB media limit. Upload failures are shown per file. Gallery uploads are private objects under the seller's `builder-assets/` prefix in R2, with their filename and content hash in metadata. They survive ordinary abandoned-product-image cleanup. The authenticated `/v1/assets` API lists and uploads files; `/v1/assets/:id` retrieves only the active seller's files. Viewer roles can read but cannot upload.

Placing an upload embeds its image bytes in the saved page, matching existing builder uploads. The gallery itself does not make private files public. Page preview and export contain the embedded image and do not need an authenticated library URL. The existing overall page size and publication gates still apply.

The local builder workspace implements the same upload contract using its private `uploads/` folder. No database migration is required for this feature.

## Verification

`tools/builder-mcp/test/assets-library.test.mjs` covers category browsing and search, all 42 preset insertions and mobile fit, actual drag-and-drop into native and existing grid sections, inline editing, keyboard disclosures in export, undo/redo, save/reopen, uploads across pages, expanded/collapsed browsing, width persistence, whole-section insertion with a single undo, purpose filters shared with existing sections, and narrow editor controls. Set `EZKART_ASSET_SCREENSHOTS` to a directory to capture gallery and canvas screenshots.

`cloudflare/ezkart-api/test/builder-assets.test.mjs` covers the authenticated upload/list/read API, seller isolation, account media discovery, viewer permissions, exact image bytes, and retention. Run the broader builder suite whenever shared placement or rendering behavior changes.

Validation on 22 September 2026: all four gallery checks and the nine required blank-editor, section-action, and grid-snapping checks passed after the expanded catalog changes. The gallery was visually inspected in compact and expanded modes. The broader 81-check builder run initially found an obsolete Heading-label assertion, an explicit-close sidebar hit-area issue, and a concurrent navigation-overlay change. The selector and sidebar behavior were corrected; all affected test files passed focused reruns, including the navigation checks after their separate fix. The API implementation and its seven Worker checks are unchanged by this UI update.
