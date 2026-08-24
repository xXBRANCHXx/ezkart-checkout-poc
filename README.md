# Ezkart — Coming Soon

Static coming-soon website for [ezkart.id](https://ezkart.id).

The repository includes a dependency-free commerce flow at
[`/cart`](https://ezkart.id/cart/). It handles product selection, customer and
delivery details, shipping quotes, signed provider notifications, merchant
acceptance, and an idempotent Biteship pickup after the merchant chooses
Arrange pickup.

## Payment-provider decision

Ezkart is awaiting CV approval before completing DOKU merchant onboarding.
DOKU is the production payment-provider target, and a verified merchant
disbursement flow is a hard release requirement. Midtrans has been rejected for
production because the evaluated setup did not provide the merchant
disbursement flow Ezkart requires.

The existing Midtrans adapter is legacy sandbox scaffolding only. Do not add
production Midtrans credentials, treat Midtrans health as launch readiness, or
promote that adapter to production. Replace it atomically with the DOKU payment,
callback, refund, reconciliation, and merchant-disbursement flow after CV
approval and DOKU onboarding. The authoritative machine-readable status is in
[`project.metadata.json`](project.metadata.json).

Biteship remains the production shipping target and can be configured
independently once payment/shipping environment inference is decoupled from the
legacy sandbox adapter. Biteship requires the live Order API to be activated
separately; having a `biteship_live.` key does not by itself prove that order
creation is approved. Keep enough Biteship balance available and confirm the
pickup address before arranging the first real pickup.

Configure Biteship's `order.status`, `order.price`, and `order.waybill_id`
webhooks to POST to `/cart/api/biteship-webhook.php`. Protect the endpoint with
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
shipping service, legacy sandbox payment reference/status, Biteship fulfillment reference,
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
