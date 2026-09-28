# Jev evidence package v2 — 28 September 2026

The owner asked whether Jev had enough information and explicitly requested image,
ASCII, code, URL/slug and report-reason coverage. The former collector supplied only
2,800 characters of flattened text, omitted code and pixels, and collapsed ASCII
spacing. That was insufficient for comprehensive page review. Missing evidence
should still have produced human review; it does not excuse confident guesses.

## What is supplied

- Published page text with spacing and line breaks preserved, plus the store/page
  slugs, canonical URL, active custom URLs and exact saved revision.
- Published HTML including hidden content, comments, inline CSS, JavaScript and
  attributes. Captured external CSS/JavaScript/SVG source is included as inert code.
- Image pixels from PNG/JPEG/WebP inline data, owned Ezkart media uploads and the
  supported static/CDN resource surface. Source IDs, URLs, MIME types, byte counts
  and SHA-256 hashes accompany the pixels. Duplicate bytes share one attachment.
- A resource manifest including image/srcset/poster, CSS assets/imports, script,
  link, form-action and embedded-media references. Link destinations are recorded,
  not crawled. Dynamic strings remain available in the published source.
- Both the selected `reportReason` and full bounded `reportText`, including Other.
  The explanation keeps URL digits and addresses; it is not evidence of a violation.
  Rescans inherit the original reason unless explicitly changed. Historical reports
  without a selected reason display Other.

This is the authenticated reviewer intake. A public visitor report form remains
unconnected; this change does not claim to deploy one or let visitors trigger costs.

## Bounds and honest coverage

The original published HTML is retained in private R2. The model projection shares
240,000 UTF-8 source bytes, 80 discovered resource references, 32 images, 2 MiB per
image and 12 MiB total image bytes. Collection has a 12-second scheduling allowance
and individual fetches time out at 5 seconds. Non-data URL metadata is bounded to
2,048 characters; the original remains in source storage. Every truncation, failed
fetch, unsupported format or budget omission is recorded and forces human review.
The report explanation limit remains 1,200 characters, enforced in UI and backend.

Automatic fetches allow only Ezkart static paths, owned media IDs, Unsplash/Pexels,
jsDelivr/cdnjs and Google Fonts hosts. No arbitrary URL crawl, redirects, private
network targets, credentials or authenticated page requests are used. Unsupported
external hosts are gaps, not clean evidence. CSS imports/background images are
followed within the same limits. Invalid or unsupported inline media are gaps.

JavaScript is not executed. Computed CSS layout/visibility, generated content,
canvas/SVG pixels, video/audio, frames and animation sequences are not fully
inspected. Their source/reference is retained and their limitations are explicit.
Public catalog data loaded only at runtime is not independently fetched. Therefore
this is substantially richer static evidence, not a claim to inspect every rendered
state or every possible external destination. Such pages require human inspection.

## Decisions and traceability

Both clear and needs_change still require confidence >=80%, no material uncertainty
and complete coverage. A visual, URL or source-code finding additionally requires
human verification. Image findings use an image source ID, empty exact-text quote
and a visual explanation; generated OCR is not accepted as an exact page quote.
Text findings retain exact-substring checking. All unknown/missing media and source
limits override even 100% confidence. Model confidence remains uncalibrated.

Image bytes are stored privately before the call, checked against saved hashes and
loaded directly into multipart image attachments. The request receipt references
saved images instead of duplicating base64 blobs in D1. Reviewer-only image access
shows those same original bytes. Changing a live external image later cannot alter
the evidence Jev actually received. The existing exact-page-revision archive fence,
one-send reservation, MFA, immutable results and human restore behavior remain.

## Cost and verification

Image calls conservatively reserve $0.54 (the 1,048,576-token model context at the
$0.50/M imposed input ceiling plus 2,000 output tokens at $2.50/M, rounded upward).
Text reservations scale with serialized UTF-8 bytes and start at $0.01. Migration
0080 adds an immutable supplement in the same D1 transaction as the original
attempt. Both totals are checked before sending. Unknown costs stay reserved.
The UI displays each review's reservation; it is not an estimate of actual cost.

Regression coverage includes actual authenticated PHP/browser intake, preservation
of Other and numeric URL slugs, ASCII/source extraction, missing resources, original
HTML retention, rescan reasons, immutable pixels, reviewer image access, mobile
image viewing, exact confidence boundaries, visual human-review gating, supplement
exhaustion, original request replay, stale revisions and archive/restore behavior.
A single synthetic live vision smoke fixture is in
`tools/jev-evaluation/evidence-20260928/`; its receipt documents the observed
result separately. No real seller page is used for that smoke check. The unchanged
120-case PDF remains a baseline for the previous text adapter, not an accuracy
claim for this new evidence/prompt version.

Provider references checked for this implementation: [OpenRouter image inputs](https://openrouter.ai/docs/guides/overview/multimodal/image-understanding),
[Gemini 3.1 Flash-Lite](https://ai.google.dev/gemini-api/docs/models/gemini-3.1-flash-lite).
The pinned OpenRouter endpoint's context, structured-output support and price are
checked again by the smoke runner before spending.

## Workbench delivery

Code commit `d2d6f03` was pushed to both workbench remotes. Migration 0080 was
applied only to beta after a verified D1 export/local restore and a successful
migration rehearsal (integrity OK, zero foreign-key errors). Beta Worker version
`abea94df-6b8f-47c6-8efb-2f9a20e9098c` contains the evidence collector. The only
configuration adjustment was reserving $0.54 for the one external synthetic image
call: the app ceiling moved from 3,700,000 to 3,160,000 microUSD. Unrelated provider,
payment and release settings were preserved.

The [live smoke receipt](../tools/jev-evaluation/evidence-20260928/README.md)
confirmed that Jev read the credential request present only in image pixels,
cited the right image and reached human review through the backend gate. It is
one correctly interpreted image, not a new accuracy estimate. There were 43
passing scoped checks across confidence, evidence, page revision, backend and
browser suites, plus PHP/JS syntax and beta Worker dry-build checks.

The hosted `test.ezkart.id` reviewer page was checked through the shared browser:
the selected-reason options, Other explanation prompt and updated $3.10 allowance
loaded successfully. This was read-only verification; no additional model call,
report or page action was created.
