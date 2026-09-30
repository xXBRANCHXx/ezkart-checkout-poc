<?php
declare(strict_types=1);

require_once __DIR__ . '/bootstrap.php';
require_once __DIR__ . '/database.php';
require_once __DIR__ . '/address-local-index.php';

if (($_SERVER['REQUEST_METHOD'] ?? '') !== 'GET') {
    ez_api_json(['ok' => false, 'error' => 'Method not allowed.'], 405);
}

$status = ez_integration_status();
$database = ez_database_status();
$commerceEnvironment = (string) ($status['environment'] ?? 'invalid');
ez_api_json([
    'ok' => true,
    'environment' => ez_config('deployment_environment') ?: 'unset',
    'commerce_environment' => $commerceEnvironment,
    'database' => $database,
    'address_search' => ['engine' => ez_local_geocoder_available() ? 'ezkart' : 'photon', 'index_ready' => ez_local_geocoder_available()],
    'doku' => ['configured' => $status['doku'], 'mode' => $commerceEnvironment],
    'biteship' => [
        'configured' => $status['biteship'],
        'fulfillment_configured' => $status['biteship_fulfillment'],
        'webhook_configured' => ez_biteship_webhook_configured(),
        'booking_enabled' => ez_courier_writes_enabled(),
        'pickup_source' => ez_config('commerce_storage') === 'd1' ? 'seller_shipping_settings' : 'legacy_configuration',
        'mode' => $commerceEnvironment,
    ],
]);
