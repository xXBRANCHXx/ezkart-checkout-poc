# Confirmed refund accounting boundary

Migration 0066 and `POST /internal/commerce/finance/refunds/finalize` implement
local finalization of the original refund allocation and provider request. The
private service accepts only `environment`, `seller`, `refundId`, and `evidenceId`.
It cannot accept an amount, successful status, bank replacement, or verification
flag. Merchant/reviewer credentials cannot call it.

**Integration is blocked:** the repository has no supported authenticated DOKU
non-card returned-funds outcome contract. `commerce_refund_verified_outcomes` is
an intentionally empty, read-only SQL view with no writer or enable flag. HMAC,
a prepared packet, a support submission, settlement history, and payment success
cannot populate it. Production code therefore cannot finalize a refund yet.
Tests replace this boundary only inside isolated local databases.

A future provider-specific verifier must project immutable successful outcomes
bound to the original provider request, environment, credential fingerprint,
brand, capture, original payment reference, fixed destination, exact requested
amount/currency, actual returned-funds time, unique outcome reference and retained
raw-evidence hash. It must authenticate the provider evidence itself and reject
ambiguous/conflicting outcomes. This change supplies no provider endpoint or
manual confirmation UI. A database schema change plus a verified adapter is
required to open the boundary; a caller-supplied assertion is insufficient.

Once such evidence exists, one atomic insert posts the balanced immutable journal,
updates order state/revision, derives the confirmed refund projection, changes
allocated digital access, and reconciles held earnings. Admission and commission
calculation happen inside that transaction. Duplicate requests, competing workers,
original-response loss and conflicting references cannot double-post. Any failed
entry rolls back every effect. Original approval, entitlement, download and
provider request history remains intact.

Commission uses the original captured Basic 500 bps / Advanced 600 bps policy:
round the original commission times cumulative product refunds divided by the
original product subtotal, half up, then subtract prior reversals. Integer
arithmetic stays exact at the Rp100 billion limit. A full product refund reverses
exactly the original commission; shipping produces no commission reversal. The
Rp1,250 admin fee and original actual payment fee remain charged once. Seller
shortfalls remain negative earnings, not a fabricated zero balance.

Buyer principal credits `refund_funding_unreconciled`; it does not select or debit
an assumed provider wallet. Unknown new refund fees remain null. Observed actual
fees are retained in evidence without assigning or charging a payer while custody
is unresolved. Funding and fee holds prevent withdrawal availability; reconciling
actual funding, fee custody and recovery remains separate work.

Only digital lines positively allocated to the confirmed refund lose future
access, including old grants and checks after storage awaits. A partially
refunded line is held as `refund_review`;
only a cumulatively fully refunded line is labeled `refunded`. Releasing a partial
line's hold needs an explicit policy and implementation; this slice does not
invent permanent partial-refund revocation or silently restore access. Unrelated
digital lines on a native partial refund remain available. Shipping-only refunds revoke
none. Legacy partial refunds without allocated evidence retain their existing
review hold. Approved/confirmed allocations remain reserved against additional
refund requests; remaining unallocated amounts can follow the original workflow.

Shared edits are the one private route/import in `src/index.js`, migration
registration in `test/commerce-schema.mjs`, and targeted refund/digital read and
access projections. The submission sentence in `cart/refunds.js` reflects a
confirmed outcome. No execution flags, provider credentials, scheduler, remote
database, deployment, or original financial records were changed.
