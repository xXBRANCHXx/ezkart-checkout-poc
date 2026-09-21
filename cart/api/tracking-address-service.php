<?php
declare(strict_types=1);
require_once __DIR__ . '/address-location.php';

function ez_tracking_address_search(string $query): array
{
    $parsed = ez_address_location($query);
    $code = $parsed['plus_code'];
    if ($parsed['coordinate'] !== null) return [ez_tracking_resolved_address($parsed, $parsed['coordinate'], $parsed['source'] === 'plus_code' ? 'Plus Code location' : 'Coordinates from address')];
    if ($code === null) return ez_tracking_photon_search($query);
    // Photon searches the locality; the Plus Code determines the delivery pin.
    $locality = trim(str_ireplace($code, '', $parsed['address']), " ,");
    $locality = preg_replace('/\b(?:Kec(?:amatan)?\.?|Kab(?:upaten)?\.?|Kota|Daerah Istimewa|Provinsi|Indonesia)\b\.?/iu', ' ', $locality);
    $locality = preg_replace('/\b\d{5}\b/u', '', $locality);
    $locality = trim(preg_replace('/[\s,]+/u', ' ', $locality));
    if (mb_strlen($locality) < 3) throw new InvalidArgumentException('Include the village or city after this short Plus Code, or paste its latitude and longitude.');
    $results = [];
    foreach (ez_tracking_photon_search($locality) as $reference) {
        $coordinate = ez_plus_code_recover($code, $reference['coordinate']);
        $key = sprintf('%.7F,%.7F', $coordinate['latitude'], $coordinate['longitude']);
        $results[$key] = ez_tracking_resolved_address($parsed, $coordinate, 'Plus Code location');
        $results[$key]['reference'] = $reference['name'] . ', ' . $reference['address'];
    }
    if (!$results) throw new InvalidArgumentException('We could not locate the locality for this Plus Code. Include the village and city, or paste its latitude and longitude.');
    if (count($results) > 1) foreach ($results as &$result) $result['address'] .= ' · Near ' . $result['reference'];
    return array_values($results);
}

function ez_tracking_resolved_address(array $parsed, array $coordinate, string $kind): array
{
    $address = $parsed['address'];
    $label = $address !== '' ? $address : sprintf('%.6F, %.6F', $coordinate['latitude'], $coordinate['longitude']);
    preg_match('/\b\d{5}\b/u', $address, $postcode);
    $location = '';
    if (preg_match('/\b(?:Kabupaten|Kota)\s+([^,\d]+)/iu', $address, $city)) $location = trim($city[1]);
    return ['name' => $parsed['plus_code'] ?? 'Delivery location', 'address' => $label, 'address_line' => $label, 'location' => $location, 'postalCode' => $postcode[0] ?? '', 'kind' => $kind, 'coordinate' => $coordinate, 'resolved' => true];
}

function ez_tracking_photon_search(string $query): array
{
    $directory = dirname(ez_order_directory('sandbox')) . '/tracking-addresses';
    if (!is_dir($directory) && !@mkdir($directory, 0700, true) && !is_dir($directory)) throw new RuntimeException('Address cache unavailable.');
    $file = $directory . '/' . hash('sha256', strtolower($query)) . '.json';
    $lock = fopen($directory . '/requests.lock', 'c+');
    if ($lock === false) throw new RuntimeException('Address search unavailable.');
    if (!flock($lock, LOCK_EX | LOCK_NB)) { fclose($lock); throw new RuntimeException('Address search busy.'); }
    @chmod($directory . '/requests.lock', 0600);
    try {
        $cached = is_file($file) ? json_decode((string) file_get_contents($file), true) : null;
        if (is_array($cached) && ($cached['schema'] ?? 0) === 2 && ($cached['until'] ?? 0) > time()) {
            if (isset($cached['results'])) return $cached['results'];
            throw new RuntimeException('Address search unavailable.');
        }
        $usage = json_decode(stream_get_contents($lock) ?: '{}', true) ?: [];
        $today = gmdate('Y-m-d');
        if (($usage['day'] ?? '') !== $today) $usage = ['day' => $today, 'count' => 0, 'last' => $usage['last'] ?? 0];
        // Modest, user-submitted searches only on Photon's public demo service.
        if (microtime(true) - (float) ($usage['last'] ?? 0) < 1.1 || (int) ($usage['count'] ?? 0) >= 100) throw new RuntimeException('Address search allowance reached.');
        $usage['last'] = microtime(true); $usage['count']++;
        rewind($lock); ftruncate($lock, 0); fwrite($lock, json_encode($usage, JSON_THROW_ON_ERROR)); fflush($lock);
        $url = 'https://photon.komoot.io/api/?' . http_build_query(['q' => $query, 'limit' => 5, 'countrycode' => 'ID', 'lang' => 'en']);
        $handle = curl_init($url);
        if ($handle === false) throw new RuntimeException('Address search unavailable.');
        curl_setopt_array($handle, [
            CURLOPT_HTTPHEADER => ['Accept: application/json', 'User-Agent: Ezkart-Tracking-Sandbox/1.0 (+https://test.ezkart.id)', 'Referer: https://test.ezkart.id/'],
            CURLOPT_RETURNTRANSFER => true, CURLOPT_CONNECTTIMEOUT => 3, CURLOPT_TIMEOUT => 8, CURLOPT_SSL_VERIFYPEER => true,
        ]);
        $raw = curl_exec($handle);
        $data = is_string($raw) && strlen($raw) <= 1000000 ? json_decode($raw, true) : null;
        $valid = (int) curl_getinfo($handle, CURLINFO_HTTP_CODE) === 200 && is_array($data['features'] ?? null);
        $results = [];
        if ($valid) foreach (array_slice($data['features'], 0, 5) as $feature) {
            $p = $feature['properties'] ?? [];
            $xy = $feature['geometry']['coordinates'] ?? [];
            $coordinate = ez_tracking_coordinate(['longitude' => $xy[0] ?? null, 'latitude' => $xy[1] ?? null]);
            if ($coordinate === null || ($feature['geometry']['type'] ?? '') !== 'Point' || strtoupper((string) ($p['countrycode'] ?? '')) !== 'ID') continue;
            $clean = static fn(string $key): string => is_string($p[$key] ?? null) ? mb_substr(trim($p[$key]), 0, 160) : '';
            $street = trim($clean('street') . ' ' . $clean('housenumber'));
            $name = $clean('name') ?: $street ?: $clean('city');
            if ($name === '') continue;
            $address = implode(', ', array_unique(array_filter([$street, $clean('district'), $clean('city'), $clean('county'), $clean('state'), $clean('postcode'), 'Indonesia'], static fn(string $part): bool => $part !== '' && $part !== $name)));
            $kind = ($p['type'] ?? '') === 'house' ? ($clean('housenumber') !== '' ? 'Building match' : 'Place match') : (($p['type'] ?? '') === 'street' ? 'Street match' : 'Area match');
            $results[] = ['name' => $name, 'address' => mb_substr($address, 0, 500), 'kind' => $kind, 'coordinate' => $coordinate, 'address_line' => implode(', ', array_unique(array_filter([$name, $street]))), 'location' => implode(', ', array_unique(array_filter([$clean('district'), $clean('city') ?: $clean('county')]))), 'postalCode' => preg_match('/^\d{5}$/D', $clean('postcode')) === 1 ? $clean('postcode') : ''];
        }
        // Do not store the entered query itself; short, bounded caches include failures.
        file_put_contents($file, json_encode(['schema' => 2, 'until' => time() + ($valid ? 86400 : 300), 'results' => $valid ? $results : null], JSON_THROW_ON_ERROR), LOCK_EX);
        @chmod($file, 0600);
        foreach (glob($directory . '/*.json') ?: [] as $old) if ((int) filemtime($old) < time() - 172800) @unlink($old);
        if (!$valid) throw new RuntimeException('Address search unavailable.');
        return $results;
    } finally {
        flock($lock, LOCK_UN); fclose($lock);
    }
}
