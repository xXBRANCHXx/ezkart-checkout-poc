# One-time paid beta entry

The smallest supported physical pilot is one admitted adult seller, one in-stock one-time product, one domestic buyer, BCA SNAP payment and one pickup package. Use `test.ezkart.id` with the isolated **beta/production-provider** configuration. Real payment, delivery, settlement, withdrawal and refund observations happen during this controlled beta. They are not a prerequisite to the existence of beta. Main/public release has the separate owner-approved sustained-validation hold.

## Concrete account requirements

Read-only signed-in checks on 28 September 2026 established:

- **BCA Close Amount SNAP: UPDATING**, requested 27 September at 13:36 WIB. Its presence in the service list does not establish live payment activation.
- **Sub-Account / Collect & Route:** opening Sub-Account V2 → Activate Service navigates to Settings → Service. Add Service → Wallet as a Service shows Balance Management, Collect and Route / Deposit System / Fund Oversight, Embedded Wallet and Fund Connector unchecked and disabled. Collect & Route → Discover explicitly requires verification by the sales/account manager and names `enterprise.sales@doku.com`. There is no available self-service selection for this account. No activation, terms acceptance or new registration was submitted.
- **Biteship:** the beta key shows Rates/Order/Tracking active, but dashboard available balance is **IDR 0 / 0 Pts**. Top-up or a confirmed billing-credit agreement is required for physical bookings. No funding transaction was made.
- **DOKU transfer contract:** the actual charged account and inclusive per-channel fee ceiling are not established by the dashboard. Ezkart paying fees is already owner policy; the provider must confirm how that happens. A public API request without a fee-payer override cannot move the fee to Ezkart by assertion.

Follow up on the existing DOKU case for the original uncertain wallet; never repeat that registration. The private owner-review draft combines activation, original-reference recovery, seller/beneficiary responsibility, transfer billing and manual-refund evidence questions. It has not been sent. The named Sales route and exact original reference are in the private continuation record.

## Activation sequence

1. Obtain BCA ACTIVE confirmation and the correct assigned SNAP service/prefix; complete DOKU Sales verification for the actual seller/platform Sub-Account and routing product. Recover the original uncertain registration through its original case/reference. Bind actual confirmed seller and company account identities; do not fabricate profile IDs or create a replacement wallet.
2. Complete the seller's DOB-only onboarding: declared calendar age 18+, legal name, verified email, phone, saved bank, pickup/return addresses and confirmed map pins. The bank verification and financial-provider duties remain distinct from self-declared DOB. See [the narrow age review](seller-age-declaration.md).
3. Fund Biteship or establish actual credit; retain the production callback configuration. Configure the matching PHP and Worker shipping switches and scheduler from [shipping readiness](beta-shipping-readiness.md). Product weights, stock and selected pickup couriers must be usable.
4. Configure the private `COMMERCE_TRANSFER_FEE_CONTRACT`, actual company funding and original receipt recovery described in [transfer fee funding](transfer-fee-funding.md) and [company treasury](platform-treasury.md). Do not enable an unsupported seller-charged billing arrangement. Keep bank dispatch held until its actual contract and account conditions exist; trial outcomes themselves are learned during beta.
5. Enable `EZKART_COMMERCE_CHECKOUT=enabled` in the private PHP beta runtime and `COMMERCE_CHECKOUT=enabled` in the actual beta Worker configuration when ready to accept the corresponding orders. Physical sales also require `EZKART_COMMERCE_FULFILLMENT=enabled` and `COMMERCE_FULFILLMENT=enabled`. Preserve the existing prospective email cutoff, enabled email flags and cron. These settings must agree; an Executive dashboard label does not activate them.
6. Admit the small supervised cohort. Observe the original order through payment, seller acceptance/pickup, tracking and delivery, actual settlement and eligible earnings. Use the original saved withdrawal/treasury references. For a refund, the approved buyer principal remains product plus approved shipping; retained original fees are seller accounting, not an extra buyer deduction. Use one original DOKU support case and the native [refund follow-up flow](refund-provider-handoffs.md). A reported completion remains unverified until actual original returned-funds evidence is available.

An unknown original outcome pauses that original operation and is investigated; it does not authorize a second payment, shipment or refund. Receipt replay and owned tracking/callback reads stay available while new actions are held. Publishing recurring products, custom domains, campaigns or model moderation is outside this minimal one-time pilot; their independent integration work does not need to be misrepresented as a BCA activation prerequisite.

## Current delivery boundary

The controlled physical workflow, supervised original-case refund tracking and actual company outflow accounting are implemented and fixture-tested. The provider activation, shipping funding and actual fee/billing contract above are account facts still needed. Therefore **BCA approval is not currently the only remaining action**. Detailed code/deployment evidence is in [the batch receipt](beta-wave2-2026-09-28.md). None of these findings is a blanket legal-compliance clearance or an authorization for main/public release.
