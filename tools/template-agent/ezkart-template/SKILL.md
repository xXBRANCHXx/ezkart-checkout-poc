---
name: ezkart-template
description: "Create Ezkart landing-page concepts with fictional branding and products, open browser previews, recreate approved designs through the actual builder, and prepare approved pages as templates. Use for Ezkart template-agent work, including requests to start step one."
---

# Ezkart Template Agent

Make one distinctive, complete storefront at a time. The user wants to review a coded concept first, then have it recreated with Ezkart's editable elements, then approve it as a template.

## Current instructions

For new concepts, give the design agent a short brief containing the user's request and Ezkart's functional requirements. Let it choose the visual design. Do not add a palette, font, layout formula, genre, reference site, list of aesthetic prohibitions, or accumulated taste instructions unless the user asks for them for that concept.

The user canceled **Tilu** because it repeated the existing designs. Do not resume, rebuild or package it. The next concept should be creative and original; PITH was a reference for creativity, not a requested style to copy. Earlier collection-wide prescriptions for rounded sections, gradients, whitespace and Ezkart's marketing-site style are no longer defaults for new commissions. Existing approved designs remain unchanged.

Required for every concept: a complete responsive storefront, fictional brand and products for review, Ezkart's universal cart, working product choices and honest demo checkout. Keep editable content and assets separate so the approved concept can later be recreated through the builder. The three-stage workflow and product/stock publishing requirements below still apply.

## Current work

- PITH, Sela, Takar, Lintas, Rona, Melo and Soft Signal are approved and installed templates.
- Lajur (Lane) version 2 is ready for native review. See `docs/templates/lajur-builder-validation.md`. Its approved open photographic composition supersedes its rejected first concept. Keep normal merchant checkout copy.
- Melo (`~/.local/share/ezkart-templates/melo-punch-20260916`) is approved and installed for one to three real products, starting with an empty product card. See `cart/admin/templates/melo/README.md` and `docs/templates/melo-template-validation.md`.
- Tilu (`~/.local/share/ezkart-templates/tilu-evening-20260916-01`) is canceled. Its files are retained as a rejected concept.
- Soft Signal (`~/.local/share/ezkart-templates/soft-signal-20260916`) is approved and installed for one or two real products, starting with an empty product card. See `cart/admin/templates/soft-signal/README.md` and `docs/templates/soft-signal-template-validation.md`. Preserve its evening design, independent product/variant/quantity choices, scene preview and universal cart.
- The user paused this batch after Soft Signal: “this will be the last one for a bit.” No concept or terminal is queued. Wait for a new commission before opening another design terminal or starting another concept. Keep future concept briefs limited to the user’s request and functional requirements.

## Find the project and current stage

This skill is maintained at `tools/template-agent/ezkart-template` inside the Ezkart repository. Resolve this skill directory's symlink to find that repository, or use the user's selected Ezkart checkout. Read its `AGENTS.md` and the complete `docs/landing-page-template-plan.md` before designing or changing the builder.

Use a concept folder under `~/.local/share/ezkart-templates/<slug>/` unless the user chooses another location. Keep the reviewable website under `site/`, with `index.html`, styles, scripts and assets. Keep `brief.md`, `concept.json`, screenshots and builder authoring files alongside `site/`. These are working concepts, not files to ship into Ezkart's live site.

Record the concept's name, genre, locale, fictional products, art direction, responsive behavior, asset sources and remaining work in the brief. In `concept.json`, keep the current stage, site path, preview URL, builder workspace/project when created, and approvals tied to the version reviewed. Update these records when resuming work. Preserve previous approved versions before substantial revisions.

Infer the requested stage from the conversation and these files. A request to create or install this agent creates the skill; it does not also commission a first concept. “Start step one” commissions a concept. Follow the queued concept direction above when it is commissioned; invent a suitable fictional brand and product without making the user fill out a questionnaire. Existing direction and feedback take precedence over defaults.

## Step one — design and open a concept

Create a finished landing page in HTML, CSS and JavaScript with an original fictional brand, logo, product, packaging, copy and a coherent visual identity. Build the whole shopping story through the footer. Let the agent choose the visual direction.

- Fictional merchandise and branding are authorized for review. Do not fabricate ratings, customer quotes or trust claims. The current instructions above supersede historical aesthetic rules in the repository brief.
- Create useful assets instead of leaving placeholders. A custom SVG wordmark or symbol is appropriate for a logo. Use image generation when product photography or illustrations need it and the capability is available; follow that tool's instructions. Save assets locally and document their origin. Keep product images free of incidental borders or padding baked in by the layout.
- Use a consistent grid and deliberate typography. Design the mobile composition explicitly. Menus, section links, product choices, cart feedback and disclosures must work wherever they appear. Demo purchase flows must clearly identify their simulated checkout before any payment or order submission.
- The concept may use authored HTML/CSS/JS. Document any effect likely to need a new shared builder control later; do not let today's library force every concept into the same layout.

Run the browser preview using the included helper, resolving the paths first:

```bash
python "$skill_dir/scripts/preview.py" start "$concept_dir/site" --open
```

The helper serves only the website folder on loopback, opens the default browser, and keeps the preview running after the command ends. Running it again reuses the same preview. `status` returns its URL; `stop` stops that preview. If opening the browser fails, correct the launch when possible and give the working URL; never claim it opened without evidence.

Inspect the actual rendered site with browser tools at 320, 390, 768, 1440 and 1920 pixels. Fix overflow, text wrapping, missing assets, navigation stacking, hidden purchase controls and awkward section transitions. Check keyboard operation, touch alternatives and reduced motion. Take screenshots and inspect them visually. Check interactive states, not only the hero screenshot. Complete a typography and spacing polish pass before review.

Set the stage to `concept-review`, save the preview URL and validation results, and leave the preview running. Give the user the link and a short description of the concept. Step one ends with a reviewable concept; do not call it an editable builder page or a finished template.

## Step two — recreate through Ezkart

When the user asks to move the concept into the builder, read [references/builder.md](references/builder.md). Use the actual builder MCP tools or a CLI script calling those tools. Recreate the composition from blank sections and merchant-editable elements, with normal product bindings and responsive controls.

**The builder page must not be made by importing the concept's HTML/CSS, adding custom code or an iframe, rewriting saved page JSON, registering source-derived template components, or patching the exported HTML/CSS.** Individual image/logo assets and values for existing inspector controls are legitimate inputs. If the composition needs a missing capability, implement it as a reusable builder feature and verify it, or report the concrete limitation; do not silently substitute custom source or flatten the design into an image.

Save the native draft, public tool-call recipe/log, export and comparison screenshots. Verify that a merchant can edit representative text, word gradients, section backgrounds, product choices, images and layout in the normal UI, then undo, save, reopen and export. Include two independently bound product placements when the design calls for multiple products. Compare desktop and mobile with the approved concept and correct material differences.

Set the stage to `builder-review` and open the builder result for review. A concept approval alone does not approve turning the reconstruction into a template.

## Step three — prepare the approved template

When the user approves the builder result and asks to make it a template, inspect the repository's current template packaging and application mechanism; use or implement the shared mechanism appropriate to that request. Preserve the editable builder composition, meaningful labels, responsive behavior and asset provenance. Keep design imagery and fictional catalog data separate and declare the catalog requirements. Every template must contain a product section with an empty native product card by default. Merchants may start, edit, preview and save without products. Clicking the card opens the product picker. Declare its native container ID as `productSlot` in the manifest. Licensed design photos may remain on applied pages. Connect real catalog products to shop slots later while preserving design edits. Publishing or copying/downloading page code requires at least one owned, active product with an available purchase action; physical products or visible variants must have positive stock. Validate ownership and current stock on the server for publish and export. Keep draft Preview available. For portable purchase links, use the existing cart attributes/URL and Products → Copy add-to-cart code, documented in `docs/storefront-cart-pattern.md`; never create a separate cart.

The current mechanism is `cart/admin/templates/<id>/` with a manifest, a native recipe, and a separate `preview/` archive. The shared `EzkartTemplates` applicator is used by **New page** in both the library and editor, and by the public `template_list` / `template_apply` MCP tools. Build and enforce the size cap with `node tools/templates/package.mjs <id> <artifact.tar.gz>`. See the existing PITH package notes for the format; future templates must supply their own approved composition, not clone its design. Add new manifests to `cart/admin/templates/index.json` only after the native version is approved.

Verify both an unconnected draft and later product connection. Real shop items must bind merchant products, variants, prices, media and checkout actions. Unconnected slots are disabled and cannot pass the publish gate. Design imagery may stay; fictional catalog items cannot become purchasable. Run the brief's complete quality gates and enforce the 50 MB package ceiling. Preserve the builder recipe and preview used for approval. Record the artifact and checks in the concept folder. Do not label an HTML export alone a template or claim a template was installed when no application mechanism exists. Production publishing requires the user's authorization.

## Typical requests

- `$ezkart-template Start step one.` — invent, build, polish and open a concept.
- `$ezkart-template Make this concept more editorial.` — revise the current concept and reopen it.
- `$ezkart-template I like this. Rebuild it using the builder.` — create the editable native version for review.
- `$ezkart-template The builder version looks good. Make it a template.` — prepare and verify that approved template.
