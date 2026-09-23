# Builder font library

The builder ships 200 locally served font families across sans serif, serif, display,
handwriting and monospace styles. The complete WOFF2 catalog is approximately
6.5 MB; the browser requests a font only when it is actually displayed. Picker
previews activate as rows enter the visible list.

`cart/admin/assets/fonts/builder-fonts.json` records files, weights, source URLs,
SHA-256 checksums and the individual SIL Open Font License files. New Latin
subsets support Indonesian and Western European text. Unavailable glyphs use
the normal CSS fallback. Font names are unchanged. Some display families ship a
single regular weight; browsers synthesize other weights/styles when requested.

Run `python3 tools/fonts/sync-builder-fonts.py` to add configured families from
[Google Fonts’ official CSS service](https://developers.google.com/fonts/docs/css2)
and the [google/fonts license repository](https://github.com/google/fonts). Cached
files are checked against their SHA-256 values; use `--refresh` to redownload them. Normal builds
use the committed files and need no network access. To add a family, add its name,
category and supported Google Fonts weight range to the script's `NEW` list, run
it, and review generated files. The script rejects non-WOFF2 files or missing OFL
licenses. `builder-font-faces.css` is generated; picker layout lives separately in
`builder-fonts.css`. Its import URL changes with the generated declarations so
returning editors receive newly added fonts despite the hosted CSS cache. The script’s `FEATURED` list sets the opening order; the
remaining families are alphabetical. The collection has 50 sans serif, 40 serif,
50 display, 40 handwriting and 20 monospace families.

The picker uses a 640px desktop window with two preview columns and switches to
one column on narrow screens. Category names are rendered in representative
fonts in both native and fallback dropdowns. Arrow keys follow the preview grid,
and only the active font option joins the Tab sequence.

The picker attaches to native typography, legacy element typography and brand
font controls. It writes to their existing change handlers, so history,
responsive contexts, saving and reopening use the existing state model.

The export path calls `EzkartFonts.prepareExport(previewRoot)` before synchronous
HTML generation. It embeds only the families used by page text, brand font
variables, and all stored native responsive/interaction states, plus Poppins for
the base page/cart UI. Every bundled family retains its full license in the CSS.
Opening or scrolling the font picker does not add fonts to an export.

The optional metadata catalog can fail without blocking ordinary canvas editing.
The picker shows the existing Poppins font and retries the catalog when reopened.
Export retries and reports an error if it cannot obtain the necessary catalog or
font assets, avoiding a silently incomplete exported font set.

Run `node --test tools/builder-mcp/test/font-picker.test.mjs` for merchant UI,
keyboard, history, persistence, live preview, export, narrow layout and license
checks, including browser decoding for every family.

The persistent “Upload a font” control accepts WOFF2, WOFF, TTF and OTF files up
to 5 MB. The browser verifies it can decode the file before uploading it through
`POST /v1/fonts`. The API checks file signatures, container lengths and table
bounds, then stores the file in the account's private R2 prefix. SHA-256 IDs
reuse repeated uploads. Font filenames become readable labels; a separate stable
CSS family name prevents conflicts with bundled fonts or similarly named files.
No font files are placed in the image asset library.

`GET /v1/fonts` supplies the account's “Your fonts” filter across pages and devices.
Faces are registered using the CSS Font Loading API and fetched only when used.
The existing page state saves the selected family. Preview, publication and HTML
export embed each used upload as a data URL, with no private asset URL or account
authentication needed to view the exported page. Imported files remain private in
the reusable library. A missing used font blocks export with a recoverable error.

Import checks: `node --test tools/builder-mcp/test/font-import.test.mjs` and
`node --test cloudflare/ezkart-api/test/builder-fonts.test.mjs`. They cover all four
formats, invalid and oversized files, failed requests, deduplication, ownership,
viewer restrictions, save/reopen, another page in a fresh browser session and an
offline exported preview. Synthetic format fixtures can be regenerated with the
Python script alongside them using `fonttools[woff]`.
