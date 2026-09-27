<?php
declare(strict_types=1);
if (PHP_SAPI !== 'cli') { http_response_code(404); exit; }
require_once dirname(__DIR__, 2) . '/cart/api/commerce-payout-sync.php';
try {
    $input = [];
    foreach (array_slice($argv, 1) as $argument) {
        if (preg_match('/^--(environment|withdrawal|run|mode|max-pages|max-reads)=(.+)$/sD', $argument, $match) !== 1 || isset($input[$match[1]])) throw new InvalidArgumentException('Arguments must be named and unique.');
        $input[$match[1]] = $match[2];
    }
    foreach (['environment','withdrawal','run'] as $field) if (!isset($input[$field])) throw new InvalidArgumentException('Required: --environment=sandbox|production --withdrawal=wd_ID --run=32_HEX [--mode=collect|recover] [--max-pages=10] [--max-reads=20].');
    $pages = $input['max-pages'] ?? '10';
    if (preg_match('/^[1-9][0-9]?$/D', $pages) !== 1 || (int)$pages > 40) throw new InvalidArgumentException('Page budget must be between 1 and 40 per account.');
    $reads = $input['max-reads'] ?? '20';
    if (preg_match('/^[1-9][0-9]?$/D', $reads) !== 1 || (int)$reads > 50) throw new InvalidArgumentException('Read budget must be between 1 and 50 per invocation.');
    $result = ez_sync_withdrawal_payout($input['withdrawal'], $input['environment'], $input['run'], $input['mode'] ?? 'recover', (int)$pages, (int)$reads);
    echo json_encode(['ok'=>true,...$result], JSON_THROW_ON_ERROR) . "\n";
    exit($result['reconciled'] ? 0 : 2);
} catch (Throwable $error) {
    if ($error instanceof EzPayoutSyncReadBudget) {
        echo json_encode(['ok'=>true,'state'=>'incomplete','reason'=>'read_budget','providerCalls'=>$error->providerCalls,
            'reconciled'=>false,'payoutConfirmed'=>false,'mayPay'=>false], JSON_THROW_ON_ERROR) . "\n";
        exit(2);
    }
    $reason = $error instanceof InvalidArgumentException ? $error->getMessage() : 'Payout synchronization did not finish. Preserve the run ID and private evidence; recover this same run before starting another collection.';
    fwrite(STDERR, json_encode(['ok'=>false,'error'=>$reason,'mayPay'=>false], JSON_THROW_ON_ERROR) . "\n");
    exit(1);
}
