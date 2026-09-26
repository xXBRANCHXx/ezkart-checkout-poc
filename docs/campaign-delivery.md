# Campaign delivery integration

The public [unsubscribe flow](campaign-unsubscribe.md), message renderer and
strict Resend transport are implemented. [Durable publication](campaign-publication.md)
now freezes the audience and creates recipient jobs with versioned scheduling
and cancellation. Per-recipient immutable messages, current-permission dispatch,
campaign callbacks/recovery, automation and performance reporting still need
integration. No campaign route or cron invokes the new transport, and the
Marketing workspace still reports delivery unavailable. This is preparatory
code for the full marketing gate, not an activated sender.

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

## Remaining durable sender work

Publication now preserves the authorized merchant request, expected campaign
revision, content, audience selection, schedule and store/environment scope.
Original retries recover the same publication; later draft edits cannot rewrite
it. The recipient jobs still need the full preparation/dispatch integration.

Recipient preparation must use authoritative customer ownership and the
store/account/address-specific promotional grant. It must atomically save each
immutable recipient message with its unsubscribe token statement. A failed
transaction cannot leave an issued link without its message; an existing
recipient reference must recover its stored link and payload. Preparation must
be resumable and bounded, with duplicate recipient protection and honest counts.

Dispatch must independently verify the current Auth address, permission,
suppression, store/publisher access, active lease, schedule and cancellation
state immediately before submission. An address captured at checkout or a
successful rendering is not authorization. Campaign bounce/complaint evidence
must participate in the shared suppression state used by all email purposes.

Submission starts, provider bindings and signed callbacks need durable,
immutable correlation. A lost acknowledgement must retain the original bytes
and key; expired retry windows, changed credentials or withdrawn permission
after an earlier start must remain visibly uncertain until evidence resolves
them. Cancellation cannot claim to recall an already-submitted email. Merchant
history must distinguish queued, skipped, uncertain, submitted, delivered and
failed states, and performance must use actual evidence. Provider acceptance,
authenticated hosted workflows and operational load/recovery remain required.

## Verification

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

## TEST rollout

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
