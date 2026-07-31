<?php
declare(strict_types=1);

/**
 * Server-side example for the Official ZERO website.
 *
 * Required environment values:
 *   EZKART_BASE_URL=https://your-checkout-subdomain.example
 *   EZKART_ZERO_MERCHANT_SECRET=the same random secret configured by Ezkart
 *
 * Never put the integration secret or this request in browser JavaScript.
 */

$baseUrl = rtrim((string) getenv('EZKART_BASE_URL'), '/');
$merchantSecret = (string) getenv('EZKART_ZERO_MERCHANT_SECRET');
if ($baseUrl === '' || strlen($merchantSecret) < 32) {
    throw new RuntimeException('Ezkart ZERO integration is not configured.');
}

$zeroOrderId = 'ZERO-' . date('Ymd-His');
$items = [
    [
        'sku' => 'ZERO-SYRUP-500',
        'name' => 'ZERO Syrup 500 ml',
        'quantity' => 2,
        'unit_price' => 89000,
        'unit_weight_grams' => 650,
    ],
];
$merchandise = array_sum(array_map(
    static fn (array $item): int => $item['unit_price'] * $item['quantity'],
    $items
));
$weight = array_sum(array_map(
    static fn (array $item): int => $item['unit_weight_grams'] * $item['quantity'],
    $items
));

$payload = [
    'merchant_order_reference' => $zeroOrderId,
    'currency' => 'IDR',
    'items' => $items,
    'declared_totals' => [
        'merchandise' => $merchandise,
        'weight_grams' => $weight,
    ],
    'customer' => [
        'name' => '',
        'email' => '',
        'phone' => '',
    ],
    'return_urls' => [
        'success' => 'https://zerofoods.id/order/success',
        'cancel' => 'https://zerofoods.id/cart',
    ],
];
$raw = json_encode($payload, JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE | JSON_THROW_ON_ERROR);
$timestamp = (string) round(microtime(true) * 1000);
$signature = hash_hmac('sha256', $timestamp . '.' . $raw, $merchantSecret);

$curl = curl_init($baseUrl . '/api/v1/checkout-sessions');
if ($curl === false) {
    throw new RuntimeException('Unable to initialize the Ezkart request.');
}
curl_setopt_array($curl, [
    CURLOPT_POST => true,
    CURLOPT_RETURNTRANSFER => true,
    CURLOPT_TIMEOUT => 20,
    CURLOPT_HTTPHEADER => [
        'Content-Type: application/json',
        'X-Ezkart-Merchant: zerofoods',
        'X-Ezkart-Timestamp: ' . $timestamp,
        'X-Ezkart-Signature: ' . $signature,
        'Idempotency-Key: zero-checkout-' . $zeroOrderId,
    ],
    CURLOPT_POSTFIELDS => $raw,
]);
$responseBody = curl_exec($curl);
$status = (int) curl_getinfo($curl, CURLINFO_RESPONSE_CODE);
$error = curl_error($curl);
curl_close($curl);
$response = is_string($responseBody) ? json_decode($responseBody, true) : null;
if ($status !== 201 || !is_array($response) || !isset($response['checkout_url'])) {
    throw new RuntimeException(
        is_array($response) ? (string) ($response['error'] ?? 'Ezkart rejected checkout.') : $error
    );
}

// Store response.session_id against the ZERO order, then redirect the browser.
header('Location: ' . $response['checkout_url'], true, 303);
exit;
