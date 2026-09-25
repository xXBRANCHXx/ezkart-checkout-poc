# Buyer email preferences

Buyers can manage store-specific promotional email permission at
`/cart/preferences.php`. Tracking links keep the order reference so a verified
guest checkout can be claimed before listing its store. Delivery addresses also
links to preferences. This feature requires the existing central-commerce flag;
it does not activate central checkout or send email.

The page uses the existing verified Google sign-in and borrowed-login bridge.
Every preference request rechecks the Google account, confirmed email and MFA.
The signed PHP service supplies identity to the Worker. Browser-supplied identity,
environment and channel fields are rejected; merchant bearer tokens cannot write
buyer consent. The PHP proxy checks CSRF/origin for writes, binds every request to
the current customer session version and checks it again before exposing results.
A changed login clears the page's private results. Borrowed sessions do not copy
refresh or access tokens into the customer session.

## Identity and permission

The scope is seller, commerce environment, permanent buyer account and verified
email address. Owning a central order makes its store available; an unclaimed
guest order needs a signed, server-verified email claim first. Contact email,
phone, customer master `auth_user_id` and `consent_json` are never permission.
Once an order is claimed, ownership follows its permanent account binding even
if the buyer changes their Google email. Another account cannot reclaim it with
the original email. This fixes the same case in existing central tracking and
return authorization.

New opt-ins are limited to the currently verified email and an active owned
store. Existing permissions for previous addresses remain visible and can be
withdrawn. An inactive store cannot receive new permission, but withdrawal remains
available. The store/address list has complete keyset pagination, 25 entries per
page; it is a live list, not a frozen marketing audience. Cursors bind to the
account, environment and current verified email. Refresh starts at its first page.

Opt-in requires an unchecked, explicit choice followed by Save email preference.
The displayed statement names the store, target address, promotional purpose,
withdrawal control and distinction from order/delivery updates. The server checks
the submitted statement against its canonical wording before accepting a grant;
changed wording requires reload and a new choice. Withdrawal has a direct Stop
promotional emails action. Phone/WhatsApp marketing permission is not inferred.

## Durable changes and history

Migration `0021_customer_consents.sql` adds `commerce_customer_consents` and
`commerce_customer_consent_changes`, with seven guards. The current preference is
a projection of immutable change receipts. Every receipt includes the buyer,
address, store/environment, explicit choice, exact statement, policy version,
source, revision, request hash/key and timestamp. Database guards recheck order
ownership and store availability, enforce revision compare-and-swap, apply the
projection and block direct projection edits or history deletion.

The signed internal route is `POST /internal/commerce/customer-consents`:

- `action: list` accepts an optional order to claim and a list cursor.
- `action: history` accepts store/address and an optional history cursor.
- `action: save` accepts store/address, expected revision, a 32-hex request key,
  boolean `allow`, policy version and the displayed statement.

The service also supplies the authenticated `customer` and deployment
`environment`. Parameters outside each action's schema are rejected. The browser
uses the narrower `/cart/admin/customer-consents.php` proxy, not this route.

Same-key/same-intent retries recover the receipt; changed intent conflicts.
Concurrent edits produce one winning revision. A replay returns the original
receipt **and the current preference**: replaying an old opt-in cannot restore
permission withdrawn afterward. The UI keeps the original request in memory
during an uncertain response, disables its controls and offers Retry confirmation.
It warns before navigating away while confirmation is pending. It does not store
private request data in local storage. A definite conflict requires reload and a
fresh explicit choice.

Buyer history pages through every revision in groups of 20. A fixed initial
revision boundary excludes later writes during continuation. History retains the
original statement after store renames, keeps earlier pages during a failure and
ignores responses for replaced views. Responses omit account IDs, request hashes,
keys and authentication tokens.

## Merchant readouts

Central customer profiles and exports show granted, withdrawn or unrecorded
**email** permission. The join requires the latest scoped order's authoritative
owner and matching contact address. Grouping orders by a common checkout email
does not transfer another account's permission. Profiles include the latest
change time and explicitly leave phone permission unrecorded. Merchant note/tag
editing cannot change consent.

CSV consent is historical state at export creation, just like its other snapshot
values. Existing exports do not change when a buyer withdraws later. Future
campaign delivery must recheck current permission immediately before sending;
an export or saved customer segment is not delivery authorization.

## Validation and remaining work

Seven Worker cases cover guest claims, account/email/store/environment isolation,
strict requests, forged consent fields, changed wording, concurrency, stale edits,
replays after withdrawal, immutable history/projections, account email changes,
inactive-store withdrawal, transactional authority, 44-revision history,
29-store pagination, matching merchant readouts and immutable CSV snapshots.

Seven real PHP/Worker/browser cases cover desktop/mobile explicit opt-in and
withdrawal, reload, complete history, escaped store names, failed reads and page
retries, lost save receipts, two-tab conflicts, session changes during writes,
verified-email/MFA/CSRF/origin checks, borrowed Google login, safe OAuth redirects,
previous-address withdrawal, stale history replies and 27-store pagination.
Screenshots at 1360px and 390px are inspected. Adjacent customer, checkout,
fulfillment, return and Google-authentication checks pass: 57 Worker cases and
33 PHP/browser cases, 90 unique cases overall. Worker dry-run bundling, PHP/JS
syntax checks and whitespace validation also pass. Logs are
`/tmp/ezkart-consents-api-regressions-01a0d643.log`,
`/tmp/ezkart-consents-browser-final-01a0d643.log`,
`/tmp/ezkart-consents-ui-final-01a0d643.log` and
`/tmp/ezkart-consents-auth-regressions-01a0d643.log`.
These are correctness checks, not production-volume acceptance.

Signed-in hosted acceptance remains pending the shared Chrome connection and
controlled central-storage cutover. Phone/WhatsApp verification and consent,
campaign unsubscribe links and suppression at actual delivery, full review
workflows, messaging, data-lifecycle operations and the wider commerce completion
plan remain open. No email campaign, provider transaction or production change is
performed by this delivery.
