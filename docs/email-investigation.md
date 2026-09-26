# Email investigation and recovery

Operators can inspect saved notification submissions, retrieve a specific email
from Resend and resolve a confirmed submission without sending another email.
Merchants and buyers see the resulting delivery status and when it was checked.
The original requests, send attempts, callbacks and uncertain skip decisions
remain intact. This implementation does not activate any provider or send mail.

## Provider evidence

The adapter uses only `GET https://api.resend.com/emails/{id}`. For a known email,
the saved provider ID is mandatory. If the send acknowledgement and callback
were both lost, an operator may supply a candidate ID obtained from provider
logs. A candidate is not proof: the Worker fetches it itself and checks the
provider object/ID, sender, exact single recipient, subject, all three Ezkart
tags, environment/profile and creation time against the durable send starts.
Unexpected copy recipients, reply targets and scheduled delivery are rejected.
No browser or command-line input can supply an accepted provider response.

The [Resend retrieval contract](https://resend.com/docs/api-reference/emails/retrieve-email)
returns the email creation time and its latest event. It does not provide that
event's timestamp. Ezkart records the observation time without inventing a
delivery timestamp. A later signed callback can supply the actual event time.
Opened/clicked observations only confirm provider acceptance; Ezkart does not
claim a person read the email. Unknown provider states remain unverified.

Lookups use a fixed provider origin, an unfollowed redirect policy, a 15-second
timeout, bounded responses, strict UTF-8 and duplicate-key rejection. The saved
send credential identity must match the current connection. An optional separate
reader key is hashed into the lookup intent. Switching either connection before
an unfinished lookup completes requires investigation under the correct original
connection, rather than silently reading a different provider account.

Migration 0032 adds immutable lookup intents/results, verified lookup bindings
and resolution receipts. Raw provider responses remain private. Two evidence
views combine original callbacks/submission receipts with verified lookup
results. Existing records are not rewritten. Conflicting IDs cannot bind to one
request, nor can one provider email bind to two requests. A callback that races
with a lookup must agree with its identity; conflicting results remain evidence
for review. Bounce/complaint/suppression observations prevent later sends to the
address, including sends from another store in the same environment.

A 404, timeout, permission error, invalid response or mismatch never proves that
an email was not sent. These outcomes neither reset the send key nor create a
new send job. Existing automatic send retries retain their original exact bytes,
idempotency key and 23-hour boundary. There is no unbounded provider scan or
automatic reconstruction of a missing provider ID.

## Operator workflow

The signed service API provides:

- `GET /internal/commerce/email/investigations?environment=sandbox`
  with optional `state=all` and a returned cursor.
- `GET /internal/commerce/email/investigations/{requestId}?environment=sandbox`
  with optional history cursor.
- `POST /internal/commerce/email/lookup` with
  `{environment,requestId,providerId,lookupKey,operator}`.
- `POST /internal/commerce/email/resolve` with
  `{environment,requestId,lookupKey,resolutionKey,expectedUpdatedAt,operator}`.

HMAC authentication binds method, exact path/query, body and deployment. Strict
JSON/body limits apply. Merchant/customer tokens do not authorize these actions.
The `operator` field is an audit reference asserted by the trusted signing
service, not a separate user-authentication mechanism. Lists/history page twenty
records with a stable cursor. Responses omit addresses, email bodies, provider
secrets and raw provider payloads.

Every lookup first saves its exact intent. Identical retries return the original
durable result; a new lookup key is required for a deliberately fresh observation.
An interrupted GET may repeat safely with its original intent. Conflicting key
reuse fails. Database-enforced limits allow three new intents per request/minute,
250 per request/day and sixty new intents per minute in the database. These are
operator limits, not a claim about production notification throughput.

Resolution requires a matching lookup observed within five minutes and the
current job revision. It closes an uncertain/retry submission, or an exhausted
submission with a recognized recoverable failure/uncertain skip. Active jobs,
unknown historical dead failures and provider identity conflicts stay under
review. A receipt captures the previous state/result/error and atomically marks
the submission job successful. It does not change a finished attempt or override
a bounce, complaint or failed-delivery state. A concurrent edit rejects a stale
resolution; identical retries recover the same receipt.

The TEST-only command uses the configured PHP commerce client:

```sh
php tools/commerce/email-investigate.php --action=list
php tools/commerce/email-investigate.php --action=view --request=email_REQUEST_ID
php tools/commerce/email-investigate.php --action=lookup \
  --request=email_REQUEST_ID --provider=PROVIDER_UUID --operator=OPERATOR_ID \
  --intent=/private/directory/lookup.json
php tools/commerce/email-investigate.php --action=retry \
  --intent=/private/directory/lookup.json
```

Replace placeholders with the exact returned references. Before a new lookup or
resolution, choose an unused intent path in an existing mode-0700 directory
outside the repository/web root. The command exclusively creates and flushes a
mode-0600 intent before calling the Worker. Preserve it after interruption;
`retry` reuses its key and checks the original TEST connection fingerprint.
Existing files, symlinks, public directories and production configuration are
rejected. No signing or provider key is accepted on the command line.

After a matched lookup, reload `view` and use its `request.updatedAt`:

```sh
php tools/commerce/email-investigate.php --action=resolve \
  --request=email_REQUEST_ID --lookup=LOOKUP_KEY --updated-at=EXACT_UPDATED_AT \
  --operator=OPERATOR_ID --intent=/private/directory/resolution.json
```

The exit status is zero for a confirmed command result, two for a completed
lookup without matching proof, or one for an error/interruption. The result is
printed as JSON; its authoritative copy and all prior evidence remain in D1.
The command is unavailable through HTTP. It never enables sending, removes
suppression, changes an email address or creates another submission.

## Configuration and acceptance

Provider investigation requires `COMMERCE_EMAIL_RECONCILE=enabled`, central D1
commerce, the configured Resend provider/profile/sender, original send key and
the same Supabase origin used in the saved credential identity. It can operate
with `COMMERCE_EMAIL_SEND` off and does not need an Auth admin lookup, new
recipient consent or an email send. This rollout leaves investigation and
sending unconfigured/held in TEST.

Optional secret `RESEND_READ_API_KEY` must belong to the same provider account
and permit retrieval. Otherwise the original send key is used. Resend documents
that a sending-only key cannot retrieve resources; a separately managed reader
credential may need broader provider permissions, while this adapter still
issues only the fixed GET. See
[Resend API key permissions](https://resend.com/docs/api-reference/api-keys/create-api-key).
No key, permission, account, DNS or provider activation was changed by this work.

Validation covers real Worker routes and PHP command signing, lost lookup and
resolution acknowledgements, concurrent readers, callback identity races,
404/rejected/malformed provider responses, stale/forged actions, immutable
evidence, suppression, stable paging, migration with existing email records and
desktop/390-pixel history. All Auth/provider responses are isolated fixtures.
Actual approved provider lookup, hosted signed-in acceptance, external alerting,
retention and sustained operational load remain required. All completion and
production release gates remain in force.

Verification passed: all 217 Worker tests, twelve focused recovery tests, 36
email/notification regression checks and nineteen affected PHP/browser/signing
checks. PHP/JavaScript syntax, TEST Worker dry run and `git diff --check` pass.
The recovered desktop/390-pixel screenshots were visually inspected under
`/tmp/ezkart-email-recovery-ui-01a0d643/`. Logs use
`/tmp/ezkart-email-recovery-*-01a0d643.log`.

The fresh 491356-byte TEST backup has SHA-256
`9b12fddd92246be0a72db7293f994313e11b03bbc1fe30e1ad88e26cbd12924e`.
Original-order restoration with migration 0032 passes integrity/foreign keys
and preserves every row in all 91 existing physical tables. The migration adds
22 application objects, including four empty tables, and replaces four intended
email guards. Private rollout evidence is under
`/tmp/ezkart-email-recovery-deploy-01a0d643/`.

Implementation `3dd870b` is pushed to `agent/ezkart-workbench` and auto-deployed
by Hostinger. TEST migration 0032 and Worker
`47fb4139-1234-4911-9f64-9c7b5de31bc7` are installed; no migrations remain pending.
Health at 26 September 2026, 16:10:32 UTC reports 94 application tables and
healthy D1/public-R2/private-R2 bindings. Remote schema matches the local restore
exactly. Existing table counts, seller settings, financial/provider records and
the 15-entry legacy import manifest are unchanged; the four new tables are empty.

The hosted D1 status query and both send/lookup trigger plans compile successfully
with zero writes. Hosted Worker authentication and commerce/provider holds pass.
JavaScript/CSS assets match the pushed source (16:11:21 UTC). Guest sign-in,
private PHP route guards and the CLI script's empty HTTP 404 pass.

Shared Chrome still reports the original disconnected/approval-timeout state;
no new connection was attempted. Signed-in hosted acceptance remains open.
Hosted CSP still contains only `upgrade-insecure-requests`; that existing release
gate remains open. This deployment changes no provider credentials, sending or
investigation activation flags, production deployment or main branch.
