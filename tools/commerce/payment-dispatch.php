<?php
declare(strict_types=1);

// Install outside the public web root. A scheduler invokes this CLI once per pass.
if (PHP_SAPI !== 'cli') { http_response_code(404); exit; }
require_once dirname(__DIR__, 2) . '/cart/api/bootstrap.php';
require_once dirname(__DIR__, 2) . '/cart/api/commerce-payment-jobs.php';

try {
    if (($argv[1] ?? '') !== '--once' || count($argv) > 2) throw new InvalidArgumentException('Usage: php payment-dispatch.php --once');
    if (!ez_central_commerce_enabled()) throw new RuntimeException('Central commerce storage is not enabled.');
    $environment = ez_central_commerce_environment();
    $worker = 'payment_dispatch_' . bin2hex(random_bytes(12));
    $summary = ['environment' => $environment, 'processed' => 0, 'succeeded' => 0, 'uncertain' => 0, 'dead' => 0];
    foreach (['reconcile', 'execute'] as $mode) {
        for ($n = 0; $n < 5; $n++) {
            // Claim just one: each job gets a fresh lease immediately before its provider request.
            $jobs = ez_commerce_request('POST', '/internal/commerce/jobs/claim', [
                'environment' => $environment, 'workerId' => $worker, 'kinds' => ['payment.create'],
                'mode' => $mode, 'limit' => 1, 'leaseSeconds' => 120,
            ])['jobs'];
            if ($jobs === []) break;
            $job = ez_central_payment_job($jobs[0], $worker);
            $summary['processed']++; $summary[$job['state']] = ($summary[$job['state']] ?? 0) + 1;
        }
    }
    echo ez_json_encode($summary) . "\n";
    exit($summary['uncertain'] || $summary['dead'] ? 2 : 0);
} catch (Throwable $error) {
    fwrite(STDERR, 'Payment dispatch could not complete: ' . $error->getMessage() . "\n");
    exit(1);
}
