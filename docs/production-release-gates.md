# Production release conditions

Owner instruction confirmed on 19 September 2026: ezkart.id remains unchanged until DOKU approval, about a month of financial and wallet testing, and explicit final owner approval. The prepared legacy sandbox lockout PR #3 remains draft and unmerged. No production deployment is authorized by ongoing dashboard or workbench work.

On 27 September the owner reported **DOKU approval received** and authorized
preparing everything for beta/soft-launch. They explicitly reaffirmed that work
stays on workbench and is not pushed to main. Business approval is no longer an
outstanding application task; actual supported payment, settlement, refund and
payout acceptance still needs evidence. See [beta-readiness.md](beta-readiness.md).

The owner subsequently clarified that the workbench beta should use **live DOKU**.
Prepare isolated beta financial storage and live credentials on workbench. That
clarification changes the beta provider target; it does not authorize a main push
or release to `ezkart.id`. Preserve the existing sandbox evidence separately.

## Required evidence before release

- DOKU approval (owner-confirmed 27 September) and a supported production payment integration with the Ezkart payment UI (technical acceptance pending).
- Sustained workbench validation over roughly a month, with no unresolved financial or wallet defects.
- Signed callback validation, duplicate and out-of-order notifications, payment/amount/environment matching, failed and expired payments, refunds, and provider reconciliation.
- Wallet ledger correctness, pending versus available funds, concurrent withdrawal requests, balance reservations, payout retries and failures, fee reconciliation, and protection against duplicate credits or payouts.
- Seller policy validation: release earnings only after confirmed delivery and provider settlement; actual DOKU fees with estimates shown beforehand; withdrawals of at least Rp250,000; Ezkart covers the seller transfer fee. Future affiliate withdrawals below Rp250,000 carry the Rp2,500 fee. Affiliate support is not part of the current release.
- Digital delivery policy confirmed by the owner on 27 September: a verified
  complete download is sufficient delivery evidence. Starting a response,
  granting access, or copying bytes to the PHP server does not meet this rule.
  File integrity and completed transfer evidence must be recorded; provider
  settlement remains independently required before seller earnings can release.
- Refund fee policy confirmed by the owner on 27 September: reverse Ezkart's
  commission proportionally when a refund is confirmed; keep the original admin
  fee. The owner assigns the actual provider refund-processing fee to whoever
  currently holds the proceeds. Whether that changes at seller wallet release
  or completed payout is awaiting clarification; that allocation is not enabled.
- Explicit owner confirmation of the release candidate and deployment.
- Verify delivered security headers on the final release candidate. The TEST
  merchant CSP replacement found on 25 September is fixed in `c316c2b`:
  eleven hosted GET/HEAD cases on 27 September preserve PHP's exact selected
  policy, and desktop/mobile browser checks block unapproved inline scripts.
  See [merchant-content-security.md](merchant-content-security.md). Signed-in
  hosted workflow acceptance remains pending; this is not production approval.

## Current validation limits

The current checkout suite verifies sandbox and fixture-based production provider selection, signed callbacks, shipping, and the Executive bridge. Executive tests verify browser access, environment isolation, reporting calculations, user drilldowns, and exports. These checks do not establish a month of operational reliability and do not certify a completed wallet or payout implementation. Wallet rules documented elsewhere are not an operational ledger.

The Executive Dashboard reports payment/order records; its paid value metrics are not seller wallet balances or Ezkart revenue. Production D1 currently has no Ezkart application tables. No production database initialization or release is authorized by this testing work.

Private digital storage, paid download entitlements, complete-download evidence
and purchase-linked reviews have local D1/R2 and browser coverage. Both buyer and
merchant 500 MiB capacity exercises now pass. See
[digital-product-files.md](digital-product-files.md) and
[digital-commerce.md](digital-commerce.md). Allocated refunds/revocation, actual
settlement and earnings release, subscriptions and signed-in hosted acceptance
remain open, with existing financial and provider holds unchanged.
