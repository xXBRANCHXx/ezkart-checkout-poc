<?php
declare(strict_types=1);

function ez_tracking_route_points(array $tracking): ?array
{
    if (in_array($tracking['stage'] ?? '', ['awaiting_payment', 'not_required', 'processing', 'pickup_issue', 'cancelled', 'delivered', 'returned'], true)) return null;
    $from = ez_tracking_coordinate($tracking['latest_location'] ?? null) ?? ez_tracking_coordinate($tracking['locations']['origin'] ?? null);
    $to = ez_tracking_coordinate($tracking['locations'][($tracking['stage'] ?? '') === 'returning' ? 'origin' : 'destination'] ?? null);
    if ($from === null || $to === null || $from === $to) return null;
    return [$from, $to];
}

function ez_tracking_road_route(array $tracking): ?array
{
    $points = ez_tracking_route_points($tracking);
    if ($points === null) return null;
    // One shared, private cache for both commerce modes on this deployment.
    $directory = dirname(ez_order_directory('sandbox')) . '/tracking-routes';
    if (!is_dir($directory) && !@mkdir($directory, 0700, true) && !is_dir($directory)) throw new RuntimeException('Route cache unavailable.');
    $key = hash('sha256', json_encode($points, JSON_THROW_ON_ERROR));
    $file = $directory . '/' . $key . '.json';
    $lock = fopen($directory . '/requests.lock', 'c+');
    if ($lock === false || !flock($lock, LOCK_EX | LOCK_NB)) throw new RuntimeException('Route service busy.');
    @chmod($directory . '/requests.lock', 0600);
    try {
        $cached = is_file($file) ? json_decode((string) file_get_contents($file), true) : null;
        if (is_array($cached) && (int) ($cached['until'] ?? 0) > time()) {
            if (isset($cached['route'])) return $cached['route'];
            throw new RuntimeException('Route provider temporarily unavailable.');
        }
        $usage = json_decode(stream_get_contents($lock) ?: '{}', true) ?: [];
        $today = gmdate('Y-m-d');
        if (($usage['day'] ?? '') !== $today) $usage = ['day' => $today, 'count' => 0, 'last' => $usage['last'] ?? 0];
        // FOSSGIS permits at most 1 request/second and no heavy usage. This
        // deployment deliberately stays far below that with 100 cache misses/day.
        if (microtime(true) - (float) ($usage['last'] ?? 0) < 1.1 || (int) $usage['count'] >= 100) throw new RuntimeException('Route request allowance reached.');
        $usage['last'] = microtime(true); $usage['count']++;
        rewind($lock); ftruncate($lock, 0); fwrite($lock, json_encode($usage, JSON_THROW_ON_ERROR)); fflush($lock);
        $coordinates = implode(';', array_map(static fn(array $p): string => sprintf('%.7F,%.7F', $p['longitude'], $p['latitude']), $points));
        $url = 'https://routing.openstreetmap.de/routed-car/route/v1/driving/' . $coordinates . '?overview=simplified&geometries=geojson&steps=false&alternatives=false';
        $handle = curl_init($url);
        if ($handle === false) throw new RuntimeException('Route request failed.');
        curl_setopt_array($handle, [
            CURLOPT_HTTPHEADER => ['Accept: application/json', 'User-Agent: Ezkart-Tracking/1.0 (+https://test.ezkart.id)', 'Referer: https://test.ezkart.id/'],
            CURLOPT_RETURNTRANSFER => true, CURLOPT_CONNECTTIMEOUT => 3, CURLOPT_TIMEOUT => 8, CURLOPT_SSL_VERIFYPEER => true,
        ]);
        $raw = curl_exec($handle);
        $data = is_string($raw) && strlen($raw) <= 1000000 ? json_decode($raw, true) : null;
        $path = $data['routes'][0]['geometry']['coordinates'] ?? null;
        $valid = (int) curl_getinfo($handle, CURLINFO_HTTP_CODE) === 200 && ($data['code'] ?? '') === 'Ok' && ($data['routes'][0]['geometry']['type'] ?? '') === 'LineString' && is_array($path) && count($path) >= 2 && count($path) <= 10000;
        if ($valid) foreach ($path as $p) {
            if (!is_array($p) || count($p) !== 2 || !is_numeric($p[0]) || !is_numeric($p[1]) || !is_finite((float) $p[0]) || !is_finite((float) $p[1]) || abs((float) $p[0]) > 180 || abs((float) $p[1]) > 90) { $valid = false; break; }
        }
        $route = $valid ? ['type' => 'LineString', 'coordinates' => $path, 'from' => $points[0], 'to' => $points[1]] : null;
        // Cache failures too; automatic tracking polls must never hammer this service.
        file_put_contents($file, json_encode(['until' => time() + ($valid ? 86400 : 300), 'route' => $route], JSON_THROW_ON_ERROR), LOCK_EX);
        @chmod($file, 0600);
        // Bound disk use to roughly two days of the fixed provider request budget.
        foreach (glob($directory . '/*.json') ?: [] as $old) if ((int) filemtime($old) < time() - 172800) @unlink($old);
        if (!$valid) throw new RuntimeException('Route provider unavailable.');
        return $route;
    } finally {
        flock($lock, LOCK_UN); fclose($lock);
    }
}
