# Production commerce checklist

Production Midtrans and Biteship credentials stay in the ignored
`config.runtime.php`; they are never committed or merged with a Git branch.

## Runtime configuration

Use these values on the website that will accept real customer orders:

```php
'commerce_environment' => 'production',
'checkout_public_url' => 'https://ezkart.id',
'midtrans_merchant_id' => 'YOUR_PRODUCTION_MERCHANT_ID',
'midtrans_client_key' => 'YOUR_PRODUCTION_CLIENT_KEY',
'midtrans_server_key' => 'YOUR_PRODUCTION_SERVER_KEY',
'biteship_api_key' => 'biteship_live.YOUR_LIVE_KEY',
```

Keep the existing Biteship origin postcode, contact, telephone, email, complete
pickup address, organization, and courier list. Production mode will refuse
Midtrans Sandbox keys and a Biteship test key.

Leave `midtrans_order_storage` empty to let Ezkart automatically keep production
and sandbox order files in separate private directories. If you specify a path,
use a production-only directory that was never used for sandbox orders.

If real transactions intentionally run on the workbench first, set
`checkout_public_url` to `https://test.ezkart.id`. Its callback and return URLs
will then stay on that deployment. Change it to `https://ezkart.id` in the
production website's private runtime config after the code is merged.

## Provider dashboards

1. In Midtrans Production, copy the Production keys—not the Sandbox keys.
2. Confirm the HTTP notification URL is reachable at
   `https://YOUR-WEBSITE/cart/api/callback.php`. The transaction request also
   supplies this URL explicitly.
3. Set the Midtrans Finish URL to the public checkout or home page. Ezkart also
   supplies a per-order finish callback.
4. In Biteship, switch off Testing Mode and create a `biteship_live.` API key.
5. Submit and obtain activation for the Biteship live Order API. Live rates may
   work before live order creation is authorized.
6. Fund the Biteship balance and confirm the pickup address and contact.

## Safe first transaction

1. Open `/cart/api/health.php`. It must report `commerce_environment` as
   `production`, with Midtrans and Biteship configured.
2. Request one shipping quote to a real deliverable address.
3. Make one low-value real purchase you control.
4. Confirm the signed Midtrans callback marks it paid exactly once.
5. Confirm one—and only one—Biteship order is created with the expected pickup,
   recipient, courier, weight, price, and reference.
6. Cancel the shipment in the provider dashboard if it was only a launch test.

Do not accept public orders if the health endpoint is not green or the live
Biteship Order API is still awaiting activation.
