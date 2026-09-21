<?php
declare(strict_types=1);

function ez_tracking_status(string $status): string
{
    $status = strtolower(preg_replace('/([a-z])([A-Z])/', '$1_$2', trim($status)) ?? '');
    return match ($status) {
        'pickingup' => 'picking_up', 'intransit' => 'in_transit', 'droppingoff' => 'dropping_off',
        'returnintransit' => 'return_in_transit', 'onhold' => 'on_hold', 'couriernotfound' => 'courier_not_found',
        'picked_up', 'courier_picked_up' => 'picked', 'canceled' => 'cancelled',
        default => preg_match('/^[a-z_]{2,80}$/D', $status) === 1 ? $status : '',
    };
}

function ez_tracking_time(string $value): string
{
    if ($value === '' || strlen($value) > 50) return '';
    $time = strtotime($value);
    return $time === false ? '' : gmdate(DATE_ATOM, $time);
}

function ez_tracking_rank(string $status): int
{
    return match ($status) {
        'confirmed', 'scheduled', 'allocated', 'picking_up' => 2,
        'picked', 'in_transit', 'dropping_off' => 3,
        'delivered' => 4,
        default => -1,
    };
}

function ez_tracking_sequence(string $status): int
{
    return match ($status) {
        'confirmed', 'scheduled' => 10, 'allocated' => 20, 'picking_up' => 30,
        'picked' => 40, 'in_transit' => 50, 'dropping_off' => 60, 'delivered' => 70,
        default => -1,
    };
}

function ez_tracking_history(array $entries): array
{
    $result = [];
    foreach ($entries as $entry) {
        if (!is_array($entry)) continue;
        $status = ez_tracking_status((string) ($entry['status'] ?? ''));
        $time = ez_tracking_time((string) ($entry['updated_at'] ?? ''));
        if ($status === '' || $time === '') continue;
        $note = mb_substr(trim((string) ($entry['note'] ?? '')), 0, 500);
        $key = $status . ':' . $time;
        if (!isset($result[$key]) || $note !== '') $result[$key] = ['status' => $status, 'updated_at' => $time, 'note' => $note];
    }
    $result = array_values($result);
    usort($result, static fn(array $a, array $b): int => strcmp($a['updated_at'], $b['updated_at']));
    return array_slice($result, -100);
}

function ez_apply_tracking_status(array &$order, string $status, string $updatedAt = ''): void
{
    $status = ez_tracking_status($status);
    if ($status === '') return;
    $eventTime = ez_tracking_time($updatedAt);
    $current = ez_tracking_status((string) ($order['biteship_status'] ?? ''));
    $currentTime = ez_tracking_time((string) ($order['biteship_status_at'] ?? ''));
    $stale = $eventTime !== '' && $currentTime !== '' && $eventTime < $currentTime;
    // Retries and delayed pickup notifications must not undo a later delivery milestone.
    $backward = ez_tracking_sequence($status) >= 0 && ez_tracking_sequence($status) < ez_tracking_sequence($current);
    $terminal = in_array($current, ['delivered', 'returned', 'cancelled', 'disposed'], true);
    if ($status !== $current || $eventTime !== '') {
        $order['biteship_history'] = ez_tracking_history([
            ...($order['biteship_history'] ?? []),
            ['status' => $status, 'updated_at' => $eventTime ?: gmdate(DATE_ATOM), 'note' => ''],
        ]);
    }
    $afterTerminal = $current === 'delivered' ? ['delivered', 'return_in_transit', 'returned', 'disposed'] : [$current, 'disposed'];
    if ($stale || $backward || ($terminal && !in_array($status, $afterTerminal, true))) return;
    $order['biteship_status'] = $status;
    if ($status !== $current || $eventTime !== '') $order['biteship_status_at'] = $eventTime ?: gmdate(DATE_ATOM);
    $order['fulfillment_status'] = match ($status) {
        'picked', 'in_transit', 'dropping_off' => 'IN_TRANSIT',
        default => strtoupper($status),
    };
}

function ez_tracking_link(string $value): string
{
    if (strlen($value) > 2000 || filter_var($value, FILTER_VALIDATE_URL) === false) return '';
    $parts = parse_url($value);
    return ($parts['scheme'] ?? '') === 'https' && !isset($parts['user']) && !isset($parts['pass']) ? $value : '';
}

function ez_tracking_coordinate(mixed $coordinate): ?array
{
    if (!is_array($coordinate)) return null;
    $lat = $coordinate['latitude'] ?? null;
    $lng = $coordinate['longitude'] ?? null;
    if (!is_numeric($lat) || !is_numeric($lng) || !is_finite((float) $lat) || !is_finite((float) $lng)
        || abs((float) $lat) > 90 || abs((float) $lng) > 180 || ((float) $lat === 0.0 && (float) $lng === 0.0)) return null;
    return ['latitude' => (float) $lat, 'longitude' => (float) $lng];
}

/** Read only from Biteship; never create a shipment or change payment state. */
function ez_fetch_biteship_tracking(array $order): array
{
    $credentials = ez_biteship_credentials((string) ($order['commerce_environment'] ?? 'sandbox'));
    // GET Order includes tracking history, courier.link and nullable pickup/destination coordinates.
    $id = (string) $order['biteship_order_id'];
    $url = EZ_BITESHIP_ORDERS_URL . '/' . rawurlencode($id);
    $handle = curl_init($url);
    if ($handle === false) throw new RuntimeException('Unable to start tracking request.');
    curl_setopt_array($handle, [
        CURLOPT_HTTPHEADER => ['Accept: application/json', 'Authorization: ' . $credentials['api_key']],
        CURLOPT_RETURNTRANSFER => true, CURLOPT_CONNECTTIMEOUT => 3, CURLOPT_TIMEOUT => 8, CURLOPT_SSL_VERIFYPEER => true,
    ]);
    $body = curl_exec($handle);
    $response = is_string($body) ? json_decode($body, true) : null;
    if ((int) curl_getinfo($handle, CURLINFO_HTTP_CODE) !== 200 || !is_array($response) || ($response['success'] ?? false) !== true
        || ($response['id'] ?? '') !== $id || ez_tracking_status((string) ($response['status'] ?? '')) === '') {
        throw new RuntimeException('Courier tracking is unavailable.');
    }
    $courier = is_array($response['courier'] ?? null) ? $response['courier'] : [];
    return [
        'status' => ez_tracking_status((string) $response['status']),
        'tracking_id' => mb_substr((string) ($courier['tracking_id'] ?? ''), 0, 160),
        'waybill_id' => mb_substr((string) ($response['waybill_id'] ?? $courier['waybill_id'] ?? ''), 0, 160),
        'link' => ez_tracking_link((string) ($response['link'] ?? $courier['link'] ?? '')),
        'history' => ez_tracking_history(is_array($response['history'] ?? null) ? $response['history'] : (is_array($courier['history'] ?? null) ? $courier['history'] : [])),
        'service_type' => mb_substr((string) ($courier['type'] ?? $order['shipping']['courier_type'] ?? ''), 0, 80),
        'locations' => [
            'origin' => ez_tracking_coordinate($response['origin']['coordinate'] ?? null),
            'destination' => ez_tracking_coordinate($response['destination']['coordinate'] ?? null),
        ],
    ];
}

function ez_refresh_order_tracking(array $order): array
{
    if (($order['status'] ?? '') !== 'PAID' || ez_order_skips_shipping($order) || empty($order['biteship_order_id'])) return $order;
    $id = (string) $order['order_id'];
    $lock = ez_lock_order_state($id);
    try {
        $order = ez_load_order($id);
        // A shared two-minute cache also throttles failures and concurrent customer tabs.
        if (time() - (int) ($order['tracking_requested_at'] ?? 0) < 120) return $order;
        $order['tracking_requested_at'] = time();
        $lease = bin2hex(random_bytes(12));
        $order['tracking_request_id'] = $lease;
        $eventHash = (string) ($order['biteship_last_event_hash'] ?? '');
        ez_save_order($order);
    } finally {
        ez_unlock_order_state($lock);
    }
    $snapshot = null;
    try {
        $snapshot = ez_fetch_biteship_tracking($order);
    } catch (Throwable $error) {
        error_log('Ezkart tracking refresh: ' . $error->getMessage());
    }
    // Release the lock during the provider call so payment and courier webhooks can proceed.
    $lock = ez_lock_order_state($id);
    try {
        $latest = ez_load_order($id);
        if (($latest['tracking_request_id'] ?? '') !== $lease) return $latest;
        $latest['tracking_unavailable'] = $snapshot === null;
        if ($snapshot !== null && ($latest['biteship_last_event_hash'] ?? '') === $eventHash) {
            $statusTime = '';
            foreach ($snapshot['history'] as $entry) {
                if ($entry['status'] === $snapshot['status']) $statusTime = $entry['updated_at'];
            }
            ez_apply_tracking_status($latest, $snapshot['status'], $statusTime);
            $latest['biteship_history'] = ez_tracking_history([...($latest['biteship_history'] ?? []), ...$snapshot['history']]);
            if ($snapshot['tracking_id'] !== '') $latest['biteship_tracking_id'] = $snapshot['tracking_id'];
            if ($snapshot['waybill_id'] !== '') $latest['biteship_waybill_id'] = $snapshot['waybill_id'];
            $latest['biteship_tracking_link'] = $snapshot['link'];
            $latest['biteship_locations'] = $snapshot['locations'];
            $latest['biteship_service_type'] = $snapshot['service_type'];
            $latest['tracking_checked_at'] = gmdate(DATE_ATOM);
        }
        ez_save_order($latest);
        return $latest;
    } finally {
        ez_unlock_order_state($lock);
    }
}

function ez_public_order_tracking(array $order): array
{
    $paid = ($order['status'] ?? '') === 'PAID';
    $skipped = ez_order_skips_shipping($order);
    $shipment = $paid && !$skipped ? ez_tracking_status((string) ($order['biteship_status'] ?? '')) : '';
    $fulfillment = (string) ($order['fulfillment_status'] ?? 'AWAITING_PAYMENT');
    $stage = !$paid ? 'awaiting_payment' : ($skipped ? 'not_required' : 'processing');
    if ($paid && !$skipped && !empty($order['biteship_order_id'])) {
        $stage = match ($shipment) {
            'confirmed', 'scheduled', 'allocated', 'picking_up' => 'awaiting_pickup',
            'picked', 'in_transit' => 'in_transit', 'dropping_off' => 'out_for_delivery',
            'delivered' => 'delivered', 'return_in_transit' => 'returning', 'returned' => 'returned',
            'cancelled' => 'cancelled', 'on_hold', 'rejected', 'courier_not_found', 'disposed' => 'attention',
            default => 'shipment_update',
        };
    } elseif ($paid && !$skipped && $fulfillment === 'RETRY_REQUIRED') {
        $stage = 'pickup_issue';
    }
    $history = $paid && !$skipped ? ez_tracking_history($order['biteship_history'] ?? []) : [];
    $progress = !$paid ? -1 : ($skipped ? 0 : 1);
    if ($shipment !== '') $progress = max($progress, ez_tracking_rank($shipment));
    if (ez_tracking_rank($shipment) < 0) {
        foreach ($history as $entry) $progress = max($progress, ez_tracking_rank($entry['status']));
    }
    // A returned or cancelled shipment must never present the delivered step as current.
    if ($shipment !== 'delivered') $progress = min($progress, 3);
    return [
        'stage' => $stage, 'progress' => $progress, 'shipment_status' => $shipment,
        'seller_accepted' => $paid && !empty($order['accepted_at']),
        'paid_at' => $paid ? ($order['paid_at'] ?? '') : '',
        'accepted_at' => $paid ? ($order['accepted_at'] ?? '') : '',
        'pickup_arranged_at' => $paid ? ($order['fulfilled_at'] ?? '') : '',
        'courier' => $paid && !$skipped ? trim((string) ($order['shipping']['courier'] ?? '') . ' ' . (string) ($order['shipping']['service'] ?? '')) : '',
        'waybill_id' => $paid && !$skipped ? (string) ($order['biteship_waybill_id'] ?? '') : '',
        'link' => $paid && !$skipped ? ez_tracking_link((string) ($order['biteship_tracking_link'] ?? '')) : '',
        'live_tracking' => $paid && !$skipped && ($order['biteship_service_type'] ?? $order['shipping']['courier_type'] ?? '') === 'instant',
        'locations' => $paid && !$skipped ? [
            'origin' => ez_tracking_coordinate($order['biteship_locations']['origin'] ?? null),
            'destination' => ez_tracking_coordinate($order['biteship_locations']['destination'] ?? null),
        ] : ['origin' => null, 'destination' => null],
        'history' => $history,
        'updated_at' => $order['biteship_status_at'] ?? $order['tracking_checked_at'] ?? $order['updated_at'] ?? '',
        'unavailable' => $paid && !$skipped && !empty($order['tracking_unavailable']),
    ];
}
