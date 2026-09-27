# Provider settlement accounting

Migration 0053 records actual DOKU processing fees and routed cash credits against
the original payment capture. Corrected observations create balanced adjustments;
a complete voided group reverses prior settlement recognition. Capture records,
original fee policies and previous entries remain unchanged. These entries do not
release seller earnings, authorize withdrawals or prove live provider acceptance.

## Evidence and attribution

The original order must have a primary DOKU capture, allocated capture journal,
accepted flat split rule and SNAP dispatch bound to the same seller/platform
wallets. Collections must belong to those original enrollments and credentials.
Both account histories of both wallets must be exhausted over the same closed
window, including order creation and capture verification. Partial coverage,
different windows and a later unfinished overlapping read cannot be substituted.
Additional captures require attribution review instead of another seller allocation.

The supported group contains one `PAYMENT` credit in the seller pending account
with the exact order ID as merchant reference. Its DOKU reference joins the fee
and destination rows. DOKU documents these grouped events, settlement-time
splitting and account-relative debit/credit directions in its
[Sub-Account V2 guide](https://developers.doku.com/wallet-as-a-service/sub-account/sub-account-v2)
and [Collect and Route guide](https://docs.doku.com/wallet-as-a-service/sub-account/collect-and-route).
The original provider responses remain the evidence; balances and payment-success
callbacks alone cannot establish this group's settlement.

Recognition requires exactly one fee debit in seller pending, one seller cash
split credit and one platform cash split credit. An explicit zero fee is valid;
a missing fee is unknown. The platform credit must equal the original shipping,
product commission and Rp1,250 admin allocation. The seller credit must equal
gross less that allocation and the actual fee. Optional pending outflows must
match either the whole net amount or the two destination amounts. Identical
pending debit legs for equal destinations remain distinct; duplicate critical
payment/fee/credit legs cannot pass by being silently deduplicated.

All recognized rows must be `SUCCESS`, or all must be `VOID` for a voided
assessment. Mixed/pending/failed statuses, refunds, unsupported rows, conflicting
merchant references, missing/duplicate legs and allocation differences remain
unresolved. Negative seller allocations are not clipped or fabricated into cash.
Observed amounts remain decimal strings, including unresolved values above
JavaScript's safe integer range. The current order maximum remains Rp100 billion.

One provider group is permanently bound to one capture under its original
credential/environment. It cannot be reused for another order or silently changed
on the original payment. Raw collections and unresolved assessments remain
available for investigation. Supporting another provider pattern requires its
actual contract/evidence and a new version of the interpretation; the existing
version and immutable results must not be rewritten to change old postings.

## Entries, corrections and current verification

For an initial settled group, debits are positive and credits negative:

| Account | Entry |
| --- | --- |
| Provider receivable | Credit the captured gross |
| Provider cash — seller account | Debit the actual seller credit |
| Provider cash — platform account | Debit the original flat platform credit |
| Seller pending | Debit the actual processing fee |

The entries balance exactly. Shipping reserve, commission and admin allocations
are already recorded by the original capture and are not charged again. Seller
pending now reflects the actual processing cost but remains unavailable to withdraw.

Later consistent evidence posts only the difference from the last recognized
settlement. A fully voided group reverses the recognized cash and processing fee,
returning to the original capture position for payment/refund review. A subsequent
provider correction can recognize the group again through new entries. No refund
is inferred from a void, and an incomplete or ambiguous observation never erases
the last recorded amounts. Unchanged recognition needs no extra journal.

Assessment, derived result, provider-group claim, journal and entries commit
together. A failed entry or stale-source check rolls back the whole operation.
Concurrent submissions converge on one original assessment. The previous-assessment
check prevents one correction from applying against an outdated predecessor.
Source, result, group and journal replacement/update/delete writes are blocked.

New history reads that overlap a selected window suspend current verification
until reconciled. Later observations of the same group/order also suspend it even
outside that old window. Unrelated reads outside the period do not. This check is
independent of immutable historical entries; none of these observations is an
atomic snapshot of DOKU. Protected release/withdrawal operations must check current
evidence and domain holds in their own transaction.

Initial journal time uses the observed provider cash-credit timestamp. Corrections
and void reversals use observation time because the history response does not
establish when an earlier row's status was edited. Both the raw dates and this
time basis are retained in the journal source.

## Private service and command

- `POST /internal/commerce/finance/settlement/reconcile` accepts only `seller`,
  `environment`, `orderId`, `sellerCollectionId` and `platformCollectionId`.
  No fee, amount, account, status or timestamp override is accepted.
- `GET /internal/commerce/finance/settlement?seller=…&environment=…&orderId=…`
  returns the latest assessment, original source references, last recognized
  amounts, current evidence holds and `settlementVerified` for that order.

Both routes require strict JSON/server HMAC and exact store/environment scope;
merchant/customer bearer tokens cannot post money. `settlementVerified` is true
only for current supported settlement evidence without additional-payment
ambiguity. It is independent of delivery confirmation. `earningsReleased` remains
false and `availableToWithdraw` remains null.

The capture summary includes counts of saved settlement interpretations and
reports `settlementConnected` after originals have been assessed. Those aggregate
counts do not substitute for the current per-order check. Delivery status now
includes that check and the corresponding holds; `releaseReady` remains false.

After collecting the two original wallets over the same window:

```sh
php tools/commerce/reconcile-provider-settlement.php \
  --environment=production --seller=SELLER_ID --order=ORDER_ID \
  --seller-collection=fcol_ORIGINAL_SELLER_RECEIPT \
  --platform-collection=fcol_ORIGINAL_PLATFORM_RECEIPT
```

This command accepts TEST/sandbox or beta/production only. Main and mixed
deployment/API/provider modes are rejected. It contacts only Ezkart storage,
retries one lost acknowledgement with the exact source IDs, and cannot be run
over HTTP. Exit 0 means current settlement verification; exit 2 means review;
exit 1 means the command failed and the original IDs should be retained for
recovery. No provider or email schedule is enabled.

## Validation and remaining work

All 77 relevant cases pass: sixteen new Worker settlement cases, two new PHP/
Worker command cases, seventeen existing journal/delivery cases, thirty-six
routing/SNAP/collection/evidence cases and six existing PHP collector cases.
The maximum complete exercise records 3,196 history rows across four accounts
and 164 original responses, then attributes only the six relevant payment legs.
Coverage also includes concurrent retries, rollback, void/reinstatement, actual-fee
corrections, duplicate/foreign evidence, source freshness, explicit zero/negative
boundaries, original plans/shipping, the maximum order and a populated beta upgrade.
All provider responses in these cases are isolated fixtures.

Logs are `/tmp/ezkart-settlement-worker-final-01a0d643.log`,
`/tmp/ezkart-settlement-capacity-01a0d643.log`,
`/tmp/ezkart-settlement-php-final-01a0d643.log`,
`/tmp/ezkart-settlement-journal-delivery-01a0d643.log`,
`/tmp/ezkart-settlement-related-01a0d643.log` and
`/tmp/ezkart-settlement-collector-01a0d643.log`. The PHP integration exposed and
verified a missing bootstrap include in the new private command. PHP syntax,
beta dry build and whitespace checks pass.

The fresh beta export contains 660,934 bytes, SHA-256
`c4000371d9103a9a10c5664a8a89168355faac7cd7651b350b6fc3f070d3a9fc`.
Migration rehearsal preserves every original row across 152 exported tables,
adds only the two intended account codes and leaves three new tables empty.
Integrity and foreign keys pass. Private evidence is in
`/home/branch/.local/share/ezkart/beta-01a0d643/settlement-before-0053-20260927/`.

Actual provider wallet/routing/settlement acceptance, automatic collection and
reconciliation operations, delivery-plus-settlement release, reserves/disputes,
refund accounting, negative-balance recovery and complete withdrawals remain open.
The original uncertain live wallet is not retried. The owner mailbox search at
12:46 UTC has no matching reply to the existing DOKU support request. No real
payment, settlement, refund, payout or earnings release is claimed by these tests.

## Workbench rollout

Implementation `66bafd7` is pushed only to `agent/ezkart-workbench`. Migration
0053 is applied only to the beta database, and Worker
`437c2b87-e0a2-44de-9620-778285a6041b` is deployed. Ten hosted service checks pass
at 12:59 UTC, covering beta health, exact environment/service authorization,
original-order requirements, money-override rejection, empty settlement summary
and preservation of the original uncertain wallet. No accepted settlement,
payment, refund or payout is created by those checks.

At 13:01 UTC, `test.ezkart.id` serves this implementation's exact source document,
loads the new PHP dependencies and returns 404 for the private CLI over HTTP.
Health reports live beta and 154 application tables; checkout remains explicitly
paused. The first hosted check at 12:59 still saw the earlier Hostinger deployment;
it is retained separately from the successful proof.

The post-export is 684,672 bytes, SHA-256
`87fac4d70c29c6b1ea27bbc026927ef5c8db7475734d02d0b31d4a195782436b`.
Its 155 tables restore with no integrity or foreign-key errors. Of the 151
original application tables, 149 are unchanged, the account table preserves
its six originals and adds only the two cash codes, and the user table differs
only by one routine `updated_at` refresh at 12:46:39 UTC from the merchant reload.
Every other original value, including the uncertain wallet registration, is
preserved. The three new settlement tables and all financial journals are empty.

Private evidence is `settlement-hosted-proof.json`,
`settlement-workbench-proof.json`, `settlement-post-preservation.json` and
`settlement-after-0053-20260927/` under the private beta evidence directory.
The existing hourly housekeeping schedule is unchanged. No provider, checkout,
email, TEST or main release hold is lifted by this rollout.
