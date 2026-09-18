# Production commerce checklist

> **Payment launch is blocked.** Ezkart is awaiting CV approval and subsequent
> DOKU merchant onboarding. DOKU is the production payment-provider target, and
> merchant disbursement must pass an end-to-end test before public orders are
> accepted. The DOKU checkout adapter supports sandbox and production credentials.
> Sandbox acceptance, refunds, reconciliation, and disbursements still need
> verification before launch.

Production provider credentials stay in the ignored `config.runtime.php`; they
are never committed or merged with a Git branch. The current machine-readable
decision is in [`../project.metadata.json`](../project.metadata.json).

## Runtime configuration

Complete [sandbox acceptance](commerce-sandbox-setup.md) first. Keep sandbox and
production credential slots separate in the private runtime configuration:

```php
'deployment_environment' => 'production',
'commerce_environment' => 'production',
'doku_production_client_id' => 'YOUR_PRODUCTION_CLIENT_ID',
'doku_production_secret_key' => 'YOUR_PRODUCTION_SECRET_KEY',
'biteship_production_api_key' => 'biteship_live.YOUR_LIVE_KEY',
'biteship_production_webhook_token' => 'A_RANDOM_SECRET_AT_LEAST_32_CHARACTERS_LONG',
```

The test deployment rejects production commerce. A switch selects both
providers together, with no inference from old Midtrans credentials. Test
orders remain separate and cannot be sent to live Biteship. Keep sandbox
credentials available for delayed notifications; do not move sandbox order
files into the production directory. Confirm the real pickup contact and
address before creating a production shipment.

## Provider dashboards

1. Obtain Ezkart's CV approval.
2. Complete DOKU merchant onboarding, including the merchant-disbursement
   capability required by Ezkart.
3. Implement and verify DOKU payment creation, callbacks, refunds,
   reconciliation, and disbursements before enabling production checkout.
4. In Biteship, switch off Testing Mode and create a `biteship_live.` API key.
5. Submit and obtain activation for the Biteship live Order API. Live rates may
   work before live order creation is authorized.
6. Fund the Biteship balance and confirm the pickup address and contact.
7. Add `https://YOUR-WEBSITE/cart/api/biteship-webhook.php?environment=production` for the
   `order.status`, `order.price`, and `order.waybill_id` events. Configure its
   authorization with the same private webhook token stored on the server.

## Safe first transaction

1. Open `/cart/api/health.php`. It must report the DOKU payment integration,
   Biteship fulfillment, and the Biteship webhook as production-configured.
2. Request one shipping quote to a real deliverable address.
3. Make one low-value real purchase you control.
4. Confirm the signed DOKU callback marks it paid exactly once.
5. Confirm payment leaves the order awaiting merchant acceptance and creates no Biteship order.
6. Accept the order, choose **Arrange pickup**, and confirm one—and only one—Biteship order is created with the expected pickup,
   recipient, courier, weight, price, and reference.
7. Cancel the shipment in the provider dashboard if it was only a launch test.
8. Confirm a simulated or real Biteship status change updates the Ezkart order.
9. Confirm the merchant receives the expected disbursement and that the ledger,
   fees, and reconciliation record match the provider reports.

Do not accept public orders if the health endpoint is not green or the live
Biteship Order API is still awaiting activation.
