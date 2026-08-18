<?php
declare(strict_types=1);

$logoPath = __DIR__ . '/ezkart-logo-email.png';
if (!is_file($logoPath)) {
    http_response_code(404);
    exit;
}

header('Content-Type: image/png');
header('Content-Length: ' . (string) filesize($logoPath));
header('Cache-Control: public, max-age=604800, immutable');
header('Access-Control-Allow-Origin: *');
header('Cross-Origin-Resource-Policy: cross-origin');
header('X-Content-Type-Options: nosniff');

readfile($logoPath);
