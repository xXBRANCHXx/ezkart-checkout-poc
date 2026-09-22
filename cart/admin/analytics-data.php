<?php
declare(strict_types=1);

function ez_analytics_reports(): array
{
    return [
        'overview' => ['title' => 'Analytics', 'label' => 'Overview', 'icon' => 'grid', 'description' => 'Understand your store, then explore the numbers behind each result.'],
        'revenue' => ['title' => 'Revenue analytics', 'label' => 'Revenue', 'icon' => 'money', 'description' => 'Explore confirmed revenue, shipping collected, and average paid order value.'],
        'orders' => ['title' => 'Order analytics', 'label' => 'Orders', 'icon' => 'cart', 'description' => 'Track order volume, basket sizes, and the progress of your deliveries.'],
        'payments' => ['title' => 'Payment analytics', 'label' => 'Payments', 'icon' => 'credit-card', 'description' => 'Understand payment completion, unresolved orders, and performance by method.'],
        'products' => ['title' => 'Product analytics', 'label' => 'Products', 'icon' => 'box', 'description' => 'See which products sell, how many units are paid for, and their revenue contribution.'],
    ];
}

function ez_analytics_date(mixed $value, DateTimeZone $zone): ?DateTimeImmutable
{
    if (!is_string($value) || preg_match('/^\d{4}-\d{2}-\d{2}$/D', $value) !== 1) return null;
    $date = DateTimeImmutable::createFromFormat('!Y-m-d', $value, $zone);
    return $date !== false && $date->format('Y-m-d') === $value && $date->getTimestamp() >= 0 ? $date : null;
}

function ez_analytics_period(array $query, DateTimeImmutable $now, array $orders): array
{
    $end = $now->setTime(0, 0)->modify('+1 day');
    $range = in_array($query['range'] ?? '', ['7', '30', '90', '180', 'all', 'custom'], true) ? $query['range'] : '30';
    $error = '';
    if ($range === 'custom') {
        $start = ez_analytics_date($query['from'] ?? null, $now->getTimezone());
        $through = ez_analytics_date($query['to'] ?? null, $now->getTimezone());
        if ($start === null || $through === null || $start > $through || $through >= $end) {
            $range = '30';
            $error = 'Choose valid start and end dates, ending today or earlier. Showing the last 30 days.';
        } else $end = $through->modify('+1 day');
    }
    if ($range === 'all') {
        $dates = array_column($orders, '_timestamp');
        $start = $dates === [] ? $now->setTime(0, 0) : (new DateTimeImmutable('@' . min($dates)))->setTimezone($now->getTimezone())->setTime(0, 0);
    } elseif ($range !== 'custom') $start = $end->modify('-' . $range . ' days');
    $days = (int) $start->diff($end)->days;
    $previousStart = $range === 'all' ? null : $start->modify('-' . $days . ' days');
    $group = in_array($query['group'] ?? '', ['daily', 'weekly', 'monthly'], true) ? $query['group'] : ($days <= 60 ? 'daily' : ($days <= 180 ? 'weekly' : 'monthly'));
    if ($days > 730) $group = 'monthly';
    elseif ($days > 90 && $group === 'daily') $group = 'weekly';
    return compact('range', 'start', 'end', 'days', 'previousStart', 'group', 'error');
}

function ez_analytics_status(array $order): string
{
    $status = strtoupper((string) ($order['status'] ?? ''));
    return in_array($status, ['PAID', 'PENDING', 'CREATING', 'FAILED'], true) ? $status : 'OTHER';
}

function ez_analytics_fulfillment(array $order): string
{
    if (ez_analytics_status($order) !== 'PAID') return 'unpaid';
    if (ez_order_skips_shipping($order)) return 'not-required';
    return ez_dashboard_order_queue($order) ?: 'delivered';
}

function ez_analytics_summary(array $orders): array
{
    $result = [
        'orders' => count($orders), 'revenue' => 0, 'product_revenue' => 0, 'shipping' => 0,
        'ordered_value' => 0, 'pending_value' => 0, 'failed_value' => 0, 'units' => 0, 'ordered_units' => 0,
        'status' => array_fill_keys(['PAID', 'PENDING', 'CREATING', 'FAILED', 'OTHER'], 0),
        'fulfillment' => array_fill_keys(['needs-processing', 'processing', 'shipped', 'delivered', 'attention', 'not-required', 'unpaid'], 0),
        'products' => [], 'methods' => [], 'weekdays' => array_fill(0, 7, 0),
    ];
    $durations = [];
    foreach ($orders as $order) {
        $status = ez_analytics_status($order);
        $paid = $status === 'PAID';
        $total = max(0, (int) ($order['total'] ?? 0));
        $result['status'][$status]++;
        $result['fulfillment'][ez_analytics_fulfillment($order)]++;
        $result['weekdays'][(int) (new DateTimeImmutable('@' . $order['_timestamp']))->setTimezone(new DateTimeZone('Asia/Jakarta'))->format('N') - 1]++;
        $result['ordered_value'] += $total;
        $method = trim((string) ($order['payment_type'] ?? '')) ?: 'Not selected';
        $method = ucwords(str_replace('_', ' ', $method));
        if (!isset($result['methods'][$method])) $result['methods'][$method] = ['name' => $method, 'orders' => 0, 'paid' => 0, 'pending' => 0, 'failed' => 0, 'other' => 0, 'revenue' => 0];
        $result['methods'][$method]['orders']++;
        $methodStatus = match ($status) { 'PAID' => 'paid', 'PENDING', 'CREATING' => 'pending', 'FAILED' => 'failed', default => 'other' };
        $result['methods'][$method][$methodStatus]++;
        if ($paid) {
            $result['revenue'] += $total;
            $result['product_revenue'] += max(0, (int) ($order['subtotal'] ?? 0));
            $result['shipping'] += max(0, (int) ($order['shipping_price'] ?? 0));
            $result['methods'][$method]['revenue'] += $total;
            $paidAt = strtotime((string) ($order['paid_at'] ?? ''));
            if ($paidAt !== false && $paidAt >= $order['_timestamp']) $durations[] = $paidAt - $order['_timestamp'];
        } elseif (in_array($status, ['PENDING', 'CREATING'], true)) $result['pending_value'] += $total;
        elseif ($status === 'FAILED') $result['failed_value'] += $total;
        $seenProducts = [];
        foreach ($order['items'] ?? [] as $item) {
            if (!is_array($item) || ($item['id'] ?? '') === 'EZK-SHIPPING') continue;
            $product = $item['dashboard_product'] ?? ez_dashboard_item($item, $order, []);
            $key = $product['key'];
            if (!isset($result['products'][$key])) $result['products'][$key] = $product + ['orders' => 0, 'paid_orders' => 0, 'ordered_units' => 0, 'units' => 0, 'revenue' => 0];
            $row = &$result['products'][$key];
            if (!isset($seenProducts[$key])) { $row['orders']++; if ($paid) $row['paid_orders']++; }
            $seenProducts[$key] = true;
            $units = max(0, (int) ($item['quantity'] ?? 0));
            $row['ordered_units'] += $units;
            $result['ordered_units'] += $units;
            if ($paid) {
                $row['units'] += $units;
                $result['units'] += $units;
                $row['revenue'] += $units * max(0, (int) ($item['price'] ?? 0));
            }
            unset($row);
        }
    }
    $paidCount = $result['status']['PAID'];
    $result['payment_rate'] = $result['orders'] > 0 ? 100 * $paidCount / $result['orders'] : null;
    $result['failure_rate'] = $result['orders'] > 0 ? 100 * $result['status']['FAILED'] / $result['orders'] : null;
    $result['aov'] = $paidCount > 0 ? $result['revenue'] / $paidCount : null;
    $result['basket_size'] = $result['orders'] > 0 ? $result['ordered_units'] / $result['orders'] : null;
    $result['paid'] = $paidCount;
    $result['pending'] = $result['status']['PENDING'] + $result['status']['CREATING'];
    $result['failed'] = $result['status']['FAILED'];
    $result['products_sold'] = count(array_filter($result['products'], static fn($row) => $row['units'] > 0));
    $result['item_revenue'] = array_sum(array_column($result['products'], 'revenue'));
    $result['payment_time_samples'] = count($durations);
    sort($durations);
    $middle = intdiv(count($durations), 2);
    $result['payment_seconds'] = $durations === [] ? null : (count($durations) % 2 ? $durations[$middle] : ($durations[$middle - 1] + $durations[$middle]) / 2);
    uasort($result['products'], static fn($a, $b) => $b['revenue'] <=> $a['revenue'] ?: $b['units'] <=> $a['units'] ?: strcmp($a['name'], $b['name']));
    uasort($result['methods'], static fn($a, $b) => $b['orders'] <=> $a['orders'] ?: strcmp($a['name'], $b['name']));
    return $result;
}

function ez_analytics_build(array $orders, array $query, DateTimeImmutable $now): array
{
    $valid = [];
    $undated = 0;
    foreach ($orders as $order) {
        $timestamp = strtotime((string) ($order['created_at'] ?? ''));
        if ($timestamp === false || $timestamp < 0) { $undated++; continue; }
        if ($timestamp > $now->getTimestamp()) continue;
        $order['_timestamp'] = $timestamp;
        $valid[] = $order;
    }
    $period = ez_analytics_period($query, $now, $valid);
    $within = static fn($from, $to) => array_values(array_filter($valid, static fn($order) => $order['_timestamp'] >= $from->getTimestamp() && $order['_timestamp'] < $to->getTimestamp()));
    $rows = $within($period['start'], $period['end']);
    $previousRows = $period['previousStart'] !== null ? $within($period['previousStart'], $period['start']) : [];
    $current = ez_analytics_summary($rows);
    $previous = $period['previousStart'] !== null ? ez_analytics_summary($previousRows) : null;
    $buckets = [];
    $cursor = $period['start'];
    while ($cursor < $period['end']) {
        $next = match ($period['group']) { 'monthly' => $cursor->modify('first day of next month'), 'weekly' => $cursor->modify('+7 days'), default => $cursor->modify('+1 day') };
        $next = min($next, $period['end']);
        $buckets[] = ['start' => $cursor, 'end' => $next, 'current' => ['orders' => 0, 'revenue' => 0, 'units' => 0, 'paid' => 0], 'previous' => ['orders' => 0, 'revenue' => 0, 'units' => 0, 'paid' => 0]];
        $cursor = $next;
    }
    // Align comparison buckets by elapsed day in the previous equal-length period.
    $bucketByDay = [];
    foreach ($buckets as $index => $bucket) for ($date = $bucket['start']; $date < $bucket['end']; $date = $date->modify('+1 day')) $bucketByDay[$date->format('Y-m-d')] = $index;
    foreach (['current' => $rows, 'previous' => $previousRows] as $kind => $source) foreach ($source as $order) {
        $date = (new DateTimeImmutable('@' . $order['_timestamp']))->setTimezone($now->getTimezone());
        if ($kind === 'previous') $date = $date->modify('+' . $period['days'] . ' days');
        $index = $bucketByDay[$date->format('Y-m-d')];
        $bucket = &$buckets[$index][$kind];
        $bucket['orders']++;
        if (ez_analytics_status($order) === 'PAID') {
            $bucket['paid']++;
            $bucket['revenue'] += max(0, (int) ($order['total'] ?? 0));
            foreach ($order['items'] ?? [] as $item) if (is_array($item) && ($item['id'] ?? '') !== 'EZK-SHIPPING') $bucket['units'] += max(0, (int) ($item['quantity'] ?? 0));
        }
        unset($bucket);
    }
    foreach ($buckets as &$bucket) foreach (['current', 'previous'] as $kind) $bucket[$kind]['payment_rate'] = $bucket[$kind]['orders'] > 0 ? 100 * $bucket[$kind]['paid'] / $bucket[$kind]['orders'] : null;
    unset($bucket);
    $report = is_string($query['report'] ?? null) && isset(ez_analytics_reports()[$query['report']]) ? $query['report'] : 'overview';
    return compact('period', 'rows', 'current', 'previous', 'buckets', 'report', 'undated');
}

function ez_analytics_url(array $data, array $changes = []): string
{
    $period = $data['period'];
    $query = ['page' => 'analytics', 'report' => $data['report'], 'range' => $period['range'], 'group' => $period['group']];
    if ($period['range'] === 'custom') $query += ['from' => $period['start']->format('Y-m-d'), 'to' => $period['end']->modify('-1 day')->format('Y-m-d')];
    return '?' . http_build_query(array_replace($query, $changes));
}

function ez_analytics_export(array $data): never
{
    $report = $data['report'];
    header('Content-Type: text/csv; charset=utf-8');
    header('Content-Disposition: attachment; filename="ezkart-' . $report . '-' . $data['period']['start']->format('Y-m-d') . '-' . $data['period']['end']->modify('-1 day')->format('Y-m-d') . '.csv"');
    $stream = fopen('php://output', 'w');
    fwrite($stream, "\xEF\xBB\xBF");
    $write = static function (array $row) use ($stream): void {
        $safe = array_map(static fn($cell) => is_string($cell) && preg_match('/^(?:[\x00-\x20]*[=+@-]|[\t\r\n])/', $cell) ? "'" . $cell : $cell, $row);
        fputcsv($stream, $safe, ',', '"', '');
    };
    $write(['Report', ez_analytics_reports()[$report]['title']]);
    $write(['Order creation dates (Asia/Jakarta)', $data['period']['start']->format('Y-m-d'), $data['period']['end']->modify('-1 day')->format('Y-m-d')]);
    $write(['Currency', 'IDR']);
    $write([]);
    if ($report === 'overview') {
        $write(['Metric', 'Selected period', 'Previous period']);
        foreach (['revenue' => 'Confirmed revenue', 'orders' => 'Orders', 'payment_rate' => 'Payment rate (%)', 'aov' => 'Average paid order', 'units' => 'Paid units', 'failed' => 'Failed orders'] as $key => $label) $write([$label, $data['current'][$key], $data['previous'][$key] ?? '']);
    } elseif ($report === 'products') {
        $write(['Product ID', 'Product', 'Orders', 'Paid orders', 'Ordered units', 'Paid units', 'Item revenue (IDR)']);
        foreach ($data['current']['products'] as $row) $write([$row['key'], $row['name'], $row['orders'], $row['paid_orders'], $row['ordered_units'], $row['units'], $row['revenue']]);
    } elseif ($report === 'payments') {
        $write(['Method', 'Orders', 'Paid', 'Pending or creating', 'Failed', 'Other', 'Payment rate (%)', 'Confirmed revenue (IDR)']);
        foreach ($data['current']['methods'] as $row) $write([$row['name'], $row['orders'], $row['paid'], $row['pending'], $row['failed'], $row['other'], 100 * $row['paid'] / $row['orders'], $row['revenue']]);
    } else {
        $write(['Order', 'Created (WIB)', 'Payment status', 'Fulfillment', 'Payment method', 'Product amount (IDR)', 'Shipping (IDR)', 'Total (IDR)']);
        foreach ($data['rows'] as $order) {
            if ($report === 'revenue' && ez_analytics_status($order) !== 'PAID') continue;
            $write([$order['order_id'], (new DateTimeImmutable('@' . $order['_timestamp']))->setTimezone(new DateTimeZone('Asia/Jakarta'))->format('Y-m-d H:i:s'), ez_analytics_status($order), ez_analytics_fulfillment($order), $order['payment_type'] ?? '', (int) ($order['subtotal'] ?? 0), (int) ($order['shipping_price'] ?? 0), (int) ($order['total'] ?? 0)]);
        }
    }
    fclose($stream);
    exit;
}
