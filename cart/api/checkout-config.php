<?php
declare(strict_types=1);

require_once __DIR__ . '/bootstrap.php';
require_once __DIR__ . '/commerce-checkout.php';

try {
    if (($_SERVER['REQUEST_METHOD'] ?? '') !== 'GET') {
        ez_api_json(['ok' => false, 'error' => 'Method not allowed.'], 405);
    }
    // Public checkout behavior is available before provider credentials are installed.
    $environment = ez_commerce_environment();
    if (ez_central_commerce_enabled()) ez_central_commerce_environment();
    ez_api_json([
        'ok' => true,
        'environment' => $environment,
        'provider' => 'doku',
        'shipping_required' => $environment === 'production',
        'durable_checkout' => ez_central_commerce_enabled(),
    ]);
} catch (Throwable $error) {
    error_log('Ezkart checkout config error: ' . $error->getMessage());
    ez_api_json(['ok' => false, 'error' => 'Checkout settings are unavailable.'], 503);
}
