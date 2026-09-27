# DOKU SNAP payment preparation

The beta target is live DOKU on workbench, with separate real-payment storage.
Main and `ezkart.id` remain held. Provider fixtures are verification tools; their
sandbox mode does not define the requested beta environment.

## BCA contract adapter

`cart/api/doku-bca-snap.php` implements typed creation, signed payment-notification
verification and read-only status observation for BCA SNAP 1.1. It uses the
aggregator/DOKU-generated payment-code contract, closed amounts and non-reusable
accounts. The explicit `snap_bca` central checkout flow and
`/cart/api/doku-snap-webhook.php` now use this adapter. Hosted configuration has
not selected that flow; actual BCA activation and acceptance remain required.

The provider contract was checked on 27 September against DOKU's official
[BCA SNAP guide](https://developers.doku.com/accept-payments/direct-api/snap/integration-guide/virtual-account/bca-virtual-account),
[VA feature/BIN rules](https://developers.doku.com/accept-payments/direct-api/snap/integration-guide/virtual-account),
[signature specification](https://developers.doku.com/get-started-with-doku-api/signature-component/snap/symmetric-signature)
and [status API](https://developers.doku.com/get-started-with-doku-api/check-status-api/snap).

Creation calls `/virtual-accounts/bi-snap-va/v1.1/transfer-va/create-va`, with
`CHANNEL-ID: H2H` and a numeric external request ID supplied by the original
dispatch record. The shared transport keeps the existing RSA B2B-token and
HMAC-SHA512 behavior, pinned provider origins, response limits and no automatic
retry. Existing Sub-Account read/registration paths retain their own contracts.

Before any request, the adapter validates the frozen environment, credential
fingerprint, invoice, numeric external ID, padded partner-service ID, customer
prefix, amount, customer identity and expiry. Returned instructions must match
the original invoice, exact whole-rupiah IDR amount, name, channel, closed billing
and requested expiry. Account digits must agree with the service ID and generated
customer number. Only the documented 16-digit aggregator DGPC is accepted; other
partnership/code-generation models need their own verified contract. Optional
provider instruction URLs are neither fetched nor exposed as the payment page.

Callbacks require the configured merchant identity, channel, exact endpoint path,
token-bound signature and valid timestamps. JSON minification removes whitespace
outside strings without changing original escapes, Unicode or number spelling;
duplicate keys and ambiguous JSON are rejected. A signed callback must still
match the original invoice, amount, currency, service/customer/account digits and
PJP payment ID. Known account details cannot be replaced. A verified callback
can arrive before a create reply or after expiry; the durable caller must bind
and record it transactionally. Changing a notification request ID does not change
the charge identity. Missing provider payment dates remain explicitly absent.

The adapter returns the documented `2002500` acknowledgement data for the caller
to send **after** its capture has committed. The public handler authenticates the
signature before looking up any order and sends success only after the central
receipt/capture transaction is confirmed. Unavailable storage gets a retryable
503; a held storefront never acknowledges an unsaved payment.

Status observations preserve original evidence against the requested account and
invoice, including bounded arrays and empty results. They deliberately do not
classify payment or settlement or permit another create: the published examples
return HTTP success and a nonzero `paidAmount` even while payment is pending.
The documented sixty-second status-query delay must be observed by the eventual
dispatcher. Actual BCA successful/expired/failed status shapes and recovery of a
lost DGPC creation reply still require provider acceptance evidence.

## Durable dispatch and recovery

Migration 0048 adds two immutable private tables for the original dispatch
binding and provider receipts. Existing orders, snapshots, accounts, captures,
fees and journals are preserved. Each SNAP order starts with one numeric external
ID. The PHP dispatcher validates its request and authenticates before asking the
API for a single dispatch grant tied to its active job lease. Credentials, client,
bank service ID, customer prefix, invoice, amount, buyer and expiry are frozen.
Another call cannot obtain a second grant, even with the same lease. A bound job
cannot return to an ordinary retry.

| Interruption | Behavior |
| --- | --- |
| Configuration/token failure before binding | Known no-effect retry with the existing order/job |
| Missing bind acknowledgement | Uncertain; no provider create is sent |
| Missing/malformed provider create reply | Uncertain; never repeat the create |
| Missing internal receipt acknowledgement | Retry only the identical receipt transaction |
| Payment callback arrives before create reply | Bind its signed account evidence and capture atomically; accept the later matching create receipt |
| Same PJP charge is delivered again | Preserve its new receipt without another capture, stock consumption or journal |
| A different paid charge arrives for that order | Preserve the additional money and flag review |
| Payment arrives after cancellation/stock release | Keep the capture and require stock review; do not oversell |
| Receipt/account/capture/journal write fails | Roll back the complete transaction and withhold callback success |

Receipt routes independently validate original amount, invoice, account, currency
and request fields. They reject duplicate JSON keys and unknown envelope fields.
Only this receipt path can apply SNAP account/capture events; the old generic
event and non-SNAP notification paths cannot substitute for it. Private receipts
retain the exact provider JSON and request body without bearer tokens, signing
keys or authorization headers. The larger bounded receipt envelope does not
increase limits on other commerce routes. Merchant and public payment reads do
not expose this evidence or the credential fingerprint.

`tools/commerce/observe-snap-payment.php --order=EZK-P-<original-id>` is a CLI-only
read for the configured deployment, including beta. It requires the original
recorded account and original credentials, waits sixty seconds after dispatch,
and durably saves the status evidence. Its output explicitly denies payment,
settlement and create-retry confirmation. A lost DGPC reply with no known account
still needs DOKU-assisted reconciliation; the current documented status contract
does not establish an automatic recovery path.

Before selecting `doku_production_payment_flow = snap_bca`, configure the actual
BCA `snap_bca_partner_service_id` digits and `snap_bca_customer_prefix`, plus the
existing production client, secret and SNAP private key. Do not reuse another
bank's BIN. Central D1 checkout and the accepted callback route are required.
The old `direct_bca` flow retains its original sandbox-only contract; its saved
orders are never reinterpreted as SNAP. Beta payment links stay on workbench.

## Verification and remaining acceptance

Nine new Worker cases and ten PHP/HTTP/browser cases cover dispatch concurrency,
lost bind/provider/storage replies, authenticated early/duplicate callbacks,
rollback, changed evidence, exact beta signing, private tooling, the real
sixty-second observation delay, and checkout recovery. The payment page was
visually checked at 1360px and 390px. A populated migration rehearsal preserves
every existing table's rows and passes foreign keys. Existing order/job,
checkout/signature/adapter, financial-journal/payment-read and beta-isolation
regressions pass. PHP syntax and beta Worker dry-run checks pass. These are
isolated provider fixtures; the only real production request remains the earlier
B2B authentication check.

Still required: actual provider channel configuration/acceptance and hosted live
cutover; verified paid/expired/failed status recovery, including a lost DGPC reply;
settlement and actual fees; provider refunds, Sub-Account routing and payouts.
Checkout wiring does not establish any of those financial capabilities.

## Live account setup

The owner-approved production dashboard initially had no merchant public key.
A new dedicated 2048-bit RSA key was prepared outside the repository, with private
directory mode 0700 and private-key mode 0600. Its public half was registered to
the expected live business account and matched byte-for-byte after normalizing
PEM wrapping, including after a full dashboard reload. No existing key was
replaced. The existing secret was captured during an owner-completed email OTP
reveal and stored privately, with mode 0600. The temporary browser capture was
removed and the dashboard has masked the secret again. No secret was rotated,
printed or committed. The ignored local runtime now has the production client,
secret and signing key; its other values and the hosted runtime are unchanged.

`tools/commerce/doku-check-connection.php --environment=production` successfully
authenticated against the live B2B-token API at 05:26:29 UTC on 27 September.
Its output excludes the token and credentials. The production authentication
proof is saved privately. This check creates no payment or Sub-Account and does
not establish channel, settlement or payout acceptance. Twenty-five contract and
reader cases also pass after the PHP cURL cleanup adjustment.

See [beta-readiness.md](beta-readiness.md) for the observed production service and
callback configuration gaps.
