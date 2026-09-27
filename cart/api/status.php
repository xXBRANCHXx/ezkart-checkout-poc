<?php
declare(strict_types=1);

require_once __DIR__ . '/bootstrap.php';
require_once __DIR__ . '/customer-auth.php';
require_once __DIR__ . '/commerce-checkout.php';

try {
    if (($_SERVER['REQUEST_METHOD'] ?? '') !== 'GET') {
        ez_api_json(['ok' => false, 'error' => 'Method not allowed.'], 405);
    }
    $tracking = ($_GET['tracking'] ?? '') === '1';
    $id = trim((string) ($_GET['order'] ?? ''));
    if ($tracking) {
        $customer = ez_customer_current();
        if ($customer === null) ez_api_json(['ok' => false, 'error' => 'Sign in with Google to track your order.'], 401);
        session_write_close();
        $order = ez_customer_claim_order($id, $customer);
        if (ez_central_commerce_enabled()) {
            require_once __DIR__ . '/commerce-fulfillment.php';
            $order = ez_central_customer_shipment($order, $customer);
        } elseif (($_GET['refresh'] ?? '') !== '0') $order = ez_refresh_order_tracking($order);
    } else {
        $order = ez_central_commerce_enabled() ? ez_central_order_projection(ez_central_order($id)) : ez_load_order($id);
    }
    $payload = [
        'ok' => true,
        'order_id' => $order['order_id'],
        'status' => $order['status'],
        'total' => $order['total'],
        'subtotal' => $order['subtotal'] ?? $order['total'],
        'shipping_price' => $order['shipping_price'] ?? 0,
        'shipping_skipped' => ez_order_skips_shipping($order),
        'shipping_kind' => $order['shipping_kind'] ?? 'carrier',
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
        'payment_flow' => $order['payment_flow'] ?? '',
        'payment_url' => ($order['payment_flow'] ?? '') === 'hosted' ? ($order['payment_url'] ?? '') : '',
        'payment_expires_at' => $order['payment_expires_at'] ?? '',
    ];
    // The public payment poll never exposes shipment data, history, or map coordinates.
    if ($tracking) $payload += [
        'downloads' => $order['digital_downloads'] ?? null,
        'fulfillment_status' => $order['fulfillment_status'] ?? 'AWAITING_PAYMENT',
        'biteship_order_id' => $order['biteship_order_id'] ?? '',
        'biteship_waybill_id' => $order['biteship_waybill_id'] ?? '',
        'accepted_at' => $order['accepted_at'] ?? '',
        'fulfillment_deadline_at' => $order['fulfillment_deadline_at'] ?? '',
        'tracking' => ez_public_order_tracking($order),
    ];
    if ($tracking && isset($order['central_shipment_history'])) {
        $payload['tracking']['history'] = $order['central_shipment_history'];
        $payload['tracking']['proof_link'] = $order['biteship_proof_link'];
        $payload['tracking']['latest_location'] = $order['central_latest_location'];
    }
    ez_api_json($payload);
} catch (InvalidArgumentException $error) {
    ez_api_json(['ok' => false, 'error' => 'Order not found.'], 404);
} catch (EzLegacyOrderStorageException $error) {
    header('Retry-After: 30');
    ez_api_json(['ok' => false, 'error' => 'Order updates are temporarily paused. Please retry shortly.'], 503);
} catch (EzCommerceStorageException $error) {
    ez_api_json(['ok' => false, 'error' => $error->httpStatus === 404 ? 'Order not found.' : 'Unable to read payment status.'], $error->httpStatus === 404 ? 404 : 503);
} catch (Throwable $error) {
    error_log('Ezkart payment status error: ' . $error->getMessage());
    ez_api_json(['ok' => false, 'error' => 'Unable to read payment status.'], 500);
}
