# Physical shipping for controlled beta

The one-package physical-order path is implemented: seller pickup/return addresses and confirmed pins → customer rates and reviewed checkout total → frozen order addresses/items/weight → paid, allocated order → seller acceptance and pickup request → original-reference courier booking → authenticated tracking callbacks/reads → delivery recorded on that order. Delivery does not itself prove settlement or make funds withdrawable.

The 28 September shipping slice fixes three concrete gaps:

- Central checkout excludes explicit drop-off-only or malformed collection-method rates, because its booking workflow requests pickup. Biteship documents `available_collection_method` on rates and `origin_collection_method` on creation. Older responses without that field retain the existing default-pickup behavior. [Rates](https://biteship.com/en/docs/api/rates/retrieve), [Order creation](https://biteship.com/en/docs/api/orders/create).
- Booking/cancellation has a separate operator activation switch. Held mode blocks new shipping quotes/checkout attempts before provider calls and prevents new pickup/cancellation actions. Existing action receipts remain replayable, tracking refreshes and callbacks continue, and the dispatcher does not claim or consume attempts for create/cancel jobs while held. It resumes their original references when enabled.
- Central health no longer demands a legacy global warehouse. `fulfillment_configured` means the applicable API configuration is present; `pickup_source=seller_shipping_settings` identifies the source. `booking_enabled` separately reports PHP activation. Neither boolean establishes provider Order API entitlement, account balance, or an individual seller’s readiness.

## Settings and activation

Production Biteship is used on the **beta** deployment. The following are configuration names, not secret values:

| Location | Setting / action |
| --- | --- |
| PHP beta runtime | `EZKART_DEPLOYMENT_ENVIRONMENT=beta`, `EZKART_COMMERCE_ENVIRONMENT=production`, `EZKART_COMMERCE_STORAGE=d1` |
| PHP beta runtime | `EZKART_BITESHIP_PRODUCTION_API_KEY` with the live-key prefix; `EZKART_BITESHIP_PRODUCTION_WEBHOOK_TOKEN` with at least 32 random characters |
| PHP beta runtime | `EZKART_COMMERCE_FULFILLMENT=enabled` to permit rates/bookings/cancellations; `held` stops new ones |
| Worker beta | `COMMERCE_FULFILLMENT=enabled` to permit merchant pickup/cancellation intents; absent or `held` keeps beta writes paused |
| Biteship dashboard | Production callbacks to `https://test.ezkart.id/cart/api/biteship-webhook.php?environment=production`, with matching configured authentication, for `order.status`, `order.price`, `order.waybill_id` |
| Scheduler | Run `php tools/commerce/fulfillment-dispatch.php --once` each minute, under the matching private beta runtime, with non-overlap and captured exit/status reporting |
| Merchant | Complete DOB-only onboarding, bank and verified-email requirements; save/confirm pickup and return pins and enable desired couriers; products need weights and available stock |

Use the matching Worker URL and `EZKART_COMMERCE_SERVICE_SECRET` already required by central commerce. Do not configure a shared global warehouse as a substitute for seller settings. Main/public production is outside this activation; the code keeps courier writes limited to test/beta. Existing TEST default behavior is retained unless explicitly held.

Before enabling booking, establish that this Biteship account is a live Order API account with sufficient balance or agreed billing credit. Biteship’s creation documentation identifies that funding requirement. This slice does not contact the account or certify its funding/entitlement. Those are account configuration facts, not another required full acceptance campaign. Actual booking, pickup, tracking and delivery observations belong during supervised beta once activated. BCA/payment activation remains a separate control. [Biteship order creation](https://biteship.com/en/docs/api/orders/create).

Keep payment/checkout held until the operator is ready to accept the corresponding paid orders. Enable both shipping switches coherently; a one-sided switch is not complete activation. A hold does not stop a courier already in transit. Leave callback handling and tracking reads available while reviewing that original shipment.

## Recovery and scope

Never change an uncertain shipment’s original reference or credential binding, create a replacement booking to hide a timeout, or interpret a callback as a refund. A lost create response retries the same provider-unique reference and validates the duplicate’s provider record; a saved binding uses an owned provider read. A lost cancellation response is checked against the original shipment. Provider credential changes stop automated recovery for operator review. Existing account/reference and tenant isolation remain unchanged. [Retrieve an order](https://biteship.com/en/docs/api/orders/retrieve).

This supports the current whole-order pickup workflow. Drop-off, split packages, scheduled pickup selection, labels and return labels remain separate product features; they are not required to exercise the supported basic beta journey. Missing instant-courier origin/destination pins correctly prevent those services from appearing.

## Local evidence

- Four shipping-setting/checkout tests: private seller-origin quotes without global warehouse fields, pin-dependent instant services, real merchant address/pin editing and lost-save recovery at 1360/390px, explicit drop-off filtering, and held checkout making zero provider calls.
- Eight fulfillment tests: frozen package creation, lost provider/storage/cancellation responses, owned customer tracking/privacy, real merchant action recovery on desktop/mobile, held scheduler without consumed booking attempts, and the merchant paused-booking view.
- Beta Worker dry build and PHP/JavaScript syntax checks passed. Browser screenshots are in `/tmp/ezkart-beta-shipping-01a0e5b6/`.

All provider responses in these tests are isolated fixtures. No real quote, shipment, cancellation, provider configuration change, or money action was performed. No database migration is needed for this slice.

## Account observation — 28 September 2026

A signed-in, read-only dashboard check at approximately 05:15 UTC showed the Ezkart Workbench Beta key with Rates, Order and Tracking API marked active. The available balance was IDR 0 / 0 Pts. No billing-credit agreement was established in that view. That was an earlier point-in-time observation. The owner subsequently confirmed a top-up and explicitly instructed **not to test it**. Funding is now recorded as owner-confirmed, not independently verified. No new Biteship API call, balance check, rate quote, booking, cancellation, health probe or activation was performed; existing shipping/payment holds remain unchanged.
