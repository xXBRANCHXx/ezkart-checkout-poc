<?php
declare(strict_types=1);
require __DIR__ . '/builder-bundles.php';

$bundle = (string) ($_GET['bundle'] ?? '');
if (ez_builder_bundle_files($bundle) === []) {
    http_response_code(404);
    exit;
}
$version = ez_builder_bundle_version($bundle);
$etag = 'W/"' . $version . '"';
header('Content-Type: ' . (str_ends_with($bundle, '.js') ? 'text/javascript' : 'text/css') . '; charset=utf-8');
header('X-Content-Type-Options: nosniff');
header('Cache-Control: ' . (($_GET['v'] ?? '') === $version ? 'public, max-age=31536000, immutable' : 'public, no-cache'));
header('ETag: ' . $etag);
header('Vary: Accept-Encoding');
if (($_SERVER['HTTP_IF_NONE_MATCH'] ?? '') === $etag) {
    http_response_code(304);
    exit;
}
if (function_exists('ob_gzhandler') && !ini_get('zlib.output_compression')) ob_start('ob_gzhandler');
echo ez_builder_bundle_contents($bundle);
