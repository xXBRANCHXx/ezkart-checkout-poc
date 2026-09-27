<?php
declare(strict_types=1);

require_once __DIR__ . '/commerce-checkout.php';

final class EzCourierAccountException extends RuntimeException {}

/** Credentials may rotate; the pickup address and package must come from the order. */
function ez_central_courier_key(string $environment): string
{
    ez_central_commerce_environment($environment);
    return ez_biteship_api_key($environment);
}

function ez_central_courier_id(mixed $value): string
{
    if (!is_string($value) || preg_match('/^[A-Za-z0-9][A-Za-z0-9_-]{2,159}$/D', $value) !== 1) throw new RuntimeException('Invalid courier order identity.');
    return $value;
}

function ez_central_courier_request(string $environment, string $suffix, ?array $payload = null): array
{
    if ($suffix !== '' && preg_match('~^/[A-Za-z0-9_-]{3,160}(?:/cancel)?$~D', $suffix) !== 1) throw new RuntimeException('Invalid courier route.');
    $handle = curl_init(EZ_BITESHIP_ORDERS_URL . $suffix);
    if ($handle === false) throw new RuntimeException('Courier connection is unavailable.');
    $body = '';
    $options = [CURLOPT_HTTPHEADER => ['Accept: application/json', 'Content-Type: application/json', 'Authorization: ' . ez_central_courier_key($environment)],
        CURLOPT_RETURNTRANSFER => true, CURLOPT_CONNECTTIMEOUT => 5, CURLOPT_TIMEOUT => 20,
        CURLOPT_SSL_VERIFYPEER => true, CURLOPT_SSL_VERIFYHOST => 2, CURLOPT_FOLLOWLOCATION => false,
        CURLOPT_WRITEFUNCTION => static function ($handle, string $chunk) use (&$body): int {
            if (strlen($body) + strlen($chunk) > 524288) return 0;
            $body .= $chunk; return strlen($chunk);
        }];
    if ($payload !== null) $options += [CURLOPT_POST => true, CURLOPT_POSTFIELDS => ez_json_encode($payload)];
    curl_setopt_array($handle, $options);
    $success = curl_exec($handle);
    $status = (int) curl_getinfo($handle, CURLINFO_HTTP_CODE);
    $response = json_decode($body, true);
    if ($success === false || $status < 200 || $status >= 300 || !is_array($response) || ($response['success'] ?? false) !== true) {
        throw new EzProviderException('The courier operation was not confirmed.', $status, is_array($response) ? $response : []);
    }
    return $response;
}

function ez_central_courier_payload(array $order, array $shipment): array
{
    $shipping = $order['snapshot']['shipping']; $origin = $shipping['origin'] ?? []; $destination = $shipping['destination'] ?? [];
    $customer = $order['customer'];
    foreach ([$origin['origin_postal_code'] ?? '', $destination['postalCode'] ?? ''] as $postcode) {
        if (preg_match('/^\d{5}$/D', (string) $postcode) !== 1) throw new RuntimeException('Stored pickup or delivery postcode is incomplete.');
    }
    foreach ([$origin['origin_address'] ?? '', $destination['address'] ?? ''] as $address) {
        if (!is_string($address) || mb_strlen($address) < 5 || mb_strlen($address) > 300) throw new RuntimeException('Stored pickup or delivery address is incomplete.');
    }
    if (empty($origin['origin_contact_name']) || empty($customer['name'])) throw new RuntimeException('Stored delivery contacts are incomplete.');
    foreach ([$origin['origin_contact_phone'] ?? '', $customer['phone'] ?? ''] as $phone) {
        if (preg_match('/^\+?\d{8,15}$/D', $phone) !== 1) throw new RuntimeException('Stored delivery phone number is incomplete.');
    }
    foreach (['courierCode', 'serviceCode'] as $key) {
        if (!is_string($shipping[$key] ?? null) || preg_match('/^[a-z0-9_]{2,60}$/D', $shipping[$key]) !== 1) throw new RuntimeException('Stored delivery service is incomplete.');
    }
    $items = [];
    foreach ($order['items'] as $item) {
        if (($item['productType'] ?? 'physical') === 'digital') continue;
        if (($item['productType'] ?? 'physical') !== 'physical') throw new RuntimeException('Stored package type is unsupported.');
        if (($item['fulfillment']['weightGrams'] ?? 0) < 1) throw new RuntimeException('Stored package weight is incomplete.');
        $items[] = ['name' => mb_substr($item['title'] . (!empty($item['fulfillment']['variantName']) ? ' — ' . $item['fulfillment']['variantName'] : ''), 0, 100),
            'description' => mb_substr($item['sku'], 0, 100), 'sku' => $item['sku'], 'value' => $item['price'], 'quantity' => $item['quantity'], 'weight' => $item['fulfillment']['weightGrams']];
    }
    if (!$items) throw new RuntimeException('Stored package contents are incomplete.');
    $payload = ['reference_id' => $shipment['reference'], 'delivery_type' => 'now', 'origin_collection_method' => 'pickup',
        'courier_company' => $shipping['courierCode'], 'courier_type' => $shipping['serviceCode'],
        'shipper_contact_name' => $origin['origin_contact_name'], 'shipper_contact_phone' => $origin['origin_contact_phone'],
        'origin_contact_name' => $origin['origin_contact_name'], 'origin_contact_phone' => $origin['origin_contact_phone'],
        'origin_address' => $origin['origin_address'], 'origin_postal_code' => (int) $origin['origin_postal_code'],
        'destination_contact_name' => $customer['name'], 'destination_contact_phone' => $customer['phone'], 'destination_contact_email' => $customer['email'],
        'destination_address' => mb_substr(trim($destination['address'] . ', ' . ($destination['location'] ?? ''), ', '), 0, 300),
        'destination_postal_code' => (int) $destination['postalCode'], 'items' => $items,
        'tags' => ['ezkart', 'doku-' . $order['environment']], 'metadata' => ['environment' => $order['environment'], 'order_id' => $order['id']]];
    foreach (['origin_contact_email', 'origin_note', 'shipper_organization'] as $key) if (!empty($origin[$key])) $payload[$key] = $origin[$key];
    if (!empty($destination['note'])) $payload['destination_note'] = mb_substr($destination['note'], 0, 120);
    foreach (['origin' => $origin, 'destination' => $destination] as $name => $address) {
        if (($coordinate = ez_delivery_coordinate($address['coordinate'] ?? null)) !== null) $payload[$name . '_coordinate'] = $coordinate;
    }
    if ((in_array($shipping['courierCode'], ['gojek', 'grab'], true) || in_array($shipping['serviceCode'], ['instant', 'instant_car', 'instant_bike', 'same_day'], true)) && (!isset($payload['origin_coordinate']) || !isset($payload['destination_coordinate']))) {
        throw new RuntimeException('This service requires saved pickup and delivery pins.');
    }
    return $payload;
}

function ez_central_courier_stamp(mixed $value): string
{
    if ($value === null || $value === '') return '';
    if (!is_string($value) || preg_match('/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{1,3})?(?:Z|[+-]\d\d:\d\d)$/D', $value) !== 1
        || ($time = strtotime($value)) === false || $time > time() + 300) throw new InvalidArgumentException('Invalid courier timestamp.');
    return $value;
}

/** Unknown timestamps remain absent; receipt time is kept separately in the central inbox. */
function ez_central_courier_event(array $payload, bool $webhook = false): array
{
    $event = $webhook ? ($payload['event'] ?? '') : 'order.status';
    $kind = match ($event) {'order.status' => 'status', 'order.price' => 'price', 'order.waybill_id' => 'waybill', default => throw new InvalidArgumentException('Unsupported courier event.')};
    $courier = is_array($payload['courier'] ?? null) ? $payload['courier'] : [];
    $data = ['kind' => $kind, 'updatedAt' => ez_central_courier_stamp($payload['updated_at'] ?? $payload['timestamp'] ?? ''),
        'trackingId' => (string) ($payload['courier_tracking_id'] ?? $courier['tracking_id'] ?? ''),
        'waybillId' => (string) ($payload['courier_waybill_id'] ?? $payload['waybill_id'] ?? $courier['waybill_id'] ?? ''),
        'link' => (string) ($payload['courier_link'] ?? $payload['link'] ?? $courier['link'] ?? '')];
    if ($kind === 'status') $data['status'] = ez_tracking_status((string) ($payload['status'] ?? ''));
    if (isset($payload['price'])) {
        if (!is_numeric($payload['price']) || (float) $payload['price'] !== (float) (int) $payload['price'] || $payload['price'] < 0) throw new InvalidArgumentException('Invalid courier fee.');
        $data['price'] = (int) $payload['price'];
    } elseif ($kind === 'price') throw new InvalidArgumentException('Courier total fee is missing.');
    $coordinate = ez_tracking_coordinate($payload['coordinate'] ?? $payload['location']['coordinate'] ?? null);
    if ($coordinate !== null) $data['coordinate'] = $coordinate;
    if (is_string($payload['location_name'] ?? $payload['location']['name'] ?? null)) $data['locationName'] = mb_substr($payload['location_name'] ?? $payload['location']['name'], 0, 120);
    if (is_string($payload['note'] ?? null)) $data['note'] = mb_substr($payload['note'], 0, 500);
    if (!$webhook) {
        $data['proofLink'] = (string) ($payload['destination']['proof_of_delivery']['link'] ?? '');
        $history = $payload['history'] ?? $courier['history'] ?? [];
        if (!is_array($history)) throw new RuntimeException('Invalid courier history.');
        $data['history'] = [];
        foreach (array_slice($history, -100) as $entry) {
            if (!is_array($entry) || empty($entry['updated_at'])) continue;
            $scan = ['kind' => 'status', 'status' => ez_tracking_status((string) ($entry['status'] ?? '')), 'updatedAt' => ez_central_courier_stamp($entry['updated_at'])];
            if (is_string($entry['note'] ?? null)) $scan['note'] = mb_substr($entry['note'], 0, 200);
            if (is_string($entry['location_name'] ?? $entry['location']['name'] ?? null)) $scan['locationName'] = mb_substr($entry['location_name'] ?? $entry['location']['name'], 0, 120);
            if (($point = ez_tracking_coordinate($entry['coordinate'] ?? $entry['location']['coordinate'] ?? null)) !== null) $scan['coordinate'] = $point;
            $data['history'][] = $scan;
        }
        usort($data['history'], static fn(array $a, array $b): int => strtotime($a['updatedAt']) <=> strtotime($b['updatedAt']));
    }
    return $data;
}

function ez_central_shipment(string $id, string $environment): array
{
    if (preg_match('/^ship_[a-f0-9]{32}$/D', $id) !== 1) throw new RuntimeException('Invalid shipment identity.');
    return ez_commerce_request('GET', '/internal/commerce/shipments/' . $id . '?environment=' . ez_central_commerce_environment($environment));
}

function ez_central_courier_read(array $order, array $shipment, string $provider): array
{
    $response = ez_central_courier_request($order['environment'], '/' . ez_central_courier_id($provider));
    if (($response['id'] ?? '') !== $provider || ($response['reference_id'] ?? '') !== $shipment['reference']) throw new RuntimeException('Courier identity does not match the saved pickup request.');
    return $response;
}

function ez_central_courier_store(array $order, array $shipment, array $response, bool $bind = false): array
{
    return ez_commerce_request('POST', '/internal/commerce/shipments/' . $shipment['id'] . ($bind ? '/bind' : '/refresh'), [
        'environment' => $order['environment'], 'providerId' => ez_central_courier_id($response['id'] ?? null),
        'reference' => $shipment['reference'], 'verified' => true, 'revision' => $order['revision'], 'data' => ez_central_courier_event($response),
    ]);
}

/** Biteship guarantees a unique reference_id. Recovery reuses that exact reference. */
function ez_central_fulfillment_job(array $job, string $worker): array
{
    $outcome = 'uncertain'; $result = ['recorded' => false]; $message = '';
    try {
        $record = ez_central_shipment($job['data']['shipmentId'], $job['environment']);
        $accountHash = hash('sha256', ez_central_courier_key($job['environment']));
        if ($record['accountHash'] !== null && !hash_equals($record['accountHash'], $accountHash)) throw new EzCourierAccountException('Courier credentials changed.');
        $record = ez_commerce_request('POST', '/internal/commerce/shipments/' . $record['shipment']['id'] . '/account', [
            'environment' => $job['environment'], 'accountHash' => $accountHash,
        ]);
        $order = $record['order']; $shipment = $record['shipment'];
        if ($order['id'] !== $job['orderId']) throw new RuntimeException('Shipment job does not belong to this order.');
        if ($job['kind'] === 'shipment.create') {
            if ($shipment['providerId'] !== '') {
                // A lost storage acknowledgment needs no second create request.
                ez_commerce_request('POST', '/internal/commerce/shipping-events/drain', ['environment' => $job['environment']]);
                if ($shipment['state'] === 'queued') {
                    // Recovery can find the binding saved just before the response event was persisted.
                    $latest = ez_central_shipment($shipment['id'], $job['environment']);
                    $response = ez_central_courier_read($latest['order'], $shipment, $shipment['providerId']);
                    ez_central_courier_store($latest['order'], $shipment, $response);
                }
            } elseif ($order['state'] !== 'paid' || $order['paymentReview'] || $order['fulfillmentReview'] || $shipment['state'] !== 'queued') {
                // Reconciliation must remain visible while an order is held; it may not start a shipment.
                $message = 'Pickup creation is unresolved and the order is on hold. Locate the original courier reference before proceeding.';
            } else {
                if ($job['data']['reference'] !== $shipment['reference']) throw new RuntimeException('Pickup reference has changed.');
                $payload = ez_central_courier_payload($order, $shipment);
                try {
                    $response = ez_central_courier_request($order['environment'], '', $payload);
                } catch (EzProviderException $error) {
                    $duplicate = $error->providerPayload;
                    if ((int) ($duplicate['code'] ?? 0) !== 40002060) throw $error;
                    $provider = ez_central_courier_id($duplicate['details']['order_id'] ?? null);
                    // An error's provider ID alone is insufficient evidence of ownership.
                    $response = ez_central_courier_read($order, $shipment, $provider);
                }
                $provider = ez_central_courier_id($response['id'] ?? null);
                if (($response['reference_id'] ?? '') !== $shipment['reference']) $response = ez_central_courier_read($order, $shipment, $provider);
                ez_central_courier_store($order, $shipment, $response, true);
                ez_commerce_request('POST', '/internal/commerce/shipping-events/drain', ['environment' => $job['environment']]);
            }
            $latest = ez_central_shipment($shipment['id'], $job['environment']);
            if ($latest['shipment']['providerId'] !== '' && $latest['shipment']['state'] !== 'queued') { $outcome = 'succeeded'; $result = ['recorded' => true]; }
        } elseif (in_array($job['kind'], ['shipment.refresh', 'shipment.cancel'], true)) {
            if ($job['data']['providerId'] !== $shipment['providerId']) throw new RuntimeException('Courier job identity has changed.');
            $response = ez_central_courier_read($order, $shipment, $shipment['providerId']);
            if ($job['kind'] === 'shipment.cancel' && ez_tracking_status((string) ($response['status'] ?? '')) !== 'cancelled') {
                $status = ez_tracking_status((string) ($response['status'] ?? ''));
                if ($shipment['maximumStage'] >= 40 || !in_array($status, ['confirmed', 'scheduled', 'allocated', 'picking_up', 'on_hold', 'courier_not_found'], true)) {
                    ez_central_courier_store($order, $shipment, $response);
                    $outcome = 'dead'; $result = ['notStarted' => true]; $message = 'The courier has progressed beyond pickup cancellation. Review the shipment.';
                } else {
                    // POST /cancel is provider-confirmed cancellation, never a refund or stock adjustment.
                    $cancel = ez_central_courier_request($order['environment'], '/' . $shipment['providerId'] . '/cancel', [
                        'cancellation_reason_code' => 'others', 'cancellation_reason' => $job['data']['note'],
                    ]);
                    if (($cancel['id'] ?? '') !== $shipment['providerId'] || ez_tracking_status((string) ($cancel['status'] ?? '')) !== 'cancelled') throw new RuntimeException('Courier cancellation was not confirmed.');
                    // Re-read both systems: callbacks may have arrived during the cancellation operation.
                    $latest = ez_central_shipment($shipment['id'], $job['environment']);
                    $order = $latest['order'];
                    $response = ez_central_courier_read($order, $shipment, $shipment['providerId']);
                }
            }
            if ($outcome !== 'dead') {
                ez_central_courier_store($order, $shipment, $response);
                if ($job['kind'] === 'shipment.refresh' || ez_tracking_status((string) ($response['status'] ?? '')) === 'cancelled') {
                    $outcome = 'succeeded'; $result = ['recorded' => true];
                } else $message = 'The courier has not confirmed cancellation. Review the original pickup request.';
            }
        } else throw new RuntimeException('Unsupported fulfillment job.');
    } catch (Throwable $error) {
        // Never expose provider bodies, contacts or addresses through an operational error.
        $message = $error instanceof EzCourierAccountException
            ? 'Courier credentials changed after this pickup was requested. Restore the original credential or verify the original courier account through operator review.'
            : 'The courier result is unresolved. Reconcile the original pickup reference before retrying.';
        error_log('Ezkart fulfillment job ' . $job['id'] . ': ' . get_class($error));
    }
    return ez_commerce_request('POST', '/internal/commerce/jobs/' . $job['id'] . '/finish', [
        'environment' => $job['environment'], 'workerId' => $worker, 'leaseToken' => $job['leaseToken'],
        'outcome' => $outcome, 'result' => $result, 'error' => $message,
    ])['job'];
}

function ez_central_courier_webhook(array $payload, string $environment): array
{
    return ez_commerce_request('POST', '/internal/commerce/shipping-events', ['environment' => ez_central_commerce_environment($environment),
        'providerId' => ez_central_courier_id($payload['order_id'] ?? null), 'data' => ez_central_courier_event($payload, true)]);
}

/** Caller has already claimed the order through its verified customer session. */
function ez_central_customer_shipment(array $order, array $customer): array
{
    $record = ez_commerce_request('POST', '/internal/commerce/orders/' . $order['order_id'] . '/tracking', [
        'environment' => $order['commerce_environment'], 'customerId' => $customer['id'],
    ]);
    $shipment = $record['shipment'];
    if ($shipment === null) return $order;
    $order['biteship_order_id'] = $shipment['providerId'];
    $order['biteship_status'] = $shipment['state'] === 'queued' ? '' : $shipment['state'];
    $order['biteship_status_at'] = $shipment['statusAt'];
    $order['tracking_checked_at'] = $shipment['statusReceivedAt'];
    $order['biteship_waybill_id'] = $shipment['tracking']['waybillId'] ?? '';
    $order['biteship_tracking_link'] = $shipment['tracking']['link'] ?? '';
    $order['biteship_proof_link'] = $shipment['tracking']['proofLink'] ?? '';
    // Binding/recovery time is not evidence of when a courier pickup was arranged.
    $order['fulfilled_at'] = '';
    $location = $shipment['tracking']['latestLocation'] ?? null;
    $order['central_latest_location'] = $location ? ['latitude' => $location['latitude'], 'longitude' => $location['longitude'],
        'updated_at' => $location['updatedAt'], 'label' => $location['label'] ?: 'Last reported package location', 'status' => $location['status'] ?? '', 'source' => 'courier_scan'] : null;
    $order['central_shipment_history'] = array_map(static fn(array $entry): array => [
        'status' => $entry['status'], 'updated_at' => $entry['updatedAt'], 'received_at' => $entry['receivedAt'],
        'note' => $entry['note'], 'location_name' => $entry['locationName'], 'coordinate' => $entry['coordinate'],
    ], $record['history']);
    $order['biteship_history'] = $order['central_shipment_history'];
    return $order;
}
