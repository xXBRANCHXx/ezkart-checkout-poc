# Sela native builder review

Sela recreates the approved desk-accessories concept with 10 native sections and
354 editable elements. It is a local builder draft awaiting review, not an
installed template. No production page was published.

## Authoring and design

The CLI driver calls public builder MCP operations: blank sections, native
containers, headings, rich text, images, commerce controls and disclosures.
There is no imported concept markup, stylesheet, iframe, source-derived component
or patched export. The fictional four-product catalog is isolated from merchant
data. The approved concept, recipes, successful call log, draft, ordinary export,
assets and screenshots are in `~/.local/share/ezkart-templates/sela/`.

The shared builder gained scoped tabs/filters, native dialogs, catalog-bound
product sets and licensed Plus Jakarta Sans. Their controls are available on a
blank canvas. Sela uses the shared Ezkart floating cart and demo checkout. A
product dialog's media, copy, variant controls and purchase button remain separate
native elements. Filters and the setup chooser do not overwrite each other's state.

## Validation

- Rendered at 320, 390, 768, 1024, 1440 and 1920 pixels: no horizontal overflow,
  broken images or JavaScript errors. Inspected hero, catalog, setup, product,
  packaging, sold-out, cart and footer states.
- Shopping flows passed at all five required widths. Correct independent products,
  variant prices/stock, setup totals and separate cart lines; keyboard tabs,
  disclosure controls, mobile navigation, dialog focus restoration and reduced motion.
- Automated WCAG 2/2.1 A/AA scans: zero violations on the page and product dialog
  at 390 and 1440 pixels. This is a focused browser audit, not certification.
- Text edits in the sidebar, inline gradient edits, backgrounds, image replacement,
  product reassignment and layout edits were undone; save/reopen preserved the
  authored structure. The ordinary export retained the font and commerce.
- Actual Preview passed desktop/tablet/mobile, local media loading, setup/cart/demo
  checkout and Open tab with product dialogs. All preview media now uses the
  configured local media origin, including editorial photography.
- Initial local Chromium transfer: 998,867 bytes. Observed CLS: 0 on mobile and
  0.00246 on desktop. These are local unthrottled measurements.
- Full builder suite: 36 tests passed. Follow-up targeted tests cover whole-set
  stock rejection, closed exports after editor dialog previews and independent
  interaction scopes after section duplication.

## Remaining stage

Review the native draft before packaging. Merchant-data application, installed
catalog registration, package size verification and authenticated hosted-page
creation belong to the separately approved template stage. The working recipe
and concept assets are local review artifacts, not shipped demo merchandise.

Editor: http://127.0.0.1:46331/cart/admin/?page=sites&edit=sela-native-v1.ezkart.site

Storefront: http://127.0.0.1:46332/
