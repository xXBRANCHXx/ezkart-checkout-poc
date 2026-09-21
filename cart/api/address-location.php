<?php
declare(strict_types=1);
require_once __DIR__ . '/plus-code.php';

/** Read coordinates explicitly supplied by the customer; never infer a pin from map zoom/viewport. */
function ez_address_location(string $text): array
{
    $clean = trim(preg_replace('/\s+/u', ' ', $text) ?? '');
    $number = '[+-]?\d{1,3}(?:\.\d+)?';
    $coordinate = null; $source = 'coordinates';
    $lat = preg_match('/\blat(?:itude)?\s*[:=]\s*(' . $number . ')(?![\d.])/i', $clean, $a);
    $lng = preg_match('/\b(?:lng|lon|longitude)\s*[:=]\s*(' . $number . ')(?![\d.])/i', $clean, $b);
    if ($lat || $lng || preg_match('/\b(?:lat(?:itude)?|lng|lon|longitude)\s*[:=]/i', $clean)) {
        if (!$lat || !$lng) throw new InvalidArgumentException('Include both latitude and longitude.');
        $coordinate = ['latitude' => (float) $a[1], 'longitude' => (float) $b[1]];
        $clean = preg_replace('/\b(?:lat(?:itude)?|lng|lon|longitude)\s*[:=]\s*' . $number . '/i', '', $clean);
        $clean = preg_replace('/\([\s,;]*\)/', '', $clean);
        $clean = trim(preg_replace('/\s*,(?:\s*,)+/', ',', $clean), " ,;()");
    } elseif (preg_match('/^\(?\s*(' . $number . ')\s*,\s*(' . $number . ')\s*\)?$/D', $clean, $pair)) {
        $coordinate = ['latitude' => (float) $pair[1], 'longitude' => (float) $pair[2]];
        $clean = '';
    }
    if ($coordinate !== null && (!is_finite($coordinate['latitude']) || !is_finite($coordinate['longitude']) || abs($coordinate['latitude']) > 90 || abs($coordinate['longitude']) > 180 || ($coordinate['latitude'] === 0.0 && $coordinate['longitude'] === 0.0))) {
        throw new InvalidArgumentException('Those coordinates are outside the map. Check the latitude and longitude.');
    }
    $code = null;
    if (preg_match('/(?<![A-Z0-9])([A-Z0-9]{0,8}\+[A-Z0-9]{2,7}|[A-Z0-9]{2,8}\+)(?![A-Z0-9])/i', $clean, $match)) {
        $code = strtoupper($match[1]);
        if (!ez_plus_code_valid($code)) throw new InvalidArgumentException('That Plus Code is incomplete or invalid. Copy the full code and locality.');
    }
    if ($coordinate === null && $code !== null && strpos($code, '+') === 8) { $coordinate = ez_plus_code_center($code); $source = 'plus_code'; }
    return ['address' => $clean, 'coordinate' => $coordinate, 'plus_code' => $code, 'source' => $source];
}

/** Normalize supplied coordinates on reads too, so addresses saved before this parser still work. */
function ez_address_with_location(array $address): array
{
    try { $parsed = ez_address_location((string) ($address['address'] ?? '')); }
    catch (InvalidArgumentException) { return $address; }
    if ($parsed['coordinate'] !== null) {
        $address['coordinate'] = $parsed['coordinate'];
        if ($parsed['address'] !== '') $address['address'] = $parsed['address'];
    }
    return $address;
}
