<?php
declare(strict_types=1);

require_once __DIR__ . '/core.php';

const EZ_BITESHIP_BASE_URL = 'https://api.biteship.com';
const EZ_DUITKU_SANDBOX_URL = 'https://api-sandbox.duitku.com/api/merchant/createInvoice';
const EZ_DUITKU_PRODUCTION_URL = 'https://api-prod.duitku.com/api/merchant/createInvoice';

function ez_biteship_token(): string
{
    $token = ez_config('biteship_api_token');
    $prefix = ez_mode() === 'production' ? 'biteship_live.' : 'biteship_test.';
    if (!str_starts_with($token, $prefix)) {
        throw new RuntimeException('Biteship token does not match the Ezkart mode.');
    }
    return $token;
}

function ez_biteship_request(string $method, string $path, ?array $payload = null): array
{
    $authorization = trim(ez_config('biteship_authorization_prefix') . ' ' . ez_biteship_token());
    return ez_http_json(
        $method,
        EZ_BITESHIP_BASE_URL . '/' . ltrim($path, '/'),
        $payload,
        [
            'Authorization: ' . $authorization,
            'Content-Type: application/json',
        ]
    );
}

function ez_biteship_areas(string $query): array
{
    $query = trim(preg_replace('/\s+/', ' ', $query) ?? '');
    if (mb_strlen($query) < 3 || mb_strlen($query) > 120) {
        throw new InvalidArgumentException('Enter at least three characters to search an area.');
    }
    $response = ez_biteship_request(
        'GET',
        'v1/maps/areas?countries=ID&type=single&input=' . rawurlencode($query)
    );
    return array_values(array_map(static fn (array $area): array => [
        'id' => (string) ($area['id'] ?? ''),
        'name' => (string) ($area['name'] ?? ''),
        'postal_code' => (string) ($area['postal_code'] ?? ''),
        'city' => (string) ($area['administrative_division_level_2_name'] ?? ''),
        'province' => (string) ($area['administrative_division_level_1_name'] ?? ''),
    ], array_filter($response['areas'] ?? [], 'is_array')));
}

function ez_normalize_items(array $payload): array
{
    $requested = is_array($payload['items'] ?? null)
        ? array_values(array_filter($payload['items'], 'is_array'))
        : [];
    if ($requested === [] || count($requested) > 50) {
        throw new InvalidArgumentException('Checkout requires between one and 50 line items.');
    }
    return array_map(static function (array $item): array {
        $sku = trim((string) ($item['sku'] ?? ''));
        $name = trim((string) ($item['name'] ?? ''));
        $quantity = (int) ($item['quantity'] ?? 0);
        $unitPrice = (int) ($item['unit_price'] ?? 0);
        $unitWeight = (int) ($item['unit_weight_grams'] ?? 0);
        if (
            $sku === ''
            || $name === ''
            || $quantity < 1
            || $quantity > 100
            || $unitPrice < 1
            || $unitWeight < 1
        ) {
            throw new InvalidArgumentException('A checkout line item is invalid.');
        }
        return [
            'sku' => mb_substr($sku, 0, 120),
            'name' => mb_substr($name, 0, 160),
            'quantity' => $quantity,
            'unit_price' => $unitPrice,
            'unit_weight_grams' => $unitWeight,
            'line_total' => $unitPrice * $quantity,
            'line_weight_grams' => $unitWeight * $quantity,
        ];
    }, $requested);
}

function ez_item_totals(array $items): array
{
    return array_reduce($items, static fn (array $totals, array $item): array => [
        'merchandise' => $totals['merchandise'] + (int) $item['line_total'],
        'weight_grams' => $totals['weight_grams'] + (int) $item['line_weight_grams'],
    ], ['merchandise' => 0, 'weight_grams' => 0]);
}

function ez_sandbox_cart_payload(array $request, ?string $reference = null): array
{
    $catalog = [
        'granola' => [
            'sku' => 'EZK-DEMO-GRANOLA',
            'name' => 'Granola Madu Nusantara',
            'unit_price' => 58000,
            'unit_weight_grams' => 320,
        ],
        'coffee' => [
            'sku' => 'EZK-DEMO-COFFEE',
            'name' => 'Kopi Susu Concentrate',
            'unit_price' => 79000,
            'unit_weight_grams' => 650,
        ],
        'sambal' => [
            'sku' => 'EZK-DEMO-SAMBAL',
            'name' => 'Sambal Roa Signature',
            'unit_price' => 46000,
            'unit_weight_grams' => 260,
        ],
    ];
    $quantities = is_array($request['quantity'] ?? null) ? $request['quantity'] : [];
    $items = [];
    $itemCount = 0;
    foreach ($catalog as $id => $product) {
        $rawQuantity = $quantities[$id] ?? 0;
        if (filter_var($rawQuantity, FILTER_VALIDATE_INT) === false) {
            throw new InvalidArgumentException('A sandbox cart quantity is invalid.');
        }
        $quantity = (int) $rawQuantity;
        if ($quantity < 0 || $quantity > 9) {
            throw new InvalidArgumentException('Sandbox cart quantities must be between 0 and 9.');
        }
        if ($quantity === 0) {
            continue;
        }
        $items[] = $product + ['quantity' => $quantity];
        $itemCount += $quantity;
    }
    if ($itemCount < 1 || $itemCount > 9) {
        throw new InvalidArgumentException('Add between 1 and 9 products to the sandbox cart.');
    }
    $items = ez_normalize_items(['items' => $items]);
    $totals = ez_item_totals($items);
    $reference ??= 'EZK-DEMO-' . gmdate('Ymd-His') . '-' . strtoupper(bin2hex(random_bytes(2)));
    return [
        'merchant_order_reference' => $reference,
        'currency' => 'IDR',
        'items' => array_map(static fn (array $item): array => [
            'sku' => $item['sku'],
            'name' => $item['name'],
            'quantity' => $item['quantity'],
            'unit_price' => $item['unit_price'],
            'unit_weight_grams' => $item['unit_weight_grams'],
        ], $items),
        'declared_totals' => $totals,
        'customer' => ['name' => '', 'email' => '', 'phone' => ''],
        'return_urls' => [
            'success' => 'https://zerofoods.id',
            'cancel' => 'https://zerofoods.id/cart',
        ],
    ];
}

function ez_require_sandbox_cart_origin(string $origin, string $referer = ''): void
{
    $source = trim($origin) !== '' ? trim($origin) : trim($referer);
    $host = strtolower((string) parse_url($source, PHP_URL_HOST));
    $scheme = strtolower((string) parse_url($source, PHP_URL_SCHEME));
    if ($scheme !== 'https' || !in_array($host, ['ezkart.id', 'www.ezkart.id'], true)) {
        throw new InvalidArgumentException('Start the sandbox checkout from ezkart.id/cart.');
    }
}

function ez_session_response(array $session): array
{
    $appUrl = rtrim(ez_config('app_url', 'https://checkout.zerofoods.id'), '/');
    return [
        'session_id' => (string) $session['id'],
        'status' => (string) $session['status'],
        'checkout_url' => $appUrl . '/c/' . rawurlencode((string) $session['id']),
        'expires_at' => ez_iso((string) $session['expires_at']),
    ];
}

function ez_create_session(PDO $pdo, string $merchant, array $payload, string $idempotencyKey): array
{
    $idempotencyKey = trim($idempotencyKey);
    $reference = trim((string) ($payload['merchant_order_reference'] ?? ''));
    if (strlen($idempotencyKey) < 16 || strlen($idempotencyKey) > 160 || $reference === '' || strlen($reference) > 100) {
        throw new InvalidArgumentException('Merchant reference or idempotency key is invalid.');
    }
    $existing = $pdo->prepare(
        'SELECT * FROM ezkart_checkout_sessions
         WHERE merchant_slug = :merchant AND idempotency_key = :idempotency_key LIMIT 1'
    );
    $existing->execute([':merchant' => $merchant, ':idempotency_key' => $idempotencyKey]);
    $row = $existing->fetch();
    if (is_array($row)) {
        return ez_session_response($row);
    }

    $items = ez_normalize_items($payload);
    $totals = ez_item_totals($items);
    $declared = is_array($payload['declared_totals'] ?? null) ? $payload['declared_totals'] : [];
    if (
        (int) ($declared['merchandise'] ?? -1) !== $totals['merchandise']
        || (int) ($declared['weight_grams'] ?? -1) !== $totals['weight_grams']
    ) {
        throw new InvalidArgumentException('Declared totals do not match the signed line items.');
    }
    $currency = strtoupper(trim((string) ($payload['currency'] ?? 'IDR')));
    if ($currency !== 'IDR') {
        throw new InvalidArgumentException('Ezkart POC accepts IDR only.');
    }
    $returnUrls = is_array($payload['return_urls'] ?? null) ? $payload['return_urls'] : [];
    $successUrl = ez_allowed_return_url((string) ($returnUrls['success'] ?? ''));
    $cancelUrl = ez_allowed_return_url((string) ($returnUrls['cancel'] ?? ''));
    $customer = is_array($payload['customer'] ?? null) ? $payload['customer'] : [];
    $sessionId = ez_id('cs');
    $now = ez_now();
    $expires = (new DateTimeImmutable('+30 minutes', new DateTimeZone('UTC')))->format('Y-m-d H:i:s.u');
    $merchantFee = max(0, (int) ez_config('merchant_platform_fee', '0'));

    $pdo->beginTransaction();
    try {
        $insert = $pdo->prepare(
            'INSERT INTO ezkart_checkout_sessions
                (id, merchant_slug, merchant_order_reference, idempotency_key, currency, status,
                 merchandise_total, total_weight_grams, payment_total, merchant_platform_fee,
                 customer_name, customer_email, customer_phone, success_url, cancel_url,
                 expires_at, created_at, updated_at)
             VALUES
                (:id, :merchant_slug, :merchant_order_reference, :idempotency_key, :currency, "OPEN",
                 :merchandise_total, :total_weight_grams, :payment_total, :merchant_platform_fee,
                 :customer_name, :customer_email, :customer_phone, :success_url, :cancel_url,
                 :expires_at, :created_at, :updated_at)'
        );
        $insert->execute([
            ':id' => $sessionId,
            ':merchant_slug' => $merchant,
            ':merchant_order_reference' => $reference,
            ':idempotency_key' => $idempotencyKey,
            ':currency' => $currency,
            ':merchandise_total' => $totals['merchandise'],
            ':total_weight_grams' => $totals['weight_grams'],
            ':payment_total' => $totals['merchandise'],
            ':merchant_platform_fee' => $merchantFee,
            ':customer_name' => mb_substr(trim((string) ($customer['name'] ?? '')), 0, 120),
            ':customer_email' => mb_substr(trim(strtolower((string) ($customer['email'] ?? ''))), 0, 160),
            ':customer_phone' => mb_substr(trim((string) ($customer['phone'] ?? '')), 0, 40),
            ':success_url' => $successUrl,
            ':cancel_url' => $cancelUrl,
            ':expires_at' => $expires,
            ':created_at' => $now,
            ':updated_at' => $now,
        ]);
        $itemInsert = $pdo->prepare(
            'INSERT INTO ezkart_checkout_items
                (session_id, sku, item_name, quantity, unit_price, unit_weight_grams,
                 line_total, line_weight_grams, created_at)
             VALUES
                (:session_id, :sku, :item_name, :quantity, :unit_price, :unit_weight_grams,
                 :line_total, :line_weight_grams, :created_at)'
        );
        foreach ($items as $item) {
            $itemInsert->execute([
                ':session_id' => $sessionId,
                ':sku' => $item['sku'],
                ':item_name' => $item['name'],
                ':quantity' => $item['quantity'],
                ':unit_price' => $item['unit_price'],
                ':unit_weight_grams' => $item['unit_weight_grams'],
                ':line_total' => $item['line_total'],
                ':line_weight_grams' => $item['line_weight_grams'],
                ':created_at' => $now,
            ]);
        }
        $pdo->commit();
    } catch (Throwable $error) {
        $pdo->rollBack();
        throw $error;
    }
    return [
        'session_id' => $sessionId,
        'status' => 'OPEN',
        'checkout_url' => rtrim(ez_config('app_url', 'https://checkout.zerofoods.id'), '/') . '/c/' . $sessionId,
        'expires_at' => ez_iso($expires),
    ];
}

function ez_session(PDO $pdo, string $sessionId, bool $forUpdate = false): array
{
    $sql = 'SELECT * FROM ezkart_checkout_sessions WHERE id = :id LIMIT 1' . ($forUpdate ? ' FOR UPDATE' : '');
    $stmt = $pdo->prepare($sql);
    $stmt->execute([':id' => trim($sessionId)]);
    $session = $stmt->fetch();
    if (!is_array($session)) {
        throw new RuntimeException('Checkout session was not found.');
    }
    return $session;
}

function ez_session_items(PDO $pdo, string $sessionId): array
{
    $stmt = $pdo->prepare(
        'SELECT sku, item_name AS name, quantity, unit_price, unit_weight_grams,
                line_total, line_weight_grams
         FROM ezkart_checkout_items WHERE session_id = :session_id ORDER BY id'
    );
    $stmt->execute([':session_id' => $sessionId]);
    return $stmt->fetchAll();
}

function ez_public_session(PDO $pdo, string $sessionId): array
{
    $session = ez_session($pdo, $sessionId);
    $payment = $pdo->prepare(
        'SELECT status, provider_reference FROM ezkart_payments WHERE session_id = :session_id LIMIT 1'
    );
    $payment->execute([':session_id' => $sessionId]);
    $paymentRow = $payment->fetch();
    $shipment = $pdo->prepare(
        'SELECT status, tracking_id, waybill_id FROM ezkart_shipments WHERE session_id = :session_id LIMIT 1'
    );
    $shipment->execute([':session_id' => $sessionId]);
    $shipmentRow = $shipment->fetch();
    return [
        'id' => (string) $session['id'],
        'merchant' => (string) $session['merchant_slug'],
        'merchant_order_reference' => (string) $session['merchant_order_reference'],
        'currency' => (string) $session['currency'],
        'status' => (string) $session['status'],
        'items' => ez_session_items($pdo, $sessionId),
        'merchandise_total' => (int) $session['merchandise_total'],
        'total_weight_grams' => (int) $session['total_weight_grams'],
        'shipping_price' => (int) $session['shipping_price'],
        'payment_total' => (int) $session['payment_total'],
        'customer_platform_fee' => 0,
        'customer' => [
            'name' => (string) $session['customer_name'],
            'email' => (string) $session['customer_email'],
            'phone' => (string) $session['customer_phone'],
        ],
        'shipping' => [
            'area_name' => (string) $session['destination_area_name'],
            'courier' => trim((string) $session['courier_name'] . ' ' . (string) $session['courier_service_name']),
            'duration' => (string) $session['courier_duration'],
        ],
        'payment' => is_array($paymentRow) ? [
            'status' => (string) $paymentRow['status'],
            'reference' => (string) $paymentRow['provider_reference'],
        ] : ['status' => 'NOT_STARTED', 'reference' => ''],
        'shipment' => is_array($shipmentRow) ? [
            'status' => (string) $shipmentRow['status'],
            'tracking_id' => (string) $shipmentRow['tracking_id'],
            'waybill_id' => (string) $shipmentRow['waybill_id'],
        ] : ['status' => 'NOT_CREATED', 'tracking_id' => '', 'waybill_id' => ''],
        'success_url' => (string) $session['success_url'],
        'cancel_url' => (string) $session['cancel_url'],
        'expires_at' => ez_iso((string) $session['expires_at']),
    ];
}

function ez_biteship_items(array $items): array
{
    return array_map(static fn (array $item): array => [
        'name' => mb_substr((string) $item['name'], 0, 100),
        'description' => 'Ezkart hosted checkout',
        'category' => 'food_and_drink',
        'sku' => (string) $item['sku'],
        'value' => (int) $item['unit_price'],
        'quantity' => (int) $item['quantity'],
        'weight' => (int) $item['unit_weight_grams'],
    ], $items);
}

function ez_shipping_rates(PDO $pdo, array $payload): array
{
    $sessionId = trim((string) ($payload['session_id'] ?? ''));
    $session = ez_session($pdo, $sessionId);
    if (new DateTimeImmutable((string) $session['expires_at'], new DateTimeZone('UTC')) < new DateTimeImmutable('now', new DateTimeZone('UTC'))) {
        throw new InvalidArgumentException('Checkout session has expired.');
    }
    if (!in_array((string) $session['status'], ['OPEN', 'QUOTED'], true)) {
        throw new InvalidArgumentException('Shipping cannot be changed for this checkout.');
    }
    $areaId = trim((string) ($payload['destination_area_id'] ?? ''));
    $areaName = trim((string) ($payload['destination_area_name'] ?? ''));
    $postalCode = preg_replace('/\D/', '', (string) ($payload['destination_postal_code'] ?? '')) ?? '';
    $originArea = ez_config('biteship_origin_area_id');
    if ($areaId === '' || $areaName === '' || $postalCode === '' || $originArea === '') {
        throw new InvalidArgumentException('Select a valid Biteship destination area.');
    }
    $items = ez_session_items($pdo, $sessionId);
    $response = ez_biteship_request('POST', 'v1/rates/couriers', [
        'origin_area_id' => $originArea,
        'destination_area_id' => $areaId,
        'couriers' => ez_config('biteship_couriers', 'jne,sicepat,anteraja,jnt,tiki'),
        'items' => ez_biteship_items($items),
    ]);
    $rates = [];
    foreach (array_filter($response['pricing'] ?? [], 'is_array') as $pricing) {
        $price = (int) round((float) ($pricing['price'] ?? 0));
        $company = trim((string) ($pricing['courier_code'] ?? $pricing['company'] ?? ''));
        $type = trim((string) ($pricing['courier_service_code'] ?? $pricing['type'] ?? ''));
        if ($price < 1 || $company === '' || $type === '') {
            continue;
        }
        $methods = is_array($pricing['available_collection_method'] ?? null)
            ? $pricing['available_collection_method']
            : [];
        $collection = in_array('pickup', $methods, true) ? 'pickup' : (string) ($methods[0] ?? 'pickup');
        $quote = [
            'version' => 1,
            'session_id' => $sessionId,
            'expires_at' => time() + 900,
            'destination_area_id' => $areaId,
            'destination_area_name' => mb_substr($areaName, 0, 255),
            'destination_postal_code' => mb_substr($postalCode, 0, 20),
            'courier_company' => $company,
            'courier_type' => $type,
            'courier_name' => (string) ($pricing['courier_name'] ?? strtoupper($company)),
            'courier_service_name' => (string) ($pricing['courier_service_name'] ?? strtoupper($type)),
            'courier_duration' => (string) ($pricing['duration'] ?? ''),
            'collection_method' => in_array($collection, ['pickup', 'drop_off'], true) ? $collection : 'pickup',
            'shipping_price' => $price,
            'payment_total' => (int) $session['merchandise_total'] + $price,
        ];
        $rates[] = $quote + ['quote_token' => ez_signed_token($quote)];
    }
    usort($rates, static fn (array $a, array $b): int => $a['shipping_price'] <=> $b['shipping_price']);
    if ($rates === []) {
        throw new RuntimeException('No shipping services are available for this destination.');
    }
    return [
        'rates' => $rates,
        'merchandise_total' => (int) $session['merchandise_total'],
        'total_weight_grams' => (int) $session['total_weight_grams'],
    ];
}

function ez_duitku_credentials(): array
{
    $code = ez_config('duitku_merchant_code');
    $key = ez_config('duitku_merchant_key');
    if ($code === '' || $key === '') {
        throw new RuntimeException('Duitku credentials are not configured.');
    }
    return ['code' => $code, 'key' => $key];
}

function ez_duitku_invoice(PDO $pdo, array $session): array
{
    $credentials = ez_duitku_credentials();
    $items = array_map(static fn (array $item): array => [
        'name' => mb_substr((string) $item['name'], 0, 50),
        'price' => (int) $item['line_total'],
        'quantity' => (int) $item['quantity'],
    ], ez_session_items($pdo, (string) $session['id']));
    $items[] = [
        'name' => 'Shipping - ' . mb_substr(trim((string) $session['courier_name'] . ' ' . (string) $session['courier_service_name']), 0, 38),
        'price' => (int) $session['shipping_price'],
        'quantity' => 1,
    ];
    $lineSum = array_reduce($items, static fn (int $sum, array $item): int => $sum + (int) $item['price'], 0);
    if ($lineSum !== (int) $session['payment_total']) {
        throw new RuntimeException('Duitku line items do not match the payment total.');
    }
    $timestamp = (string) round(microtime(true) * 1000);
    $signature = hash_hmac('sha256', $credentials['code'] . $timestamp, $credentials['key']);
    $appUrl = rtrim(ez_config('app_url', 'https://checkout.zerofoods.id'), '/');
    $payload = [
        'paymentAmount' => (int) $session['payment_total'],
        'merchantOrderId' => (string) $session['id'],
        'productDetails' => 'Ezkart order ' . $session['merchant_order_reference'],
        'additionalParam' => '',
        'merchantUserInfo' => (string) $session['customer_email'],
        'paymentMethod' => '',
        'customerVaName' => mb_substr((string) $session['customer_name'], 0, 20),
        'email' => (string) $session['customer_email'],
        'phoneNumber' => (string) $session['customer_phone'],
        'itemDetails' => $items,
        'callbackUrl' => $appUrl . '/api/v1/webhooks/duitku',
        'returnUrl' => $appUrl . '/payment/return?session=' . rawurlencode((string) $session['id']),
        'expiryPeriod' => 15,
    ];
    $url = ez_mode() === 'production' ? EZ_DUITKU_PRODUCTION_URL : EZ_DUITKU_SANDBOX_URL;
    return ez_http_json('POST', $url, $payload, [
        'Content-Type: application/json',
        'x-duitku-timestamp: ' . $timestamp,
        'x-duitku-signature: ' . $signature,
        'x-duitku-merchantcode: ' . $credentials['code'],
    ]);
}

function ez_start_payment(PDO $pdo, array $payload): array
{
    $quote = ez_verify_token((string) ($payload['quote_token'] ?? ''));
    $sessionId = trim((string) ($payload['session_id'] ?? ''));
    if (!hash_equals((string) ($quote['session_id'] ?? ''), $sessionId)) {
        throw new InvalidArgumentException('Shipping quote does not belong to this checkout.');
    }
    $customer = is_array($payload['customer'] ?? null) ? $payload['customer'] : [];
    $name = trim((string) ($customer['name'] ?? ''));
    $email = strtolower(trim((string) ($customer['email'] ?? '')));
    $phone = preg_replace('/[^\d+]/', '', (string) ($customer['phone'] ?? '')) ?? '';
    $address = trim((string) ($customer['address'] ?? ''));
    $note = trim((string) ($customer['note'] ?? ''));
    if (mb_strlen($name) < 2 || !filter_var($email, FILTER_VALIDATE_EMAIL) || strlen($phone) < 8 || mb_strlen($address) < 5) {
        throw new InvalidArgumentException('Name, email, phone, and detailed delivery address are required.');
    }

    $pdo->beginTransaction();
    try {
        $session = ez_session($pdo, $sessionId, true);
        if (!in_array((string) $session['status'], ['OPEN', 'QUOTED', 'PAYMENT_PENDING'], true)) {
            throw new InvalidArgumentException('This checkout can no longer start a payment.');
        }
        if (
            new DateTimeImmutable((string) $session['expires_at'], new DateTimeZone('UTC'))
            < new DateTimeImmutable('now', new DateTimeZone('UTC'))
        ) {
            throw new InvalidArgumentException('Checkout session has expired.');
        }
        $paymentTotal = (int) $session['merchandise_total'] + (int) $quote['shipping_price'];
        if ($paymentTotal !== (int) $quote['payment_total']) {
            throw new InvalidArgumentException('Checkout total changed. Refresh shipping rates.');
        }
        $now = ez_now();
        $pdo->prepare(
            'UPDATE ezkart_checkout_sessions
             SET status = "PAYMENT_PENDING", shipping_price = :shipping_price, payment_total = :payment_total,
                 customer_name = :customer_name, customer_email = :customer_email, customer_phone = :customer_phone,
                 destination_address = :destination_address, destination_note = :destination_note,
                 destination_area_id = :destination_area_id, destination_area_name = :destination_area_name,
                 destination_postal_code = :destination_postal_code, courier_company = :courier_company,
                 courier_type = :courier_type, courier_name = :courier_name,
                 courier_service_name = :courier_service_name, courier_duration = :courier_duration,
                 collection_method = :collection_method, quote_token = :quote_token, updated_at = :updated_at
             WHERE id = :id'
        )->execute([
            ':shipping_price' => (int) $quote['shipping_price'],
            ':payment_total' => $paymentTotal,
            ':customer_name' => mb_substr($name, 0, 120),
            ':customer_email' => mb_substr($email, 0, 160),
            ':customer_phone' => mb_substr($phone, 0, 40),
            ':destination_address' => mb_substr($address, 0, 500),
            ':destination_note' => mb_substr($note, 0, 500),
            ':destination_area_id' => (string) $quote['destination_area_id'],
            ':destination_area_name' => mb_substr((string) $quote['destination_area_name'], 0, 255),
            ':destination_postal_code' => mb_substr((string) $quote['destination_postal_code'], 0, 20),
            ':courier_company' => (string) $quote['courier_company'],
            ':courier_type' => (string) $quote['courier_type'],
            ':courier_name' => mb_substr((string) $quote['courier_name'], 0, 120),
            ':courier_service_name' => mb_substr((string) $quote['courier_service_name'], 0, 160),
            ':courier_duration' => mb_substr((string) $quote['courier_duration'], 0, 80),
            ':collection_method' => (string) $quote['collection_method'],
            ':quote_token' => (string) $payload['quote_token'],
            ':updated_at' => $now,
            ':id' => $sessionId,
        ]);
        $pdo->prepare(
            'INSERT IGNORE INTO ezkart_payments
                (session_id, amount, status, created_at, updated_at)
             VALUES (:session_id, :amount, "PENDING", :created_at, :updated_at)'
        )->execute([
            ':session_id' => $sessionId,
            ':amount' => $paymentTotal,
            ':created_at' => $now,
            ':updated_at' => $now,
        ]);
        $pdo->commit();
    } catch (Throwable $error) {
        $pdo->rollBack();
        throw $error;
    }

    $paymentStmt = $pdo->prepare('SELECT * FROM ezkart_payments WHERE session_id = :session_id LIMIT 1');
    $paymentStmt->execute([':session_id' => $sessionId]);
    $payment = $paymentStmt->fetch();
    if (is_array($payment) && (string) $payment['provider_payment_url'] !== '') {
        return [
            'session_id' => $sessionId,
            'payment_url' => (string) $payment['provider_payment_url'],
            'reference' => (string) $payment['provider_reference'],
            'payment_total' => (int) $payment['amount'],
        ];
    }
    $session = ez_session($pdo, $sessionId);
    $invoice = ez_duitku_invoice($pdo, $session);
    if ((string) ($invoice['statusCode'] ?? '') !== '00' || trim((string) ($invoice['paymentUrl'] ?? '')) === '') {
        throw new RuntimeException((string) ($invoice['statusMessage'] ?? 'Duitku did not create a payment invoice.'));
    }
    $pdo->prepare(
        'UPDATE ezkart_payments
         SET provider_reference = :reference, provider_payment_url = :payment_url, updated_at = :updated_at
         WHERE session_id = :session_id'
    )->execute([
        ':reference' => mb_substr((string) ($invoice['reference'] ?? ''), 0, 160),
        ':payment_url' => mb_substr((string) $invoice['paymentUrl'], 0, 500),
        ':updated_at' => ez_now(),
        ':session_id' => $sessionId,
    ]);
    return [
        'session_id' => $sessionId,
        'payment_url' => (string) $invoice['paymentUrl'],
        'reference' => (string) ($invoice['reference'] ?? ''),
        'payment_total' => (int) $session['payment_total'],
    ];
}

function ez_record_webhook(PDO $pdo, string $provider, string $event, string $raw): bool
{
    $hash = hash('sha256', $raw);
    $stmt = $pdo->prepare(
        'INSERT IGNORE INTO ezkart_webhook_events
            (provider, event_type, dedupe_hash, payload_json, processing_status, received_at)
         VALUES (:provider, :event_type, :dedupe_hash, :payload_json, "RECEIVED", :received_at)'
    );
    $stmt->execute([
        ':provider' => $provider,
        ':event_type' => mb_substr($event, 0, 100),
        ':dedupe_hash' => $hash,
        ':payload_json' => $raw,
        ':received_at' => ez_now(),
    ]);
    return $stmt->rowCount() > 0;
}

function ez_finish_webhook(PDO $pdo, string $provider, string $raw, string $status, string $error = ''): void
{
    $pdo->prepare(
        'UPDATE ezkart_webhook_events
         SET processing_status = :processing_status, processing_error = :processing_error, processed_at = :processed_at
         WHERE provider = :provider AND dedupe_hash = :dedupe_hash'
    )->execute([
        ':processing_status' => $status,
        ':processing_error' => mb_substr($error, 0, 500),
        ':processed_at' => ez_now(),
        ':provider' => $provider,
        ':dedupe_hash' => hash('sha256', $raw),
    ]);
}

function ez_ledger_paid(PDO $pdo, array $session): void
{
    $entries = [
        ['CUSTOMER_PAYMENT', 'CREDIT', (int) $session['payment_total'], 'Customer payment received through Duitku'],
        ['SHIPPING_PAYABLE', 'DEBIT', (int) $session['shipping_price'], 'Customer-funded shipping payable'],
        ['MERCHANT_PROCEEDS', 'DEBIT', (int) $session['merchandise_total'], 'Merchandise proceeds owed to the approved merchant'],
        ['MERCHANT_FEE_RECEIVABLE', 'CREDIT', (int) $session['merchant_platform_fee'], 'Website fee owed separately by merchant'],
        ['PLATFORM_FEE_REVENUE', 'DEBIT', (int) $session['merchant_platform_fee'], 'Platform fee paid by merchant, never customer'],
    ];
    $stmt = $pdo->prepare(
        'INSERT IGNORE INTO ezkart_ledger_entries
            (session_id, account, direction, amount, currency, description, created_at)
         VALUES (:session_id, :account, :direction, :amount, "IDR", :description, :created_at)'
    );
    foreach ($entries as [$account, $direction, $amount, $description]) {
        $stmt->execute([
            ':session_id' => $session['id'],
            ':account' => $account,
            ':direction' => $direction,
            ':amount' => $amount,
            ':description' => $description,
            ':created_at' => ez_now(),
        ]);
    }
}

function ez_create_shipment(PDO $pdo, string $sessionId): array
{
    $existing = $pdo->prepare('SELECT * FROM ezkart_shipments WHERE session_id = :session_id LIMIT 1');
    $existing->execute([':session_id' => $sessionId]);
    $shipment = $existing->fetch();
    if (is_array($shipment) && (string) $shipment['provider_order_id'] !== '') {
        return $shipment;
    }
    $session = ez_session($pdo, $sessionId);
    if ((string) $session['status'] !== 'PAID') {
        throw new RuntimeException('Shipment creation requires a paid checkout.');
    }
    $originName = ez_config('biteship_origin_contact_name');
    $originPhone = ez_config('biteship_origin_contact_phone');
    $originAddress = ez_config('biteship_origin_address');
    $originArea = ez_config('biteship_origin_area_id');
    if ($originName === '' || $originPhone === '' || $originAddress === '' || $originArea === '') {
        throw new RuntimeException('Biteship origin configuration is incomplete.');
    }
    $now = ez_now();
    $pdo->prepare(
        'INSERT IGNORE INTO ezkart_shipments
            (session_id, quoted_price, created_at, updated_at)
         VALUES (:session_id, :quoted_price, :created_at, :updated_at)'
    )->execute([
        ':session_id' => $sessionId,
        ':quoted_price' => (int) $session['shipping_price'],
        ':created_at' => $now,
        ':updated_at' => $now,
    ]);
    $payload = [
        'shipper_contact_name' => $originName,
        'shipper_contact_phone' => $originPhone,
        'shipper_organization' => 'ZERO Foods via Ezkart',
        'origin_contact_name' => $originName,
        'origin_contact_phone' => $originPhone,
        'origin_address' => $originAddress,
        'origin_area_id' => $originArea,
        'origin_collection_method' => (string) $session['collection_method'],
        'destination_contact_name' => (string) $session['customer_name'],
        'destination_contact_phone' => (string) $session['customer_phone'],
        'destination_contact_email' => (string) $session['customer_email'],
        'destination_address' => (string) $session['destination_address'],
        'destination_note' => (string) $session['destination_note'],
        'destination_area_id' => (string) $session['destination_area_id'],
        'courier_company' => (string) $session['courier_company'],
        'courier_type' => (string) $session['courier_type'],
        'delivery_type' => 'now',
        'reference_id' => $sessionId,
        'metadata' => [
            'merchant' => (string) $session['merchant_slug'],
            'merchant_order_reference' => (string) $session['merchant_order_reference'],
            'checkout_session_id' => $sessionId,
        ],
        'tags' => ['ezkart', 'zerofoods', ez_mode()],
        'items' => ez_biteship_items(ez_session_items($pdo, $sessionId)),
    ];
    try {
        $response = ez_biteship_request('POST', 'v1/orders', $payload);
    } catch (Throwable $error) {
        $pdo->prepare(
            'UPDATE ezkart_shipments SET last_error = :last_error, updated_at = :updated_at WHERE session_id = :session_id'
        )->execute([
            ':last_error' => mb_substr($error->getMessage(), 0, 500),
            ':updated_at' => ez_now(),
            ':session_id' => $sessionId,
        ]);
        throw $error;
    }
    $courier = is_array($response['courier'] ?? null) ? $response['courier'] : [];
    $pdo->prepare(
        'UPDATE ezkart_shipments
         SET provider_order_id = :provider_order_id, tracking_id = :tracking_id,
             waybill_id = :waybill_id, routing_code = :routing_code, status = :status,
             actual_price = :actual_price, last_error = "", provider_json = :provider_json,
             updated_at = :updated_at
         WHERE session_id = :session_id'
    )->execute([
        ':provider_order_id' => mb_substr((string) ($response['id'] ?? ''), 0, 120),
        ':tracking_id' => mb_substr((string) ($courier['tracking_id'] ?? ''), 0, 160),
        ':waybill_id' => mb_substr((string) ($courier['waybill_id'] ?? ''), 0, 180),
        ':routing_code' => mb_substr((string) ($courier['routing_code'] ?? ''), 0, 120),
        ':status' => mb_substr((string) ($response['status'] ?? 'confirmed'), 0, 80),
        ':actual_price' => max(0, (int) round((float) ($response['price'] ?? 0))),
        ':provider_json' => json_encode($response, JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE),
        ':updated_at' => ez_now(),
        ':session_id' => $sessionId,
    ]);
    $existing->execute([':session_id' => $sessionId]);
    return $existing->fetch() ?: [];
}

function ez_duitku_ip_allowed(string $ip): bool
{
    if (!ez_config_bool('duitku_enforce_callback_ip', false)) {
        return true;
    }
    $defaults = ez_mode() === 'production'
        ? '182.23.85.8,182.23.85.9,182.23.85.10,182.23.85.13,182.23.85.14,103.177.101.184,103.177.101.185,103.177.101.186,103.177.101.189,103.177.101.190'
        : '182.23.85.11,182.23.85.12,103.177.101.187,103.177.101.188';
    $allowed = array_filter(array_map('trim', explode(',', ez_config('duitku_callback_ip_allowlist', $defaults))));
    return in_array($ip, $allowed, true);
}

function ez_duitku_callback(PDO $pdo, array $callback, string $raw): array
{
    if (!ez_duitku_ip_allowed(ez_client_ip())) {
        throw new InvalidArgumentException('Duitku callback source is not allowed.');
    }
    $credentials = ez_duitku_credentials();
    $merchantCode = trim((string) ($callback['merchantCode'] ?? ''));
    $amount = trim((string) ($callback['amount'] ?? ''));
    $sessionId = trim((string) ($callback['merchantOrderId'] ?? ''));
    $signature = strtolower(trim((string) ($callback['signature'] ?? '')));
    $expected = hash_hmac('sha256', $merchantCode . $amount . $sessionId, $credentials['key']);
    if ($merchantCode !== $credentials['code'] || $signature === '' || !hash_equals($expected, $signature)) {
        throw new InvalidArgumentException('Duitku callback signature is invalid.');
    }
    $session = ez_session($pdo, $sessionId);
    if ((int) $amount !== (int) $session['payment_total']) {
        throw new InvalidArgumentException('Duitku callback amount does not match the checkout.');
    }
    $isNew = ez_record_webhook($pdo, 'duitku', 'payment.' . (string) ($callback['resultCode'] ?? ''), $raw);
    if (!$isNew) {
        return ['paid' => (string) $session['status'] === 'PAID', 'duplicate' => true, 'session_id' => $sessionId];
    }
    try {
        $resultCode = trim((string) ($callback['resultCode'] ?? ''));
        if ($resultCode !== '00') {
            $pdo->prepare(
                'UPDATE ezkart_payments SET status = "FAILED", callback_json = :callback_json, updated_at = :updated_at
                 WHERE session_id = :session_id'
            )->execute([
                ':callback_json' => $raw,
                ':updated_at' => ez_now(),
                ':session_id' => $sessionId,
            ]);
            $pdo->prepare(
                'UPDATE ezkart_checkout_sessions SET status = "PAYMENT_FAILED", updated_at = :updated_at WHERE id = :id'
            )->execute([':updated_at' => ez_now(), ':id' => $sessionId]);
            ez_finish_webhook($pdo, 'duitku', $raw, 'PROCESSED');
            return ['paid' => false, 'session_id' => $sessionId];
        }
        $now = ez_now();
        $pdo->beginTransaction();
        $pdo->prepare(
            'UPDATE ezkart_payments
             SET status = "PAID", provider_reference = :reference, provider_payment_code = :payment_code,
                 provider_order_id = :provider_order_id, callback_json = :callback_json,
                 paid_at = COALESCE(paid_at, :paid_at), updated_at = :updated_at
             WHERE session_id = :session_id'
        )->execute([
            ':reference' => mb_substr((string) ($callback['reference'] ?? ''), 0, 160),
            ':payment_code' => mb_substr((string) ($callback['paymentCode'] ?? ''), 0, 80),
            ':provider_order_id' => mb_substr((string) ($callback['publisherOrderId'] ?? ''), 0, 180),
            ':callback_json' => $raw,
            ':paid_at' => $now,
            ':updated_at' => $now,
            ':session_id' => $sessionId,
        ]);
        $pdo->prepare(
            'UPDATE ezkart_checkout_sessions SET status = "PAID", updated_at = :updated_at WHERE id = :id'
        )->execute([':updated_at' => $now, ':id' => $sessionId]);
        $session['status'] = 'PAID';
        ez_ledger_paid($pdo, $session);
        $pdo->commit();
        $shipmentCreated = false;
        try {
            $shipment = ez_create_shipment($pdo, $sessionId);
            $shipmentCreated = (string) ($shipment['provider_order_id'] ?? '') !== '';
        } catch (Throwable $shipmentError) {
            error_log('Paid Ezkart session needs shipment retry: ' . $sessionId . ' - ' . $shipmentError->getMessage());
        }
        ez_finish_webhook($pdo, 'duitku', $raw, 'PROCESSED');
        return ['paid' => true, 'shipment_created' => $shipmentCreated, 'session_id' => $sessionId];
    } catch (Throwable $error) {
        if ($pdo->inTransaction()) {
            $pdo->rollBack();
        }
        ez_finish_webhook($pdo, 'duitku', $raw, 'FAILED', $error->getMessage());
        throw $error;
    }
}

function ez_biteship_webhook_authorized(): bool
{
    $headerName = ez_config('biteship_webhook_header', 'X-Ezkart-Webhook-Secret');
    $expected = ez_config('biteship_webhook_secret');
    $received = ez_header($headerName);
    return $expected !== '' && $received !== '' && hash_equals($expected, $received);
}

function ez_biteship_webhook(PDO $pdo, array $payload, string $raw): array
{
    $event = trim((string) ($payload['event'] ?? ''));
    $orderId = trim((string) ($payload['order_id'] ?? ''));
    if (!in_array($event, ['order.status', 'order.price', 'order.waybill_id'], true) || $orderId === '') {
        throw new InvalidArgumentException('Biteship webhook payload is invalid.');
    }
    $isNew = ez_record_webhook($pdo, 'biteship', $event, $raw);
    if (!$isNew) {
        return ['received' => true, 'duplicate' => true, 'event' => $event, 'order_id' => $orderId];
    }
    try {
        $lookup = $pdo->prepare('SELECT session_id FROM ezkart_shipments WHERE provider_order_id = :order_id LIMIT 1');
        $lookup->execute([':order_id' => $orderId]);
        $sessionId = $lookup->fetchColumn();
        if (!is_string($sessionId) || $sessionId === '') {
            throw new RuntimeException('Biteship order is not linked to an Ezkart checkout.');
        }
        $pdo->prepare(
            'UPDATE ezkart_shipments
             SET tracking_id = COALESCE(NULLIF(:tracking_id, ""), tracking_id),
                 waybill_id = COALESCE(NULLIF(:waybill_id, ""), waybill_id),
                 status = COALESCE(NULLIF(:status, ""), status),
                 actual_price = COALESCE(NULLIF(:actual_price, 0), actual_price),
                 provider_json = :provider_json, updated_at = :updated_at
             WHERE provider_order_id = :provider_order_id'
        )->execute([
            ':tracking_id' => mb_substr(trim((string) ($payload['courier_tracking_id'] ?? '')), 0, 160),
            ':waybill_id' => mb_substr(trim((string) ($payload['courier_waybill_id'] ?? '')), 0, 180),
            ':status' => mb_substr(trim((string) ($payload['status'] ?? '')), 0, 80),
            ':actual_price' => max(0, (int) round((float) ($payload['price'] ?? $payload['order_price'] ?? 0))),
            ':provider_json' => $raw,
            ':updated_at' => ez_now(),
            ':provider_order_id' => $orderId,
        ]);
        ez_finish_webhook($pdo, 'biteship', $raw, 'PROCESSED');
        return ['received' => true, 'event' => $event, 'order_id' => $orderId, 'session_id' => $sessionId];
    } catch (Throwable $error) {
        ez_finish_webhook($pdo, 'biteship', $raw, 'FAILED', $error->getMessage());
        throw $error;
    }
}
