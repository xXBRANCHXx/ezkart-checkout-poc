<?php
declare(strict_types=1);

const EZ_MIDTRANS_SNAP_SANDBOX_URL = 'https://app.sandbox.midtrans.com/snap/v1/transactions';
const EZ_MIDTRANS_SNAP_PRODUCTION_URL = 'https://app.midtrans.com/snap/v1/transactions';
const EZ_BITESHIP_RATES_URL = 'https://api.biteship.com/v1/rates/couriers';
const EZ_BITESHIP_ORDERS_URL = 'https://api.biteship.com/v1/orders';

final class EzProviderException extends RuntimeException
{
    public function __construct(
        string $message,
        public readonly int $providerStatus,
        public readonly array $providerPayload = [],
    ) {
        parent::__construct($message);
    }
}

function ez_api_json(array $payload, int $status = 200): never
{
    http_response_code($status);
    header('Content-Type: application/json; charset=utf-8');
    header('Cache-Control: no-store');
    header('X-Content-Type-Options: nosniff');
    echo json_encode($payload, JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE);
    exit;
}

function ez_config_all(): array
{
    static $config;
    if (is_array($config)) {
        return $config;
    }
    $config = [];
    $documentRoot = rtrim((string) ($_SERVER['DOCUMENT_ROOT'] ?? ''), '/');
    $paths = array_filter([
        dirname(__DIR__, 2) . '/config.runtime.php',
        $documentRoot !== '' ? dirname($documentRoot) . '/config.runtime.php' : '',
        '/public_html/config.runtime.php',
    ]);
    foreach (array_unique($paths) as $path) {
        if (!is_file($path)) {
            continue;
        }
        $loaded = require $path;
        if (is_array($loaded)) {
            $config = array_merge($config, $loaded);
        }
    }
    return $config;
}

function ez_config(string $key): string
{
    $envKey = 'EZKART_' . strtoupper($key);
    foreach ([getenv($envKey), $_SERVER[$envKey] ?? null, $_ENV[$envKey] ?? null] as $value) {
        if (is_string($value) && trim($value) !== '') {
            return trim($value);
        }
    }
    $value = ez_config_all()[$key] ?? '';
    return is_string($value) ? trim($value) : '';
}

function ez_commerce_environment(): string
{
    $environment = strtolower(ez_config('commerce_environment'));
    if (!in_array($environment, ['sandbox', 'production'], true)) {
        throw new RuntimeException('commerce_environment must be sandbox or production.');
    }
    return $environment;
}

function ez_commerce_is_production(): bool
{
    return ez_commerce_environment() === 'production';
}

function ez_midtrans_snap_api_url(): string
{
    return ez_commerce_is_production() ? EZ_MIDTRANS_SNAP_PRODUCTION_URL : EZ_MIDTRANS_SNAP_SANDBOX_URL;
}

function ez_midtrans_snap_script_url(): string
{
    return ez_commerce_is_production()
        ? 'https://app.midtrans.com/snap/snap.js'
        : 'https://app.sandbox.midtrans.com/snap/snap.js';
}

function ez_checkout_public_url(): string
{
    $url = rtrim(ez_config('checkout_public_url'), '/');
    $parts = parse_url($url);
    $host = strtolower((string) ($parts['host'] ?? ''));
    if (
        $url === '' || strtolower((string) ($parts['scheme'] ?? '')) !== 'https'
        || !in_array($host, ['ezkart.id', 'www.ezkart.id', 'test.ezkart.id'], true)
        || !in_array((string) ($parts['path'] ?? ''), ['', '/'], true)
        || isset($parts['user']) || isset($parts['pass']) || isset($parts['query']) || isset($parts['fragment'])
    ) {
        throw new RuntimeException('checkout_public_url must be an approved HTTPS Ezkart website URL.');
    }
    return $url;
}

function ez_midtrans_credentials(): array
{
    $environment = ez_commerce_environment();
    $merchantId = ez_config('midtrans_merchant_id');
    $clientKey = ez_config('midtrans_client_key');
    $serverKey = ez_config('midtrans_server_key');
    if (
        $merchantId === '' || $clientKey === '' || $serverKey === ''
        || str_contains(strtoupper($merchantId), 'REPLACE')
        || str_contains(strtoupper($clientKey), 'REPLACE')
        || str_contains(strtoupper($serverKey), 'REPLACE')
    ) {
        throw new RuntimeException('Midtrans ' . $environment . ' credentials are not configured on this server.');
    }
    $sandboxKeys = str_starts_with($clientKey, 'SB-') || str_starts_with($serverKey, 'SB-');
    if ($environment === 'production' && $sandboxKeys) {
        throw new RuntimeException('Production commerce cannot use Midtrans Sandbox keys.');
    }
    if ($environment === 'sandbox' && (!$sandboxKeys || !str_starts_with($clientKey, 'SB-') || !str_starts_with($serverKey, 'SB-'))) {
        throw new RuntimeException('Sandbox commerce requires Midtrans Sandbox keys.');
    }
    return [
        'merchant_id' => $merchantId,
        'client_key' => $clientKey,
        'server_key' => $serverKey,
    ];
}

function ez_biteship_credentials(): array
{
    $environment = ez_commerce_environment();
    $apiKey = ez_config('biteship_api_key');
    $originPostalCode = ez_config('biteship_origin_postal_code');
    if (
        $apiKey === '' || str_contains(strtoupper($apiKey), 'REPLACE')
        || preg_match('/^\d{5}$/', $originPostalCode) !== 1
    ) {
        throw new RuntimeException('Biteship ' . $environment . ' credentials and a five-digit origin postcode are not configured on this server.');
    }
    $requiredPrefix = $environment === 'production' ? 'biteship_live.' : 'biteship_test.';
    if (!str_starts_with($apiKey, $requiredPrefix)) {
        throw new RuntimeException('Biteship ' . $environment . ' requires a ' . $requiredPrefix . ' API key.');
    }
    $couriers = ez_config('biteship_couriers');
    return [
        'api_key' => $apiKey,
        'origin_postal_code' => $originPostalCode,
        'couriers' => $couriers !== '' ? $couriers : 'jne,sicepat,jnt',
    ];
}

function ez_biteship_fulfillment_credentials(): array
{
    $credentials = ez_biteship_credentials();
    $originName = ez_config('biteship_origin_contact_name');
    $originPhone = preg_replace('/[^\d+]/', '', ez_config('biteship_origin_contact_phone')) ?? '';
    $originAddress = ez_config('biteship_origin_address');
    if (
        mb_strlen($originName) < 2 || mb_strlen($originName) > 100
        || preg_match('/^\+?\d{8,15}$/', $originPhone) !== 1
        || mb_strlen($originAddress) < 5 || mb_strlen($originAddress) > 300
        || str_contains(strtoupper($originName . $originAddress), 'REPLACE')
    ) {
        throw new RuntimeException('Biteship pickup contact and address are not configured on this server.');
    }
    return $credentials + [
        'origin_contact_name' => mb_substr($originName, 0, 100),
        'origin_contact_phone' => mb_substr($originPhone, 0, 20),
        'origin_contact_email' => mb_substr(ez_config('biteship_origin_contact_email'), 0, 120),
        'origin_address' => mb_substr($originAddress, 0, 300),
        'origin_note' => mb_substr(ez_config('biteship_origin_note'), 0, 120),
        'shipper_organization' => mb_substr(ez_config('biteship_shipper_organization'), 0, 100),
    ];
}

function ez_integration_status(): array
{
    try {
        ez_midtrans_credentials();
        $midtrans = true;
    } catch (Throwable) {
        $midtrans = false;
    }
    try {
        ez_biteship_credentials();
        $biteship = true;
    } catch (Throwable) {
        $biteship = false;
    }
    try {
        ez_biteship_fulfillment_credentials();
        $biteshipFulfillment = true;
    } catch (Throwable) {
        $biteshipFulfillment = false;
    }
    $environment = '';
    try {
        $environment = ez_commerce_environment();
    } catch (Throwable) {
        $environment = 'invalid';
    }
    return ['midtrans' => $midtrans, 'biteship' => $biteship, 'biteship_fulfillment' => $biteshipFulfillment, 'environment' => $environment];
}

function ez_catalog(): array
{
    return [
        'granola' => ['sku' => 'EZK-DEMO-GRANOLA', 'name' => 'Granola Madu Nusantara', 'price' => 58000, 'weight' => 320],
        'coffee' => ['sku' => 'EZK-DEMO-COFFEE', 'name' => 'Kopi Susu Concentrate', 'price' => 79000, 'weight' => 650],
        'sambal' => ['sku' => 'EZK-DEMO-SAMBAL', 'name' => 'Sambal Roa Signature', 'price' => 46000, 'weight' => 260],
    ];
}

function ez_normalize_biteship_quotes(array $pricing): array
{
    $quotes = [];
    foreach ($pricing as $rate) {
        if (!is_array($rate) || (int) ($rate['price'] ?? 0) < 1) continue;
        $companyCode = trim((string) ($rate['company'] ?? $rate['courier_company'] ?? $rate['courier_code'] ?? ''));
        $serviceCode = trim((string) ($rate['type'] ?? $rate['courier_type'] ?? $rate['courier_service_code'] ?? ''));
        if ($companyCode === '' || $serviceCode === '') continue;
        $company = trim((string) ($rate['courier_name'] ?? $companyCode));
        $service = trim((string) ($rate['courier_service_name'] ?? $rate['description'] ?? $serviceCode));
        $id = strtolower(trim((string) preg_replace('/[^a-z0-9]+/i', '-', $companyCode . '-' . $serviceCode), '-'));
        if ($id === '') continue;
        $duration = trim((string) ($rate['duration'] ?? $rate['shipment_duration_range'] ?? ''));
        $durationUnit = trim((string) ($rate['shipment_duration_unit'] ?? ''));
        if ($duration !== '' && $durationUnit !== '' && !str_contains(strtolower($duration), strtolower($durationUnit))) {
            $duration .= ' ' . $durationUnit;
        }
        $quotes[$id] = [
            'id' => $id,
            'courier' => mb_substr($company, 0, 80),
            'service' => mb_substr($service, 0, 80),
            'courier_company' => mb_substr(strtolower($companyCode), 0, 80),
            'courier_type' => mb_substr(strtolower($serviceCode), 0, 80),
            'days' => mb_substr($duration !== '' ? $duration : 'ETA from Biteship', 0, 80),
            'price' => (int) $rate['price'],
            'provider' => ez_commerce_is_production() ? 'Biteship' : 'Biteship Test',
        ];
    }
    return array_values($quotes);
}

function ez_biteship_quotes(array $cart, string $destinationPostalCode): array
{
    if (preg_match('/^\d{5}$/', $destinationPostalCode) !== 1) {
        throw new InvalidArgumentException('A valid five-digit destination postcode is required.');
    }
    $items = [];
    $itemCount = 0;
    foreach (ez_catalog() as $id => $product) {
        $raw = $cart[$id] ?? 0;
        if (!is_int($raw) && (!is_string($raw) || preg_match('/^\d+$/', $raw) !== 1)) {
            throw new InvalidArgumentException('A cart quantity is invalid.');
        }
        $quantity = (int) $raw;
        if ($quantity < 0 || $quantity > 9) {
            throw new InvalidArgumentException('Cart quantities must be between 0 and 9.');
        }
        if ($quantity === 0) continue;
        $items[] = [
            'name' => $product['name'],
            'description' => $product['sku'],
            'value' => $product['price'],
            'quantity' => $quantity,
            'weight' => $product['weight'],
        ];
        $itemCount += $quantity;
    }
    if ($itemCount < 1 || $itemCount > 9) {
        throw new InvalidArgumentException('Add between 1 and 9 products.');
    }
    $credentials = ez_biteship_credentials();
    $response = ez_http_json(EZ_BITESHIP_RATES_URL, [
        'origin_postal_code' => (int) $credentials['origin_postal_code'],
        'destination_postal_code' => (int) $destinationPostalCode,
        'couriers' => $credentials['couriers'],
        'items' => $items,
    ], [
        'Accept: application/json',
        'Content-Type: application/json',
        'Authorization: ' . $credentials['api_key'],
    ], ez_commerce_is_production() ? 'Biteship production' : 'Biteship test-mode');
    $pricing = is_array($response['pricing'] ?? null) ? $response['pricing'] : [];
    $quotes = ez_normalize_biteship_quotes($pricing);
    if ($quotes === []) {
        throw new RuntimeException('Biteship returned no courier rates for this route.');
    }
    return $quotes;
}

function ez_checkout_request(array $input): array
{
    $cart = is_array($input['cart'] ?? null) ? $input['cart'] : [];
    $customer = is_array($input['customer'] ?? null) ? $input['customer'] : [];
    $items = [];
    $shippingItems = [];
    $subtotal = 0;
    $weight = 0;
    $itemCount = 0;
    foreach (ez_catalog() as $id => $product) {
        $raw = $cart[$id] ?? 0;
        if (!is_int($raw) && (!is_string($raw) || preg_match('/^\d+$/', $raw) !== 1)) {
            throw new InvalidArgumentException('A cart quantity is invalid.');
        }
        $quantity = (int) $raw;
        if ($quantity < 0 || $quantity > 9) {
            throw new InvalidArgumentException('Cart quantities must be between 0 and 9.');
        }
        if ($quantity === 0) continue;
        $lineTotal = $product['price'] * $quantity;
        $items[] = [
            'id' => $product['sku'],
            'name' => mb_substr($product['name'], 0, 50),
            'price' => $product['price'],
            'quantity' => $quantity,
        ];
        $shippingItems[] = [
            'name' => mb_substr($product['name'], 0, 100),
            'description' => $product['sku'],
            'category' => 'food_and_drink',
            'sku' => $product['sku'],
            'value' => $product['price'],
            'quantity' => $quantity,
            'weight' => $product['weight'],
        ];
        $subtotal += $lineTotal;
        $weight += $product['weight'] * $quantity;
        $itemCount += $quantity;
    }
    if ($itemCount < 1 || $itemCount > 9) {
        throw new InvalidArgumentException('Add between 1 and 9 products.');
    }

    $name = trim((string) ($customer['fullName'] ?? ''));
    $email = strtolower(trim((string) ($customer['email'] ?? '')));
    $phone = preg_replace('/[^\d+]/', '', (string) ($customer['phone'] ?? '')) ?? '';
    $location = trim((string) ($customer['location'] ?? ''));
    $address = trim((string) ($customer['address'] ?? ''));
    $postalCode = trim((string) ($customer['postalCode'] ?? ''));
    $note = mb_substr(trim((string) ($customer['note'] ?? '')), 0, 120);
    if (
        mb_strlen($name) < 2 || mb_strlen($name) > 100
        || mb_strlen($email) > 120 || !filter_var($email, FILTER_VALIDATE_EMAIL)
        || preg_match('/^\+?\d{8,15}$/', $phone) !== 1
    ) {
        throw new InvalidArgumentException('Valid customer name, email, and phone are required.');
    }
    if (
        mb_strlen($location) < 3 || mb_strlen($location) > 120
        || mb_strlen($address) < 5 || mb_strlen($address) > 300
        || preg_match('/^\d{5}$/', $postalCode) !== 1
    ) {
        throw new InvalidArgumentException('A valid delivery location, address, and postcode are required.');
    }

    $shippingId = trim((string) ($input['shipping_id'] ?? ''));
    $quotes = ez_biteship_quotes($cart, $postalCode);
    $shipping = null;
    foreach ($quotes as $quote) {
        if (hash_equals((string) $quote['id'], $shippingId)) {
            $shipping = $quote;
            break;
        }
    }
    if (!is_array($shipping)) {
        throw new InvalidArgumentException('Select a valid shipping service.');
    }
    $shippingPrice = (int) $shipping['price'];
    $items[] = [
        'id' => 'EZK-SHIPPING',
        'name' => mb_substr('Shipping - ' . $shipping['courier'] . ' ' . $shipping['service'], 0, 50),
        'price' => $shippingPrice,
        'quantity' => 1,
    ];
    return [
        'items' => $items,
        'subtotal' => $subtotal,
        'shipping_price' => $shippingPrice,
        'total' => $subtotal + $shippingPrice,
        'weight' => $weight,
        'shipping_items' => $shippingItems,
        'customer' => compact('name', 'email', 'phone', 'location', 'address', 'postalCode', 'note'),
        'shipping' => $shipping,
    ];
}

function ez_create_biteship_order(array $order): array
{
    if (strtoupper((string) ($order['status'] ?? '')) !== 'PAID') {
        throw new InvalidArgumentException('Only paid orders can be handed to Biteship.');
    }
    $credentials = ez_biteship_fulfillment_credentials();
    $customer = is_array($order['customer'] ?? null) ? $order['customer'] : [];
    $shipping = is_array($order['shipping'] ?? null) ? $order['shipping'] : [];
    $items = is_array($order['shipping_items'] ?? null) ? $order['shipping_items'] : [];
    if ($items === []) {
        $catalogBySku = [];
        foreach (ez_catalog() as $product) $catalogBySku[$product['sku']] = $product;
        foreach ((array) ($order['items'] ?? []) as $item) {
            if (!is_array($item) || !isset($catalogBySku[$item['id'] ?? ''])) continue;
            $product = $catalogBySku[$item['id']];
            $items[] = [
                'name' => mb_substr((string) $product['name'], 0, 100),
                'description' => (string) $product['sku'],
                'category' => 'food_and_drink',
                'sku' => (string) $product['sku'],
                'value' => (int) $product['price'],
                'quantity' => max(1, (int) ($item['quantity'] ?? 1)),
                'weight' => (int) $product['weight'],
            ];
        }
    }
    $company = trim((string) ($shipping['courier_company'] ?? ''));
    $type = trim((string) ($shipping['courier_type'] ?? ''));
    if ($company === '' || $type === '' || $items === []) {
        throw new RuntimeException('The stored order is missing its Biteship courier or package details.');
    }
    $payload = [
        'shipper_contact_name' => $credentials['origin_contact_name'],
        'shipper_contact_phone' => $credentials['origin_contact_phone'],
        'origin_contact_name' => $credentials['origin_contact_name'],
        'origin_contact_phone' => $credentials['origin_contact_phone'],
        'origin_address' => $credentials['origin_address'],
        'origin_postal_code' => (int) $credentials['origin_postal_code'],
        'destination_contact_name' => mb_substr((string) ($customer['name'] ?? ''), 0, 100),
        'destination_contact_phone' => mb_substr((string) ($customer['phone'] ?? ''), 0, 20),
        'destination_contact_email' => mb_substr((string) ($customer['email'] ?? ''), 0, 120),
        'destination_address' => mb_substr(trim((string) ($customer['address'] ?? '') . ', ' . (string) ($customer['location'] ?? '')), 0, 300),
        'destination_postal_code' => (int) ($customer['postalCode'] ?? 0),
        'courier_company' => $company,
        'courier_type' => $type,
        'delivery_type' => 'now',
        'reference_id' => (string) $order['order_id'],
        'tags' => ['ezkart', 'midtrans-' . ez_commerce_environment()],
        'metadata' => ['midtrans_status' => (string) ($order['midtrans_status'] ?? ''), 'environment' => ez_commerce_environment()],
        'items' => $items,
    ];
    foreach ([
        'shipper_contact_email' => $credentials['origin_contact_email'],
        'origin_contact_email' => $credentials['origin_contact_email'],
        'shipper_organization' => $credentials['shipper_organization'],
        'origin_note' => $credentials['origin_note'],
        'destination_note' => (string) ($customer['note'] ?? ''),
        'order_note' => (string) ($customer['note'] ?? ''),
    ] as $key => $value) {
        if ($value !== '') $payload[$key] = $value;
    }
    try {
        $response = ez_http_json(EZ_BITESHIP_ORDERS_URL, $payload, [
            'Accept: application/json',
            'Content-Type: application/json',
            'Authorization: ' . $credentials['api_key'],
        ], ez_commerce_is_production() ? 'Biteship production order' : 'Biteship test-mode order');
    } catch (EzProviderException $error) {
        $duplicate = $error->providerPayload;
        $details = is_array($duplicate['details'] ?? null) ? $duplicate['details'] : [];
        if ((int) ($duplicate['code'] ?? 0) === 40002060 && trim((string) ($details['order_id'] ?? '')) !== '') {
            return [
                'id' => trim((string) $details['order_id']),
                'tracking_id' => '',
                'waybill_id' => mb_substr((string) ($details['waybill_id'] ?? ''), 0, 160),
                'status' => 'confirmed',
                'recovered_duplicate' => true,
            ];
        }
        throw $error;
    }
    $orderId = trim((string) ($response['id'] ?? ''));
    if (($response['success'] ?? false) !== true || $orderId === '') {
        throw new RuntimeException('Biteship did not return a valid order ID. Confirm that the live Order API is activated and funded.');
    }
    $courier = is_array($response['courier'] ?? null) ? $response['courier'] : [];
    return [
        'id' => mb_substr($orderId, 0, 160),
        'tracking_id' => mb_substr((string) ($courier['tracking_id'] ?? ''), 0, 160),
        'waybill_id' => mb_substr((string) ($courier['waybill_id'] ?? ''), 0, 160),
        'status' => mb_substr((string) ($response['status'] ?? 'confirmed'), 0, 80),
        'recovered_duplicate' => false,
    ];
}

function ez_order_directory(): string
{
    $configured = ez_config('midtrans_order_storage');
    $documentRoot = rtrim((string) ($_SERVER['DOCUMENT_ROOT'] ?? ''), '/');
    $path = $configured !== ''
        ? $configured
        : (($documentRoot !== '' ? dirname($documentRoot) : sys_get_temp_dir()) . '/ezkart-midtrans-orders-' . ez_commerce_environment());
    if (!is_dir($path) && !mkdir($path, 0700, true) && !is_dir($path)) {
        throw new RuntimeException('Unable to create secure order storage.');
    }
    return $path;
}

function ez_order_path(string $orderId): string
{
    if (preg_match('/^EZK-[A-Z0-9-]{8,70}$/', $orderId) !== 1) {
        throw new InvalidArgumentException('Invalid order reference.');
    }
    return ez_order_directory() . '/' . hash('sha256', $orderId) . '.json';
}

function ez_save_order(array $order): void
{
    $path = ez_order_path((string) $order['order_id']);
    $json = json_encode($order, JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE | JSON_PRETTY_PRINT);
    if (!is_string($json) || file_put_contents($path, $json, LOCK_EX) === false) {
        throw new RuntimeException('Unable to save the order.');
    }
    chmod($path, 0600);
}

function ez_load_order(string $orderId): array
{
    $path = ez_order_path($orderId);
    if (!is_file($path)) {
        throw new InvalidArgumentException('Order not found.');
    }
    $order = json_decode((string) file_get_contents($path), true);
    if (!is_array($order)) {
        throw new RuntimeException('Stored order is invalid.');
    }
    return $order;
}

/** @return resource */
function ez_lock_order_state(string $orderId)
{
    $lockPath = ez_order_path($orderId) . '.state.lock';
    $lock = fopen($lockPath, 'c');
    if ($lock === false || !flock($lock, LOCK_EX)) {
        if (is_resource($lock)) fclose($lock);
        throw new RuntimeException('Unable to lock the order state.');
    }
    chmod($lockPath, 0600);
    return $lock;
}

/** @param resource $lock */
function ez_unlock_order_state($lock): void
{
    flock($lock, LOCK_UN);
    fclose($lock);
}

function ez_fulfill_paid_order(string $orderId): array
{
    $lock = ez_lock_order_state($orderId);
    try {
        $order = ez_load_order($orderId);
        if (strtoupper((string) ($order['status'] ?? '')) !== 'PAID') return $order;
        if (trim((string) ($order['biteship_order_id'] ?? '')) !== '') {
            $order['fulfillment_status'] = 'CONFIRMED';
            return $order;
        }
        $order['fulfillment_status'] = 'CREATING';
        $order['fulfillment_error'] = '';
        $order['updated_at'] = gmdate(DATE_ATOM);
        ez_save_order($order);
        try {
            $biteship = ez_create_biteship_order($order);
            $order['fulfillment_status'] = 'CONFIRMED';
            $order['biteship_order_id'] = $biteship['id'];
            $order['biteship_tracking_id'] = $biteship['tracking_id'];
            $order['biteship_waybill_id'] = $biteship['waybill_id'];
            $order['biteship_status'] = $biteship['status'];
            $order['biteship_duplicate_recovered'] = $biteship['recovered_duplicate'];
            $order['fulfillment_error'] = '';
            $order['fulfilled_at'] = gmdate(DATE_ATOM);
            $order['updated_at'] = gmdate(DATE_ATOM);
            ez_save_order($order);
            return $order;
        } catch (Throwable $error) {
            $order['fulfillment_status'] = 'RETRY_REQUIRED';
            $order['fulfillment_error'] = mb_substr($error->getMessage(), 0, 300);
            $order['updated_at'] = gmdate(DATE_ATOM);
            ez_save_order($order);
            throw $error;
        }
    } finally {
        ez_unlock_order_state($lock);
    }
}

function ez_http_json(string $url, array $payload, array $headers, string $provider = 'Midtrans'): array
{
    $curl = curl_init($url);
    if ($curl === false) throw new RuntimeException('Unable to start ' . $provider . ' request.');
    curl_setopt_array($curl, [
        CURLOPT_POST => true,
        CURLOPT_POSTFIELDS => json_encode($payload, JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE),
        CURLOPT_HTTPHEADER => $headers,
        CURLOPT_RETURNTRANSFER => true,
        CURLOPT_CONNECTTIMEOUT => 10,
        CURLOPT_TIMEOUT => 25,
        CURLOPT_SSL_VERIFYPEER => true,
    ]);
    $body = curl_exec($curl);
    $status = (int) curl_getinfo($curl, CURLINFO_HTTP_CODE);
    $error = curl_error($curl);
    $decoded = is_string($body) ? json_decode($body, true) : null;
    if ($status < 200 || $status >= 300 || !is_array($decoded)) {
        $message = '';
        if (is_array($decoded)) {
            $messages = $decoded['error_messages'] ?? null;
            if (is_array($messages)) {
                $message = implode(' ', array_map('strval', $messages));
            } else {
                $message = (string) ($decoded['status_message'] ?? $decoded['message'] ?? $decoded['error'] ?? '');
            }
        }
        throw new EzProviderException(
            $message !== '' ? $message : $provider . ' request failed' . ($error !== '' ? ': ' . $error : '.'),
            $status,
            is_array($decoded) ? $decoded : [],
        );
    }
    return $decoded;
}

function ez_request_origin_allowed(): bool
{
    $origin = rtrim((string) ($_SERVER['HTTP_ORIGIN'] ?? ''), '/');
    if ($origin === '') return true;
    $originParts = parse_url($origin);
    $originHost = strtolower((string) ($originParts['host'] ?? ''));
    $requestHost = strtolower(preg_replace('/:\d+$/', '', (string) ($_SERVER['HTTP_HOST'] ?? '')) ?? '');
    if ($originHost === '' || $requestHost === '' || !hash_equals($requestHost, $originHost)) return false;
    if (in_array($requestHost, ['localhost', '127.0.0.1'], true)) return true;
    if (strtolower((string) ($originParts['scheme'] ?? '')) !== 'https') return false;
    try {
        $configuredHost = strtolower((string) (parse_url(ez_checkout_public_url(), PHP_URL_HOST) ?: ''));
    } catch (Throwable) {
        return false;
    }
    return hash_equals($configuredHost, $requestHost);
}
