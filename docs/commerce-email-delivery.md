# Transactional email on workbench

Merchant notification preferences now feed a durable email dispatcher. Private
notification screens show queued, submitted, delayed, delivered, bounced,
complained, blocked, skipped and review states. **Your emails** includes alerts
whose in-app channel was disabled. **Store delivery activity** shows processing
and failures without exposing addresses or provider payloads to other members.

This implementation uses Resend. It is **not connected or activated** in TEST.
No real email has been sent during implementation or validation. The provider
choice remains subject to the owner's existing account/preference. Buyer email
preferences and delivery, campaign consent/unsubscribe, real mailbox acceptance,
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
Operators must investigate dead/uncertain records with the saved provider ID,
profile, request key and event evidence. There is intentionally no browser
button that resets uncertain submissions or bypasses address suppression.

**Needs attention** includes failed attempts, bounce/complaint/provider failures,
delays, jobs waiting more than fifteen minutes past their scheduled attempt,
and submissions without a final delivery event for fifteen minutes. These are
visible checks, not an active external alerting service. Provider-side lookup
and operator resolution workflows, notification retention, production rate/load
limits and external alerting still require acceptance.

## Configuration and operating limits

No credentials belong in tracked files. Sending requires all of:

- `APP_ENVIRONMENT=test` or `production`, with `COMMERCE_STORAGE=d1`.
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
Buyer recipients remain in-app only pending their preference/delivery workflow;
transactional settings do not grant permission for promotional campaigns.

## Validation and rollout

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

Migration comparison, Worker version and hosted checks are recorded after
rollout. Authenticated hosted acceptance and real-provider delivery remain
separate from these fixture checks.
