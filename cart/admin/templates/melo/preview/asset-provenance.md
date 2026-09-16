# Melo asset provenance

All assets used by the website are saved locally under `site/assets/`. Nothing is hotlinked.

## Original generated photographs

Created September 16, 2026 using the built-in `image_gen.imagegen` tool. The fictional merchant, products, packaging and visual direction were authored for this commission. These are illustrative generated photographs, not stock photography or documentation of actual merchandise.

| Asset | Purpose | Original | Responsive derivatives |
| --- | --- | --- | --- |
| Hero / kit | Packaging, tools, materials and finished flower coasters together | `sources/hero.png` | `site/assets/hero-{480,800,960,1200,1536}.webp`, `hero.jpg` |
| Mekar | Flower coaster pair / catalog and cart | `sources/mekar.png` | `site/assets/mekar-{320,640,960}.webp`, `mekar.jpg` |
| Alun | Wave coaster pair / catalog and cart | `sources/alun.png` | `site/assets/alun-{320,640,960}.webp`, `alun.jpg` |
| Teduh | Arched mini mat / catalog and cart | `sources/teduh.png` | `site/assets/teduh-{320,640,960}.webp`, `teduh.jpg` |
| Making | Material texture and hands using the kit | `sources/making.png` | `site/assets/making-{480,800,1200,1536}.webp`, `making.jpg` |

Exact final prompts and tool-returned original locations: `sources/image-prompts.json`. Original generated files were copied into this concept's `sources/` directory; originals in the generator's output directory were preserved. `sources/image-origins.json` maps the asset names to those filenames.

ImageMagick only resizes and compresses the generated originals into local WebP/JPEG derivatives, strips metadata, and produces screenshot review sheets. No stock photos, remote media, SVG photo stand-ins, or borrowed merchant branding were used. Original generated photos remain available for subsequent approved design work. Their use here is authorized by the user's fictional-concept commission; no claim of real product manufacturing or independently verified trademark clearance is made.

The photographic packaging's small in-image lettering is part of the raster illustration. All purchase details, prices, specifications and material descriptions are readable HTML, not inferred from that lettering. The process photo is illustrative; the written guide directs users to the actual supplied tool instructions.

## Brand and typography

- `site/assets/melo-mark.svg`: original hand-authored five-petal mark. It references the finished flower coaster; it is also the favicon.
- The lowercase wordmark is live DM Sans text with deliberate letter spacing. It is not a flattened page image.
- `site/assets/dm-sans.woff2`: variable DM Sans font copied read-only from `cart/admin/assets/fonts/dm-sans.woff2` in the selected Ezkart workspace. License: SIL Open Font License, bundled unmodified as `site/assets/dm-sans-OFL.txt`.
- Arrows, small step numbers and the native cart bag are functional interface symbols. No external icon library is loaded.

## Shared runtime

`site/ezkart-cart.js` and `site/ezkart-cart.css` were compiled from the existing shared Ezkart storefront export code in `cart/admin/admin.js`. This is the repository's existing protocol/runtime, compiled for a simulated local fixture. Source hash, extracted fragment, catalog fixtures and local changes are preserved in `sources/cart-provenance.json`, `sources/admin-commerce-fragment.txt` and `sources/fictional-catalog.json`.

No existing template or concept assets were overwritten. No shared source file was modified.
