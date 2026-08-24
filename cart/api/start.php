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
    $credentials = ez_midtrans_credentials();
    ez_biteship_credentials();
    $orderId = 'EZK-MIDTRANS-' . gmdate('ymdHis') . '-' . strtoupper(bin2hex(random_bytes(12)));
    $customer = $checkout['customer'];
    $nameParts = preg_split('/\s+/', $customer['name'], 2) ?: [$customer['name']];
    $firstName = mb_substr((string) ($nameParts[0] ?? ''), 0, 50);
    $lastName = mb_substr((string) ($nameParts[1] ?? ''), 0, 50);
    $address = [
        'first_name' => $firstName,
        'last_name' => $lastName,
        'email' => $customer['email'],
        'phone' => $customer['phone'],
        'address' => mb_substr($customer['address'], 0, 200),
        'city' => mb_substr($customer['location'], 0, 100),
        'postal_code' => $customer['postalCode'],
        'country_code' => 'IDN',
    ];
    $checkoutPublicUrl = ez_checkout_public_url();
    $notificationUrl = $checkoutPublicUrl . '/cart/api/callback.php';
    $returnUrl = $checkoutPublicUrl . '/cart/return.php?order=' . rawurlencode($orderId);
    $payload = [
        'transaction_details' => [
            'order_id' => $orderId,
            'gross_amount' => $checkout['total'],
        ],
        'item_details' => $checkout['items'],
        'customer_details' => [
            'first_name' => $firstName,
            'last_name' => $lastName,
            'email' => $customer['email'],
            'phone' => $customer['phone'],
            'billing_address' => $address,
            'shipping_address' => $address,
        ],
        'credit_card' => ['secure' => true],
        'callbacks' => ['finish' => $returnUrl],
        'expiry' => ['unit' => 'minutes', 'duration' => 15],
    ];
    $order = $checkout + [
        'order_id' => $orderId,
        'status' => 'CREATING',
        'midtrans_transaction_id' => '',
        'midtrans_status' => '',
        'payment_type' => '',
        'fraud_status' => '',
        'status_message' => '',
        'fulfillment_status' => 'AWAITING_PAYMENT',
        'paid_at' => '',
        'accepted_at' => '',
        'fulfillment_deadline_at' => '',
        'fulfillment_error' => '',
        'biteship_order_id' => '',
        'biteship_tracking_id' => '',
        'biteship_waybill_id' => '',
        'biteship_status' => '',
        'snap_token' => '',
        'snap_redirect_url' => '',
        'created_at' => gmdate(DATE_ATOM),
        'updated_at' => gmdate(DATE_ATOM),
    ];
    ez_save_order($order);

    try {
        $transaction = ez_http_json(ez_midtrans_snap_api_url(), $payload, [
            'Accept: application/json',
            'Content-Type: application/json',
            'Authorization: Basic ' . base64_encode($credentials['server_key'] . ':'),
            'X-Override-Notification: ' . $notificationUrl,
        ], 'Midtrans ' . ez_commerce_environment());
        $snapToken = trim((string) ($transaction['token'] ?? ''));
        $redirectUrl = trim((string) ($transaction['redirect_url'] ?? ''));
        if ($snapToken === '' || !str_starts_with($redirectUrl, ez_commerce_is_production() ? 'https://app.midtrans.com/' : 'https://app.sandbox.midtrans.com/')) {
            throw new RuntimeException('Midtrans did not create a valid Snap ' . ez_commerce_environment() . ' transaction.');
        }
    } catch (Throwable $error) {
        $stateLock = ez_lock_order_state($orderId);
        try {
            $failedOrder = ez_load_order($orderId);
            if (strtoupper((string) ($failedOrder['status'] ?? '')) === 'CREATING') {
                $failedOrder['status'] = 'FAILED';
                $failedOrder['midtrans_status'] = 'create_failed';
                $failedOrder['status_message'] = mb_substr($error->getMessage(), 0, 300);
                $failedOrder['updated_at'] = gmdate(DATE_ATOM);
                ez_save_order($failedOrder);
            }
        } finally {
            ez_unlock_order_state($stateLock);
        }
        throw $error;
    }

    $stateLock = ez_lock_order_state($orderId);
    try {
        $order = ez_load_order($orderId);
        if (strtoupper((string) ($order['status'] ?? '')) === 'CREATING') {
            $order['status'] = 'PENDING';
        }
        $order['snap_token'] = $snapToken;
        $order['snap_redirect_url'] = $redirectUrl;
        $order['updated_at'] = gmdate(DATE_ATOM);
        ez_save_order($order);
    } finally {
        ez_unlock_order_state($stateLock);
    }
    ez_api_json([
        'ok' => true,
        'order_id' => $orderId,
        'snap_token' => $snapToken,
        'payment_total' => $checkout['total'],
    ], 201);
} catch (InvalidArgumentException $error) {
    ez_api_json(['ok' => false, 'error' => $error->getMessage()], 422);
} catch (Throwable $error) {
    error_log('Ezkart Midtrans start error: ' . $error->getMessage());
    ez_api_json(['ok' => false, 'error' => $error->getMessage()], 503);
}
