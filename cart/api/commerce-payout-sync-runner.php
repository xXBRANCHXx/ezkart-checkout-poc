<?php
declare(strict_types=1);
if (realpath((string) ($_SERVER['SCRIPT_FILENAME'] ?? '')) === __FILE__) { http_response_code(404); exit; }
require_once __DIR__ . '/commerce-payout-sync-dispatch.php';

function ez_payout_runner_directory(): string
{
    $configured = ez_config('commerce_withdrawal_recovery_directory');
    if ($configured !== '' && !file_exists($configured) && !is_link($configured)) {
        $parent = realpath(dirname($configured));
        if (!str_starts_with($configured, '/') || $parent === false || !is_dir($parent)
            || preg_match('/^[A-Za-z0-9_-]{3,100}$/D', basename($configured)) !== 1)
            throw new RuntimeException('The configured private receipt directory is invalid.');
        $target = $parent . '/' . basename($configured);
        foreach ([realpath(dirname(__DIR__, 2)), realpath((string) ($_SERVER['DOCUMENT_ROOT'] ?? ''))] as $public) {
            if (is_string($public) && ($target === $public || str_starts_with($target, rtrim($public, '/') . '/')))
                throw new RuntimeException('Runner receipts must remain outside the public root.');
        }
        $mask = umask(0077);
        try { if (!mkdir($target, 0700) && !is_dir($target)) throw new RuntimeException('The private receipt directory could not be created.'); }
        finally { umask($mask); }
    }
    return ez_withdrawal_receipt_directory();
}

function ez_payout_runner_saved(string $file): ?array
{
    if (!file_exists($file) && !is_link($file)) return null;
    if (!is_file($file) || is_link($file) || (fileperms($file) & 0077) !== 0 || filesize($file) > 16000)
        throw new RuntimeException('The private runner receipt is unsafe.');
    $raw = file_get_contents($file);
    if (!is_string($raw)) throw new RuntimeException('The private runner receipt could not be read.');
    EzDokuFinancialJson::decode($raw);
    $saved = json_decode($raw, true, 32, JSON_THROW_ON_ERROR);
    if (!is_array($saved) || array_keys($saved) !== ['version','finish','confirmed'] || $saved['version'] !== 1
        || !is_array($saved['finish']) || !is_bool($saved['confirmed'])) throw new RuntimeException('The private runner receipt is invalid.');
    return $saved;
}

function ez_payout_runner_save(string $file, array $saved): void
{
    ez_payout_runner_saved($file);
    $raw = json_encode($saved, JSON_UNESCAPED_SLASHES | JSON_THROW_ON_ERROR) . "\n";
    $temporary = $file . '.' . bin2hex(random_bytes(12)); $mask = umask(0077);
    try { $stream = fopen($temporary, 'xb'); } finally { umask($mask); }
    if ($stream === false) throw new RuntimeException('The private runner receipt could not be opened.');
    try {
        for ($offset = 0; $offset < strlen($raw); $offset += $written) {
            $written = fwrite($stream, substr($raw, $offset));
            if (!is_int($written) || $written < 1) throw new RuntimeException('The private runner receipt was not fully saved.');
        }
        if (!fflush($stream) || (function_exists('fsync') && !fsync($stream))) throw new RuntimeException('The private runner receipt was not flushed.');
        if (!rename($temporary, $file)) throw new RuntimeException('The private runner receipt was not installed.');
    } finally { fclose($stream); @unlink($temporary); }
}

/** One scheduled read-only pass with a durable, bounded liveness receipt. */
function ez_run_scheduled_payout_sync(int $maxReads = 20): array
{
    if ($maxReads < 1 || $maxReads > 50) throw new InvalidArgumentException('Read budget must be between 1 and 50.');
    $environment = ez_central_commerce_environment(); ez_withdrawal_workbench($environment);
    $directory = ez_payout_runner_directory(); $storage = ez_config('commerce_withdrawal_sync_storage');
    if (preg_match('/^[A-Za-z0-9_-]{3,100}$/D', $storage) !== 1) throw new RuntimeException('The private storage identity is required.');
    $lockFile = $directory . '/payout-sync-scheduler.lock';
    if (is_link($lockFile) || (file_exists($lockFile) && (!is_file($lockFile) || (fileperms($lockFile) & 0077) !== 0)))
        throw new RuntimeException('The runner process lock is unsafe.');
    $mask = umask(0077);
    try { $lock = fopen($lockFile, 'c+b'); } finally { umask($mask); }
    if ($lock === false) throw new RuntimeException('The runner process lock could not be opened.');
    try {
        if (!flock($lock, LOCK_EX | LOCK_NB)) return ['state'=>'busy','processed'=>0,'providerCalls'=>0,'mayPay'=>false,'exitCode'=>0];
        $file = $directory . '/payout-sync-last-run.json'; $base = '/internal/commerce/finance/payout-sync/runner/';
        $saved = ez_payout_runner_saved($file);
        if ($saved !== null && (($saved['finish']['environment'] ?? null) !== $environment || ($saved['finish']['storageId'] ?? null) !== $storage))
            throw new RuntimeException('Original runner receipt belongs to another environment or storage.');
        $finish = static function (array $receipt) use ($base, $file): void {
            $result = ez_payout_sync_request($base . 'finish', $receipt['finish']);
            if (($result['runner']['runId'] ?? null) !== $receipt['finish']['runId'] || ($result['mayPay'] ?? null) !== false
                || ($result['runner']['result'] ?? null) !== $receipt['finish']['result']) throw new RuntimeException('The original runner completion was not confirmed.');
            ez_payout_runner_save($file, [...$receipt,'confirmed'=>true]);
        };
        // A lost finish response is recovered before starting another pass.
        if ($saved !== null && !$saved['confirmed']) $finish($saved);
        $identity = ['environment'=>$environment,'storageId'=>$storage,'runId'=>bin2hex(random_bytes(16))];
        $started = ez_payout_sync_request($base . 'start', $identity);
        if (($started['mayPay'] ?? null) !== false || !is_bool($started['owned'] ?? null)) throw new RuntimeException('The runner lease was not confirmed.');
        if (!$started['owned']) return ['state'=>'busy','processed'=>0,'providerCalls'=>0,'mayPay'=>false,'exitCode'=>0];
        if (($started['runner']['runId'] ?? null) !== $identity['runId'] || ($started['runner']['storageId'] ?? null) !== $storage)
            throw new RuntimeException('The runner lease differs from the original storage.');
        $renewAt = 0;
        $pulse = static function () use ($base, $identity, &$renewAt): void {
            if (time() < $renewAt) return;
            $result = ez_payout_sync_request($base . 'pulse', $identity);
            if (($result['runId'] ?? null) !== $identity['runId'] || ($result['mayPay'] ?? null) !== false) throw new RuntimeException('The runner heartbeat was not confirmed.');
            $renewAt = time() + 30;
        };
        try {
            $run = ez_dispatch_payout_sync($maxReads, $pulse);
            $state = $run['held'] ? 'held' : ($run['processed'] === 0 ? 'idle' : $run['state']);
            $reasons = ['held'=>'held','idle'=>'nothing_due','completed'=>'completed','retry'=>'needs_retry','review'=>'review_required'];
            if (!isset($reasons[$state])) throw new RuntimeException('The dispatched result was not recognized.');
            $result = ['state'=>$state,'reason'=>$reasons[$state],'queued'=>$run['queued'] ?? 0,
                'processed'=>$run['processed'],'providerCalls'=>$run['providerCalls'] ?? ($run['processed'] === 0 ? 0 : null)];
        } catch (Throwable) {
            $result = ['state'=>'failed','reason'=>'dispatch_failed','queued'=>null,'processed'=>null,'providerCalls'=>null];
        }
        $receipt = ['version'=>1,'finish'=>[...$identity,'result'=>$result],'confirmed'=>false];
        ez_payout_runner_save($file, $receipt); $finish($receipt);
        return [...$result,'mayPay'=>false,'exitCode'=>$result['state'] === 'failed' ? 1 : (in_array($result['state'], ['retry','review'], true) ? 2 : 0)];
    } finally { flock($lock, LOCK_UN); fclose($lock); }
}
