# Transfer fee funding (0077)

New seller and company payment grants atomically reserve a contracted fee ceiling
against Ezkart's released commission and actual available provider cash. Missing
facts prevent dispatch; no provider calls, config changes or flags were enabled.
The existing owner policy is unchanged: seller minimum Rp250,000, Ezkart pays the
actual transfer fee, and unknown fees are never treated as zero.

## Actual merchant contract required

The [official DOKU V2 contract](https://developers.doku.com/wallet-as-a-service/sub-account/sub-account-v2/integration-guide)
was checked on 28 September 2026. The bank-transfer request has no fee quotation
or payer override. This implementation supports an actual merchant agreement
that charges the configured Ezkart cash account directly, including when the
principal comes from a seller account. It does not assert that DOKU has enabled
that agreement for Ezkart. Seller-source fee charging remains held and requires
an explicit company-to-seller funding/reimbursement workflow, including its own
transfer fees. BCA approval alone does not establish those services or terms.

The private Worker setting `COMMERCE_TRANSFER_FEE_CONTRACT` has these exact fields:

```json
{
  "version": 1,
  "environment": "production",
  "credentialFingerprint": "<actual 64 lowercase hex fingerprint>",
  "clientId": "<actual DOKU client ID>",
  "platformSeller": "<configured Ezkart store ID>",
  "chargedCashAccount": "<confirmed Ezkart cash account>",
  "sellerFeeBilling": "company_cash_direct",
  "channels": {"BI_FAST": "<maximum whole-IDR fee including tax>"},
  "evidenceReference": "<private merchant agreement reference>",
  "evidenceDigest": "<SHA-256 of that actual record>",
  "validFrom": "<effective UTC ISO timestamp with milliseconds>",
  "validUntil": "<expiry UTC ISO timestamp with milliseconds>"
}
```

Only configured `BI_FAST` / `ONLINE` channels are available. Fees are exact
strings; use `"0"` only for an explicitly free agreement. Evidence reference and
digest identify reviewed merchant terms, not fabricated provider response proof.
No seller or browser request can supply the contract. Invalid/expired terms,
unknown fields and provider/account mismatches fail closed. A canonical hash
pins each immutable contract to its original grants and recovery.

## Release, cash and accounting

Only current original settlement plus verified whole-order delivery releases
commission for payment/fee funding. Existing payment, refund/return,
fulfillment, unresolved provider-job and negative seller-allocation holds remain.
Seller money, shipping and admin allocation never enlarge this budget.

The cash bound comes from the last balance in the company's latest complete
cash/pending history collection. It must be that account's newest observation,
no more than five minutes old. It is not an atomic provider snapshot: outstanding
local company principal and fee reservations are subtracted conservatively.
The lower of actual cash and released commission must cover the new ceiling.
D1 rechecks current source, account, contract validity and balance sequence in
the grant transaction. Concurrent grants cannot spend the same budget. A fee
reservation failure rolls back its grant and new contract together.

Unknown original sends retain their ceiling, identity and cancellation fence.
Recovery uses the original contract without requiring current configuration and
never renews send authority. Pre-0077 grants receive no invented funding; their
original recovery remains available and the pool requires explicit legacy
review before new funded dispatch.

Current matched reconciliation books the actual charge and appends an immutable
fee-reservation release. The release records the assessment, original status and
global provider observation boundary. Any newer observation or original status
conservatively reserves the ceiling again until re-reconciliation. A stale old
assessment replay remains held. Already booked principal and fees are never
restored by uncertainty. An actual fee over the original ceiling is booked
honestly and holds new funding for contract review.

## Activation procedure

1. Verify enabled DOKU Sub-Account/Collect & Route services, the dedicated Ezkart
   wallet, actual registered company bank, direct company billing account and
   inclusive fee ceilings. Populate the private contract from those real records.
2. Configure the existing private original-receipt directory, beta provider
   credentials, company bank and authorized fresh-MFA treasury operator. Preserve
   original uncertain registrations; do not create replacements.
3. Run `tools/commerce/collect-provider-evidence.php` with
   `--environment=production --seller=STORE_ID --from=ISO_TIME --to=ISO_TIME
   --max-pages=10` for each original seller/company account. Retain completed
   collection IDs. Use `reconcile-provider-settlement.php` and
   `reconcile-earnings.php` for those exact sources and confirm delivery. Refresh
   the company collection if its cash observation is older than five minutes.
4. Enable the separately held inquiry/payment/observation flags only for the
   approved beta and actual provider capabilities. Owner treasury execution is
   available only when the configured contract, delivery/settlement release and
   cash/fee budget pass. Sellers retain original inquiry/name confirmation.
5. Reconcile original status/history using the existing payout/treasury tools.
   Recover saved private receipts after uncertain acknowledgements. Never resend
   an unknown transfer or use a manual-paid flag.

The direct-company-billing flow is implemented and fixture tested. If the actual
merchant agreement charges seller sources, the separate funding/reimbursement
code path is still unsupported; do not select another configuration value to
bypass that boundary.
