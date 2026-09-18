# Seller fees and payouts

## Source and implementation status

The user supplied **Ezkart Pricing Mockup (5).pdf** on 2026-09-18 to explain the
seller-wallet and fee model. Its SHA-256 is
`c46c1e6fb6a9f4b8ef4bba29bd7502fe75bd25a8396d54f8fcc9fcc34b204753`.
This document records the rules shown in that mockup and their implications for
the DOKU integration. The PDF is unchanged.

A DOKU sandbox seller sub-account has been created, as recorded in
[the sandbox setup](commerce-sandbox-setup.md#seller-wallets-fee-rules-and-payouts).
Seller onboarding, checkout routing, split-rule creation and payouts are not yet
implemented in Ezkart. The following amounts are a specification, not configured
provider rules or available wallet balances.

## Fees shown in the mockup

Customers pay the product subtotal plus shipping. Seller fees are deducted from
the product proceeds; they are not added on top of the customer's total.

| Plan | Commission on product subtotal | Admin per order | Transaction fee |
| --- | --- | --- | --- |
| Basic | 5% | Rp1,250 | Estimated payment-processing fee |
| Advanced | 6% | Rp1,250 | Estimated payment-processing fee |
| Marketplace | 7% | Rp1,250 | Estimated payment-processing fee |

The commission basis is the product subtotal, before commission, admin and
payment-processing deductions. Shipping is excluded from that basis and is set
aside for shipping costs. It is not commission revenue or seller earnings.
The mockup's Rp4,750 transaction fee is an example estimate, not an established
fee schedule for every payment method.

With product subtotal `ST`, shipping `SH`, commission rate `r`, admin `A = 1250`
and transaction-fee estimate `F`:

```text
Customer payment       = ST + SH
Commission             = ST × r
Estimated seller share = ST − Commission − A − F
Platform allocation    = SH + Commission + A
```

The platform allocation includes shipping funds and admin charges as well as
commission; it is not all profit. The existing delivery-skipping sandbox flow
uses `SH = 0`. The Rp20,000 shipping in the PDF is a worked example, not a new
charge to add to that flow.

## Checked example

For `ST = Rp100,000`, `SH = Rp20,000` and `F = Rp4,750`, the customer pays
Rp120,000 for every plan:

| Allocation | Basic | Advanced | Marketplace |
| --- | ---: | ---: | ---: |
| Shipping set aside | Rp20,000 | Rp20,000 | Rp20,000 |
| Ezkart commission | Rp5,000 | Rp6,000 | Rp7,000 |
| Ezkart admin | Rp1,250 | Rp1,250 | Rp1,250 |
| DOKU fee (example) | Rp4,750 | Rp4,750 | Rp4,750 |
| Seller share | **Rp89,000** | **Rp88,000** | **Rp87,000** |
| Total allocated | Rp120,000 | Rp120,000 | Rp120,000 |

The Basic example's final Rp89,000 is correct. Its intermediate figure should
be **Rp93,750**, because `100000 − 5000 − 1250 = 93750`; the PDF currently shows
Rp93,000 at that step.

## Mapping to DOKU

[DOKU's Collect and Route guide](https://docs.doku.com/wallet-as-a-service/sub-account/collect-and-route)
says that provider processing fees are deducted before split rules run at
settlement. Therefore a provider percentage split on the settled amount would
not reproduce the mockup's percentage of product subtotal.

The proposed mapping, if the seller bears the actual provider fee, is to compute
commission in Ezkart and create a flat allocation of
`shipping + commission + admin` to the platform, leaving the remaining settled
amount for the seller. The exact API contract and destination-account rules
still require verification before creating or attaching provider rules.

For the Basic example, if DOKU actually charges Rp4,750:

```text
DOKU settled amount = 120000 − 4750 = 115250
Platform allocation = 20000 + 5000 + 1250 = 26250
Seller remainder    = 115250 − 26250 = 89000
```

Do not subtract the same DOKU processing fee again as an additional split debit.
Each order must retain its applicable plan and fee calculation so later plan
changes do not alter prior allocations. The customer's request must not choose
the seller's commission rate or destination accounts.

## Decisions still pending

The mockup does not state when seller earnings become eligible for withdrawal.
The user has been asked whether eligibility follows settlement, confirmed
delivery plus settlement, or manual approval. Provider settlement and Ezkart's
withdrawal policy are separate conditions.

The mockup calls the transaction fee an estimate. The user has also been asked
whether final seller proceeds should use DOKU's actual fee, or retain the estimate
with Ezkart absorbing or retaining any difference. Until this is resolved, do not
present the estimated seller share as a confirmed withdrawable balance.
