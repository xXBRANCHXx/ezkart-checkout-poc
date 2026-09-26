# Campaign delivery integration

The renderer, durable publication, immutable recipient messages, send-time
eligibility checks, signed provider callbacks and merchant delivery summaries
are implemented. The campaign dispatcher has a separate service route and
bounded cron. The merchant [publishing controls](campaign-publishing-ui.md)
expose review, scheduling, cancellation and recipient history. Sending remains
held on TEST, and the workspace reports the actual configured readiness.
Provider activation, operator investigation, automation and performance reporting
remain part of the full marketing gate.

## Message and transport contract

`campaignEmailPayload` accepts the saved campaign values, store identity/name,
shop-enabled state, verified recipient address, `campmail_` delivery reference
and the URL returned by `prepareCampaignUnsubscribe`. Sending content requires
a subject, heading and body, an unarchived draft, and an enabled owned shop when
a button is present. All merchant copy is escaped. The shop URL is constructed
from the deployment origin and store ID; merchants cannot supply an outbound
destination or HTML. Both HTML and plain text include the same unsubscribe
URL. The renderer uses no scripts, remote images or tracking pixels.

The resulting JSON includes exactly the two one-click headers, the pinned
sender, one recipient and environment/profile/delivery/purpose tags. Sandbox
messages carry a visible TEST label and subject prefix. The saved payload can
be up to 64 KiB of UTF-8, including HTML escaping, and retries must reuse the
same string. Transactional messages retain their separate 48,000-byte contract
and cannot acquire campaign headers or purpose tags through this interface.

`sendResendCampaignEmail` validates that payload before any network request.
It requires `COMMERCE_CAMPAIGN_SEND=enabled` in addition to every existing
transactional provider, storage, verification, webhook and TEST-recipient
requirement. Connecting transactional email alone cannot enable campaigns.
The campaign flag remains unset in the workbench deployment. No provider
activation is part of this change.

The idempotency key must be exactly
`ezkart_campaign/{environment}/{campmail_delivery_id}`. Headers accept only a
single HTTPS unsubscribe URL on the deployment's Ezkart origin and the exact
`List-Unsubscribe=One-Click` directive. External URLs, extra headers, missing
visible links, duplicate JSON fields, mismatched purpose/profile/environment,
extra recipients and altered delivery references fail before submission.
The transport posts the saved bytes, does not follow redirects, and preserves
uncertain outcomes when a response is missing, malformed or unverified.

Resend documents [custom email headers](https://resend.com/docs/dashboard/emails/custom-headers)
and [24-hour idempotency keys](https://resend.com/docs/dashboard/emails/idempotency-keys).
The outbox must enforce a conservative retry deadline before that provider
window expires; the transport alone has no durable clock or delivery authority.
Actual mailbox acceptance must establish that DKIM covers both one-click
headers as required by [RFC 8058](https://www.rfc-editor.org/info/rfc8058/).
Browser rendering and fixture submissions do not establish mail-client or
provider interoperability.

## Durable dispatch and delivery evidence

Migration 0036 adds five campaign email tables: immutable requests, start
receipts, provider bindings, lifecycle events and no-send decisions. Campaign
recipients retain their publication authority rather than becoming transactional
notification recipients. Each message and its unsubscribe token are saved in
one D1 batch. A failed batch leaves neither; a lost acknowledgement recovers
the original message and token. The request fixes the credential identity,
recipient, rendered bytes, idempotency key and a 23-hour retry deadline.

Before preparation and every retry, the dispatcher checks the active store,
publisher role, current order ownership, the exact captured consent revision,
current verified Auth address and TEST allowlist. A withdraw/regrant cycle does
not revive an older publication. Campaigns older than one day after their send
time are skipped, as are schedules before the configured activation cutoff.
A shop button requires the shop to remain enabled. Draft edits and a renamed
store never rewrite the published content.

The last database operation before POST records a network start only with an
active lease lasting at least 20 more seconds, an identity check no older than
60 seconds, a due/non-cancelled schedule, current access and consent, no prior
submission and no address suppression. Cancellation cannot recall a network
request already in flight. If an earlier start exists, a later eligibility,
credential or deadline failure preserves uncertainty and stops further sends.
No-send receipts cannot erase start evidence.

The signed Resend entrypoint routes campaign callbacks by their delivery and
purpose tags after verifying the raw signature. It matches environment, profile,
provider ID, sender, recipient, subject and time against the immutable request
and requires a saved network start. Early callbacks can resolve a lost POST
response. Repeated identical events are harmless; conflicting evidence fails.
A shared provider-binding view prevents the same ID from identifying unrelated
campaign and transactional requests. Bounce, complaint and provider-suppression
evidence from either purpose suppresses that address throughout the environment,
including evidence obtained by the transactional investigation service.

Private publication reads add `deliverySummary`, with evidence-based submitted,
delivered, skipped, uncertain, failed, bounced, complained, suppressed, delayed
and needs-review counts. Submitted and delivered counts can overlap subsequent
complaints. Recipient pages add a `delivery` object with state, reason,
submission/delivery evidence times and an independent `needsReview` flag. Late
delivery remains visible even if a dead queue job still needs operator recovery.
Sent/delayed callbacks cannot reverse a recorded delivery. These are transport
outcomes; they do not claim opens, clicks, revenue or conversion attribution.

`POST /internal/commerce/campaigns/drain` accepts a signed service request with
`environment` and an optional integer `limit` of 1–2. It rejects mismatched
environments and extra/duplicate/oversized input. The `*/3 * * * *` cron invokes
only this dispatcher. Each invocation first recovers uncertain jobs, then claims
queued work, and processes at most two recipients under the existing bounded
attempt policy. Two normal deliveries fit the 50-query D1 budget. The default
cron provides at most 40 attempts/hour; it is a conservative TEST cadence, not
a production throughput target. Capacity/rate-limit planning and monitored
operator or queue-driven execution remain required before activation.

## Remaining acceptance and product work

Campaign-specific provider lookup and operator recovery, automation triggers,
useful performance reports, operational
load/alerting and authenticated hosted workflows remain necessary. Provider
acceptance must verify real mailbox receipt, sender authentication and DKIM
coverage of both unsubscribe headers. The current fixtures establish database,
transport and application behavior; no real campaign mail has been sent by this
rollout and no top-level completion gate is closed.

## Sender validation

All **292 Worker tests** pass on the completed sender change, including **39
new campaign-delivery checks**. The three affected PHP publication-proxy checks,
syntax checks, whitespace checks and TEST dry-run build also pass. Coverage
includes exact retry bytes/tokens, response loss before and after database
commit, atomic rollback, early/duplicate/conflicting callbacks, fresh identity,
consent/role changes at preparation and start, cancellation during a batch,
provider identity conflicts and suppression across purposes, deadline/attempt
limits, reporting order, scoped publication reads and the per-invocation query
budget. The complete existing financial, shipping, inventory, notification,
customer, messaging and email-investigation suites remain green.

A fresh private TEST export (532,962 bytes; SHA-256
`0f9a762552bff8a875d315dbad42e4530f3f007a627556859a93a34d7d0d6fcc`)
restores in original order, passes integrity/foreign-key checks and preserves
every row across all 103 existing physical tables after migration 0036. The
migration adds 29 objects and changes exactly seven completion/email guards.
Thirteen current read/write SQL plans compile against the restored database
without writes. The five new tables remain empty in that rehearsal.

## Earlier renderer validation

Seven campaign unit cases cover activation holds, all existing delivery
boundaries, escaped rendering, owned links, one-click headers, exact retry
bytes, purpose/recipient/key isolation, duplicate/malformed payloads, byte
limits and uncertain outcomes. They also confirm maximum saved copy remains
sendable after escaping. All 45 affected Worker checks pass, including the
existing transactional dispatcher/provider and investigation regressions.
The final 11 campaign/provider checks pass after strict tag-type hardening;
the TEST dry-run bundle and syntax/diff checks pass.

The actual HTML is inspected at 1360 and 390 pixels, with JavaScript disabled,
keyboard access to the shop/unsubscribe links, no remote resources and no
horizontal overflow. The passing browser test also covers hostile-looking
copy, maximum unbroken Unicode body text and a campaign without a shop button.
These checks use isolated local browsers and fixture-only provider calls;
they issue no hosted campaign link or email.

## Earlier renderer TEST rollout

Implementation `ba6e0d2` is pushed to `agent/ezkart-workbench`. TEST Worker
`86a09912-b1fc-4a18-b08f-0c4cfc0f6560` is deployed. At 26 September 17:47 UTC,
all 25 deployed health/access/hold checks passed with 98 healthy application
tables, D1 and both R2 buckets. No migration was required or pending. The
deployment-time comparison preserves all table counts, schema, seller settings
and the 15-entry legacy import evidence, with no foreign-key errors. Both
unsubscribe tables remain empty and no provider configuration was activated.

The public page's complete CSP and `X-Frame-Options: DENY` were independently
confirmed on hosted GET/HEAD/POST responses at 17:41 UTC. Shared Chrome still
reports the same disconnected connection; no reconnect was attempted.
Authenticated hosted acceptance remains open while independent implementation
continues. Main, production and PR #3 remain held.

## Campaign sender TEST rollout

Implementation `dfa5ff9` is pushed on `agent/ezkart-workbench`. TEST migration
0036 and Worker `e531ff4d-0578-4784-aec9-16474a4d7ec1` are installed. At
26 September 18:49:28 UTC, all 31 deployed Worker health/auth/hold checks pass
with 107 healthy application tables, D1 and both R2 bindings. No migrations
remain pending. Remote schema exactly matches the restore rehearsal, all 13
read/write plans compile, and existing table counts, seller settings and the
15-entry import manifest are preserved with no foreign-key errors. All five
new campaign delivery tables are empty.

The configured TEST crons now include the dedicated campaign invocation.
Central commerce, transactional email and campaign sending remain held; no
provider setting, recipient, publication, token or email was activated or
created by these checks. The worker's new drain route respects that hold.

Both inspected hosted assets match their checked-in bytes, with a hosting
modification time of 18:49:12 UTC. Thirteen hosted access/header checks pass at
18:49:27 UTC, including protected publication routes and the unsubscribe
page's complete CSP, no-store/no-referrer, frame denial and read-only HEAD.
No frontend asset changed in this sender stage. These anonymous checks do not
replace signed-in merchant/customer acceptance. Shared Chrome still reports its
previous disconnected timeout; no reconnect was attempted. Provider/mailbox
acceptance, recovery UI, sustained operation and all other readiness gates remain
open. Main, production and PR #3 are unchanged.
