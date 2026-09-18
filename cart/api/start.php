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

    // Validate credentials before requesting a paid Biteship rate lookup.
    $environment = ez_commerce_environment();
    ez_doku_credentials();
    $checkout = ez_checkout_request($input);
    $orderId = 'EZK-' . ($environment === 'production' ? 'P' : 'S') . '-' . strtoupper(bin2hex(random_bytes(12)));
    $shop = strtolower(trim((string) ($input['shop'] ?? '')));
    if (preg_match('/^[a-z0-9][a-z0-9_-]{5,79}$/D', $shop) !== 1) $shop = '';
    $order = $checkout + [
        'order_id' => $orderId,
        'status' => 'CREATING',
        'commerce_environment' => $environment,
        'payment_provider' => 'doku',
        'payment_request_id' => bin2hex(random_bytes(16)),
        'payment_reference' => '',
        'payment_status' => '',
        'shop' => $shop,
        'payment_type' => '',
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
        'payment_url' => '',
        'created_at' => gmdate(DATE_ATOM),
        'updated_at' => gmdate(DATE_ATOM),
    ];
    ez_save_order($order);

    try {
        $payment = ez_create_doku_payment($order);
    } catch (Throwable $error) {
        $stateLock = ez_lock_order_state($orderId);
        try {
            $failedOrder = ez_load_order($orderId);
            if (strtoupper((string) ($failedOrder['status'] ?? '')) === 'CREATING') {
                $failedOrder['status'] = 'FAILED';
                $failedOrder['payment_status'] = 'create_failed';
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
        $order = array_merge($order, $payment);
        $order['updated_at'] = gmdate(DATE_ATOM);
        ez_save_order($order);
    } finally {
        ez_unlock_order_state($stateLock);
    }
    ez_api_json([
        'ok' => true,
        'order_id' => $orderId,
        'payment_url' => $payment['payment_url'],
        'environment' => $environment,
        'provider' => 'doku',
        'payment_total' => $checkout['total'],
    ], 201);
} catch (InvalidArgumentException $error) {
    ez_api_json(['ok' => false, 'error' => $error->getMessage()], 422);
} catch (Throwable $error) {
    error_log('Ezkart DOKU start error: ' . $error->getMessage());
    ez_api_json(['ok' => false, 'error' => 'Secure payment is temporarily unavailable. Please try again.'], 503);
}
