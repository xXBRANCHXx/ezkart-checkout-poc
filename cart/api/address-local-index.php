<?php
declare(strict_types=1);

function ez_local_geocoder_directory(): string
{
    $root = rtrim((string) ($_SERVER['DOCUMENT_ROOT'] ?? ''), '/');
    return rtrim(ez_config('address_geocoding_directory') ?: ($root !== '' ? dirname($root) : dirname(__DIR__, 3)) . '/ezkart-geocoding', '/');
}

function ez_local_geocoder_available(): bool
{
    return is_file(ez_local_geocoder_directory() . '/manifest.json');
}

/** Read a bounded posting list. The hash is generated here, never supplied by a client. */
function ez_local_geocoder_postings(string $directory, string $key): array
{
    $file = $directory . '/tokens/' . substr(hash('sha256', $key), 0, 3) . '.json';
    if (!is_file($file)) return [];
    if (filesize($file) > 4000000) throw new RuntimeException('Address index is invalid.');
    $index = json_decode((string) file_get_contents($file), true, 512, JSON_THROW_ON_ERROR);
    return is_array($index[$key] ?? null) ? $index[$key] : [];
}

/** Native PHP lookup over our own OSM index: no remote geocoder, daemon or database extension. */
function ez_local_geocoder_search(string $query, array $components = []): array
{
    $directory = ez_local_geocoder_directory();
    $manifest = json_decode((string) file_get_contents($directory . '/manifest.json'), true, 512, JSON_THROW_ON_ERROR);
    if (($manifest['format'] ?? '') !== 'ezkart-address-index-v1') throw new RuntimeException('Address index is invalid.');
    $parts = ez_geocode_parts($query, $components);
    $groups = [];
    if ($parts['street'] !== '') {
        $variants = [];
        foreach ($parts['streets'] as $inputStreet) {
            $street = ez_geocode_street_normalize($inputStreet);
            $variants[] = $street; $variants[] = 'jalan ' . $street;
        }
        $variants = array_values(array_unique($variants));
        if ($parts['housenumber'] !== '') $groups[] = array_map(static fn($v) => 'street_number:' . $v . ':' . ez_geocode_normalize($parts['housenumber']), $variants);
        $groups[] = array_map(static fn($v) => 'street:' . $v, $variants);
    }
    if ($parts['postcode'] !== '') $groups[] = ['postcode:' . $parts['postcode']];
    $sets = [];
    // Prefer the complete house/street anchor. A smaller postcode list could
    // otherwise hide another matching building whose postcode was not mapped.
    foreach ($groups as $keys) {
        $list = [];
        foreach ($keys as $key) $list = array_merge($list, ez_local_geocoder_postings($directory, $key));
        if ($list) { $sets[] = array_values(array_unique($list)); break; }
    }
    if (!$sets) {
        foreach (array_unique(explode(' ', ez_geocode_normalize($query))) as $word) {
            if (mb_strlen($word) < 4 || in_array($word, ['jalan', 'indonesia', 'kecamatan', 'kabupaten'], true) || ctype_digit($word)) continue;
            $list = ez_local_geocoder_postings($directory, 'word:' . $word);
            if ($list) $sets[] = $list;
        }
    }
    if (!$sets) return [];
    usort($sets, static fn($a, $b) => count($a) <=> count($b));
    // Other fields validate the actual record, including missing postal metadata.
    $limited = count($sets[0]) > 2500;
    $offsets = array_slice($sets[0], 0, 2500);
    $handle = fopen($directory . '/records.jsonl', 'rb');
    if (!$handle) throw new RuntimeException('Address index is unavailable.');
    $results = []; $nameQuery = ez_geocode_normalize($query); $names = [];
    $placeNameQuery = ez_geocode_normalize($components['address'] ?? explode(',', $query)[0]);
    try {
        foreach ($offsets as $offset) {
            if (!is_int($offset) || $offset < 0 || fseek($handle, $offset) !== 0) continue;
            $line = fgets($handle, 8193);
            if (!$line || !str_ends_with($line, "\n")) continue;
            $record = json_decode($line, true, 512, JSON_THROW_ON_ERROR);
            $p = $record['properties'] ?? [];
            $coordinate = ez_tracking_coordinate($record['coordinate'] ?? null);
            if (!$coordinate) continue;
            $recordLocalities = array_map('ez_geocode_normalize', $p['localities'] ?? []);
            $localityMatch = false;
            foreach ($parts['localities'] as $constraint) {
                if (!in_array(ez_geocode_normalize($constraint), $recordLocalities, true)) continue 2;
                $localityMatch = true;
            }
            if ($parts['postcode'] !== '' && !empty($p['postcode']) && $parts['postcode'] !== $p['postcode']) continue;
            $streetMatch = $parts['street'] !== '' && in_array(ez_geocode_street_normalize($p['street'] ?? ''), array_map('ez_geocode_street_normalize', $parts['streets']), true);
            if ($parts['street'] !== '' && !$streetMatch) continue;
            $numberMatch = $parts['housenumber'] !== '' && ez_geocode_normalize($parts['housenumber']) === ez_geocode_normalize($p['housenumber'] ?? '');
            if ($parts['housenumber'] !== '' && !empty($p['housenumber']) && !$numberMatch) continue;
            $precision = $record['precision'] ?? 'area';
            $name = $p['name'] ?? trim(($p['street'] ?? '') . ' ' . ($p['housenumber'] ?? ''));
            if ($name === '') continue;
            $label = ez_geocode_normalize($name);
            $labels = array_map('ez_geocode_normalize', [$name, ...($p['aliases'] ?? [])]);
            $words = array_unique(array_filter(explode(' ', implode(' ', $labels)), static fn($word) => mb_strlen($word) >= 4 && !in_array($word, ['jalan', 'indonesia'], true)));
            $overlap = count(array_filter($words, static fn($word) => preg_match('/(?:^| )' . preg_quote($word, '/') . '(?: |$)/u', $nameQuery)));
            if (!$streetMatch && $overlap === 0) continue;
            $hasLocality = $localityMatch || ($parts['postcode'] !== '' && $parts['postcode'] === ($p['postcode'] ?? ''));
            $matched = $hasLocality && (($precision === 'address' && $streetMatch && $numberMatch) || (in_array($precision, ['address', 'place'], true) && in_array($placeNameQuery, $labels, true)));
            $street = trim(($p['street'] ?? '') . ' ' . ($p['housenumber'] ?? ''));
            $address = implode(', ', array_unique(array_filter([$street, ...($p['localities'] ?? []), $p['postcode'] ?? '', 'Indonesia'], static fn($value) => $value !== '' && $value !== $name)));
            $result = ['name' => $name, 'address' => mb_substr($address, 0, 500), 'address_line' => implode(', ', array_unique(array_filter([$name, $street]))),
                'location' => implode(', ', array_unique(array_filter([$p['district'] ?? '', $p['city'] ?? $p['county'] ?? '']))),
                'postalCode' => $p['postcode'] ?? '', 'coordinate' => $coordinate, 'precision' => $precision, 'matched' => $matched,
                'kind' => ['address' => 'Building match', 'place' => 'Place match', 'street' => 'Street match', 'area' => 'Area match'][$precision], 'provider' => 'ezkart'];
            $key = ($record['osm'] ?? '') . ':' . $street;
            if (isset($names[$key])) continue;
            $names[$key] = true;
            $results[] = ['result' => $result, 'score' => $overlap + ($label === $nameQuery ? 100 : 0)];
        }
    } finally { fclose($handle); }
    usort($results, static fn($a, $b) => ((int) $b['result']['matched'] <=> (int) $a['result']['matched']) ?: ($b['score'] <=> $a['score']));
    $ranked = ez_geocode_rank(array_column($results, 'result'));
    if ($limited) foreach ($ranked as &$result) $result['auto_select'] = false;
    unset($result);
    return array_slice($ranked, 0, 5);
}
