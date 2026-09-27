# Hosted beta acceptance — 28 September 2026

This record concerns `test.ezkart.id` and the isolated beta Worker/D1 only.
Main and the public production storefront remain unchanged.

## Verified in the real browser

- The signed-in merchant can open Orders, Payments, Customers and Messages at
  390px without document overflow or nonempty error alerts. These are the real
  empty beta queues, not seeded order/payment evidence.
- The signed-in customer can open promotional preferences, notifications,
  downloads, messages and three existing saved addresses at 390px. Empty inboxes
  and the absence of purchased downloads are explicit. No address or email
  permission was changed, and no message was sent.
- The public shop loads both products, their visible options and images, with
  the configured support email and phone. Selecting a different option, adding
  one item and continuing to checkout works at 390px. The shopping cart is
  restored to its prior empty state afterward.
- Checkout returns its explicit HTTP 503 pause and disables payment. The pause
  now has its own heading and hides the uncomputed zero-total summary; genuine
  load errors retain their separate message. Existing saved-payment recovery
  remains available, verified by the two PHP/browser hold cases at 1360/390px.
- All five analytics reports pass desktop/mobile checks and a seven-row CSV is
  downloaded and verified. Campaign editing, preview, archive and the actual
  zero-recipient audience are checked without publishing a campaign.
- Separate anonymous browser runs at 1360/390px verify public shop/cart/pause,
  the keyboard skip link and protected merchant/customer sign-in screens with
  no JavaScript errors. These use an isolated test profile, without replacing
  the owner's shared Chrome connection or creating new customer identities.

The live compact scheduler is observed at 23:20–23:26 UTC: notification source,
transactional email, campaign and automation invocations all finish without
exceptions or failures. One truthful weekly catalog source is processed; no
email is created because the current recipients have not opted in. Repeated
notification processing does not duplicate that source. The callback connection
and earlier owner-approved standalone email remain separate evidence.

## Provider and purchase limits

At 23:20 UTC, the signed-in DOKU service list still shows BCA Close Amount SNAP
as **UPDATING**, with 22 other services active. At 23:22 UTC, Balance Management,
Collect and Route / Fund Oversight, Embedded Wallet and Fund Connector remain
unchecked and disabled. The original uncertain wallet registration is preserved;
it is not repeated. FlexiBill remains pending by the owner's explicit decision.

Live payment, shipment/pickup, settled seller release, bank payout, actual refund
and paid digital-download journeys are not accepted. The beta has no paid orders.
Fresh-seller onboarding through a separate real identity also remains unaccepted;
existing-owner checks cannot establish it. Provider activation alone will not
complete refund execution/accounting, recurring billing or custom domains.

Private browser and provider records are saved under `beta-01a0d643/timed-*`
outside Git. No provider payment, financial success, delivery, refund or customer
permission was fabricated to satisfy this acceptance pass.
