# Frozen synthetic evidence-v2 challenge fixtures

500 synthetic cases were independently authored before model inference by the fixture author, using the existing owner-approved starter rules in `evaluation-policy.json`, `cloudflare/ezkart-api/src/jev-provider.js`, and `docs/jev-page-evidence.md`. These are agent-authored expected labels, not independent human owner grades, production prevalence estimates, or legal determinations. No real seller pages or customer records are used.

`benchmark.json` SHA-256 before inference: `16bc595a9dec8da15ed9138ff4801467861eb67e1fb8335370ac9b495012a0df`.

The set contains 50 scenario families with 10 deterministic variants each: 250 English and 250 Indonesian cases, 400 text/source/URL/ASCII cases and 100 attached-image cases. Variants change language, ordinary shop context, report wording, selected reason and (for images) palette. Family members are correlated; 500 is the number of test cases, not 500 independent semantic scenarios. Performance should also be examined by family and channel.

Expected raw verdicts: 180 needs_change, 160 clear, 160 escalate. Expected backend decisions: 110 needs_change, 160 clear, 230 escalate. Positive image, URL and HTML-source findings require human verification. Missing pixels, source truncation, unexecuted JavaScript, unrendered generated CSS and unknown linked destinations must escalate. Plain-text positives require directly evidenced narrow policy violations. Clear examples include warnings, fictional quotations, news, ordinary identifiers and harmless merchandise. Ambiguities include secret versus order code, unclear threats, missing permit statements, missing jurisdiction and unidentified substances. Reports include unsupported accusations and attempted prompt injection; page sources and image pixels include injection separately.

All five actual selected-reason values are used: `credential_request`, `explicit_threat`, `gambling`, `narcotics`, `other`. Exactly 200 cases select Other with substantive free text; other cases include relevant and misleading selections. Reports are separate `reportText` strings and never become evidence sources. Images carry only a synthetic URL, SHA-256, MIME type, byte count and relative `path`; runners must load PNG bytes from that path. Image wording is deliberately absent from source text and reports, apart from one deliberately false report quotation.

All PNGs are 384 × 320 pixels. The largest serialized snapshot is 1,024 UTF-8 bytes before base64 image attachment. Images use synthetic text cards with several palettes; this does not establish accuracy on photographs, complex visual scenes, poor-resolution scans or real storefront layouts. ASCII cases preserve whitespace but do not cover all possible visual text encodings.

Reproduction: run `python generate.py` with Pillow installed and iA Writer Quattro S Regular at `/usr/share/fonts/ttf-ia-writer/iAWriterQuattroS-Regular.ttf` (DejaVu Sans fallback is supported). The checked-in benchmark and PNG hashes are authoritative; fonts or Pillow versions may change regenerated image bytes. The generator never calls a model, contacts a seller or changes a page. Freeze these labels and hashes before inference; do not relabel them after inspecting model outputs. Any label dispute belongs in a separate adjudication artifact.

## Bounded diagnostic contract and pre-call reservation

The evidence-v2 moderation prompt, schema, temperature, minimal reasoning, 2,000
output-token limit, validation and backend decision adapter are unchanged. Only
this offline runner tightens maximum prices to $0.25/$1.50 per million input/output
tokens, matching the checked pinned endpoint. Production reservations are unchanged.

Each request reserves serialized non-image UTF-8 bytes plus 2,048 input tokens for
wrapper/schema overhead, plus 8,192 tokens per PNG, and all 2,000 output tokens.
The 100 PNGs are 384×320 pixels, one per case. Google's
[media resolution documentation](https://ai.google.dev/gemini-api/docs/media-resolution)
lists default Gemini 3 images at 1,120 tokens and ultra-high at 2,240. The 8,192
allowance adds margin; this small-fixture contract does not replace production's
full-context image reservation. Reported tokens/costs are checked against the
bounds; any violation stops later batches. The provider $5 hard cap remains.

Preflight requires 2,713,494 microUSD. Before sending, 2,720,000 microUSD is reserved
externally by reducing only beta JEV_BUDGET_MICROUSD from 3,160,000 to 440,000,
leaving 380,000 after its six existing 10,000 reservations. Historical external
reservations remain protected. Key metadata before the run showed $0.06015925
usage and $4.93984075 remaining, with $5 cap, no reset and December27 expiry.
No seller pages or moderation actions are involved.

The exclusive private receipt is
`~/.local/share/ezkart/jev-beta/evaluation-expanded500-20260928.json`.
Every send is fenced and never retried; up to four reserved calls run per batch.
Every received HTTP body is saved, including invalid/incomplete responses.
Unknown outcomes keep their full reservation. Expected labels are never sent.
Run `verify.mjs` and `report.py` offline to rebuild analysis without paid calls.

## Completed run

Labels froze in commit `5fe9568`; all500 attempts ran once. Results:378 matching
raw verdicts,121 mismatches,1 unavailable503;443 accepted,56 rejected. Effective
routing:152archive-eligible (42unsupported),13clear (0false-clear),335human.
Mean claimed confidence97.6%; even100%cutoff leaves15unsupported archives.
See [full findings](../../../docs/jev-500-evaluation-results-2026-09-28.md).

Budget-only beta deployment: `b0b84d58-f537-4c28-b59c-b409de978fe7`.
Later authenticated usage delta: $0.31191725; remaining provider cap:$4.6279235.
Immediate metadata lagged; original receipt and later accounting are separate.
Known rounded response costs total$0.312098; one response cost is unknown.
No retry, model/policy edit or actual page action occurred. All observed bounds
held. Run `node tools/jev-evaluation/expanded500-20260928/verify.mjs` for immutable
fixture/image/response/source integrity and exact backend replay.

Offline PDF rebuild (the runner must never be rerun merely to reproduce charts):

```sh
~/.local/share/ezkart/owner-guide-tools/bin/python \
  tools/jev-evaluation/expanded500-20260928/report.py \
  --results tools/jev-evaluation/expanded500-20260928/results.json
```
