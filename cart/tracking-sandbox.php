<?php
declare(strict_types=1);
require_once __DIR__ . '/api/bootstrap.php';

// This walkthrough renders fixtures only. It cannot create orders or call payment/shipping providers.
if (ez_config('deployment_environment') !== 'test' || ez_commerce_environment() !== 'sandbox') {
    http_response_code(404);
    exit('Not found.');
}

require_once __DIR__ . '/api/tracking-sandbox-data.php';
$trackingSandboxData = ez_tracking_sandbox_scenarios();
require __DIR__ . '/return.php';
