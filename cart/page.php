<?php
declare(strict_types=1);
require_once __DIR__ . '/api/bootstrap.php';
require_once __DIR__ . '/page-frame.php';

header('Content-Type: text/html; charset=utf-8');
header('Cache-Control: private, no-store');
header('X-Content-Type-Options: nosniff');
header('Referrer-Policy: no-referrer');
if (strtolower(ez_config('deployment_environment')) !== 'production') header('X-Robots-Tag: noindex, nofollow');
// Merchant-authored HTML must never gain the hosting origin's privileges.
header("Content-Security-Policy: default-src 'none'; img-src 'self' data: https:; media-src 'self' data: blob: https:; style-src 'unsafe-inline' https:; script-src 'unsafe-inline' https:; font-src 'self' data: https:; connect-src 'self' https:; form-action 'self' https:; frame-src 'self' about: https:; frame-ancestors 'self'; base-uri 'none'; sandbox allow-scripts allow-forms allow-popups allow-popups-to-escape-sandbox allow-top-navigation-by-user-activation");

try {
    if (($_SERVER['REQUEST_METHOD'] ?? '') !== 'GET') {
        header('Allow: GET');
        http_response_code(405);
        exit('Method not allowed.');
    }
    $store = (string) ($_GET['store'] ?? '');
    $page = (string) ($_GET['page'] ?? '');
    if (strlen($store) > 96 || strlen($page) > 48
        || preg_match('/^[a-z0-9]+(?:-[a-z0-9]+)*$/D', $store) !== 1
        || preg_match('/^[a-z0-9]+(?:-[a-z0-9]+)*$/D', $page) !== 1) {
        http_response_code(404);
        exit('Page not found.');
    }
    if (parse_url((string) ($_SERVER['REQUEST_URI'] ?? ''), PHP_URL_PATH) === '/cart/page.php') {
        header('Location: /' . $store . '/shop/' . $page, true, 302);
        exit;
    }
    $api = rtrim(ez_config('cloudflare_api_url'), '/');
    if (!filter_var($api, FILTER_VALIDATE_URL) || !function_exists('curl_init')) throw new RuntimeException('Page hosting is unavailable.');
    $handle = curl_init($api . '/v1/public/landing-pages/' . rawurlencode($store) . '/' . rawurlencode($page));
    if ($handle === false) throw new RuntimeException('Page request could not start.');
    $canonicalPath = '';
    curl_setopt_array($handle, [
        CURLOPT_RETURNTRANSFER => true, CURLOPT_ENCODING => '',
        CURLOPT_CONNECTTIMEOUT => 8, CURLOPT_TIMEOUT => 40,
        CURLOPT_SSL_VERIFYPEER => true, CURLOPT_FOLLOWLOCATION => false,
        CURLOPT_HTTPHEADER => ['Accept: text/html'],
        CURLOPT_HEADERFUNCTION => static function ($curl, string $line) use (&$canonicalPath): int {
            if (str_starts_with(strtolower($line), 'x-ezkart-public-path:')) $canonicalPath = trim(substr($line, strlen('x-ezkart-public-path:')));
            return strlen($line);
        },
    ]);
    $html = curl_exec($handle);
    $status = (int) curl_getinfo($handle, CURLINFO_RESPONSE_CODE);
    $type = (string) curl_getinfo($handle, CURLINFO_CONTENT_TYPE);
    if ($status === 404) {
        http_response_code(404);
        exit('Page not found.');
    }
    if ($status !== 200 || !is_string($html) || !str_starts_with(strtolower($type), 'text/html')) throw new RuntimeException('Page could not be loaded.');
    if (preg_match('#^/[a-z0-9-]+/shop/[a-z0-9-]+$#D', $canonicalPath) === 1 && $canonicalPath !== '/' . $store . '/shop/' . $page) {
        header('Location: ' . $canonicalPath, true, 302);
        exit;
    }
    echo ez_landing_page_frame($html);
} catch (Throwable $error) {
    error_log('Ezkart page hosting: ' . $error->getMessage());
    http_response_code(503);
    echo 'This page could not be loaded. Please try again.';
}
