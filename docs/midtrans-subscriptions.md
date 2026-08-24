# Midtrans subscriptions in Ezkart

> **Historical sandbox design only.** Midtrans was rejected for Ezkart
> production on 24 August 2026 because the evaluated setup did not provide the
> merchant disbursement flow Ezkart requires. DOKU is the production target
> after CV approval and merchant onboarding. Do not use this document as a
> production implementation plan.

Ezkart treats `physical`, `digital`, and `subscription` as different fulfillment types. Only physical products have shipping weight or request Biteship rates. Digital products are released after a verified payment. Subscription products store a billing interval and use Midtrans recurring billing after the merchant account is activated for it.

## Required Midtrans flow

1. Ask Midtrans to activate recurring payments for the merchant account. Card recurring/One Click and GoPay recurring can require separate commercial approval.
2. Take the first payment with Snap or Core API and save the reusable card or GoPay token returned by Midtrans. A `recurring` object in a Snap request changes the checkout experience, but does not create the subscription by itself.
3. From the Ezkart server, call `POST /v1/subscriptions` with the server key, saved token, product amount, customer details, and schedule. Midtrans currently documents `credit_card` and `gopay` as the Subscription API payment types.
4. Store the returned subscription ID and status against the Ezkart customer and product. Never accept a price, token, or schedule directly from exported landing-page HTML as authoritative.
5. Configure a separate recurring notification URL in the Midtrans dashboard. Verify notifications server-side, make processing idempotent, and grant access or prepare fulfillment only after a verified successful charge.
6. Use the Subscription API disable, enable, update, and get endpoints for lifecycle changes. Cancellation in Ezkart should disable the provider subscription before changing the local status.

## Fulfillment rules

- Physical: require weight and 3–9 product images; quote shipping and create shipment only for a successfully paid order.
- Digital: require 1–9 images; store the purchased file outside the public web root and issue an expiring, customer-bound download only after payment confirmation.
- Subscription: require 1–9 images; do not request shipping unless the subscription explicitly represents a recurring physical shipment. The current builder models subscriptions as non-shipping products.
- All uploaded images: reject files larger than 2 MB before decoding; allow at most 9.

## Current repository boundary

The landing-page builder persists draft product presentation data in the browser so a merchant can make and preview a sample immediately. The checkout API still uses its server-owned demo catalog. Custom products must be moved into authenticated server-side catalog storage before they can be charged safely. This separation is intentional: accepting a browser-supplied product price would let a customer alter the amount sent to Midtrans.

Official references:

- <https://docs.midtrans.com/reference/create-subscription>
- <https://docs.midtrans.com/reference/api-methods-1>
- <https://docs.midtrans.com/docs/one-click-two-clicks-and-recurring-transaction>
- <https://docs.midtrans.com/docs/payment-settings>
- <https://docs.midtrans.com/reference/http-notification>
