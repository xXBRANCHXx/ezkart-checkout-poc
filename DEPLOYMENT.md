# Ezkart POC: click-by-click deployment

Use placeholders in this guide until the final checkout hostname is chosen.
Do not paste database passwords, API keys, merchant keys, or signing secrets
into chat, GitHub, browser JavaScript, screenshots, or public web forms.

## 1. Create the independent checkout subdomain

1. In Hostinger hPanel, open **Websites**.
2. Click **Dashboard** beside the Ezkart domain.
3. Open **Domains → Subdomains**.
4. Enter the chosen name, such as `checkout`.
5. Leave **Custom folder for subdomain** enabled and use a dedicated folder.
6. Click **Create**.
7. Open **Security → SSL**.
8. Confirm the new hostname shows an active SSL certificate.
9. Visit `https://YOUR-CHECKOUT-HOST/api/v1/health`. A `503` is expected
   before configuration; HTTPS itself must work without a certificate warning.

## 2. Deploy the `checkout-poc` Git branch

1. In the checkout subdomain dashboard, open **Advanced → Git**.
2. Add the Ezkart repository URL.
3. Select branch **`checkout-poc`**.
4. Set the install path to the checkout subdomain's document root.
5. Click **Create** and then **Deploy**.
6. Open **Advanced → PHP Configuration**.
7. Select PHP 8.2 or 8.3.
8. Confirm cURL, PDO MySQL, JSON, and mbstring are available.

## 3. Connect the database you created

1. In hPanel, open **Databases → Management**.
2. Copy the database host, database name, and database username.
3. Open **Files → File Manager** and enter the checkout document root.
4. Copy `config.example.php` to `config.runtime.php`.
5. Edit only `config.runtime.php`.
6. Enter `db_host`, `db_port`, `db_name`, `db_user`, and `db_password`.
7. Generate separate random values for:
   - `app_signing_secret`
   - `zero_merchant_secret`
   - `biteship_webhook_secret`
8. Generate `admin_password_hash` locally with:

   ```bash
   php -r "echo password_hash('YOUR-LONG-PASSWORD', PASSWORD_DEFAULT), PHP_EOL;"
   ```

9. Keep `app_enabled` set to `false`.
10. Visit `/api/v1/health`. Confirm `"database": true`.
11. The app applies `schema.sql` automatically on the first enabled request.
    You can alternatively import `schema.sql` using phpMyAdmin.

## 4. Add Biteship sandbox configuration

1. In `config.runtime.php`, set:
   - `biteship_api_token` to the test token
   - `biteship_origin_area_id` to the Maps API area ID for the warehouse
   - `biteship_origin_area_name` to the human-readable warehouse area
   - `biteship_origin_contact_name`
   - `biteship_origin_contact_phone`
   - `biteship_origin_address`
2. Keep `app_mode` set to `sandbox`.
3. In Biteship, enable **Mode Testing**.
4. Open **Integrasi → Webhook → Tambah Webhook**.
5. Name it `Ezkart checkout sandbox`.
6. URL:

   ```text
   https://YOUR-CHECKOUT-HOST/api/v1/webhooks/biteship
   ```

7. Select events:
   - `order.status`
   - `order.price`
   - `order.waybill_id`
8. Header key: use the exact value of `biteship_webhook_header`
   (`X-Ezkart-Webhook-Secret` by default).
9. Header secret: use the exact private value of `biteship_webhook_secret`.
10. Click the add/save button. Ezkart accepts Biteship's empty JSON installation
    check with HTTP 200.

## 5. Add Duitku sandbox configuration

1. In the Duitku sandbox portal, open **My Projects**.
2. Open or create the Ezkart checkout project.
3. Website Project:

   ```text
   https://YOUR-CHECKOUT-HOST
   ```

4. Callback URL Project:

   ```text
   https://YOUR-CHECKOUT-HOST/api/v1/webhooks/duitku
   ```

5. Click **Save**.
6. Put the project's sandbox Merchant Code into `duitku_merchant_code`.
7. Put its sandbox Merchant Key into `duitku_merchant_key`.
8. Keep `duitku_enforce_callback_ip` false for the first sandbox transaction.
   Enable it after confirming the source IPs in the Duitku event logs.

The invoice request also sends this callback URL per transaction. The return
URL is generated as:

```text
https://YOUR-CHECKOUT-HOST/payment/return?session=SESSION_ID
```

The return page never marks an order paid. Only the signed server callback can.

## 6. Enable and test the hosted checkout

1. In `config.runtime.php`, set the final HTTPS `app_url`.
2. Set `allowed_return_hosts` to the Official ZERO hostnames.
3. Set `app_enabled` to `true`.
4. Open `/api/v1/health`; confirm HTTP 200 and `"ok": true`.
5. Open `/`; click each numbered API step to inspect the exact JSON.
6. Sign into `/ops` and click **Create sandbox checkout** to run the first
   end-to-end test without changing the Official ZERO website.
7. After that passes, adapt `examples/zero-create-session.php` on the Official
   ZERO server and configure the same private `zero_merchant_secret` on both
   servers.
8. Click checkout on ZERO for the merchant-handoff test.
9. Confirm the browser is redirected to `/c/cs_...` with no price or weight in
   the URL.
10. Enter a Biteship-recognized district/postcode.
11. Select a live shipping rate.
12. Confirm total = merchandise + shipping and customer platform fee = Rp0.
13. Continue to Duitku sandbox and complete the test payment.
14. Return to Ezkart and wait for **Payment confirmed**.
15. Sign into `/ops`.
16. Confirm payment = PAID, shipment created, and the ledger has:
    - CUSTOMER_PAYMENT credit
    - SHIPPING_PAYABLE debit
    - MERCHANT_PROCEEDS debit
    - MERCHANT_FEE_RECEIVABLE credit
    - PLATFORM_FEE_REVENUE debit (merchant-funded)
17. Click **Print label** and print at 100% on A5 portrait.

## 7. Complete Biteship activation evidence

1. In Biteship test mode, open **Shipping**.
2. Find the API-created test shipment.
3. Use the yellow webhook/status action to advance a test shipment through to
   Delivered.
4. Make a second test shipment and advance it to Cancelled.
5. Confirm both event sequences appear in `/ops`.
6. Use those two test Biteship order IDs in the production activation form.

## 8. Production cutover (later)

1. Rotate the Biteship test token that was previously shared in conversation.
2. Obtain and configure a `biteship_live.` token.
3. Replace Duitku sandbox credentials with approved production credentials.
4. Set `app_mode` to `production`.
5. Install the production Biteship webhook using the same route and a new
   webhook secret.
6. Enable Duitku callback IP enforcement.
7. Run one low-value controlled transaction and verify payment, settlement
   reporting, shipment, webhook transitions, and A5 label before public launch.
8. Keep Duitku settlement in the approved ZERO merchant account for this POC.
   Ezkart cannot hold or disburse third-party seller funds without an approved
   marketplace/disbursement arrangement.
