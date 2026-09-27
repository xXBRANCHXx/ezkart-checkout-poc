# Transactional email on workbench

Merchant and [buyer notification preferences](buyer-notification-preferences.md)
feed a durable email dispatcher. Private
notification screens show queued, submitted, delayed, delivered, bounced,
complained, blocked, skipped and review states. **Your emails** includes alerts
whose in-app channel was disabled. **Store delivery activity** shows processing
and failures without exposing addresses or provider payloads to other members.

This implementation uses Resend. It is **not connected or activated** in TEST.
No real email has been sent during implementation or validation. The provider
choice remains subject to the owner's existing account/preference. Guest identity/receipt coverage, campaign consent/unsubscribe, real mailbox acceptance,
operational alerts and sustained load testing remain open work. The release hold
and all gates in [the completion plan](commerce-completion-plan.md) still apply.

## Delivery contract

Migration `0030_commerce_email_delivery.sql` creates five private evidence tables:
requests, network starts, provider bindings, events and skip decisions. Each is
immutable. A recipient requesting email transactionally creates one
`notification.send` job. Existing recipients are not backfilled. The job cannot
complete successfully without a verified provider binding or a durable decision
that confirms no email submission started.

Before sending, the dispatcher checks current store access, personal preferences,
the activation cutoff, event age, resolved pending-payment reminders and message
read positions. It obtains the current confirmed address from Supabase Admin;
checkout contact addresses and profile metadata are not verification. Anonymous,
deleted, banned, unconfirmed and mismatched identities do not qualify. Each
retry verifies the account again. A changed address never redirects a saved
request to a different recipient.

The first request fixes the environment, sender, recipient, provider profile,
credential hash, template version, exact JSON bytes, payload hash and idempotency
key. The immutable send-start record requires a live lease, fresh identity check,
current permissions/preferences, no delivery binding and no suppression. A
lease needs at least twenty seconds remaining for a fifteen-second send timeout.
Redirects are left unfollowed and rejected; credentials are sent only to the
configured Auth origin or the fixed Resend API origin.

Retries use the same bytes and `ezkart_email/{environment}/{recipientId}` key.
Resend's idempotency lifetime is 24 hours; Ezkart stops automatic re-submission
after **23 hours from request creation**. A network failure is uncertain rather
than a confirmed rejection. Address/preference/provider changes after a send
started preserve that uncertainty and require review. Exhausted attempts and
expired retry windows never reset the key or create a replacement request.
See [Resend idempotency](https://resend.com/docs/dashboard/emails/idempotency-keys).

The API acknowledgement records acceptance by the sending service. A signed
`email.delivered` event records acceptance by the recipient's mail server;
neither proves inbox placement or reading. Late `sent` or `delivery_delayed`
events cannot erase delivery, bounce or complaint evidence. A complaint, bounce
or provider suppression prevents future sends to that address throughout the
same Ezkart environment, including another store. See
[Resend lifecycle events](https://resend.com/docs/webhooks/event-types).

Migration 0036 shares address suppression and provider-ID uniqueness with
[campaign delivery](campaign-delivery.md), including suppression evidence
obtained through the transactional investigation service.

## Callbacks and recovery

`POST /webhooks/commerce-email/resend/{profile}` verifies the exact raw body with
the configured Svix HMAC key, message ID and timestamp (five-minute tolerance).
Malformed UTF-8, duplicate JSON keys, oversized bodies, altered signatures and
wrong profile/environment bindings are rejected. The callback must match the
saved sender, single recipient, subject, delivery tag and provider identity.
Unrelated emails are acknowledged without persisting their personal data.

Identical callback retries are idempotent; conflicting evidence is rejected.
The first accepted API receipt or signed lifecycle callback binds one provider
email ID to the request atomically. A callback can arrive while the POST is
still pending and recover a lost POST acknowledgement without another send.
Conflicting API IDs remain visible for operator review. Callbacks continue to
work with sending disabled, provided their profile keys remain configured.
See [Resend signature verification](https://resend.com/docs/webhooks/verify-webhooks-requests)
and [Svix's raw verification contract](https://docs.svix.com/receiving/verifying-payloads/how-manual).

The dispatcher rechecks stored evidence after interrupted writes and before
retries. It never uses a merchant browser response as a delivery receipt.
Operators can use the [private investigation workflow](email-investigation.md)
to fetch provider evidence and resolve confirmed submissions. Original attempts
remain intact. There is no browser button that resets uncertain submissions or
bypasses address suppression.

**Needs attention** includes failed attempts, bounce/complaint/provider failures,
delays, jobs waiting more than fifteen minutes past their scheduled attempt,
and submissions without a final delivery event for fifteen minutes. These are
visible checks, not an active external alerting service. Provider-side lookup
and audited resolution are implemented separately; actual provider acceptance,
notification retention, production rate/load limits and external alerting remain.

## Configuration and operating limits

No credentials belong in tracked files. Sending requires all of:

- `APP_ENVIRONMENT=test`, `beta` or `production`, with `COMMERCE_STORAGE=d1`.
  Beta uses production provider credentials and workbench destinations.
- `COMMERCE_EMAIL_PROVIDER=resend` and `COMMERCE_EMAIL_SEND=enabled`.
- `COMMERCE_EMAIL_FROM`: a normalized sender address on the verified mail domain.
- `COMMERCE_EMAIL_PROFILE`: a stable provider-account/environment profile name.
- `COMMERCE_EMAIL_START_AT`: an ISO activation cutoff. Earlier source events
  are skipped; new requests for events older than 24 hours are also skipped.
- Secret `RESEND_API_KEY`, restricted to the intended sender account/domain.
- Secret `SUPABASE_SERVICE_ROLE_KEY` and the existing HTTPS `SUPABASE_URL`,
  for server-side retrieval of the current account identity.
- Secret `COMMERCE_EMAIL_WEBHOOKS`: JSON mapping a profile name to an array of
  one or two `whsec_…` signing keys. Up to four profiles permit retaining old
  callback bindings during rotation.
- In TEST, `COMMERCE_EMAIL_TEST_RECIPIENTS`: a JSON array of one to twenty
  explicitly approved, normalized addresses. The final adapter enforces it too.

Configure and verify the provider account, sender/DNS, webhook subscription and
approved TEST recipients before activating delivery. Provider activation is not
authorized by this implementation or the existing production release hold.
Changing the API key/sender/profile changes the saved credential identity;
uncertain requests under the earlier identity require investigation. Rotating
webhook signing keys does not change a send's identity.

TEST adds a separate `*/2 * * * *` cron, processing at most two emails per
invocation. Sending is a no-op when unconfigured. The existing source-dispatch
and housekeeping cron invocations stay separate. Signed service operators can
run `POST /internal/commerce/email/drain` with
`{"environment":"sandbox","limit":2}`; other fields and larger batches fail
before claiming jobs. Authentication and the central-commerce hold apply.
The conservative schedule is not a Shopee-scale throughput guarantee. The
two-email normal path is tested below the 50-query free D1 invocation limit.

Templates contain escaped text, private authenticated destinations, HTML and
plain-text alternatives, and a clear TEST label in both content and subject.
Message alerts do not copy conversation text or attachments into email. No
access token or private media URL is included. Email notifications default off.
Buyer email is opt-in through the account preference workflow. Transactional
settings do not grant permission for promotional campaigns.

## Validation and rollout

### Live beta configuration, 27 September 2026

Resend verified `beta-mail.ezkart.id` in its Tokyo region. Three isolated DNS
additions preserve all twelve original Hostinger records. Tracking and receiving
remain disabled. The sending key is restricted to this domain; the separate
same-account recovery key permits the existing read-only investigation adapter.
The subscribed callback is
`https://ezkart-api-beta.vincentbranch23.workers.dev/webhooks/commerce-email/resend/ezkart_beta_20260927`,
with sent, delivered, delayed, bounced, complained, failed and suppressed events.

Both provider keys, the webhook profile secret and Supabase server credential are
installed only on beta. No key is placed in PHP/browser settings or tracked files.
Worker version `cdcb7924-727f-4060-9693-ed430fdf019b` retains checkout,
transactional-send and campaign-send holds and the sole hourly housekeeping cron.
The real owner's confirmed identity lookup passes through the production adapter.
Investigation is configured independently of sending. A non-delivery diagnostic
with a valid signature returns `ignored`; an invalid signature returns 401.
Neither probe creates email evidence or proves real provider callback delivery.

At 09:04:46 UTC the owner-approved connection check was submitted once, using a
saved idempotency key and the restricted sending key. The recovery API returns
the original sender, recipient, subject and text with `last_event:delivered`.
Gmail's Inbox contains that exact message; Show original confirms SPF, DKIM and
DMARC pass and its message ID matches the provider callbacks. The actual sent
and delivered callbacks each received HTTP 200 with `ignored:true`, appropriate
for this standalone connection check without an application delivery tag.
Private send, provider, inbox, authentication and callback receipts are retained
under `beta-01a0d643` outside Git. No purchase or payment record was created.

This establishes one real sender/inbox delivery and signed callback transport.
Automatic transactional and campaign sending remain held. Actual transactional
jobs, email template rendering, failure/complaint handling, operational alerting,
dispatch scheduling and sustained acceptance remain open. The observations below
describe the original TEST rollout.

Tests cover the real Worker send handler and callback endpoint, raw signature
interoperability, lost POST/database acknowledgements, callbacks arriving first,
conflicting provider receipts, credential/address changes, preference/access
races, read suppression, cross-store address suppression, expired leases and
retry windows, proof-required completion, TEST allowlisting, private reads and
mobile layouts. Provider and Auth responses are isolated fixtures throughout.

Verification passed: the complete 198-test Worker run, followed by 26 final
email tests including the added malformed-request database case (199 distinct
Worker checks); 24 affected PHP/browser tests; four PHP and nine JavaScript syntax
checks; a TEST Worker dry run; and `git diff --check`. Logs are under
`/tmp/ezkart-email-{api-release,api-final,ui-release,build}-01a0d643.log`. Visually
inspected desktop/390-pixel history, failure activity and email templates are
under `/tmp/ezkart-email-ui-01a0d643/`.

A fresh 469087-byte TEST backup has SHA-256
`93184430ceecb06f7e93c3cadcfbb96cb3fa405071d79ac5699ea4eed4409675`.
It restores in original order with migration 0030: integrity is `ok`, foreign
keys pass, all 84 existing table counts and seller settings are unchanged, and
the five new email tables have zero rows. Private backup/comparison artifacts
are under `/tmp/ezkart-email-deploy-01a0d643/`.

Implementation `f42e759` is pushed to `agent/ezkart-workbench` and automatically
deployed by Hostinger. TEST migration 0030 and Worker
`c956c398-f296-405f-90a7-32af0a8958c2` are installed with all three documented
crons. Health at 26 September 2026, 15:08:00 UTC reports 88 application tables
and healthy D1/public-R2/private-R2 bindings. No migrations remain pending.

Before/after comparisons preserve all existing records, seller settings,
financial/provider records and the 15-entry legacy import manifest
`ba180208c85cea72b82323b7b917e0e3771b143d930f5220665fddffc62777c0`.
The 27 new application schema objects and ten automatic indexes match the local
restore rehearsal. All five new email tables remain empty. The central commerce
and provider holds remain in force.

Both hosted notification JavaScript/CSS assets match the pushed source
(26 September, 15:08:39 UTC). Private Worker reads require authentication;
service drains retain the central-commerce hold; unconfigured callbacks are
rejected. Hosted guest sign-in, private proxy and include-only guards pass with
no private inbox exposed. Hosted responses still provide only
`upgrade-insecure-requests` for CSP; the existing release gate remains open.

Shared Chrome remains disconnected with the same previous approval timeout;
no new connection was attempted. Signed-in hosted acceptance, actual approved
provider delivery, sender authentication, mailbox rendering and sustained
operational acceptance are still required. These are not established by the
isolated authenticated fixture tests.
