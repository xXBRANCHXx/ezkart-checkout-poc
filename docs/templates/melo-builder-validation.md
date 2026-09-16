# Melo native builder review

Melo's approved craft-shop concept is recreated through the public builder MCP tools and ready for native review. Template packaging has not been approved.

## Review

- Editor: http://127.0.0.1:46382/cart/admin/?page=sites&edit=melo-native-v1.ezkart.site
- Storefront: http://127.0.0.1:46383/
- Workspace: `~/.local/share/ezkart-templates/melo-punch-20260916/builder`
- Approved source preserved in `approved-concept-melo-v1/`.
- Nine blank native sections, 363 editable elements. The authoring recipe, public call log, inspection and unmodified export are retained in the concept folder.
- Inspection SHA-256: `2b48a6a1aeec0b16bf99f950f47395c913a90fcc99422bfd67ec5212ff7904a7`.
- Export SHA-256: `2cbf65ecdb7f627232c31495de57d5e465ce7d4e0e7c32b8c7a65a0751ce7c45`.

The composition preserves Melo's paper/coral palette, arched photography, open product cards, kit comparison tabs, making instructions, FAQs and policy dialogs. Each of the three products has independent catalog options and a matching native detail dialog. Catalog media, prices, stock and purchase actions use ordinary Ezkart controls. No concept HTML/CSS, custom renderer, page-state mutation or export patch was used.

## Verification

- Inspected 320, 390, 540, 680, 768, 900, 1024, 1440 and 1920 px. No horizontal overflow, missing visible images or browser errors.
- 36 accessibility scans: page, product dialog, cart and guide at each width. Zero WCAG A/AA and best-practice violations.
- Verified mobile navigation; URL-persistent product filters and reset links; keyboard kit tabs; independent variants; shared card/dialog choices; sold-out Teduh refill; quantities/subtotals; cart focus; FAQ/policy dialogs; and local demo checkout.
- Normal sidebar edits verified for text, selected-word gradient, section background, image, product, fixed variant and grid spacing. Undo/redo, save/reopen, three-size Live Preview and Open tab pass. Real catalog data can replace one placement independently in an isolated verification workspace.
- Initial transfer: 1,183,314 bytes at 390 px and 1,417,341 bytes at 1440 px. CLS 0.0874 mobile / 0.0007 desktop. Mobile measurement used 4× CPU slowdown and 40 ms network latency. These are local measurements, not hosted production performance.

## Shared improvements

- Link actions may reveal a named group version before navigating, with a normal inspector control. A product link can clear a filter that would hide its target.
- Cart background controls are inert while the drawer is open, preserving their previous state on close. Quantity focus survives rerendering; the increase button disables at stock limits and deleting the last line focuses Close.
- The floating cart avoids native action/disclosure controls. Exports supply a main landmark when the composition has none.
- All 47 builder regressions are verified: the full run passed 45, then the two keyboard tests passed after being updated to wait for the closing drawer animation. No product change was needed for those two tests. New coverage includes saved link settings, independent filter state, stock caps, focus retention and inert restoration.

## Scope

All review products are isolated fictional fixtures. Checkout explicitly identifies the simulation and creates no real order. This is a local native draft, not an installed template or published page. If approved for packaging, application must start with an empty product card and retain the existing owned-product, stock, publish and code-export gates.

## Subsequent concept

Tilu is canceled at the user's request for repeating existing layouts. Its files are retained as rejected; its preview is stopped. The replacement terminal receives only functional requirements and chooses its own visual design. Historical collection art-direction rules no longer prescribe new concepts.
