<?php
declare(strict_types=1);
if (PHP_SAPI !== 'cli') { http_response_code(404); exit; }
require_once dirname(__DIR__, 2) . '/cart/api/commerce-settlements.php';
try {
    $input = [];
    foreach (array_slice($argv, 1) as $argument) {
        if (preg_match('/^--(environment|seller|order|seller-collection|platform-collection)=(.+)$/sD', $argument, $match) !== 1 || isset($input[$match[1]])) throw new InvalidArgumentException('Arguments must be named and unique.');
        $input[$match[1]] = $match[2];
    }
    foreach (['environment','seller','order','seller-collection','platform-collection'] as $field) if (!isset($input[$field])) throw new InvalidArgumentException('Required: --environment=sandbox|production --seller=ID --order=ID --seller-collection=fcol_ID --platform-collection=fcol_ID.');
    if (preg_match('/^[A-Za-z0-9][A-Za-z0-9_-]{2,95}$/D', $input['seller']) !== 1 || preg_match('/^EZK-[SP]-[A-F0-9]{24}$/D', $input['order']) !== 1
        || preg_match('/^fcol_[a-f0-9]{40}$/D', $input['seller-collection']) !== 1 || preg_match('/^fcol_[a-f0-9]{40}$/D', $input['platform-collection']) !== 1) throw new InvalidArgumentException('Settlement scope or collection IDs are invalid.');
    $deployment = ez_config('deployment_environment');
    if (!(($deployment === 'test' && $input['environment'] === 'sandbox') || ($deployment === 'beta' && $input['environment'] === 'production'))) throw new InvalidArgumentException('Settlement reconciliation accepts TEST/sandbox or beta/production only.');
    ez_central_commerce_environment($input['environment']);
    $result = ez_reconcile_provider_settlement(['seller'=>$input['seller'],'environment'=>$input['environment'],'orderId'=>$input['order'],
        'sellerCollectionId'=>$input['seller-collection'],'platformCollectionId'=>$input['platform-collection']]);
    echo json_encode(['ok'=>true,'assessmentId'=>$result['recorded']['id'],'state'=>$result['recorded']['state'],
        'reason'=>$result['recorded']['reason'],'journalId'=>$result['recorded']['journalId'],'replayed'=>$result['replayed'],
        'settlementVerified'=>$result['settlementVerified'],'holds'=>$result['holds'],'earningsReleased'=>false,'availableToWithdraw'=>null], JSON_THROW_ON_ERROR) . "\n";
    exit($result['settlementVerified'] ? 0 : 2);
} catch (Throwable $error) {
    $reason = $error instanceof InvalidArgumentException ? $error->getMessage() : 'Settlement reconciliation did not finish. Retain the original collection IDs and reconcile those provider records.';
    fwrite(STDERR, json_encode(['ok'=>false,'error'=>$reason], JSON_THROW_ON_ERROR) . "\n");
    exit(1);
}
