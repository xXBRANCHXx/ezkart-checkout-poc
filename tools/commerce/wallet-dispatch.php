<?php
declare(strict_types=1);
// Install outside the public web root. Invoke once per scheduled pass.
if (PHP_SAPI !== 'cli') { http_response_code(404); exit; }
require_once dirname(__DIR__, 2) . '/cart/api/commerce-checkout.php';
require_once dirname(__DIR__, 2) . '/cart/api/commerce-wallet-jobs.php';
try {
    if (($argv[1] ?? '') !== '--once' || count($argv) !== 2) throw new InvalidArgumentException('Usage: php wallet-dispatch.php --once');
    if (!ez_central_commerce_enabled()) throw new RuntimeException('Central commerce storage is not enabled.');
    $environment = ez_central_commerce_environment();
    [$client, $parent] = ez_wallet_provider_configuration($environment);
    $worker = 'wallet_dispatch_' . bin2hex(random_bytes(12));
    $summary = ['environment' => $environment, 'processed' => 0, 'succeeded' => 0, 'uncertain' => 0, 'dead' => 0];
    foreach (['reconcile', 'execute'] as $mode) {
        for ($n = 0; $n < 5; $n++) {
            $jobs = ez_commerce_request('POST', '/internal/commerce/jobs/claim', ['environment' => $environment,
                'workerId' => $worker, 'kinds' => ['wallet.register'], 'mode' => $mode, 'limit' => 1, 'leaseSeconds' => 120])['jobs'];
            if ($jobs === []) break;
            $job = ez_wallet_registration_job($jobs[0], $worker, $client, $parent);
            $summary['processed']++; $summary[$job['state']] = ($summary[$job['state']] ?? 0) + 1;
        }
    }
    echo ez_json_encode($summary) . "\n";
    exit($summary['uncertain'] || $summary['dead'] ? 2 : 0);
} catch (Throwable $error) {
    fwrite(STDERR, 'Wallet dispatch could not complete (' . get_class($error) . '). Check protected service configuration and job history.' . "\n");
    exit(1);
}
