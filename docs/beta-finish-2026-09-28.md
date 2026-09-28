# Beta timed finish — 28 September 2026

**Later update:** [Focused parallel batch](beta-parallel-batch-2026-09-28.md)
records subsequent implementation, schema 0067 and owner clarifications:
direct DOKU API and real transaction acceptance during beta. The report below
is the earlier snapshot, not the latest code status.

**Paid soft-launch is not ready.** The timed pass delivered the changes below
on `agent/ezkart-workbench` and the isolated beta at `test.ezkart.id`. It did not
complete all seven areas. Main, `ezkart.id`, TEST data/Worker and draft PR #3
remain unchanged. DOKU business approval is received; technical activation and
unfinished application code are separate remaining work.

The owner allowed at most twenty minutes per area, 140 minutes total. The pass
started at 22:23 UTC on 27 September (05:23 WIB on 28 September). Each area was
closed within its cap; the private tracker retains precise start/finish times.
The pass ended at 23:44 UTC after 80.57 minutes; the result is partial.

## Continue in a new conversation

Read this report and `AGENTS.md` first. The private continuation record is
`/home/branch/.local/share/ezkart/beta-01a0d643/NEXT-CONVERSATION.md`.
It records the exact deployment, prior owner decisions and permissions, financial
rules, unresolved provider identity, evidence locations, recovery-key handoff,
remaining implementation and browser/session instructions. It contains no key
material and stays outside Git because it includes private account information.

Continue from those records without restarting the audit or requesting already
answered decisions. Recheck time-sensitive state only when relevant to the next
action. The prior browser tab was released while preserving the shared Chrome
connection; a new conversation must use its own `CODEX_THREAD_ID`.

## Delivered and checked

| Area | Delivered evidence | Still required |
| --- | --- | --- |
| Seller payouts | Protected original-grant payment caller, private durable receipts and recovery without resending; nine affected checks pass. | DOKU activation, actual platform fee funding, authenticated callbacks/extended history and live bank acceptance. |
| Refunds | Original-policy cost review with proportional commission reversal, retained admin fee and unknown actual refund fee left unset; twelve checks pass. | Actual provider refund execution, authenticated returned-funds evidence, final journals/custody-based fee allocation and digital entitlement effects. |
| Subscriptions | Selected plan cadence displayed; one-time checkout rejects subscription products before creating an order/payment; three checks pass. | Recurring consent, billing, renewals, cancellation and access lifecycle. FlexiBill registration stays pending by owner decision. |
| Domains/analytics | Five real reports at two widths, complete seven-row CSV download and three populated fixture/UI checks; availability copy corrected. | Custom-domain ownership/TLS/routing, Advanced entitlements and additional measurements, representative-volume acceptance. |
| Email/marketing | Prospective compact beta scheduler enabled; all four tasks observed succeeding; 46 affected checks pass. Actual campaign draft/preview/archive and zero-recipient audience checked. | Real application-message mailbox/bounce/complaint acceptance, sustained capacity and external incident alerts. |
| Hosted journeys | Desktop/mobile guest shop, option/cart and clear checkout pause; existing merchant/customer screens, account protection and keyboard skip link; two hold cases and two guest runs pass. | Fresh real seller onboarding and paid purchase, shipping/delivery, settlement, payout, refund and digital-download acceptance. |
| Operations/recovery | Fresh database plus all 54 assets encrypted, uploaded to private storage, downloaded and restored locally; 179 tables and every asset hash match. Tampered ciphertext rejected. | Independent key custody, recurring backup retention, Supabase/hosting/secret recovery, named operational ownership and delivered incident alerts. |

These are focused checks of the changed behavior. They are not a complete
maximum-volume or financial acceptance suite. The existing-owner account checks
do not establish new-seller onboarding. Empty financial queues do not establish
payment, settlement or refunds.

## Deployed state

Application changes are in workbench commits `222c052`, `36f212d`, `78a6f8f`,
`2817dbb`, `6812167` and `94352fd`. The final application assets match the hosted
sources. The beta Worker is `ebaf0621-7031-4fc2-9731-1dc8ac9e6a81` from `6812167`,
with schema 0065: 178 application tables plus migration history.

New checkout and financial execution remain held. Email is now **enabled
prospectively**, using activation cutoff `2026-09-27T23:13:59Z` and the existing
beta cron slot. Notifications, transactional email, campaigns and automations
each get bounded separate invocations; the hour's minute-17 housekeeping remains.
Current email preferences are unchanged, there are no application email requests,
no campaign publication and no active automation rule. No extra test, campaign
or support email was sent during this pass. Future delivery still requires the
application's source, consent and publication rules. See
[email activation](commerce-email-delivery.md#timed-beta-activation-28-september-2026).

At 23:20–23:22 UTC, signed-in DOKU still shows BCA **UPDATING** and four wallet/
routing services unchecked and disabled; 22 other services are active. The
original uncertain wallet registration remains unchanged and must not be
repeated. The original-subject support-mail search at 23:29–23:30 finds the sent
conversation without an indicated reply. The owner explicitly left FlexiBill
pending: no terms accepted, registration submitted or deposit transferred.

At 23:37 UTC, the read-only operations report contains zero orders, captures,
journals and email requests. Exactly two warnings remain: `jobs_uncertain` for
the original wallet attempt and `payout_runner_held`. The runner has 44 passes
and no failed/interrupted runs. Digital storage inspection has no warnings.

## Required before opening paid beta

1. Finish actual refund execution/accounting and the other agreed application
   features above; provider activation alone cannot supply this code.
2. Resolve DOKU's disabled wallet/routing services, pending BCA activation and
   original uncertain wallet through its original reference. Establish actual
   withdrawal fee funding and authenticated outcome reconciliation.
3. Recheck Biteship funding before booking an actual shipment; its last observed
   balance was zero. Preserve real provider IDs and accepted outcomes for the
   complete payment-to-refund and digital-delivery exercises.
4. Complete new-seller, real application email/failure, operating alerts and
   full recovery acceptance. Secure the separate recovery key independently;
   the new encrypted copy is in the same Cloudflare account and is one snapshot.
5. Keep the separate sustained financial-validation and final production-release
   gates. This work does not authorize main or public production deployment.

Evidence is in [hosted acceptance](hosted-beta-acceptance.md),
[recovery](workbench-recovery.md), [operations](commerce-operations.md), and the
private `beta-01a0d643/timed-*` receipts outside Git. The thirteen broader
[completion gates](commerce-completion-plan.md#completion-evidence) remain open.
