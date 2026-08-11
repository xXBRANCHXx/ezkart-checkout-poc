<?php
declare(strict_types=1);

require_once __DIR__ . '/bootstrap.php';

try {
    if (($_SERVER['REQUEST_METHOD'] ?? '') !== 'POST') {
        ez_api_json(['ok' => false], 405);
    }
    $notification = json_decode((string) file_get_contents('php://input'), true);
    if (!is_array($notification)) {
        throw new InvalidArgumentException('Invalid notification body.');
    }

    $credentials = ez_midtrans_credentials();
    $orderId = trim((string) ($notification['order_id'] ?? ''));
    $statusCode = trim((string) ($notification['status_code'] ?? ''));
    $grossAmount = trim((string) ($notification['gross_amount'] ?? ''));
    $signature = strtolower(trim((string) ($notification['signature_key'] ?? '')));
    if ($orderId === '' || $statusCode === '' || $grossAmount === '' || $signature === '') {
        throw new InvalidArgumentException('Missing notification parameters.');
    }
    $expected = hash('sha512', $orderId . $statusCode . $grossAmount . $credentials['server_key']);
    if (!hash_equals($expected, $signature)) {
        throw new InvalidArgumentException('Invalid Midtrans notification signature.');
    }
    $merchantId = trim((string) ($notification['merchant_id'] ?? ''));
    if ($merchantId !== '' && !hash_equals($credentials['merchant_id'], $merchantId)) {
        throw new InvalidArgumentException('Merchant ID mismatch.');
    }

    $stateLock = ez_lock_order_state($orderId);
    try {
        $order = ez_load_order($orderId);
        if ((int) round((float) $grossAmount) !== (int) $order['total']) {
            throw new InvalidArgumentException('Notification amount mismatch.');
        }
        $transactionStatus = strtolower(trim((string) ($notification['transaction_status'] ?? '')));
        $fraudStatus = strtolower(trim((string) ($notification['fraud_status'] ?? '')));
        $success = $statusCode === '200' && ($fraudStatus === '' || $fraudStatus === 'accept');
        $nextStatus = match ($transactionStatus) {
            'capture', 'settlement' => $success ? 'PAID' : ($fraudStatus === 'challenge' ? 'PENDING' : 'FAILED'),
            'pending', 'authorize' => 'PENDING',
            'deny', 'cancel', 'expire', 'failure', 'refund', 'partial_refund', 'chargeback', 'partial_chargeback' => 'FAILED',
            default => throw new InvalidArgumentException('Unsupported Midtrans transaction status.'),
        };
        if ((string) $order['status'] === 'PAID' && $nextStatus === 'PENDING') {
            $nextStatus = 'PAID';
        }

        $order['status'] = $nextStatus;
        $order['midtrans_transaction_id'] = mb_substr((string) ($notification['transaction_id'] ?? ''), 0, 160);
        $order['midtrans_status'] = $transactionStatus;
        $order['payment_type'] = mb_substr((string) ($notification['payment_type'] ?? ''), 0, 80);
        $order['fraud_status'] = $fraudStatus;
        $order['status_message'] = mb_substr((string) ($notification['status_message'] ?? ''), 0, 300);
        if ($nextStatus !== 'PAID' && trim((string) ($order['biteship_order_id'] ?? '')) === '') {
            $order['fulfillment_status'] = 'AWAITING_PAYMENT';
        }
        $order['updated_at'] = gmdate(DATE_ATOM);
        ez_save_order($order);
    } finally {
        ez_unlock_order_state($stateLock);
    }
    if ($nextStatus === 'PAID') {
        ez_fulfill_paid_order($orderId);
    }
    ez_api_json(['ok' => true]);
} catch (InvalidArgumentException $error) {
    error_log('Ezkart Midtrans callback rejected: ' . $error->getMessage());
    ez_api_json(['ok' => false], 400);
} catch (Throwable $error) {
    error_log('Ezkart Midtrans callback error: ' . $error->getMessage());
    ez_api_json(['ok' => false], 500);
}
