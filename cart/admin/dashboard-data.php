<?php
declare(strict_types=1);
require_once dirname(__DIR__) . '/api/customer-profile.php';

function ez_dashboard_period(array $query, DateTimeImmutable $now): array
{
    $end = $now->setTime(0, 0)->modify('+1 day');
    $range = in_array($query['range'] ?? '', ['7', '30', '90', 'all'], true) ? $query['range'] : '30';
    $start = $range === 'all' ? null : $end->modify('-' . $range . ' days');
    return ['range' => $range, 'start' => $start, 'end' => $end];
}

function ez_dashboard_order_visible(array $order, string $sellerId, bool $legacy): bool
{
    $owner = (string) ($order['seller_id'] ?? '');
    return ($sellerId !== '' && $owner === $sellerId) || ($legacy && in_array($owner, ['', 'demo'], true));
}

function ez_dashboard_in_period(array $order, array $period): bool
{
    if ($period['start'] === null) return true;
    $timestamp = strtotime((string) ($order['created_at'] ?? ''));
    return $timestamp !== false && $timestamp >= $period['start']->getTimestamp() && $timestamp < $period['end']->getTimestamp();
}

function ez_dashboard_product_lookup(array $products): array
{
    $lookup = [];
    foreach ($products as $product) {
        $mediaId = (string) ($product['media'][0]['id'] ?? '');
        $image = $mediaId !== '' ? './?cloud=' . rawurlencode('/v1/media/' . $mediaId) : '';
        $base = ['product_id' => (string) $product['id'], 'name' => (string) $product['name'], 'image_url' => $image];
        foreach (['id', 'sku'] as $key) {
            if (($product[$key] ?? '') !== '') $lookup[(string) $product[$key]] = $base;
        }
        foreach ($product['variants'] ?? [] as $variant) {
            $variantImage = ($variant['imageUploadId'] ?? '') !== '' ? './?cloud=' . rawurlencode('/v1/media/' . $variant['imageUploadId']) : $image;
            $entry = $base + ['variant_id' => $variant['id']];
            $entry['image_url'] = $variantImage;
            foreach (['id', 'sku'] as $key) if (($variant[$key] ?? '') !== '') $lookup[(string) $variant[$key]] = $entry;
        }
    }
    return $lookup;
}

function ez_dashboard_item(array $item, array $order, array $lookup): array
{
    $snapshot = $order['product_snapshots'][$item['id'] ?? ''] ?? [];
    // New orders retain stable IDs and a photo snapshot. Old orders resolve by exact SKU.
    $entry = $lookup[$snapshot['variant_id'] ?? ''] ?? $lookup[$snapshot['product_id'] ?? ''] ?? $lookup[$item['id'] ?? ''] ?? [];
    return [
        'key' => $entry['product_id'] ?? $snapshot['product_id'] ?? (string) ($item['id'] ?? $item['name'] ?? ''),
        'name' => $entry['name'] ?? $snapshot['product_name'] ?? (string) ($item['name'] ?? 'Product'),
        'image_url' => $entry['image_url'] ?? $snapshot['image_url'] ?? '',
    ];
}

function ez_dashboard_chart(array $orders, array $period, string $group, DateTimeImmutable $now): array
{
    $start = $period['start'];
    if ($start === null) {
        $dates = array_filter(array_map(static fn($o) => strtotime((string) ($o['created_at'] ?? '')), $orders));
        $start = $dates === [] ? $now->setTime(0, 0) : (new DateTimeImmutable('@' . min($dates)))->setTimezone($now->getTimezone())->setTime(0, 0);
    }
    // Keep long histories readable without dropping historical totals.
    $days = (int) $start->diff($period['end'])->days;
    if ($days > 366) $group = 'monthly';
    elseif ($days > 90 && $group === 'daily') $group = 'weekly';
    $cursor = match ($group) { 'monthly' => $start->modify('first day of this month'), 'weekly' => $start->modify('monday this week'), default => $start };
    $step = match ($group) { 'monthly' => '+1 month', 'weekly' => '+1 week', default => '+1 day' };
    $keyFormat = $group === 'monthly' ? 'Y-m' : ($group === 'weekly' ? 'o-W' : 'Y-m-d');
    $buckets = [];
    while ($cursor < $period['end']) {
        $buckets[$cursor->format($keyFormat)] = ['label' => $cursor->format($group === 'monthly' ? 'M Y' : 'j M'), 'value' => 0];
        $cursor = $cursor->modify($step);
    }
    foreach ($orders as $order) {
        if (strtoupper((string) ($order['status'] ?? '')) !== 'PAID') continue;
        $timestamp = strtotime((string) ($order['created_at'] ?? ''));
        if ($timestamp === false) continue;
        $key = (new DateTimeImmutable('@' . $timestamp))->setTimezone($now->getTimezone())->format($keyFormat);
        if (isset($buckets[$key])) $buckets[$key]['value'] += max(0, (int) ($order['total'] ?? 0));
    }
    return ['group' => $group, 'buckets' => $buckets];
}

function ez_admin_customer_avatar(array $customer, string $class = 'mini-avatar'): string
{
    $name = (string) ($customer['name'] ?? 'Guest');
    $url = ez_profile_image_url($customer['avatar_url'] ?? '');
    return '<span class="' . ez_admin_escape($class) . ' identity-avatar"><span>' . ez_admin_escape(mb_strtoupper(mb_substr($name, 0, 1))) . '</span>'
        . ($url !== '' ? '<img src="' . ez_admin_escape($url) . '" alt="" referrerpolicy="no-referrer" loading="lazy" data-record-image>' : '') . '</span>';
}
