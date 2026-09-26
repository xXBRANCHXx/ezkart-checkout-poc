# Merchant identity and notification preferences

Workbench implementation, 26 September 2026. The Settings page now saves store
details and each member's notification preferences through the private commerce
API. The production release hold remains in force.

## Store behavior

The store profile contains its name, business type, public support email/phone,
description, display timezone and date format. Defaults use the actual store name
and empty support contacts. Indonesian `08` phone numbers normalize to `+62`;
other numbers require an international prefix. Currency and country remain IDR
and Indonesia. Logo, account language and two-step verification retain their
existing independent save flows.

Saved names appear in the merchant sidebar and account identity. The normal shop
shows the description and support contacts; checkout shows the support contacts.
They use plain text and validated `mailto:`/`tel:` links. An explicitly saved shop
display name remains independent, as explained in Settings. Store appearance,
logo and shipping configuration retain their own settings keys.

Order, payment, customer, fulfillment, return, inventory, shipping-settings and
merchant-message timestamps use the saved display timezone and date format.
Merchant reviews use the date preference; public reviews retain their existing
format. Jakarta, Makassar and Jayapura are supported, with WIB/WITA/WIT labels.
Date-only report periods and chart buckets retain their original calendar dates;
report calculations still use Jakarta boundaries. The Settings page states this
distinction. Formatting does not rewrite order, shipping or financial records.

## Private saves and recovery

`GET/POST /v1/commerce/settings` reads or saves one of `profile` and
`notifications`. History is available at `/history?kind=profile|notifications`.
Current active membership is required. Settings reads do not provision a seller
or restore removed access. Owners, admins and editors can edit the store profile;
viewers can read it and save their own notification preferences. The server
derives both actor and store. Supplied identity/environment overrides are rejected.

Each save has an actor-scoped request key, canonical request hash, expected
revision and immutable receipt. An identical retry returns its original receipt
alongside the latest saved settings. A reused key with different data fails. The
receipt remains readable after a role becomes viewer, provided membership is
still active. Independent profile/preferences saves do not replace each other.

Migration 0028 adds three tables: store profile projections, member preference
projections, and immutable settings changes. Database guards recheck membership,
revision and value shape, apply projections, protect saved business-profile
fields on the seller, and prevent receipt edits/deletions or projection rollback.
Other seller settings remain editable through their existing services. Saves
are limited to 60 per actor per minute and 1,000 per day; committed retries do
not consume another save. Bodies are bounded to 12 KB with duplicate-key and
malformed UTF-8 rejection.

The PHP proxy validates account, store expectation, CSRF, origin, method and
bounded query/body data. It reopens and checks the session after the Worker
response. A changed sign-in or lost access clears private browser content.
Settings metadata remains editable during the central-commerce hold.

Both forms retain their separate drafts and pending request keys in session
storage across reloads. Unconfirmed saves lock that form and retry the exact
original request. Browser storage failure prevents an untracked write. A stale
revision opens a field-by-field comparison: unchanged fields use the latest
saved version; conflicting fields require a choice. Applying the comparison
prepares the draft; the merchant saves it explicitly. Private history retains
its revision boundary across later writes and preserves loaded rows when the
next page fails. Notification history is visible only to its member.

## Notification delivery remains open

Preferences cover payment confirmation, pending/failed payments, payment/stock
review, shipping, returns, buyer messages and weekly catalog activity, with
separate in-app and email choices. They are personal to each store membership.
Default email choices are off. Weekly activity is off in both channels.

The initial Settings rollout saved preferences and history with both delivery
channels inactive. The [notification follow-up](commerce-notifications.md) now
uses those choices for atomic in-app delivery and scheduled sources when central
commerce and notifications are enabled. Email still records intent only; its
provider is not connected and no real emails were sent during validation.

The combined Settings/notifications acceptance gate stays open for external
email delivery, authenticated hosted workflows, and operational acceptance.

## Validation and rollout

The focused Worker tests cover exact retries, competing writes, personal and
cross-store isolation, role/membership changes, strict inputs, history boundaries,
receipt/projection guards and save throttling. Browser tests exercise the actual
PHP Settings page at 1,360 and 390 pixels, public support links, normalization,
timezone effects in Orders, both independent drafts, lost acknowledgements,
two-tab comparison, private proxy rejection, late session changes, history retry,
viewer behavior and unavailable browser storage.

All 163 Worker tests pass, including six Settings tests. The 58 affected
PHP/browser checks pass, including the six new Settings workflows and the
existing order, payment, customer, dashboard, fulfillment, shipping, messaging
and review checks. The independent logo regression also passes. Worker dry-run,
PHP/JavaScript syntax checks and `git diff --check` pass. Screenshots in
`/tmp/ezkart-settings-ui-01a0d643/` were inspected for desktop/narrow layout,
comparison controls, safe public text and preserved sidebar styling.

A fresh TEST export at
`/tmp/ezkart-settings-deploy-01a0d643/test-before-0028.sql` is 449,120 bytes,
SHA-256 `1263d5476e04fcd7bf652d81471b2c0da066407dab85874dcf91fd89f5c62166`.
Restoring the original export and applying migration 0028 passes SQLite integrity
and foreign-key checks. All existing table counts and seller settings remain
unchanged, and all three new tables are empty. TEST rollout is recorded below
after deployment. Signed-in hosted acceptance and operational notification
delivery remain separate from fixture results.

Implementation `615f7f8` is pushed to `agent/ezkart-workbench`. TEST migration
0028 is applied, with 16 new schema objects (three tables, two indexes and eleven
triggers) and no remaining migrations. The post-migration snapshot confirms
unchanged existing counts, seller values, financial/provider records, message
records and import manifest, with no foreign-key errors. The three new Settings
tables remain empty; validation did not create hosted profile/preference fixtures.

TEST Worker `16b7f3ed-361a-4ad0-a0ea-140947a148bd` is deployed. At 13:19 UTC
on 26 September, its health endpoint reported 80 tables and healthy D1/public
R2/private R2 checks. Both private Settings routes return 401 without a token;
the financial provider-account route still reports the central-storage hold.
The hourly `17 * * * *` schedule and provider activation settings are unchanged.

Hostinger auto-deployed the workbench push. All eleven checked Settings,
formatting, order, shop/checkout and shared-review/message assets match local
bytes. The hosted Settings page shows the sign-in gate, its unauthenticated proxy
returns 401/no-store, and direct access to the two new private PHP includes
returns an empty 404. Evidence is in
`/tmp/ezkart-settings-deploy-01a0d643/`. Python's default HTTP client was rejected
by Cloudflare's browser-signature filter; the recorded successful Worker and
hosted checks used an independently launched browser. No filter was changed.

Shared Chrome still reports the previous connection timeout, so signed-in hosted
Settings acceptance remains unverified. No additional reconnect loop was started.
