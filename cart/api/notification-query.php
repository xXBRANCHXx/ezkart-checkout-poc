<?php
declare(strict_types=1);
function ez_notification_target(string $target, string $method, bool $merchant): string
{
    if (strlen($target) > 2600 || str_contains($target, '#')) throw new InvalidArgumentException('Notification reference is invalid.');
    $parts = explode('?', $target, 2); $route = $parts[0];
    if (!in_array($route, ['', '/stats', '/read', '/processing', '/email', '/preferences', '/preferences/history'], true) || ($route === '/processing' && !$merchant)
        || ($merchant && str_starts_with($route, '/preferences'))
        || ($method === 'POST' && (!in_array($route, ['/read','/preferences'], true) || isset($parts[1]))) || ($method === 'GET' && $route === '/read')
        || !in_array($method, ['GET','POST'], true)) throw new InvalidArgumentException('Notification method is invalid.');
    $allowed = $route === '' ? ['category','state','q','cursor'] : ($route === '/processing' ? ['state','cursor'] : ($route === '/email' ? ['category','q','cursor'] : ($route === '/preferences/history' ? ['cursor'] : [])));
    $query = [];
    foreach (explode('&', $parts[1] ?? '') as $pair) {
        if ($pair === '') continue; $values = explode('=', $pair, 2); $key = urldecode($values[0]); $value = urldecode($values[1] ?? '');
        if (!in_array($key, $allowed, true) || isset($query[$key]) || strlen($value) > ($key === 'cursor' ? 1800 : 480)
            || preg_match('//u', $value) !== 1 || preg_match('/[\x00-\x1f\x7f]/', $value)) throw new InvalidArgumentException('Notification filters are invalid.');
        $valid = match ($key) {
            'category' => in_array($value, ['', 'payment_confirmed','payment_pending','payment_failed','payment_review','shipping','returns','messages','weekly_activity'], true),
            'state' => in_array($value, $route === '/processing' ? ['all','attention','queued','succeeded'] : ['all','unread','read'], true),
            'q' => mb_strlen($value, 'UTF-8') <= 120,
            'cursor' => preg_match('/^[A-Za-z0-9_-]{1,1800}$/D', $value) === 1,
            default => false,
        };
        if (!$valid) throw new InvalidArgumentException('Notification filters are invalid.'); $query[$key] = $value;
    }
    return $route . ($query ? '?' . http_build_query($query, '', '&', PHP_QUERY_RFC3986) : '');
}
