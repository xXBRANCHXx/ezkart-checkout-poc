# Ezkart Hosted Checkout POC

Deployable PHP/MySQL proof of concept for an independent Ezkart checkout
subdomain.

The Official ZERO server creates a signed checkout session. The customer is
redirected with only an opaque session ID. Ezkart then owns location search,
shipping rates, payment creation, provider callbacks, shipment creation,
tracking updates, merchant-fee ledger records, and A5 label rendering.

## Local setup

1. Copy `config.example.php` to `config.runtime.php`.
2. Add a local MySQL database and credentials.
3. Import `schema.sql` (the app also applies it automatically).
4. Run:

   ```bash
   php -S 127.0.0.1:8080 index.php
   ```

5. Open `http://127.0.0.1:8080/`.

Run the non-database unit checks with:

```bash
php tests/run.php
```

## What is implemented

- Visual, clickable API flow with exact request/response JSON examples.
- Timestamped HMAC checkout-session API for the Official ZERO server.
- Server-side recalculation of product total and package weight.
- Biteship Maps search and courier-rate selection.
- Short-lived signed shipping quotes.
- Duitku Create Invoice redirect and authoritative signed callback handling.
- Automatic Biteship Create Order after verified payment.
- Deduplicated `order.status`, `order.price`, and `order.waybill_id` webhooks.
- Restricted operations dashboard, shipment retry, fund ledger, and webhook
  health.
- Custom Code 128 shipping label designed for A5 portrait printing.
- Sandbox/production separation and a disabled-by-default launch switch.

## Hostinger

- Deploy this branch to the root of the independent checkout subdomain.
- Keep `config.runtime.php` outside Git.
- Use PHP 8.2+ with cURL, PDO MySQL, JSON, and mbstring.
- Configure both provider callbacks only after HTTPS and the health check pass.

The complete hPanel, Biteship, Duitku, test, and production sequence is in
[`DEPLOYMENT.md`](DEPLOYMENT.md).

## Important label fact

Biteship does not publish a Shipping Label API. The A5 label is intentionally
constructed by Ezkart using fields from Biteship `POST /v1/orders` and its
webhook updates. Biteship's own pre-designed label remains downloadable from
its dashboard.

## Main routes

| Route | Purpose |
| --- | --- |
| `GET /` | Clickable integration map and JSON examples |
| `POST /api/v1/checkout-sessions` | Signed Official ZERO handoff |
| `GET /c/{session_id}` | Customer-hosted checkout |
| `GET /api/v1/locations` | Server proxy for Biteship Maps |
| `POST /api/v1/shipping/rates` | Server proxy plus signed quote |
| `POST /api/v1/payments` | Create Duitku invoice |
| `POST /api/v1/webhooks/duitku` | Signed payment notification |
| `POST /api/v1/webhooks/biteship` | Shipment state updates |
| `GET /payment/return` | Poll server-confirmed payment state |
| `GET /ops` | Restricted operational dashboard |
| `GET /api/v1/orders/{session_id}/label` | Restricted A5 label |

## Security model

- Merchant session creation uses timestamped HMAC-SHA256 over the exact raw
  request body.
- Totals and weights are calculated from signed line items.
- Shipping selection is locked in a short-lived Ezkart quote token.
- Browser redirects never mark a transaction paid.
- Duitku callbacks require a valid HMAC and exact order amount.
- Provider keys never enter browser JavaScript or Git.
- Webhooks are deduplicated before updating state.
