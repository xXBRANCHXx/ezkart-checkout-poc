<?php
declare(strict_types=1);
if (realpath((string) ($_SERVER['SCRIPT_FILENAME'] ?? '')) === __FILE__) { http_response_code(404); exit; }
require_once __DIR__ . '/commerce-withdrawal-inquiries.php';

function ez_treasury_receipt_directory(): string
{
    $configured = ez_config('commerce_treasury_recovery_directory'); $directory = realpath($configured);
    if ($configured === '' || !str_starts_with($configured, '/') || $directory === false || !is_dir($directory)
        || is_link($configured) || (fileperms($directory) & 0077) !== 0 || !is_writable($directory)) throw new RuntimeException('Private treasury recovery storage is unavailable.');
    foreach ([realpath(dirname(__DIR__, 2)), realpath((string) ($_SERVER['DOCUMENT_ROOT'] ?? ''))] as $public) {
        if (is_string($public) && ($directory === $public || str_starts_with($directory, rtrim($public, '/') . '/'))) throw new RuntimeException('Treasury recovery storage must be private.');
    }
    return $directory;
}
function ez_treasury_document(array $d): void
{
    if (array_keys($d) !== ['version','intentId','environment','stage','confirmationId','binding','evidence'] || $d['version'] !== 1
        || !is_string($d['intentId']) || preg_match('/^try_[a-f0-9]{40}$/D', $d['intentId']) !== 1
        || !in_array($d['environment'], ['sandbox','production'], true) || !in_array($d['stage'], ['inquiry','payment'], true)
        || ($d['stage'] === 'inquiry' ? $d['confirmationId'] !== null : (!is_string($d['confirmationId']) || preg_match('/^tryconf_[a-f0-9]{40}$/D', $d['confirmationId']) !== 1))
        || !is_array($d['binding']) || !is_array($d['evidence'])) throw new RuntimeException('Original treasury receipt is invalid.');
}
function ez_treasury_saved_receipt(string $file): ?array
{
    if (!file_exists($file) && !is_link($file)) return null;
    if (!is_file($file) || is_link($file) || (fileperms($file) & 0077) !== 0 || filesize($file) < 2 || filesize($file) > 100000) throw new RuntimeException('Private treasury receipt needs review.');
    $raw = file_get_contents($file); if (!is_string($raw)) throw new RuntimeException('Treasury receipt cannot be read.');
    EzDokuFinancialJson::decode($raw); $d = json_decode($raw, true, 64, JSON_THROW_ON_ERROR); ez_treasury_document($d); return $d;
}
function ez_treasury_store_receipt(string $file, array $d): void
{
    ez_treasury_document($d); $raw = json_encode($d, JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE | JSON_THROW_ON_ERROR) . "\n";
    if (strlen($raw) > 100000) throw new RuntimeException('Treasury receipt is too large.');
    $previous = umask(0077); try { $h = @fopen($file, 'xb'); } finally { umask($previous); }
    if ($h === false) { if (ez_treasury_saved_receipt($file) === $d) return; throw new RuntimeException('Original treasury receipt cannot be replaced.'); }
    try {
        for ($offset = 0; $offset < strlen($raw); $offset += $written) {
            $written = fwrite($h, substr($raw, $offset)); if (!is_int($written) || $written < 1) throw new RuntimeException('Treasury receipt was not fully saved.');
        }
        if (!fflush($h) || (function_exists('fsync') && !fsync($h))) throw new RuntimeException('Treasury receipt was not flushed.');
    } finally { fclose($h); }
}
/** Receipt-only recovery never loads current bank configuration or DOKU credentials. */
function ez_finalize_treasury_receipt(array $d, ?callable $private = null): array
{
    ez_treasury_document($d); ez_withdrawal_workbench($d['environment']); $private ??= 'ez_commerce_request';
    $path = '/internal/commerce/finance/treasury/' . $d['intentId'] . '/' . $d['stage'];
    $original = $private('POST', $path . '/read', ['environment' => $d['environment']]);
    if (($original['binding'] ?? null) !== $d['binding'] || ($original['confirmationId'] ?? null) !== $d['confirmationId']
        || ($original['mayPay'] ?? null) !== false || ($original['mayInquire'] ?? null) !== false) throw new RuntimeException('Treasury receipt does not match its original dispatch.');
    $r = $private('POST', $path . '/receipt', ['environment' => $d['environment'], 'evidence' => $d['evidence']]);
    if (($r['recorded'] ?? null) !== true || ($r['payoutConfirmed'] ?? null) !== false || !is_string($r['digest'] ?? null) || preg_match('/^[a-f0-9]{64}$/D', $r['digest']) !== 1) throw new RuntimeException('Treasury receipt acknowledgement was not confirmed.');
    return ['recorded' => true, 'digest' => $r['digest'], 'providerCalls' => 0, 'payoutConfirmed' => false];
}
/** Owner callback is server-built using the current session JWT, never browser supplied. */
function ez_dispatch_treasury_bank(string $id, string $environment, string $stage, callable $owner, ?string $confirmation = null, ?EzDokuPayoutClient $client = null, ?callable $private = null): array
{
    if (preg_match('/^try_[a-f0-9]{40}$/D', $id) !== 1 || !in_array($stage, ['inquiry','payment'], true)
        || ($stage === 'payment' && (!is_string($confirmation) || preg_match('/^tryconf_[a-f0-9]{40}$/D', $confirmation) !== 1))) throw new InvalidArgumentException('Treasury dispatch scope is invalid.');
    ez_withdrawal_workbench($environment); $private ??= 'ez_commerce_request';
    $owner('/intents/' . $id, null); // Current session authority before private recovery reads.
    $file = ez_treasury_receipt_directory() . '/' . $id . '-' . $stage . '.json';
    $path = '/internal/commerce/finance/treasury/' . $id . '/' . $stage;
    try { $original = $private('POST', $path . '/read', ['environment' => $environment]); }
    catch (EzCommerceStorageException $e) { if ($e->httpStatus !== 404) throw $e; $original = null; }
    $saved = ez_treasury_saved_receipt($file);
    if ($saved !== null && ($saved['intentId'] !== $id || $saved['stage'] !== $stage || $saved['environment'] !== $environment || $saved['confirmationId'] !== $confirmation)) throw new RuntimeException('Treasury evidence scope changed.');
    if ($original !== null) {
        if (($original['confirmationId'] ?? null) !== $confirmation) throw new RuntimeException('Use the original treasury confirmation.');
        if (($original['originalEvidence'] ?? null) !== null) return ['state' => 'recorded', 'providerCalls' => 0, 'payoutConfirmed' => false];
        if ($saved !== null) { ez_finalize_treasury_receipt($saved, $private); return ['state' => 'recorded', 'providerCalls' => 0, 'payoutConfirmed' => false]; }
        return ['state' => 'outcome_unknown', 'providerCalls' => 0, 'payoutConfirmed' => false];
    }
    if ($saved !== null) throw new RuntimeException('Original treasury dispatch is missing.');
    if (ez_config('commerce_treasury_' . $stage) !== 'enabled') throw new EzCommerceStorageException('Treasury dispatch is held. The original reservation is preserved.', 503);
    // An empty reviewed eligibility projection holds payments even if flags change.
    if ($stage === 'payment' && empty($owner('/intents/' . $id, null)['executionAvailable'])) throw new EzCommerceStorageException('Treasury release and fee funding are still held.', 503);
    $client ??= EzDokuPayoutClient::configured($environment); $identity = $client->providerIdentity();
    if ($identity['environment'] !== $environment) throw new RuntimeException('Treasury provider environment differs.');
    $client->verifyAuthentication();
    $g = $owner('/intents/' . $id . '/' . $stage . '/start', ['credentialFingerprint' => $identity['credentialFingerprint'], 'clientId' => $identity['clientId']] + ($stage === 'payment' ? ['confirmationId' => $confirmation] : []));
    if (($g[$stage === 'inquiry' ? 'mayInquire' : 'mayPay'] ?? null) !== true) return ['state' => 'outcome_unknown', 'providerCalls' => 0, 'payoutConfirmed' => false];
    try {
        if ($stage === 'payment' && ($g['confirmationId'] ?? null) !== $confirmation) throw new RuntimeException('Original confirmation changed.');
        $r = $stage === 'inquiry' ? $client->inquire($g['binding']) : $client->pay($g['binding'], $g['originalInquiry'], $g['inquiryDigest']);
        $d = ['version' => 1, 'intentId' => $id, 'environment' => $environment, 'stage' => $stage, 'confirmationId' => $confirmation, 'binding' => $g['binding'], 'evidence' => $r['evidence']];
        ez_treasury_store_receipt($file, $d); ez_finalize_treasury_receipt($d, $private);
        return ['state' => 'recorded', 'providerCalls' => 1, 'payoutConfirmed' => false];
    } catch (Throwable) { return ['state' => 'outcome_unknown', 'providerCalls' => 1, 'payoutConfirmed' => false]; }
}
