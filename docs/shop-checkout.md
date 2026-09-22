# Shop and product checkout links

- Product checkout: `/cart/?product=<product-id>`, one canonical URL per product.
- Shop: `/shop/?store=<seller-id>`, one catalog page per seller.
- Appearance and enable/disable controls: `/cart/admin/?page=shop`.
- Landing pages remain the unrestricted offer-design workspace. Both sales paths
  use the existing `/cart/api/catalog.php`, `rates.php`, `start.php`, and payment flow.

The shop supports several products and variants in one order. It keeps the cart
in the same origin and owner scope as existing landing-page links. Checkout
revalidates prices, stock, seller ownership, and shipping through the existing
server flow. A cart handoff is consumed once so reloading preserves later edits.
Product checkout opens an available option and lets the customer switch variants;
opening it again does not duplicate an existing line.

The authenticated `/v1/storefront` endpoint saves a bounded appearance object
under `sellers.settings_json.storefront`. This preserves other seller settings and
needs no migration. Public `/v1/storefront/view` returns only the selected seller's
active products and visible variants. Disabled shops return 404, while product
checkout and appearance-only reads continue working. Suspended sellers and
archived products are unavailable. Public output contains no private settings,
drafts, digital filenames, or customer details.

Images use the existing seller-owned media upload flow and 2 MB limit. Appearance
references keep those images from being collected as abandoned uploads and allow
them to be served publicly. The UI offers only fixed colors, images, and three
animation choices. Reduced motion disables entrance animations. Button text is
chosen for its background color.

Current shared checkout accepts physical products. Digital/subscription products
remain visible with an unavailable message; they cannot be added. Sandbox skips
shipping in the current direct payment flow; production still requires delivery.

## Verification

`npm test` in `cloudflare/ezkart-api` covers authentication, seller isolation,
appearance validation, image ownership, active/archived products, hidden/sold-out
variants, current stock/prices, disable behavior, and suspension.

`PHP_BINARY=<php> node --test tools/checkout-test/checkout.test.mjs` covers the
merchant save/reopen flow, CSRF rejection, image upload, responsive previews,
multi-product cart, variant changes, quantity persistence, reduced motion,
existing DOKU payment creation, Biteship rates, server price calculation, and
mixed-seller rejection. Set `EZKART_TEST_SCREENSHOTS` to an existing directory
to capture the shop, appearance editor, and product checkout.

The purchase-code and shared-cart browser checks in `tools/builder-mcp/test`
cover existing external website links. Test infrastructure uses isolated local
fixtures; none of these checks charge a payment or book a shipment.

Changes are for the workbench/test environment. Production release gates in
`production-release-gates.md` continue to apply.
