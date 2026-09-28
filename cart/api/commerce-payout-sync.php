<?php
declare(strict_types=1);
if (realpath((string) ($_SERVER['SCRIPT_FILENAME'] ?? '')) === __FILE__) { http_response_code(404); exit; }
require_once __DIR__ . '/commerce-withdrawal-status.php';
require_once __DIR__ . '/commerce-provider-evidence.php';
require_once __DIR__ . '/commerce-payouts.php';
require_once __DIR__ . '/commerce-settlements.php';
require_once __DIR__ . '/commerce-payout-cohort.php';

/** One private run, one process, immutable atomic files. No credentials stored. */
final class EzPayoutSyncFiles
{
    private $lock;
    public function __construct(private readonly string $directory, bool $create)
    {
        if (!file_exists($directory) && $create) {
            $mask = umask(0077);
            try { if (!@mkdir($directory, 0700) && !is_dir($directory)) throw new RuntimeException('Synchronization storage is unavailable.'); }
            finally { umask($mask); }
        }
        if (!is_dir($directory) || is_link($directory) || (fileperms($directory) & 0077) !== 0) throw new RuntimeException('Private synchronization storage is required.');
        $file = $directory . '/lock';
        if (file_exists($file) || is_link($file)) $this->checkFile($file, 0, 0);
        $mask = umask(0077);
        try { $this->lock = @fopen($file, 'c+b'); }
        finally { umask($mask); }
        if ($this->lock === false || !flock($this->lock, LOCK_EX | LOCK_NB)) throw new RuntimeException('This synchronization run is already active.');
        $this->checkFile($file, 0, 0);
    }
    public function __destruct()
    {
        $this->release();
    }
    public function release(): void
    {
        if (is_resource($this->lock)) { flock($this->lock, LOCK_UN); fclose($this->lock); }
    }
    private function checkFile(string $file, int $minimum = 2, int $maximum = 4200000): void
    {
        clearstatcache(true, $file);
        if (!is_file($file) || is_link($file) || (fileperms($file) & 0077) !== 0 || filesize($file) < $minimum || filesize($file) > $maximum)
            throw new RuntimeException('Synchronization evidence requires review.');
    }
    private function path(string $name): string
    {
        if (preg_match('/^[a-z][a-z0-9_-]{0,100}\.json$/D', $name) !== 1) throw new RuntimeException('Synchronization evidence name is invalid.');
        return $this->directory . '/' . $name;
    }
    public function read(string $name): ?array
    {
        $file = $this->path($name);
        if (!file_exists($file) && !is_link($file)) return null;
        $this->checkFile($file);
        $raw = file_get_contents($file);
        if (!is_string($raw)) throw new RuntimeException('Synchronization evidence could not be read.');
        EzDokuFinancialJson::decode($raw);
        $value = json_decode($raw, true, 64, JSON_THROW_ON_ERROR);
        if (!is_array($value)) throw new RuntimeException('Synchronization evidence is invalid.');
        return $value;
    }
    public function save(string $name, array $value): void
    {
        $previous = $this->read($name);
        if ($previous !== null) {
            if ($previous !== $value) throw new RuntimeException('Original synchronization evidence cannot change.');
            return;
        }
        $raw = json_encode($value, JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE | JSON_THROW_ON_ERROR) . "\n";
        if (strlen($raw) > 4200000) throw new RuntimeException('Synchronization evidence is too large.');
        $file = $this->path($name); $temporary = $file . '.' . bin2hex(random_bytes(12)) . '.tmp';
        $mask = umask(0077);
        try { $stream = @fopen($temporary, 'xb'); }
        finally { umask($mask); }
        if ($stream === false) throw new RuntimeException('Synchronization evidence cannot be saved.');
        try {
            for ($offset = 0; $offset < strlen($raw); $offset += $written) {
                $written = fwrite($stream, substr($raw, $offset));
                if (!is_int($written) || $written < 1) throw new RuntimeException('Synchronization evidence was not fully written.');
            }
            if (!fflush($stream) || (function_exists('fsync') && !fsync($stream))) throw new RuntimeException('Synchronization evidence was not flushed.');
            // link is atomic and cannot replace a pre-existing original file.
            if (!@link($temporary, $file)) throw new RuntimeException('Synchronization evidence cannot be committed.');
        } finally { fclose($stream); @unlink($temporary); }
    }
}

/** Replay typed responses in their original order; only collect fills gaps. */
final class EzPayoutSyncReadBudget extends RuntimeException
{
    public function __construct(public readonly int $providerCalls) { parent::__construct('The provider read budget was reached; resume this same run.'); }
}

final class EzPayoutSyncReader implements EzDokuFinancialReader
{
    private int $step = 0;
    public int $providerCalls = 0;
    private ?EzDokuSubAccountReader $live = null;
    public function __construct(private readonly EzPayoutSyncFiles $files, private readonly array $original, private readonly bool $collect,
        private readonly int $maxReads = 20, private readonly ?Closure $heartbeat = null, private readonly bool $retainFailures = false, ?EzDokuSubAccountReader $reader = null) { $this->live = $reader; }
    private function read(string $operation, array $request, Closure $call): array
    {
        if ($this->heartbeat !== null) ($this->heartbeat)();
        $name = 'read-' . str_pad((string) ++$this->step, 4, '0', STR_PAD_LEFT) . '.json';
        $saved = $this->files->read($name);
        if ($saved !== null && (($saved['operation'] ?? null) !== $operation || ($saved['request'] ?? null) !== $request))
            throw new RuntimeException('Saved provider response differs from the original read.');
        if (isset($saved['failure'])) {
            if (!$this->retainFailures || !is_string($saved['failure']['reason'] ?? null) || preg_match('/^[a-z_]{1,64}$/D', $saved['failure']['reason']) !== 1
                || !is_int($saved['failure']['status'] ?? null)) throw new RuntimeException('Saved provider failure is invalid.');
            throw new EzDokuReadException($saved['failure']['reason'], $saved['failure']['status']);
        }
        if ($saved === null) {
            if (!$this->collect) throw new RuntimeException('Recovery has reached an unsaved provider read. Resume collection explicitly.');
            if ($this->providerCalls >= $this->maxReads) throw new EzPayoutSyncReadBudget($this->providerCalls);
            $this->live ??= EzDokuSubAccountReader::configured($this->original['environment']);
            $identity = $this->live->providerIdentity();
            if ($identity !== ['environment'=>$this->original['environment'], 'clientId'=>$this->original['clientId'], 'credentialFingerprint'=>$this->original['binding']['credentialFingerprint']])
                throw new RuntimeException('Configured provider differs from the original payout.');
            $this->providerCalls++;
            try { $response = $call($this->live); }
            catch (EzDokuReadException $error) {
                if ($this->retainFailures) $this->files->save($name, ['operation'=>$operation,'request'=>$request,
                    'failure'=>['reason'=>$error->reason,'status'=>$error->providerStatus]]);
                throw $error;
            }
            $saved = ['operation'=>$operation, 'request'=>$request, 'response'=>$response];
            // Save the original response before D1 delivery or another read.
            $this->files->save($name, $saved);
        }
        $evidence = $saved['response']['evidence'] ?? null;
        if (($saved['operation'] ?? null) !== $operation || ($saved['request'] ?? null) !== $request || !is_array($saved['response']['data'] ?? null)
            || !is_array($evidence) || ($evidence['operation'] ?? null) !== $operation
            || ($evidence['environment'] ?? null) !== $this->original['environment']
            || ($evidence['credentialFingerprint'] ?? null) !== $this->original['binding']['credentialFingerprint']
            || ($evidence['requestBody'] ?? null) !== json_encode($request, JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE | JSON_THROW_ON_ERROR))
            throw new RuntimeException('Saved provider response differs from the original read.');
        return $saved['response'];
    }
    public function transactionStatus(string $reference): array
    {
        return $this->read('transactions-status', ['partnerReferenceNo'=>$reference], static fn($reader)=>$reader->transactionStatus($reference));
    }
    public function balances(string $profileId): array
    {
        return $this->read('balance-inquiries', ['profileId'=>$profileId], static fn($reader)=>$reader->balances($profileId));
    }
    public function historyPage(string $accountNo, string $from, string $to, int $page = 0, int $size = 100): array
    {
        return $this->read('transaction-history-list', ['accountNo'=>$accountNo,'fromDateTime'=>$from,'toDateTime'=>$to,'pageSize'=>(string)$size,'pageNumber'=>(string)$page],
            static fn($reader)=>$reader->historyPage($accountNo, $from, $to, $page, $size));
    }
}

function ez_payout_sync_request(string $path, array $body): array
{
    try { return ez_commerce_request('POST', $path, $body); }
    catch (EzCommerceStorageException $error) {
        if ($error->httpStatus < 500) throw $error;
        return ez_commerce_request('POST', $path, $body);
    }
}

/** Read-only at DOKU. Recovery uses no provider credentials or network requests. */
function ez_sync_withdrawal_payout(string $id, string $environment, string $run, string $mode = 'recover', int $maxPages = 10,
    int $maxReads = 20, ?Closure $heartbeat = null): array
{
    if (preg_match('/^wd_[a-f0-9]{40}$/D', $id) !== 1 || preg_match('/^[a-f0-9]{32}$/D', $run) !== 1
        || !in_array($mode, ['collect','recover'], true) || $maxPages < 1 || $maxPages > 40 || $maxReads < 1 || $maxReads > 50)
        throw new InvalidArgumentException('Synchronization scope, mode or read/page budget is invalid.');
    ez_withdrawal_workbench($environment);
    if ($mode === 'collect' && ez_config('commerce_withdrawal_sync') !== 'enabled') throw new RuntimeException('Payout provider synchronization is held.');
    $files = new EzPayoutSyncFiles(ez_withdrawal_receipt_directory() . '/' . $id . '-sync-' . $run, $mode === 'collect');
    try {
    $path = '/internal/commerce/finance/withdrawals/' . $id;
    $scope = ez_payout_sync_request($path . '/payout/sync-scope', ['environment'=>$environment]);
    if (($scope['original']['withdrawalId'] ?? null) !== $id || ($scope['original']['environment'] ?? null) !== $environment
        || ($scope['mayPay'] ?? null) !== false || ($scope['providerCalls'] ?? null) !== 0) throw new RuntimeException('Original payout scope was not confirmed.');
    $intent = $files->read('intent.json');
    if ($intent === null) {
        if ($mode !== 'collect') throw new RuntimeException('The original synchronization intent is missing.');
        ez_payout_sync_windows($scope['plan']['from'], gmdate('Y-m-d\TH:i:s\Z'), $maxPages);
        $intent = ['version'=>3,'run'=>$run,'original'=>$scope['original'],'plan'=>$scope['plan'],'maxPages'=>$maxPages];
        $files->save('intent.json', $intent);
    }
    if (!in_array($intent['version'] ?? null, [1,2,3], true) || ($intent['run'] ?? null) !== $run || ($intent['original'] ?? null) !== $scope['original']
        || ($intent['maxPages'] ?? null) !== $maxPages) throw new RuntimeException('The original synchronization scope cannot change.');
    $original = $intent['original'];
    $reader = new EzPayoutSyncReader($files, $original, $mode === 'collect', $maxReads, $heartbeat, $intent['version'] >= 2);
    if ($intent['version'] >= 2) return ez_payout_sync_cohort($files, $reader, $intent, $heartbeat);
    $status = $reader->transactionStatus($original['binding']['partnerReferenceNo']);
    ez_finalize_withdrawal_status(['version'=>1,'withdrawalId'=>$id,'environment'=>$environment,'confirmationId'=>$original['confirmationId'],
        'binding'=>$original['binding'],'evidence'=>$status['evidence']]);
    $boundary = $files->read('status-boundary.json');
    if ($boundary === null) {
        $history = ez_payout_sync_request($path . '/payment/status/history', ['environment'=>$environment,'limit'=>1]);
        if (!is_int($history['cap'] ?? null) || $history['cap'] < 1 || !is_string($history['status']['checkedAt'] ?? null)) throw new RuntimeException('Status boundary was not confirmed.');
        $boundary = ['statusCap'=>$history['cap'],'checkedAt'=>$history['status']['checkedAt']];
        $files->save('status-boundary.json', $boundary);
    }
    $window = $files->read('window.json');
    if ($window === null) {
        $window = ['from'=>$intent['plan']['from'],'to'=>gmdate('Y-m-d\TH:i:s\Z')];
        if (new DateTimeImmutable($boundary['checkedAt']) > new DateTimeImmutable($window['to'])) throw new RuntimeException('The status observation is outside a completed history window.');
        EzDokuSubAccountReader::window($window['from'], $window['to']);
        $files->save('window.json', $window);
    }
    $collections = []; $responses = 0; $complete = true;
    foreach (['sellerAccount','platformAccount'] as $pocket) {
        $account = $original[$pocket]; $ids = [];
        $report = ez_observe_doku_financial_window($reader, $account['profileId'], $window['from'], $window['to'], $maxPages,
            static function (string $kind, array $response) use ($files, $account, $environment, &$ids, &$responses): void {
                if ($kind !== 'history_page') {
                    $numbers = $response['data']['accounts'] ?? [];
                    if (($numbers['DOKU_MERCHANT_IDR']['accountNo'] ?? null) !== $account['cashAccount']
                        || ($numbers['DOKU_MERCHANT_PENDING_IDR']['accountNo'] ?? null) !== $account['pendingAccount']) throw new RuntimeException('Observed account differs from the original payout.');
                }
                $payload = ['seller'=>$account['seller'],'environment'=>$environment,'evidence'=>$response['evidence']];
                $files->save('observation-' . str_pad((string) ++$responses, 4, '0', STR_PAD_LEFT) . '.json', $payload);
                $saved = ez_payout_sync_request('/internal/commerce/finance/provider-evidence', $payload);
                if (!is_string($saved['id'] ?? null) || preg_match('/^fobs_[a-f0-9]{40}$/D', $saved['id']) !== 1) throw new RuntimeException('Observation acknowledgement was not confirmed.');
                $ids[] = $saved['id'];
            }, 20);
        $payload = ['seller'=>$account['seller'],'environment'=>$environment,'observationIds'=>$ids];
        $files->save(strtolower($pocket) . '-collection.json', $payload);
        $collection = ez_record_provider_collection($payload);
        if ($collection['pagesExhausted'] !== $report['pagesExhausted']) throw new RuntimeException('Collection coverage differs from the original responses.');
        $collections[$pocket] = $collection['id']; $complete = $complete && $collection['pagesExhausted'];
    }
    $base = ['withdrawalId'=>$id,'environment'=>$environment,'run'=>$run,'providerCalls'=>$reader->providerCalls,'responses'=>$responses,
        'pagesExhausted'=>$complete,'mayPay'=>false];
    if (!$complete) return [...$base,'state'=>'review','reason'=>'history_incomplete','payoutConfirmed'=>false,'reconciled'=>false];
    $sources = ['environment'=>$environment,'sellerCollectionId'=>$collections['sellerAccount'],'platformCollectionId'=>$collections['platformAccount']];
    $files->save('payout-input.json', [...$sources,'statusCap'=>$boundary['statusCap']]);
    $reviews = [];
    try { $result = ez_reconcile_withdrawal_payout($id, [...$sources,'statusCap'=>$boundary['statusCap']]); }
    catch (EzCommerceStorageException $error) {
        if ($error->httpStatus !== 409) throw $error;
        $reviews[] = ['kind'=>'payout','id'=>$id,'reason'=>'sources_changed_or_incomplete'];
        $result = ez_payout_sync_request($path . '/payout/read', ['environment'=>$environment]);
    }
    foreach ($intent['plan']['settlements'] as $order) {
        try {
            $settled = ez_reconcile_provider_settlement([...$sources,...$order]);
            if (!$settled['settlementVerified']) $reviews[] = ['kind'=>'settlement','id'=>$order['orderId'],'reason'=>'provider_review'];
            $earnings = ez_payout_sync_request('/internal/commerce/finance/earnings/reconcile', ['environment'=>$environment,...$order,'limit'=>1]);
            if (($earnings['caughtUp'] ?? null) !== true) $reviews[] = ['kind'=>'earnings','id'=>$order['orderId'],'reason'=>'reconciliation_required'];
        } catch (EzCommerceStorageException $error) {
            if ($error->httpStatus !== 409) throw $error;
            $reviews[] = ['kind'=>'settlement','id'=>$order['orderId'],'reason'=>'sources_changed_or_incomplete'];
        }
    }
    foreach ($intent['plan']['withdrawals'] as $withdrawal) {
        try {
            $other = ez_reconcile_withdrawal_payout($withdrawal['withdrawalId'], [...$sources,'statusCap'=>$withdrawal['statusCap']]);
            if (!$other['outcome']['reconciled']) $reviews[] = ['kind'=>'payout','id'=>$withdrawal['withdrawalId'],'reason'=>'provider_review'];
        } catch (EzCommerceStorageException $error) {
            if ($error->httpStatus !== 409) throw $error;
            $reviews[] = ['kind'=>'payout','id'=>$withdrawal['withdrawalId'],'reason'=>'sources_changed_or_incomplete'];
        }
    }
    // Re-read current outcomes: later independent evidence may have arrived
    // during reconciliation. Report remaining shared-wallet work explicitly.
    $current = ez_payout_sync_request($path . '/payout/read', ['environment'=>$environment]);
    $latest = ez_payout_sync_request($path . '/payout/sync-scope', ['environment'=>$environment]);
    $shared = $latest['sharedHistoryReview'];
    $done = ($current['outcome']['reconciled'] ?? false) && !$reviews && !$intent['plan']['truncated'] && $shared['settlements'] === 0 && $shared['payouts'] === 0;
    return [...$base,'state'=>$done?'synchronized':'review','reason'=>$done?'reconciled':'reconciliation_required',
        'reconciled'=>$done,'payoutConfirmed'=>$current['outcome']['payoutConfirmed'] ?? false,'outcome'=>$current['outcome'],
        'relatedReviews'=>$reviews,'sharedHistoryReview'=>$shared,'planTruncated'=>$intent['plan']['truncated']];
    } finally { $files->release(); }
}
