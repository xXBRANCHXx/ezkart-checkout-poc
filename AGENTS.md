# Ezkart project instructions

## Landing-page template work

Before changing landing-page templates, template selection, template rendering, or the landing-page builder, read `docs/landing-page-template-plan.md` completely. It is the approved product and design brief. Preserve its hard constraints unless the user explicitly changes them.

## Builder interaction checks

Builder interaction and layout changes must include checks through the merchant UI: create a blank page, add and select separate sections, edit their backgrounds, add text and images, drag and resize them, undo/redo, and save/reopen. Check desktop and narrow editor widths. API-only checks do not establish that pointer and keyboard interactions work.

Use `blank-editor-workflow.test.mjs`, `section-actions.test.mjs`, and `grid-snapping.test.mjs` in `tools/builder-mcp/test` for this coverage. Run the broader builder suite when shared selection, dragging, rendering, or persistence behavior changes, and visually inspect the affected canvas for clipping and hidden controls.

## Element settings

Dropdowns must use Ezkart's universal dropdown control and menu styling. The only
exceptions are the font picker and font-weight picker. Product options in the
editor, preview and exported pages use `cart/select.js` and `cart/select.css`;
do not introduce a separate product dropdown design.

Use merchant-facing controls for appearance settings: numeric values with separate units, sliders, color pickers, named choices, and structured responsive font limits. Do not require merchants to type CSS functions such as `clamp()`. Show resolved defaults such as “Left (default)” or the current font name instead of “Inherit” or “Automatic.” Preserve existing CSS and responsive rules until the merchant deliberately changes a setting. Apply this consistently across element types, including narrow editor widths. `inspector-controls.test.mjs` covers the shared controls.

## Delivery

- Unless the user explicitly requests a local-only change, commit and push completed Ezkart changes to the current working branch after proportionate verification.
- Changes to the test API should be deployed to the test Worker when deployment is required for cross-device testing. Never infer permission to deploy production.

## Production release hold (owner decision, 19 September 2026)

- Do not push to Ezkart's `main`, merge production PRs, or deploy changes to `ezkart.id` until the owner explicitly authorizes the final release.
- The owner requires DOKU approval and roughly a month of sustained testing of financial protocols and wallet structure before that release. Passing the current automated checkout tests is not a substitute for those gates.
- PR #3 (legacy sandbox lockout) must remain draft and unmerged during this hold. The owner explicitly declined deploying it now.
- Continue authorized work on `agent/ezkart-workbench` / `test.ezkart.id` and the separate Executive Dashboard. Dashboard environment selection does not authorize a live storefront deployment or provider activation.
- See `docs/production-release-gates.md` for the recorded release conditions and current validation limits.
- On 27 September the owner reported DOKU approval and instructed preparation
  for beta/soft-launch while explicitly keeping everything on workbench. DOKU
  business approval is received; technical payment/payout acceptance and the
  existing main/production release hold remain separate. See `docs/beta-readiness.md`.
- The owner clarified the beta target is live DOKU on workbench, not a sandbox
  launch. Prepare a separate beta environment for real payment records and live
  credentials. Main and `ezkart.id` remain held; local fixture testing does not
  determine the beta's provider mode. Preserve the existing sandbox evidence.

## Sidebar announcements

The sidebar promo card's orange-to-pink gradient is intentional. Preserve it
when changing shared controls or navigation styles. Its title, description, icon,
button label, and destination live in `cart/admin/sidebar-promo.php` so it can
promote Advanced or future announcements without redesigning the sidebar.
