# Withdrawal reconciliation and accounting

Withdrawals remain on workbench. This stage connects the original payment grant,
saved status observations and complete seller/platform account histories to final
accounting. It does not send a transfer or establish the live fee-funding contract.

## Supported evidence

Migration 0060 freezes each assessment's withdrawal, two collection IDs and status
history boundary. It requires the original seller and platform accounts from the
grant, their original credentials, all four cash/pending histories and exhausted
pages over the same window. The window includes the grant's clock-tolerance period
and the final status observation. Later configuration cannot replace an account.
Legacy grants without a platform binding cannot acquire one through reconciliation.

The status assessment uses observation times, including overlapping reads, late
arrivals, terminal conflicts and regressions. It retains every original evidence
digest through the specified boundary. Later status observations or overlapping/
related account history invalidate current recognition until reconciled again.
A subsequently recovered payment receipt must agree with the payout reference.

A completed payout requires one seller-cash `PAYOUT` debit, the exact original
reference, amount and bank channel, a successful status observation and an explicit
`PAYOUT_CHARGE` record. The fee must share the payout's provider reference or name
the exact original merchant reference. Every recognized provider reference is
permanently assigned to that withdrawal and cannot also fund another payout or
settlement.

Missing fees, duplicate legs, unsupported mutations, foreign references and fees
charged to the seller remain unresolved. An explicit zero fee is accepted; no
missing row is interpreted as zero. Nonzero successful fees must be charged to
the original Ezkart cash account. Unsupported amounts remain evidence without
overflowing the ledger.

Failure releases the reservation only when the status reports failure and the
original payout debit is explicitly `VOID`, with a resolved fee record. A `FAILED`
history row, missing debit or error response alone cannot release money. DOKU's
[Sub-Account reference](https://developers.doku.com/wallet-as-a-service/sub-account/sub-account-v2/integration-guide)
lists `PAYOUT_CHARGE` and excludes `VOID` rows from balances. Actual production
fee correlation, funding and failed-transfer response shapes still require live
acceptance; this implementation does not assume DOKU will produce a particular
combination. Conflicting success/failure or unsupported reversal evidence remains
under review.

## Ledger and availability

The assessment, derived result, reference assignments and balanced journal commit
together. SQL guards derive their amounts directly from saved provider evidence.
They reject caller-selected amounts, forged journals and partial writes. Exact
recovery reuses the same source IDs and cannot send a payment or post twice.

Successful payouts consume the withdrawal reservation and credit seller provider
cash for the full principal. Actual fees debit Ezkart's withdrawal-fee expense and
credit its provider cash. Failed/voided payouts release only the original
reservation; an actual platform fee is still recorded. Fee corrections append
only the change and retain all earlier entries.

Lifetime completed payouts stay deducted from earnings after their reservations
close. Changed or unresolved evidence holds further availability while retaining
the last posted payout. It never restores already-paid money. The original
payment grant remains single-use after every outcome, including failure.

Protected Wallet reads distinguish completed, failed and review outcomes from
provider-reported status. They expose no platform account, credential, provider
reference or raw evidence. Expiry continues to remove balances and bank details.

## Private recovery

`tools/commerce/reconcile-withdrawal-payout.php` accepts the original withdrawal,
seller/platform collections and the status history cap returned by the private
status-history API. It supports only TEST/sandbox or beta/production. Preserve all
five arguments for recovery:

```text
--environment=production --withdrawal=wd_ID
--seller-collection=fcol_ID --platform-collection=fcol_ID --status-cap=INTEGER
```

The helper retries a lost D1 acknowledgement once with exactly those sources. It
makes no DOKU request. Exit 0 means the current outcome is reconciled, 2 means it
needs review and 1 means the operation did not complete. Old exact replays return
their original assessment alongside the latest outcome. Both helper and CLI are
unavailable through direct HTTP access.

## Remaining work

Actual Ezkart-funded fee provisioning, integrated payment transport, authenticated
callback integration, ongoing provider synchronization, unsupported reversal
recovery and real owner/provider acceptance remain required. Refund accounting is
separate and unfinished. Checkout, payment/status dispatch and automatic email
holds remain in place. No top-level completion gate closes with this stage.

## Verification

The affected financial regression run passes 86 Worker cases. Two additional
boundary cases cover maximum/excessive fees and reference reuse; final focused
reconciliation coverage includes all eight cases. The full PHP/merchant/browser
suite passes 38 cases, including exact-source recovery after lost acknowledgements,
actual protected Wallet reads, desktop/mobile layouts and expiry after persistence.
The initial new-test failures were fixture expectations, a shadowed helper and
duplicate fixture request IDs; their corrections are verified by focused reruns.
PHP/JavaScript syntax, whitespace and the beta Worker dry build pass.

Logs are `/tmp/ezkart-payout-{regression,worker-final,php-final}-01a0d643.log`.
The fresh beta export restores all 166 tables with unchanged recovery bookmarks;
its SHA-256 is `6dc494857705e79408884ac61330604b658dcd3cc187b81cc64848e1103e2d9e`.
The final migration rehearsal preserves all original rows, adds only the platform
fee account and three empty tables, compiles the new views and passes integrity
and foreign-key checks. Private evidence is in
`/home/branch/.local/share/ezkart/beta-01a0d643/payout-before-0060-20260928/`.
Implementation `993a588`, migration 0060 and beta Worker
`6dfd9d15-52f8-498e-8bce-ca1780b83544` are deployed. All 48 hosted API checks pass
at 18:05 UTC on 27 September. At 18:06, Hostinger serves the identified source
hashes; the helper/CLI return 404, unsigned merchant access returns 401 and the
actual Wallet gate exposes no earnings or withdrawals. Its loaded script matches
the tested source. No new verification code or provider operation is requested.

The 18:07 post-export restores all 169 tables with unchanged recovery bookmarks,
clean integrity and foreign keys. Its SHA-256 is
`541b54ed0b572850ff9d00ba37e3d321de802b94234a3a9d191b1d53593edcb2`.
The original 165 application tables preserve their business/financial records;
the only differences are the added fee account and an ordinary sign-in timestamp
refresh. Migration history advances to 0060. All new payout tables and existing
withdrawal, capture, journal, entry and earnings tables remain empty. Original
wallet records, private runtime, deployment configuration and execution holds
are unchanged. Only the existing hourly housekeeping schedule runs.

Private proofs are `payout-{hosted,workbench,wallet-gate}-proof.json`,
`payout-post-preservation.json` and `payout-after-0060-20260928/` under the same
beta directory. TEST/main are not deployed or migrated.
