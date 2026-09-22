# Seller fees and payouts

## Source and implementation status

The user supplied **Ezkart Pricing Mockup (5).pdf** on 2026-09-18 to explain the
seller-wallet and fee model. Its SHA-256 is
`c46c1e6fb6a9f4b8ef4bba29bd7502fe75bd25a8396d54f8fcc9fcc34b204753`.
This document records the rules shown in that mockup and their implications for
the DOKU integration, plus the user's subsequent withdrawal instructions on the
same date. The PDF is unchanged.

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
| Basic | 5% | Rp1,250 | Actual DOKU fee; estimate shown beforehand |
| Advanced | 6% | Rp1,250 | Actual DOKU fee; estimate shown beforehand |
| Marketplace | 7% | Rp1,250 | Actual DOKU fee; estimate shown beforehand |

The commission basis is the product subtotal, before commission, admin and
payment-processing deductions. Shipping is excluded from that basis and is set
aside for shipping costs. It is not commission revenue or seller earnings.
The mockup's Rp4,750 transaction fee is an example estimate, not an established
fee schedule for every payment method. The user subsequently confirmed that
the seller ultimately pays **DOKU's actual processing fee**, with an estimate
shown before payment. Final seller earnings must use the actual provider fee.

With product subtotal `ST`, shipping `SH`, commission rate `r`, admin `A = 1250`
and transaction-fee estimate `F`:

```text
Customer payment       = ST + SH
Commission             = ST × r
Estimated seller share = ST − Commission − A − F
Final seller share     = ST − Commission − A − Actual DOKU processing fee
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

The proposed mapping for the confirmed actual-fee policy is to compute
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
Keep the pre-payment estimate and final actual fee as separate recorded values.
The estimate is not a guaranteed seller payout or an extra provider charge.
Each order must retain its applicable plan and fee calculation so later plan
changes do not alter prior allocations. The customer's request must not choose
the seller's commission rate or destination accounts.

## Withdrawal rules supplied by the user

| Recipient | Ezkart minimum withdrawal | Withdrawal fee | Scope |
| --- | ---: | --- | --- |
| Seller | **Rp250,000** | **Ezkart covers the transfer fee**; no seller withdrawal fee | Seller-wallet integration |
| Affiliate | No Ezkart minimum; may request withdrawal at any time | **Rp2,500** below Rp250,000; **no recipient withdrawal fee** at or above Rp250,000 | Future project |

The seller threshold is a minimum withdrawal amount, not an automatic payout
trigger. Exactly Rp250,000 qualifies and carries no recipient withdrawal fee.
Affiliate withdrawals are recorded as a future requirement; they are not part
of the current seller-wallet implementation.

The user clarified that the Rp2,500 BI-FAST withdrawal charge applies **only
when the withdrawal amount is below Rp250,000**. An affiliate making such a
withdrawal pays that charge. A seller cannot request a withdrawal below the
minimum, so qualifying seller withdrawals carry no recipient withdrawal fee.
This recipient-facing charge is separate from the per-order Rp1,250 admin
charge and payment-processing fees. The user explicitly confirmed that **Ezkart
covers the seller's withdrawal transfer fee** at or above Rp250,000. Record that
provider transfer cost as an Ezkart expense; do not deduct it from seller funds.

| Requested withdrawal | Seller eligibility / fee | Future affiliate fee |
| --- | --- | ---: |
| Rp249,999 | Below minimum; reject | Rp2,500 |
| Rp250,000 | Eligible by amount; Rp0 fee | Rp0 |
| Rp250,001 | Eligible by amount; Rp0 fee | Rp0 |

These rules are recorded in the specification only. There is no operational
withdrawal endpoint enforcing them yet.

## Earnings release rule — confirmed 22 September 2026

The owner confirmed that earnings become withdrawable only after **both confirmed
delivery and provider settlement**. Payment confirmation alone does not release
funds. Final earnings must account for actual provider fees, applicable seller
fees, refunds, and any reserved or already withdrawn amount. The available
balance must also meet the Rp250,000 minimum.

The merchant Wallet page displays this rule and links paid orders to Payments.
Until seller wallet mapping, provider settlement synchronization, and the wallet
ledger are connected, balances and release dates remain unavailable. The page
must not label payment volume, estimated earnings, or skipped sandbox deliveries
as withdrawable funds. It does not initiate withdrawals.

## Wallet access verification — confirmed 22 September 2026

Opening Wallet requires a fresh code. Accounts with a verified two-step factor
use the current code from their existing authenticator app. There is no QR
enrollment or email fallback for those accounts. Accounts without two-step use
an email code sent to their server-verified account address.

The PHP gate checks current provider identity and verified factors before showing
Wallet content. A successful check unlocks Wallet for ten minutes in that browser;
the user can also lock it immediately. The proof is tied to the account, store,
factor set, and sign-in. Email challenges expire after ten minutes, and send and
verification limits are shared across an account's browser sessions. Provider
failures leave Wallet locked. Password-only emergency sessions must sign in with
a verified Google account to access Wallet.

The test Supabase Magic Link email template must include `{{ .Token }}` alongside
the existing sign-in link. The prepared source and hosted-template instructions
are in [supabase/templates](../supabase/templates/README.md). Publishing PHP does
not publish that template. Local browser tests cover both verification paths,
expiry, invalid codes, identity/store isolation, and rate limits; delivery of a
real code through hosted Supabase still needs to be checked after the template
is installed.
