<?php
declare(strict_types=1);
require_once __DIR__ . '/api/bootstrap.php';
require_once __DIR__ . '/api/database.php';

header('Cache-Control: no-store');
header('Referrer-Policy: no-referrer');
header('X-Content-Type-Options: nosniff');
header('X-Frame-Options: DENY');
header('X-Robots-Tag: noindex, nofollow');
header("Content-Security-Policy: default-src 'none'; style-src 'self'; img-src 'self'; frame-ancestors 'none'; base-uri 'none'");
header('Content-Type: text/html; charset=utf-8');
$method = (string) ($_SERVER['REQUEST_METHOD'] ?? 'GET');
$code = preg_match('/^c=([a-f0-9]{64})$/D', (string) ($_SERVER['QUERY_STRING'] ?? ''), $match) === 1 ? $match[1] : '';
$status = 404;
try {
    if (!in_array($method, ['GET','HEAD'], true)) { header('Allow: GET, HEAD'); throw new RuntimeException('method', 405); }
    if ($code === '') throw new RuntimeException('link', 404);
    $database = ez_database_configuration(); $parts = parse_url($database['url']);
    if (isset($parts['user']) || isset($parts['pass']) || isset($parts['port']) || isset($parts['query']) || isset($parts['fragment'])
        || !in_array($parts['path'] ?? '', ['', '/'], true) || !function_exists('curl_init')) throw new RuntimeException('service', 503);
    $handle = curl_init($database['url'] . '/v1/public/campaign-link?c=' . $code);
    if ($handle === false) throw new RuntimeException('service', 503);
    $raw = ''; $storeHeader = ''; $environmentHeader = '';
    curl_setopt_array($handle, [CURLOPT_CUSTOMREQUEST => $method, CURLOPT_NOBODY => $method === 'HEAD', CURLOPT_HTTPHEADER => ['Accept: application/json'],
        CURLOPT_FOLLOWLOCATION => false, CURLOPT_CONNECTTIMEOUT => 4, CURLOPT_TIMEOUT => 15, CURLOPT_SSL_VERIFYPEER => true, CURLOPT_SSL_VERIFYHOST => 2,
        CURLOPT_WRITEFUNCTION => static function ($curl, string $chunk) use (&$raw): int { if (strlen($raw) + strlen($chunk) > 8000) return 0; $raw .= $chunk; return strlen($chunk); },
        CURLOPT_HEADERFUNCTION => static function ($curl, string $line) use (&$storeHeader, &$environmentHeader): int {
            if (stripos($line, 'X-Ezkart-Campaign-Store:') === 0) $storeHeader = trim(substr($line, strlen('X-Ezkart-Campaign-Store:')));
            if (stripos($line, 'X-Ezkart-Campaign-Environment:') === 0) $environmentHeader = trim(substr($line, strlen('X-Ezkart-Campaign-Environment:')));
            return strlen($line);
        }]);
    $received = curl_exec($handle); $upstream = (int) curl_getinfo($handle, CURLINFO_RESPONSE_CODE);
    if ($received !== true || $upstream !== 200) throw new RuntimeException('service', $upstream === 404 ? 404 : 503);
    $expected = $database['environment'] === 'test' ? 'sandbox' : 'production';
    $view = $method === 'HEAD' ? ['storeId' => $storeHeader, 'environment' => $environmentHeader, 'visit' => null, 'expiresAt' => null, 'ok' => true] : json_decode($raw, true);
    if (!is_array($view) || ($view['ok'] ?? false) !== true || ($view['environment'] ?? '') !== $expected
        || !is_string($view['storeId'] ?? null) || preg_match('/^[A-Za-z0-9][A-Za-z0-9_-]{2,95}$/D', $view['storeId']) !== 1
        || !array_key_exists('visit', $view) || !array_key_exists('expiresAt', $view)
        || ($view['visit'] === null ? $view['expiresAt'] !== null : !is_string($view['visit']) || preg_match('/^[a-f0-9]{64}$/D', $view['visit']) !== 1
            || !is_string($view['expiresAt']) || preg_match('/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/D', $view['expiresAt']) !== 1)) throw new RuntimeException('unconfirmed', 503);
    $destination = '/shop/?' . http_build_query(['store' => $view['storeId']] + ($view['visit'] === null ? [] : ['campaign_visit' => $view['visit']]), '', '&', PHP_QUERY_RFC3986);
    header('Location: ' . $destination, true, 302); exit;
} catch (Throwable $error) { $status = in_array($error->getCode(), [404,405,503], true) ? $error->getCode() : 503; }
http_response_code($status);
if ($method === 'HEAD') exit;
?><!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Store link · Ezkart</title><link rel="stylesheet" href="unsubscribe.css"></head><body><main class="unsubscribe-card"><p class="unsubscribe-eyebrow">Ezkart</p><h1><?= $status === 503 ? 'This store link is temporarily unavailable' : 'This store link is unavailable' ?></h1><p><?= $status === 503 ? 'Please try this link again in a moment.' : 'Check that you opened the complete link from the email.' ?></p></main></body></html>
