<?php
declare(strict_types=1);
require_once __DIR__ . '/address-location.php';
require_once __DIR__ . '/address-geocoding.php';
require_once __DIR__ . '/address-local-index.php';

function ez_tracking_address_search(string $query, array $components = []): array
{
    $parsed = ez_address_location($query);
    $code = $parsed['plus_code'];
    if ($parsed['coordinate'] !== null) return [ez_tracking_resolved_address($parsed, $parsed['coordinate'], $parsed['source'] === 'plus_code' ? 'Plus Code location' : 'Coordinates from address')];
    if ($code === null) return ez_tracking_geocoder_search($query, $components);
    // The geocoder searches the locality; the Plus Code determines the delivery pin.
    $locality = trim(str_ireplace($code, '', $parsed['address']), " ,");
    $locality = preg_replace('/\b(?:Kec(?:amatan)?\.?|Kab(?:upaten)?\.?|Kota|Daerah Istimewa|Provinsi|Indonesia)\b\.?/iu', ' ', $locality);
    $locality = preg_replace('/\b\d{5}\b/u', '', $locality);
    $locality = trim(preg_replace('/[\s,]+/u', ' ', $locality));
    if (mb_strlen($locality) < 3) throw new InvalidArgumentException('Include the village or city after this short Plus Code, or paste its latitude and longitude.');
    $results = [];
    foreach (ez_tracking_geocoder_search($locality) as $reference) {
        $coordinate = ez_plus_code_recover($code, $reference['coordinate']);
        $key = sprintf('%.7F,%.7F', $coordinate['latitude'], $coordinate['longitude']);
        $results[$key] = ez_tracking_resolved_address($parsed, $coordinate, 'Plus Code location');
        $results[$key]['reference'] = $reference['name'] . ', ' . $reference['address'];
    }
    if (!$results) throw new InvalidArgumentException('We could not locate the locality for this Plus Code. Include the village and city, or paste its latitude and longitude.');
    if (count($results) > 1) foreach ($results as &$result) { $result['address'] .= ' · Near ' . $result['reference']; $result['auto_select'] = false; }
    return array_values($results);
}

function ez_tracking_resolved_address(array $parsed, array $coordinate, string $kind): array
{
    $address = $parsed['address'];
    $label = $address !== '' ? $address : sprintf('%.6F, %.6F', $coordinate['latitude'], $coordinate['longitude']);
    preg_match('/\b\d{5}\b/u', $address, $postcode);
    $location = '';
    if (preg_match('/\b(?:Kabupaten|Kota)\s+([^,\d]+)/iu', $address, $city)) $location = trim($city[1]);
    return ['name' => $parsed['plus_code'] ?? 'Delivery location', 'address' => $label, 'address_line' => $label, 'location' => $location, 'postalCode' => $postcode[0] ?? '', 'kind' => $kind, 'coordinate' => $coordinate, 'resolved' => true, 'precision' => 'supplied', 'auto_select' => true];
}

function ez_tracking_photon_search(string $query): array
{
    return ez_tracking_geocoder_search($query, [], 'photon');
}

function ez_tracking_geocoder_search(string $query, array $components = [], ?string $provider = null): array
{
    if ($provider !== 'photon' && ez_local_geocoder_available()) return ez_local_geocoder_search($query, $components);
    $parts = ez_geocode_parts($query, $components);
    $parameters = ['q' => $query, 'limit' => 5, 'countrycode' => 'ID', 'lang' => 'en'];
    $path = 'api/';
    // Structured form searches constrain street, house number and locality independently.
    if ($components && $parts['street'] !== '' && ($parts['city'] !== '' || !empty($parts['county']) || $parts['postcode'] !== '')) {
        $path = 'structured';
        $parameters = array_filter(array_diff_key($parts, ['localities' => true]), static fn($value) => $value !== '') + ['limit' => 5, 'countrycode' => 'ID', 'lang' => 'en'];
    }
    $directory = dirname(ez_order_directory('sandbox')) . '/tracking-addresses';
    if (!is_dir($directory) && !@mkdir($directory, 0700, true) && !is_dir($directory)) throw new RuntimeException('Address cache unavailable.');
    $file = $directory . '/' . hash('sha256', json_encode(['photon', $path, $parameters], JSON_THROW_ON_ERROR)) . '.json';
    $lockPath = $directory . '/requests.lock';
    $lock = fopen($lockPath, 'c+');
    if ($lock === false) throw new RuntimeException('Address search unavailable.');
    if (!flock($lock, LOCK_EX | LOCK_NB)) { fclose($lock); throw new RuntimeException('Address search busy.'); }
    @chmod($lockPath, 0600);
    try {
        $cached = is_file($file) ? json_decode((string) file_get_contents($file), true) : null;
        if (is_array($cached) && ($cached['schema'] ?? 0) === 3 && ($cached['until'] ?? 0) > time()) {
            if (isset($cached['results'])) return $cached['results'];
            throw new RuntimeException('Address search unavailable.');
        }
        $usage = json_decode(stream_get_contents($lock) ?: '{}', true) ?: [];
        $today = gmdate('Y-m-d');
        if (($usage['day'] ?? '') !== $today) $usage = ['day' => $today, 'count' => 0, 'last' => $usage['last'] ?? 0];
        // Bound usage of the public demo; the local index has no provider allowance.
        if (microtime(true) - (float) ($usage['last'] ?? 0) < 1.1 || (int) ($usage['count'] ?? 0) >= 100) throw new RuntimeException('Address search allowance reached.');
        $usage['last'] = microtime(true); $usage['count']++;
        rewind($lock); ftruncate($lock, 0); fwrite($lock, json_encode($usage, JSON_THROW_ON_ERROR)); fflush($lock);
        // Do not hold a global file lock during a provider network request.
        flock($lock, LOCK_UN);
        $url = 'https://photon.komoot.io/' . $path . '?' . http_build_query($parameters);
        $handle = curl_init($url);
        if ($handle === false) throw new RuntimeException('Address search unavailable.');
        curl_setopt_array($handle, [
            CURLOPT_HTTPHEADER => ['Accept: application/json', 'User-Agent: Ezkart-Tracking-Sandbox/1.0 (+https://test.ezkart.id)', 'Referer: https://test.ezkart.id/'],
            CURLOPT_RETURNTRANSFER => true, CURLOPT_CONNECTTIMEOUT => 3, CURLOPT_TIMEOUT => 8, CURLOPT_SSL_VERIFYPEER => true,
        ]);
        $raw = curl_exec($handle);
        $data = is_string($raw) && strlen($raw) <= 1000000 ? json_decode($raw, true) : null;
        $items = $data['features'] ?? null;
        $valid = (int) curl_getinfo($handle, CURLINFO_HTTP_CODE) === 200 && is_array($items);
        $results = [];
        if ($valid) foreach (array_slice($items, 0, 5) as $item) {
            if (!is_array($item)) continue;
            $result = ez_geocode_photon_result($item, $parts);
            if ($result !== null) $results[] = $result;
        }
        $results = ez_geocode_rank($results);
        // Do not store the entered query itself; short, bounded caches include failures.
        file_put_contents($file, json_encode(['schema' => 3, 'until' => time() + ($valid ? 86400 : 300), 'results' => $valid ? $results : null], JSON_THROW_ON_ERROR), LOCK_EX);
        @chmod($file, 0600);
        foreach (glob($directory . '/*.json') ?: [] as $old) if ((int) filemtime($old) < time() - 172800) @unlink($old);
        if (!$valid) throw new RuntimeException('Address search unavailable.');
        return $results;
    } finally {
        flock($lock, LOCK_UN); fclose($lock);
    }
}
