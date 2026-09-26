# Marketing campaigns

The merchant Marketing workspace now uses saved campaign drafts, real customer
audience previews and a planning calendar. The sample active campaigns,
automation counts and toast-only controls have been removed. This delivery is
the draft/audience portion of the larger marketing gate. Automation triggers
and useful performance reports remain required.
Draft saving does not send mail or mark marketing complete.

[Publication and recipient queues](campaign-publication.md) persist frozen
campaign/audience snapshots and versioned scheduling/cancellation behind the
private API/proxy. The [campaign sender](campaign-delivery.md) saves each message
with its [unsubscribe token](campaign-unsubscribe.md), verifies current
permission and identity, and records provider submission and signed delivery
evidence. The [publishing controls](campaign-publishing-ui.md) now review and
publish saved drafts, reschedule or cancel remaining sends, and expose recipient
outcomes and delivery history. The calendar uses the publication's actual send
time when one exists. [Operator recovery](campaign-investigation.md) verifies
uncertain submissions. Automation, performance reporting and provider/hosted
acceptance remain outstanding; sending remains held by the deployment flags.

## Merchant behavior

- Create and edit a named draft with subject, inbox preview, heading, paragraph
  text and an optional button to the store's own published shop. An isolated
  email preview escapes all copy and does not send, load remote resources or
  execute merchant HTML. The unsubscribe footer is preview copy only until the
  delivery workflow provides a working recipient link.
- Choose customer filters directly or copy a saved segment's current filters.
  Later segment edits do not change the campaign. Customer groups, value/order
  limits, latest-order dates, location and tags use the customer workspace's
  authoritative filtering. Order-date boundaries use Jakarta time.
- Preview the actual matching customer records and counts for granted,
  withdrawn and unrecorded email permission. Permission joins the latest
  order's permanent account owner and email address, store and environment.
  Customer master metadata and an address captured at checkout are not consent.
  A recorded grant is not a claim that the address is currently verified or
  deliverable; actual sending must recheck both identity and permission.
- Plan a draft's date/time in the saved store timezone (WIB, WITA or WIT),
  including dates across a UTC month boundary. The calendar labels unpublished
  reminders as planned drafts and published campaigns with their actual send
  time and cancellation state. Saving a draft cannot create an email request
  or an outbound job.
- Search, archive and restore drafts, page through saved campaigns and inspect
  immutable versions. No fake reach, automation, open or revenue totals appear.
  Draft editing remains available while central commerce is held; audience
  previews remain unavailable until authoritative customer records are enabled.

## Save and access contract

Migration `0033_marketing_campaigns.sql` introduces `commerce_campaigns` and
`commerce_campaign_changes`. A change receipt applies the corresponding
projection in the same D1 statement. Triggers require the current active-store
membership and a non-viewer role, exact prior revision, valid field shape and a
matching immutable receipt. Direct updates, deletes and `INSERT OR REPLACE`
cannot rewrite an existing projection or its history. Changes are capped at 30
per minute and 200 per day per store/environment; original confirmed requests
remain replayable when the limit or role changes.

Every save carries the original campaign ID (null for creation), expected
revision, 32-hex request key and all values. New IDs derive from the store,
environment, member and request key. An identical retry returns the original
receipt plus the current saved campaign. Reusing a reference for another intent
fails with `campaign_reference_conflict`; concurrent revisions fail with
`campaign_revision_conflict`. Neither overwrites a newer version.

The browser preserves drafts and exact pending requests in session storage,
scoped to account, store and commerce environment. Unfinished drafts remain
accessible when the editor closes or another draft opens. An uncertain save
locks its fields and retries its original reference, including after reload.
An unreadable or mismatched stored intent blocks writes without overwriting the
stored record. A storage write failure blocks an unpreserved save. Concurrent
edits compare each copy/audience field against the original base; independent
changes survive and conflicting changes require an explicit choice.

The private PHP proxy binds account, store and CSRF for reads and writes,
validates paths and query fields, checks origin/content type for writes, bounds
upstream response size and rechecks the current Google/MFA session before
returning data. Account/store changes clear the private workspace. Read results
cannot reopen a closed dialog or replace another campaign's draft.

## Private API

All routes use an authenticated merchant and the current active store; a stale
`X-Ezkart-Marketing-Store` header fails closed. Removed memberships are never
recreated by a marketing request. Each read rechecks membership after obtaining
the private records.

| Route | Behavior |
| --- | --- |
| `GET /v1/commerce/marketing/workspace` | Draft totals, active saved segments, store timezone, role and actual readiness |
| `GET /v1/commerce/marketing/campaigns` | `state`, `q`, optional store-local `month`, opaque `cursor`; 25 records |
| `GET /v1/commerce/marketing/campaigns/{id}` | Current saved version |
| `GET /v1/commerce/marketing/campaigns/{id}/history` | Immutable version history, 20 records and opaque `cursor` |
| `POST /v1/commerce/marketing/campaigns` | `{id,revision,requestKey,values}`; 32 KB maximum JSON |
| `POST /v1/commerce/marketing/audience` | `{filters,cursor?}`; 25 matching customer records and permission counts |

Campaign paging fixes its creation boundary while edits remain live. History
paging fixes its initial revision boundary. Audience paging fixes the maximum
order row but permission/ownership changes remain live; it is not a frozen
recipient list or send authorization. Query cursors are bound to account,
store, environment and filters. Unknown, duplicate and malformed JSON/query
fields are rejected. Arbitrary recipient addresses, outbound URLs and provider
credentials are not accepted in a campaign draft.

## Verification and remaining acceptance

`cloudflare/ezkart-api/test/marketing-campaigns.test.mjs` covers concurrent saves,
exact retries, immutable projections, role races, store/environment isolation,
strict input, archive/restore, stable history/list boundaries, rate limits,
timezone changes, actual customer filters and withdrawn consent.

`tools/checkout-test/marketing.test.mjs` runs the actual PHP proxy and merchant UI
at 1360 and 390 pixels. It covers segment selection, preview escaping, the
planning calendar, archives, original-request recovery after reload, multiple
unfinished drafts, three-way comparison, permission holds, private route/session
guards, interrupted audience/history pagination, stale responses, storage
failure, altered pending intents and same-browser account changes. The shared
test cURL transport now returns the real boolean result for a write callback
and respects callback failure.

Local verification on 26 September: all **225 Worker tests**, **32 affected
PHP/browser/signing checks** and the **nine final Marketing browser checks**
pass. The latter also verify mismatched save acknowledgements, interrupted
draft reopening, keyboard dialog use and explicit discard of a new unsaved
draft. Desktop/mobile editor, calendar, preview and comparison screenshots
were visually inspected; there is no horizontal overflow and the sidebar
announcement gradient is preserved. Syntax checks and the TEST dry-run bundle
pass.

A fresh TEST backup of 505,393 bytes restores successfully before migration
0033, with SHA-256
`2d1f5583c176fa35e1c35d14534f9e3b37ef3a00097e828a105d92a99f4fdeb2`.
Original-order migration rehearsal preserves all rows in the 95 pre-existing
physical tables, passes integrity/foreign-key checks, adds eleven schema
objects and leaves both campaign tables empty. The backup and private rollout
evidence are in `/tmp/ezkart-marketing-deploy-01a0d643`.

Provider delivery and authenticated hosted acceptance are still open. The
workbench remains on `agent/ezkart-workbench`; production, `main`, PR #3 and
provider activation remain held. No completion gate is closed by this delivery.

## TEST rollout evidence

Implementation `d3a9d23` is pushed to workbench and served by Hostinger. Migration
0033 and Worker `125cec15-862c-4ccd-87c1-85cb858cc00d` are installed. At
**26 September 17:02 UTC / 27 September 00:02 WIB**, the deployed Worker passed
22 health/access/hold checks, reported 96 application tables with healthy D1 and
both R2 buckets, and had no pending migrations.

Remote comparisons preserve all pre-existing table counts, settings, financial
and import evidence; the 15-entry legacy rehearsal manifest remains unchanged.
Both campaign tables are empty. All eleven added schema objects match the
original-order restoration exactly, foreign-key checks are empty, and the
actual list/audience queries and receipt insert plan compile remotely without
writing data. The release script initially stopped because it compared new
campaign objects against an email-only schema inventory; the unchanged email
inventory and all eleven campaign objects were then verified independently
before Worker deployment.

At **17:02:42 UTC**, both hosted JS/CSS assets matched local hashes, the merchant
sign-in gate and two private proxy guards passed, and both include-only PHP
files returned empty 404 responses. Shared Chrome still reported the prior
disconnected connection, with no new reconnect attempt; signed-in hosted
acceptance remains open. The hosted CSP still exposes only
`upgrade-insecure-requests`, so the existing hosting/header investigation also
remains open. Central commerce, notification delivery and email provider holds
are unchanged. No campaign email or delivery job was created by the rollout.
