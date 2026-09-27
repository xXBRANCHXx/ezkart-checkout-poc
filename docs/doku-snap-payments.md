# DOKU SNAP payment preparation

The beta target is live DOKU on workbench, with separate real-payment storage.
Main and `ezkart.id` remain held. Provider fixtures are verification tools; their
sandbox mode does not define the requested beta environment.

## BCA contract adapter

`cart/api/doku-bca-snap.php` implements typed creation, signed payment-notification
verification and read-only status observation for BCA SNAP 1.1. It uses the
aggregator/DOKU-generated payment-code contract, closed amounts and non-reusable
accounts. It does not yet add a callable webhook or enable a checkout flow.

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
to send **after** its capture has committed. The pure verifier has no database or
HTTP response side effects. No callback endpoint is installed by this module.

Status observations preserve original evidence against the requested account and
invoice, including bounded arrays and empty results. They deliberately do not
classify payment or settlement or permit another create: the published examples
return HTTP success and a nonzero `paidAmount` even while payment is pending.
The documented sixty-second status-query delay must be observed by the eventual
dispatcher. Actual BCA successful/expired/failed status shapes and recovery of a
lost DGPC creation reply still require provider acceptance evidence.

## Verification and remaining wiring

Twelve BCA/authentication cases and thirteen existing financial-reader cases pass. They independently
check signatures, both provider origins, exact account/amount bindings, malformed
responses, one-attempt failures, signed but mismatched callbacks, replay identity,
late delivery, JSON canonicalization, status ambiguity and HTTP denial. Fifteen
wallet/signing regression cases pass. PHP syntax checks pass. All provider replies
in these tests are isolated fixtures; no account or payment was created at DOKU.

Remaining: immutable central payment-dispatch binding and receipt storage; the
public signed webhook with durable acknowledgement and duplicate/conflicting
capture protection; the checkout/payment-job/UI flow; supported status recovery;
actual provider channel activation/configuration and acceptance; original-fee,
settlement, refund, Sub-Account routing and payout integration. The existing
`direct_bca` flow is still the old sandbox-only adapter. Selecting a new mode in
configuration must not silently reinterpret its original requests or records.

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
