<?php
declare(strict_types=1);
if (PHP_SAPI !== 'cli') { http_response_code(404); exit; }
// CLI has no web-server DOCUMENT_ROOT. Use this checkout's real root so the
// normal loader reads its private parent configuration, with the same precedence.
$_SERVER['DOCUMENT_ROOT'] = dirname(__DIR__, 2);
require_once dirname(__DIR__, 2) . '/cart/api/commerce-payout-sync-runner.php';
try {
    if (($argv[1] ?? null) !== '--once' || count($argv) > 3) throw new InvalidArgumentException('Usage: php payout-sync-scheduled.php --once [--max-reads=20]');
    $reads = 20;
    if (isset($argv[2])) {
        if (preg_match('/^--max-reads=([1-9][0-9]?)$/D', $argv[2], $match) !== 1 || (int)$match[1] > 50) throw new InvalidArgumentException('Read budget must be between 1 and 50.');
        $reads = (int)$match[1];
    }
    $result = ez_run_scheduled_payout_sync($reads);
    echo json_encode(['ok'=>$result['exitCode'] !== 1,'observedAt'=>gmdate(DATE_ATOM),...$result], JSON_THROW_ON_ERROR) . "\n";
    exit($result['exitCode']);
} catch (Throwable $error) {
    fwrite(STDERR,json_encode(['ok'=>false,'error'=>$error instanceof InvalidArgumentException?$error->getMessage():'Scheduled payout checks did not finish. Inspect the heartbeat, queue and private runner receipt.','mayPay'=>false],JSON_THROW_ON_ERROR)."\n");
    exit(1);
}
