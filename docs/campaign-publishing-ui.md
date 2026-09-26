# Merchant campaign publishing

The Marketing editor now connects saved campaign drafts to the immutable
publication and delivery workflow. Merchants can review and publish saved copy,
choose a send time, change that time before processing starts, cancel remaining
sends, and inspect recipient outcomes and publication history. Saving, editing
or archiving a draft still does not publish or cancel a campaign.

## Review and delivery behavior

The review refreshes membership, delivery readiness, the saved draft and its
publication, then checks the current permitted audience. Unsaved or unresolved
draft changes, stale versions, incomplete copy, a disabled shop button, empty
permission or held delivery block publication. The dialog displays the exact
saved copy and filters and requires explicit confirmation after loading.

The merchant chooses the earliest available processing time or a future date
in the store's configured Indonesian timezone. Each review retains its checked
timezone offset; a later background workspace refresh cannot reinterpret an
entered time. Timing edits clear the confirmation. Dates must round-trip exactly
and be at least one minute ahead and within 366 days.

Publication freezes the message and recipient list. The editor shows that frozen
copy separately from later draft edits. Rescheduling uses `canReschedule`, based
on every recipient remaining queued with zero attempts. It closes after any
processing attempt, including one that later returned to the queue. Cancellation
states that submitted or in-flight mail cannot be recalled and uncertain
submissions still need review.

The campaign list, month filtering and calendar use the publication's actual
schedule when present. A later draft reminder cannot move that publication to
another calendar month. Cancelled publications retain their time and label.

## Interrupted actions and private data

Before any write, the browser preserves the exact original request and receipt
expectations in session storage scoped to account, store and commerce
environment. Unknown results retain that intent across reloads. The recovery
tray can reopen a pending campaign independently of the current list or filter.
The user retries the same publication/action key; no replacement send is made.

Acknowledgements must match the original campaign, publication, saved version,
copy, request reference and times before clearing the intent. A valid replay may
also return a newer publication state, which the UI identifies. A viewer may
recover an earlier receipt but cannot begin a new action. Definitive revision or
processing conflicts require a fresh review. Unreadable recovery data remains
untouched and blocks new writes; storage failures prevent unpreserved writes.

Requests have a bounded timeout. Account/session replacement destroys the
private workspace, while the original account's stored intent remains scoped
to that account. Responses cannot reopen a closed dialog, append to another
campaign's history or replace a newly selected editor. Background workspace
refreshes preserve focus on unchanged delivery controls.

## Evidence shown to merchants

Recipient pages show queued, submitted, delivered, skipped, uncertain, failed,
bounced, complained, suppressed, delayed or cancelled outcomes from stored
evidence, with unresolved processing review shown independently. Submission and
delivery dates are explicit. Delivered means the recipient mail server accepted
the message; neither delivery nor submission claims that it was read. Totals
can overlap later bounces or complaints. Refresh obtains newer evidence.

History lists publication, schedule revisions and cancellation separately from
draft history. Both dialogs preserve earlier pages on a failed page request,
allow retry and refresh, deduplicate records, and ignore stale responses after
closing. Native dialogs support keyboard dismissal and focus restoration.

## Verification

All **295 Worker tests** pass, including three new workspace/publication cases
for actual readiness, store-local calendar boundaries and processing eligibility.
All **11 new publishing browser checks** and the **three real PHP publication
proxy checks** pass in the final release run. The preceding combined run also
passes all **nine existing Marketing editor checks**.

The browser suite uses the actual merchant PHP/proxy and isolated Playwright
at 1360 and 390 pixels. It covers publication, rescheduling, cancellation,
frozen-copy display, lost acknowledgements across reloads, role changes,
concurrent revisions, processing conflicts, mismatched receipts, corrupt and
unavailable storage, held delivery, empty permission, failed pagination, stale
responses, signed callback outcomes, account replacement, timezone changes and
keyboard focus. It sends through a fixture provider, never a real mail service.
Desktop/mobile review, publication and recipient screenshots were inspected;
there is no horizontal overflow, and the sidebar gradient remains intact.

JavaScript/PHP syntax, diff checks and the TEST Worker dry-run pass. No database
migration is required for these controls. Authenticated hosted acceptance,
campaign operator recovery, provider acceptance, automation, performance reports
and capacity/recovery validation remain open. No top-level completion gate is
closed and no provider or central-commerce hold is lifted.
