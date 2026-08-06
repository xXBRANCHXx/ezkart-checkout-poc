<?php
declare(strict_types=1);

require_once __DIR__ . '/bootstrap.php';

try {
    if (($_SERVER['REQUEST_METHOD'] ?? '') !== 'POST') {
        ez_api_json(['ok' => false], 405);
    }
    $credentials = ez_duitku_credentials();
    $merchantCode = trim((string) ($_POST['merchantCode'] ?? ''));
    $amount = trim((string) ($_POST['amount'] ?? ''));
    $orderId = trim((string) ($_POST['merchantOrderId'] ?? ''));
    $signature = strtolower(trim((string) ($_POST['signature'] ?? '')));
    if ($merchantCode === '' || $amount === '' || $orderId === '' || $signature === '') {
        throw new InvalidArgumentException('Missing callback parameters.');
    }
    if (!hash_equals($credentials['code'], $merchantCode)) {
        throw new InvalidArgumentException('Merchant code mismatch.');
    }
    $expected = hash_hmac('sha256', $merchantCode . $amount . $orderId, $credentials['key']);
    if (!hash_equals($expected, $signature)) {
        throw new InvalidArgumentException('Invalid Duitku callback signature.');
    }
    $order = ez_load_order($orderId);
    if ((int) $amount !== (int) $order['total']) {
        throw new InvalidArgumentException('Callback amount mismatch.');
    }
    $order['status'] = (string) ($_POST['resultCode'] ?? '') === '00' ? 'PAID' : 'FAILED';
    $order['duitku_reference'] = mb_substr((string) ($_POST['reference'] ?? $order['duitku_reference']), 0, 160);
    $order['payment_code'] = mb_substr((string) ($_POST['paymentCode'] ?? ''), 0, 20);
    $order['updated_at'] = gmdate(DATE_ATOM);
    ez_save_order($order);
    ez_api_json(['ok' => true]);
} catch (InvalidArgumentException $error) {
    error_log('Ezkart Duitku callback rejected: ' . $error->getMessage());
    ez_api_json(['ok' => false], 400);
} catch (Throwable $error) {
    error_log('Ezkart Duitku callback error: ' . $error->getMessage());
    ez_api_json(['ok' => false], 500);
}
