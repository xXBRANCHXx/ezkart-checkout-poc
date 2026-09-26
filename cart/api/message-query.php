<?php
declare(strict_types=1);

function ez_message_target(string $target, string $method, bool $merchant): array
{
    if (str_contains($target, '#')) throw new InvalidArgumentException('Message reference is invalid.');
    $parts = explode('?', $target, 2);
    if (preg_match('#^(?:/(stats|replies|conv_[a-f0-9]{32})(?:/(read|media)(?:/(mphoto_[a-f0-9]{32}))?)?)?$#D', $parts[0], $match) !== 1) throw new InvalidArgumentException('Message reference is invalid.');
    $id = $match[1] ?? ''; $action = $match[2] ?? ''; $photo = $match[3] ?? '';
    if (!$merchant && in_array($id, ['stats', 'replies'], true)) throw new InvalidArgumentException('Message reference is invalid.');
    if (($action !== '' && !str_starts_with($id, 'conv_')) || ($photo !== '' && $action !== 'media')
        || ($method === 'GET' && $action !== '' && $photo === '') || ($method === 'POST' && ($photo !== '' || $id === 'stats'))
        || !in_array($method, ['GET', 'POST'], true)) throw new InvalidArgumentException('Message method is invalid.');
    $allowed = $method === 'GET' && $action === '' ? ($id === '' ? ['q','state','unread','limit','cursor'] : (str_starts_with($id, 'conv_') ? ['limit','cursor'] : [])) : [];
    $query = [];
    foreach (explode('&', $parts[1] ?? '') as $part) {
        if ($part === '') continue;
        $pair = explode('=', $part, 2); $key = urldecode($pair[0]); $value = urldecode($pair[1] ?? '');
        if (!in_array($key, $allowed, true) || isset($query[$key]) || strlen($value) > ($key === 'cursor' ? 1800 : 480)
            || preg_match('//u', $value) !== 1 || preg_match('/[\x00-\x1f\x7f]/', $value)) throw new InvalidArgumentException('Message filters are invalid.');
        $valid = match ($key) {
            'q' => mb_strlen($value, 'UTF-8') <= 120,
            'state' => in_array($value, ['all','open','resolved','blocked','needs-response'], true),
            'unread' => in_array($value, ['all','1'], true),
            'limit' => preg_match('/^[1-9][0-9]?$/D', $value) === 1 && (int) $value <= 50,
            'cursor' => preg_match('/^[A-Za-z0-9_-]{1,1800}$/D', $value) === 1,
            default => false,
        };
        if (!$valid) throw new InvalidArgumentException('Message filters are invalid.');
        $query[$key] = $value;
    }
    return ['path' => $parts[0] . ($query ? '?' . http_build_query($query, '', '&', PHP_QUERY_RFC3986) : ''), 'photo' => $photo !== '', 'upload' => $action === 'media' && $photo === ''];
}
