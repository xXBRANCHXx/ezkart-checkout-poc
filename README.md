# Ezkart — Coming Soon

Static coming-soon website for [ezkart.id](https://ezkart.id).

The repository also includes a dependency-free sandbox commerce flow at
[`/cart`](https://ezkart.id/cart/). It demonstrates product selection,
customer and delivery details, location-based shipping quotes, Duitku payment
selection, and a provider-confirmed sandbox payment state. The server-side PHP
endpoint creates a real Duitku Sandbox invoice, redirects to Duitku's hosted
payment page, verifies its signed callback, and displays the stored provider
reference. Merchant keys remain server-side and no real funds are charged.

Copy `config.example.php` to the ignored `config.runtime.php` on the server and
set the project's Duitku Sandbox merchant code and merchant key. Alternatively,
set `EZKART_DUITKU_MERCHANT_CODE` and `EZKART_DUITKU_MERCHANT_KEY` in the PHP
environment.

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
