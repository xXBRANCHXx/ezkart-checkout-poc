# DOKU subscription readiness

Subscription product plans are saved, including monthly/yearly variants. Shop
prices now display the selected plan cadence. Subscription choices have no
physical stock count and stay unavailable for purchase. Both PHP and the
central order API reject a subscription through the one-time BCA checkout before
creating an order, payment, reservation or provider call.

This is not an operational subscription billing lifecycle. Customer mandates,
recurring charges, renewal reconciliation, cancellation, failed-renewal handling
and time-bounded access remain to be implemented and accepted. The old Midtrans
subscription tables/document describe a rejected historical design.

## Confirmed provider boundary, 28 September 2026

The signed-in production DOKU dashboard's Subscription and Billing menu redirects
to FlexiBill onboarding. The separate terms require an initial IDR 1,000,000
deposit to start the service. The owner explicitly chose **Leave registration
pending**. The terms were not accepted, registration was not submitted and no
deposit was transferred. Business approval does not establish FlexiBill activation.

DOKU documents [Account Billing](https://developers.doku.com/flexibill/account-billing)
and an [OVO recurring flow](https://developers.doku.com/accept-payments/direct-api/snap/integration-guide/e-wallet/ovo).
The latter needs the buyer's account binding and initial OTP/PIN consent before
scheduled recurring payments. It also has an explicit account-unbinding flow.
Neither contract is the existing BCA VA payment adapter.

The current [card integration guide](https://developers.doku.com/accept-payments/direct-api/non-snap/card)
lists recurring payments under its host-to-host integration. The hosted payment
page documents Sale, Authorize and Installment; a saved card token alone does not
establish a recurring mandate. Ezkart must not silently turn a subscription into
a one-time charge or activate access merely from a browser return.

Before implementation can be considered complete, select and activate the
approved recurring service, bind customer consent and original plan terms,
retain one original charge identity per billing period, reconcile signed payment
outcomes, and verify cancellation/renewal/access behavior on workbench. Provider
activation alone will not finish this application work.
