# Builder choice preview

Standalone, interactive design concept for choosing between Ezkart's proposed image builder and its existing visual builder. This is a preview for review before implementation. It does not modify either builder, create projects, publish pages, or call checkout APIs.

## Open

Serve the repository root with a static server, for example:

```sh
python3 -m http.server 4174 --bind 127.0.0.1
```

Open `http://127.0.0.1:4174/docs/previews/builder-choice/`.

For language review only, append `?lang=id` or `?lang=en`. There is no separate language selector in the merchant flow. At integration time, the admin host should pass the existing resolved account preference to `EzkartBuilderChoice.setLanguage(language)`. This standalone prototype does not read or change the live account setting. English and Indonesian are included, matching the options in `cart/admin/pages.php`.

## What the preview demonstrates

- Two equally presented choices with previews of the editing approach and resulting page.
- Image builder: finished images, ordering controls, browser-local image uploads, a single mobile layout, and Ezkart purchase controls. Copy explains that changing image content requires replacing the image.
- Visual builder: template/blank-page entry explained, individually editable heading and button color, adding a text section, and desktop/tablet/mobile previews. This intentionally demonstrates a subset of the real editor rather than recreating it.
- A shared, explicitly simulated Ezkart checkout preview. No external checkout destinations.
- Choice buttons show which builder was selected without pretending a real project was created.
- Native modal dialogs with Escape dismissal, focus management, visible keyboard focus, reduced-motion support, and narrow-screen layouts.

## Assets

Reuses Ezkart's existing logo, Poppins/Jakarta fonts, and approved Sela template photography. The three fictional sample upload images are rendered from `posters.html`. They are illustration assets, not published templates or merchant products. Merchant artwork is not translated when interface language changes.

## Verification

Checked both languages at 320, 390, 768, 941, 1440, and 1920 CSS pixels in Chromium. Verified images loaded, no document/modal horizontal overflow, image ordering and local upload, heading/color edits, adding a section, device switching, checkout dialogs, Escape behavior, language switching, and selection feedback. Browser errors and failed requests: zero in the initial full pass. Additional review corrected the desktop purchase-bar width and an untranslated Indonesian helper sentence.

The actual production builder files are unchanged. The full merchant builder regression suite is not applicable to this isolated documentation prototype.
