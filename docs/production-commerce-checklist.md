# Production commerce checklist

> **Payment launch is blocked.** Ezkart is awaiting CV approval and subsequent
> DOKU merchant onboarding. DOKU is the production payment-provider target, and
> merchant disbursement must pass an end-to-end test before public orders are
> accepted. Midtrans is rejected for production; its current adapter is legacy
> sandbox scaffolding only.

Production provider credentials stay in the ignored `config.runtime.php`; they
are never committed or merged with a Git branch. The current machine-readable
decision is in [`../project.metadata.json`](../project.metadata.json).

## Runtime configuration

Do not configure production payment credentials until the DOKU integration has
replaced the legacy sandbox adapter. Biteship configuration will use:

```php
'biteship_api_key' => 'biteship_live.YOUR_LIVE_KEY',
'biteship_webhook_token' => 'A_RANDOM_SECRET_AT_LEAST_32_CHARACTERS_LONG',
```

Keep the existing Biteship origin postcode, contact, telephone, email, complete
pickup address, organization, and courier list. Before enabling live Biteship,
decouple its environment selection from the legacy Midtrans credential check.

When real transactions run on the workbench, the existing
`deployment_environment => test` setting keeps callback and return URLs on
`https://test.ezkart.id`. After merge, `deployment_environment => production`
keeps them on `https://ezkart.id`.

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
7. Add `https://YOUR-WEBSITE/cart/api/biteship-webhook.php` for the
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
