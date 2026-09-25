# Production release conditions

Owner instruction confirmed on 19 September 2026: ezkart.id remains unchanged until DOKU approval, about a month of financial and wallet testing, and explicit final owner approval. The prepared legacy sandbox lockout PR #3 remains draft and unmerged. No production deployment is authorized by ongoing dashboard or workbench work.

## Required evidence before release

- DOKU approval and a supported production payment integration with the Ezkart payment UI.
- Sustained workbench validation over roughly a month, with no unresolved financial or wallet defects.
- Signed callback validation, duplicate and out-of-order notifications, payment/amount/environment matching, failed and expired payments, refunds, and provider reconciliation.
- Wallet ledger correctness, pending versus available funds, concurrent withdrawal requests, balance reservations, payout retries and failures, fee reconciliation, and protection against duplicate credits or payouts.
- Seller policy validation: release earnings only after confirmed delivery and provider settlement; actual DOKU fees with estimates shown beforehand; withdrawals of at least Rp250,000; Ezkart covers the seller transfer fee. Future affiliate withdrawals below Rp250,000 carry the Rp2,500 fee. Affiliate support is not part of the current release.
- Explicit owner confirmation of the release candidate and deployment.
- Verify the delivered security headers, including the application's per-page
  CSP. On 25 September, the hosted test merchant response exposed only
  `upgrade-insecure-requests` instead of the detailed policy emitted by PHP in
  the local integration fixture. Investigate hosting/edge header replacement
  and verify the final policy on the deployed test site before release.

## Current validation limits

The current checkout suite verifies sandbox and fixture-based production provider selection, signed callbacks, shipping, and the Executive bridge. Executive tests verify browser access, environment isolation, reporting calculations, user drilldowns, and exports. These checks do not establish a month of operational reliability and do not certify a completed wallet or payout implementation. Wallet rules documented elsewhere are not an operational ledger.

The Executive Dashboard reports payment/order records; its paid value metrics are not seller wallet balances or Ezkart revenue. Production D1 currently has no Ezkart application tables. No production database initialization or release is authorized by this testing work.
