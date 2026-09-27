<?php
declare(strict_types=1);
if (realpath((string) ($_SERVER['SCRIPT_FILENAME'] ?? '')) === __FILE__) { http_response_code(404); exit; }

function ez_payout_sync_review_reason(array $assessment, array $required): string
{
    $reason = $assessment['reason'] ?? 'provider_review';
    if ($reason !== 'incomplete_or_duplicate_legs') return $reason;
    $counts = array_count_values(array_column($assessment['source']['legs'] ?? [], 'leg'));
    foreach ($required as $leg) if (($counts[$leg] ?? 0) > 1) return $reason;
    foreach ($required as $leg) if (($counts[$leg] ?? 0) === 0) return 'provider_legs_missing';
    return $reason;
}

/** Collect a shared platform once and reconcile every covered original pair.
 * Called with an authenticated original scope and an exclusively locked run.
 */
function ez_payout_sync_cohort(EzPayoutSyncFiles $files, EzPayoutSyncReader $reader, array $intent, ?Closure $heartbeat = null): array
{
    $original = $intent['original']; $environment = $original['environment']; $id = $original['withdrawalId'];
    $root = '/internal/commerce/finance/withdrawals/';
    $plan = $intent['plan']; $reviews = []; $boundaries = []; $responses = 0; $collections = [];
    $withdrawals = [['withdrawalId'=>$id,'sellerEnrollmentId'=>$original['sellerAccount']['enrollmentId']], ...$plan['withdrawals']];
    $wallets = array_column($plan['wallets'], null, 'enrollmentId');
    foreach ($withdrawals as $withdrawal) {
        if ($heartbeat !== null) $heartbeat();
        $wid = $withdrawal['withdrawalId'];
        $payment = ez_payout_sync_request($root . $wid . '/payment/read', ['environment'=>$environment]);
        if (($payment['binding']['environment'] ?? null) !== $environment || ($payment['clientId'] ?? null) !== $original['clientId']
            || ($payment['binding']['credentialFingerprint'] ?? null) !== $original['binding']['credentialFingerprint']
            || ($payment['binding']['fromAccount'] ?? null) !== ($wallets[$withdrawal['sellerEnrollmentId']]['cashAccount'] ?? null)
            || ($payment['feeAccount']['enrollmentId'] ?? null) !== $original['platformAccount']['enrollmentId'])
            throw new RuntimeException('Shared payout differs from its original account scope.');
        $scope = ['binding'=>$payment['binding'],'confirmationId'=>$payment['confirmationId']];
        $files->save('payment-' . $wid . '.json', $scope);
        try { $status = $reader->transactionStatus($payment['binding']['partnerReferenceNo']); }
        catch (EzDokuReadException) {
            $reviews[] = ['kind'=>'status','id'=>$wid,'reason'=>'provider_read_failed']; continue;
        }
        try {
            ez_finalize_withdrawal_status(['version'=>1,'withdrawalId'=>$wid,'environment'=>$environment,
                'confirmationId'=>$scope['confirmationId'],'binding'=>$scope['binding'],'evidence'=>$status['evidence']]);
        } catch (EzCommerceStorageException $error) {
            if (!in_array($error->httpStatus, [409,422], true)) throw $error;
            $reviews[] = ['kind'=>'status','id'=>$wid,'reason'=>'invalid_provider_status']; continue;
        }
        $name = 'status-' . $wid . '-boundary.json'; $boundary = $files->read($name);
        if ($boundary === null) {
            $history = ez_payout_sync_request($root . $wid . '/payment/status/history', ['environment'=>$environment,'limit'=>1]);
            if (!is_int($history['cap'] ?? null) || $history['cap'] < 1 || !is_string($history['status']['checkedAt'] ?? null)) throw new RuntimeException('Status boundary was not confirmed.');
            $boundary = ['statusCap'=>$history['cap'],'checkedAt'=>$history['status']['checkedAt']]; $files->save($name, $boundary);
        }
        $boundaries[$wid] = $boundary;
    }
    $window = $files->read('window.json');
    if ($window === null) {
        $window = ['from'=>$plan['from'],'to'=>gmdate('Y-m-d\TH:i:s\Z')];
        foreach ($boundaries as $boundary) if (new DateTimeImmutable($boundary['checkedAt']) > new DateTimeImmutable($window['to']))
            throw new RuntimeException('The status observation is outside a completed history window.');
        EzDokuSubAccountReader::window($window['from'], $window['to']); $files->save('window.json', $window);
    }
    foreach ($plan['wallets'] as $account) {
        $ids = []; $enrollment = $account['enrollmentId'];
        try {
            $report = ez_observe_doku_financial_window($reader, $account['profileId'], $window['from'], $window['to'], $intent['maxPages'],
                static function (string $kind, array $response) use ($files, $account, $environment, &$ids, &$responses): void {
                    if ($kind !== 'history_page') {
                        $numbers = $response['data']['accounts'] ?? [];
                        if (($numbers['DOKU_MERCHANT_IDR']['accountNo'] ?? null) !== $account['cashAccount']
                            || ($numbers['DOKU_MERCHANT_PENDING_IDR']['accountNo'] ?? null) !== $account['pendingAccount']) throw new RuntimeException('Observed account differs from the original scope.');
                    }
                    $payload = ['seller'=>$account['seller'],'environment'=>$environment,'evidence'=>$response['evidence']];
                    $files->save('observation-' . str_pad((string) ++$responses, 4, '0', STR_PAD_LEFT) . '.json', $payload);
                    $saved = ez_payout_sync_request('/internal/commerce/finance/provider-evidence', $payload);
                    if (!is_string($saved['id'] ?? null) || preg_match('/^fobs_[a-f0-9]{40}$/D', $saved['id']) !== 1) throw new RuntimeException('Observation acknowledgement was not confirmed.');
                    $ids[] = $saved['id'];
                }, 20);
            $payload = ['seller'=>$account['seller'],'environment'=>$environment,'observationIds'=>$ids];
            $files->save('collection-' . $enrollment . '.json', $payload);
            $collection = ez_record_provider_collection($payload);
            if ($collection['pagesExhausted'] !== $report['pagesExhausted']) throw new RuntimeException('Collection coverage differs from original responses.');
            if (!$collection['pagesExhausted']) { $reviews[] = ['kind'=>'history','id'=>$enrollment,'reason'=>'history_incomplete']; continue; }
            $collections[$enrollment] = $collection['id'];
        } catch (EzDokuReadException) {
            $reviews[] = ['kind'=>'history','id'=>$enrollment,'reason'=>'provider_read_failed'];
        }
    }
    $platform = $collections[$original['platformAccount']['enrollmentId']] ?? null;
    $inputs = ['payouts'=>[],'settlements'=>[]];
    foreach ($withdrawals as $w) if ($platform !== null && isset($collections[$w['sellerEnrollmentId']], $boundaries[$w['withdrawalId']])) {
        $inputs['payouts'][] = ['withdrawalId'=>$w['withdrawalId'],'input'=>['environment'=>$environment,
            'sellerCollectionId'=>$collections[$w['sellerEnrollmentId']],'platformCollectionId'=>$platform,'statusCap'=>$boundaries[$w['withdrawalId']]['statusCap']]];
    }
    foreach ($plan['settlements'] as $o) if ($platform !== null && isset($collections[$o['sellerEnrollmentId']])) {
        $inputs['settlements'][] = ['environment'=>$environment,'seller'=>$o['seller'],'orderId'=>$o['orderId'],
            'sellerCollectionId'=>$collections[$o['sellerEnrollmentId']],'platformCollectionId'=>$platform];
    }
    $files->save('cohort-inputs.json', $inputs);
    // Keep the target input available to existing private recovery tooling.
    foreach ($inputs['payouts'] as $payout) {
        if ($heartbeat !== null) $heartbeat();
        $wid = $payout['withdrawalId'];
        if ($wid === $id) $files->save('payout-input.json', $payout['input']);
        try {
            $result = ez_reconcile_withdrawal_payout($wid, $payout['input']);
            if (!$result['outcome']['reconciled']) $reviews[] = ['kind'=>'payout','id'=>$wid,
                'reason'=>ez_payout_sync_review_reason($result['recorded'], ['payout','fee'])];
        } catch (EzCommerceStorageException $error) {
            if ($error->httpStatus !== 409) throw $error;
            $reviews[] = ['kind'=>'payout','id'=>$wid,'reason'=>'sources_changed_or_incomplete'];
        }
    }
    foreach ($inputs['settlements'] as $input) {
        if ($heartbeat !== null) $heartbeat();
        try {
            $settled = ez_reconcile_provider_settlement($input);
            if (!$settled['settlementVerified']) $reviews[] = ['kind'=>'settlement','id'=>$input['orderId'],
                'reason'=>ez_payout_sync_review_reason($settled['recorded'], ['payment','fee','seller_credit','platform_credit'])];
            $earnings = ez_payout_sync_request('/internal/commerce/finance/earnings/reconcile', ['environment'=>$environment,'seller'=>$input['seller'],'orderId'=>$input['orderId'],'limit'=>1]);
            if (($earnings['caughtUp'] ?? null) !== true) $reviews[] = ['kind'=>'earnings','id'=>$input['orderId'],'reason'=>'reconciliation_required'];
        } catch (EzCommerceStorageException $error) {
            if ($error->httpStatus !== 409) throw $error;
            $reviews[] = ['kind'=>'settlement','id'=>$input['orderId'],'reason'=>'sources_changed_or_incomplete'];
        }
    }
    $current = ez_payout_sync_request($root . $id . '/payout/read', ['environment'=>$environment]);
    $latest = ez_payout_sync_request($root . $id . '/payout/sync-scope', ['environment'=>$environment]);
    $shared = $latest['sharedHistoryReview'];
    $done = ($current['outcome']['reconciled'] ?? false) && !$reviews && !$plan['truncated'] && $shared['settlements'] === 0 && $shared['payouts'] === 0;
    return ['withdrawalId'=>$id,'environment'=>$environment,'run'=>$intent['run'],'providerCalls'=>$reader->providerCalls,'responses'=>$responses,
        'pagesExhausted'=>count($collections) === count($plan['wallets']),'mayPay'=>false,'state'=>$done?'synchronized':'review',
        'reason'=>$done?'reconciled':(in_array('history_incomplete',array_column($reviews,'reason'),true)?'history_incomplete':'reconciliation_required'),
        'reconciled'=>$done,'payoutConfirmed'=>$current['outcome']['payoutConfirmed'] ?? false,'outcome'=>$current['outcome'],
        'relatedReviews'=>$reviews,'sharedHistoryReview'=>$shared,'planTruncated'=>$plan['truncated'],
        'coveredWithdrawals'=>array_column($inputs['payouts'],'withdrawalId'),'coveredOrders'=>array_column($inputs['settlements'],'orderId')];
}
