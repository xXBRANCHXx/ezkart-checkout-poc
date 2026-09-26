# Campaign visits and order attribution

Migration 0039 gives each sealed campaign with a store button one opaque public
link. Newly prepared messages use that link in both HTML and text. The link
becomes available only when a message containing it has a durable send-start
receipt. Old saved messages, retry keys, unsubscribe references and bytes remain
unchanged; the populated migration/retry fixture verifies this boundary.

The public link is shared by the publication, not assigned to an email address.
A forwarded message therefore identifies the campaign without identifying its
original recipient. Cancellation, withdrawal of email permission and sending or
central-commerce holds do not disable a link already received. Current store
closure does disable it. No new provider or sending activation is included.

## Navigation and privacy

`/cart/campaign.php?c=...` resolves only through this deployment's pinned Worker.
GET records an anonymous visit and redirects to the owned store with an opaque
`campaign_visit` reference. HEAD resolves the store without recording a visit;
other methods and additional query parameters are rejected. There is no caller
supplied redirect destination. The bridge has no login/session dependency and
forwards no browser credentials to the Worker.

The reference travels in the current shop/cart URL and the original submitted
checkout body. No visitor cookie or remembered attribution preference is added.
Saved store branding strips it from the return URL. The existing tab-local
checkout recovery record retains the exact request after submission, so a lost
response/reload can recover without changing commercial intent or attribution.
The bridge and shop/cart pages suppress referral URLs. Navigating directly to
the store later without this reference does not recover a previous source.

Visit references contain 32 random bytes. D1 stores their environment-scoped
hashes, publication/store ownership and creation/expiry times, without an email
recipient or account identity. References expire after seven days. Recorded
visits are link requests, not unique people, email opens or verified engagement:
repeated navigation and automated email checks can create additional visits.

## Durable order source

The original checkout intent/hash includes the supplied reference. Initial order
creation stores only its hash in the private snapshot. A D1 trigger creates one
immutable attribution in the same transaction as the order, before its revision
advances; later writes cannot attach, replace or remove the source. Attribution
requires the visit's store/environment and valid seven-day window to match.
Unknown, expired or wrong-store references leave an otherwise valid checkout
unattributed. Malformed references are rejected before order/provider creation.

Exact retries recover the original order before consulting current visits or
catalog settings. Removing or replacing a reference under that checkout key
conflicts with the original request. A failed order transaction rolls attribution
back with the order and inventory changes. Verified payment and callback retries
preserve the original source and create one ordinary payment capture.

## Measurement protection and retention

The database permits at most 10,000 recorded visits per publication/UTC hour and
100,000 per store/environment/UTC day. At those limits the bridge still opens the
store, without a new attribution reference, and increments a separate limited
measurement counter. Reports must show this limitation. These are measurement
limits, not proof of human traffic or a substitute for operational load testing.

Hourly totals survive expiry. Existing hourly maintenance removes at most 5,000
expired visit references per invocation, while immutable order attribution keeps
the original visit hash/time independently of the transient reference table.

## Validation and remaining work

Twelve attribution backend cases cover activation, read-only HEAD, anonymous
links, legacy populated migration, unknown submissions, store/environment scope,
immutable order recovery, rollback, expiry/cleanup, hourly/daily measurement
limits and two tracked messages within the D1 invocation query budget. All 79
existing campaign transport/delivery and order/inventory/job regression cases
pass. All 19 relevant PHP/browser cases pass, including four new bridge/checkout
cases and existing checkout/unsubscribe regressions. Desktop and 390px recovery
and unavailable-link layouts were inspected. Syntax, diff and TEST dry-run pass.

Merchant conversion/performance views and exports must use actual verified
payment evidence, account for limited measurement, and label gross amounts
accurately. Existing 23-column delivery CSV snapshots are unchanged. Those
performance views, automation, signed-in hosted acceptance, provider acceptance,
monitoring and sustained capacity/recovery validation remain open. This change
does not certify the marketing gate or the complete workbench.
