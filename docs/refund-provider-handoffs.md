# DOKU non-card refund handoff

DOKU's [Indonesian non-card refund procedure](https://docs.doku.com/get-started/manage-business/manage-finances/refund)
requires a support ticket or email with the original brand, invoice, transaction
date/amount, refund amount and customer bank details. Processing follows
settlement. The original transaction fee remains payable. This implementation
prepares and tracks that supported handoff for Ezkart's BCA SNAP purchases.
It neither substitutes an unrelated bank payout nor invents a BCA refund API.

After approval, the original verified buyer can provide an IDR bank destination
from the refund details screen. Entries are private, append-only and versioned;
concurrent changes must match the latest version. Repeating the original details
recovers a lost acknowledgement. No bank account is stored in browser local
storage. The buyer sees the bank, holder name and last four digits after saving;
the store sees only whether details were provided. Ten new changes per account
per hour limit abuse. These are buyer-confirmed details, not a bank inquiry or
proof of account ownership.

In **Ezkart reviews → Approved refunds to process**, a separately authorized
reviewer with fresh authenticator verification can prepare one original request.
Preparation requires an approved allocation, no open appeal, the current bank
version, current evidence, the verified SNAP payment and current conserved
settlement. The database rechecks those requirements, role and proof atomically.
Original provider identity, invoice, amounts, capture, settlement and item
allocations are frozen from stored evidence; the operator cannot type replacements.

The prepared private text file contains the complete bank destination and the
fields required by DOKU. Download requires current reviewer permission and fresh
authenticator proof; the PHP proxy withholds it if the account/session changes
during the request. A read-only reviewer cannot download the full destination.
Preparation grants no provider execution authority, sends no email, and creates
no deferred payment job. A person with the merchant's authority must submit the
request through DOKU's official support channel. Existing outgoing-message
approval requirements still apply to agent-assisted submission.

After actual submission, the reviewer records the original ticket or sent-message
reference and actual submission time. That immutable record is an operator
attestation of submission, not DOKU acceptance or payment evidence. Exact saved
browser retries recover preparation/submission after a lost response. All
parties see **Submitted to DOKU — refund not confirmed**; private support
references stay in the reviewer workspace. The original packet remains available
for follow-up without generating another request.

Once prepared, bank details and approval cannot be replaced. Later appeals can
retain information but cannot decline the refund and release its allocation.
Wrong destinations or uncertain submissions require investigation of the
original provider request. There is deliberately no automatic replacement,
resubmission, cancellation or “mark paid” control. Existing approved-refund
earnings holds remain; stock, payment state, ledger and digital access are unchanged.

Migration 0065 adds three empty tables and the source/authorization guards.
Migration 0066 supplies atomic, source-bound final accounting and digital-access
outcomes, described in [refund finalization](refund-finalization-accounting.md).
Its authenticated outcome input remains unimplemented for DOKU support refunds.
The supervised support route can be used for controlled BCA beta refunds while
automated returned-funds confirmation and funding reconciliation remain open.
Real paid-purchase acceptance remains outstanding.

## Original-case recovery (0074)

Before submitting the downloaded packet, a fresh reviewer selects **Start
original DOKU handoff**. This saves one immutable start against the frozen
request, then exposes DOKU's official support link. It does not send anything.
An interrupted acknowledgement recovers the original start through the browser's
durable exact retry; it cannot create another start. A person must inspect the
original support history or sent mail before any attempted retransmission.
This records the single intended handoff, but cannot technically prevent a person
from sending the file twice outside Ezkart. Existing pre-0074 submissions remain
valid and can receive follow-ups without inventing a historical start.

Reviewers record observations against the latest original-case version:
uncertain submission/outcome, processing, more information requested, declined,
or completion reported. Each has the original ticket/message or response
reference and actual observation time. References remain support-only; customers
and stores receive plain status text. Bank data and correspondence do not belong
in this reference field. Concurrent updates, stale proof, invalid/future dates
and observations earlier than preparation, submission or the last observation
are rejected. Exact replay returns the original saved result after a lost reply.

**Completion reported is not refund confirmed.** These records are operator
observations, including when DOKU is reported to have completed the refund. They
cannot enter `commerce_refund_verified_outcomes`, post journals, change the paid
order, clear earnings holds or revoke digital access. Declined/uncertain cases
retain the original approval and destination for investigation; no new money
request, fallback payout or replacement reference is generated.

## Published contract and remaining integration

The official [non-card procedure](https://docs.doku.com/get-started/manage-business/manage-finances/refund),
[refund service terms](https://docs.doku.com/accept-payments/finance-and-settlement/refund-and-chargeback/refund-and-chargeback),
and [Sub-Account v2 flow](https://developers.doku.com/wallet-as-a-service/sub-account/sub-account-v2)
were reviewed on 28 September 2026. The first supports a ticket/email after
settlement. Sub-Account bank transfer is a separately funded transfer, and debit
cancel reverses a prior Sub-Account debit; neither documents a reversal of the
original BCA virtual-account payment. Brand ID is the original Client ID under
DOKU's [account information contract](https://docs.doku.com/get-started/manage-business).

Earliest usable beta route: approve the original allocation, collect the buyer's
bank destination, verify original payment/settlement, prepare the packet, record
the start, submit it once through the authorized merchant's DOKU support access,
record the actual submission reference, and follow up on that same case.
No additional refund API credentials are required for this published manual
request route. DOKU still decides acceptance, actual funding/shortfall and timing.

For automatic finalization, obtain a DOKU-supported authenticated completion
source and exact correlation to the original support case, payment/capture,
destination, returned amount/currency, unique outcome reference and return time.
Obtain the actual charged fee and funding-account/custody evidence separately;
a missing fee remains unknown. Public support-refund documentation does not
provide that schema, signature or read API. The verifier/collector and source
projection are therefore **unfinished code dependent on that provider contract**,
not an implemented adapter waiting for activation. A screenshot, typed reference,
operator observation or successful unrelated payout cannot substitute for it.
No provider request or financial call was made to establish these conclusions.

## Cost review

Merchant and support details show a read-only breakdown from the original
captured fee policy. Product commission reverses proportionally; shipping does
not earn a commission reversal. A full product refund returns the exact original
commission. Partial refunds show the possible one-rupiah rounding range until
the cumulative confirmed refunds can be posted. Product deductions, shipping
refunds and the buyer total are separate. Original admin and verified payment
fees remain retained once per purchase. A changed seller plan cannot change
these original terms. Buyers do not receive the internal seller cost breakdown.

The recorded owner policy of 27 September retains the original admin fee and
assigns the original actual payment fee to the seller. Consequently the approved
buyer allocation remains product plus approved original shipping; this change
does not deduct those seller costs a second time from buyer principal or rewrite
historical approvals/packets. A future different buyer-deduction policy would
need an explicit versioned quote and approval change.

The actual new refund fee and its payer remain unknown until there is provider
evidence. The owner's rule is that the current funds holder bears that charge;
the preview does not guess custody or post a fee. Shipping funding also requires
reconciliation. Nothing in this view posts a journal, revokes a download, sends
a provider request or reports payment completion.

DOKU also documents a separately funded non-card
[disbursement/refund service](https://docs.doku.com/accept-payments/finance-and-settlement/refund-and-chargeback/refund-and-chargeback).
Its account-specific credentials, funding and verifiable result contract still
need acceptance. The Sub-Account withdrawal caller is not automatically that
service. A published tariff is not an actual fee charged to an Ezkart refund.
