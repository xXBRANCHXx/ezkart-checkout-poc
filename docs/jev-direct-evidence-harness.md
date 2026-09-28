# Jev direct-evidence harness — 28 September 2026

The owner requested a stricter rule: a flagged page without a blatant breach of
one of Jev's supplied standard rules must go to human review. This supersedes
automatic clearance of flagged pages merely because confidence exceeds 80%.

## Enforcement

New reviews and rescans carry `harnessVersion=jev-direct-evidence-v1`. Their
trusted system prompt includes an explicit checklist for every existing starter
rule, examples of insufficient evidence, and an instruction to return `escalate`
when no definite breach is established. Reports and selected reasons remain
untrusted allegations. No new prohibited-content rule or legal theory was added.

A separate backend gate independently checks the cited visible-text quotation:

- Credentials require a direct request and an explicitly named secret. Generic
  code, order reference, bare PIN or discount-code wording is insufficient.
- Threats require a direct speaker/target and specific physical harm or disclosure
  of identified private information. Vague retaliation is insufficient.
- Gambling requires a direct public real-money offer, explicit Indonesia context
  and the seller's explicit statement of missing gambling permission.
- Narcotics require a direct sale of an identified Group I substance, explicit
  Indonesia context and explicit absence of legal right/authorization.

Every required element must occur in the exact quoted visible page text. The
model's explanation, report, confidence and unrelated page metadata cannot fill
missing elements. The backend explains which requirement the quote failed.
Educational/quoted/fictional, negative or qualified visible-text context requires
human interpretation. The scan includes all supplied visible text, not only the
model's selected fragment, so a later disclaimer cannot be hidden by shortening
the quote. Visual, URL and code findings still require human verification.

These checks intentionally recognize a narrow set of direct English/Indonesian
wording. They are not a general semantic parser, legal verifier or guarantee of
zero false positives. Different wording, additional languages and contextual
ambiguity fall to humans. Narrow allowlists can also defer real violations.

80% remains necessary, never sufficient. A raw `clear` answer now yields effective
`escalate`; the original answer/confidence remain recorded. An original outcome
from before this harness cannot authorize a new automatic archive. Existing
archive/restore history is preserved; the change does not silently restore pages
or rerun old calls. No schema migration or spending configuration change is needed.

## Verification and limits

46 scoped confidence, evidence, page-revision, backend and harness tests passed,
including actual archive-write prevention for 100%-confident generic-code, vague
threat, missing-jurisdiction and clear answers. Direct English/Indonesian violations
remain eligible when all gates pass. The beta dry build also passed.

`tools/jev-evaluation/harness-20260928/replay.mjs` replays the frozen 500-case saved
answers without a model call. It deliberately opts the snapshots into the new
harness marker to test quote checks rather than relying on the legacy guard.
Of the previous 152 archive-eligible outputs, 77 remain eligible and all 42 outputs
previously labelled unsupported are deferred. Another 33 outputs labelled genuine
violations are deferred because their old quotes/context do not pass this stricter
gate. Effective totals: 77 archive-eligible, 423 human review, zero automatic clear.

This is a post-change regression check on known cases, not held-out validation or
a new accuracy estimate. Expected labels are synthetic and agent-authored. The
new model prompt has not been run in a new paid evaluation. Original benchmark,
responses, labels, PDFs and their recorded hashes are untouched. Replay results
are a separate artifact and create no page actions or provider charges.
