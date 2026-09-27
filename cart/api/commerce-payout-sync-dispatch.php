<?php
declare(strict_types=1);
if (realpath((string) ($_SERVER['SCRIPT_FILENAME'] ?? '')) === __FILE__) { http_response_code(404); exit; }
require_once __DIR__ . '/commerce-payout-sync.php';

/** One bounded pass. No generic payment/wallet job can be claimed here. */
function ez_dispatch_payout_sync(int $maxReads = 20): array
{
    $environment = ez_central_commerce_environment(); ez_withdrawal_workbench($environment);
    if ($maxReads < 1 || $maxReads > 50) throw new InvalidArgumentException('Read budget must be between 1 and 50.');
    if (ez_config('commerce_withdrawal_sync') !== 'enabled') return ['held'=>true,'processed'=>0,'mayPay'=>false];
    $directory = ez_withdrawal_receipt_directory(); $storage = ez_config('commerce_withdrawal_sync_storage');
    if (preg_match('/^[A-Za-z0-9_-]{3,100}$/D', $storage) !== 1) throw new RuntimeException('The private receipt storage identity is required.');
    $base = '/internal/commerce/finance/payout-sync/';
    $scheduled = ez_payout_sync_request($base . 'schedule', ['environment'=>$environment,'limit'=>4]);
    if (($scheduled['held'] ?? null) === true) return ['held'=>true,'processed'=>0,'mayPay'=>false];
    $worker = 'payout_sync_' . bin2hex(random_bytes(12)); $claim = bin2hex(random_bytes(16));
    $claimed = ez_payout_sync_request($base . 'claim', ['environment'=>$environment,'workerId'=>$worker,'storageId'=>$storage,'claimKey'=>$claim]);
    $job = $claimed['job'] ?? null;
    if ($job === null) return ['held'=>false,'queued'=>$scheduled['queued'],'processed'=>0,'mayPay'=>false];
    if (($job['environment'] ?? null) !== $environment || ($job['storageId'] ?? null) !== $storage || ($job['leaseToken'] ?? null) !== $claim
        || ($job['state'] ?? null) !== 'running' || !is_string($job['id'] ?? null) || preg_match('/^[a-f0-9]{32}$/D', $job['id']) !== 1
        || !is_string($job['withdrawalId'] ?? null) || preg_match('/^wd_[a-f0-9]{40}$/D', $job['withdrawalId']) !== 1
        || !is_int($job['maxPages'] ?? null) || $job['maxPages'] < 1 || $job['maxPages'] > 40) throw new RuntimeException('Synchronization lease was not confirmed.');
    $lease = ['environment'=>$environment,'id'=>$job['id'],'workerId'=>$worker,'storageId'=>$storage,'leaseToken'=>$claim];
    $renewAt = 0;
    $heartbeat = static function () use ($base, $lease, &$renewAt): void {
        if (time() < $renewAt) return;
        $saved = ez_payout_sync_request($base . 'heartbeat', $lease);
        if (($saved['id'] ?? null) !== $lease['id'] || ($saved['mayPay'] ?? null) !== false) throw new RuntimeException('Synchronization lease renewal was not confirmed.');
        $renewAt = time() + 30;
    };
    $empty = ['providerCalls'=>null,'coveredWithdrawals'=>[],'coveredOrders'=>[],'reviewReasons'=>[],
        'planTruncated'=>false,'sharedHistoryReview'=>['settlements'=>0,'payouts'=>0]];
    try {
        $heartbeat();
        $result = ez_sync_withdrawal_payout($job['withdrawalId'], $environment, $job['id'], 'collect', $job['maxPages'], $maxReads, $heartbeat);
        $summary = ['state'=>$result['state'],'reason'=>$result['reason'],'providerCalls'=>$result['providerCalls'],
            'coveredWithdrawals'=>$result['coveredWithdrawals'] ?? [],'coveredOrders'=>$result['coveredOrders'] ?? [],
            'reviewReasons'=>array_values(array_unique(array_column($result['relatedReviews'] ?? [],'reason'))),
            'planTruncated'=>$result['planTruncated'] ?? false,'sharedHistoryReview'=>$result['sharedHistoryReview'] ?? ['settlements'=>0,'payouts'=>0]];
    } catch (EzPayoutSyncReadBudget $error) {
        $summary = [...$empty,'state'=>'incomplete','reason'=>'read_budget','providerCalls'=>$error->providerCalls];
    } catch (Throwable) {
        $summary = [...$empty,'state'=>'error','reason'=>'sync_failed'];
    }
    $payload = [...$lease,'result'=>$summary];
    // Keep a lost finish acknowledgement recoverable independently of provider
    // evidence. Only this exact lease result may be replayed.
    $files = new EzPayoutSyncFiles($directory . '/' . $job['withdrawalId'] . '-sync-' . $job['id'], true);
    $files->save('queue-finish-' . $claim . '.json', $payload);
    $saved = ez_payout_sync_request($base . 'finish', $payload);
    if (($saved['job']['id'] ?? null) !== $job['id'] || ($saved['mayPay'] ?? null) !== false) throw new RuntimeException('Synchronization completion was not confirmed.');
    return ['held'=>false,'queued'=>$scheduled['queued'],'processed'=>1,'run'=>$job['id'],'state'=>$saved['job']['state'],
        'providerCalls'=>$summary['providerCalls'],'mayPay'=>false];
}
