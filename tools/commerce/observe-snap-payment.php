<?php
declare(strict_types=1);
if (PHP_SAPI !== 'cli') { http_response_code(404); exit; }
require_once dirname(__DIR__, 2) . '/cart/api/commerce-snap-payments.php';

try {
    if (count($argv) !== 2 || preg_match('/^--order=(EZK-[SP]-[A-F0-9]{24})$/D', $argv[1] ?? '', $match) !== 1) {
        throw new InvalidArgumentException('Usage: php observe-snap-payment.php --order=EZK-S/P-original-order-id');
    }
    echo ez_json_encode(ez_observe_central_snap_payment($match[1])) . "\n";
} catch (Throwable $error) {
    fwrite(STDERR, ez_json_encode(['ok' => false, 'error' => $error->getMessage()]) . "\n");
    exit(1);
}
