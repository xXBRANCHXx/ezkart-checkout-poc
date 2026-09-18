<?php
declare(strict_types=1);

function ez_doku_credentials(?string $environment = null): array
{
    $environment ??= ez_commerce_environment();
    $clientId = ez_provider_config('doku', 'client_id', $environment);
    $secret = ez_provider_config('doku', 'secret_key', $environment);
    if ($clientId === '' || $secret === '' || str_contains(strtoupper($clientId . $secret), 'REPLACE')
        || preg_match('/[\r\n]/', $clientId . $secret)) {
        throw new RuntimeException('DOKU ' . $environment . ' credentials are not configured on this server.');
    }
    return ['client_id' => $clientId, 'secret_key' => $secret, 'environment' => $environment];
}

function ez_doku_api_url(string $environment): string
{
    return $environment === 'production' ? 'https://api.doku.com/checkout/v1/payment' : 'https://api-sandbox.doku.com/checkout/v1/payment';
}

function ez_doku_signature(string $clientId, string $requestId, string $timestamp, string $target, string $body, string $secret): string
{
    $components = 'Client-Id:' . $clientId . "\nRequest-Id:" . $requestId
        . "\nRequest-Timestamp:" . $timestamp . "\nRequest-Target:" . $target
        . "\nDigest:" . base64_encode(hash('sha256', $body, true));
    return 'HMACSHA256=' . base64_encode(hash_hmac('sha256', $components, $secret, true));
}

function ez_doku_payment_url_valid(string $url, string $environment): bool
{
    $parts = parse_url($url);
    $hosts = $environment === 'production' ? ['jokul.doku.com'] : ['sandbox.doku.com', 'staging.doku.com'];
    return is_array($parts) && ($parts['scheme'] ?? '') === 'https' && in_array($parts['host'] ?? '', $hosts, true)
        && !isset($parts['user']) && !isset($parts['pass']) && !isset($parts['port'])
        && preg_match('~^/(?:checkout-link(?:-v2)?/|checkout/link/).+~D', (string) ($parts['path'] ?? '')) === 1;
}

function ez_doku_checkout_payload(array $order, string $publicUrl): array
{
    $customer = $order['customer'];
    $returnUrl = $publicUrl . '/cart/return.php?' . http_build_query(['order' => $order['order_id'], 'shop' => $order['shop'] ?? '']);
    $phone = ltrim((string) $customer['phone'], '+');
    if (str_starts_with($phone, '0')) $phone = '62' . substr($phone, 1);
    return [
        'order' => [
            'invoice_number' => $order['order_id'],
            'amount' => $order['total'],
            'currency' => 'IDR',
            'callback_url' => $returnUrl,
            'callback_url_result' => $returnUrl,
            'auto_redirect' => true,
            'line_items' => $order['items'],
        ],
        'payment' => [
            'payment_due_date' => 60,
            // These channels support the customer information collected by checkout.
            'payment_method_types' => ['VIRTUAL_ACCOUNT_BCA', 'VIRTUAL_ACCOUNT_BANK_MANDIRI', 'VIRTUAL_ACCOUNT_BRI', 'VIRTUAL_ACCOUNT_BNI', 'VIRTUAL_ACCOUNT_DOKU', 'QRIS', 'CREDIT_CARD'],
        ],
        'customer' => [
            'name' => $customer['name'], 'email' => $customer['email'], 'phone' => $phone,
            'address' => $customer['address'], 'city' => $customer['location'],
            'postcode' => $customer['postalCode'], 'country' => 'ID',
        ],
        'additional_info' => ['override_notification_url' => $publicUrl . '/cart/api/doku-webhook.php'],
    ];
}

function ez_create_doku_payment(array $order): array
{
    $credentials = ez_doku_credentials($order['commerce_environment']);
    $payload = ez_doku_checkout_payload($order, ez_checkout_public_url());
    $timestamp = gmdate('Y-m-d\TH:i:s\Z');
    $requestId = $order['payment_request_id'];
    $signature = ez_doku_signature($credentials['client_id'], $requestId, $timestamp, '/checkout/v1/payment', ez_json_encode($payload), $credentials['secret_key']);
    $response = ez_http_json(ez_doku_api_url($credentials['environment']), $payload, [
        'Accept: application/json', 'Content-Type: application/json',
        'Client-Id: ' . $credentials['client_id'], 'Request-Id: ' . $requestId,
        'Request-Timestamp: ' . $timestamp, 'Signature: ' . $signature,
    ], 'DOKU');
    $result = $response['response'] ?? [];
    $url = trim((string) ($result['payment']['url'] ?? ''));
    if (!ez_doku_payment_url_valid($url, $credentials['environment'])
        || ($result['order']['invoice_number'] ?? '') !== $order['order_id']
        || !ez_doku_amount_matches($result['order']['amount'] ?? null, (int) $order['total'])) {
        throw new RuntimeException('DOKU did not return a matching checkout session.');
    }
    return ['payment_url' => $url, 'payment_expires_at' => (string) ($result['payment']['expired_date'] ?? '')];
}

function ez_doku_amount_matches(mixed $amount, int $expected): bool
{
    return (is_int($amount) || is_float($amount) || is_string($amount))
        && preg_match('/^\d+(?:\.0+)?$/D', (string) $amount) === 1
        && (float) $amount === (float) $expected;
}

function ez_apply_doku_notification(string $body, array $headers, string $target): void
{
    $notification = json_decode($body, true);
    if (!is_array($notification)) throw new InvalidArgumentException('Invalid notification body.');
    $orderId = (string) ($notification['order']['invoice_number'] ?? '');
    if (preg_match('/^EZK-[SP]-[A-F0-9]{24}$/D', $orderId) !== 1) throw new InvalidArgumentException('Invalid DOKU invoice.');
    $environment = str_starts_with($orderId, 'EZK-P-') ? 'production' : 'sandbox';
    $credentials = ez_doku_credentials($environment);
    foreach (['client-id', 'request-id', 'request-timestamp', 'signature'] as $key) {
        if (!is_string($headers[$key] ?? null) || $headers[$key] === '' || strlen($headers[$key]) > 256 || preg_match('/[\r\n]/', $headers[$key])) {
            throw new InvalidArgumentException('Invalid notification headers.');
        }
    }
    if (!hash_equals($credentials['client_id'], $headers['client-id'])
        || !hash_equals(ez_doku_signature($headers['client-id'], $headers['request-id'], $headers['request-timestamp'], $target, $body, $credentials['secret_key']), $headers['signature'])) {
        throw new InvalidArgumentException('Invalid DOKU notification signature.');
    }
    // Delayed provider retries remain valid; order locking and monotonic status make replays harmless.
    $lock = ez_lock_order_state($orderId);
    try {
        $order = ez_load_order($orderId);
        if (($order['payment_provider'] ?? '') !== 'doku' || ($order['commerce_environment'] ?? '') !== $environment
            || !ez_doku_amount_matches($notification['order']['amount'] ?? null, (int) $order['total'])
            || (isset($notification['order']['currency']) && $notification['order']['currency'] !== 'IDR')) {
            throw new InvalidArgumentException('Notification order mismatch.');
        }
        $status = strtoupper((string) ($notification['transaction']['status'] ?? ''));
        // Checkout can retry another method after FAILED; neither failure nor a stale pending event reverses payment.
        if ($status !== 'SUCCESS' || ($order['status'] ?? '') === 'PAID') return;
        if (isset($notification['transaction']['type']) && !in_array($notification['transaction']['type'], ['SALE', 'CAPTURE'], true)) return;
        $order['status'] = 'PAID';
        $order['payment_status'] = 'SUCCESS';
        $order['payment_reference'] = mb_substr((string) ($notification['transaction']['original_request_id'] ?? $headers['request-id']), 0, 160);
        $order['payment_type'] = mb_substr((string) ($notification['channel']['id'] ?? $notification['service']['id'] ?? ''), 0, 80);
        $order['payment_notification_id'] = $headers['request-id'];
        $order['payment_notification_verified'] = true;
        $order['paid_at'] = gmdate(DATE_ATOM);
        $order['fulfillment_deadline_at'] = ez_order_skips_shipping($order) ? '' : ez_fulfillment_deadline($order);
        if (empty($order['biteship_order_id']) && empty($order['accepted_at'])) {
            $order['fulfillment_status'] = ez_order_skips_shipping($order) ? 'NOT_REQUIRED' : 'AWAITING_ACCEPTANCE';
        }
        $order['updated_at'] = gmdate(DATE_ATOM);
        ez_save_order($order);
    } finally {
        ez_unlock_order_state($lock);
    }
}
