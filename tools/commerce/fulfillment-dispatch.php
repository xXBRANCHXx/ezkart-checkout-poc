<?php
declare(strict_types=1);

if (PHP_SAPI !== 'cli') { http_response_code(404); exit; }
require_once dirname(__DIR__, 2) . '/cart/api/bootstrap.php';
require_once dirname(__DIR__, 2) . '/cart/api/commerce-fulfillment.php';

try {
    if (($argv[1] ?? '') !== '--once' || count($argv) > 2) throw new InvalidArgumentException('Usage: php fulfillment-dispatch.php --once');
    if (!ez_central_commerce_enabled()) throw new RuntimeException('Central commerce storage is not enabled.');
    $environment = ez_central_commerce_environment(); $worker = 'fulfillment_dispatch_' . bin2hex(random_bytes(12));
    $summary = ['environment' => $environment, 'processed' => 0, 'succeeded' => 0, 'uncertain' => 0, 'dead' => 0, 'eventsApplied' => 0];
    $summary['eventsApplied'] += ez_commerce_request('POST', '/internal/commerce/shipping-events/drain', ['environment' => $environment])['applied'];
    foreach (['reconcile', 'execute'] as $mode) {
        for ($n = 0; $n < 5; $n++) {
            $jobs = ez_commerce_request('POST', '/internal/commerce/jobs/claim', [
                'environment' => $environment, 'workerId' => $worker, 'kinds' => ['shipment.create', 'shipment.cancel', 'shipment.refresh'],
                'mode' => $mode, 'limit' => 1, 'leaseSeconds' => 120,
            ])['jobs'];
            if ($jobs === []) break;
            $job = ez_central_fulfillment_job($jobs[0], $worker);
            $summary['processed']++; $summary[$job['state']] = ($summary[$job['state']] ?? 0) + 1;
        }
    }
    $summary['eventsApplied'] += ez_commerce_request('POST', '/internal/commerce/shipping-events/drain', ['environment' => $environment])['applied'];
    echo ez_json_encode($summary) . "\n";
    exit($summary['uncertain'] || $summary['dead'] ? 2 : 0);
} catch (Throwable $error) {
    fwrite(STDERR, 'Fulfillment dispatch could not complete: ' . $error->getMessage() . "\n"); exit(1);
}
