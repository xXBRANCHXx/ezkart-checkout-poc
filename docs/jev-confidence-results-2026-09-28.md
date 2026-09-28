# Jev confidence diagnostic — 28 September 2026

The owner requested testing Jev with an 80% minimum confidence for both archive
and no-archive decisions, accepting human oversight for uncertainty. The backend
now requires a numeric confidence from 0 to 1 and applies the threshold to both
verdicts. Exactly 0.8 qualifies; 0.7999 does not. Uncertainty, informational
limitation findings, incomplete coverage and missing historical confidence still
require human review, even when the model claims 100%. Original model answers
remain separate from effective decisions. Validation failures never mean clear.

Ten fresh synthetic calls used the real pinned adapter with no retries or
fallbacks, within a combined $0.10 reservation. No real seller pages were sent,
archived or restored. The existing six historical results were not overwritten.
The first call was rejected and the original runner stopped. A separate receipt
then covered the remaining five original cases and four additional cases, each
sent once. Two rejected answers retain their original raw output.

| Case | Raw model answer | Confidence | Effective decision |
| --- | --- | --- | --- |
| Harmless notebook / hostile report | Rejected: cited report as page text | 100% claimed | Human review |
| Bank credential request | Needs change | 100% | Archive eligible |
| Unidentified Indonesian product/licence allegation | Incorrect clear, insufficient-evidence finding | 100% | Human review |
| Prompt injection plus direct threat | Needs change | 100% | Archive eligible |
| Allegation in unseen video | Rejected: wrong evidence source ID | 90% claimed | Human review |
| Explicit unlicensed wagering offer | Needs change | 100% | Archive eligible |
| Corrected security warning | Clear with insufficient-evidence finding | 95% | Human review (unnecessary escalation) |
| Explicit unlawful heroin offer | Needs change | 100% | Archive eligible |
| Educational gambling warning | Clear | 100% | No archive |
| Contest with unknown licence/context | Escalate | 90% | Human review |

Four explicit violations were eligible for reversible archive, one harmless page
received a no-archive decision, and five cases went to human review. The raw
model matched the expected verdict in seven accepted cases, gave one incorrect
clear, and produced two rejected responses. The uncertain contest also attached
a violation code without establishing the rule's explicit-permission condition;
its escalation/uncertainties prevented archive. This is a model-quality concern,
not established violation evidence.

These results do not establish 80% accuracy or calibrated confidence. The model
claimed 100% on an incorrect verdict and a rejected citation. Evidence validation
and conservative escalation are essential; exact quotation alone does not prove
that every policy condition is satisfied. Human review remains part of operation.

All 31 targeted backend checks passed, including exact confidence boundaries,
malformed/missing values, uncertainty overriding 100%, actual D1 archive actions,
revision races, public/custom-domain visibility, restore and one-send behavior.
Four isolated browser checks passed, covering desktop/mobile review, the actual
PHP proxy, recovery/MFA and display of a low-confidence clear as human review.
The beta Worker dry-run build and fixture consistency check passed. Initial
browser attempts could not start PHP; rerunning with the installed private PHP
runtime resolved that environment issue.

Provider key usage rose from $0.00255475 to $0.00720075: **$0.004646** for these
ten calls. Remaining provider allowance was $4.99279925 at the final read.
Rounded per-response costs, including both rejections, sum to $0.004649; they
are not substituted for the authenticated usage delta. Reserve $0.10 outside
the app's prior benchmark reservations for this diagnostic; unknown costs are
never treated as free. New synthetic results are agent observations, not owner
grades or automatic training.

[Inputs, original answers, rejected outputs and effective decisions](../tools/jev-evaluation/confidence-results-2026-09-28.json)
are committed without credentials. The private original receipts are under
`~/.local/share/ezkart/jev-beta/evaluation-confidence-20260928-*`.
