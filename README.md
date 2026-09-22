# Ezkart — Coming Soon

Static coming-soon website for [ezkart.id](https://ezkart.id).

The repository includes a dependency-free commerce flow at
[`/cart`](https://ezkart.id/cart/). It handles product selection, customer and
delivery details, shipping quotes, signed provider notifications, merchant
acceptance, and an idempotent Biteship pickup after the merchant chooses
Arrange pickup.

## Checkout links for existing websites

In the merchant dashboard, **Shop** manages one catalog page per seller and a
shared checkout appearance: store name, logo, accent/button/background colors,
background image, and optional fade/rise animations. Enabling the shop publishes
`/shop/?store=<seller-id>`. Customers choose products and variants, add quantities
to one cart, and continue through the existing shipping and payment flow.

Every active product has one canonical checkout URL, `/cart/?product=<product-id>`,
available from Products → Copy checkout link and from Shop. It works independently
of the shop's enabled state. Product details come from the current catalog; there
are no separate checkout page records to create or duplicate. Landing pages remain
the full builder for promoting an offer. Shop pages and checkout links use fixed
layouts and do not count toward the landing-page limit.

These pages preserve the existing checkout's physical-product support and
sandbox/production shipping rules. Digital and subscription products display an
unavailable notice until the shared checkout supports their fulfillment.

The Products admin can copy a merchant cart URL or a product-specific checkout
URL for use on an existing website. Cart state is stored on the Ezkart checkout
origin and isolated by the opaque `shop` value, so customers can return to the
merchant site, add another product, and check out both items together.

- `/cart/?shop=<scope>` reopens that merchant's saved cart.
- `/cart/?shop=<scope>&add=<product-id>` adds one item to the saved cart.
- `/cart/?shop=<scope>&add=<product-id>:<quantity>` adds a chosen quantity.
- `/cart/?shop=<scope>&cart=<product-id>:<quantity>,...` replaces the saved cart
  during a complete storefront-cart handoff.

Optional `brand`, `logo`, and `return` parameters set the merchant identity and
the Continue shopping destination. When `return` is omitted, checkout remembers
the referring merchant page when the browser supplies it.

## Payment-provider decision

Ezkart is awaiting CV approval before completing DOKU merchant onboarding.
DOKU is the production payment-provider target, and a verified merchant
disbursement flow is a hard release requirement. Midtrans has been rejected for
production because the evaluated setup did not provide the merchant
disbursement flow Ezkart requires.

Sandbox checkout uses Ezkart's own payment page and DOKU's non-SNAP BCA direct
API, with signed DOKU notifications confirming payment.
Sandbox checkout skips delivery selection and shipping charges, so payment
tests do not need a funded Biteship account. Production still requires shipping.
The non-SNAP direct adapter is restricted to sandbox: DOKU requires SNAP
migration for direct production virtual accounts. It never silently redirects
customers to hosted checkout. Setup, testing, and the explicit production
switch are documented in [DOKU and Biteship setup](docs/commerce-sandbox-setup.md).
The authoritative release status remains in `project.metadata.json`.
Production refunds, reconciliation, and verified merchant disbursement remain
release requirements; configuring the payment adapter does not complete them.

Biteship remains the production shipping target and can be configured
with environment-specific credentials. `commerce_environment` selects
`sandbox` (the default) or `production` for both providers; live mode also
requires `deployment_environment=production`. Biteship requires the live Order API to be activated
separately; having a `biteship_live.` key does not by itself prove that order
creation is approved. Keep enough Biteship balance available and confirm the
pickup address before arranging the first real pickup.

Configure Biteship's `order.status`, `order.price`, and `order.waybill_id`
webhooks to POST to `/cart/api/biteship-webhook.php?environment=sandbox`
(or `environment=production` for the live dashboard). Protect the endpoint with
the same webhook token using a Bearer authorization value, HTTP Basic password,
or `X-Ezkart-Webhook-Token` header. Shipment updates are matched to the private
Ezkart order by the Biteship order ID and replay safely.

## Sandbox admin dashboard

The order dashboard is available at
[`/cart/admin/`](https://ezkart.id/cart/admin/). Google OAuth and passwordless
email-link sign-in are verified by Supabase on the server, then the same access token is sent to the matching
Cloudflare Worker to create or refresh the safe D1 application profile. Set
`supabase_url` and `supabase_publishable_key` in the private
`config.runtime.php`. Test defaults to `admin_auth_mode=open_beta`, allowing
any verified Google account to enter an isolated beta workspace. The optional
`admin_allowed_emails` list grants legacy shared-order access and passwordless
email login only to store owners; it is not a beta-user list.
`sandbox_admin_password` remains an optional emergency fallback until every
admin query is scoped by a D1 seller membership. Google sign-in uses a
server-side PKCE exchange and an
HTTP-only cookie with an absolute 30-day reauthentication limit. Sessions live
in a private, environment-specific directory outside the public web root. The
Supabase access and rotating refresh tokens remain in that server-side PHP
session and are never stored in browser-readable storage. A temporary provider
failure preserves the refresh token for a later retry, while logout revokes the
current Supabase session whenever the provider is reachable.
`admin_session_storage` may override the private directory with an absolute
server path when required by the host.

Seller accounts can enable authenticator-app two-step verification from Admin
Settings. Enrollment, challenge, and verification use Supabase TOTP MFA through
the server-side session. Once enabled, a new Google or approved email sign-in
must reach `aal2` before the dashboard opens; the verified device can then keep
its Ezkart session for up to 30 days. State-changing cloud requests also fail
closed if an enrolled session has not reached `aal2`.

Privileged legacy accounts can read the private JSON order store and display order IDs,
customers, line items, product subtotal, shipping charge, final total,
shipping service, payment provider reference/status, Biteship fulfillment reference,
and signed-notification result. Other beta accounts receive an empty order view
and cannot read the shared records. The dashboard's
“paid volume” is an aggregate of sandbox orders marked `PAID`; it is not a real
wallet balance or withdrawable settlement amount.

## Hosting

The site is dependency-free and can be served directly from the repository root. Point Hostinger's deployment at the `main` branch; no build command is required.

Experimental seller and landing-builder work is deployed separately from
`agent/ezkart-workbench`. See
[`docs/workbench-deployment.md`](docs/workbench-deployment.md) for the branch,
subdomain, acceptance-test, and promotion model.

Structured production data uses Cloudflare D1 and file bodies use Cloudflare
R2 through an authenticated Worker. Supabase is used for Auth and Google OAuth
only. The branch-safe scaffold and complete D1 migration are in
[`cloudflare/ezkart-api`](cloudflare/ezkart-api); the environment model is
documented in
[`docs/database-environments.md`](docs/database-environments.md).

## Local preview

```bash
php -S 127.0.0.1:4173
```

Then visit `http://localhost:4173`.

## Checkout review guide

The customer-facing walkthrough is available at
[`docs/Ezkart-Customer-Checkout-Guide.pdf`](docs/Ezkart-Customer-Checkout-Guide.pdf).
The editable print source is `docs/customer-checkout-guide.html`.
