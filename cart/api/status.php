<?php
declare(strict_types=1);

require_once __DIR__ . '/bootstrap.php';

try {
    if (($_SERVER['REQUEST_METHOD'] ?? '') !== 'GET') {
        ez_api_json(['ok' => false, 'error' => 'Method not allowed.'], 405);
    }
    $order = ez_load_order(trim((string) ($_GET['order'] ?? '')));
    // Only the tracking page requests courier data; payment polls stay local.
    if (($_GET['tracking'] ?? '') === '1') $order = ez_refresh_order_tracking($order);
    ez_api_json([
        'ok' => true,
        'order_id' => $order['order_id'],
        'status' => $order['status'],
        'total' => $order['total'],
        'subtotal' => $order['subtotal'] ?? $order['total'],
        'shipping_price' => $order['shipping_price'] ?? 0,
        'shipping_skipped' => ez_order_skips_shipping($order),
        'shop' => $order['shop'] ?? '',
        'items' => array_values(array_map(static fn(array $item): array => [
            'name' => (string) $item['name'], 'price' => (int) $item['price'], 'quantity' => (int) $item['quantity'],
        ], array_filter($order['items'] ?? [], static fn(array $item): bool => ($item['id'] ?? '') !== 'EZK-SHIPPING'))),
        'payment_details' => isset($order['payment_details']) ? [
            'method' => $order['payment_details']['method'],
            'account_number' => $order['payment_details']['account_number'],
            'expires_at' => $order['payment_details']['expires_at'],
        ] : null,
        'payment_provider' => $order['payment_provider'] ?? 'midtrans',
        'payment_reference' => $order['payment_reference'] ?? $order['midtrans_transaction_id'] ?? '',
        'payment_status' => $order['payment_status'] ?? $order['midtrans_status'] ?? '',
        'environment' => $order['commerce_environment'] ?? 'sandbox',
        'payment_type' => $order['payment_type'],
        'customer_name' => $order['customer']['name'],
        'fulfillment_status' => $order['fulfillment_status'] ?? 'AWAITING_PAYMENT',
        'biteship_order_id' => $order['biteship_order_id'] ?? '',
        'biteship_waybill_id' => $order['biteship_waybill_id'] ?? '',
        'accepted_at' => $order['accepted_at'] ?? '',
        'fulfillment_deadline_at' => $order['fulfillment_deadline_at'] ?? '',
        'tracking' => ez_public_order_tracking($order),
    ]);
} catch (InvalidArgumentException $error) {
    ez_api_json(['ok' => false, 'error' => 'Order not found.'], 404);
} catch (Throwable $error) {
    error_log('Ezkart payment status error: ' . $error->getMessage());
    ez_api_json(['ok' => false, 'error' => 'Unable to read payment status.'], 500);
}
