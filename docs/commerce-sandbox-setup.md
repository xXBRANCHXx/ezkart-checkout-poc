# DOKU + Biteship sandbox checkout

Sandbox checkout creates a BCA virtual account through DOKU's non-SNAP direct
API and opens **Ezkart's own payment page** at `/cart/payment.php?order=…`.
The server calculates the product total, with no delivery selection or shipping charge. It does not call
Biteship or require its credentials, pickup address or balance. Customer contact
and address fields remain available for the payment session. Only a verified
DOKU success notification marks an order paid; delivery is then marked skipped,
with no pickup action or deadline.

The page has a compact Ezkart logo, neutral cards, an orange action button,
copyable account number and exact amount, a WIB deadline, bank instructions,
order summary and automatically refreshed confirmation. Reloading only reads
the saved order; it does not create another account. No hosted DOKU pages or
scripts are loaded. Query parameters and the Check payment button cannot mark
orders paid. A verified callback can still confirm a payment after the UI's
deadline passes. Existing hosted orders retain their signed callback handling.

**Production limitation:** this integration honors the requested non-SNAP API
for sandbox. DOKU's [migration documentation](https://docs.doku.com/miscellaneous/snap-migration)
requires SNAP for production direct virtual accounts. `direct_bca` therefore
fails closed in production before any provider/rate calls. Switching commerce
mode alone does not enable this direct adapter live. The UI is independent of
the API adapter and can remain Ezkart-owned after a supported production
adapter is configured and verified. An explicit environment-specific
`doku_<environment>_payment_flow=hosted` setting retains the earlier integration
for rollback; there is no automatic fallback.

API contract: [DOKU BCA direct API](https://jokul.doku.com/docs/docs/jokul-direct/virtual-account/bca-va-guide/),
`POST /bca-virtual-account/v2/payment-code`, HMAC-SHA256, fixed amount,
non-reusable account, 60-minute expiry. Invoice, optional echoed amount/currency,
account number and deadline are validated before exposing payment details.
Callbacks must also match the BCA channel and account number. The actual sandbox
API accepted this endpoint with the existing account credentials on 2026-09-18.
Payment instructions follow [BCA's guide](https://www.bca.co.id/en/informasi/edukatips/2022/07/07/09/19/cara-bayar-menggunakan-bca-virtual-account).

Production checkout still requires a delivery selection and a fresh Biteship
rate. The shipping API can also be tested in sandbox by explicitly supplying a
valid `shipping_id` to `start.php`; those orders follow the merchant acceptance
and simulated pickup flow. The server's commerce environment controls the rule.

## Private server configuration

Copy the relevant entries from `config.example.php` into the test website's
ignored `config.runtime.php` (preserve its existing Auth/Worker settings).
The loader also merges `config.runtime.php` from the parent of the web document
root, with those values taking precedence. On Hostinger, the test site's private
parent file contains only the sandbox provider settings; its existing
`public_html/config.runtime.php` retains Auth/Worker settings. Keep the private
file readable and writable by its owner only (`0600`).
Alternatively use environment variables prefixed with `EZKART_` and uppercase
keys. Credentials must never appear in browser code or Git.
Only the first four entries below are needed to test sandbox payments; the
Biteship entries are needed when testing shipping separately.

```php
'deployment_environment' => 'test',
'commerce_environment' => 'sandbox',
'doku_sandbox_client_id' => 'YOUR_DOKU_SANDBOX_CLIENT_ID',
'doku_sandbox_secret_key' => 'YOUR_DOKU_SANDBOX_SECRET_KEY',
'doku_sandbox_payment_flow' => 'direct_bca', // Default; sandbox only.
'biteship_sandbox_api_key' => 'biteship_test.YOUR_TEST_KEY',
'biteship_sandbox_webhook_token' => 'YOUR_RANDOM_SECRET_AT_LEAST_32_CHARACTERS',
'biteship_origin_postal_code' => 'YOUR_FIVE_DIGIT_POSTCODE',
'biteship_origin_contact_name' => 'YOUR_PICKUP_CONTACT',
'biteship_origin_contact_phone' => 'YOUR_PICKUP_PHONE',
'biteship_origin_address' => 'YOUR_COMPLETE_PICKUP_ADDRESS',
'biteship_couriers' => 'jne,sicepat,jnt',
```

Generate a webhook token with `openssl rand -hex 32`. The optional
`order_storage` is an absolute directory outside the public web root; Ezkart
appends `/<deployment>/<commerce environment>`. Keep it writable by PHP only.
Legacy `midtrans_order_storage` is accepted for sandbox storage when
`order_storage` is absent; an existing default legacy sandbox directory is also
reused so previous orders remain visible. Unscoped Biteship test credentials remain a fallback;
new setups should use the explicit sandbox slots above.

The PHP host needs PHP 8.1+ with cURL and mbstring. Only privileged legacy admin
accounts see this prototype's private JSON orders. Seller-scoped D1 orders are
a separate production requirement, as described in `database-environments.md`.

## Provider dashboards

1. Create/sign in to the [DOKU sandbox dashboard](https://sandbox.doku.com/).
   Retrieve its **Client ID** and **Secret Key** under **Settings → API Keys** and put
   them in the sandbox slots. These are Checkout/non-SNAP credentials.
2. In the sandbox dashboard's **Settings → Payment Settings**, configure
   `https://test.ezkart.id/cart/api/doku-webhook.php` as the payment notification
   URL for every channel enabled in checkout. Virtual accounts have separate
   SNAP and non-SNAP configurations; this sandbox integration uses non-SNAP
   notifications. Configure cards separately under their payment settings.
   The legacy hosted adapter also supplies the URL in each payment request through
   `additional_info.override_notification_url`, but DOKU requires a dashboard
   URL first, with the same path as the override. An accepted payment-creation
   request alone does not prove notifications are configured. The endpoint must
   be publicly reachable by DOKU; hosting password protection must exempt this
   webhook. It authenticates each request by its DOKU signature.
3. In Biteship, turn on **Mode Testing** and generate a test API key. Both modes
   use `https://api.biteship.com`; the API key determines the mode.
4. Configure Biteship `order.status`, `order.price`, and `order.waybill_id`
   webhooks at
   `https://test.ezkart.id/cart/api/biteship-webhook.php?environment=sandbox`.
   Authenticate deliveries with `Authorization: Bearer <sandbox webhook token>`
   (HTTP Basic password or `X-Ezkart-Webhook-Token` is also accepted). Exempt this
   endpoint from hosting password protection too. Registration sends an empty
   POST to verify reachability; Ezkart acknowledges that probe without accessing
   orders. Every nonempty event payload still requires webhook authentication.

Biteship sandbox orders are simulated, but rate checks, Maps and public tracking
may still incur API fees. Production checkout requests rates when showing
shipping choices and again when validating checkout. Sandbox checkout skips
these lookups unless an API caller explicitly supplies a shipping selection.

## Acceptance run

1. Open `https://test.ezkart.id/cart/api/health.php`. Confirm
   `commerce_environment=sandbox` and `doku.configured=true`. These flags validate
   configuration only; they do not prove provider account activation. Biteship
   flags may be false for a sandbox payment test.
2. Open `https://test.ezkart.id/cart/?shop=ezkart-demo&cart=granola:1`.
   Enter test customer/address details and click **Pay**. No delivery lookup or
   selection is required, and the total contains only the products.
3. Confirm the browser stays on `https://test.ezkart.id/cart/payment.php?order=…`
   with the exact product total and a copyable BCA account number. Sandbox
   currently offers **BCA Virtual Account**, whose
   notification URL is configured and whose payment flow is tested. Configure
   and verify each additional channel's notification before enabling it in the
   sandbox payment-method list. Production direct APIs require a supported
   adapter plus separate channel configuration and acceptance.
4. Complete the payment through the
   [DOKU BCA simulator](https://sandbox.doku.com/integration/simulator/bca/inquiry)
   using the virtual account number shown on the Ezkart payment page.
5. Verify the Ezkart payment page automatically shows **Payment received**.
   **View order** opens the existing confirmation page with **Payment confirmed**
   and **Delivery skipped (sandbox)**. Merely loading either page or clicking
   Check payment does not mark the order paid.
6. For a separate shipping integration test, first configure Biteship and create
   an order with an explicitly quoted shipping service. In the privileged order
   dashboard, accept that paid order and arrange pickup.
   Verify one simulated shipment and its reference in Biteship Testing Mode.
   Repeat Arrange pickup/notification delivery and confirm no duplicate order.
7. Verify a Biteship webhook updates the shipment reference/status. Check a
   failed DOKU attempt remains pending and that retrying successfully confirms
   the same order. Failed attempts must not undo a successful payment.

Record the DOKU invoice, Biteship order ID, deployed commit and the results before
calling the provider integration verified. On 2026-09-18, the actual DOKU sandbox
API accepted a signed payment-creation request with the locally configured
credentials, echoed the exact invoice and amount, and returned a checkout URL
at `staging.doku.com/checkout-link-v2/`. The application adapter created invoice
`EZK-S-238856F1010F5D0E6183C773`, and its hosted checkout displayed the expected
IDR 10,000, customer details, bank transfer and card options. No payment was
completed in that initial local test.

The updated sandbox browser flow also created invoice
`EZK-S-986B672736303125FCB00262` through the normal checkout endpoint, with
Biteship credentials deliberately unavailable in the local test server. DOKU
displayed exactly IDR 58,000 for one granola item, with zero shipping charge.
That local session remained pending; no provider payment confirmation was
simulated for it.

Later on 2026-09-18, the private sandbox credentials were installed on
`test.ezkart.id` outside `public_html`, with file permissions `0600`. The health
endpoint confirmed sandbox DOKU, the Biteship key and webhook token, and the
existing Cloudflare database connection. The DOKU sandbox BCA non-SNAP payment
notification URL was saved in its dashboard and read back successfully.

The public checkout then created invoice `EZK-S-6FBD8C86BA8CBCF023A5E6AC`
for one granola item at IDR 58,000, without a delivery selection or charge.
DOKU's BCA simulator completed the payment and the actual signed provider
notification changed the hosted order to `PAID`, payment status `SUCCESS`,
channel `VIRTUAL_ACCOUNT_BCA`, and fulfillment `NOT_REQUIRED`. No Biteship order
or fulfillment deadline was created. The browser returned to Ezkart and showed
**Payment confirmed**, `PAID (test)` and **Delivery skipped (sandbox)**.
This verifies the BCA sandbox payment
path; other payment channels and the shipping flow need separate acceptance.

An earlier hosted test, `EZK-S-0B13E875C68E175126FC5A27`, was paid in the DOKU
simulator before the BCA notification URL was configured, so Ezkart retained
`PENDING`. This exposed the dashboard configuration requirement above. No
payment status was manually changed to simulate a successful callback. BNI's
simulators did not find that test's BNI virtual account; BNI is not enabled in
the sandbox checkout's verified channel list.

On the same date, the actual Biteship test API accepted the shipping adapter's
isolated sample order `EZK-S-EA075F0E1CC5993FD8718311` and returned simulated
shipment `6aace9e7e558e47fb0412fd9` with status `confirmed`. This adapter fixture
used temporary sample addresses and was not saved as a paid Ezkart order.
The Rates API rejected the request because the account had insufficient balance,
so rate lookup and the full shipping flow remain unverified. A Biteship balance
top-up and actual pickup details are still needed for shipping tests. Hosted
test credentials are installed. Shipping tests do not block the sandbox
checkout that skips delivery.

Biteship accepted registration of sandbox webhook `6aaceb8083fe22646422e72f`
for all three events at the test endpoint, using `X-Ezkart-Webhook-Token`.
It replaces the earlier Ezkart sandbox webhook targeting the old
`admin.jenanggemi.com` application. Deployed commit `54951d1` returns HTTP 200
for the empty installation probe and HTTP 401 for an unauthenticated event.
The same private webhook token is now installed on the test server. A synthetic
event for a nonexistent shipment received HTTP 401 without the token and HTTP
200 with `matched=false` when authenticated, without changing an order. Actual
provider delivery updating a persisted Ezkart shipment remains a separate
shipping acceptance test.

## Sandbox checkout branding

On 2026-09-18, the sandbox dashboard's **Settings → Checkout Appearance →
Interface Settings** was configured with `assets/ezkart-logo-doku.png` and a
custom palette named **Ezkart neutral**. It uses background `#F8F9FA`, white
cards, dark text/actions `#111827`, muted text `#6B7280`, and a neutral gray
countdown background `#4B5563` with white text. The existing multicolor logo
provides the brand accent.

DOKU displays the uploaded logo in a fixed-height area and provides no logo-size
slider in this sandbox. The padded `assets/ezkart-logo-doku.svg` retains the
existing Ezkart vector artwork and is rendered at 720 × 480 px for upload. Its
image box renders at 180 × 120 px, with the visible mark about half the width of
the initial email-logo upload. Regenerate the PNG with:

```sh
rsvg-convert --width 720 --height 480 \
  --output assets/ezkart-logo-doku.png assets/ezkart-logo-doku.svg
```

The payment countdown remains enabled with the neutral background. DOKU hardcodes
red number boxes, so white countdown text preserves their readability. Its toggle
also hides the **Pay Before** deadline on the virtual-account page, so disabling
it would remove useful payment information. The 60-minute payment expiry is
unchanged.

A fresh checkout from `test.ezkart.id` created invoice
`EZK-S-FBA28F2F9EEFDDA6A76AA68D` for IDR 58,000. DOKU's actual staging payment
page displayed the saved logo and palette at desktop and 390 px mobile widths.
This branding-only acceptance order remains unpaid and has no seller routing.
See the [desktop preview](commerce/doku-sandbox-desktop.png) and
[mobile preview](commerce/doku-sandbox-mobile.png).

The registered merchant name underneath the logo still reads **branch vincent**.
DOKU documents changing this through Business Info, with provider review. That
entry was absent from this sandbox's Settings page, and the documented business
account route redirected to its dashboard. The registered name has not been
changed. Logo/palette configuration does not rename the registered brand.

The hosted appearance settings allow logo upload, palette colors, language and
countdown options. They do not expose custom CSS, font-family selection or page
layout controls. An Ezkart-owned payment screen using DOKU Direct API is a
separate integration option for full layout control; the current checkout
continues to use DOKU's hosted page.

## Seller wallets, fee rules and payouts

The requested wallet model is **seller sub-accounts, Ezkart fees and merchant
payouts**. It is separate from the verified payment-collection integration.

On 2026-09-18, DOKU's sandbox service list showed **Collect and Route / Deposit
System / Fund Oversight** as **ACTIVE**. The Sub Account V2 page initially showed
an activation prompt while loading; after its account requests completed it
showed the active merchant profile and **Create Sub-Account**. Do not infer
activation status from that initial loading screen.

The dashboard successfully created this isolated test seller:

| Field | Sandbox value |
| --- | --- |
| Name | Ezkart Sandbox Demo Seller |
| Profile ID | `SAC-5716-1789721857135` |
| Parent profile | `BRN-0209-1789715193397` |
| Type / status | DEFAULT / ACTIVE |
| Available IDR account | `2010182315`, balance 0.00 |
| Pending IDR account | `2030068155`, balance 0.00 |

These are sandbox identifiers, not credentials. The account has not been mapped
to an Ezkart seller, and no payment has been routed to it. Creating this account
through DOKU's dashboard does not establish that API registration, fee splitting,
settlement or payout works through Ezkart.

The user's pricing mockup now specifies Basic / Advanced / Marketplace
commissions of 5% / 6% / 7% of product subtotal and Rp1,250 admin per order.
The seller pays DOKU's actual processing fee, with an estimate shown beforehand.
See [seller fees and payouts](seller-fees-and-payouts.md)
for the checked example and proposed DOKU mapping. The user also specified a
Rp250,000 minimum seller withdrawal. The Rp2,500 BI-FAST recipient charge applies
only to withdrawals below Rp250,000; withdrawals at or above that amount carry
no recipient withdrawal fee. Ezkart covers the provider's transfer fee on seller
withdrawals. Future affiliates have no Ezkart minimum and pay the fee only when
withdrawing below the threshold. The event that releases seller earnings for
withdrawal remains unconfirmed.
No split rule or payout was created. DOKU's Collect and Route guide
describes percentage or flat split rules applied at settlement, after provider
payment fees. Attaching a seller profile and split rule to checkout, persisting
environment-specific seller mappings, showing provider balances, and verifying
payouts are still implementation and acceptance work. Invalid routing identifiers
can be accepted without the expected routing or split, so a successful checkout
response alone will not establish success for this flow.

## Production switch

Complete `production-commerce-checklist.md` before accepting public orders.
Populate `doku_production_client_id`, `doku_production_secret_key`,
`biteship_production_api_key`, and `biteship_production_webhook_token` with their
separate live credentials. On the production website, set:

```php
'deployment_environment' => 'production',
'commerce_environment' => 'production',
```

That server-side switch selects `https://api.doku.com` and the live Biteship key.
Production checkout returns to `https://ezkart.id`; use its corresponding
notification endpoints, with `?environment=production` for Biteship. Switching
back to `sandbox` restores test mode. The workbench cannot start live payments.
There is no customer-controlled or unauthenticated mode toggle.

Order IDs and private directories retain their original environment. Delayed
DOKU notifications select credentials by invoice environment; Biteship webhooks
select them by the explicit URL environment. Sandbox pickup requests are
rejected while production mode is active. Keep each mode's credentials and
order directory for outstanding orders.

The switch does not implement refunds, reconciliation or merchant payouts, and
does not establish PSE registration or production onboarding readiness. Those
remain separate release requirements in `project.metadata.json`.

## Automated checks

```sh
# PHP 8.1+ CLI with mbstring built in; cURL must be absent under -n for fixtures.
PHP_BINARY=php node --test tools/checkout-test/checkout.test.mjs
```

The browser test uses the existing Playwright installation under
`tools/builder-mcp` (`npm ci` there if needed). Test PHP runs with an isolated
private directory, synthetic credentials and a transport fixture that cannot
make external provider requests. Coverage includes the real checkout and
webhook endpoints, independent Node HMAC verification, tampering and amount
mismatches, merchant pickup, replay protection, environment selection, provider
failures, and desktop/mobile browser redirects. These checks are distinct from
provider sandbox acceptance.

## Provider references

- [DOKU backend integration](https://developers.doku.com/accept-payments/doku-checkout/integration-guide/backend-integration)
- [DOKU notification handling](https://developers.doku.com/get-started-with-doku-api/notification/best-practice)
- [DOKU notification URL setup](https://developers.doku.com/get-started-with-doku-api/notification/setup-notification-url)
- [DOKU override URL requirements](https://developers.doku.com/get-started-with-doku-api/notification/override-notification-url)
- [DOKU simulator guide](https://developers.doku.com/accept-payments/doku-checkout/integration-guide/simulate-payment-and-notification)
- [DOKU checkout customization](https://docs.doku.com/accept-payments/integration-tools/doku-checkout/customize-checkout-page)
- [DOKU Direct API and custom payment pages](https://docs.doku.com/accept-payments/integration-tools/direct-api)
- [DOKU business data changes](https://docs.doku.com/get-started/manage-business/update-business-data)
- [DOKU seller account management](https://docs.doku.com/wallet-as-a-service/sub-account/account-management)
- [DOKU Collect and Route / split rules](https://docs.doku.com/wallet-as-a-service/sub-account/collect-and-route)
- [Biteship sandbox](https://biteship.com/en/docs/sandbox)
- [Biteship base URL and mode selection](https://biteship.com/en/docs/api/base_url)
- [Biteship testing-mode fee policy](https://help.biteship.com/hc/en-us/articles/58286997471513-Testing-Mode-Fee-Policy)
