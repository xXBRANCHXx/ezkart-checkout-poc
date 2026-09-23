# Builder font library

The builder ships 36 locally served font families across sans serif, serif, display,
handwriting and monospace styles. The complete WOFF2 catalog is approximately
1.8 MB; the browser requests a font only when it is actually displayed. Picker
previews activate as rows enter the visible list.

`cart/admin/assets/fonts/builder-fonts.json` records files, weights, source URLs,
SHA-256 checksums and the individual SIL Open Font License files. New Latin
subsets support Indonesian and Western European text. Unavailable glyphs use
the normal CSS fallback. Font names are unchanged. Some display families ship a
single regular weight; browsers synthesize other weights/styles when requested.

Run `python3 tools/fonts/sync-builder-fonts.py` to refresh the catalog from Google
Fonts' official CSS service and `google/fonts` license repository. Normal builds
use the committed files and need no network access. To add a family, add its name,
category and supported Google Fonts weight range to the script's `NEW` list, run
it, and review generated files. The script rejects non-WOFF2 files or missing OFL
licenses. `builder-font-faces.css` is generated; picker layout lives separately in
`builder-fonts.css`.

The picker attaches to native typography, legacy element typography and brand
font controls. It writes to their existing change handlers, so history,
responsive contexts, saving and reopening use the existing state model.

The export path calls `EzkartFonts.prepareExport(previewRoot)` before synchronous
HTML generation. It embeds only the families used by page text, brand font
variables, and all stored native responsive/interaction states, plus Poppins for
the base page/cart UI. Every embedded family retains its full license in the CSS.
Opening or scrolling the font picker does not add fonts to an export.

The optional metadata catalog can fail without blocking ordinary canvas editing.
The picker shows the existing Poppins font and retries the catalog when reopened.
Export retries and reports an error if it cannot obtain the necessary catalog or
font assets, avoiding a silently incomplete exported font set.

Run `node --test tools/builder-mcp/test/font-picker.test.mjs` for merchant UI,
keyboard, history, persistence, live preview, export, narrow layout and license
checks.
