# Takar native builder review

The user commissioned the next pantry concept's native reconstruction after Sela
on 2026-09-16. This is a local editable builder draft, awaiting native review and
separate approval before template packaging.

## Composition

Nine native sections and 395 individually editable elements recreate the approved
concept: sticky navigation, meal-led hero and purchase strip, three-product shelf,
two serving ideas with shared one/two-portion controls, ingredient story and
index, FAQ, paired purchase, and footer with product/information dialogs.

The authoring driver called public MCP `project_create`, `section_add`,
`native_add`, `native_update`, `project_save`, `page_export` and inspection tools.
The design uses existing nested native layout, image, text, product, dialog and
state controls. No source HTML/CSS import, custom-code block, iframe, rewritten
saved page state or patched export was used. Original photography and vector
assets remain separate source inputs with the concept's provenance.

The dedicated fictional catalog has Sambal Bawang, Sambal Tomat and Bawang Renyah;
it never replaces a merchant catalog. Changing the bawang heat variant updates
all linked placements and the paired total. The paired purchase uses the selected
variant consistently: Rp44.000 + Rp32.000 = Rp76.000. The ordinary Ezkart cart adds
separate product lines and the local simulated checkout submits no real order.

## Shared controls completed

- Explicit dropdown variant layout, including products with a small option count.
- Optional total price on native set purchase buttons.
- A state action can disable its button when selected, with keyboard focus moved
  to an enabled sibling. This supports the bounded portion selector.
- Font optical sizing is editable in Typography. Disabling automatic optical
  adjustment reproduces the reference DM Sans metrics without adding another font.
- The shared floating cart avoids ordinary purchase controls and variant selectors
  as well as fixed purchase bars.

All controls are available through the ordinary inspector and public native tools.
None is a Takar-only renderer or preset component.

## Verification

- Layout, images and section bounds at 320, 390, 560, 768, 1024, 1440 and 1920 CSS
  pixels: no horizontal overflow, missing images or page exceptions.
- Desktop/mobile full-page, hero, shelf, serving guide, product and footer views
  inspected against the concept. Type metrics, arrow spacing, purchase alignment
  and narrow-screen portions were polished.
- At 320/390/768/1440/1920: menu links, independent product choices, synchronized
  prices, keyboard recipe tabs, one/two-portion ingredient amounts, boundary
  disabling/focus, product dialogs and Escape/focus restoration, FAQ, footer
  dialogs, paired cart, and simulated checkout pass with reduced motion enabled.
- Real Preview at desktop 1440/tablet 768/mobile 390 and Open tab pass, including
  images, recipe/portion state, commerce and current canvas content.
- Sidebar text, word gradient, section background, image, independent product
  binding and layout edits were exercised and undone. Save/reopen preserves them.
  New dropdown, selected-state and set-price inspector controls were checked.
- Axe-core WCAG 2 A/AA and 2.1 AA scans: zero violations on main page and product
  dialog at 390 and 1440. This is Chromium coverage, not all browsers/devices.
- Cart overlap probes at 320/390/768/1440 pass for hero, catalog, recipe and closing
  purchase buttons. The shared regression test covers both fixed and flowing controls.
- All 38 builder regression tests pass, including Sela and PITH application.
- Initial unthrottled local transfer: approximately 1.25 MB mobile / 1.33 MB desktop;
  CLS approximately 0.0046 / 0.0014. Media has reserved aspect ratios or explicit
  heights; below-fold photos load lazily. DM Sans is locally bundled and embedded
  by the ordinary exporter under its license.

The concept folder contains the native recipe, public call log, saved draft,
unmodified export, comparison screenshots and reports. The shared runtime is
pushed to the test branch; the review page itself remains local. Template
application with real merchant data is the next stage, after native approval.
