# Ezkart project instructions

## Landing-page template work

Before changing landing-page templates, template selection, template rendering, or the landing-page builder, read `docs/landing-page-template-plan.md` completely. It is the approved product and design brief. Preserve its hard constraints unless the user explicitly changes them.

## Builder interaction checks

Builder interaction and layout changes must include checks through the merchant UI: create a blank page, add and select separate sections, edit their backgrounds, add text and images, drag and resize them, undo/redo, and save/reopen. Check desktop and narrow editor widths. API-only checks do not establish that pointer and keyboard interactions work.

Use `blank-editor-workflow.test.mjs`, `section-actions.test.mjs`, and `grid-snapping.test.mjs` in `tools/builder-mcp/test` for this coverage. Run the broader builder suite when shared selection, dragging, rendering, or persistence behavior changes, and visually inspect the affected canvas for clipping and hidden controls.

## Delivery

- Unless the user explicitly requests a local-only change, commit and push completed Ezkart changes to the current working branch after proportionate verification.
- Changes to the test API should be deployed to the test Worker when deployment is required for cross-device testing. Never infer permission to deploy production.
