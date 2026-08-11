# Ezkart — Coming Soon

Static coming-soon website for [ezkart.id](https://ezkart.id).

The repository also includes a dependency-free sandbox commerce flow at
[`/cart`](https://ezkart.id/cart/). It demonstrates product selection,
customer and delivery details, location-based shipping quotes, Midtrans Snap
payment selection, and a provider-confirmed sandbox payment state. The
server-side PHP endpoint creates a real Midtrans Sandbox Snap transaction, opens
the Snap checkout popup, verifies its signed HTTP notification, and displays the
stored Midtrans transaction reference. The Server Key remains server-side and no
real funds are charged.

Copy `config.example.php` to the ignored `config.runtime.php` on the server and
set the project's Midtrans Sandbox Merchant ID, Client Key, and Server Key.
Alternatively, set `EZKART_MIDTRANS_MERCHANT_ID`,
`EZKART_MIDTRANS_CLIENT_KEY`, and `EZKART_MIDTRANS_SERVER_KEY` in the PHP
environment. Each Snap transaction overrides its notification destination to
`https://ezkart.id/cart/api/callback.php`, so the callback does not depend on a
Dashboard-wide notification setting.

## Hosting

The site is dependency-free and can be served directly from the repository root. Point Hostinger's deployment at the `main` branch; no build command is required.

## Local preview

```bash
python3 -m http.server 4173
```

Then visit `http://localhost:4173`.

## Checkout review guide

The customer-facing walkthrough is available at
[`docs/Ezkart-Customer-Checkout-Guide.pdf`](docs/Ezkart-Customer-Checkout-Guide.pdf).
The editable print source is `docs/customer-checkout-guide.html`.
