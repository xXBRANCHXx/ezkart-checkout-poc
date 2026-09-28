# One-time paid beta entry

The smallest supported physical pilot is one admitted adult seller, one in-stock one-time product, one domestic buyer, BCA SNAP payment and one pickup package. Use `test.ezkart.id` with the isolated **beta/production-provider** configuration. Real payment, delivery, settlement, withdrawal and refund observations happen during this controlled beta. They are not a prerequisite to the existence of beta. Main/public release has the separate owner-approved sustained-validation hold.

## Current owner-confirmed status — 28 September 2026

DOKU is ready; live testing remains. Prepare Ezkart Workbench for beta, including
ShopeePay, whose integration is implemented and deployed. Earlier activation
observations below are historical and do not override this later owner update.
The actual app handoff, payment, callback and settlement are beta acceptance
work, not an additional provider-activation gate. Preserve original account and
operation references; readiness confirmation does not fabricate transaction
results or by itself change runtime switches or the main/public release hold.

## Earlier account observations

Account observations and the later owner update on 28 September 2026:

- **BCA Close Amount SNAP: UPDATING**, requested 27 September at 13:36 WIB. Its presence in the service list does not establish live payment activation.
- **QRIS:** the owner-authorized request was submitted once on 28 September at 13:38 WIB, with brand Ezkart and MCC 5262 (Marketplaces). It is **UPDATING**, not active; no new fee/contract acceptance appeared. Card service choices remain disabled. See [coverage and the QRIS receipt](bca-payment-coverage.md).
- **Sub-Account / Collect & Route:** opening Sub-Account V2 → Activate Service navigates to Settings → Service. Add Service → Wallet as a Service shows Balance Management, Collect and Route / Deposit System / Fund Oversight, Embedded Wallet and Fund Connector unchecked and disabled. Collect & Route → Discover explicitly requires verification by the sales/account manager and names `enterprise.sales@doku.com`. There is no available self-service selection for this account. No Sub-Account activation, terms acceptance or new wallet registration was submitted.
- **Biteship:** the owner subsequently confirmed a top-up and explicitly said not to test it. Funding is owner-confirmed, not independently checked. No balance check, rate quote, booking or other Biteship probe was made after that instruction. Existing shipping/payment holds remain unchanged. Earlier read-only evidence showed Rates/Order/Tracking entitlement active.
- **DOKU transfer contract:** the actual charged account and inclusive per-channel fee ceiling are not established by the dashboard. Ezkart paying fees is already owner policy; the provider must confirm how that happens. A public API request without a fee-payer override cannot move the fee to Ezkart by assertion.

Follow up on the existing DOKU case for the original uncertain wallet; never repeat that registration. The private owner-review draft combines activation, original-reference recovery, seller/beneficiary responsibility, transfer billing and manual-refund evidence questions. It has not been sent. The named Sales route and exact original reference are in the private continuation record.

## Workbench beta preparation sequence

1. Use the owner-confirmed ready DOKU setup. Ensure Workbench uses its actual assigned SNAP service/prefix, approved payment methods and original seller/company Sub-Account bindings. Reconcile any original uncertain registration using its original case/reference; do not create a replacement wallet. Treat real payment and routing observations as beta testing, not as evidence that activation is still pending.
2. Complete the seller's DOB-only onboarding: declared calendar age 18+, legal name, verified email, phone, saved bank, pickup/return addresses and confirmed map pins. The bank verification and financial-provider duties remain distinct from self-declared DOB. See [the narrow age review](seller-age-declaration.md).
3. The owner has confirmed Biteship funding; retain the production callback configuration. Do not probe or test the top-up under the current instruction. When shipping activation is separately authorized, configure the matching PHP and Worker shipping switches and scheduler from [shipping readiness](beta-shipping-readiness.md). Product weights, stock and selected pickup couriers must be usable.
4. Configure the private `COMMERCE_TRANSFER_FEE_CONTRACT`, actual company funding and original receipt recovery described in [transfer fee funding](transfer-fee-funding.md) and [company treasury](platform-treasury.md). Do not enable an unsupported seller-charged billing arrangement. Keep bank dispatch held until its actual contract and account conditions exist; trial outcomes themselves are learned during beta.
5. Enable `EZKART_COMMERCE_CHECKOUT=enabled` in the private PHP beta runtime and `COMMERCE_CHECKOUT=enabled` in the actual beta Worker configuration when ready to accept the corresponding orders. Physical sales also require `EZKART_COMMERCE_FULFILLMENT=enabled` and `COMMERCE_FULFILLMENT=enabled`. Preserve the existing prospective email cutoff, enabled email flags and cron. These settings must agree; an Executive dashboard label does not activate them.
6. Admit the small supervised cohort. Observe the original order through payment, seller acceptance/pickup, tracking and delivery, actual settlement and eligible earnings. Use the original saved withdrawal/treasury references. For a refund, the approved buyer principal remains product plus approved shipping; retained original fees are seller accounting, not an extra buyer deduction. Use one original DOKU support case and the native [refund follow-up flow](refund-provider-handoffs.md). A reported completion remains unverified until actual original returned-funds evidence is available.

An unknown original outcome pauses that original operation and is investigated; it does not authorize a second payment, shipment or refund. Receipt replay and owned tracking/callback reads stay available while new actions are held. Publishing recurring products, custom domains, campaigns or model moderation is outside this minimal one-time pilot; their independent integration work does not need to be misrepresented as a BCA activation prerequisite.

## Native BCA and hosted QRIS/cards

The owner approved retaining Ezkart’s cart/order screen and native BCA VA while
using DOKU’s payment window for QRIS/supported cards. The shopper’s typed choice
is stored in the original checkout intent: closing the window, reloading or
recovering a lost response retains the same choice and provider session.
A browser return or success message cannot mark an order paid.

The existing `EZKART_DOKU_PRODUCTION_PAYMENT_FLOW=snap_bca` keeps BCA-only mode.
For the mixed mode, the private PHP setting is
`EZKART_DOKU_PRODUCTION_PAYMENT_FLOW=routed_hosted` with
`EZKART_DOKU_PRODUCTION_CHECKOUT_METHODS` containing only actual enabled methods,
comma-separated: `VIRTUAL_ACCOUNT_BCA` exposes the native BCA choice; `QRIS`
and/or `CREDIT_CARD` expose the provider window. This is an activation procedure,
not a claim these settings or services are enabled now. The existing assigned
SNAP settings remain necessary for native BCA. Before hosted sends, configure
`EZKART_COMMERCE_PAYMENT_RECOVERY_DIRECTORY` as a persistent 0700 private directory
outside public roots, following [original-response recovery](routed-checkout.md).
Its saved receipts permit recovery without a second provider create.
Sub-Account/Collect & Route,
original wallet confirmation and the checkout holds above still apply.

DOKU’s documented Checkout response exposes a payment URL, not a routed QR
payload API. Do not scrape the iframe or substitute generic direct QRIS without
its seller-wallet route. Hosted download/share controls have not been observed
in an actual active-channel session and are not promised by this implementation.

Payment processing fees remain **actual provider fees** for the selected method;
QRIS/card amounts must not copy a BCA fee or treat missing evidence as zero.
Settlement and releasable earnings still require original seller/company wallet
history and actual fee evidence. Missing or unsupported evidence remains held.
Company-paid bank-transfer fees are the separate funding contract in step 4.
The smallest BCA pilot remains the entry path above; QRIS/cards can join only
when their own provider activation and routing conditions exist.

## Current delivery boundary

The controlled physical workflow, supervised original-case refund tracking and actual company outflow accounting are implemented and fixture-tested. Biteship funding is owner-confirmed without a new provider check. DOKU activation, original wallet/routing and the actual fee/billing contract remain account requirements. Therefore **BCA approval is not currently the only remaining action**. Detailed code/deployment evidence is in [the batch receipt](beta-wave2-2026-09-28.md). None of these findings is a blanket legal-compliance clearance or an authorization for main/public release.
