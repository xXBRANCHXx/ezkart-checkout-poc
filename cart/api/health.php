<?php
declare(strict_types=1);

require_once __DIR__ . '/bootstrap.php';
require_once __DIR__ . '/database.php';

if (($_SERVER['REQUEST_METHOD'] ?? '') !== 'GET') {
    ez_api_json(['ok' => false, 'error' => 'Method not allowed.'], 405);
}

$status = ez_integration_status();
$database = ez_database_status();
ez_api_json([
    'ok' => true,
    'environment' => ez_config('deployment_environment') ?: 'sandbox',
    'database' => $database,
    'midtrans' => ['configured' => $status['midtrans'], 'mode' => 'sandbox'],
    'biteship' => [
        'configured' => $status['biteship'],
        'fulfillment_configured' => $status['biteship_fulfillment'],
        'mode' => 'test',
    ],
]);
