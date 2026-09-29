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
require __DIR__ . '/page-preview.php';
