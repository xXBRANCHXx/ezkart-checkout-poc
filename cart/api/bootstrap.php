<?php
declare(strict_types=1);

const EZ_DUITKU_SANDBOX_INVOICE_URL = 'https://api-sandbox.duitku.com/api/merchant/createInvoice';

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

function ez_duitku_credentials(): array
{
    $code = ez_config('duitku_merchant_code');
    $key = ez_config('duitku_merchant_key');
    if ($code === '' || $key === '' || str_contains(strtoupper($code), 'REPLACE')) {
        throw new RuntimeException('Duitku Sandbox credentials are not configured on this server.');
    }
    return ['code' => $code, 'key' => $key];
}

function ez_catalog(): array
{
    return [
        'granola' => ['sku' => 'EZK-DEMO-GRANOLA', 'name' => 'Granola Madu Nusantara', 'price' => 58000, 'weight' => 320],
        'coffee' => ['sku' => 'EZK-DEMO-COFFEE', 'name' => 'Kopi Susu Concentrate', 'price' => 79000, 'weight' => 650],
        'sambal' => ['sku' => 'EZK-DEMO-SAMBAL', 'name' => 'Sambal Roa Signature', 'price' => 46000, 'weight' => 260],
    ];
}

function ez_shipping_catalog(): array
{
    return [
        'jne-reg' => ['courier' => 'JNE', 'service' => 'REG', 'base' => 15000],
        'sicepat-reg' => ['courier' => 'SiCepat', 'service' => 'REG', 'base' => 17000],
        'jnt-ez' => ['courier' => 'J&T Express', 'service' => 'EZ', 'base' => 13500],
    ];
}

function ez_location_multiplier(string $location): float
{
    $location = strtolower($location);
    if (str_contains($location, 'jakarta') || str_contains($location, 'depok')) return 1.0;
    if (str_contains($location, 'bandung')) return 1.22;
    if (str_contains($location, 'surabaya')) return 1.52;
    if (str_contains($location, 'yogyakarta') || str_contains($location, 'sleman')) return 1.38;
    if (str_contains($location, 'bali') || str_contains($location, 'denpasar')) return 1.72;
    return 1.3;
}

function ez_checkout_request(array $input): array
{
    $cart = is_array($input['cart'] ?? null) ? $input['cart'] : [];
    $customer = is_array($input['customer'] ?? null) ? $input['customer'] : [];
    $items = [];
    $subtotal = 0;
    $weight = 0;
    $itemCount = 0;
    foreach (ez_catalog() as $id => $product) {
        $raw = $cart[$id] ?? 0;
        if (filter_var($raw, FILTER_VALIDATE_INT) === false) {
            throw new InvalidArgumentException('A cart quantity is invalid.');
        }
        $quantity = (int) $raw;
        if ($quantity < 0 || $quantity > 9) {
            throw new InvalidArgumentException('Cart quantities must be between 0 and 9.');
        }
        if ($quantity === 0) continue;
        $lineTotal = $product['price'] * $quantity;
        $items[] = [
            'name' => $product['name'],
            'price' => $lineTotal,
            'quantity' => $quantity,
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
    if (mb_strlen($name) < 2 || !filter_var($email, FILTER_VALIDATE_EMAIL) || strlen($phone) < 8) {
        throw new InvalidArgumentException('Valid customer name, email, and phone are required.');
    }
    if (mb_strlen($location) < 3 || mb_strlen($address) < 5 || preg_match('/^\d{5}$/', $postalCode) !== 1) {
        throw new InvalidArgumentException('A valid delivery location, address, and postcode are required.');
    }

    $shippingId = trim((string) ($input['shipping_id'] ?? ''));
    $shipping = ez_shipping_catalog()[$shippingId] ?? null;
    if (!is_array($shipping)) {
        throw new InvalidArgumentException('Select a valid shipping service.');
    }
    $extraWeight = max(0, (int) ceil($weight / 1000) - 1) * 4500;
    $shippingPrice = (int) round(($shipping['base'] * ez_location_multiplier($location) + $extraWeight) / 500) * 500;
    $items[] = [
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
        'customer' => compact('name', 'email', 'phone', 'location', 'address', 'postalCode'),
        'shipping' => $shipping + ['id' => $shippingId],
    ];
}

function ez_order_directory(): string
{
    $configured = ez_config('duitku_order_storage');
    $documentRoot = rtrim((string) ($_SERVER['DOCUMENT_ROOT'] ?? ''), '/');
    $path = $configured !== ''
        ? $configured
        : (($documentRoot !== '' ? dirname($documentRoot) : sys_get_temp_dir()) . '/ezkart-duitku-orders');
    if (!is_dir($path) && !mkdir($path, 0700, true) && !is_dir($path)) {
        throw new RuntimeException('Unable to create secure order storage.');
    }
    return $path;
}

function ez_order_path(string $orderId): string
{
    if (preg_match('/^EZK-[A-Z0-9-]{8,45}$/', $orderId) !== 1) {
        throw new InvalidArgumentException('Invalid order reference.');
    }
    return ez_order_directory() . '/' . hash('sha256', $orderId) . '.json';
}

function ez_save_order(array $order): void
{
    $path = ez_order_path((string) $order['order_id']);
    $json = json_encode($order, JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE | JSON_PRETTY_PRINT);
    if (!is_string($json) || file_put_contents($path, $json, LOCK_EX) === false) {
        throw new RuntimeException('Unable to save the sandbox order.');
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

function ez_http_json(string $url, array $payload, array $headers): array
{
    $curl = curl_init($url);
    if ($curl === false) throw new RuntimeException('Unable to start Duitku request.');
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
    curl_close($curl);
    $decoded = is_string($body) ? json_decode($body, true) : null;
    if ($status < 200 || $status >= 300 || !is_array($decoded)) {
        $message = is_array($decoded) ? (string) ($decoded['Message'] ?? $decoded['statusMessage'] ?? '') : '';
        throw new RuntimeException($message !== '' ? $message : 'Duitku Sandbox request failed' . ($error !== '' ? ': ' . $error : '.'));
    }
    return $decoded;
}

function ez_request_origin_allowed(): bool
{
    $origin = rtrim((string) ($_SERVER['HTTP_ORIGIN'] ?? ''), '/');
    return in_array($origin, ['https://ezkart.id', 'https://www.ezkart.id'], true);
}
