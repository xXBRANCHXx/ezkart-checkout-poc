<?php
declare(strict_types=1);
if (PHP_SAPI !== 'cli') { http_response_code(404); exit; }
require_once dirname(__DIR__, 2) . '/cart/api/commerce-payouts.php';
try {
    $input = [];
    foreach (array_slice($argv, 1) as $argument) {
        if (preg_match('/^--(environment|withdrawal|seller-collection|platform-collection|status-cap)=(.+)$/sD', $argument, $match) !== 1 || isset($input[$match[1]])) throw new InvalidArgumentException('Arguments must be named and unique.');
        $input[$match[1]] = $match[2];
    }
    foreach (['environment','withdrawal','seller-collection','platform-collection','status-cap'] as $key) if (!isset($input[$key])) throw new InvalidArgumentException('Required: --environment=sandbox|production --withdrawal=wd_ID --seller-collection=fcol_ID --platform-collection=fcol_ID --status-cap=INTEGER.');
    if (preg_match('/^[1-9][0-9]{0,15}$/D', $input['status-cap']) !== 1 || (int)$input['status-cap'] > 9007199254740991) throw new InvalidArgumentException('Status boundary is invalid.');
    $result = ez_reconcile_withdrawal_payout($input['withdrawal'], ['environment'=>$input['environment'],
        'sellerCollectionId'=>$input['seller-collection'],'platformCollectionId'=>$input['platform-collection'],'statusCap'=>(int)$input['status-cap']]);
    echo json_encode(['ok'=>true,'assessmentId'=>$result['recorded']['id'],'state'=>$result['recorded']['state'],
        'reason'=>$result['recorded']['reason'],'journalId'=>$result['recorded']['journalId'],'replayed'=>$result['replayed'],
        'outcome'=>$result['outcome'],'providerCalls'=>0,'mayPay'=>false], JSON_THROW_ON_ERROR) . "\n";
    exit($result['outcome']['reconciled'] ? 0 : 2);
} catch (Throwable $error) {
    $reason = $error instanceof InvalidArgumentException ? $error->getMessage() : 'Payout reconciliation did not finish. Retain the original collection IDs and status boundary.';
    fwrite(STDERR, json_encode(['ok'=>false,'error'=>$reason], JSON_THROW_ON_ERROR) . "\n");
    exit(1);
}
