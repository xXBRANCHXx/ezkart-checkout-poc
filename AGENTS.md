# Ezkart project instructions

## Landing-page template work

Before changing landing-page templates, template selection, template rendering, or the landing-page builder, read `docs/landing-page-template-plan.md` completely. It is the approved product and design brief. Preserve its hard constraints unless the user explicitly changes them.

## Builder interaction checks

Builder interaction and layout changes must include checks through the merchant UI: create a blank page, add and select separate sections, edit their backgrounds, add text and images, drag and resize them, undo/redo, and save/reopen. Check desktop and narrow editor widths. API-only checks do not establish that pointer and keyboard interactions work.

Use `blank-editor-workflow.test.mjs`, `section-actions.test.mjs`, and `grid-snapping.test.mjs` in `tools/builder-mcp/test` for this coverage. Run the broader builder suite when shared selection, dragging, rendering, or persistence behavior changes, and visually inspect the affected canvas for clipping and hidden controls.

## Delivery

- Unless the user explicitly requests a local-only change, commit and push completed Ezkart changes to the current working branch after proportionate verification.
- Changes to the test API should be deployed to the test Worker when deployment is required for cross-device testing. Never infer permission to deploy production.

## Production release hold (owner decision, 19 September 2026)

- Do not push to Ezkart's `main`, merge production PRs, or deploy changes to `ezkart.id` until the owner explicitly authorizes the final release.
- The owner requires DOKU approval and roughly a month of sustained testing of financial protocols and wallet structure before that release. Passing the current automated checkout tests is not a substitute for those gates.
- PR #3 (legacy sandbox lockout) must remain draft and unmerged during this hold. The owner explicitly declined deploying it now.
- Continue authorized work on `agent/ezkart-workbench` / `test.ezkart.id` and the separate Executive Dashboard. Dashboard environment selection does not authorize a live storefront deployment or provider activation.
- See `docs/production-release-gates.md` for the recorded release conditions and current validation limits.

## Sidebar announcements

The sidebar promo card's orange-to-pink gradient is intentional. Preserve it
when changing shared controls or navigation styles. Its title, description, icon,
button label, and destination live in `cart/admin/sidebar-promo.php` so it can
promote Advanced or future announcements without redesigning the sidebar.
