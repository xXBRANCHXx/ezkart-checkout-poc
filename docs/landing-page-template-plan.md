# Ezkart landing-page template program

## Status and scope

This document preserves the future art-direction brief for Ezkart's landing-page template program. Read it before planning or implementing template, renderer, template-selection, or builder work.

The template program is paused. No complete templates, template selector, template generator, or template-specific assets should ship until the builder's reusable elements can create, edit, and reproduce every required composition from scratch with a polished user experience. The designs below are reference targets for that later phase, not currently available products.

Templates are complete, polished, long-form storefront sites—not isolated sections, skeletal blueprints, or the same layout with different colors. Ezkart needs at least five templates spanning meaningfully different genres. We will design and build them one at a time with an unusually high quality bar.

Every future template must be composed from the same reusable, merchant-editable element system available on a blank canvas. A template may provide a composition and art direction, but it must not introduce a parallel editing model or template-only behavior.

When a merchant applies a template, commerce content must come from real products in the merchant's Ezkart catalog. Preview/demo content can illustrate a template before selection, but it must not survive as fake merchandise in an applied page.

Each complete template package has a hard maximum size of 50 MB.

## Design constitution

### Absolute prohibitions

- No eyebrows, kickers, or tiny uppercase pre-headings above section titles. Do not include an eyebrow field in the eventual section schema.
- No gradient blobs, auroras, mesh gradients, glowing background shapes, or decorative color clouds.
- No neon, glow effects, cyberpunk styling, or familiar purple-blue AI gradients.
- No glassmorphism.
- No floating decorative spheres, stars, sparkles, or meaningless geometric clutter.
- No generic bento grids.
- No centered hero surrounded by floating feature cards.
- No obligatory three-card benefit row.
- No pill styling everywhere. Pills are reserved for controls or information that is genuinely categorical.
- No excessive rounded containers. Radius must follow the template's art direction rather than serve as a default.
- No fabricated dashboards, statistics, ratings, testimonials, press mentions, or trust metrics.
- No generic icon collections where typography, photography, or composition can communicate the idea.
- No automatic carousels.
- No animation on every section and no endless marquees.
- No generic AI-written copy such as "elevate your journey," "unlock your potential," or claims without evidence.
- No fake or sample products after a merchant applies the template.
- No five-template collection that is one shared structure with palette swaps.

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

## The five-template collection

Build in this order:

1. **Impact** — bold single-product or product-drop launch.
2. **Atelier** — editorial luxury and craft.
3. **Harvest** — food, wellness, and handmade storytelling.
4. **Gallery** — modern minimal multi-product catalog.
5. **Signal** — digital product, course, download, or membership.

This sequence starts with the template most naturally tested with the current ZERO catalog products, then deliberately moves across different visual systems and merchant needs.

## Template 1: Impact

### Job

Sell one hero product, a tight product family, or a limited launch with strong momentum. Appropriate for drinks, supplements, gadgets, cosmetics, sneakers, packaged goods, and product drops.

### Art direction

Draw from product packaging, print advertising, sports editorials, and launch campaigns. Use solid color fields, oversized type, hard section transitions, decisive image crops, and restrained corner radii. It should feel physical and authored, not like a software landing page.

### Page structure

1. Compact announcement strip for a real offer or shipping fact.
2. Navigation with brand, essential links, cart, and one purchase action.
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

1. Minimal navigation with collection access, brand, search when useful, and cart.
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
2. Friendly navigation with shop, story, use or recipes, and cart.
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

1. Utility navigation with search, collection access, and cart.
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

- A template declares the product counts, media types, and optional data it can use, then adapts gracefully when a merchant supplies less.
- Applied pages bind to real product names, descriptions, prices, variants, availability, stock behavior, images, and checkout actions.
- Demo assets are preview-only. They must be clearly separated from merchant data in storage and rendering.
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
6. Is there a recognizable human art direction with references beyond contemporary SaaS sites?
7. Is the page still beautiful, legible, and persuasive with motion disabled?
8. Would the template remain distinctive with an ordinary merchant product photo rather than perfect campaign imagery?

Any failed answer requires another design pass before approval.

## Element-system prerequisite

Before template work resumes, finish and validate the element library, direct manipulation, responsive controls, layers, discoverability, accessibility, undo/redo, persistence, preview, and export behavior. A merchant must be able to reproduce every meaningful part of a proposed template from a blank canvas without hidden template-only code.

When templates return, preserve their distinctive composition, responsive behavior, and art direction by combining those proven elements. Do not flatten the designs into palette swaps, and do not bypass the shared element system to achieve them.
