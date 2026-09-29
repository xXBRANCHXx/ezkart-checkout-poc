# Ezkart project instructions

## Landing-page template work

Before changing landing-page templates, template selection, template rendering, or the landing-page builder, read `docs/landing-page-template-plan.md` completely. It is the approved product and design brief. Preserve its hard constraints unless the user explicitly changes them.

## Builder interaction checks

Builder interaction and layout changes must include checks through the merchant UI: create a blank page, add and select separate sections, edit their backgrounds, add text and images, drag and resize them, undo/redo, and save/reopen. Check desktop and narrow editor widths. API-only checks do not establish that pointer and keyboard interactions work.

Use `blank-editor-workflow.test.mjs`, `section-actions.test.mjs`, and `grid-snapping.test.mjs` in `tools/builder-mcp/test` for this coverage. Run the broader builder suite when shared selection, dragging, rendering, or persistence behavior changes, and visually inspect the affected canvas for clipping and hidden controls.

## Element settings

Dropdowns must use Ezkart's universal dropdown control and menu styling. The only
exceptions are the font picker and font-weight picker. Product options in the
editor, preview and exported pages use `cart/select.js` and `cart/select.css`;
do not introduce a separate product dropdown design.

Use merchant-facing controls for appearance settings: numeric values with separate units, sliders, color pickers, named choices, and structured responsive font limits. Do not require merchants to type CSS functions such as `clamp()`. Show resolved defaults such as “Left (default)” or the current font name instead of “Inherit” or “Automatic.” Preserve existing CSS and responsive rules until the merchant deliberately changes a setting. Apply this consistently across element types, including narrow editor widths. `inspector-controls.test.mjs` covers the shared controls.

## Delivery

- Unless the user explicitly requests a local-only change, commit and push completed Ezkart changes to the current working branch after proportionate verification.
- Changes to the test API should be deployed to the test Worker when deployment is required for cross-device testing. Never infer permission to deploy production.

## Production release hold (owner decision, 19 September 2026)

- Do not push to Ezkart's `main`, merge production PRs, or deploy changes to `ezkart.id` until the owner explicitly authorizes the final release.
- The owner requires DOKU approval and roughly a month of sustained testing of financial protocols and wallet structure before that release. Passing the current automated checkout tests is not a substitute for those gates.
- PR #3 (legacy sandbox lockout) must remain draft and unmerged during this hold. The owner explicitly declined deploying it now.
- Continue authorized work on `agent/ezkart-workbench` / `test.ezkart.id` and the separate Executive Dashboard. Dashboard environment selection does not authorize a live storefront deployment or provider activation.
- See `docs/production-release-gates.md` for the recorded release conditions and current validation limits.
- On 27 September the owner reported DOKU approval and instructed preparation
  for beta/soft-launch while explicitly keeping everything on workbench. DOKU
  business approval is received; technical payment/payout acceptance and the
  existing main/production release hold remain separate. See `docs/beta-readiness.md`.
- The owner clarified the beta target is live DOKU on workbench, not a sandbox
  launch. Prepare a separate beta environment for real payment records and live
  credentials. Main and `ezkart.id` remain held; local fixture testing does not
  determine the beta's provider mode. Preserve the existing sandbox evidence.
- For continuation after the 28 September handoff, start with
  `docs/beta-wave2-2026-09-28.md`, then the older
  `docs/beta-finish-2026-09-28.md` and its private continuation-record link.
  Use `docs/beta-one-time-entry.md` for the concrete minimal paid-beta activation
  sequence and account requirements. The batch report distinguishes implemented
  work from remaining code and live acceptance,
  and preserves the owner's FlexiBill-pending decision and current email state.

## Beta readiness clarification (owner, 28 September 2026)

- The owner confirms DOKU is ready; live testing remains. Treat this as the
  current provider-readiness status, superseding earlier activation-pending
  summaries. A blank dashboard panel is not evidence that activation is missing.
- Prepare Ezkart Workbench for beta. Record ShopeePay as implemented/deployed
  with live app handoff, payment and settlement testing pending. Do not turn
  unperformed beta tests into a new pre-beta DOKU activation requirement.
- Preserve historical observations as dated evidence, distinguishing owner
  confirmation from independently observed transaction results. This correction
  does not itself change runtime switches, initiate money movement or release
  main/ezkart.id.

## Payment window (owner decision, 28 September 2026)

- Keep Ezkart’s cart, order/status page and native BCA Virtual Account flow.
- The owner subsequently approved DOKU’s hosted popup for QRIS/cards because
  their payment instructions belong inside that provider window. Earlier
  direct-API-only preferences do not override this decision. Preserve the seller
  Sub-Account route, original saved payment sessions and server-confirmed status.
- Do not promise QR download/share controls until observed in the actual hosted
  UI. The popup wrapper is implemented separately from provider activation;
  pending BCA/QRIS approval and Collect & Route requirements still apply.

## Owner learning materials

For future animated explainers, the owner means visual teaching through concrete
events and cause/effect: a shopper, order, money moving, holds, failures and
recovery. Moving text cards or diagram boxes do not satisfy that intent. Narration
should explain the events shown. Prioritize the video over mobile player polish.
The preferred treatment is newspaper/ink miniatures with selectable chapters and
zoom. Use plain English and a gentle male narrator; the first female voice was
uncomfortable for the owner. Explain terms, including FlexiBill recurring billing
and direct API versus hosted checkout. Call the platform fee commission.

## Seller onboarding and company commission (owner clarification, 28 September 2026)

- Each seller gets one DOKU Sub-Account backing Ezkart Wallet and withdraws to
  the bank destination saved during onboarding. Provider confirmation verifies
  that setup; it is not a request to choose a different wallet model. Preserve
  original uncertain registrations and in-flight withdrawal destinations.
- Required onboarding includes full legal name, verified email, phone, bank
  details, and pickup/return addresses with confirmed map pins. The minimum
  seller age is **18**, explicitly confirmed on 28 September. The owner later
  clarified that the government declaration promised to STORE age, not to verify
  identity. Do not infer mandatory KTP/selfie/KYC from that data-category
  declaration. Store and label seller-declared DOB/age accurately; do not call
  it verified identity or call 18 a statutory PSE threshold. The owner briefly
  considered collecting NIK/passport numbers, then reversed that request: keep
  DOB input only. No ID-number/photo requirement is authorized by that reversal.
  Separate legal and provider verification obligations need their own evidence;
  DOB-only collection is not a blanket legal-compliance conclusion. See
  `docs/seller-age-declaration.md` for the checked distinction and limits.
- Ezkart's commission must reach its company bank. Distinguish commission
  allocation, credit to the platform's DOKU balance, and confirmed bank payout.
  DOKU knowing a bank account does not prove the Sub-Account payout connection.
  Shipping, admin charges, refund obligations and fees are distinct from commission.
- Calculate 18+ eligibility from DOB using ordinary code. The owner moved
  Jev/OpenRouter toward reports and page flags, not identity proof. The owner
  subsequently approved recommendations and reversible temporary archive for
  evidenced violations of the approved starter rules, with human grading and
  restore. Automatic deletion remains off. The three-rescan/five-day limit
  escalates to human review; it does not erase a page. Reports are allegations,
  and ambiguous or unseen content must not be treated as substantiated.
  The initial six synthetic model calls have a separate $0.10 benchmark cap.
  Owner-triggered reviews with fresh MFA are authorized within the existing $5
  total key cap and per-call limits; reports never trigger spending automatically.
  Saved grades are evaluation records, not automatic model training. See `docs/jev-page-review.md` and
  `docs/jev-evaluation.md`; public visitor report intake and comprehensive
  unlawful-content coverage are not claimed.

## Sidebar announcements

The sidebar promo card's orange-to-pink gradient is intentional. Preserve it
when changing shared controls or navigation styles. Its title, description, icon,
button label, and destination live in `cart/admin/sidebar-promo.php` so it can
promote Advanced or future announcements without redesigning the sidebar.

## Seller and Executive navigation (owner, 28 September 2026)

- Seller admin is seller-only. Internal page moderation, platform refund support
  and company treasury belong in the separate Executive Dashboard Operations view.
- Seller content issues appear as Alerts in Notifications, with links from held,
  grayed-out landing pages to reasons, original countdown and rescan requests.
  Do not label seller navigation Jev or expose internal moderation controls.
- Seller onboarding has no sidebar entry. Keep the top-bar setup reminder visible
  to owners until saved onboarding requirements are complete.

## Jev real-use acceptance (owner, 29 September 2026)

- The owner accepted the direct-evidence harness for real reviewer-triggered page
  moderation on Ezkart workbench/beta, operated from Executive Operations.
- Automatic temporary archive requires an evidenced breach of a supplied starter
  rule, all direct-evidence checks, at least 80% confidence and complete coverage.
  Unproven/ambiguous flags and raw clear answers go to human review. Preserve
  reversible restore, original results, MFA and one-send spending safeguards.
- This acceptance does not release main/ezkart.id or connect public visitor report
  intake. See `docs/jev-real-use-2026-09-29.md` for accepted scope and reconciled
  remaining allowance within the original $5 provider cap.

## Action icons (owner, 29 September 2026)

Use recognizable icons alongside short labels on seller action buttons and links.
Do not introduce rows of text-only controls such as Refresh and Preferences.
Keep icons visible on narrow screens, decorative SVGs hidden from assistive
technology, and accessible action names intact when controls update dynamically.

## Bank setup timing (owner, 29 September 2026)

- Without two-step enabled, sellers must save bank details before publishing a landing page.
- With two-step enabled, sellers may publish and accept payments before saving bank details; bank details are required before withdrawal. Keep the bank-details page protected by two-step. Other seller declarations and payment/provider controls remain in force.

## Primary button branding (owner, 29 September 2026)

Use the existing orange-to-pink branded gradient for primary actions, matching
Wallet’s View payments button. Reuse `ui-button primary` and the shared
`--ui-action-gradient`, hover and active tokens. Do not replace it with solid
orange on sign-in, onboarding or messaging buttons.

- Seller setup verification applies only to the bank section. Profile, DOB, phone and address/pin setup must remain accessible with ordinary sign-in. Bank details and changes retain fresh verification; expiry must not discard unrelated setup edits.

## Merchant spacing and visual summaries (owner, 29 September 2026)

Fix panel, filter and action spacing in the shared admin design system instead of
adding isolated page patches. Use `--ui-panel-padding`, `--ui-control-gap` and
`--ui-field-gap`; check desktop and phone widths. Customer summaries should use
compact charts with real data and honest empty states, not paragraphs of metric
text or invented trends. Annotate action semantics with `data-ui-icon` so icons
survive loading, translation and export label updates.

Use purple only for highlighted fills, such as selected tabs and notice/toast
backgrounds. Preserve the original orange/coral chart, icon and link accents;
do not recolor the overall accent palette purple.
Keep the orange-to-pink gradient for primary actions. Keep report controls compact
and place useful charts directly beneath them; do not stack export, metadata and
empty-state panels above the report data.

## Seller payment branding (owner, 29 September 2026)

Use **Ezpay** and the supplied Ezpay logo for seller-facing payment branding. Do not expose DOKU in seller interface copy, statuses, or payment-provider display labels. Keep internal provider identifiers, integration protocols, and financial records unchanged.

## Saved bank changes (owner, 29 September 2026)

Once bank details exist, replacement requires an independent human review before
activation. Preserve the active bank while pending or rejected; require fresh
verification, a reason, established-contact and bank-ownership checks, and an
audited staff decision. Never add immediate self-service replacement or automatic
approval. See `docs/bank-change-review.md`.

## Beta campaign navigation (owner, 29 September 2026)

Use a megaphone icon for Campaigns. The email Marketing page is not part of
this beta: keep it out of navigation and redirect its old page URL to Campaigns.
Retain its saved data and code for later; do not reintroduce the page without
an owner request. Analytics remains a separate page.
