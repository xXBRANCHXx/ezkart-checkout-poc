# Focused beta batch — 28 September 2026

Three independent Codex CLI workers completed concrete tasks in 13.25, 15.48 and
16.28 minutes, each in a separate worktree with a twenty-minute cap. These times
exclude coordinator integration, deployment and owner-guide rendering.

## Owner clarifications

- Ezkart uses DOKU's **direct API**, its own checkout/payment pages, SNAP BCA
  virtual-account calls and signed notifications. Hosted DOKU Checkout is not the
  intended integration.
- Real transaction acceptance happens **during beta**. Required code and provider
  services must exist for the tests to run; the tests need not already be complete
  before beta exists.
- Business approval is separate from BCA/service activation. Last confirmed BCA
  status was **UPDATING**; this batch did not establish fresh approval. The owner
  accepts the pending status. Avoid repeated checks without a concrete reason.
- Preserve the original uncertain wallet attempt and the public release hold.

## Delivered slices

| Slice | Delivered | Still required |
| --- | --- | --- |
| Payout history | Contiguous windows of at most 31 days, endpoint-copy handling, original identity and durable recovery. A 70-day fixture reconciles. | More than twelve windows or forty pages per pocket remains unresolved explicitly. Provider activation, fee funding and live acceptance remain separate. |
| Refund accounting | Atomic immutable finalizations and balanced journals, exact cumulative commission reversal, retained original fees, negative seller balances and order projections. Partial digital lines are held for review; fully refunded lines lose future access; unrelated lines remain available. | Authenticated non-card DOKU returned-funds evidence is unavailable. Its database view is intentionally empty/read-only. Actual refund funding, fee custody and partial-line access-release policy remain unresolved. |
| Backup command | Bounded repeatable D1/R2 archive, public-certificate encryption, exact remote readback, durable upload intent, offline authenticated restore and conservative opt-in retention. Redirects are refused. | New remote adapter not live-validated; recurring schedule not installed. Independent key custody, off-account recovery and Supabase/hosting/secret recovery remain separate. |

Integrated commits: `df944d2`, `97eafd2`, `711c133`, and review fixes `f2e32d9`.
The schema-list conflict was resolved by retaining migrations in numeric order.
No provider activation or synthetic financial success was introduced.

## Evidence and deployment

Worker checks: 16 payout cases, 26 refund cases, 17 new backup cases and 9 existing
database-backup cases passed. Integration added 13 combined payout/refund cases,
then the changed partial/full digital-refund regression and 18 backup cases after
redirect hardening. These counts overlap; they are not distinct live journeys.
Worker build passed.

A fresh beta database export restored locally. Both migrations were rehearsed:
original records in 179 tables were preserved, the expected
`refund_funding_unreconciled` account was added, and integrity/foreign-key checks
passed. Confirmed refund evidence stayed empty. Migrations 0066/0067 were then
applied to the isolated beta.

Beta Worker implementation `f2e32d9` is deployed as version
`9ebe7374-2378-4340-964f-686cf6684a14`, schema 0067. Checkout and financial execution
remain held. Prospective email scheduling retains its original activation cutoff.
No financial action, customer creation or outgoing message was initiated by this
batch. Main, TEST and `ezkart.id` remain outside delivery.

Private task logs, results, backup, rehearsal and deployment receipts are under
`/home/branch/.local/share/ezkart/parallel-20260928-01a0e5b6/`.

## Remaining scope and process

There is substantial shop, order, inventory, identity, digital-delivery,
accounting and messaging code. There is no stable denominator for a meaningful
percentage complete. A screen, implemented rules, provider activation and actual
acceptance are different milestones.

Controlled paid beta still needs the applicable provider services/original wallet
identity, payout funding, refund outcome integration and shipping setup resolved.
New seller, payment, delivery, settlement, withdrawal, refund, download and real
email journeys belong in beta testing. Subscriptions and custom-domain/Advanced
lifecycle features remain unfinished; implement them or explicitly exclude them
from the initial offer. Alerts, recurring backups and operational ownership also
remain work. This batch does not complete every item in the earlier plan.

The weekend records show intermediate implementations and external dependencies.
Retesting shared financial changes can be justified; repeating unchanged broad
audits cannot activate a provider service. We have not analyzed every earlier
invocation and cannot quantify wasted time. Continue with bounded implementation
tasks, focused checks and one integration step, ending in a tested commit or an
exact blocker.

## Owner learning materials

Video, PDF, captions, transcript, chapter player and local renderer are under
`/home/branch/Documents/Ezkart/Owner-Guide-2026-09-28/`. The PDF separates current
implementation from missing integration and acceptance; its fee example is
fictional. Sources link to repository records.

The owner clarified after seeing the first video: future animation means visual
teaching through concrete events and cause/effect, not text cards with motion.
Show the shopper, order, money transfers, holds, failures and recovery as a visual
story, using narration to explain what is happening. Mobile player polish is not
the priority. This is a future preference, not a request to remake this video now.

See [payout history](payout-history-windows.md),
[refund accounting](refund-finalization-accounting.md),
[backup command](workbench-backup-command.md) and the
[earlier timed handoff](beta-finish-2026-09-28.md).
