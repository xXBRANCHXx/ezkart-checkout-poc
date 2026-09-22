# Builder responsive defaults

Merchant-added content must have a usable layout at desktop, tablet and phone widths before the merchant edits those layouts. A desktop drag must not leave an image, heading, button or product outside the smaller canvas.

## Shared protocol

- **Visible by default.** Keep content in the document. Automatic layout never sets `display: none`, changes initially-hidden targets, or overrides interaction and scroll visibility settings.
- **Reflow free placement.** At page widths up to 900px, unconfigured elements return to normal flow instead of inheriting desktop absolute/relative offsets. Blank sections stack their content in document order with a consistent gap and grow with the content. Desktop geometry remains saved and unchanged.
- **Fit the available space.** Elements can shrink within their parent. Images, video and icons retain their aspect ratio; explicitly resized frames retain their frame ratio and existing image-fit setting. Uploads with automatic height use their intrinsic ratio.
- **Keep text readable.** Text wraps, including long unbroken strings, and text containers can grow. Automatic layout does not shrink the chosen font size. Buttons and accordion summaries retain a 44px minimum height.
- **Adapt groups.** Merchant-added flex rows wrap; grids fall back to one column at phone widths (600px or below). Authored responsive compositions take precedence. Empty decorative containers keep their height.
- **Keep actions working.** Product and variant choices, cart actions, links, accordions, and state changes keep the same content and behavior across devices.
- **Respect deliberate edits.** Authored breakpoint properties and device-specific properties override automatic defaults. Intentional visibility, state variants, and scale-to-fit compositions remain authoritative.
- **Use the same rendering everywhere.** Canvas, live preview and exported pages consume the same generated container-query styles; there is no preview-only repair.

## Scope and precedence

The renderer applies automatic layout to merchant-inserted asset roots (`autoLayout: true`), existing saved upload/asset roots, and existing blank sections with automatic growth and their direct native children. This recovers older desktop-only placements without rewriting their saved configuration. Independently inserted children get the same protocol. Authored template internals retain their own responsive composition.

CSS order is shared appearance, automatic defaults, authored width rules, explicit device rules, then state variants and their responsive rules. The smaller-screen inspector reads that same fallback before displaying inherited values. Clearing an override returns to the inherited layout. Desktop “All screen sizes” typography, colors and content retain their existing editing semantics; free-placement geometry receives the smaller-screen fallback.

Native integrations can set `autoLayout: false` for a deliberately authored composition. This is not an additional merchant setup step. Templates and grouped presets must still supply responsive rules for their internal composition, or explicitly use proportional frame scaling.

## Verification

`tools/builder-mcp/test/responsive-defaults.test.mjs` covers saved desktop offsets, actual pointer movement, undo/redo, narrow editor widths, save/reopen, live preview, exported widths from 320px to 900px, growing sections, text wrapping, media proportions, product cards, controls, authored overrides, hidden targets and scale-to-fit preservation.

Run the shared builder suite when changing the fallback. In particular preserve the merchant workflows in `blank-editor-workflow.test.mjs`, `section-actions.test.mjs`, `grid-snapping.test.mjs`, and `responsive-editing.test.mjs`, and the responsive asset/template checks.
