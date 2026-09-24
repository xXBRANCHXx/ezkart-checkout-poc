<?php
declare(strict_types=1);
require __DIR__ . '/builder-bundles.php';

$bundle = (string) ($_GET['bundle'] ?? '');
if (ez_builder_bundle_files($bundle) === []) {
    http_response_code(404);
    exit;
}
$asset = ez_builder_bundle_url($bundle);
if (!str_starts_with($asset, 'builder-bundle.php')) {
    header('Cache-Control: public, no-cache');
    header('Location: ' . $asset, true, 302);
    exit;
}
$version = ez_builder_bundle_version($bundle);
$etag = 'W/"' . $version . '"';
header('Content-Type: ' . (str_ends_with($bundle, '.js') ? 'text/javascript' : 'text/css') . '; charset=utf-8');
header('X-Content-Type-Options: nosniff');
header('Cache-Control: ' . (($_GET['v'] ?? '') === $version ? 'public, max-age=31536000, immutable, no-transform' : 'public, no-cache, no-transform'));
header('ETag: ' . $etag);
header('Vary: Accept-Encoding');
if (($_SERVER['HTTP_IF_NONE_MATCH'] ?? '') === $etag) {
    http_response_code(304);
    exit;
}
$contents = ez_builder_bundle_contents($bundle);
// Compress the complete bundle together. Host streaming compression uses small
// windows and loses most of the repeated native-asset definitions' savings.
if (function_exists('gzencode') && preg_match('/\bgzip\b/i', (string) ($_SERVER['HTTP_ACCEPT_ENCODING'] ?? ''))) {
    ini_set('zlib.output_compression', '0');
    header('Content-Encoding: gzip');
    echo gzencode($contents, 9);
} else {
    echo $contents;
}
