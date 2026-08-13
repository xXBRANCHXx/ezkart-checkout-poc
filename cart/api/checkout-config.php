<?php
declare(strict_types=1);

require_once __DIR__ . '/bootstrap.php';

try {
    if (($_SERVER['REQUEST_METHOD'] ?? '') !== 'GET') {
        ez_api_json(['ok' => false, 'error' => 'Method not allowed.'], 405);
    }
    $credentials = ez_midtrans_credentials();
    ez_api_json([
        'ok' => true,
        'environment' => ez_commerce_environment(),
        'snap_url' => ez_midtrans_snap_script_url(),
        'client_key' => $credentials['client_key'],
    ]);
} catch (Throwable $error) {
    error_log('Ezkart checkout config error: ' . $error->getMessage());
    ez_api_json(['ok' => false, 'error' => 'Midtrans checkout is not configured on this server.'], 503);
}
