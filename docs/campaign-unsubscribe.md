# Campaign unsubscribe

The public unsubscribe flow records a promotional-email withdrawal in the same
permission state and revision history used by buyer preferences and merchant
audience previews. It works without sign-in and while commerce/sending is held.
It does not change transactional notification choices, send mail, or activate a
provider. Campaign publication, scheduling, send-time eligibility checks,
automation, delivery evidence and reporting remain required work.

## Recipient and mail-system behavior

The recipient URL is `/cart/unsubscribe.php?t=` followed by an unpredictable
256-bit token. A GET or HEAD only reads the current choice. The page shows the
store and a masked address, and provides a native confirmation form; it does
not use JavaScript, start a session, load external resources or require login.
A POST containing `List-Unsubscribe=One-Click` records the withdrawal and returns
a result directly, with no redirect or account-context dependency. A lost
acknowledgement leaves the same link available for retry.

The protocol follows the request model in [RFC 8058](https://www.rfc-editor.org/info/rfc8058/):
the campaign message renderer carries an HTTPS `List-Unsubscribe` URL and
`List-Unsubscribe-Post: List-Unsubscribe=One-Click`. The mail provider must apply
a valid DKIM signature covering both headers. The [renderer/transport](campaign-delivery.md),
durable outbox and actual mailbox/provider interoperability still need to be connected and accepted with
the campaign sender; this endpoint alone does not establish delivered one-click
support. A scanner GET cannot withdraw permission.

The Worker accepts URL-encoded or multipart form bodies, with an 8 KiB streaming
limit and exactly one known directive. The public PHP page forwards the original
URL-encoded body for strict validation. For multipart, PHP has already parsed
the body: the page requires a bounded `Content-Length`, no uploaded files and
only the known directive, then forwards its canonical equivalent. A multipart
request without a length returns 411. Tokens and their scope never come from
normalized form fields, cookies, authorization headers or an active-store
selector. The page returns `no-store`, `no-referrer` and a restrictive per-page
CSP; delivered hosting headers must also be verified.

## Authority and durable history

Migration `0034_campaign_unsubscribe.sql` adds:

- `commerce_unsubscribe_tokens`: token hashes tied to one store, environment,
  account, email, message reference and consent revision at issuance. Only
  current granted permission at an active store permits insertion. There is no
  merchant/public API for minting links, and raw tokens are not stored here.
- `commerce_unsubscribe_changes`: immutable, token-authorized withdrawal
  receipts with the expected/current revision, original statement and time.
  Receipt insertion updates the shared consent projection atomically. It can
  only set permission to withdrawn.
- `commerce_customer_consent_history`: a combined view of existing account
  choices and email-link withdrawals, preserving the original records and
  their `buyer_preferences` or `email_unsubscribe` source. Buyer history labels
  the latter “From an unsubscribe link”.

The four updated consent triggers continue to require matching receipt proof
and the next revision. They also prevent `INSERT OR REPLACE` from resetting a
projection or replacing an old account-choice receipt under its original
request key. Current account choices and public withdrawals share the same
revision sequence. A stale account save must reload; replaying an old grant
receipt cannot restore withdrawn permission.

Concurrent/repeated POSTs while already withdrawn return success without
another receipt. After a new explicit opt-in, an old email link remains usable:
a subsequent POST records a new withdrawal against that newer revision. Links
are target capabilities, not historical request keys. This favors stopping
promotions when another unsubscribe request arrives. No public operation can
grant permission or move the link to a different store, account, environment
or address.

Existing links continue to work for an inactive store, after the account's
verified address changes, and while commerce/email flags are held. The
deployment pins their environment; selecting a different Executive test mode
does not redirect a withdrawal. The old address's permission changes, without
affecting a new address or another store. Anyone holding an original email link
can exercise its opt-out capability; the public response exposes no full email,
account ID, order, token hash or private campaign information.

## Integration contract for campaign delivery

`prepareCampaignUnsubscribe` generates a fresh URL and a prepared D1 insertion
statement. The sender must batch that statement atomically with the immutable
recipient message containing the URL. If the batch fails, neither is committed.
An existing outbox/message reference must recover its originally stored message
and link rather than regenerate a different email under a provider retry key.
Issuance fails if permission changed before the write.

The helper itself is not proof of current email ownership or send authorization.
The complete sender must independently verify the account address, current
store/address-specific permission and global suppression immediately before
submission. It must preserve its original provider payload, request reference
and receipt through retries. These integration requirements remain open; no real
links or campaign messages were issued by the fixture or deployment checks.

## Verification

`cloudflare/ezkart-api/test/campaign-unsubscribe.test.mjs` exercises read-only
GET/HEAD, both form encodings, malformed/duplicate/extra fields, oversized
streams, concurrent/repeated withdrawals, forged scope, ignored account context,
cross-environment denial, inactive stores, sending holds, later grants, mixed
history pagination, atomic message/token rollback, immutable receipt/projection
replacement guards and preservation of populated pre-0034 permission records.

`tools/checkout-test/campaign-unsubscribe.test.mjs` runs the actual PHP/Worker
flow on desktop/mobile with JavaScript disabled. It covers keyboard confirmation,
escaped store names, masked addresses, no sessions/external resources, mail-style
POSTs without redirects, interrupted acknowledgements, invalid requests,
commerce holds and verified buyer history. Existing consent, Marketing, email
and signing regressions remain part of release validation. Fixture evidence
does not replace provider or authenticated hosted acceptance.

The local release run reports all 234 Worker tests passing and all 26 affected
PHP/browser/signing checks passing. The full Worker runner was terminated after
its completed pass summary; all 16 focused unsubscribe/consent tests pass again
with a clean process exit. PHP/JavaScript syntax, `git diff --check` and the TEST
Worker dry run pass. Desktop/mobile confirmation and result layouts were
visually inspected.

Before migration 0034, a fresh private TEST D1 export was restored in original
statement order and the migration applied locally. All rows in the 97 existing
physical tables remain unchanged, `integrity_check` returns `ok`, and there are
no foreign-key errors. The export is 512,352 bytes with SHA-256
`74da04c177ad40495225d9e0cd4c8e0add7936abd56f49233773aec6a853f46c`.
The remote rollout must match the rehearsed 11 added schema objects and four
modified guards and preserve the existing operational/import evidence.

## TEST rollout

Implementation `dd3e536` is pushed to workbench. TEST migration 0034 and Worker
`57ac5996-28dc-41b1-9fa1-7eac9db74080` are installed, with 98 healthy application
tables and no pending migrations. At 26 September 17:33 UTC, all 25 deployed
health/access/hold checks passed. All old table counts, seller settings and the
15-entry legacy import manifest remain unchanged; both added tables are empty.
All 15 added/modified schema objects match the restoration exactly, foreign-key
checks are empty, and the actual history/read/write-plan queries compile.

At 17:35 UTC, both hosted asset hashes matched, the five merchant/private guards
passed, and public unknown-link GET/HEAD/POST requests returned 404 with
`no-store`, `no-referrer`, no session and no redirect. The hosting layer replaced
PHP's CSP with its global `upgrade-insecure-requests` value. A page-specific
`cart/.htaccess` response policy and `X-Frame-Options: DENY` address that conflict.
At 17:38 UTC, GET/HEAD/POST returned the full restrictive CSP after correction
`e06b046` deployed, while all previous asset and access checks still passed.
Authenticated hosted workflows
and real recipient/provider acceptance remain open. No campaign token, message
or provider request was created during the rollout.
