<?php
declare(strict_types=1);

require_once __DIR__ . '/bootstrap.php';

try {
    if (($_SERVER['REQUEST_METHOD'] ?? '') !== 'POST') {
        ez_api_json(['ok' => false, 'error' => 'Method not allowed.'], 405);
    }
    if (!ez_request_origin_allowed()) {
        ez_api_json(['ok' => false, 'error' => 'Invalid checkout origin.'], 403);
    }
    $input = json_decode((string) file_get_contents('php://input'), true);
    if (!is_array($input)) {
        throw new InvalidArgumentException('Invalid checkout request.');
    }
    $checkout = ez_checkout_request($input);
    $credentials = ez_duitku_credentials();
    $orderId = 'EZK-DUITKU-' . gmdate('ymdHis') . '-' . strtoupper(bin2hex(random_bytes(2)));
    $timestamp = (string) round(microtime(true) * 1000);
    $signature = hash_hmac('sha256', $credentials['code'] . $timestamp, $credentials['key']);
    $customer = $checkout['customer'];
    $nameParts = preg_split('/\s+/', $customer['name'], 2) ?: [$customer['name']];
    $firstName = mb_substr((string) ($nameParts[0] ?? ''), 0, 50);
    $lastName = mb_substr((string) ($nameParts[1] ?? ''), 0, 50);
    $address = [
        'firstName' => $firstName,
        'lastName' => $lastName,
        'address' => mb_substr($customer['address'], 0, 50),
        'city' => mb_substr($customer['location'], 0, 50),
        'postalCode' => $customer['postalCode'],
        'phone' => $customer['phone'],
        'countryCode' => 'ID',
    ];
    $payload = [
        'paymentAmount' => $checkout['total'],
        'merchantOrderId' => $orderId,
        'productDetails' => 'Ezkart Sandbox order ' . $orderId,
        'additionalParam' => '',
        'merchantUserInfo' => $customer['email'],
        'paymentMethod' => '',
        'customerVaName' => mb_substr($customer['name'], 0, 20),
        'email' => $customer['email'],
        'phoneNumber' => $customer['phone'],
        'itemDetails' => $checkout['items'],
        'customerDetail' => [
            'firstName' => $firstName,
            'lastName' => $lastName,
            'email' => $customer['email'],
            'phoneNumber' => $customer['phone'],
            'billingAddress' => $address,
            'shippingAddress' => $address,
        ],
        'callbackUrl' => 'https://ezkart.id/cart/api/callback.php',
        'returnUrl' => 'https://ezkart.id/cart/return.php?order=' . rawurlencode($orderId),
        'expiryPeriod' => 15,
    ];
    $order = $checkout + [
        'order_id' => $orderId,
        'status' => 'CREATING',
        'duitku_reference' => '',
        'payment_code' => '',
        'created_at' => gmdate(DATE_ATOM),
        'updated_at' => gmdate(DATE_ATOM),
    ];
    ez_save_order($order);
    $invoice = ez_http_json(EZ_DUITKU_SANDBOX_INVOICE_URL, $payload, [
        'Content-Type: application/json',
        'x-duitku-timestamp: ' . $timestamp,
        'x-duitku-signature: ' . $signature,
        'x-duitku-merchantcode: ' . $credentials['code'],
    ]);
    $paymentUrl = trim((string) ($invoice['paymentUrl'] ?? ''));
    $reference = trim((string) ($invoice['reference'] ?? ''));
    if ((string) ($invoice['statusCode'] ?? '') !== '00' || !str_starts_with($paymentUrl, 'https://app-sandbox.duitku.com/')) {
        throw new RuntimeException((string) ($invoice['statusMessage'] ?? 'Duitku did not create a sandbox invoice.'));
    }
    $order['status'] = 'PENDING';
    $order['duitku_reference'] = $reference;
    $order['updated_at'] = gmdate(DATE_ATOM);
    ez_save_order($order);
    ez_api_json([
        'ok' => true,
        'order_id' => $orderId,
        'duitku_reference' => $reference,
        'payment_url' => $paymentUrl,
        'payment_total' => $checkout['total'],
    ], 201);
} catch (InvalidArgumentException $error) {
    ez_api_json(['ok' => false, 'error' => $error->getMessage()], 422);
} catch (Throwable $error) {
    error_log('Ezkart Duitku start error: ' . $error->getMessage());
    ez_api_json(['ok' => false, 'error' => $error->getMessage()], 503);
}
