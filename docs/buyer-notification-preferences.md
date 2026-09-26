# Buyer notification preferences

Buyers can open **Notifications → Preferences** to choose in-app and email
updates for confirmed payments, pending-payment reminders, failed/expired
checkout, shipping, returns and store messages. Choices belong to the signed-in
buyer account across stores. In-app defaults on; email defaults off. Merchant
choices are separate. These settings do not create promotional consent.

The buyer's **Your emails** view includes email-only updates and their actual
delivery state. Email links return to the authorized order/conversation and to
the preference editor. A receipt accepted by a recipient mail server does not
mean it was read. Existing in-app notifications remain available after changing
preferences; no historical recipient records are rewritten or backfilled.

## Durable preferences and delivery

Migration `0031_buyer_notification_preferences.sql` adds an account-scoped
preference projection and immutable change receipts. Every write uses an exact
request key and expected revision. A database trigger validates all six groups
and both boolean channels, checks the revision/rate limit, records the receipt
and updates the projection in the same transaction. Direct projection writes,
replacement receipts, history edits and deletion are rejected. The current
record is separate from the immutable notification recipient snapshots.

Notification creation records the buyer's actual preference revision and both
channel choices. Permanent order/conversation ownership remains authoritative.
The email dispatcher and its final database send-start check both consult the
current buyer preference, so turning email off during account verification
prevents a new submission. Earlier uncertain submissions retain the existing
email recovery rules; changing a preference does not claim an earlier email was
never sent. See [email delivery](commerce-email-delivery.md).

Email is addressed only after a fresh, confirmed Supabase account lookup. A
checkout contact address is not proof, and preferences cannot choose an arbitrary
recipient. Guest checkout email verification/receipt coverage, actual approved
provider delivery and mailbox acceptance remain separate work. This rollout
does not connect or activate an email service.

## Private API and editor behavior

Buyer JWT identity owns these routes; submitted account/store IDs are rejected:

- `GET /v1/customer/notifications/preferences`
- `POST /v1/customer/notifications/preferences` with
  `{revision,requestKey,values}`
- `GET /v1/customer/notifications/preferences/history` with an optional
  account/environment-bound cursor

The PHP buyer proxy validates session version, current Google identity, CSRF,
origin, body bounds and strict route/query shape. Reused merchant sign-ins retain
their MFA/account rechecks. A sign-in change during upstream work discards the
private response. Preference management is available while commerce is held,
so users can set future choices or opt out; held inbox/read/source operations
stay held. The preference API does not enable commerce or the email provider.

The editor keeps its draft and exact pending request in tab session storage,
scoped to account and environment. Lost acknowledgements survive reload and
retry the same request key, revision and values. A confirmed stale-revision
rejection allows comparison even when the original response was interrupted.
An uncertain response or conflicting request reference is not silently replaced
with a new request. Saves validate the returned receipt against the pending
values before clearing it.

When another tab saves, comparison preserves independently changed choices and
loads the latest revision before a new save. Loading saved choices is explicit.
History has stable paging and retains the loaded page after an interrupted next
page. Leaving preferences closes its dialogs; sign-in changes clear private
panels and dialogs. A different account cannot restore the earlier account's
draft. Storage failures prevent an unpreserved save instead of promising reload
recovery that is unavailable.

## Acceptance

Fixtures exercise opt-in defaults, account/store separation, no promotional
consent, current confirmed addresses, channel snapshots, preference races,
immutable projection/history guards, concurrent saves, lost acknowledgements,
stale-revision recovery, cursor isolation, held commerce, actual PHP session and
origin/CSRF checks, account changes in flight, history interruption and desktop/
390-pixel layouts. Auth/provider responses remain isolated fixtures; no real
email is sent.

Verification passed: all 205 Worker tests, 38 focused buyer/notification/email
checks, 16 affected PHP/browser tests, and a final same-browser account-switch
check. Five PHP and six JavaScript syntax checks, TEST Worker dry run and
`git diff --check` pass. Logs use `/tmp/ezkart-buyer-prefs-*-01a0d643.log`.
The desktop and 390-pixel preference/history screenshots under
`/tmp/ezkart-buyer-prefs-ui-01a0d643/` were visually inspected.

The fresh 485610-byte TEST backup has SHA-256
`c44cce63f5f7b16ab3bfa0f0b25ef6181f8d2e586efd12052375d059d3b74ac1`.
It restores in original order with migration 0031: integrity is `ok`, foreign
keys pass, all 89 old table counts and seller settings are unchanged, and the
two new tables are empty. The migration adds ten application schema objects and
three automatic indexes and replaces only the three intended recipient/send
guards. Private rollout artifacts are in
`/tmp/ezkart-buyer-prefs-deploy-01a0d643/`. Hosted evidence follows rollout.

Authenticated hosted acceptance, real provider/domain/mailbox verification,
operational monitoring and sustained delivery testing remain open. Work stays
on `agent/ezkart-workbench` / TEST. The full completion plan, DOKU gate, sustained
financial validation and explicit production release hold remain in force.
