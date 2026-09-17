# SOFT SIGNAL — asset provenance

Created 2026-09-16 using the built-in `image_gen__imagegen` tool, not CLI/API fallback. All product forms, branding and scenes are fictional concept assets. Originals are retained in `source/`; site derivatives are local WebP. The image tool generated the pixels; ImageMagick only stripped metadata and compressed to quality 86, without visual editing.

| Asset | Site path | Original path | Purpose |
|---|---|---|---|
| Rooftop | `site/assets/hero.webp` | `source/hero-original.png` | Blue-hour hero photograph |
| Signal | `site/assets/signal.webp` | `source/signal-original.png` | Signal catalog product photograph |
| Carry | `site/assets/carry.webp` | `source/carry-original.png` | Carry catalog product photograph |
| Dinner | `site/assets/table.webp` | `source/table-original.png` | Brightness demonstration / story photography |
| Signal mark | `site/assets/signal-mark.svg` | Same | Original hand-authored SVG, favicon and brand identity |
| Wordmark | Live type in `site/index.html` | Same | Original lowercase typographic wordmark |
| Manrope Latin | `site/fonts/manrope-latin.woff2` | Downloaded from Google Fonts | Variable weight 400–800, locally served |

Font source: https://fonts.gstatic.com/s/manrope/v20/xn7gYHE41ni1AdIRggexSg.woff2
Font license: SIL Open Font License, stored in `site/fonts/OFL.txt`; fetched from https://raw.githubusercontent.com/google/fonts/main/ofl/manrope/OFL.txt .

## Generation prompts

### Hero — new image

Use case: product-mockup. Create an original high-end photographic campaign image for a fictional portable lighting brand called SOFT SIGNAL. Wide landscape 3:2 image. Scene: quiet city rooftop at blue hour, deep ink blue sky, distant anonymous low buildings softly out of focus, simple dark blue round metal bistro table partly seen at bottom right. The hero subject is an exquisite compact portable cordless lamp on the table at the right third of the composition: matt burnt-orange powder-coated metal, broad shallow domed circular mushroom shade, narrow straight cylinder stem, flat circular base, with warm amber diffused LED light underneath the shade illuminating the table. Entire lamp clearly visible. Lamp proportion 27cm tall, 17cm diameter head, precise contemporary industrial design. One transparent amber drinking glass nearby, no other table clutter. Left half of image has dark unobtrusive blue negative space for a huge cream website headline. Subject occupies right half strongly; intimate atmosphere, analog film grain, editorial product photography, strong dark blues and warm amber, physically believable, crisp material, restrained soft glow from actual lamp. No people, no text, no logos, no watermark, no frames or padding.

### signal — reference-based generation

Reference image: `source/hero-original.png`. The hero was visually inspected before these calls.

Use case: product-mockup. Product catalog photo for fictional portable lighting label SOFT SIGNAL. Input image is the design reference: precisely preserve the orange lamp's broad domed mushroom shade, narrow straight cylindrical stem, flat round base, proportions and burnt-orange powder coat. Remove all surroundings and glass. One complete lamp only photographed at a slightly high three-quarter angle in a pale warm gray photographic studio with a seamless background, real soft shadow extending lower right. Lamp is illuminated warmly beneath the shade. Beautiful sharp tactile powder coat detail. No people, no text, no logos, no watermark. Square composition, lamp should occupy 82 percent of image height with a slim clear margin around all sides, focus on tactile industrial design, fine analog grain.

### carry — reference-based generation

Reference image: `source/hero-original.png`. The hero was visually inspected before these calls.

Use case: product-mockup. Create a product catalog photograph for a fictional portable lighting label SOFT SIGNAL, a second model that belongs to the same design family as the supplied orange mushroom lamp. New product: a compact cobalt blue cordless lantern with a sculptural U-shaped arch handle in thick tubular blue metal above a frosted white glowing cylindrical diffuser, squat circular blue metal base and blue disk on top of the diffuser. Handle clearly loops above diffuser and is physically joined to base with side uprights. Approximately 26 cm total height and 14 cm wide. Simple elegant contemporary industrial design, no unnecessary details, matt cobalt blue powder coat, warm amber light in opal diffuser. One complete lantern only photographed at slightly high three-quarter angle in a pale warm gray studio with seamless background and real soft shadow. No text, logo, watermark, people or props. Square composition, lamp occupies 82 percent of image height with slim clear margins. Sharp tactile product photography and fine analog grain.

### table — reference-based generation

Reference image: `source/hero-original.png`. The hero was visually inspected before these calls.

Use case: photorealistic-natural. Editorial lifestyle campaign image for fictional lighting label SOFT SIGNAL. Input image is product design reference: preserve precisely the orange mushroom portable lamp with broad domed shade, thin stem and round flat base. Create a warm intimate overhead-oblique view of a small apartment dinner table after sunset. That exact orange lamp in center illuminating the table, two casually arranged plates of pasta, steel forks, linen napkins and half-full drinking glasses, a partially visible human forearm reaching for a glass at bottom left and another relaxed hand resting at right edge. No faces. Rich walnut wood tabletop, muted dark blue room edges. The product remains clear and sharp; casual imperfect believable dinner rather than a staged luxury ad. Cozy pool of warm yellow light, deep natural shadows, cinematic 35mm analog documentary photography. Wide landscape 3:2 composition, no text, no logos, no border, no watermark.

## Inspection and delivery

All four generated assets were displayed and visually inspected for product consistency, usable crops, unwanted lettering, extra objects, and coherent lighting. The Signal retains its orange domed shade, straight stem and round base across the hero, catalog, and dinner scenes. The Carry is deliberately a separate blue lantern model. No stock-photo licenses or third-party merchant marks are required. The concept uses no remote asset requests at runtime. Exact final asset paths are relative to `/home/branch/.local/share/ezkart-templates/soft-signal-20260916/`.
