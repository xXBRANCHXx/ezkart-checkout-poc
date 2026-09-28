# Jev: 120-case confidence and error evaluation

The owner asked for a larger sample and a PDF with charts. The new frozen,
bilingual synthetic sample produced **98 correct verdicts and 22 wrong verdicts
out of 120**: 81.7% agreement with the predeclared reference answers.

The backend routed 49 cases as archive-eligible, 33 as no-archive, and 38 to human
review. **Nine of the 49 archive-eligible decisions were unsupported** under the
existing starter rules: four cases lacked explicit permit-status evidence, three
lacked Indonesian jurisdiction evidence, and two contained ambiguous rather
than explicit threats. These are 18.4% of archive-eligible decisions, 11.0% of
all 82 automatic decisions, and 7.5% of the full curated sample. No real page was
archived or restored. “Archive-eligible” is a replay of model/evidence/confidence
routing, conditional on the remaining runtime authority and revision checks.

All 40 explicit violation cases and 40 harmless cases received the expected raw
verdict. Only 18/40 uncertain cases were correctly escalated by the model. The
backend caught 13 wrong model verdicts by routing them to human review, but nine
wrong archive decisions survived. Seven harmless cases were unnecessarily sent
to human review. Do not count all safe deferrals as correct final decisions.

Average claimed confidence was 97.5%; observed verdict agreement was 81.7%.
Of 91 answers claiming 100%, nine verdicts were wrong. Every answer claimed at
least 85%, so the 80% confidence cutoff itself filtered out no answer. A replay
with a 100% cutoff still leaves two unsupported archives. Exact citations alone
cannot establish that every substantive rule condition is met.

The PDF includes charts, confusion matrices, threshold replay, language/scenario
breakdowns, four worked examples and a complete 120-case register. It and CSV/
JSON data are delivered in:

`/home/branch/Documents/Ezkart/Jev-Evaluation-2026-09-28/`

See the [evaluation README](../tools/jev-evaluation/expanded-20260928/README.md)
and [all original outcomes](../tools/jev-evaluation/expanded-20260928/results.json)
for methodology, limitations, hashes and accounting. Labels are agent-authored
under the existing approved starter rules, not independent owner grades or legal
findings. These curated, family-related cases are not representative traffic;
the observed percentages do not estimate Ezkart's production error rate.

The prompt/model/policy and archive configuration were unchanged. The only
runtime change was a conservative $1.20 diagnostic reservation in the beta app
budget. The authenticated provider usage increase was **$0.052139**; all 120
calls returned accepted outcomes, with no retries or fallback. The original
small diagnostics remain separate and excluded from these percentages.

Recommendation: require human review when permission, jurisdiction or threat
meaning is unresolved, enforce those conditions before automatic archive, and
then evaluate a separate held-out sample. This recommendation has not silently
changed policy or disabled archiving. The current model's high confidence is
not adequate evidence that these conditions have been established.
