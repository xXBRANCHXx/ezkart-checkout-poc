<?php
declare(strict_types=1);
if (PHP_SAPI !== 'cli') { http_response_code(404); exit; }
require_once dirname(__DIR__, 2) . '/cart/api/commerce-payout-sync-dispatch.php';
try {
    if (($argv[1] ?? null) !== '--once' || count($argv) > 3) throw new InvalidArgumentException('Usage: php payout-sync-dispatch.php --once [--max-reads=20]');
    $reads = 20;
    if (isset($argv[2])) {
        if (preg_match('/^--max-reads=([1-9][0-9]?)$/D', $argv[2], $match) !== 1 || (int)$match[1] > 50) throw new InvalidArgumentException('Read budget must be between 1 and 50.');
        $reads = (int)$match[1];
    }
    $result = ez_dispatch_payout_sync($reads);
    echo json_encode(['ok'=>true,...$result], JSON_THROW_ON_ERROR) . "\n";
    exit(in_array($result['state'] ?? '', ['review','retry'], true) ? 2 : 0);
} catch (Throwable $error) {
    fwrite(STDERR,json_encode(['ok'=>false,'error'=>$error instanceof InvalidArgumentException?$error->getMessage():'Payout synchronization dispatch did not finish. Inspect the private queue and saved run evidence.','mayPay'=>false],JSON_THROW_ON_ERROR)."\n");
    exit(1);
}
