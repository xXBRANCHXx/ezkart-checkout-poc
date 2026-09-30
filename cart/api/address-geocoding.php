<?php
declare(strict_types=1);

/** The form already knows these fields. Do not throw them away before geocoding. */
function ez_geocode_components(mixed $input): array
{
    if ($input === null) return [];
    if (!is_array($input) || array_is_list($input)) throw new InvalidArgumentException('Address fields are invalid.');
    $result = [];
    foreach (['address' => 300, 'location' => 120, 'postalCode' => 5] as $key => $limit) {
        $value = $input[$key] ?? '';
        if (!is_string($value) || mb_strlen($value) > $limit) throw new InvalidArgumentException('Address fields are invalid.');
        $result[$key] = trim(preg_replace('/\s+/u', ' ', $value) ?? '');
    }
    if ($result['postalCode'] !== '' && !preg_match('/^\d{5}$/D', $result['postalCode'])) throw new InvalidArgumentException('Enter a five-digit postcode.');
    return $result;
}

function ez_geocode_normalize(string $text): string
{
    $text = mb_strtolower($text);
    $text = preg_replace('/\b(?:jl|jln|jalan)\b\.?\s*/u', 'jalan ', $text);
    $text = preg_replace('/\b(?:kecamatan|kec|kelurahan|kel|desa|dusun|kabupaten|kab|kota|provinsi|daerah istimewa)\b\.?\s*/u', '', $text);
    return trim(preg_replace('/[^\p{L}\p{N}]+/u', ' ', $text));
}

function ez_geocode_street_normalize(string $text): string
{
    return preg_replace('/^jalan\s+/u', '', ez_geocode_normalize($text));
}

/** Parse common Indonesian street/number notation, retaining independent locality constraints. */
function ez_geocode_parts(string $query, array $components = []): array
{
    $address = $components['address'] ?? $query;
    $parts = ['street' => '', 'housenumber' => '', 'city' => '', 'postcode' => $components['postalCode'] ?? '', 'localities' => []];
    if ($parts['postcode'] === '' && preg_match('/\b\d{5}\b/u', $query, $postcode)) $parts['postcode'] = $postcode[0];
    $segments = array_map('trim', explode(',', $address));
    foreach ($segments as $segment) {
        if (!preg_match('/^(?:jl\.?|jln\.?|jalan)\s+(.+)$/iu', $segment, $street)) continue;
        $line = preg_replace('/\s+\b(?:RT|RW)\b.*$/iu', '', $street[1]);
        if (preg_match('/^(.*?)\s+(?:no(?:mor)?\.?\s*)?(\d+[a-z]?(?:\s*[-\/]\s*\d+[a-z]?)?)\s*$/iu', $line, $number)
            && !preg_match('/\b(?:km|kilometer|gang|gg)\.?\s*$/iu', $number[1])) {
            $parts['housenumber'] = preg_replace('/\s+/', '', $number[2]);
            $line = $number[1];
        }
        $parts['street'] = 'Jalan ' . trim($line);
        break;
    }
    if ($parts['street'] === '' && preg_match('/^(.+?)\s+no(?:mor)?\.?\s*(\d+[a-z]?(?:\s*[-\/]\s*\d+[a-z]?)?)\s*$/iu', $segments[0], $number)) {
        $parts['street'] = trim($number[1]);
        $parts['housenumber'] = preg_replace('/\s+/', '', $number[2]);
    }
    $parts['streets'] = $parts['street'] !== '' ? [$parts['street']] : [];
    // Independent form fields let us retain mapped block identifiers and street
    // metadata containing commas, without mistaking city text for a house number.
    if (isset($components['address']) && preg_match('/^(.+?)\s+no(?:mor)?\.?\s*(\S.{0,39})$/iu', trim($address), $literal) && !str_contains($literal[2], ',')) {
        $house = trim($literal[2]);
        if (preg_match('/^\d/u', $house)) $house = trim(preg_replace('/\s+(?:RT|RW)\.?\s*\d.*$/iu', '', $house));
        $parts['street'] = preg_replace('/^(?:jl\.?|jln\.?|jalan)\s+/iu', 'Jalan ', trim($literal[1]));
        $parts['housenumber'] = $house;
        $parts['streets'] = array_values(array_unique([$parts['street'], ...$parts['streets']]));
    }
    $locality = $components['location'] ?? implode(', ', array_slice($segments, 1));
    $locality = preg_replace('/\b\d{5}\b|\bIndonesia\b/iu', '', $locality);
    foreach (array_filter(array_map('trim', explode(',', $locality))) as $segment) {
        if (preg_match('/^(?:RT|RW)\b/iu', $segment)) continue;
        $parts['localities'][] = $segment;
        if (preg_match('/^(?:kab(?:upaten)?|kota)\.?\s+(.+)$/iu', $segment, $match)) {
            $parts['county'] = trim($match[1]);
        } elseif (preg_match('/^kec(?:amatan)?\.?\s+(.+)$/iu', $segment, $match)) {
            $parts['district'] = trim($match[1]);
        } elseif (preg_match('/^(?:provinsi|daerah istimewa)\s+/iu', $segment)) {
            $parts['state'] = trim(preg_replace('/^provinsi\s+/iu', '', $segment));
        } else $parts['city'] = $segment;
    }
    // City takes precedence over the common repeated province suffix.
    if (!empty($parts['county'])) $parts['city'] = '';
    return $parts;
}

function ez_geocode_photon_result(array $feature, array $parts): ?array
{
    $p = $feature['properties'] ?? [];
    $xy = $feature['geometry']['coordinates'] ?? [];
    $coordinate = ez_tracking_coordinate(['longitude' => $xy[0] ?? null, 'latitude' => $xy[1] ?? null]);
    if ($coordinate === null || ($feature['geometry']['type'] ?? '') !== 'Point' || strtoupper((string) ($p['countrycode'] ?? '')) !== 'ID') return null;
    $clean = static fn(string $key): string => is_string($p[$key] ?? null) ? mb_substr(trim($p[$key]), 0, 160) : '';
    if ($parts['postcode'] !== '' && $clean('postcode') !== '' && $parts['postcode'] !== $clean('postcode')) return null;
    $localities = array_filter(array_map($clean, ['locality', 'district', 'city', 'county', 'state']));
    $localityMatch = false;
    foreach ($parts['localities'] as $constraint) {
        $matches = array_filter($localities, static fn($value) => ez_geocode_normalize($value) === ez_geocode_normalize($constraint));
        if (!$matches) return null;
        $localityMatch = true;
    }
    $streetMatch = $parts['street'] !== '' && ez_geocode_street_normalize($parts['street']) === ez_geocode_street_normalize($clean('street') ?: $clean('name'));
    $numberMatch = $parts['housenumber'] !== '' && ez_geocode_normalize($parts['housenumber']) === ez_geocode_normalize($clean('housenumber'));
    $type = $clean('type');
    $precision = $type === 'house' ? ($clean('housenumber') !== '' ? 'address' : 'place') : ($type === 'street' ? 'street' : 'area');
    $matched = $precision === 'address' && $streetMatch && $numberMatch && ($localityMatch || ($parts['postcode'] !== '' && $parts['postcode'] === $clean('postcode')));
    $street = trim($clean('street') . ' ' . $clean('housenumber'));
    $name = $clean('name') ?: $street ?: $clean('city');
    if ($name === '') return null;
    $address = implode(', ', array_unique(array_filter([$street, ...$localities, $clean('postcode'), 'Indonesia'], static fn($value) => $value !== '' && $value !== $name)));
    return ['name' => $name, 'address' => mb_substr($address, 0, 500), 'kind' => ['address' => 'Building match', 'place' => 'Place match', 'street' => 'Street match', 'area' => 'Area match'][$precision],
        'coordinate' => $coordinate, 'address_line' => implode(', ', array_unique(array_filter([$name, $street]))),
        'location' => implode(', ', array_unique(array_filter([$clean('district'), $clean('city') ?: $clean('county')]))),
        'postalCode' => preg_match('/^\d{5}$/D', $clean('postcode')) ? $clean('postcode') : '',
        'precision' => $precision, 'matched' => $matched, 'provider' => 'photon'];
}

/** Rank verified addresses first. More than one distinct match always requires a choice. */
function ez_geocode_rank(array $results): array
{
    $rank = ['address' => 0, 'place' => 1, 'interpolated' => 2, 'street' => 3, 'area' => 4];
    usort($results, static fn($a, $b) => ((int) $b['matched'] <=> (int) $a['matched']) ?: ($rank[$a['precision']] <=> $rank[$b['precision']]));
    $matched = array_filter($results, static fn($p) => $p['matched']);
    foreach ($results as &$result) $result['auto_select'] = $result['matched'] && count($matched) === 1;
    unset($result);
    return $results;
}
