# Buyer and seller messaging

Workbench implementation, 26 September 2026. This replaces the sample merchant
inbox and simulated buttons with the same persistent conversation viewed by the
buyer and the store. Production remains held.

## Workflows

- Buyers enter from a public store, a published product, an owned order, or their
  inbox at `/cart/messages.php`. Google sign-in preserves that context. Opening
  an order claims it only with the server-verified customer identity; its permanent
  owner remains authoritative after email changes.
- A store starts a conversation from an order detail or by entering the reference
  of an order whose buyer has signed in. It
  cannot choose an arbitrary recipient email or buyer ID. Existing conversations
  remain usable when a product is archived. New product context must still be public.
- Text messages, up to four private photos, order/product context, unread filters,
  text search, older messages and conversation paging are real stored operations.
  The desktop list/detail layout becomes separate list/detail views on phones.
- Store staff resolve, reopen or block a conversation. A new message reopens a
  resolved conversation. A blocked conversation must be reopened before either
  side can send. State changes use the current revision, so an intervening reply
  makes an old decision fail visibly.
- Stores create, edit, insert and archive up to 100 active saved replies. Inserting
  a reply only changes the draft. It never sends automatically.

## Authorization and persistence

Migration `0026_commerce_messages.sql` adds seven tables: conversations, immutable
message/state events, private media, immutable media links, read positions, saved
replies and immutable saved-reply changes. Migration 0027 adds buyer-inbox,
store-reply and upload-rate indexes. A conversation is permanently bound to
one store, buyer auth ID and commerce environment. The database checks current
membership and public/order context when creating it, and checks live participant,
store status, role, revision and attachment ownership on writes.

Owner, admin and editor roles may write; viewers may read and mark messages read.
Buyers retain read-only access to their own transcript when a store closes.
Each staff member has a separate unread position. Buyer and store read receipts
refer only to rendered message IDs and move monotonically. Removed memberships
are not restored by the account initialization endpoint. Messaging authorization
does not invoke account/store provisioning.

The Worker exposes corresponding `/v1/customer/messages` and
`/v1/commerce/messages` routes. Conversation IDs have a `conv_` prefix; detail,
send/state, read and media routes stay underneath that conversation. Store-only
`stats` and `replies` routes do not expose cross-store data. PHP proxies validate
session/account, CSRF, active-store expectation, method and bounded query/body
data. They recheck the session after the upstream response. Customer requests
also verify the current Google identity and MFA state. A changed account clears
private browser content instead of displaying a late response.

Sending uses a request key scoped to the actor and environment. The original
payload hash and receipt are immutable. An identical retry returns the original
event; changed content under the same key fails. Concurrent independent sends
append independently. Saved-reply edits add revision conflict protection.
Browser drafts, upload intentions and unresolved writes retain their request
keys in session storage across reloads. Uncertain requests lock editing and
offer confirmation of the original request. Storage failures prevent an untracked
send. The browser never claims success before the durable receipt arrives.

Message JSON rejects duplicate keys, excessive nesting, invalid UTF-8, oversized
bodies and unknown identity overrides. Messages are plain text, up to 4,000
characters. Database guards bound activity to 40 events per actor per minute,
2,000 per day, 30 new store conversations per buyer per hour and 60 photo uploads
per actor per hour.

## Photos and reads

JPEG, PNG and WebP photos use the existing bounded still-image parser: at most
1 MB each and 4,096 pixels on either axis. Metadata is stripped; animated or
non-raster containers are rejected. Uploads use private R2 keys and preserve an
uploading/ready/deleting lifecycle. Unsaved uploads expire after 24 hours.

Only the uploader can read an unlinked photo. After a message commits, the other
participant may read its linked photos. Every read checks conversation access
before and after R2 retrieval. Responses use no-store, nosniff and a restrictive
CSP; no public media URL is issued. The scheduled cleanup deletes only unlinked
expired uploads and retains a tombstone for 48 hours to handle late uploads.
Sending and linking occur in one database operation, so failed uploads do not
produce apparently successful photo messages.

Message history and inbox cursors retain an upper event boundary. New replies
do not move an already-loaded conversation between pages. Inbox snapshots also
cap conversation creation time; cursors are bound to actor, store, environment
and filters. Read-state filters reflect the current reader's position.

## Statistics and delivery limits

Statistics count stored conversations and messages. Needs response means an open
conversation whose last message came from the buyer. Resolved today counts
currently resolved conversations whose last state change happened today in
Jakarta. Median first response measures elapsed wall-clock seconds between the
first buyer message and the first following merchant message, for first replies
sent in the last 30 days. No observations displays a dash.

Visible pages poll for updates every 20 seconds and offer manual refresh. The
UI makes no online-presence or instant-delivery claim. This stage provides inbox
delivery only. Personal notification preferences are now saved in
[Settings](merchant-settings.md). Email/WhatsApp delivery, durable transactional
notification dispatch and delivery failures remain part of the notification gate.
No external message is sent by these tests or this rollout.

## Validation and rollout

The full Worker suite passes 157 tests. The affected checkout, customer auth,
merchant/public review and central checkout regression run passes 100 tests.
The final messaging and order-manager browser run passes another 10 tests.
All seven messaging browser checks pass. Messaging checks exercise both actual browser interfaces at 1,360 and 390 pixels,
photos, saved replies, state changes, read positions, lost acknowledgements,
reload recovery, stale revisions, history retry, session changes, tenant isolation,
role revocation, storage holds and public entry links. Screenshots live under
`/tmp/ezkart-messages-ui-01a0d643/` for this run.

A fresh TEST export, `/tmp/ezkart-messages-deploy-01a0d643/test-before-0026.sql`,
contains 431,951 bytes with SHA-256
`15b433e8b8608f1552bacbb43c60071cd40b4ed1c2c53d54ef76a4c7a6bdce1a`.
Restoring it and applying the final migration in original file order preserves
all existing counts, passes integrity/foreign-key checks, and creates seven
empty tables with 22 guards. The same restoration also passes with the index
migration. TEST migrations 0026 and 0027 are applied. Worker
`db122a29-7784-4385-b303-889032fa57b9` is deployed; the hourly `17 * * * *`
maintenance schedule is unchanged. At 12:33 UTC / 19:33 Jakarta, health reports
77 tables and healthy D1/public R2/private R2. All seven message tables are empty.
Existing operational, wallet, financial and provider-evidence counts and the
legacy-import manifest are unchanged. Both message APIs reject unauthenticated
requests, and the signed-commerce surface remains disabled with a 503 hold.
Storage/provider flags remain held. Authenticated hosted acceptance and ongoing
operation remain unverified while that hold is in force; fixture success does not
close the messaging completion gate on its own.


Implementation `5bb7d8d` is pushed to `agent/ezkart-workbench`. Hostinger's
normal auto-deployment published the message JS/CSS, order-entry script and shop
script; all four hosted bytes match the workbench commit. The customer message
page returns the sign-in gate with no-store, its private proxy returns 401 with
no-store without a session, and the two include-only PHP files return empty 404
responses. Hosted evidence is in `hosted-recheck.json` and `hosted-guards.json`
under the deployment artifact directory above. No manual Hostinger deployment,
production deployment, real message, provider call or activation was performed.
