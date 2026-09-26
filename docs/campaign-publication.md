# Campaign publication and recipient queue

Publication now captures the approved draft, store identity, schedule and
consented customer audience in one D1 transaction. The sealed audience creates
one durable `campaign.send` job per account/address, with no token issuance or
provider request. This is the publication/recipient-queue part of the full
marketing workflow. [Campaign delivery](campaign-delivery.md) now integrates
per-recipient message preparation, current-permission dispatch and provider
callbacks. Operator recovery and merchant publishing controls remain necessary.
The existing Marketing UI continues to report delivery unavailable, and sending
remains held behind the campaign/email/commerce configuration.

## Publication and schedule behavior

- A request names an owned campaign, its current draft revision, a 32-hex
  request key and either a future UTC timestamp or `null` for the earliest
  available processing time. Subject, heading and message must be complete;
  a shop button requires the store's shop to be enabled. New publication
  requires active membership with an editing role, central commerce and the
  full campaign/email configuration. Those deployment flags remain held.
- One campaign has one publication. Exact retries recover its original
  receipt and current publication state; a second request cannot publish the
  campaign again. Subsequent draft/store-name edits do not change the captured
  copy. A new campaign is required for another audience send.
- The stored customer filters run against authoritative orders, permanent
  account ownership and the store/account/address-specific promotional grant.
  Customer master metadata and unverified checkout contacts do not grant
  permission. Account/address duplicates collapse to one candidate. Customers
  without permission are excluded. This is a publication-time audience;
  later orders or opt-ins do not add recipients to it.
- Publication, all candidate rows, the final count and every recipient job
  commit together. An empty audience or failed guard rolls back the whole
  transaction. A lost acknowledgement retries the same request. There is no
  partially populated audience that can begin sending, and the sealed list
  cannot be edited, replaced, appended to or deleted.
- Future schedules must be at least one minute ahead and within 366 days.
  Rescheduling requires the current publication revision and moves all queued
  job times atomically. It is refused once any recipient has begun processing.
  Concurrent schedule changes preserve one winning revision and reject the
  stale change. Schedule history remains immutable.
- Cancellation is terminal and remains available while sending/commerce are
  held. It stops only jobs that are still queued with no attempt. A running or
  previously attempted job retains its actual state and evidence; cancellation
  does not claim that such an email was never submitted. The sender
  must honor the cancellation immediately before a new provider submission.
- New publications are limited to 10 per hour and 100 per day per store and
  environment. Publication changes are limited to 20 per minute per campaign.
  An original receipt remains recoverable after a rate limit, role downgrade,
  provider hold, later draft edit or cancellation, while membership is required
  to read it. A removed member cannot recover private data.

A candidate's captured grant revision is historical selection evidence, not
send-time authority. Current verified account email, current permission,
suppression, store/publisher access, lease, schedule and cancellation must all
be rechecked by the pending [delivery integration](campaign-delivery.md).
The message and [unsubscribe token](campaign-unsubscribe.md) must be committed
atomically when the recipient is prepared, and retries must reuse the original
stored bytes. This change does not replace those requirements or activate mail.

## Storage and API

Migration `0035_campaign_publication.sql` adds four tables, one index, one view
and seventeen triggers:

- `commerce_campaign_publications`: immutable publication receipt and frozen
  campaign/store/schedule/order-boundary values.
- `commerce_campaign_candidates`: immutable account/address/order/consent
  selection with per-publication customer and account/address uniqueness.
- `commerce_campaign_seals`: exact final candidate count and atomic job creation.
- `commerce_campaign_publication_actions`: immutable, revisioned reschedule
  and cancellation receipts.

The state view combines the original publication and latest action while
retaining the last schedule after cancellation. The read query retrieves
publication state and queue counts in the same database snapshot. A missing
recipient job fails the read for operator review instead of reporting a
smaller audience. Campaign jobs reject replacement/deletion, and a temporary
completion guard requires a provider binding or a confirmed no-send receipt.
The job claimant accepts `campaign.send`; the dedicated dispatcher requires the
campaign activation flag and every existing email/commerce prerequisite.

All paths extend `/v1/commerce/marketing/campaigns/{campaign_id}` and use the
current authenticated merchant/store:

| Method/path suffix | Contract |
| --- | --- |
| `GET /publication` | Current publication or `null` for an owned unpublished draft |
| `POST /publish` | `{revision,requestKey,scheduledAt}`; exact publication recovery |
| `POST /publication-action` | `{kind,revision,requestKey,scheduledAt}`; reschedule or cancel, with `null` time for cancellation |
| `GET /recipients` | 25 captured recipients with job state and an opaque cursor |
| `GET /publication-history` | 20 publication/schedule/cancellation receipts with a fixed revision boundary |

The PHP proxy binds CSRF, current account and store, validates routes/methods,
rejects duplicate/extra parameters, bounds mutations to 3 KB, enforces origin
and JSON rules, and rechecks the live sign-in before returning private results.
Recipient/history cursors cannot cross a campaign or merchant. No response
contains provider credentials, unsubscribe tokens or rendered recipient mail.

## Verification and remaining acceptance

Worker tests cover concurrent/replayed publication, frozen copy and audience,
empty-audience rollback, saved filters, current grants/withdrawals, scope/role
guards, stale input, provider holds, rescheduling/cancellation, immutable and
replacement-write protection, processing races, pagination, rate limits,
membership/consent changes between preflight and commit, and migration over
populated drafts/consents/orders. The real PHP proxy tests interrupted
publication/action acknowledgements, the preserved audience/history,
route/account/CSRF/origin/size guards and a sign-in replacement after commit.

Campaign-specific operator recovery, merchant publishing controls,
signed-in hosted acceptance, load/recovery acceptance, automation and
performance reporting remain required. No top-level marketing or release gate
is closed by this publication foundation.

Local release validation passes all **253 Worker tests** and **17 affected
PHP/browser checks**, including all twelve publication cases and three real
proxy cases. The final full Worker run uses `--test-force-exit` and exits
cleanly after all test/cleanup results. PHP/JavaScript syntax, diff checks and
the TEST Worker dry-run build pass.

A fresh private TEST export of 518,727 bytes restores in original statement
order before migration 0035. Its SHA-256 is
`bfc5bc45e23029b151437e338a2779ab1281ed3f1424b9eace84ea86f358a3fb`.
The rehearsal preserves every row in all 99 pre-existing physical tables,
returns `ok` from the integrity check and no foreign-key errors, and adds
exactly 23 schema objects without changing an existing object. All four added
tables remain empty in the rehearsal. Remote rollout must match this schema
and preserve the existing operational/import evidence.

## TEST rollout

Implementation `ce382b8` is pushed to workbench. TEST migration 0035 and
Worker `14ecc8b8-0e42-4aac-b078-4b95b6d51c4e` are installed, with no pending
migrations. Remote checks preserve every prior table count, seller setting and
the 15-entry legacy import manifest; all four new tables are empty. All 23
schema objects match the original-order restoration exactly, foreign-key
checks are empty, and the actual state read and four publication/candidate/
seal/action write plans compile remotely without performing a write.

At **26 September 18:14 UTC / 27 September 01:14 WIB**, all 30 deployed Worker
health/access/hold checks passed, with 102 healthy application tables, D1 and
both R2 buckets. At **18:15 UTC**, both checked hosted asset hashes matched
the working source and 13 hosted access/header checks passed, including all
five publication proxy routes returning 401 anonymously. The unsubscribe page
retains its complete restrictive CSP, `DENY`, no session and no redirect.

Provider and central-commerce flags remain held. No hosted campaign was
published, queued or sent as part of deployment verification. These anonymous
route checks do not establish signed-in hosted publication or provider
acceptance; those remain open with the full delivery/UI integration. Main,
production and the production PR remain untouched.
