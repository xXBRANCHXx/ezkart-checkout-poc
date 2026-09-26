# Campaign email investigation and recovery

Operators can investigate an uncertain campaign submission, verify a provider
record and resolve a proven submission without sending another email. This uses
the same guarded provider reader and recovery engine as transactional email,
with separate campaign records and request identities. Publication, consent,
unsubscribe tokens, original messages, attempts and callbacks remain immutable.

## Evidence and resolution

Each lookup retrieves one provider ID through the fixed Resend GET adapter. It
matches the saved sender, exact single recipient, subject, all four tags
(including campaign purpose), profile, environment and submission time bounds.
It rejects extra recipients, reply targets and provider scheduling. Candidate
IDs supplied by an operator are untrusted until this response is verified.
Merchant/customer input cannot supply accepted provider evidence.

The [Resend retrieval response](https://resend.com/docs/api-reference/emails/retrieve-email)
provides creation time, tags and latest event. The adapter records when that
status was observed; it does not invent a delivery timestamp. A later matching
signed callback can supply the actual event time. Open/click observations only
confirm provider acceptance in Ezkart's status model, never a human read.

A missing record, rejected request, timeout, invalid response or identity
mismatch leaves delivery unresolved. The original send bytes, unsubscribe link
and idempotency key remain intact. A callback racing with lookup must preserve
the first verified provider identity; a conflicting lookup response is retained
as private evidence and cannot resolve the job. Provider IDs cannot bind across
campaign and transactional requests. Bounce, complaint and suppression evidence
from either purpose prevents later sends to that address in the same environment.

Resolution requires a matched lookup observed within five minutes, the current
job revision, and an eligible uncertain/retry job or recognized exhausted job.
A receipt captures the previous state, result, error and update time and marks
only the submission job successful. Active jobs, unknown dead failures and
identity conflicts cannot be force-cleared. Original attempts and uncertain
skip receipts remain unchanged. A verified lookup also stops a queued automatic
retry from issuing another POST, including a lookup that wins during the final
identity check.

Withdrawal or cancellation after an unknown submission does not erase that
submission's evidence. Operators may investigate it with sending disabled and
without an Auth lookup or renewed promotional consent. Resolution changes no
permission or cancellation. The merchant sees the actual outcome, status-check
time and review-confirmation time; an earlier unknown skip no longer claims an
unresolved job after a valid resolution. Delivery totals retain earlier confirmed
delivery even after a later bounce or complaint.

## Service API and command

These routes require the existing signed service authentication, exact
environment binding, strict JSON and a 3 KB write limit:

| Route | Input |
| --- | --- |
| `GET /internal/commerce/campaigns/investigations` | `environment`, optional `state=all` and returned `cursor` |
| `GET /internal/commerce/campaigns/investigations/{campmail_id}` | `environment`, optional history `cursor` |
| `POST /internal/commerce/campaigns/lookup` | `{environment,requestId,providerId,lookupKey,operator}` |
| `POST /internal/commerce/campaigns/resolve` | `{environment,requestId,lookupKey,resolutionKey,expectedUpdatedAt,operator}` |

List/history pages contain twenty records, preserve their initial row boundary
and bind cursors to purpose, environment, request and filter. Responses omit
recipient addresses, raw provider responses, rendered mail, unsubscribe links
and credentials. The operator value is an audit reference asserted by the
trusted signing service, not independent user authentication.

Use the existing TEST-only command with `--purpose=campaign`:

```sh
php tools/commerce/email-investigate.php --action=list --purpose=campaign
php tools/commerce/email-investigate.php --action=view --purpose=campaign \
  --request=campmail_REQUEST_ID
php tools/commerce/email-investigate.php --action=lookup --purpose=campaign \
  --request=campmail_REQUEST_ID --provider=PROVIDER_UUID --operator=OPERATOR_ID \
  --intent=/private/directory/campaign-lookup.json
php tools/commerce/email-investigate.php --action=retry \
  --intent=/private/directory/campaign-lookup.json
```

Replace placeholders with exact returned references. The command writes and
flushes its original purpose, arguments, connection fingerprint and random key
to an exclusively created mode-0600 file in an existing mode-0700 directory
outside the repository/web root. Preserve that file after interruption. Retry
uses its stored purpose; a command-line purpose override is rejected. Existing
files, symlinks, public directories and production connections are rejected.
No provider or service key is accepted on the command line.
Returned mutation receipts must match the original lookup or resolution
references before the command reports confirmation. A mismatched acknowledgement
leaves the preserved file available for an exact retry.

After a matched lookup, refresh `view` and use its exact job `updatedAt`:

```sh
php tools/commerce/email-investigate.php --action=resolve --purpose=campaign \
  --request=campmail_REQUEST_ID --lookup=LOOKUP_KEY --updated-at=EXACT_UPDATED_AT \
  --operator=OPERATOR_ID --intent=/private/directory/campaign-resolution.json
```

Omitting purpose retains the existing transactional behavior. The command's
HTTP response remains an empty 404. Exact receipt retries survive configuration
holds; an unfinished provider read requires the original send and reader
connection identities. New lookups require `COMMERCE_EMAIL_RECONCILE=enabled`
and the existing central-commerce/provider prerequisites. Neither sending flag
is needed for investigation. No flag or credential is activated by this rollout.

## Storage and acceptance

Migration `0037_campaign_email_investigation.sql` adds immutable campaign lookup
intents, results, verified bindings and resolution receipts: four tables,
two indexes, two evidence views and fourteen triggers. It changes three shared
or campaign views and four guards to include verified recovery evidence and
prevent repeat submission. Both purposes share sixty new lookup intents per
minute; each request additionally allows three per minute and 250 per day.
Exact replays remain available at the limit. These limits are operator controls,
not production delivery-capacity acceptance.

Tests exercise real signed Worker routes, shared transactional behavior,
withdrawal/cancellation recovery, purpose and provider conflicts, callback and
retry races, interrupted responses, strict scope/authentication, held or changed
connections, forged/immutable evidence, stale resolutions, paging, suppression,
populated migration and the actual PHP command/merchant UI at desktop and phone
widths. All provider responses are isolated fixtures. Actual provider/domain
acceptance, signed-in hosted acceptance, monitoring, retention and sustained
capacity/recovery exercises remain open with automation and performance reporting.
No completion or production release gate is closed.

Release validation passes all **316 Worker tests**, including **21 campaign
investigation checks**. The combined PHP/browser run passes **18 checks**;
the final command/recovery run passes **five checks**, including mismatched
acknowledgements for lookup and resolution. Desktop/390-pixel screenshots and
keyboard focus were inspected. JavaScript/PHP syntax, diff checks and the TEST
Worker dry-run pass.

The fresh private TEST backup is 555,793 bytes, with SHA-256
`1a67cba15a9b05504b5c4cd7ed13f84d0888c6396d014adf2d50df27f38f5eff`.
Original-order restoration preserves every row in all 108 existing physical
tables, passes integrity and foreign-key checks, adds exactly 22 schema objects
and changes the seven intended views/guards. All four new recovery tables are
empty. All 18 current read/write plans compile against that restoration without
mutation. Private rollout evidence is under
`/tmp/ezkart-campaign-investigation-deploy-01a0d643/`.

## TEST rollout

Implementation `29f9cd6` is pushed to workbench and auto-deployed by Hostinger.
TEST migration 0037 and Worker `35624928-addf-449c-a079-70999bbb560e` are installed,
with no pending migration. At **26 September 19:49 UTC / 27 September 02:49 WIB**,
all 35 Worker health/access/hold checks passed, reporting 111 healthy application
tables, D1 and both R2 buckets. At **19:50 UTC**, all five inspected hosted asset
hashes matched source and all 14 access/header checks passed, including the
operator command's empty HTTP 404.

The remote schema matches the original-order restoration exactly. Existing
table counts, seller settings and the 15-entry legacy import manifest remain
unchanged; foreign-key checks are empty and all four new recovery tables are
empty. All 18 actual read/write plans compile remotely without mutation. The
same preservation checks pass after hosted verification. No hosted campaign,
provider lookup, resolution, unsubscribe token or outbound message was created.

Provider sending, investigation and central-commerce flags remain held. Shared
Chrome's latest status still showed the prior disconnected connection; no new
reconnect was attempted. Authenticated hosted/provider acceptance and the
site-wide CSP gap remain open. Main, production and the production PR are
unchanged.
