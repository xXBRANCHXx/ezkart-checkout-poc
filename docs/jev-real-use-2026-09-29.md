# Jev real-use acceptance — 29 September 2026

The owner reviewed the stricter-harness replay and approved using it for real
Ezkart moderation. The supported live-use target remains workbench/beta,
`test.ezkart.id`, with reviewer controls in Executive Dashboard Operations.
This is acceptance of the existing direct-evidence harness, not a production
storefront release or a claim of fresh held-out model accuracy.

## Operational behavior

New reviews/rescans use `jev-direct-evidence-v1`. A deliberately started reviewer
run can temporarily archive a current page only when all standard rule elements
are directly evidenced, confidence is at least 80%, no material uncertainty or
coverage gap remains, and the backend quotation checks pass. Other results go to
human review, including raw clear answers. Visual/code/URL findings need human
verification. Existing exact-revision fencing, reviewer MFA, original request
recovery, grading, seller alerts and human restore remain in place. No automatic
deletion is enabled.

`JEV_ENABLED=enabled`, `JEV_ARCHIVE=enabled` and the approved starter policy were
already live. The harness deployment was verified as the active beta version
before this acceptance. Public visitor report intake remains unconnected and
reports do not trigger model spending automatically. No merchant page was selected,
reviewed or archived merely to demonstrate activation.

## Budget reconciliation for real reviews

The diagnostic runs had retained their full pre-call ceilings, leaving only $0.38
in the app despite a much larger provider balance. That was too little for the
conservative $0.54 image-review reservation. Read-only authenticated metadata on
29 September confirmed a $5 non-resetting hard cap, total usage $0.3720765 and
remaining balance $4.6279235. The key still expires on 27 December 2026.

To make the accepted workflow usable, confirmed diagnostic ceilings are reconciled
against total provider usage. Unknown calls keep their entire original reserve:

- First confidence diagnostic, `en-harmless-false-report`: $0.01 retained.
- 500-case run, HTTP 503 for `ascii-ambiguous-07`: $0.004981 retained.
- Existing six imported app attempt reservations: $0.06 retained in D1.

Provider usage is rounded upward to 372,077 microUSD. The new application ceiling
is `(5,000,000 - 372,077 - 14,981)` rounded downward to a $0.01 increment:
**4,610,000 microUSD**. After existing app reservations, **$4.55 is available**.
A further 2,942 microUSD remains outside that ceiling as rounding headroom.
The provider hard cap is unchanged. Neither usage nor immutable reservation rows
were erased; the only configuration change is the beta app ceiling from 440,000
to 4,610,000 microUSD. This is not a new top-up or recurring budget.

The private reconciliation receipt and pre-change configuration backup are under
`~/.local/share/ezkart/jev-beta/`. No provider key or configuration secret is stored
in this document. All unrelated runtime variables are verified unchanged. This
acceptance/reconciliation makes zero new model calls and zero page actions.
