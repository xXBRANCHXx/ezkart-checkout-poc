<?php
declare(strict_types=1);

require_once __DIR__ . '/core.php';

function ez_page_start(string $title, string $bodyClass = '', array $data = []): void
{
    $attributes = '';
    foreach ($data as $key => $value) {
        $attributes .= ' data-' . ez_html($key) . '="' . ez_html((string) $value) . '"';
    }
    echo '<!doctype html><html lang="en"><head><meta charset="utf-8">'
        . '<meta name="viewport" content="width=device-width,initial-scale=1">'
        . '<meta name="description" content="Ezkart hosted checkout for ZERO Foods">'
        . '<link rel="icon" href="/assets/favicon.svg" type="image/svg+xml">'
        . '<link rel="stylesheet" href="/styles.css">'
        . '<title>' . ez_html($title) . '</title></head>'
        . '<body class="' . ez_html($bodyClass) . '"' . $attributes . '>';
}

function ez_brand_header(string $context = 'Hosted checkout'): void
{
    echo '<header class="site-header"><a class="brand" href="/">'
        . '<img src="/assets/ezkart-logo.svg" alt="Ezkart"><span>' . ez_html($context) . '</span></a>'
        . '<span class="mode-pill">' . ez_html(strtoupper(ez_mode())) . '</span></header>';
}

function ez_page_end(bool $withScript = false): void
{
    if ($withScript) {
        echo '<script src="/script.js" defer></script>';
    }
    echo '</body></html>';
}

function ez_render_home(): never
{
    ez_page_start('Ezkart Hosted Checkout');
    ez_brand_header('Commerce infrastructure');
    echo '<main class="home-shell">'
        . '<section class="hero"><div><span class="eyebrow">ZERO × EZKART PROOF OF CONCEPT</span>'
        . '<h1>One checkout.<br><em>Shipping to settlement.</em></h1>'
        . '<p>ZERO sends signed products and weights. Ezkart finds the delivery price, collects the full customer payment, creates the Biteship shipment, tracks it, and prints the label.</p>'
        . '<div class="hero-actions"><a class="primary-button" href="#api-map">Explore the live flow</a>'
        . '<a class="text-link" href="/api/v1/health">View health JSON →</a></div></div>'
        . '<aside class="flow-card"><div class="flow-node active">1 <span>Official ZERO</span><small>signed order</small></div>'
        . '<i></i><div class="flow-node">2 <span>Ezkart Checkout</span><small>rates + customer</small></div>'
        . '<i></i><div class="flow-node">3 <span>Duitku</span><small>payment</small></div>'
        . '<i></i><div class="flow-node">4 <span>Biteship</span><small>shipment + tracking</small></div></aside></section>'
        . '<section class="trust-row"><div><b>Server signed</b><span>Price and weight cannot be edited in the redirect.</span></div>'
        . '<div><b>Customer pays shipping</b><span>The merchant platform fee never enters the customer total.</span></div>'
        . '<div><b>Webhook authoritative</b><span>A browser redirect can never mark an order paid.</span></div></section>'
        . '<section id="api-map" class="api-section"><div class="section-heading"><span class="eyebrow">CLICK EACH STEP</span>'
        . '<h2>What calls what—and the JSON it uses</h2><p>The Ezkart routes are ours. Provider routes show the exact Biteship and Duitku endpoint names used by this build.</p></div>'
        . ez_api_cards()
        . '</section>'
        . '<section class="label-explainer"><div><span class="eyebrow">A5 SHIPPING LABEL</span>'
        . '<h2>Constructed by Ezkart from Biteship order data.</h2>'
        . '<p>Biteship does not expose a Shipping Label API. This service combines the response from <code>POST /v1/orders</code> and webhook updates into a Code 128 label containing the courier, routing code, tracking number, sender, recipient, weight, and instructions.</p></div>'
        . '<div class="mini-label"><strong>JNE REG</strong><div class="fake-bars"></div><b>EZKART-TEST-001</b><hr>'
        . '<small>TO</small><strong>Test Customer</strong><p>Jakarta Selatan, 12250<br>1.20 kg • 1 parcel</p></div></section>'
        . '</main><footer class="site-footer">Ezkart hosted checkout POC <span>•</span> No provider keys are exposed to the browser.</footer>';
    ez_page_end(true);
    exit;
}

function ez_api_cards(): string
{
    $cards = [
        [
            '01', 'Official ZERO → Ezkart', 'Create Checkout Session',
            'POST', '/api/v1/checkout-sessions', 'Ezkart',
            [
                'merchant_order_reference' => 'ZERO-2026-00042',
                'currency' => 'IDR',
                'items' => [[
                    'sku' => 'ZERO-SYRUP-500',
                    'name' => 'ZERO Syrup 500 ml',
                    'quantity' => 2,
                    'unit_price' => 89000,
                    'unit_weight_grams' => 650,
                ]],
                'declared_totals' => ['merchandise' => 178000, 'weight_grams' => 1300],
                'customer' => ['name' => '', 'email' => '', 'phone' => ''],
                'return_urls' => [
                    'success' => 'https://zerofoods.id/order/success',
                    'cancel' => 'https://zerofoods.id/cart',
                ],
            ],
            [
                'session_id' => 'cs_opaque_random_id',
                'status' => 'OPEN',
                'checkout_url' => 'https://checkout.example.id/c/cs_opaque_random_id',
                'expires_at' => '2026-07-31T15:30:00+07:00',
            ],
            'Headers: X-Ezkart-Merchant, X-Ezkart-Timestamp, X-Ezkart-Signature, Idempotency-Key.',
        ],
        [
            '02', 'Ezkart → Biteship', 'Search Area',
            'GET', '/v1/maps/areas?countries=ID&type=single&input=Jakarta+Selatan', 'Biteship',
            null,
            [
                'success' => true,
                'areas' => [[
                    'id' => 'IDNP6IDNC148IDND843IDZ12250',
                    'name' => 'Pesanggrahan, Jakarta Selatan, DKI Jakarta. 12250',
                    'postal_code' => 12250,
                ]],
            ],
            'Called only after the customer types at least three location characters.',
        ],
        [
            '03', 'Ezkart → Biteship', 'Retrieve Courier Rates',
            'POST', '/v1/rates/couriers', 'Biteship',
            [
                'origin_area_id' => 'ORIGIN_AREA_ID',
                'destination_area_id' => 'IDNP6IDNC148IDND843IDZ12250',
                'couriers' => 'jne,sicepat,anteraja,jnt,tiki',
                'items' => [[
                    'name' => 'ZERO Syrup 500 ml',
                    'category' => 'food_and_drink',
                    'sku' => 'ZERO-SYRUP-500',
                    'value' => 89000,
                    'quantity' => 2,
                    'weight' => 650,
                ]],
            ],
            [
                'success' => true,
                'pricing' => [[
                    'courier_name' => 'JNE',
                    'courier_code' => 'jne',
                    'courier_service_name' => 'Reguler',
                    'courier_service_code' => 'reg',
                    'duration' => '1 - 2 days',
                    'price' => 18000,
                ]],
            ],
            'Ezkart signs the selected quote for 15 minutes and calculates Rp196,000 total.',
        ],
        [
            '04', 'Ezkart → Duitku', 'Create Invoice',
            'POST', 'https://api-sandbox.duitku.com/api/merchant/createInvoice', 'Duitku',
            [
                'paymentAmount' => 196000,
                'merchantOrderId' => 'cs_opaque_random_id',
                'productDetails' => 'Ezkart order ZERO-2026-00042',
                'customerVaName' => 'Test Customer',
                'email' => 'customer@example.com',
                'phoneNumber' => '081234567890',
                'itemDetails' => [
                    ['name' => 'ZERO Syrup 500 ml', 'price' => 178000, 'quantity' => 2],
                    ['name' => 'Shipping - JNE Reguler', 'price' => 18000, 'quantity' => 1],
                ],
                'callbackUrl' => 'https://checkout.example.id/api/v1/webhooks/duitku',
                'returnUrl' => 'https://checkout.example.id/payment/return?session=cs_opaque_random_id',
                'expiryPeriod' => 15,
            ],
            [
                'merchantCode' => 'DXXXX',
                'reference' => 'DXXXXS875LXXXX32IJZ7',
                'paymentUrl' => 'https://app-sandbox.duitku.com/redirect_checkout?reference=…',
                'statusCode' => '00',
                'statusMessage' => 'SUCCESS',
            ],
            'The itemDetails prices add up exactly to paymentAmount. Website/platform fee is not charged here.',
        ],
        [
            '05', 'Duitku → Ezkart', 'Payment Callback',
            'POST FORM', '/api/v1/webhooks/duitku', 'Duitku webhook',
            [
                'merchantCode' => 'DXXXX',
                'amount' => '196000',
                'merchantOrderId' => 'cs_opaque_random_id',
                'paymentCode' => 'VA',
                'resultCode' => '00',
                'reference' => 'DXXXXCX80TXXX5Q70QCI',
                'publisherOrderId' => 'provider-order-id',
                'signature' => 'HMAC_SHA256(merchantCode + amount + merchantOrderId)',
            ],
            ['ok' => true],
            'This signed server callback—not returnUrl—changes the order to PAID.',
        ],
        [
            '06', 'Ezkart → Biteship', 'Create an Order',
            'POST', '/v1/orders', 'Biteship',
            [
                'shipper_organization' => 'ZERO Foods via Ezkart',
                'origin_contact_name' => 'ZERO Fulfillment',
                'origin_contact_phone' => '0812…',
                'origin_address' => 'Configured warehouse address',
                'origin_area_id' => 'ORIGIN_AREA_ID',
                'origin_collection_method' => 'pickup',
                'destination_contact_name' => 'Test Customer',
                'destination_contact_phone' => '081234567890',
                'destination_address' => 'Customer street address',
                'destination_area_id' => 'IDNP6IDNC148IDND843IDZ12250',
                'courier_company' => 'jne',
                'courier_type' => 'reg',
                'delivery_type' => 'now',
                'reference_id' => 'cs_opaque_random_id',
                'items' => [['name' => 'ZERO Syrup 500 ml', 'value' => 89000, 'quantity' => 2, 'weight' => 650]],
            ],
            [
                'success' => true,
                'id' => '5dd599ebdefcd4158eb8470b',
                'courier' => [
                    'tracking_id' => 'tracking-id',
                    'waybill_id' => 'WYB-1112223333443',
                    'company' => 'jne',
                    'type' => 'reg',
                    'routing_code' => 'CGK-01',
                ],
                'price' => 18000,
                'status' => 'confirmed',
            ],
            'Created only after a verified paid callback. Sandbox orders are simulated.',
        ],
        [
            '07', 'Biteship → Ezkart', 'Order Webhooks',
            'POST', '/api/v1/webhooks/biteship', 'Biteship webhook',
            [
                'event' => 'order.status',
                'order_id' => '5dd599ebdefcd4158eb8470b',
                'status' => 'dropping_off',
                'courier_tracking_id' => 'tracking-id',
                'courier_waybill_id' => 'WYB-1112223333443',
            ],
            ['received' => true, 'event' => 'order.status', 'order_id' => '5dd599ebdefcd4158eb8470b'],
            'Installed for order.status, order.price, and order.waybill_id with a custom secret header.',
        ],
        [
            '08', 'Ezkart operations', 'Render A5 Shipping Label',
            'GET', '/api/v1/orders/{session_id}/label', 'Ezkart',
            null,
            ['content_type' => 'text/html', 'paper' => 'A5 portrait', 'barcode' => 'Code 128-B'],
            'No Biteship label endpoint exists. Ezkart renders its own label from Create Order + webhook data.',
        ],
    ];
    $html = '<div class="api-grid">';
    foreach ($cards as [$number, $from, $name, $method, $endpoint, $owner, $request, $response, $note]) {
        $html .= '<details class="api-card"><summary><span class="api-number">' . $number . '</span>'
            . '<span class="api-title"><small>' . ez_html($from) . '</small><strong>' . ez_html($name) . '</strong></span>'
            . '<span class="api-method">' . ez_html($method) . '</span><span class="chevron">⌄</span></summary>'
            . '<div class="api-detail"><div class="endpoint"><span>' . ez_html($owner) . '</span><code>'
            . ez_html($endpoint) . '</code></div><p>' . ez_html($note) . '</p>';
        if ($request !== null) {
            $html .= '<div class="json-block"><div><span>REQUEST</span><button type="button" class="copy-json">Copy JSON</button></div><pre><code>'
                . ez_html((string) json_encode($request, JSON_PRETTY_PRINT | JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE))
                . '</code></pre></div>';
        }
        $html .= '<div class="json-block response"><div><span>RESPONSE</span><button type="button" class="copy-json">Copy JSON</button></div><pre><code>'
            . ez_html((string) json_encode($response, JSON_PRETTY_PRINT | JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE))
            . '</code></pre></div></div></details>';
    }
    return $html . '</div>';
}

function ez_render_checkout(string $sessionId): never
{
    ez_page_start('Secure checkout · Ezkart', 'checkout-page', ['session-id' => $sessionId, 'view' => 'checkout']);
    ez_brand_header('Secure hosted checkout');
    echo '<main class="checkout-shell"><section class="checkout-main">'
        . '<div class="checkout-heading"><span class="eyebrow">DELIVERY & PAYMENT</span><h1>Complete your order</h1>'
        . '<p>Shipping is calculated live from your location and package weight.</p></div>'
        . '<div id="checkout-alert" class="alert hidden" role="alert"></div>'
        . '<form id="checkout-form" novalidate>'
        . '<fieldset><legend><span>1</span> Contact details</legend><div class="field-grid">'
        . '<label>Full name<input name="name" autocomplete="name" required maxlength="120"></label>'
        . '<label>Email<input type="email" name="email" autocomplete="email" required maxlength="160"></label>'
        . '<label>WhatsApp / phone<input name="phone" autocomplete="tel" required maxlength="40" placeholder="0812…"></label></div></fieldset>'
        . '<fieldset><legend><span>2</span> Delivery address</legend>'
        . '<label>Search district or postcode<input id="area-search" autocomplete="off" placeholder="e.g. Pesanggrahan 12250" required></label>'
        . '<div id="area-results" class="area-results" role="listbox"></div>'
        . '<input type="hidden" name="area_id"><input type="hidden" name="area_name"><input type="hidden" name="postal_code">'
        . '<label>Street address<textarea name="address" autocomplete="street-address" required maxlength="500" placeholder="Street, building, unit, landmarks"></textarea></label>'
        . '<label>Courier note <span>(optional)</span><input name="note" maxlength="500" placeholder="Gate code or delivery instructions"></label>'
        . '<button id="rate-button" class="secondary-button" type="button">Find shipping options</button></fieldset>'
        . '<fieldset id="shipping-fieldset" class="hidden"><legend><span>3</span> Shipping service</legend>'
        . '<div id="shipping-options" class="shipping-options"></div></fieldset>'
        . '<button id="pay-button" class="primary-button wide hidden" type="submit">Continue to secure payment</button>'
        . '<p class="secure-note">Payment is processed by Duitku. Ezkart never receives your card or banking credentials.</p></form></section>'
        . '<aside class="order-summary"><span class="eyebrow">ORDER SUMMARY</span><div id="summary-loading" class="loading-lines"></div>'
        . '<div id="summary-content" class="hidden"><div id="summary-items"></div><div class="summary-totals">'
        . '<div><span>Products</span><strong id="merchandise-total"></strong></div>'
        . '<div><span>Shipping</span><strong id="shipping-total">Select location</strong></div>'
        . '<div><span>Total weight</span><strong id="weight-total"></strong></div>'
        . '<div class="grand-total"><span>Total</span><strong id="payment-total"></strong></div>'
        . '<small>Customer platform fee: Rp0</small></div></div></aside></main>';
    ez_page_end(true);
    exit;
}

function ez_render_return(string $sessionId): never
{
    ez_page_start('Payment status · Ezkart', 'return-page', ['session-id' => $sessionId, 'view' => 'return']);
    ez_brand_header('Payment status');
    echo '<main class="status-shell"><div class="status-orbit"><i></i><i></i><i></i></div>'
        . '<span class="eyebrow">VERIFYING SERVER CALLBACK</span><h1 id="status-title">Checking your payment…</h1>'
        . '<p id="status-message">Please keep this page open while Ezkart confirms the signed Duitku callback.</p>'
        . '<div id="status-details" class="status-details"></div>'
        . '<a id="status-action" class="primary-button hidden" href="/">Continue</a></main>';
    ez_page_end(true);
    exit;
}

function ez_admin_authenticated(): bool
{
    if (session_status() !== PHP_SESSION_ACTIVE) {
        session_name('ezkart_ops');
        session_set_cookie_params([
            'lifetime' => 0,
            'path' => '/',
            'secure' => !str_starts_with(ez_config('app_url'), 'http://127.0.0.1'),
            'httponly' => true,
            'samesite' => 'Strict',
        ]);
        session_start();
    }
    return isset($_SESSION['ezkart_ops_authenticated'])
        && is_int($_SESSION['ezkart_ops_authenticated'])
        && $_SESSION['ezkart_ops_authenticated'] > time() - 28800;
}

function ez_admin_login(string $password): bool
{
    $hash = ez_config('admin_password_hash');
    if ($hash === '' || !password_verify($password, $hash)) {
        usleep(400000);
        return false;
    }
    if (!ez_admin_authenticated()) {
        // ez_admin_authenticated starts the secure session.
    }
    session_regenerate_id(true);
    $_SESSION['ezkart_ops_authenticated'] = time();
    $_SESSION['ezkart_ops_csrf'] = bin2hex(random_bytes(24));
    return true;
}

function ez_admin_csrf(): string
{
    ez_admin_authenticated();
    if (!isset($_SESSION['ezkart_ops_csrf']) || !is_string($_SESSION['ezkart_ops_csrf'])) {
        $_SESSION['ezkart_ops_csrf'] = bin2hex(random_bytes(24));
    }
    return $_SESSION['ezkart_ops_csrf'];
}

function ez_admin_verify_csrf(string $token): bool
{
    $expected = ez_admin_csrf();
    return $token !== '' && hash_equals($expected, $token);
}

function ez_render_ops_login(string $error = ''): never
{
    ez_page_start('Operations login · Ezkart', 'ops-page');
    ez_brand_header('Operations');
    echo '<main class="ops-login"><span class="eyebrow">RESTRICTED</span><h1>Ezkart operations</h1>'
        . '<p>Review payments, shipment creation, webhook status, ledger entries, and print labels.</p>'
        . ($error !== '' ? '<div class="alert">' . ez_html($error) . '</div>' : '')
        . '<form method="post" action="/ops/login"><label>Operations password'
        . '<input type="password" name="password" autocomplete="current-password" required></label>'
        . '<button class="primary-button wide" type="submit">Sign in</button></form></main>';
    ez_page_end();
    exit;
}

function ez_render_ops(PDO $pdo): never
{
    $sessions = $pdo->query(
        'SELECT s.id, s.merchant_order_reference, s.status, s.merchandise_total, s.shipping_price,
                s.payment_total, s.customer_name, s.courier_name, s.courier_service_name, s.created_at,
                p.status AS payment_status, sh.status AS shipment_status, sh.waybill_id, sh.last_error
         FROM ezkart_checkout_sessions s
         LEFT JOIN ezkart_payments p ON p.session_id = s.id
         LEFT JOIN ezkart_shipments sh ON sh.session_id = s.id
         ORDER BY s.created_at DESC LIMIT 100'
    )->fetchAll();
    $ledger = $pdo->query(
        'SELECT account, direction, COUNT(*) AS entry_count, SUM(amount) AS total_amount
         FROM ezkart_ledger_entries GROUP BY account, direction ORDER BY account'
    )->fetchAll();
    $webhooks = $pdo->query(
        'SELECT provider, processing_status, COUNT(*) AS event_count, MAX(received_at) AS last_received
         FROM ezkart_webhook_events GROUP BY provider, processing_status ORDER BY provider, processing_status'
    )->fetchAll();
    ez_page_start('Operations · Ezkart', 'ops-page');
    ez_brand_header('Operations');
    echo '<main class="ops-shell"><div class="ops-heading"><div><span class="eyebrow">LIVE TRANSACTION STATE</span>'
        . '<h1>Checkout operations</h1></div><div class="ops-heading-actions">';
    if (ez_mode() === 'sandbox') {
        echo '<form method="post" action="/ops/test-checkout">'
            . '<input type="hidden" name="csrf" value="' . ez_html(ez_admin_csrf()) . '">'
            . '<button class="secondary-button" type="submit">Create sandbox checkout</button></form>';
    }
    echo '<form method="post" action="/ops/logout">'
        . '<input type="hidden" name="csrf" value="' . ez_html(ez_admin_csrf()) . '">'
        . '<button class="text-button" type="submit">Sign out</button></form></div></div>'
        . '<section class="ops-panels"><article><span>Mode</span><strong>' . ez_html(strtoupper(ez_mode())) . '</strong></article>'
        . '<article><span>Orders</span><strong>' . count($sessions) . '</strong></article>'
        . '<article><span>Paid value</span><strong>Rp' . number_format((float) array_sum(array_map(
            static fn (array $row): int => ($row['status'] ?? '') === 'PAID' ? (int) $row['payment_total'] : 0,
            $sessions
        )), 0, ',', '.') . '</strong></article>'
        . '<article><span>Shipment errors</span><strong>' . count(array_filter(
            $sessions,
            static fn (array $row): bool => trim((string) ($row['last_error'] ?? '')) !== ''
        )) . '</strong></article></section>'
        . '<section class="ops-section"><h2>Recent checkouts</h2><div class="table-wrap"><table><thead><tr>'
        . '<th>Order</th><th>Customer</th><th>Payment</th><th>Shipping</th><th>Total</th><th>Created</th><th>Action</th>'
        . '</tr></thead><tbody>';
    foreach ($sessions as $row) {
        $shipmentText = trim((string) ($row['courier_name'] ?? '') . ' ' . (string) ($row['courier_service_name'] ?? ''));
        if ((string) ($row['shipment_status'] ?? '') !== '') {
            $shipmentText .= ' · ' . (string) $row['shipment_status'];
        }
        echo '<tr><td><strong>' . ez_html((string) $row['merchant_order_reference']) . '</strong><small>'
            . ez_html((string) $row['id']) . '</small></td><td>' . ez_html((string) $row['customer_name']) . '</td>'
            . '<td><span class="status-tag status-' . ez_html(strtolower((string) $row['status'])) . '">'
            . ez_html((string) ($row['payment_status'] ?: $row['status'])) . '</span></td>'
            . '<td>' . ez_html($shipmentText !== '' ? $shipmentText : 'Not created')
            . ((string) ($row['last_error'] ?? '') !== '' ? '<small class="error-text">' . ez_html((string) $row['last_error']) . '</small>' : '')
            . '</td><td>Rp' . number_format((float) $row['payment_total'], 0, ',', '.') . '</td>'
            . '<td>' . ez_html(ez_iso((string) $row['created_at'])) . '</td><td class="actions">';
        if ((string) ($row['waybill_id'] ?? '') !== '') {
            echo '<a href="/api/v1/orders/' . rawurlencode((string) $row['id']) . '/label" target="_blank">Print label</a>';
        }
        if ((string) $row['status'] === 'PAID' && (string) ($row['shipment_status'] ?? '') === '') {
            echo '<form method="post" action="/ops/shipments/retry"><input type="hidden" name="session_id" value="'
                . ez_html((string) $row['id']) . '"><input type="hidden" name="csrf" value="'
                . ez_html(ez_admin_csrf()) . '"><button type="submit">Retry shipment</button></form>';
        }
        echo '</td></tr>';
    }
    if ($sessions === []) {
        echo '<tr><td colspan="7" class="empty-state">No checkout sessions yet.</td></tr>';
    }
    echo '</tbody></table></div></section><div class="ops-columns"><section class="ops-section"><h2>Fund ledger</h2>'
        . '<p class="section-note">Operational allocation only. Duitku settlement remains in the approved merchant account.</p>';
    foreach ($ledger as $row) {
        echo '<div class="metric-row"><span>' . ez_html(str_replace('_', ' ', (string) $row['account']))
            . '<small>' . ez_html((string) $row['direction']) . ' · ' . (int) $row['entry_count'] . ' entries</small></span>'
            . '<strong>Rp' . number_format((float) $row['total_amount'], 0, ',', '.') . '</strong></div>';
    }
    if ($ledger === []) {
        echo '<p class="empty-state">Ledger entries appear after a verified payment.</p>';
    }
    echo '</section><section class="ops-section"><h2>Webhook health</h2>';
    foreach ($webhooks as $row) {
        echo '<div class="metric-row"><span>' . ez_html(ucfirst((string) $row['provider']))
            . '<small>' . ez_html((string) $row['processing_status']) . '</small></span>'
            . '<strong>' . (int) $row['event_count'] . '</strong></div>';
    }
    if ($webhooks === []) {
        echo '<p class="empty-state">No provider webhook has arrived yet.</p>';
    }
    echo '</section></div></main>';
    ez_page_end();
    exit;
}

function ez_render_error_page(int $status, string $message): never
{
    http_response_code($status);
    ez_page_start($status . ' · Ezkart');
    ez_brand_header('Hosted checkout');
    echo '<main class="status-shell"><span class="eyebrow">EZKART</span><h1>' . $status . '</h1><p>'
        . ez_html($message) . '</p><a class="primary-button" href="/">Back to service map</a></main>';
    ez_page_end();
    exit;
}
