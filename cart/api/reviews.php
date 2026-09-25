<?php
declare(strict_types=1);
require_once __DIR__ . '/bootstrap.php';
require_once __DIR__ . '/review-query.php';

try {
    if (($_SERVER['REQUEST_METHOD'] ?? '') !== 'GET') ez_api_json(['ok' => false, 'error' => 'Method not allowed.'], 405);
    $query = ez_review_query((string) ($_SERVER['QUERY_STRING'] ?? ''), ['product', 'rating', 'photos', 'sort', 'limit', 'cursor', 'review', 'photo']);
    $isPhoto = isset($query['review']) || isset($query['photo']);
    if ($isPhoto) {
        if (count($query) !== 2 || !isset($query['review'], $query['photo'])) throw new InvalidArgumentException('Review photo reference is invalid.');
        $path = '/v1/public/reviews/' . $query['review'] . '/media/' . $query['photo'];
    } else {
        if (!isset($query['product'])) throw new InvalidArgumentException('Choose a product.');
        $path = '/v1/public/reviews?' . http_build_query($query, '', '&', PHP_QUERY_RFC3986);
    }
    $api = rtrim(ez_config('cloudflare_api_url'), '/');
    if (!filter_var($api, FILTER_VALIDATE_URL) || !function_exists('curl_init')) throw new RuntimeException('Review service unavailable.');
    $handle = curl_init($api . $path);
    if ($handle === false) throw new RuntimeException('Review service unavailable.');
    curl_setopt_array($handle, [CURLOPT_RETURNTRANSFER => true, CURLOPT_CONNECTTIMEOUT => 5, CURLOPT_TIMEOUT => 20,
        CURLOPT_SSL_VERIFYPEER => true, CURLOPT_SSL_VERIFYHOST => 2, CURLOPT_FOLLOWLOCATION => false, CURLOPT_HTTPHEADER => ['Accept: application/json']]);
    $raw = curl_exec($handle); $status = (int) curl_getinfo($handle, CURLINFO_HTTP_CODE); $type = (string) curl_getinfo($handle, CURLINFO_CONTENT_TYPE);
    if ($isPhoto && $status === 200 && is_string($raw) && in_array($type, ['image/jpeg', 'image/png', 'image/webp'], true)) {
        header('Content-Type: ' . $type); header('Cache-Control: no-store'); header('X-Content-Type-Options: nosniff');
        header("Content-Security-Policy: default-src 'none'; sandbox"); echo $raw; exit;
    }
    $data = is_string($raw) ? json_decode($raw, true) : null;
    if (in_array($status, [400, 404, 422], true)) ez_api_json(['ok' => false, 'error' => $status === 404 ? 'This product or review photo is unavailable.' : 'Review filters are invalid.'], $status);
    if ($status !== 200 || !is_array($data) || ($data['ok'] ?? false) !== true) throw new RuntimeException('Review service unavailable.');
    ez_api_json($data);
} catch (InvalidArgumentException $error) {
    ez_api_json(['ok' => false, 'error' => $error->getMessage()], 400);
} catch (Throwable) {
    ez_api_json(['ok' => false, 'error' => 'Reviews could not be loaded. Please try again.'], 503);
}
