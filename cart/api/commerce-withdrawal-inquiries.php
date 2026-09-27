<?php
declare(strict_types=1);
if (realpath((string) ($_SERVER['SCRIPT_FILENAME'] ?? '')) === __FILE__) { http_response_code(404); exit; }
require_once __DIR__ . '/commerce-checkout.php';
require_once __DIR__ . '/doku-payout.php';

function ez_withdrawal_workbench(string $environment): void
{
    $deployment = ez_deployment_profile()['environment'];
    if (!(($deployment === 'test' && $environment === 'sandbox') || ($deployment === 'beta' && $environment === 'production')))
        throw new EzCommerceStorageException('Withdrawals are not enabled on this deployment.', 503);
    ez_central_commerce_environment($environment);
}

function ez_withdrawal_receipt_directory(): string
{
    $configured = ez_config('commerce_withdrawal_recovery_directory');
    $directory = realpath($configured);
    if ($configured === '' || !str_starts_with($configured, '/') || $directory === false || !is_dir($directory)
        || is_link($configured) || (fileperms($directory) & 0077) !== 0 || !is_writable($directory))
        throw new EzCommerceStorageException('Bank verification is temporarily unavailable. Your saved request is preserved.', 503);
    foreach ([realpath(dirname(__DIR__, 2)), realpath((string) ($_SERVER['DOCUMENT_ROOT'] ?? ''))] as $public) {
        if (is_string($public) && ($directory === $public || str_starts_with($directory, rtrim($public, '/') . '/')))
            throw new EzCommerceStorageException('Bank verification is temporarily unavailable. Your saved request is preserved.', 503);
    }
    return $directory;
}

function ez_withdrawal_saved_inquiry(string $file): ?array
{
    if (!file_exists($file) && !is_link($file)) return null;
    if (!is_file($file) || is_link($file) || (fileperms($file) & 0077) !== 0 || filesize($file) < 2 || filesize($file) > 4200000)
        throw new RuntimeException('Original bank inquiry evidence requires review.');
    $raw = file_get_contents($file);
    if (!is_string($raw)) throw new RuntimeException('Original bank inquiry evidence could not be read.');
    // Reject duplicate keys before the ordinary associative conversion.
    EzDokuFinancialJson::decode($raw);
    $document = json_decode($raw, true, 64, JSON_THROW_ON_ERROR);
    if (!is_array($document) || array_keys($document) !== ['version', 'withdrawalId', 'environment', 'binding', 'evidence']
        || $document['version'] !== 1 || !is_string($document['withdrawalId']) || preg_match('/^wd_[a-f0-9]{40}$/D', $document['withdrawalId']) !== 1
        || !is_array($document['binding']) || !is_array($document['evidence'])) throw new RuntimeException('Original bank inquiry evidence is invalid.');
    return $document;
}

function ez_withdrawal_store_inquiry(string $file, array $document): void
{
    $raw = json_encode($document, JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE | JSON_THROW_ON_ERROR) . "\n";
    $previous = umask(0077);
    try { $handle = @fopen($file, 'xb'); }
    finally { umask($previous); }
    if ($handle === false) {
        $saved = ez_withdrawal_saved_inquiry($file);
        if ($saved === $document) return;
        throw new RuntimeException('Original bank inquiry evidence cannot be overwritten.');
    }
    try {
        $offset = 0;
        while ($offset < strlen($raw)) {
            $written = fwrite($handle, substr($raw, $offset));
            if (!is_int($written) || $written < 1) throw new RuntimeException('Bank inquiry evidence was not fully saved.');
            $offset += $written;
        }
        if (!fflush($handle) || (function_exists('fsync') && !fsync($handle))) throw new RuntimeException('Bank inquiry evidence was not flushed.');
    } finally { fclose($handle); }
}

/** Recover the same original receipt; this path never authenticates to DOKU. */
function ez_finalize_withdrawal_inquiry(array $document): array
{
    $environment = $document['environment'] ?? '';
    if (!is_string($environment)) throw new RuntimeException('Bank inquiry environment is invalid.');
    ez_withdrawal_workbench($environment);
    $id = $document['withdrawalId'] ?? '';
    if (!is_string($id) || preg_match('/^wd_[a-f0-9]{40}$/D', $id) !== 1 || ($document['version'] ?? null) !== 1)
        throw new RuntimeException('Bank inquiry reference is invalid.');
    $path = '/internal/commerce/finance/withdrawals/' . $id . '/inquiry';
    $original = ez_commerce_request('POST', $path . '/read', ['environment' => $environment]);
    if (($original['binding'] ?? null) !== ($document['binding'] ?? null)) throw new RuntimeException('Bank inquiry evidence differs from the original dispatch.');
    $result = ez_commerce_request('POST', $path . '/receipt', ['environment' => $environment, 'evidence' => $document['evidence'] ?? null]);
    if (($result['recorded'] ?? null) !== true || ($result['payoutConfirmed'] ?? null) !== false
        || !is_string($result['inquiryDigest'] ?? null) || preg_match('/^[a-f0-9]{64}$/D', $result['inquiryDigest']) !== 1)
        throw new RuntimeException('Bank inquiry receipt acknowledgement was not confirmed.');
    return ['recorded' => true, 'inquiryDigest' => $result['inquiryDigest'], 'providerCalls' => 0, 'payoutConfirmed' => false];
}

/** One committed grant, one inquiry, original receipt saved before D1 delivery. */
function ez_inquire_withdrawal_bank(string $id, array $ownerScope, ?EzDokuPayoutClient $client = null): array
{
    if (preg_match('/^wd_[a-f0-9]{40}$/D', $id) !== 1) throw new InvalidArgumentException('Withdrawal reference is invalid.');
    $environment = $ownerScope['environment'] ?? '';
    if (!is_string($environment)) throw new InvalidArgumentException('Withdrawal environment is invalid.');
    ez_withdrawal_workbench($environment);
    if (ez_config('commerce_withdrawal_inquiry') !== 'enabled') throw new EzCommerceStorageException('Bank verification is not available yet. Your saved request is preserved.', 503);
    $directory = ez_withdrawal_receipt_directory();
    $file = $directory . '/' . $id . '-bank-inquiry.json';
    $path = '/internal/commerce/finance/withdrawals/' . $id;
    $detail = ez_commerce_request('POST', $path . '/read', $ownerScope);
    if (($detail['withdrawal']['state'] ?? null) === 'cancelled') throw new EzCommerceStorageException('This withdrawal was cancelled.', 409);
    try { $existing = ez_commerce_request('POST', $path . '/inquiry/read', ['environment' => $environment]); }
    catch (EzCommerceStorageException $error) { if ($error->httpStatus !== 404) throw $error; $existing = null; }
    $saved = ez_withdrawal_saved_inquiry($file);
    if ($saved !== null && ($saved['withdrawalId'] !== $id || $saved['environment'] !== $environment)) throw new RuntimeException('Original bank inquiry evidence is out of scope.');
    if ($existing !== null) {
        if (($existing['originalEvidence'] ?? null) !== null) return ['state' => 'verified', 'providerCalls' => 0, 'payoutConfirmed' => false];
        if ($saved !== null) { ez_finalize_withdrawal_inquiry($saved); return ['state' => 'verified', 'providerCalls' => 0, 'payoutConfirmed' => false]; }
        return ['state' => 'review', 'providerCalls' => 0, 'payoutConfirmed' => false];
    }
    if ($saved !== null) throw new RuntimeException('Saved bank evidence has no confirmed original dispatch.');
    $client ??= EzDokuPayoutClient::configured($environment);
    $identity = $client->providerIdentity();
    if ($identity['environment'] !== $environment) throw new RuntimeException('Bank inquiry provider environment differs.');
    $client->verifyAuthentication();
    $grant = ez_commerce_request('POST', $path . '/inquiry/start', $ownerScope + [
        'credentialFingerprint' => $identity['credentialFingerprint'], 'clientId' => $identity['clientId'],
    ]);
    if (($grant['mayInquire'] ?? null) !== true) return ['state' => 'review', 'providerCalls' => 0, 'payoutConfirmed' => false];
    $stage = 'provider_inquiry';
    try {
        $inquiry = $client->inquire($grant['binding']);
        $stage = 'persist_receipt';
        ez_withdrawal_store_inquiry($file, ['version' => 1, 'withdrawalId' => $id, 'environment' => $environment,
            'binding' => $grant['binding'], 'evidence' => $inquiry['evidence']]);
        $stage = 'verify_receipt';
        $result = ez_commerce_request('POST', $path . '/inquiry/receipt', ['environment' => $environment, 'evidence' => $inquiry['evidence']]);
        if (($result['recorded'] ?? null) !== true || ($result['inquiryDigest'] ?? null) !== $inquiry['data']['inquiryDigest'] || ($result['payoutConfirmed'] ?? null) !== false)
            throw new RuntimeException('Bank inquiry receipt acknowledgement was not confirmed.');
        return ['state' => 'verified', 'providerCalls' => 1, 'payoutConfirmed' => false];
    } catch (Throwable $error) {
        try {
            ez_commerce_request('POST', $path . '/inquiry/diagnostic', ['environment' => $environment, 'stage' => $stage,
                'reason' => $error instanceof EzDokuReadException ? $error->reason : 'unconfirmed_receipt',
                'providerStatus' => $error instanceof EzDokuReadException ? $error->providerStatus : 0]);
        } catch (Throwable) { /* Original dispatch still fences all replays. */ }
        return ['state' => 'review', 'providerCalls' => 1, 'payoutConfirmed' => false];
    }
}
