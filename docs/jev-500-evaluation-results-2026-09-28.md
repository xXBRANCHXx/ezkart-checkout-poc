# Jev: 500-case evidence-v2 evaluation

The owner-requested run tested 500 fresh frozen synthetic cases against the
expanded evidence adapter. **378/500 raw verdicts matched** (75.6%): 121 differed
and one provider HTTP 503 had no model verdict. There were 443 accepted answers,
56 validation rejections (53 exact-evidence failures, three inconsistent
verdict/finding combinations), and that one unavailable response. All 500 were
sent once; original bodies and failures are retained, with no retry or page action.

**42 of 152 archive-eligible decisions were unsupported** by the authored
references (27.6% of archive decisions; 8.4% of cases). There were 13 effective
clear decisions, none reference-incorrect, and 335 human-review decisions (67%).
Backend safeguards redirected 79 raw mismatches to human review, but also added
147 deferrals for cases labeled decidable. Effective routing matched 311/500
(62.2%); safe extra deferral is not counted as a correct final decision.

Mean claimed confidence was 97.6% across 499 available answers. Even a replay
requiring 100% confidence leaves 15 unsupported archive decisions. All 180
reference-violation cases included their required rule code, but that does not
establish contextual correctness on uncertain cases. Accepted-and-correct raw
verdicts totaled 345/500 (69%); this is distinct from raw verdict agreement.

The PDF provides confusion matrices, confidence/reliability charts, threshold
replay, modality/language/report-reason/family tables, worked examples and a
complete 500-case register. PDF, CSV, graded JSON and chart files are in:

`/home/branch/Documents/Ezkart/Jev-Evaluation-500-2026-09-28/`

The [frozen inputs, original results and reproducible tooling](../tools/jev-evaluation/expanded500-20260928/README.md)
include source/image/response hashes and independent grading/routing checks.
The expectations were committed in `5fe9568` before any paid request.

## Scope and limitations

This is 50 agent-authored scenario families with ten variations each, including
100 small text graphics, 250 English and 250 Indonesian cases, all five selected
report reasons, and 200 Other reports. It covers text, preserved ASCII, source,
URLs, image pixels, unavailable resources, misleading reports, injection and
ambiguity. Related variants are not 500 independent semantic situations. Scenario
names in many slugs can cue interpretation, and readable synthetic graphics are
not complex real storefront screenshots. Labels were authored before model calls
and graded independently from model answers, but are not independent human or
legal adjudications. These percentages do not estimate production accuracy.

The older 120-case run used a different adapter and sample. Its numbers are a
historical diagnostic, not a controlled before/after comparison. The moderation
prompt and decision policy were not tuned during this evaluation. No actual seller
page, customer record, archive, restore or deletion was involved.

## Cost and request contract

The diagnostic preserves current prompt/schema/provider/privacy controls,
temperature, minimal reasoning and 2,000 output tokens. It tightens maximum
provider prices to the verified $0.25/$1.50 per million input/output tokens.
UTF-8 text bytes plus wrapper margin and a generous per-small-image token bound
produce a preflight ceiling of $2.713494, rounded to a $2.72 external reservation.
This bounded synthetic contract does not change production's broader reservations.

Before sending, only beta JEV_BUDGET_MICROUSD changed from 3,160,000 to 440,000;
after its six prior reservations, the reviewer allowance is $0.38. The existing
$5 provider hard cap, expiry, no reset, archive setting and all unrelated payment
configuration remain unchanged. The budget reservation deployed in beta version
`b0b84d58-f537-4c28-b59c-b409de978fe7`. Full reservations remain held, including
the unavailable call; actual spend does not silently replenish the app allowance.

A later authenticated key metadata read confirmed **$0.31191725 actual usage
increase**, leaving **$4.6279235** of the key cap. Summed rounded known response
costs are $0.312098; one response has unknown cost. Immediate provider usage reads
lagged, so the original receipt and later `accounting.json` are both preserved.
All observed token and cost bounds held (maximum input 2,576 tokens).

The observed unsupported archives support requiring substantive human verification
for unresolved threat meaning, credential meaning, permission or jurisdiction;
confidence and exact quotations alone did not resolve those weaknesses. Such a
policy change would require separately declared evaluation on a fresh holdout.
This evaluation does not silently change runtime archive policy.
