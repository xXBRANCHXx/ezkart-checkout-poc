# Ezkart landing-page template program

## Status and scope

This document preserves the future art-direction brief for Ezkart's landing-page template program. Read it before planning or implementing template, renderer, template-selection, or builder work.

Concept work is open under the user's approved three-stage workflow: first design a standalone HTML/CSS/JavaScript landing page with fictional products, logo and branding and open it locally for review; then recreate the chosen design through the actual builder's CLI/MCP editing operations; then prepare it as a template after the user approves the builder result. The reusable agent for this workflow is [ezkart-template](../tools/template-agent/ezkart-template/SKILL.md).

Shipping templates remains gated on the builder's reusable elements being able to create, edit and reproduce every required composition from scratch with a polished user experience. Standalone concepts are design references, not published templates. Do not import their HTML/CSS, patch exports, or add template-only rendering code to bypass builder recreation. The designs below remain reference targets until their native builder versions pass review.

Templates are complete, polished, long-form storefront sites—not isolated sections, skeletal blueprints, or the same layout with different colors. The current target is roughly **15 templates**, with the final count still open. We will design and build them one at a time with an unusually high quality bar.

Future templates should be highly professional and practical for ordinary merchants. Favor clear shopping journeys, disciplined whitespace, clean typography, restrained backgrounds and familiar navigation. Only one or two should take a more formal direction; the majority should remain approachable and polished. PITH is the approved bold launch design, not the visual default for the collection.

**Sela** is the commissioned result of the whitespace-led direction: a professional desk-accessories shop with clean sans-serif typography, restrained backgrounds and a practical multi-product shopping journey. Its native builder reconstruction is approved and installed as a template supporting one to four catalog products. **Takar**, the pantry storefront, is also approved and installed as an editable template for one to three catalog products. Subsequent concepts retain the professional direction while using distinct merchant stories and compositions. Start the next concept only when the user commissions it; opening its terminal does not start design work.

Every future template must be composed from the same reusable, merchant-editable element system available on a blank canvas. A template may provide a composition and art direction, but it must not introduce a parallel editing model or template-only behavior.

Every template must contain a product section that starts with an empty product card. Merchants can open, edit, preview and save it without selecting a product. The card opens the catalog picker. Licensed template design imagery can remain on the page. Shop cards, variants, prices and purchases use the merchant's selected catalog products. Publishing or copying/downloading page code requires at least one of that merchant's active products on the page with an available purchase action. Physical products need positive stock in the product or a visible variant. A product selected only in settings does not qualify; the server rechecks ownership and current availability before accepting a published snapshot or authorizing code export.

Each complete template package has a hard maximum size of 50 MB.

## Design constitution

### Current user art direction — September 16, 2026

**Lintas (Cross)** is approved and installed as a native template for one to three products. See [the template validation report](templates/lintas-template-validation.md). For the **following commissioned concept**, use Ezkart’s own marketing website as the primary visual reference: rounded sections and controls, soft gradients, clean sans-serif typography, generous whitespace and an approachable, professional shopping experience. The user explicitly rejected the repeated studio/designer/editorial look with sharp corners. Do not turn every new merchant genre into another fine-rule, rectangular-photo editorial layout.

This direction overrides earlier blanket restrictions on gradient backgrounds and rounded containers. Use these features deliberately and visibly; keep contrast, hierarchy and purchase controls clear. Preserve the prior approved designs. Save this direction for the next commission; continuing Cross does not start the following concept.

### Absolute prohibitions

- No eyebrows, kickers, or tiny uppercase pre-headings above section titles. Do not include an eyebrow field in the eventual section schema.
- No aimless decorative color clouds or glowing effects. Soft, composed gradients are encouraged for the next Ezkart-inspired concept.
- No neon, glow effects, cyberpunk styling, or familiar purple-blue AI gradients.
- No glassmorphism.
- No floating decorative spheres, stars, sparkles, or meaningless geometric clutter.
- No generic bento grids.
- No centered hero surrounded by floating feature cards.
- No obligatory three-card benefit row.
- Rounded controls and sections should form a consistent system; avoid a different arbitrary shape on every element.
- Radius follows the art direction. The next Ezkart-inspired concept should be visibly rounded and approachable.
- No fabricated dashboards, statistics, ratings, testimonials, press mentions, or trust metrics.
- No generic icon collections where typography, photography, or composition can communicate the idea.
- No automatic carousels.
- No animation on every section and no endless marquees.
- No generic AI-written copy such as "elevate your journey," "unlock your potential," or claims without evidence.
- No fake or sample merchandise can satisfy the publish requirement or be purchased. Unconnected draft slots are clearly labeled and disabled.
- No collection that is one shared structure with palette swaps.

### Positive principles

- Give each template one clear, recognizable visual idea.
- Use a real grid, disciplined alignment, intentional whitespace, and deliberate vertical pacing.
- Let typography, photography, cropping, rhythm, and layout create character; decorative backgrounds should not carry the design.
- Use genre-specific typography and a restrained palette with a functional hierarchy.
- Photography should show the product, its material, its context, or its use. Every decorative element must communicate something.
- Write specific, believable demo copy suited to the merchant genre.
- Design desktop, tablet, and mobile as distinct compositions, not merely scaled versions of desktop.
- Motion should explain hierarchy, state, or interaction. The static composition must already be beautiful.
- Give every template one memorable interaction or compositional detail without turning it into a gimmick.
- Finish the whole site, including navigation, commerce states, reassurance, and footer—not only the hero.

## Genre references for the collection

These five genres remain useful reference directions, rather than a fixed build order or final collection size:

1. **Impact** — bold single-product or product-drop launch.
2. **Atelier** — editorial luxury and craft.
3. **Harvest** — food, wellness, and handmade storytelling.
4. **Gallery** — modern minimal multi-product catalog.
5. **Signal** — digital product, course, download, or membership.

PITH fulfills the bold Impact direction. Sela fulfills the professional, whitespace-led Gallery direction. Takar fulfills the approachable pantry-focused Harvest direction. Atelier and Signal remain available for subsequent commissions.

## Template 1: Impact

### Job

Sell one hero product, a tight product family, or a limited launch with strong momentum. Appropriate for drinks, supplements, gadgets, cosmetics, sneakers, packaged goods, and product drops.

### Art direction

Draw from product packaging, print advertising, sports editorials, and launch campaigns. Use solid color fields, oversized type, hard section transitions, decisive image crops, and restrained corner radii. It should feel physical and authored, not like a software landing page.

### Page structure

1. Compact announcement strip for a real offer or shipping fact.
2. Navigation with brand, essential links, and one purchase action.
3. Hero with dominant product photography, a short promise, price, variant choice when applicable, and add-to-cart.
4. Immediate proof using factual product attributes rather than invented metrics.
5. Product-in-use sequence with close crop and contextual image.
6. Problem and product response, composed as editorial copy rather than feature cards.
7. Ingredient, material, or component breakdown.
8. Variant selector tied to real products or variants.
9. Product detail band with dimensions, contents, care, or usage.
10. Short demonstration or scroll-linked image sequence only when assets justify it.
11. Real review or testimonial area with a credible empty state when none exists.
12. Comparison against clearly named alternatives using verifiable facts.
13. Shipping, returns, and payment reassurance.
14. Frequently asked questions.
15. Final purchase composition that repeats the real product, price, and variant state.
16. Full footer.

### Interaction and motion

- A considered hero entrance using type, crop, and product image—not generic fade-up on every child.
- Sticky purchase affordance after the hero on long pages, especially mobile.
- Variant changes update product media, price, availability, and the purchase action.
- Section transitions can use clipping, lateral movement, or hard cuts.
- Product spin or parallax is optional and only justified by suitable imagery.
- Respect `prefers-reduced-motion` and keep the full experience usable without motion.

### Responsive behavior

Desktop may use asymmetry and aggressive cropping. Mobile must reorder the story around product, promise, price, variant, and purchase; it should not preserve a cramped desktop split. Touch targets and the sticky purchase action must remain clear without covering content.

### Asset budget

Target no more than 40 MB packaged, leaving 10 MB safety margin below the hard limit.

## Template 2: Atelier

### Job

Present premium fashion, jewelry, accessories, beauty, artisan goods, or a small design-led collection where provenance and detail justify the purchase.

### Art direction

Draw from independent magazines, fashion lookbooks, museum publishing, and quiet catalog design. Use expressive type scale, restrained colors, fine rules, precise image crops, occasional off-grid tension, and generous quiet space. Avoid the generic beige rounded-card version of luxury.

### Page structure

1. Minimal navigation with collection access, brand, and search when useful.
2. Editorial hero led by one strong photograph and a concise title.
3. Collection introduction with a short, specific point of view.
4. Featured products presented as an asymmetric lookbook.
5. Material or craftsmanship story.
6. Full-bleed image interlude.
7. Product detail focus with real price and purchase path.
8. Process sequence showing how the item is made or selected.
9. Curated collection grid with controlled density.
10. Fit, sizing, care, or material guidance.
11. Founder, maker, or studio story.
12. Real editorial quote, review, or press reference when available.
13. Shipping, returns, and authenticity reassurance.
14. Final collection invitation.
15. Editorial footer with practical links and contact details.

### Interaction and motion

- Slow, restrained image reveals using masks or crop changes.
- Product image swaps on hover only as progressive enhancement; touch receives an explicit alternate-image control.
- A quiet sticky product title or collection index may track long editorial passages.
- Navigation and product transitions should feel measured, never floaty.
- No perpetual motion and no decorative animation disconnected from content.

### Responsive behavior

Mobile becomes a deliberate magazine column with preserved image rhythm, readable measures, and explicit product actions. Off-grid compositions should resolve into intentional overlap or sequence, never accidental overflow.

### Asset budget

Target no more than 30 MB packaged.

## Template 3: Harvest

### Job

Build trust and appetite for food, beverages, wellness products, natural goods, and handmade products through source, process, routine, and practical detail.

### Art direction

Draw from food journals, farmers' markets, recipe books, documentary photography, and printed labels. Use warm but not automatically beige color, tactile imagery, readable editorial typography, visible structure, and grounded illustrations only when they explain ingredients or process.

### Page structure

1. Useful shipping, harvest, batch, or availability notice.
2. Friendly navigation with shop, story, and use or recipes.
3. Product-and-context hero with real product selection and purchase action.
4. Short origin story anchored to a place, maker, or process.
5. Ingredient, source, or material map.
6. Featured products or bundle using real catalog items.
7. How it is made, shown as a clear sequence.
8. How to use, serve, prepare, or incorporate the product.
9. Seasonal or routine-based editorial image section.
10. Nutrition, specification, allergen, or care information as applicable.
11. Maker, farm, kitchen, or workshop profile.
12. Real customer stories or a designed empty state.
13. Bundle or recurring-purchase option only when supported by commerce behavior.
14. Frequently asked practical questions.
15. Shipping, storage, shelf-life, and returns guidance.
16. Full footer with contact and policy links.

### Interaction and motion

- Ingredient or process details reveal on explicit selection, not hover alone.
- A recipe, serving, or routine switcher can update imagery and instructions.
- Scroll motion may connect process steps, but should remain restrained and legible.
- Product bundle controls must update real pricing and selections.

### Responsive behavior

Mobile prioritizes product, purchase, preparation, and key trust information. Maps and process diagrams become horizontally stepped controls or stacked sequences with no tiny labels.

### Asset budget

Target no more than 35 MB packaged.

## Template 4: Gallery

### Job

Help a merchant with several products present a clear, modern catalog without losing personality. Appropriate for homeware, stationery, furniture, art objects, gifts, and considered general retail.

### Art direction

Draw from museum catalogs, architecture books, Swiss grids, and independent design shops. Use disciplined alignment, strong whitespace, useful indexing, typography-led navigation, and product photography with minimal framing. The restraint must come from proportion and detail, not emptiness alone.

### Page structure

1. Utility navigation with search and collection access.
2. Modular hero that can feature one collection or a small curated set.
3. Shop-by-collection index.
4. Featured catalog grid tied to real products.
5. Editorial feature explaining one collection or design principle.
6. New or selected products with a different density from the main grid.
7. Product quick-view or detail drawer with accessible full-page fallback.
8. Material, designer, or category index.
9. Recently added or seasonal collection.
10. Real review or customer-project area when available.
11. Service information: delivery, pickup, customization, or consultation.
12. Newsletter or update signup with an honest reason to subscribe.
13. Store/contact information.
14. Structured footer.

### Interaction and motion

- Filtering and sorting preserve context and provide clear URL/state behavior.
- Product media can change on deliberate hover and explicit touch controls.
- Quick-view uses restrained spatial motion and restores focus correctly.
- Grid changes should animate position only when it improves orientation.
- Navigation may expose a compact visual collection index, but not an oversized generic mega-menu.

### Responsive behavior

Mobile uses a purposeful density control, readable filters, and persistent access to search and cart. Product grids must handle long titles, varied image ratios, sales, sold-out states, and missing secondary imagery.

### Asset budget

Target no more than 25 MB packaged.

## Template 5: Signal

### Job

Sell a digital download, course, membership, service package, software-adjacent product, or knowledge product through clarity, syllabus or deliverables, creator credibility, and a strong checkout path.

### Art direction

Draw from product manuals, independent publications, educational materials, tickets, and well-typeset technical documents. Use typographic hierarchy, diagrams, rules, numbered structure, and direct language. It must not default to neon tech styling, dashboards, code rain, or glowing gradients.

### Page structure

1. Direct navigation with overview, contents, creator, questions, and purchase.
2. Hero stating exactly what is sold, for whom, what is included, price, and format.
3. Product preview using real pages, lessons, files, or outputs.
4. Outcome and audience section using specific language, not inflated promises.
5. Contents, curriculum, deliverables, or feature index.
6. Interactive sample lesson, chapter, or file preview when available.
7. Format, access, compatibility, and delivery details.
8. Creator or organization credibility with verifiable facts.
9. A walkthrough of how purchase and access work.
10. License, usage, updates, or membership terms.
11. Real testimonials or case studies when available.
12. Pricing and package selection tied to real Ezkart products.
13. Guarantee or refund policy only when the merchant actually offers one.
14. Frequently asked questions.
15. Final purchase summary.
16. Full footer.

### Interaction and motion

- A progress-aware contents navigation can track the reader through a long page.
- Sample content opens inline or in an accessible modal with focus management.
- Curriculum or deliverable sections use deliberate expand/collapse controls.
- Diagrams can animate state changes, but the explanation must work statically.
- Pricing selection updates the real product and checkout state.

### Responsive behavior

Mobile prioritizes the exact offer, price, included content, preview, and purchase. Long syllabi become readable disclosure groups with visible progress and no nested scrolling traps.

### Asset budget

Target no more than 20 MB packaged.

## Commerce and data rules

- Use the [shared storefront cart pattern](storefront-cart-pattern.md): one consistent floating cart outside template navigation, connected to Ezkart's existing cart and checkout.
- A template declares the product counts, media types, and optional data it can use, then adapts gracefully when a merchant supplies less.
- Applied pages bind to real product names, descriptions, prices, variants, availability, stock behavior, images, and checkout actions.
- Licensed template design imagery may remain in applied pages and stays editable. Keep it separate from catalog product media and the fictional preview catalog. Product sections use selected merchant products.
- New template pages start with an empty product card. Product selection is optional for drafts and required for publication and code export. Connect products later without overwriting design edits; always validate the publish requirement on the server. Digital products and subscriptions use their existing active/available commerce behavior rather than a physical inventory count.
- Missing optional content should remove or recompose a section; it should not leave placeholders, blank cards, or invented facts.
- Long names, multiple price formats, sale states, sold-out products, missing secondary images, and sparse descriptions are first-class cases.
- A template cannot depend on reviews, press, subscriptions, guarantees, or shipping claims that the merchant does not have.

## Package and performance rules

- The 50 MB ceiling includes images, video, fonts, CSS, JavaScript, decorative assets, and preview media shipped with the template.
- CI or the template build must fail when the packaged template exceeds 50 MB.
- Track both packaged size and customer-facing transfer size; passing the package cap is not sufficient performance work.
- Target an initial customer-facing download of approximately 3 MB or less, with Impact allowed up to approximately 4 MB when its hero concept genuinely needs it.
- Store source assets in R2 and serve responsive derivatives rather than sending original dimensions to every device.
- Prioritize the hero's essential media, lazy-load below-the-fold media, and provide explicit dimensions to prevent layout shift.
- Prefer modern compressed image formats with reliable fallbacks. Video must be optional, short, muted when autoplaying, and never the only way to understand the offer.
- Keep fonts intentionally limited and subset where practical.
- A template must remain complete and attractive when motion is disabled or a heavier optional asset is unavailable.

## Quality gates for every template

A template is not finished until all of these are true:

- It is a complete storefront from navigation through footer.
- Its desktop, tablet, and mobile compositions have each been intentionally designed.
- It has been inspected at 320, 390, 768, 1440, and 1920 CSS pixels, plus representative intermediate widths.
- It uses real Ezkart catalog data in an applied page and leaves no fake commerce content behind.
- The static design is strong before animation is enabled.
- Motion respects reduced-motion preferences and does not block navigation or purchase.
- Keyboard, touch, mouse, focus order, focus visibility, and modal/drawer focus restoration have been verified.
- There is no horizontal overflow, accidental clipping, or hidden purchase action.
- Long names, sparse copy, missing optional sections, limited imagery, sold-out items, and multiple variants have been tested.
- Image dimensions are reserved and major layout shifts have been eliminated.
- Package and initial-transfer budgets pass.
- It receives a dedicated typography and spacing polish pass.
- It receives a separate interaction and motion polish pass.
- It receives a performance and accessibility audit.
- It passes the anti-AI review below.

## One-template-at-a-time process

1. Confirm the merchant genre, primary conversion, product count, and real Ezkart products used for testing.
2. Collect human visual references from print, packaging, retail, editorial, or physical spaces; identify principles, not components to copy.
3. Write the page narrative and the purpose of every section.
4. Define the template's grid, type system, palette, radius logic, image behavior, and spacing rhythm.
5. Establish desktop and mobile art direction before adding animation.
6. Build the static full-page composition using real or structurally honest product data.
7. Review pacing, cropping, typography, copy, and the completeness of the purchase journey.
8. Define interaction states for navigation, variants, products, cart or checkout entry, disclosures, drawers, and errors.
9. Add only the motion that improves hierarchy, orientation, feedback, or storytelling.
10. Implement reduced-motion and non-hover alternatives at the same time.
11. Test the commerce and content edge cases listed in this brief.
12. Measure and reduce package size, transfer size, layout shift, and unnecessary script work.
13. Run the anti-AI review and revise any weak or generic area.
14. Test the template on the hosted test subdomain across devices.
15. Approve the template before beginning the next one.

## Anti-AI review

Ask these questions at the end of every design pass:

1. Could this be mistaken for a generic startup landing page?
2. Could its sections be reordered without changing the story? If so, the narrative is too weak.
3. Is the design relying on gradients, cards, decorative shapes, or animation to rescue an ordinary composition?
4. Does every section have a concrete reason to exist?
5. Does the copy sound like a specific real merchant rather than a generated brand exercise?
6. Is there a recognizable art direction that follows the user’s chosen references, including Ezkart’s own website for the next concept?
7. Is the page still beautiful, legible, and persuasive with motion disabled?
8. Would the template remain distinctive with an ordinary merchant product photo rather than perfect campaign imagery?

Any failed answer requires another design pass before approval.

## Element-system prerequisite

Before a builder reconstruction is promoted to a template, finish and validate the element library, direct manipulation, responsive controls, layers, discoverability, accessibility, undo/redo, persistence, preview, and export behavior needed for that composition. Standalone concept design may proceed first under the staged workflow above. A merchant must be able to reproduce every meaningful part of a proposed template from a blank canvas without hidden template-only code.

Preserve each template's distinctive composition, responsive behavior, and art direction by combining those proven elements. Do not flatten the designs into palette swaps, and do not bypass the shared element system to achieve them.

## Current queue — September 16, 2026

Hue (Rona) is approved and installed as a native template for one to three products. See [the template validation report](templates/rona-template-validation.md).

Lane (Lajur) version 2 has been recreated and is ready for native review. See [the native validation report](templates/lajur-builder-validation.md). Its open photographic composition supersedes the rejected framed, rounded first version. Preserve that specific feedback for this formal business-document storefront. Do not include simulated-purchase claims in merchant-facing copy. Real storefronts use normal Ezkart checkout; fictional catalog review fixtures remain explicitly simulated at checkout.

Lane is ready for native review. The commissioned creative-concept terminal (`ezkart-template-creative`) is open in the Ezkart workspace with full access and approvals set to never, and has started step one. Do not launch a duplicate. Choose a different merchant story and composition, retaining professional clarity and practical shopping. The broader Ezkart-inspired rounded and gradient direction still applies to new concepts; avoid excessive boxed cards. Native Lane approval and template packaging remain separate stages.
