# Ezkart — Coming Soon

Static coming-soon website for [ezkart.id](https://ezkart.id).

The repository includes a dependency-free commerce flow at
[`/cart`](https://ezkart.id/cart/). It handles product selection, customer and
delivery details, Biteship shipping quotes, Midtrans Snap payment, signed
payment notifications, and an idempotent Biteship order after payment.

In the server's existing ignored `config.runtime.php`, replace the Midtrans
credentials with the Production Merchant ID, Client Key, and Server Key, plus
a `biteship_live.` API key, the merchant's five-digit origin postcode,
pickup contact name/phone, and complete pickup address.
Alternatively, set `EZKART_MIDTRANS_MERCHANT_ID`,
`EZKART_MIDTRANS_CLIENT_KEY`, `EZKART_MIDTRANS_SERVER_KEY`,
`EZKART_BITESHIP_API_KEY`, `EZKART_BITESHIP_ORIGIN_POSTAL_CODE`,
`EZKART_BITESHIP_ORIGIN_CONTACT_NAME`, `EZKART_BITESHIP_ORIGIN_CONTACT_PHONE`,
and `EZKART_BITESHIP_ORIGIN_ADDRESS` in the PHP environment. Optional origin
email/note/organization settings and `EZKART_BITESHIP_COURIERS` can also be set.
The provider environment is inferred from the credentials: Midtrans `SB-` and
`biteship_test.` keys select sandbox, while production Midtrans and
`biteship_live.` keys select production. Conflicting key types fail closed.
The existing `deployment_environment` chooses the callback website, so test and
production deployments cannot send callbacks to each other's order store.

Production has real side effects: Midtrans charges customers and a successful
payment creates a real Biteship shipment. Biteship requires the live Order API
to be activated separately; having a `biteship_live.` key does not by itself
prove that order creation is approved. Keep enough Biteship balance available
and confirm the pickup address before accepting the first payment.

## Sandbox admin dashboard

The order dashboard is available at
[`/cart/admin/`](https://ezkart.id/cart/admin/). Google sign-in is verified by
Supabase on the server, then the same access token is sent to the matching
Cloudflare Worker to create or refresh the safe D1 application profile. Set
`supabase_url`, `supabase_publishable_key`, and `admin_allowed_emails` in the
private `config.runtime.php`. The allowlist is required while this legacy
dashboard still reads a shared sandbox order store. `sandbox_admin_password`
remains an optional emergency fallback until every admin query is scoped by a
D1 seller membership.

The dashboard reads the private JSON order store and displays order IDs,
customers, line items, product subtotal, shipping charge, final total,
shipping service, Midtrans reference/status, Biteship fulfillment reference,
and signed-notification result. Its
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
