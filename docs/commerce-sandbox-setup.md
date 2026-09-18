# DOKU + Biteship sandbox checkout

The checkout creates a DOKU hosted payment session using server-calculated
product prices and a fresh Biteship rate. Only a verified DOKU success
notification marks an order paid. The merchant then accepts the order and
chooses **Arrange pickup** to create the simulated Biteship shipment.

## Private server configuration

Copy the relevant entries from `config.example.php` into the test website's
ignored `config.runtime.php` (preserve its existing Auth/Worker settings).
Alternatively use environment variables prefixed with `EZKART_` and uppercase
keys. Credentials must never appear in browser code or Git.

```php
'deployment_environment' => 'test',
'commerce_environment' => 'sandbox',
'doku_sandbox_client_id' => 'YOUR_DOKU_SANDBOX_CLIENT_ID',
'doku_sandbox_secret_key' => 'YOUR_DOKU_SANDBOX_SECRET_KEY',
'biteship_sandbox_api_key' => 'biteship_test.YOUR_TEST_KEY',
'biteship_sandbox_webhook_token' => 'YOUR_RANDOM_SECRET_AT_LEAST_32_CHARACTERS',
'biteship_origin_postal_code' => 'YOUR_FIVE_DIGIT_POSTCODE',
'biteship_origin_contact_name' => 'YOUR_PICKUP_CONTACT',
'biteship_origin_contact_phone' => 'YOUR_PICKUP_PHONE',
'biteship_origin_address' => 'YOUR_COMPLETE_PICKUP_ADDRESS',
'biteship_couriers' => 'jne,sicepat,jnt',
```

Generate a webhook token with `openssl rand -hex 32`. The optional
`order_storage` is an absolute directory outside the public web root; Ezkart
appends `/<deployment>/<commerce environment>`. Keep it writable by PHP only.
Legacy `midtrans_order_storage` is accepted for sandbox storage when
`order_storage` is absent; an existing default legacy sandbox directory is also
reused so previous orders remain visible. Unscoped Biteship test credentials remain a fallback;
new setups should use the explicit sandbox slots above.

The PHP host needs PHP 8.1+ with cURL and mbstring. Only privileged legacy admin
accounts see this prototype's private JSON orders. Seller-scoped D1 orders are
a separate production requirement, as described in `database-environments.md`.

## Provider dashboards

1. Create/sign in to the [DOKU sandbox dashboard](https://sandbox.doku.com/).
   Retrieve its **Client ID** and **Secret Key** under **Settings → API Keys** and put
   them in the sandbox slots. These are Checkout/non-SNAP credentials.
2. Ezkart supplies the DOKU notification URL
   `https://test.ezkart.id/cart/api/doku-webhook.php` in each payment request
   using `additional_info.override_notification_url`. No global dashboard
   notification URL change is needed for these sessions. The endpoint
   must be publicly reachable by DOKU; hosting password protection must exempt
   this webhook. It authenticates each request by its DOKU signature.
3. In Biteship, turn on **Mode Testing** and generate a test API key. Both modes
   use `https://api.biteship.com`; the API key determines the mode.
4. Configure Biteship `order.status`, `order.price`, and `order.waybill_id`
   webhooks at
   `https://test.ezkart.id/cart/api/biteship-webhook.php?environment=sandbox`.
   Authenticate deliveries with `Authorization: Bearer <sandbox webhook token>`
   (HTTP Basic password or `X-Ezkart-Webhook-Token` is also accepted). Exempt this
   endpoint from hosting password protection too.

Biteship sandbox orders are simulated, but rate checks, Maps and public tracking
may still incur API fees. The application currently requests rates when showing
shipping choices and again when validating checkout.

## Acceptance run

1. Open `https://test.ezkart.id/cart/api/health.php`. Confirm
   `commerce_environment=sandbox`, `doku.configured=true`, and the Biteship
   credential, fulfillment and webhook flags are all true. These flags validate
   configuration only; they do not prove provider account activation.
2. Open `https://test.ezkart.id/cart/?shop=ezkart-demo&cart=granola:1`.
   Enter test customer/delivery details, request shipping and continue to pay.
3. Confirm the browser opens `https://staging.doku.com/...` (or DOKU's documented
   `https://sandbox.doku.com/...`) with the exact
   product-plus-shipping total. The enabled channels are VA, QRIS and credit
   card; the DOKU account must have the chosen channel enabled.
4. Complete the payment through the
   [DOKU simulator](https://sandbox.doku.com/integration/simulator/).
5. Verify the Ezkart return page says **Payment confirmed** and `PAID (test)`.
   Merely returning to Ezkart does not mark the order paid.
6. In the privileged order dashboard, accept the order and arrange pickup.
   Verify one simulated shipment and its reference in Biteship Testing Mode.
   Repeat Arrange pickup/notification delivery and confirm no duplicate order.
7. Verify a Biteship webhook updates the shipment reference/status. Check a
   failed DOKU attempt remains pending and that retrying successfully confirms
   the same order. Failed attempts must not undo a successful payment.

Record the DOKU invoice, Biteship order ID, deployed commit and the results before
calling the provider integration verified. On 2026-09-18, the actual DOKU sandbox
API accepted a signed payment-creation request with the locally configured
credentials, echoed the exact invoice and amount, and returned a checkout URL
at `staging.doku.com/checkout-link-v2/`. The application adapter created invoice
`EZK-S-238856F1010F5D0E6183C773`, and its hosted checkout displayed the expected
IDR 10,000, customer details, bank transfer and card options. No payment was
completed. Hosted runtime configuration and a full payment-notification/Biteship
acceptance run remain pending.

## Production switch

Complete `production-commerce-checklist.md` before accepting public orders.
Populate `doku_production_client_id`, `doku_production_secret_key`,
`biteship_production_api_key`, and `biteship_production_webhook_token` with their
separate live credentials. On the production website, set:

```php
'deployment_environment' => 'production',
'commerce_environment' => 'production',
```

That server-side switch selects `https://api.doku.com` and the live Biteship key.
Production checkout returns to `https://ezkart.id`; use its corresponding
notification endpoints, with `?environment=production` for Biteship. Switching
back to `sandbox` restores test mode. The workbench cannot start live payments.
There is no customer-controlled or unauthenticated mode toggle.

Order IDs and private directories retain their original environment. Delayed
DOKU notifications select credentials by invoice environment; Biteship webhooks
select them by the explicit URL environment. Sandbox pickup requests are
rejected while production mode is active. Keep each mode's credentials and
order directory for outstanding orders.

The switch does not implement refunds, reconciliation or merchant payouts, and
does not establish PSE registration or production onboarding readiness. Those
remain separate release requirements in `project.metadata.json`.

## Automated checks

```sh
# PHP 8.1+ CLI with mbstring built in; cURL must be absent under -n for fixtures.
PHP_BINARY=php node --test tools/checkout-test/checkout.test.mjs
```

The browser test uses the existing Playwright installation under
`tools/builder-mcp` (`npm ci` there if needed). Test PHP runs with an isolated
private directory, synthetic credentials and a transport fixture that cannot
make external provider requests. Coverage includes the real checkout and
webhook endpoints, independent Node HMAC verification, tampering and amount
mismatches, merchant pickup, replay protection, environment selection, provider
failures, and desktop/mobile browser redirects. These checks are distinct from
provider sandbox acceptance.

## Provider references

- [DOKU backend integration](https://developers.doku.com/accept-payments/doku-checkout/integration-guide/backend-integration)
- [DOKU notification handling](https://developers.doku.com/get-started-with-doku-api/notification/best-practice)
- [DOKU simulator guide](https://developers.doku.com/accept-payments/doku-checkout/integration-guide/simulate-payment-and-notification)
- [Biteship sandbox](https://biteship.com/en/docs/sandbox)
- [Biteship base URL and mode selection](https://biteship.com/en/docs/api/base_url)
- [Biteship testing-mode fee policy](https://help.biteship.com/hc/en-us/articles/58286997471513-Testing-Mode-Fee-Policy)
