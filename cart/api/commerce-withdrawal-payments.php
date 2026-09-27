<?php
declare(strict_types=1);
if (realpath((string) ($_SERVER['SCRIPT_FILENAME'] ?? '')) === __FILE__) { http_response_code(404); exit; }
require_once __DIR__ . '/commerce-withdrawal-inquiries.php';

/** Original payment evidence is private and immutable. */
function ez_withdrawal_payment_document(array $document): void
{
    if (array_keys($document) !== ['version', 'withdrawalId', 'environment', 'confirmationId', 'binding', 'evidence']
        || $document['version'] !== 1 || !is_string($document['withdrawalId']) || preg_match('/^wd_[a-f0-9]{40}$/D', $document['withdrawalId']) !== 1
        || !in_array($document['environment'], ['sandbox', 'production'], true)
        || !is_string($document['confirmationId']) || preg_match('/^wdconf_[a-f0-9]{40}$/D', $document['confirmationId']) !== 1
        || !is_array($document['binding']) || !is_array($document['evidence'])) throw new RuntimeException('Original payment evidence is invalid.');
}

function ez_withdrawal_saved_payment(string $file): ?array
{
    if (!file_exists($file) && !is_link($file)) return null;
    if (!is_file($file) || is_link($file) || (fileperms($file) & 0077) !== 0 || filesize($file) < 2 || filesize($file) > 100000)
        throw new RuntimeException('Original payment evidence requires review.');
    $raw = file_get_contents($file);
    if (!is_string($raw)) throw new RuntimeException('Original payment evidence could not be read.');
    EzDokuFinancialJson::decode($raw);
    $document = json_decode($raw, true, 64, JSON_THROW_ON_ERROR);
    if (!is_array($document)) throw new RuntimeException('Original payment evidence is invalid.');
    ez_withdrawal_payment_document($document);
    return $document;
}

function ez_withdrawal_store_payment(string $file, array $document): void
{
    ez_withdrawal_payment_document($document);
    $raw = json_encode($document, JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE | JSON_THROW_ON_ERROR) . "\n";
    if (strlen($raw) > 100000) throw new RuntimeException('Original payment evidence is too large.');
    $previous = umask(0077);
    try { $handle = @fopen($file, 'xb'); }
    finally { umask($previous); }
    if ($handle === false) {
        if (ez_withdrawal_saved_payment($file) === $document) return;
        throw new RuntimeException('Original payment evidence cannot be overwritten.');
    }
    try {
        $offset = 0;
        while ($offset < strlen($raw)) {
            $written = fwrite($handle, substr($raw, $offset));
            if (!is_int($written) || $written < 1) throw new RuntimeException('Payment evidence was not fully saved.');
            $offset += $written;
        }
        if (!fflush($handle) || (function_exists('fsync') && !fsync($handle))) throw new RuntimeException('Payment evidence was not flushed.');
    } finally { fclose($handle); }
}

/** This path works while dispatch is held and never authenticates to DOKU. */
function ez_finalize_withdrawal_payment(array $document): array
{
    ez_withdrawal_payment_document($document);
    ez_withdrawal_workbench($document['environment']);
    $path = '/internal/commerce/finance/withdrawals/' . $document['withdrawalId'] . '/payment';
    $original = ez_commerce_request('POST', $path . '/read', ['environment' => $document['environment']]);
    if (($original['binding'] ?? null) !== $document['binding'] || ($original['confirmationId'] ?? null) !== $document['confirmationId']
        || ($original['mayPay'] ?? null) !== false || ($original['payoutConfirmed'] ?? null) !== false)
        throw new RuntimeException('Payment evidence differs from the original dispatch.');
    $result = ez_commerce_request('POST', $path . '/receipt', ['environment' => $document['environment'], 'evidence' => $document['evidence']]);
    if (($result['recorded'] ?? null) !== true || ($result['payoutConfirmed'] ?? null) !== false
        || !is_string($result['paymentDigest'] ?? null) || preg_match('/^[a-f0-9]{64}$/D', $result['paymentDigest']) !== 1)
        throw new RuntimeException('Payment receipt acknowledgement was not confirmed.');
    return ['recorded' => true, 'paymentDigest' => $result['paymentDigest'], 'providerCalls' => 0, 'payoutConfirmed' => false];
}

/** A fresh, durable grant permits exactly one provider attempt. Replays only recover. */
function ez_pay_withdrawal(string $id, string $confirmationId, array $ownerScope, ?EzDokuPayoutClient $client = null): array
{
    if (preg_match('/^wd_[a-f0-9]{40}$/D', $id) !== 1 || preg_match('/^wdconf_[a-f0-9]{40}$/D', $confirmationId) !== 1
        || !is_string($ownerScope['environment'] ?? null)) throw new InvalidArgumentException('Withdrawal payment scope is invalid.');
    $environment = $ownerScope['environment'];
    ez_withdrawal_workbench($environment);
    $file = ez_withdrawal_receipt_directory() . '/' . $id . '-payment.json';
    $path = '/internal/commerce/finance/withdrawals/' . $id;
    ez_commerce_request('POST', $path . '/read', $ownerScope);
    try { $original = ez_commerce_request('POST', $path . '/payment/read', ['environment' => $environment]); }
    catch (EzCommerceStorageException $error) { if ($error->httpStatus !== 404) throw $error; $original = null; }
    $saved = ez_withdrawal_saved_payment($file);
    if ($saved !== null && ($saved['withdrawalId'] !== $id || $saved['environment'] !== $environment || $saved['confirmationId'] !== $confirmationId))
        throw new RuntimeException('Original payment evidence is out of scope.');
    if ($original !== null) {
        if (($original['confirmationId'] ?? null) !== $confirmationId) throw new EzCommerceStorageException('Use the original payment confirmation.', 409);
        if (($original['originalPayment'] ?? null) !== null) return ['state' => 'recorded', 'providerCalls' => 0, 'payoutConfirmed' => false];
        if ($saved !== null) { ez_finalize_withdrawal_payment($saved); return ['state' => 'recorded', 'providerCalls' => 0, 'payoutConfirmed' => false]; }
        return ['state' => 'review', 'providerCalls' => 0, 'payoutConfirmed' => false];
    }
    if ($saved !== null) throw new RuntimeException('Saved payment evidence has no confirmed original dispatch.');
    // Both PHP and Worker flags stay held until activation and platform fee funding
    // have been accepted. Enabling transport is an operator rollout decision.
    if (ez_config('commerce_withdrawals') !== 'enabled' || ez_config('commerce_withdrawal_payment') !== 'enabled')
        throw new EzCommerceStorageException('Bank transfers are temporarily paused. Your saved request is preserved.', 503);
    $client ??= EzDokuPayoutClient::configured($environment);
    $identity = $client->providerIdentity();
    if ($identity['environment'] !== $environment) throw new RuntimeException('Payment provider environment differs.');
    $client->verifyAuthentication();
    $grant = ez_commerce_request('POST', $path . '/payment/start', $ownerScope + ['confirmationId' => $confirmationId,
        'credentialFingerprint' => $identity['credentialFingerprint'], 'clientId' => $identity['clientId']]);
    if (($grant['mayPay'] ?? null) !== true) return ['state' => 'review', 'providerCalls' => 0, 'payoutConfirmed' => false];
    $stage = 'provider_payment';
    try {
        if (($grant['confirmationId'] ?? null) !== $confirmationId || ($grant['feeAccount']['feePayer'] ?? null) !== 'ezkart'
            || ($grant['feeAccount']['sellerWithdrawalFee'] ?? null) !== '0') throw new RuntimeException('Payment grant requires review.');
        $result = $client->pay($grant['binding'], $grant['originalInquiry'], $grant['inquiryDigest']);
        $document = ['version' => 1, 'withdrawalId' => $id, 'environment' => $environment, 'confirmationId' => $confirmationId,
            'binding' => $grant['binding'], 'evidence' => $result['evidence']];
        $stage = 'persist_receipt';
        ez_withdrawal_store_payment($file, $document);
        $stage = 'verify_receipt';
        ez_finalize_withdrawal_payment($document);
        return ['state' => 'recorded', 'providerCalls' => 1, 'payoutConfirmed' => false];
    } catch (Throwable $error) {
        try { ez_commerce_request('POST', $path . '/payment/diagnostic', ['environment' => $environment, 'stage' => $stage,
            'reason' => $error instanceof EzDokuReadException ? $error->reason : 'unconfirmed_receipt',
            'providerStatus' => $error instanceof EzDokuReadException ? $error->providerStatus : 0]); }
        catch (Throwable) { /* The original grant still prevents another send. */ }
        return ['state' => 'review', 'providerCalls' => 1, 'payoutConfirmed' => false];
    }
}
