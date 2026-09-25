<?php
declare(strict_types=1);

function ez_review_query(string $raw, array $allowed): array
{
    $query = [];
    foreach (explode('&', $raw) as $part) {
        if ($part === '') continue;
        $pair = explode('=', $part, 2);
        $key = urldecode($pair[0]); $value = urldecode($pair[1] ?? '');
        if (!in_array($key, $allowed, true) || array_key_exists($key, $query)
            || strlen($value) > ($key === 'cursor' ? 1800 : ($key === 'q' ? 480 : 120)) || preg_match('//u', $value) !== 1
            || ($key === 'q' && mb_strlen($value, 'UTF-8') > 120) || preg_match('/[\x00-\x1f\x7f]/', $value)) throw new InvalidArgumentException('Review filters are invalid.');
        $valid = match ($key) {
            'product', 'review' => preg_match('/^[A-Za-z0-9][A-Za-z0-9_-]{2,95}$/D', $value) === 1,
            'photo' => preg_match('/^rphoto_[a-f0-9]{32}$/D', $value) === 1,
            'cursor' => preg_match('/^[A-Za-z0-9_-]{1,1800}$/D', $value) === 1,
            'limit' => preg_match('/^[1-9][0-9]?$/D', $value) === 1 && (int) $value <= 50,
            'rating' => in_array($value, ['', '1', '2', '3', '4', '5'], true),
            'photos' => in_array($value, ['', '0', '1'], true),
            'sort' => in_array($value, ['newest', 'oldest'], true),
            'state' => in_array($value, ['all', 'published', 'hidden', 'pending', 'withdrawn'], true),
            'reply' => in_array($value, ['all', 'needed', 'replied'], true),
            'q' => true,
            default => false,
        };
        if (!$valid) throw new InvalidArgumentException('Review filters are invalid.');
        $query[$key] = $value;
    }
    return $query;
}
