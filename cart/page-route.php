<?php
declare(strict_types=1);

$path = (string) parse_url((string) ($_SERVER['REQUEST_URI'] ?? ''), PHP_URL_PATH);
if (preg_match('#^/([a-z0-9]+(?:-[a-z0-9]+)*)/shop/([a-z0-9]+(?:-[a-z0-9]+)*)(/preview)?/?$#D', $path, $route) !== 1
    || strlen($route[1]) > 96 || strlen($route[2]) > 48) {
    http_response_code(404);
    exit('Page not found.');
}
$store = $route[1];
$page = $route[2];
$preview = ($route[3] ?? '') === '/preview';
$canonical = '/' . $store . '/shop/' . $page . ($preview ? '/preview' : '');
header('Cache-Control: private, no-store');
if ($path !== $canonical) {
    header('Location: ' . $canonical . (!empty($_SERVER['QUERY_STRING']) ? '?' . $_SERVER['QUERY_STRING'] : ''), true, 308);
    exit;
}
if (!$preview) {
    $_GET = ['store' => $store, 'page' => $page] + array_intersect_key($_GET, array_flip(['ez_source','tracking_visit','utm_source','utm_medium','utm_campaign']));
    require __DIR__ . '/page.php';
    exit;
}
if (($_SERVER['REQUEST_METHOD'] ?? '') !== 'GET') {
    header('Allow: GET');
    http_response_code(405);
    exit('Method not allowed.');
}

// The admin session cookie deliberately stays scoped to /cart/admin. Fetch the
// authenticated, sandboxed document there, then display it at this readable URL.
// No merchant credentials are copied into URLs or broadened to the public site.
header('Content-Type: text/html; charset=utf-8');
header('X-Content-Type-Options: nosniff');
header('X-Robots-Tag: noindex, nofollow');
header('Referrer-Policy: no-referrer');
header("Content-Security-Policy: default-src 'none'; img-src 'self' data: https:; media-src 'self' data: blob: https:; style-src 'unsafe-inline' https:; script-src 'self' 'unsafe-inline' https:; font-src 'self' data: https:; connect-src 'self' https:; form-action 'self' https:; frame-src 'self' about: https:; frame-ancestors 'self'; base-uri 'none'");
$source = '/cart/admin/?cloud=' . rawurlencode('/v1/landing-pages/' . $page . '/view') . '&preview-store=' . rawurlencode($store);
?>
<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Page preview</title>
<style>body{margin:0;min-height:100vh;display:grid;place-content:center;text-align:center;font:15px system-ui;color:#59616c;background:white}a{color:#173f39}</style>
<script src="/cart/page-preview-loader.js" data-preview-source="<?= htmlspecialchars($source, ENT_QUOTES, 'UTF-8') ?>" defer></script>
</head><body><p data-preview-status role="status">Loading your preview…</p><a href="/cart/admin/?page=sites" data-preview-sign-in hidden>Sign in to Ezkart</a></body></html>
