<?php
declare(strict_types=1);

require_once __DIR__ . '/bootstrap.php';

try {
    if (($_SERVER['REQUEST_METHOD'] ?? '') !== 'GET') {
        ez_api_json(['ok' => false, 'error' => 'Method not allowed.'], 405);
    }
    $order = ez_load_order(trim((string) ($_GET['order'] ?? '')));
    ez_api_json([
        'ok' => true,
        'order_id' => $order['order_id'],
        'status' => $order['status'],
        'total' => $order['total'],
        'midtrans_transaction_id' => $order['midtrans_transaction_id'],
        'midtrans_status' => $order['midtrans_status'],
        'payment_type' => $order['payment_type'],
        'customer_name' => $order['customer']['name'],
    ]);
} catch (InvalidArgumentException $error) {
    ez_api_json(['ok' => false, 'error' => 'Order not found.'], 404);
} catch (Throwable $error) {
    error_log('Ezkart Midtrans status error: ' . $error->getMessage());
    ez_api_json(['ok' => false, 'error' => 'Unable to read payment status.'], 500);
}
