# Jev: frozen 120-case evaluation

The owner requested a larger sample and a PDF showing confidence and errors.
The expected labels were frozen in `cab5702` before calls. Model/adapter source
was unchanged from `5918063` throughout testing. This directory contains inputs,
original accepted/rejected answers, derived metrics, reproducible chart/PDF
code, a bounded one-send runner and an offline integrity check.

## Observed results

- 120 fresh synthetic calls; all returned schema/evidence-valid responses.
- 98/120 expected verdicts matched (81.7%); 22/120 did not (18.3%).
- Explicit violation cases: 40/40 matched. Harmless cases: 40/40 matched.
  Uncertain cases: 18/40 correctly escalated by the model; 22/40 misjudged.
- Backend routing: 49 archive-eligible, 33 no-archive, 38 human review.
- Nine unsupported archive-eligible outcomes: four missing-permit, three
  missing-jurisdiction, two ambiguous-threat cases. That is 9/49 archive-eligible
  outcomes (18.4%), 9/82 automatic outcomes (11.0%), or 9/120 total cases (7.5%).
  No wrong no-archive outcome survived in this sample.
- Safeguards redirected 13 incorrect model judgments to human review. They also
  deferred seven otherwise decidable harmless cases. Exact routing matched
  104/120 (86.7%); an extra deferral is not counted as a correct final decision.
- Mean claimed confidence: 97.5%, compared with 81.7% verdict agreement.
  Ninety-one answers claimed 100%; nine of those verdicts were wrong. All
  confidence values were at least 85%, so the 80% threshold alone filtered none.
  Replaying a 100% cutoff still leaves two unsupported archive outcomes.
- English: 50/60 correct, four wrong automatic decisions. Indonesian: 48/60
  correct, five wrong automatic decisions. These small family-linked samples
  do not establish a language-performance difference.

The reference answers are agent-authored against the existing owner-approved
starter policy, not independent owner grades or an adjudication of lawfulness.
The balanced synthetic challenge set is not representative production traffic.
Each of 30 related families has four authored variations. One call per case does
not measure repeat-run consistency. “Correct” refers to verdict agreement, not
certification of every statement or finding. Prior six-/ten-case runs are
excluded from all 120-case percentages.

## Report and reproducibility

The delivered PDF has 12 pages: outcome charts, confusion matrices, confidence
versus observed correctness, a threshold replay, scenario/language results,
worked examples, methodology, and all 120 cases. Full CSV/JSON accompany it at:

`/home/branch/Documents/Ezkart/Jev-Evaluation-2026-09-28/`

Generated report/chart/CSV artifacts are outside git. Run `verify.mjs` for
read-only integrity checks. `report.py` requires ReportLab, Matplotlib, Pillow
and the Liberation fonts. The installed private Python environment is
`~/.local/share/ezkart/owner-guide-tools/bin/python`.

```sh
node tools/jev-evaluation/expanded-20260928/verify.mjs
~/.local/share/ezkart/owner-guide-tools/bin/python \
  tools/jev-evaluation/expanded-20260928/report.py \
  /home/branch/Documents/Ezkart/Jev-Evaluation-2026-09-28
```

The original private run receipt is
`~/.local/share/ezkart/jev-beta/evaluation-expanded-120-20260928.json`.
Do not rerun paid cases merely to reproduce charts. The runner excludes expected
answers from requests, preflights all payloads, reserves before sending,
persists original attempts, never retries, and stops after three consecutive
unknown transport outcomes. Model/privacy/provider controls are unchanged.

## Accounting and workbench state

The immediate post-run provider usage lagged behind completed responses. A
later read in `accounting.json` confirmed usage from $0.00720075 to $0.05933975,
a **$0.052139** increase. Summed per-response rounded costs are $0.052188;
all 120 costs are known. Do not substitute that sum for the authenticated delta.
Remaining key credit at the final read: $4.94066025.

Before calls, the app budget ceiling was reduced from $4.90 to $3.70, retaining
$1.20 in conservative $0.01-per-call reservations for this external diagnostic.
The app's prior $0.06 reservations then leave $3.64; this is not provider credit.
Only that budget variable changed, deployed to beta Worker version
`0c3bf16d-5212-4155-8dca-b61ae44d84b6`. No model/prompt/policy changes, migrations,
archive toggles or actual page actions were made for this evaluation. Main and
public production remain held. No real customer or seller-page data was sent.

The report recommends mandatory human review when permit status, jurisdiction
or threat meaning is unresolved, then a separate held-out evaluation after a
reviewed fix. The evaluation does not silently change the archive policy or
claim this recommendation has been implemented.
