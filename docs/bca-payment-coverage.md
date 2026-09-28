# BCA payment coverage

Checked 28 September 2026 against primary BCA/DOKU documentation and Ezkart
workbench `226325c` (beta Worker `7004fa9`, schema 0077). The initial coverage check is distinct from the later QRIS activation receipt
recorded below. The owner wants BCA coverage
while keeping Ezkart's own checkout design and seller Sub-Account model.

## Coverage and account requirements

| Shopper method | Ezkart code and observed DOKU account state | Required activation | Documented seller fund routing / feasibility |
| --- | --- | --- | --- |
| BCA Virtual Account, paid in myBCA, BCA mobile, ATM or KlikBCA | Typed SNAP 1.1 closed-amount creation, callback, original recovery and native payment page exist. BCA Close Amount SNAP is `UPDATING` in the 13:29 WIB service inspection. | BCA SNAP `ACTIVE`, actual assigned service/prefix and Collect & Route; original seller/company wallet confirmations. | VA supports Direct API and Checkout routing. This is the implemented native path. No separate merchant KlikBCA activation is needed to pay an issued VA. |
| QRIS paid using myBCA / BCA mobile | No routed QRIS flow in the current checkout. QRIS was unchecked/selectable, not in the active service list at 13:29 WIB. | QRIS activation and actual merchant credentials; Collect & Route. | Current Sub-Account matrix permits QRIS through hosted Checkout only. The generic direct QRIS API does not establish native seller routing. |
| BCA Mastercard online debit / BCA credit cards on supported networks | No routed card flow in native checkout. BCA card service options were unchecked/disabled at 13:29 WIB. | DOKU Cards Regular Sale approval/configuration and applicable network/acquirer support; Collect & Route. The shopper enables BCA online debit when applicable. | Card acceptance includes domestic debit and credit; Sub-Account matrix lists Credit Card as Checkout-only. Confirm the selected card/acquirer route with DOKU; do not infer every BCA-branded card is accepted. |
| BCA KlikPay | No integration planned. | Unavailable: BCA ended the service on 1 November 2023. | Old DOKU sample enum `KLIKPAY_BCA` does not override BCA's termination announcement. |
| BCA OneKlik | No integration. | A separately established provider contract/integration would be needed. | Current DOKU payment-method and Sub-Account compatibility lists do not establish OneKlik support. Do not offer it based on generic Direct Debit support. |

Dashboard inspection is point-in-time evidence. Collect & Route and the card
options being disabled means there is no ordinary available switch to complete
their activation. Other legacy/non-SNAP BCA VA options are not substitutes for
the original SNAP adapter. No payment or wallet operation was made in this check.

## Preserve the checkout and the fund route

1. Complete the existing BCA SNAP activation/configuration and original wallet
   setup using [the one-time beta sequence](beta-one-time-entry.md). The same
   issued VA covers the BCA banking apps and internet/ATM channels above. This
   change adds missing KlikBCA and KlikBCA Bisnis instructions to the native page.
2. Keep QRIS/card payment creation closed in the current direct flow. A direct
   QRIS code without the documented Sub-Account route would change custody and
   settlement behavior. An ordinary merchant payment is not a safe fallback.
3. DOKU documents hosted Checkout as either a redirect or modal overlay. A modal
   can retain the surrounding Ezkart page, but its inner payment UI remains DOKU's.
   The owner approved this mixed approach on 28 September: Ezkart keeps its cart, order page and native BCA VA; QRIS/cards may use DOKU’s payment window. The new frontend opens only a saved, unexpired `routed_hosted` session after a deliberate click.
   Existing legacy hosted sessions do not supply a new routed checkout path.
4. A routed hosted implementation needs its own original immutable dispatch,
   accepted split binding, typed receipt and signed callback checks, status and
   unknown-response recovery, then actual settlement/fee reconciliation fixtures.
   Preserve the original uncertain operations and existing financial holds.
   Prefer provider confirmation of direct QRIS/Card Sub-Account support if fully
   native payment UI remains required; do not invent `additionalInfo` routing.

## QRIS activation receipt and payment window

At 13:38:41 WIB on 28 September, the owner-authorized QRIS request was submitted
once with brand short name Ezkart and MCC 5262 (Marketplaces). DOKU displayed its
success confirmation and QRIS `UPDATING`, requested 28 September 13:38 GMT+7.
The final form presented no new fee, contract or terms acceptance. Service Details
still showed Updating, no activation date and no QRIS image at 13:42 WIB; it showed
no separate request reference. BCA Close Amount SNAP remained `UPDATING`.
Cards and Collect & Route remain unavailable in the ordinary service selector.
No checkout session, payment, wallet retry or support email was sent by this step.

The checkout displays only configured payment choices: native BCA Virtual Account
or the QRIS/card payment window. The chosen method is frozen in the original
checkout intent and retained through lost-response recovery. DOKU’s window never
replaces the native BCA choice.

The payment window uses DOKU’s documented SDK and strict permitted URL origins.
Closing/reopening or reloading uses the original saved session. Browser messages
and return URLs cannot confirm payment; only the server status does. SDK loading
failure gives a retry for that same order. The native BCA and legacy hosted paths
remain distinct. Focused local desktop/mobile fixtures cover those cases plus
expired/hostile URLs, without provider calls. The fixture verifies Ezkart’s modal
wrapper, not DOKU’s internal payment UI.

DOKU documents displaying a dynamic QRIS code in Checkout. Its explicit static
QRIS download instructions do not prove hosted dynamic QRIS download/share
controls. Those exact controls need observation in an authorized active-channel
session; the Ezkart page does not promise them. Checkout and financial execution
remain held until their actual activation/configuration requirements are met.

No current primary source found establishes that 85% of people use BCA. That
estimate is not needed to prioritize BCA. BCA's 2025 annual report describes
34.3 million customers; this is a customer count, not a national market share.

## Verification of this change

PHP syntax passed. The existing isolated beta SNAP dispatch/payment-page case
passed, including its signed callback and one original provider creation. A
separate local browser check opened both new instruction panels at 1360px and
390px, confirmed they remained readable without horizontal overflow, and made
zero provider calls. The mobile instruction screenshot was visually inspected.
No payment configuration, routing, journal or Worker code changed.

## Primary sources

- [BCA VA channels and instructions](https://www.bca.co.id/id/informasi/Edukatips/2022/07/07/09/19/cara-bayar-menggunakan-bca-virtual-account).
- [BCA QRIS](https://www.bca.co.id/qris): supported BCA apps can pay interoperable QRIS; it need not be acquired by BCA.
- [BCA online debit and credit cards](https://www.bca.co.id/id/informasi/Edukatips/2024/10/10/01/31/Cara-Praktis-Transaksi-Online-Pakai-Kartu-Kredit-atau-Kartu-Debit-BCA).
- [BCA KlikPay termination](https://www.bca.co.id/en/individu/layanan/e-banking/klikpay).
- [DOKU Sub-Account compatibility](https://docs.doku.com/wallet-as-a-service/sub-account#payment-method-compatibility): VA Direct API/Checkout; QRIS and Credit Card Checkout-only; activation through Sales.
- [DOKU payment methods](https://docs.doku.com/accept-payments/payment-methods): card networks and domestic debit; no current BCA OneKlik listing.
- [DOKU activation guide](https://docs.doku.com/get-started/manage-business/manage-payment-methods): `UPDATING` is pending; disabled services may require Sales/agreement.
- [DOKU BCA SNAP](https://developers.doku.com/accept-payments/direct-api/snap/integration-guide/virtual-account/bca-virtual-account).
- [DOKU direct QRIS API](https://developers.doku.com/accept-payments/direct-api/snap/integration-guide/qris): general QR generation is separate from Sub-Account compatibility.
- [DOKU Checkout modal/redirect](https://developers.doku.com/accept-payments/doku-checkout/integration-guide/frontend-integration).
- [BCA 2025 annual report](https://www.bca.co.id/-/media/Feature/Report/File/S8/Laporan-Tahunan/2026/20260212-BCA-AR-2025-ID.pdf).
