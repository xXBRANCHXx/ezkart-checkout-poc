# Generator contract

You are the first of two unattended agents generating native editable Ezkart element collections. The user commissioned at least TARGET_COUNT options in each existing category, allowing more in future. The coordinator is separately building a three-preview + View more category browser and a searchable font preview menu. Work autonomously until your complete collection and handoff exist. Do not ask for individual design approval.

Read `AGENTS.md`, the complete `docs/landing-page-template-plan.md`, `cart/admin/builder-assets.js`, `cart/admin/builder-native.js`, and `tools/builder-mcp/examples/ezkart-native.json`. `RUN_DIRECTORY/inventory.json` records all existing recipes and categories at batch launch. Existing designs must remain; calculate the deficit to TARGET_COUNT in each category. Choose the designs yourself. Make the additional entries genuinely different in composition, typographic treatment or useful purpose. A collection of palette swaps, renamed copies or generated pseudo-options does not meet the commission. Check what already exists before designing.

You may write only within RUN_DIRECTORY. Do not change repository files, commit, push, deploy, send messages, or spawn further agents. Another agent owns integration. You can read the checkout and run local browser rendering using its tools. Use the configured model; do not change configuration or permissions.

Deliver `RUN_DIRECTORY/pack.json` as a JSON array of records:

```json
[{"id":"text-chapter-opening","category":"text","name":"Chapter opening","description":"A chapter number beside a readable title and introduction.","section":true,"node":{"id":"chapter-root","type":"container","props":{"display":"flex","flexDirection":"column","gap":"16px"},"children":[]}}]
```

Each record has a unique category-prefixed ID, short merchant-facing name, concrete description, optional boolean `section`, and one native config in `node`. IDs must not collide with the launch inventory. Populate every node with finished, useful editable content. All categories need enough new entries to reach the target. Each native node needs a pack-local ID; use only native properties accepted by EzkartNative.validate. Use native `responsive` rules to adapt arrangements and type sizes to 320/390px. All nested content must remain separately editable. Section candidates should be useful as stand-alone full-width sections.

No scripts, iframes, imported HTML, rasterized compositions, executable code artwork, external dependencies or novel renderers. Code artwork is ordinary editable text/layout. For interactions use native accordions and existing action/state contracts only, with pack-local references. Use fonts already available in `builder-native.js` / `builder-fonts.js` or standard generic families. Do not fetch or bundle fonts. Leave font licensing and selection to the separate font work.

Pricing, customer quotes, ratings, counts, policy claims and contact addresses must be clearly editable placeholders when no merchant facts exist. Avoid fake trust claims, simulated live data, nonfunctional form fields or links presented as connected services. Native button labels can use meaningful actions with editable `#` destinations. Do not fabricate media provenance. This is an element library, so focused examples and merchant-editable placeholder copy are appropriate.

Also deliver `RUN_DIRECTORY/handoff.md` with counts per category, the new design names and their distinct use/composition, native editing/interaction notes, any unresolved risks, and evidence of your validation. Validate all nodes using the actual native validator and render representative designs at desktop and narrow width before handoff. Fix errors without asking the user. Supporting generators, contact sheets and screenshots may be written within the run directory. Finish only once pack.json and handoff.md are complete and all category deficits are met.
