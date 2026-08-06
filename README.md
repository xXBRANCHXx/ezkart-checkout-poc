# Ezkart — Coming Soon

Static coming-soon website for [ezkart.id](https://ezkart.id).

The repository also includes a dependency-free sandbox commerce flow at
[`/cart`](https://ezkart.id/cart/). It demonstrates product selection,
customer and delivery details, location-based shipping quotes, Duitku payment
selection, and a successful sandbox payment state. No real order or charge is
created by the public demo.

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
