<?php
declare(strict_types=1);
require_once __DIR__ . '/bootstrap.php';

try {
    if (($_SERVER['REQUEST_METHOD'] ?? '') !== 'GET') ez_api_json(['ok' => false, 'error' => 'Method not allowed.'], 405);
    $query = [];
    foreach (['store', 'product'] as $key) {
        $value = trim((string) ($_GET[$key] ?? ''));
        if ($value !== '' && preg_match('/^[a-zA-Z0-9][a-zA-Z0-9_-]{2,95}$/D', $value) !== 1) throw new InvalidArgumentException('This shop link is invalid.');
        if ($value !== '') $query[$key] = $value;
    }
    if ($query === []) throw new InvalidArgumentException('Choose a shop or product.');
    if (($_GET['mode'] ?? '') === 'checkout') $query['mode'] = 'checkout';
    $api = rtrim(ez_config('cloudflare_api_url'), '/');
    if (!filter_var($api, FILTER_VALIDATE_URL) || !function_exists('curl_init')) throw new RuntimeException('Shop data is unavailable.');
    $handle = curl_init($api . '/v1/storefront/view?' . http_build_query($query));
    curl_setopt_array($handle, [CURLOPT_RETURNTRANSFER => true, CURLOPT_CONNECTTIMEOUT => 8, CURLOPT_TIMEOUT => 15, CURLOPT_SSL_VERIFYPEER => true, CURLOPT_FOLLOWLOCATION => false, CURLOPT_HTTPHEADER => ['Accept: application/json']]);
    $body = curl_exec($handle);
    $status = (int) curl_getinfo($handle, CURLINFO_HTTP_CODE);
    $payload = is_string($body) ? json_decode($body, true) : null;
    if (in_array($status, [400, 404], true)) ez_api_json(['ok' => false, 'error' => 'This shop or product is unavailable.'], $status);
    if ($status !== 200 || ($payload['ok'] ?? false) !== true) throw new RuntimeException('The shop could not be loaded.');
    $mediaUrl = static fn($path): string => is_string($path) && preg_match('#^/v1/public/media/[a-zA-Z0-9_-]+$#D', $path) === 1 ? $api . $path : '';
    $payload['store']['logoUrl'] = $mediaUrl($payload['store']['logoPath'] ?? '');
    $payload['store']['backgroundUrl'] = $mediaUrl($payload['store']['backgroundPath'] ?? '');
    foreach ($payload['products'] as &$product) {
        $product['imageUrl'] = $mediaUrl($product['imagePath'] ?? '');
        foreach ($product['choices'] as &$choice) $choice['imageUrl'] = $mediaUrl($choice['imagePath'] ?? '');
        unset($choice);
    }
    unset($product);
    ez_api_json($payload);
} catch (InvalidArgumentException $error) {
    ez_api_json(['ok' => false, 'error' => $error->getMessage()], 400);
} catch (Throwable $error) {
    error_log('Ezkart shop: ' . $error->getMessage());
    ez_api_json(['ok' => false, 'error' => 'The shop could not be loaded. Please try again.'], 503);
}
