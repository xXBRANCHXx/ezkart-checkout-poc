<?php
declare(strict_types=1);
if (realpath((string) ($_SERVER['SCRIPT_FILENAME'] ?? '')) === __FILE__) { http_response_code(404); exit; }
require_once __DIR__ . '/commerce-treasury-bank.php';
require_once __DIR__ . '/commerce-payout-sync.php';

/** Bounded provider reads only. A retained run replays original private responses
 * before any new read; recovery mode never loads provider credentials or calls it.
 */
function ez_sync_treasury_observations(string $id, string $environment, string $run, string $mode, int $maxPages = 10, int $maxReads = 20, ?EzDokuSubAccountReader $client = null, ?callable $private = null): array
{
    if (preg_match('/^try_[a-f0-9]{40}$/D', $id) !== 1 || preg_match('/^[a-f0-9]{32}$/D', $run) !== 1
        || !in_array($mode, ['collect','recover'], true) || $maxPages < 1 || $maxPages > 40 || $maxReads < 1 || $maxReads > 84) throw new InvalidArgumentException('Treasury observation scope or budget is invalid.');
    ez_withdrawal_workbench($environment); $private ??= 'ez_commerce_request';
    if ($mode === 'collect' && ez_config('commerce_treasury_observations') !== 'enabled') throw new EzCommerceStorageException('Treasury provider observation collection is held.', 503);
    $path = '/internal/commerce/finance/treasury/' . $id;
    $scope = $private('POST', $path . '/observations/scope', ['environment'=>$environment]);
    $original = $scope['original'] ?? null;
    if (!is_array($original) || ($original['intentId'] ?? null) !== $id || ($original['environment'] ?? null) !== $environment
        || ($scope['mayPay'] ?? null) !== false || ($original['account']['cashAccount'] ?? null) !== ($original['binding']['fromAccount'] ?? null)) throw new RuntimeException('Original treasury observation scope was not confirmed.');
    $directory = ez_treasury_receipt_directory() . '/' . $id . '-observations-' . $run;
    $files = new EzPayoutSyncFiles($directory, $mode === 'collect');
    try {
        $intent = $files->read('intent.json');
        if ($intent === null) {
            if ($mode !== 'collect') throw new RuntimeException('This original observation run is missing.');
            $intent = ['version'=>1,'run'=>$run,'original'=>$original,'maxPages'=>$maxPages]; $files->save('intent.json', $intent);
        }
        if ($intent !== ['version'=>1,'run'=>$run,'original'=>$original,'maxPages'=>$maxPages]) throw new RuntimeException('Original treasury observation scope cannot change.');
        $reader = new EzPayoutSyncReader($files, $original, $mode === 'collect', $maxReads, null, true, $client);
        try {
            $status = $reader->transactionStatus($original['binding']['partnerReferenceNo']);
            $saved = $private('POST', $path . '/status/receipt', ['environment'=>$environment,'evidence'=>$status['evidence']]);
            if (($saved['recorded'] ?? null) !== true || ($saved['mayPay'] ?? null) !== false) throw new RuntimeException('Original status acknowledgement was not confirmed.');
            $boundary = $files->read('status-boundary.json');
            if ($boundary === null) {
                $history = $private('POST', $path . '/status/history', ['environment'=>$environment,'limit'=>1]);
                if (!is_int($history['cap'] ?? null) || $history['cap'] < 1) throw new RuntimeException('Status frontier is missing.');
                $boundary = ['statusCap'=>$history['cap'],'checkedAt'=>$history['status']['checkedAt']]; $files->save('status-boundary.json', $boundary);
            }
            $plan = $files->read('window-plan.json');
            if ($plan === null) {
                // Complete closed windows cover the original grant through this read.
                $from = gmdate('Y-m-d\TH:i:s\Z', (new DateTimeImmutable($original['grantedAt']))->getTimestamp() - 300);
                $to = gmdate('Y-m-d\TH:i:s\Z');
                if (new DateTimeImmutable($boundary['checkedAt']) > new DateTimeImmutable($to)) throw new RuntimeException('Status frontier is later than the completed history window.');
                $plan = ['windows'=>ez_payout_sync_windows($from, $to, $maxPages)]; $files->save('window-plan.json', $plan);
            }
            $account = $original['account']; $ids = [];
            $report = ez_observe_doku_financial_windows($reader, $account['profileId'], $plan['windows'], $maxPages,
                static function (string $kind, array $response) use ($private, $account, $environment, &$ids): void {
                    if ($kind !== 'history_page' && (($response['data']['accounts']['DOKU_MERCHANT_IDR']['accountNo'] ?? null) !== $account['cashAccount']
                        || ($response['data']['accounts']['DOKU_MERCHANT_PENDING_IDR']['accountNo'] ?? null) !== $account['pendingAccount'])) throw new RuntimeException('Provider read changed the original company accounts.');
                    // The reader has already committed these original bytes privately.
                    $r = $private('POST', '/internal/commerce/finance/provider-evidence', ['seller'=>$account['seller'],'environment'=>$environment,'evidence'=>$response['evidence']]);
                    if (!is_string($r['id'] ?? null) || preg_match('/^fobs_[a-f0-9]{40}$/D', $r['id']) !== 1) throw new RuntimeException('Provider observation acknowledgement was not confirmed.');
                    $ids[] = $r['id'];
                }, 20);
            $payload = ['seller'=>$account['seller'],'environment'=>$environment,'observationIds'=>$ids]; $files->save('collection.json', $payload);
            $collection = $private('POST', '/internal/commerce/finance/provider-collections', $payload)['collection'] ?? null;
            if (!is_array($collection) || ($collection['observationIds'] ?? null) !== $ids || !is_string($collection['id'] ?? null)
                || preg_match('/^fcol_[a-f0-9]{40}$/D', $collection['id']) !== 1 || ($collection['pagesExhausted'] ?? null) !== $report['pagesExhausted']) throw new RuntimeException('Original complete collection was not acknowledged.');
            $base = ['intentId'=>$id,'run'=>$run,'providerCalls'=>$reader->providerCalls,'mayPay'=>false,'payoutConfirmed'=>false,'sharedHistoryRefreshRequired'=>true];
            if (!$report['pagesExhausted']) return $base + ['state'=>'held','reason'=>'history_incomplete'];
            $input = ['environment'=>$environment,'collectionId'=>$collection['id'],'statusCap'=>$boundary['statusCap']]; $files->save('outcome-input.json', $input);
            $result = $private('POST', $path . '/outcome/reconcile', $input);
            if (($result['intentId'] ?? null) !== $id || ($result['mayPay'] ?? null) !== false || ($result['providerCalls'] ?? null) !== 0 || ($result['outcome']['payoutConfirmed'] ?? null) !== false) throw new RuntimeException('Treasury outcome acknowledgement was not confirmed.');
            if ($files->read('outcome-receipt.json') === null) $files->save('outcome-receipt.json', $result);
            // A saved assessment can become stale after new independent observations.
            $current = $private('POST', $path . '/outcome/read', ['environment'=>$environment]);
            return $base + ['state'=>'accounting_held','outcome'=>$current['outcome'],'collectionId'=>$collection['id'],'statusCap'=>$boundary['statusCap']];
        } catch (EzPayoutSyncReadBudget $e) {
            return ['intentId'=>$id,'run'=>$run,'state'=>'paused','reason'=>'read_budget','providerCalls'=>$e->providerCalls,'mayPay'=>false,'payoutConfirmed'=>false];
        }
    } finally { $files->release(); }
}
