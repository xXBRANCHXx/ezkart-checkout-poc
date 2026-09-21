<?php
declare(strict_types=1);
// Open Location Code algorithms adapted from Google's Apache-2.0 implementation.
// Copyright 2014 Google Inc. See vendor/open-location-code/LICENSE and README.md.

const EZ_PLUS_ALPHABET = '23456789CFGHJMPQRVWX';

function ez_plus_code_valid(string $code): bool
{
    $code = strtoupper($code);
    $separator = strpos($code, '+');
    if ($separator === false || substr_count($code, '+') !== 1 || $separator > 8 || $separator % 2 !== 0 || strlen($code) === 1 || strlen($code) - $separator - 1 === 1) return false;
    if (str_contains($code, '0')) {
        if ($separator !== 8 || $code[0] === '0' || !str_ends_with($code, '+')) return false;
        preg_match_all('/0+/', $code, $padding);
        if (count($padding[0]) !== 1 || strlen($padding[0][0]) % 2 !== 0 || strlen($padding[0][0]) > 6) return false;
    }
    if (strspn(str_replace(['+', '0'], '', $code), EZ_PLUS_ALPHABET) !== strlen(str_replace(['+', '0'], '', $code))) return false;
    return $separator !== 8 || (strpos(EZ_PLUS_ALPHABET, $code[0]) < 9 && strpos(EZ_PLUS_ALPHABET, $code[1]) < 18);
}

function ez_plus_code_center(string $code): array
{
    if (!ez_plus_code_valid($code) || strpos($code, '+') !== 8) throw new InvalidArgumentException('A full Plus Code is required.');
    $code = str_replace(['+', '0'], '', strtoupper($code));
    $latitude = -90 * 8000; $longitude = -180 * 8000;
    $digits = min(strlen($code), 10); $place = 160000;
    for ($i = 0; $i < $digits; $i += 2) {
        $latitude += strpos(EZ_PLUS_ALPHABET, $code[$i]) * $place;
        $longitude += strpos(EZ_PLUS_ALPHABET, $code[$i + 1]) * $place;
        if ($i < $digits - 2) $place /= 20;
    }
    $latitude /= 8000; $longitude /= 8000;
    $latSize = $place / 8000; $lngSize = $latSize;
    for ($i = 10; $i < min(strlen($code), 15); $i++) {
        $digit = strpos(EZ_PLUS_ALPHABET, $code[$i]);
        $latSize /= 5; $lngSize /= 4;
        $latitude += intdiv($digit, 4) * $latSize;
        $longitude += ($digit % 4) * $lngSize;
    }
    return ['latitude' => min(90, $latitude + $latSize / 2), 'longitude' => min(180, $longitude + $lngSize / 2)];
}

function ez_plus_code_recover(string $code, array $reference): array
{
    if (!ez_plus_code_valid($code)) throw new InvalidArgumentException('Invalid Plus Code.');
    $missing = 8 - strpos($code, '+');
    if ($missing === 0) return ez_plus_code_center($code);
    $lat = min(90 - 0.000125, max(-90, $reference['latitude']));
    $lng = fmod(fmod($reference['longitude'] + 180, 360) + 360, 360) - 180;
    $latInt = (int) floor(round(($lat + 90) * 8000, 6));
    $lngInt = (int) floor(round(($lng + 180) * 8000, 6));
    $prefix = '';
    foreach ([160000, 8000, 400, 20] as $place) {
        $prefix .= EZ_PLUS_ALPHABET[intdiv($latInt, $place)] . EZ_PLUS_ALPHABET[intdiv($lngInt, $place)];
        $latInt %= $place; $lngInt %= $place;
    }
    $center = ez_plus_code_center(substr($prefix, 0, $missing) . strtoupper($code));
    $resolution = 20 ** (2 - $missing / 2); $half = $resolution / 2;
    if ($lat + $half < $center['latitude'] && $center['latitude'] - $resolution >= -90) $center['latitude'] -= $resolution;
    elseif ($lat - $half > $center['latitude'] && $center['latitude'] + $resolution <= 90) $center['latitude'] += $resolution;
    if ($lng + $half < $center['longitude']) $center['longitude'] -= $resolution;
    elseif ($lng - $half > $center['longitude']) $center['longitude'] += $resolution;
    $center['longitude'] = fmod(fmod($center['longitude'] + 180, 360) + 360, 360) - 180;
    return $center;
}
