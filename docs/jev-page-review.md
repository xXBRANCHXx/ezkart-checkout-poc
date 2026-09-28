# Jev page review and evaluation

The owner authorized connecting Jev on 28 September 2026 to measure its work,
then approved recommendations plus reversible temporary archiving. Automatic
deletion remains off. Ordinary software still handles DOB/18+ calculations;
Jev has no identity-verification role or access to identity documents, orders,
customer accounts, payment credentials or provider secrets.

## Current implementation

Migration 0079 records original page reports, exact R2 revisions, immutable
page evidence snapshots, one-send model attempts, outcomes or failures, human grades and
archive/restore audit events. The existing explicit platform support reviewer
registry and fresh TOTP proof authorize writes. Store ownership alone confers
no access to other stores' reports. Viewer permission permits reading only.

`/v1/jev/pages?store=...` selects a page from the real store. The authenticated
reviewer creates an original report at `/v1/jev/reviews` with requestKey, store,
pageId, expectedRevision, reportReason and reportText. This queues evidence without spending.
A deliberate `/reviews/ID/run` with its original requestKey performs at most one
model call. Replays read the original state; changed keys cannot repeat an
uncertain call. Unknown billing keeps its reservation. No public report can
launch a model call, and there is no background scanning scheduler.

The server now collects evidence package v2: preserved page text and ASCII spacing,
published HTML/CSS/JavaScript, URLs/slugs, selected report reason and written
explanation (including Other), and supported captured image pixels. Original HTML
and captured resources live in private R2. Exact image hashes are checked before
model submission and reviewer display. Reports remain allegations, not evidence.
The model receives no tools and must treat all page/report/code/image content as
untrusted input. The UI displays source as inert text. See
[page evidence coverage and limits](jev-page-evidence.md) for collection limits,
unsupported resources and the distinction between source inspection and runtime
rendering. Private account, payment and identity records are not collected.

The trusted `jev-beta-policy-v1` registry contains owner-approved credential
requests and direct threats, plus narrow sourced Indonesian unlicensed gambling
and unlawful Group I narcotics sale rules. Lack of a licence cannot be inferred
from missing information; uncertain classification, jurisdiction, context or
unsupported allegations require human review. See the closed registry and
primary citations in [the provider registry](../cloudflare/ezkart-api/src/jev-provider.js) and [the evaluation guide](jev-evaluation.md).
This is narrow platform moderation, not comprehensive legal clearance.

Both archive and no-archive decisions require a finite model confidence of at
least 0.8. Below that threshold, missing historical confidence, uncertainty,
limitation findings or incomplete coverage route to human review. The backend
preserves the original recommendation alongside its effective decision; a
self-reported confidence is not measured accuracy.

Only a supported needs_change outcome with exact current-page evidence, no
uncertainty, complete evidence coverage and approved archive configuration may
create a temporary hold. Mere report submission, malformed output, transport
failure, stale content, unseen-media allegations and unsupported rules cannot
archive. The normal public URL and custom-domain path share the hold gate and
use no-store responses. The seller retains private access to edit. Page edits
do not silently lift a hold; original orders/support/financial records are
unaffected. Human restore requires the displayed current revision and active
archive ID, a reason and fresh reviewer authority. Model clear never restores.

Ordinary merchant saves and deletes share a D1 revision/write-token fence with
review snapshots and archive/restore actions. Conditional R2 writes retain an
exact token receipt; a lost acknowledgement can recover from that receipt. An
unknown write/delete stays held and is never unlocked by a timer. Direct operator
R2 edits bypass this supported path and require explicit reconciliation. If a
save races model completion, the validated result is retained without archiving
and without another model call. An old case cannot restore a newer case's hold.

Human grades use score 1–5, agreement agree/disagree/uncertain and notes. Grades
are immutable evaluation records, not model training. Recorded failures can also
be graded. Re-scans are explicit, limited to three after a completed original
review, and retain the original five-day deadline. Reaching either limit marks
a human decision due; it never deletes or terminates a page.

## Model and budget

The adapter pins `google/gemini-3.1-flash-lite` and `google-vertex/global`, with
strict JSON schema, required parameter support, no provider fallback, no retries,
no tools, data-collection denied and ZDR requested. Its serialized request must
fit 8,000 UTF-8 bytes for legacy snapshots. Evidence v2 permits bounded larger
text and up to 32 captured images with a 2,000 output-token cap. Provider maximum
prices remain $0.50/M input and $2.50/M output. Text calls reserve at least $0.01,
increasing with serialized input bytes; image calls reserve $0.54 against the
whole pinned model context. Migration 0080 adds atomic immutable supplements to
the original $0.01 attempt record. These are conservative ceilings, not expected
charges. Immutable reservations bound concurrency
and retain unknown costs; actual returned cost is separate and never guessed.

The dedicated Ezkart Jev Beta key has a verified $5 total provider hard limit,
no reset and 27 December 2026 expiry. Read-only authenticated metadata confirmed
these facts before the first synthetic call. The key remains outside the repo;
only the private Worker `JEV_OPENROUTER_API_KEY` binding may contain it.

Authorized runtime settings for reviewer-triggered use are `JEV_ENABLED=enabled`,
`JEV_MAX_CALLS=500`, `JEV_BUDGET_MICROUSD=5000000`,
`JEV_APPROVED_POLICY=jev-beta-policy-v1`, `JEV_ARCHIVE=enabled`. The six-call
synthetic diagnostic was separately capped at $0.10. Imported diagnostic attempts
are labelled separately; their conservative reservations still reduce the total
key budget. Mode responses expose reviewer/benchmark counts, remaining ceiling
and per-call reservation without exposing the key. The owner's deliberate MFA
Run action authorizes a single further review within that existing budget.
No configuration or deployment is implied by this source document alone.

## Initial six-case diagnostic

Exactly six synthetic calls ran once through the real adapter; no real page or
customer data was sent and no live page was archived. Four matched their expected
verdicts. The ambiguous Indonesian licence allegation incorrectly returned clear.
The unseen-video case failed exact-source validation; its original invalid
response text was not retained by the first adapter version and cannot be
reconstructed. Its input and validation-rejection code are preserved. Later
invalid answers retain bounded rejected text separately from valid outcomes.
Do not count this rejection as a correct model verdict or claim what its missing
text said. The sixth explicit unlicensed wagering offer returned needs_change.

Authenticated key usage increased **$0.00212625**, leaving **$4.99787375** after
these six calls. This small diagnostic does not establish real-world accuracy or
safe unattended moderation. The owner can grade each result, including the
failure, at the Jev admin page. The UI calls clear “No violation flagged”.

`tools/jev-evaluation/run-benchmark.mjs` uses the same adapter and an exclusive
private run file to prevent accidental repeated sends. The signed workbench-only
`/internal/commerce/jev/evaluation` import uses the explicit private
`JEV_EVALUATION_SELLER_ID` to anchor its records to an existing Ezkart store.
This setting is independent of financial wallet configuration; it neither
creates a wallet nor changes an account. Normal reviewer runs do not require
this import-only setting or DOKU readiness. The import seeds exactly six synthetic records for
grading, creates no published page, sends no model request and cannot archive,
restore or rescan a real page. Expected verdicts are separate display metadata
and are never supplied to the model.

## Confidence follow-up

See [the ten-case confidence diagnostic](jev-confidence-results-2026-09-28.md)
for the owner-requested 80% cutoff and fresh model observations.

The later [120-case evaluation](jev-expanded-evaluation-results-2026-09-28.md)
found nine unsupported archive-eligible decisions surviving the 80% and evidence
checks. Missing permit status, missing jurisdiction and ambiguous threats remain
observed weaknesses. The confidence score is not a calibrated probability of
correctness. This evaluation preserved model/policy settings and made no real
page actions; the evidence-v2 prompt now reinforces those missing-context rules. This prompt
change has not been validated by another 120-case evaluation, so the old accuracy
figures do not establish the new adapter’s accuracy.

The subsequent [500-case evidence-v2 evaluation](jev-500-evaluation-results-2026-09-28.md)
found 378 matching raw verdicts, 42 unsupported archive-eligible decisions and
335 human-review outcomes. Its synthetic references and changed sample do not
establish production accuracy or a controlled improvement over the older run.
