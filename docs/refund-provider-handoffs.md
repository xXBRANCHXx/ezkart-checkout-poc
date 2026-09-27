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
Provider acknowledgement and actual returned-funds evidence, refund funding,
proportional commission reversal, retained admin/original payment fees, actual
refund-fee custody, entitlement effects, processing notifications and financial
reconciliation remain necessary. This handoff does not close the refund or
broader launch gate. Real paid-purchase acceptance remains outstanding.

## Cost review

Merchant and support details show a read-only breakdown from the original
captured fee policy. Product commission reverses proportionally; shipping does
not earn a commission reversal. A full product refund returns the exact original
commission. Partial refunds show the possible one-rupiah rounding range until
the cumulative confirmed refunds can be posted. Product deductions, shipping
refunds and the buyer total are separate. Original admin and verified payment
fees remain retained once per purchase. A changed seller plan cannot change
these original terms. Buyers do not receive the internal seller cost breakdown.

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
