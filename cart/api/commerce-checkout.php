<?php
declare(strict_types=1);

require_once __DIR__ . '/commerce-client.php';

function ez_central_commerce_environment(?string $requested = null): string
{
    $database = ez_database_configuration();
    $expected = $database['environment'] === 'test' ? 'sandbox' : 'production';
    if (($requested ?? ez_commerce_environment()) !== $expected) {
        throw new EzCommerceStorageException('Payment settings do not match this checkout environment.', 503);
    }
    return $expected;
}

/** The original browser intent is separate from mutable catalog and delivery quotes. */
function ez_checkout_intent(array $input): array
{
    $key = $input['checkout_key'] ?? null;
    if (!is_string($key) || preg_match('/^[a-f0-9]{32}$/D', $key) !== 1) throw new InvalidArgumentException('Reload checkout before starting payment.');
    $cart = $input['cart'] ?? null;
    $prices = $input['expected_prices'] ?? null;
    if (!is_array($cart) || count($cart) < 1 || count($cart) > 50 || !is_array($prices) || count($cart) !== count($prices)) {
        throw new InvalidArgumentException('Review the products and total before paying.');
    }
    foreach ($cart as $id => $quantity) {
        if (!is_string($id) || preg_match('/^[a-zA-Z0-9][a-zA-Z0-9_-]{2,95}(?:~[a-zA-Z0-9][a-zA-Z0-9_-]{2,95})?$/D', $id) !== 1
            || !is_int($quantity) || $quantity < 1 || $quantity > 10000
            || !is_int($prices[$id] ?? null) || $prices[$id] < 1 || $prices[$id] > 1000000000) {
            throw new InvalidArgumentException('A product quantity or price is invalid.');
        }
    }
    ksort($cart, SORT_STRING); ksort($prices, SORT_STRING);
    $total = $input['expected_total'] ?? null;
    if (!is_int($total) || $total < 1 || $total > 100000000000) throw new InvalidArgumentException('Review the order total before paying.');
    $customer = $input['customer'] ?? null;
    if (!is_array($customer)) throw new InvalidArgumentException('Customer details are required.');
    $normalized = [];
    foreach (['fullName' => 100, 'email' => 120, 'phone' => 30, 'location' => 120, 'address' => 300, 'postalCode' => 5, 'note' => 120] as $field => $limit) {
        $value = $customer[$field] ?? '';
        if (!is_string($value) || mb_strlen($value) > $limit || preg_match('/[\x00-\x1f]/', $value)) throw new InvalidArgumentException('Customer details are invalid.');
        $normalized[$field] = trim($value);
    }
    $normalized['email'] = strtolower($normalized['email']);
    if (isset($customer['coordinate'])) {
        $coordinate = ez_delivery_coordinate($customer['coordinate']);
        if ($coordinate === null) throw new InvalidArgumentException('Choose a valid delivery pin.');
        $normalized['coordinate'] = $coordinate;
    }
    $shippingId = $input['shipping_id'] ?? '';
    $shop = $input['shop'] ?? '';
    if (!is_string($shippingId) || strlen($shippingId) > 160 || preg_match('/[\x00-\x1f]/', $shippingId)
        || !is_string($shop) || strlen($shop) > 80) throw new InvalidArgumentException('Checkout details are invalid.');
    $shop = strtolower(trim($shop));
    if (preg_match('/^[a-z0-9][a-z0-9_-]{5,79}$/D', $shop) !== 1) $shop = '';
    $intent = ['cart' => $cart, 'expected_prices' => $prices, 'expected_total' => $total,
        'customer' => $normalized, 'shipping_id' => trim($shippingId), 'shop' => $shop];
    if (array_key_exists('campaign_visit', $input)) {
        if (!is_string($input['campaign_visit']) || preg_match('/^[a-f0-9]{64}$/D', $input['campaign_visit']) !== 1) throw new InvalidArgumentException('Campaign visit reference is invalid.');
        $intent['campaign_visit'] = $input['campaign_visit'];
    }
    return ['key' => $key, 'hash' => hash('sha256', ez_json_encode($intent)), 'input' => $intent];
}

function ez_central_order(string $id, ?string $environment = null): array
{
    if (preg_match('/^EZK-[SP]-[A-F0-9]{24}$/D', $id) !== 1) throw new InvalidArgumentException('Order not found.');
    $environment = ez_central_commerce_environment($environment ?? (str_starts_with($id, 'EZK-P-') ? 'production' : 'sandbox'));
    return ez_commerce_request('GET', '/internal/commerce/orders/' . $id . '?environment=' . $environment)['order'];
}

/** An adapter for existing provider payloads; this projection is never written to JSON files. */
function ez_central_order_projection(array $record): array
{
    $shipping = $record['snapshot']['shipping'];
    $customer = $record['customer'];
    $destination = $shipping['destination'] ?? [];
    $items = []; $shippingItems = [];
    foreach ($record['items'] as $item) {
        $name = $item['title'] . (!empty($item['fulfillment']['variantName']) ? ' — ' . $item['fulfillment']['variantName'] : '');
        $items[] = ['id' => $item['sku'], 'name' => mb_substr($name, 0, 50), 'price' => $item['price'], 'quantity' => $item['quantity']];
        $shippingItems[] = ['name' => mb_substr($name, 0, 100), 'description' => $item['sku'], 'sku' => $item['sku'],
            'value' => $item['price'], 'quantity' => $item['quantity'], 'weight' => $item['fulfillment']['weightGrams']];
    }
    if ($record['shippingAmount'] > 0) $items[] = ['id' => 'EZK-SHIPPING', 'name' => 'Delivery', 'price' => $record['shippingAmount'], 'quantity' => 1];
    $payment = $record['payment'];
    return [
        'order_id' => $record['id'], 'seller_id' => $record['sellerId'], 'commerce_environment' => $record['environment'],
        'status' => strtoupper($record['state']), 'subtotal' => $record['subtotal'], 'total' => $record['total'],
        'shipping_price' => $record['shippingAmount'], 'shipping_skipped' => $shipping['skipped'],
        'shipping' => $shipping['quote'] ?? null, 'items' => $items, 'shipping_items' => $shippingItems,
        'customer' => ['name' => $customer['name'], 'email' => $customer['email'], 'phone' => $customer['phone'],
            'address' => $destination['address'] ?? '', 'location' => $destination['location'] ?? '',
            'postalCode' => $destination['postalCode'] ?? '', 'note' => $destination['note'] ?? '']
            + (isset($destination['coordinate']) ? ['coordinate' => $destination['coordinate']] : []),
        'customer_auth_user_id' => $customer['authUserId'] ?? '',
        'shop' => $record['snapshot']['checkout']['shop'], 'payment_provider' => 'doku',
        'payment_flow' => $record['snapshot']['checkout']['paymentFlow'], 'payment_request_id' => $record['paymentRequestId'],
        'payment_url' => $payment['paymentUrl'] ?? '', 'payment_expires_at' => $payment['expiresAt'] ?? $record['expiresAt'],
        'payment_type' => $payment['method'] ?? '', 'payment_status' => strtoupper($record['state']),
        'payment_details' => !empty($payment['accountNumber']) ? ['method' => $payment['method'],
            'account_number' => $payment['accountNumber'], 'expires_at' => $payment['expiresAt']] : null,
        'fulfillment_status' => strtoupper($record['fulfillmentState']), 'paid_at' => $record['paidAt'] ?? '',
        'accepted_at' => $record['acceptedAt'] ?? '',
        'created_at' => $record['createdAt'], 'updated_at' => $record['updatedAt'],
    ];
}

function ez_central_checkout(array $input, ?array $account): array
{
    $environment = ez_central_commerce_environment();
    $intent = ez_checkout_intent($input);
    $resume = static fn(): ?array => ez_commerce_request('POST', '/internal/commerce/checkouts/resume', [
        'environment' => $environment, 'checkoutKey' => $intent['key'], 'intentHash' => $intent['hash'],
    ])['order'];
    $order = $resume();
    if ($order === null) {
        // Check credentials before the billable shipping quote, and reserve only a reviewed price.
        ez_doku_credentials($environment);
        $flow = ez_doku_payment_flow($environment);
        $checkout = ez_checkout_request($intent['input']);
        if ($checkout['seller_id'] === 'demo') throw new InvalidArgumentException('Choose a store product to start a real checkout. Demo products are for preview only.');
        foreach ($checkout['commerce_items'] as $id => $item) {
            if ($intent['input']['expected_prices'][$id] !== $item['expectedPrice']) throw new InvalidArgumentException('A product price changed. Review the updated total before paying.');
        }
        if ($checkout['total'] !== $intent['input']['expected_total']) throw new InvalidArgumentException('The delivery price or total changed. Review the updated total before paying.');
        $customer = $checkout['customer'];
        $shipping = ['amount' => $checkout['shipping_price'], 'skipped' => $checkout['shipping_skipped'],
            'destination' => array_intersect_key($customer, array_flip(['location', 'address', 'postalCode', 'note', 'coordinate']))];
        if (!$shipping['skipped']) {
            $shipping += ['courierCode' => $checkout['shipping']['courier_company'], 'serviceCode' => $checkout['shipping']['courier_type'],
                'quote' => $checkout['shipping']] + array_intersect_key($checkout['shipping_context'], array_flip([
                    'settingsRevision', 'pickupAddressId', 'returnAddressId', 'origin', 'returnAddress',
                ]));
        }
        try {
            $order = ez_commerce_request('POST', '/internal/commerce/orders', [
                'environment' => $environment, 'checkoutKey' => $intent['key'], 'sellerId' => $checkout['seller_id'],
                'checkout' => ['intentHash' => $intent['hash'], 'paymentFlow' => $flow, 'shop' => $intent['input']['shop']]
                    + (isset($intent['input']['campaign_visit']) ? ['campaignVisit' => $intent['input']['campaign_visit']] : []),
                'customer' => ['name' => $customer['name'], 'email' => $customer['email'], 'phone' => $customer['phone'], 'authUserId' => $account['id'] ?? ''],
                'items' => array_values($checkout['commerce_items']), 'shipping' => $shipping,
                'expiresAt' => gmdate('Y-m-d\TH:i:s\Z', time() + 3600),
            ])['order'];
        } catch (EzCommerceStorageException $error) {
            // A concurrent retry may have stored the original quote or account while this request was quoting.
            if ($error->httpStatus !== 409) throw $error;
            $order = $resume();
            if ($order === null) throw new InvalidArgumentException($error->getMessage());
        }
    }
    require_once __DIR__ . '/commerce-payment-jobs.php';
    // Once the order exists, the client always receives its recoverable payment page.
    try { $order = ez_central_checkout_payment($order); }
    catch (Throwable $error) { error_log('Ezkart central payment pending for ' . $order['id'] . ': ' . $error->getMessage()); }
    return ['ok' => true, 'order_id' => $order['id'], 'payment_url' => $order['payment']['paymentUrl'] ?? '',
        'environment' => $environment, 'provider' => 'doku', 'payment_flow' => $order['snapshot']['checkout']['paymentFlow'],
        'payment_total' => $order['total'], 'status' => strtoupper($order['state']), 'durable_checkout' => true];
}
