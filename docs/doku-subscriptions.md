# DOKU subscriptions

Saved monthly/yearly subscription plans now have a durable **local** lifecycle
(migration 0068). This is application work ahead of FlexiBill activation; it does
not complete the live recurring payment service.

Customers can open **Review subscription request** beside a saved shop plan,
sign in, review its exact price/cadence and save an explicit request. The request
freezes product/plan/store names, integer IDR price, cadence, catalog revision,
original wording, consent version, time and customer/store identity. Changed
terms require a new review. A saved request is explicitly **not a provider
mandate**. No card/OVO credential is collected or charged. The customer page is
`/cart/subscriptions.php`; merchant management is Customers → Subscriptions.
Both show original terms, recent periods, current paid-access expiry and allow
cancellation. The customer browser persists an uncertain enrollment request
across reloads with its exact original key and body until acknowledged.

The signed customer-service route and authenticated merchant routes enforce
customer/store ownership; merchants cannot record customer consent. Enrollment
replays return the current subscription without reverting cancellation. Frozen
terms and outcomes are immutable in D1.

`prepareSubscriptionPeriod` creates one deterministic original charge identity
per subscription/period. It prepares only the first or next contiguous unpaid
period, reuses unresolved periods, and rechecks cancellation atomically inside
the insert. Monthly/yearly windows retain their original day anchor, clamping
short months and restoring the original day in subsequent months. The first
period starts at its authenticated successful payment, not at enrollment.
Late renewal success applies only to its original window. No automatic retries,
grace periods, fee assignments or arrears collection policy are invented.

`reconcileSubscriptionPayment` consumes a durable provider evidence identity;
there is no API accepting a caller's `verified` flag or browser-return success.
Amount, currency, store/environment, original charge identity, dispatch timing
and cancellation boundary must match. Failure produces past-due state without
paid access. A later authenticated success can settle that same period; duplicate
success and late failure cannot grant extra time or downgrade paid access.
Time-bounded access is derived at read time; expiry requires no cron. Cancellation
stops future periods, retaining access already paid for. An authenticated result
for a charge dispatched before cancellation can still reconcile; dispatch after
cancellation cannot activate access. These are entitlement projections, not a
new downloadable-file or recurring financial-ledger integration.

The production `commerce_subscription_payment_sources` view is deliberately
empty and read-only. Focused tests replace it with an isolated fixture table;
deployed code cannot manufacture success. `dispatchSubscriptionCharge` is
unconditionally closed. A scheduler and real provider ingestion must be connected
when the provider contract is established; nothing runs on a timer or sends
provider requests today. One-time BCA checkout continues to reject subscription
products before creating an order, payment or stock reservation. Existing
commission and integer-rupiah rules are unchanged.

## Provider boundary checked 28 September 2026

The owner left FlexiBill registration, terms acceptance and its IDR 1,000,000
initial deposit pending. DOKU business approval is separate from this activation.

Official [Account Billing documentation](https://developers.doku.com/flexibill/account-billing)
describes automatic scheduling and consent, but does not supply a concrete
scheduler registration/cancellation/individual authenticated-result contract.
The concrete [Batch Upload contract](https://developers.doku.com/flexibill/account-billing/batch-upload)
describes tokenized initial payment, merchant-managed schedules and encrypted
SFTP files. It requires DOKU-provisioned SFTP access, IP allowlisting and keys.
The supported adapter helpers construct its documented `/batch-upload/v1/notify`
request envelope and parse report-ready notices. A report-ready notice proves
neither an individual successful charge nor a mandate. Helpers neither send
requests nor claim to authenticate a report.

**Exact remaining external contract:** select/activate the approved FlexiBill
service; obtain the chosen channel's consent/token binding and revocation
contract; obtain authenticated individual charge-result/report semantics and
stable charge identity mapping. For automatic scheduling, obtain registration,
schedule changes and cancellation/acknowledgement APIs. For Batch Upload, obtain
SFTP endpoint/access, IP allowlist, public encryption key plus the exact file
format/encryption utility and authenticated report retrieval details. Implement
and verify that adapter, durable dispatch/cancellation handoff and outcome
source before wiring the scheduler. Integrate recurring charge accounting under
the existing commission policy and any product-specific entitlement delivery.
Provider fees, funding and real transaction acceptance belong in beta testing.

The documented [OVO recurring flow](https://developers.doku.com/accept-payments/direct-api/snap/integration-guide/e-wallet/ovo)
requires account binding and initial OTP/PIN consent and provides unbinding.
It is not a BCA VA adapter and has not been silently selected as the service.
A saved card token or browser return cannot establish a recurring mandate.

## Focused validation

`cloudflare/ezkart-api/test/commerce-subscriptions.test.mjs` exercises explicit
consent, owner/store isolation, immutable snapshots, replay, unique periods,
month-end/leap-year anchoring, failure/success order, duplicate outcomes,
invalid payment/dispatch times, cancellation races and access expiry.
`tools/checkout-test/subscription-lifecycle-ui.test.mjs` uses an isolated browser
to save from the shop, lose a response, reload/retry without duplicate enrollment,
view customer terms, cancel from the merchant surface and observe cancellation
on the customer page. `subscription-readiness.test.mjs` retains the BCA rejection
and desktop/mobile cadence regression. These fixtures are not live acceptance.
