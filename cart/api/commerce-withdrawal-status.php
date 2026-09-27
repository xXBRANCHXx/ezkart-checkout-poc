<?php
declare(strict_types=1);
if (realpath((string) ($_SERVER['SCRIPT_FILENAME'] ?? '')) === __FILE__) { http_response_code(404); exit; }
require_once __DIR__ . '/commerce-withdrawal-payments.php';
require_once __DIR__ . '/doku-sub-accounts.php';

/** Recover the original observation without another provider read or payment. */
function ez_finalize_withdrawal_status(array $document): array
{
    ez_withdrawal_payment_document($document);
    ez_withdrawal_workbench($document['environment']);
    if (($document['evidence']['operation'] ?? null) !== 'transactions-status') throw new RuntimeException('Original status evidence is invalid.');
    $path = '/internal/commerce/finance/withdrawals/' . $document['withdrawalId'] . '/payment';
    $original = ez_commerce_request('POST', $path . '/read', ['environment' => $document['environment']]);
    if (($original['binding'] ?? null) !== $document['binding'] || ($original['confirmationId'] ?? null) !== $document['confirmationId']
        || ($original['mayPay'] ?? null) !== false || ($original['payoutConfirmed'] ?? null) !== false)
        throw new RuntimeException('Status evidence differs from the original payment.');
    $result = ez_commerce_request('POST', $path . '/status/receipt', ['environment' => $document['environment'], 'evidence' => $document['evidence']]);
    if (($result['recorded'] ?? null) !== true || ($result['mayPay'] ?? null) !== false || ($result['payoutConfirmed'] ?? null) !== false
        || !is_string($result['statusDigest'] ?? null) || preg_match('/^[a-f0-9]{64}$/D', $result['statusDigest']) !== 1)
        throw new RuntimeException('Status receipt acknowledgement was not confirmed.');
    return ['recorded' => true, 'statusDigest' => $result['statusDigest'], 'providerCalls' => 0, 'mayPay' => false, 'payoutConfirmed' => false];
}

/** A new explicit read uses the original reference; it never calls a transfer API. */
function ez_check_withdrawal_status(string $id, array $ownerScope, ?EzDokuSubAccountReader $client = null): array
{
    if (preg_match('/^wd_[a-f0-9]{40}$/D', $id) !== 1 || !is_string($ownerScope['environment'] ?? null)) throw new InvalidArgumentException('Withdrawal status scope is invalid.');
    $environment = $ownerScope['environment'];
    ez_withdrawal_workbench($environment);
    if (ez_config('commerce_withdrawal_status') !== 'enabled') throw new EzCommerceStorageException('Transfer status checks are temporarily unavailable. Your saved request is preserved.', 503);
    $directory = ez_withdrawal_receipt_directory();
    $path = '/internal/commerce/finance/withdrawals/' . $id;
    // The current owner may inspect a previous owner's payment, but cannot change
    // its bank details or gain the original owner's send authority.
    ez_commerce_request('POST', $path . '/read', $ownerScope);
    $original = ez_commerce_request('POST', $path . '/payment/read', ['environment' => $environment]);
    $client ??= EzDokuSubAccountReader::configured($environment);
    $identity = $client->providerIdentity();
    if (($original['binding']['environment'] ?? null) !== $environment || $identity['environment'] !== $environment
        || ($original['binding']['credentialFingerprint'] ?? null) !== $identity['credentialFingerprint']
        || ($original['clientId'] ?? null) !== $identity['clientId'] || ($original['mayPay'] ?? null) !== false)
        throw new RuntimeException('Status provider differs from the original payment.');
    $result = $client->transactionStatus($original['binding']['partnerReferenceNo']);
    $evidence = $result['evidence'];
    if (!is_string($evidence['externalId'] ?? null) || preg_match('/^[0-9]{32}$/D', $evidence['externalId']) !== 1)
        throw new RuntimeException('Status observation identity is invalid.');
    $document = ['version' => 1, 'withdrawalId' => $id, 'environment' => $environment, 'confirmationId' => $original['confirmationId'],
        'binding' => $original['binding'], 'evidence' => $evidence];
    // Exclusive storage precedes service finalization. Each observation has its
    // own file, so a later check cannot replace the bytes needed for recovery.
    $file = $directory . '/' . $id . '-status-' . substr($evidence['requestedAt'], 0, 10) . '-' . $evidence['externalId'] . '.json';
    ez_withdrawal_store_payment($file, $document);
    try { ez_finalize_withdrawal_status($document); }
    catch (Throwable) { return ['state' => 'review', 'providerCalls' => 1, 'mayPay' => false, 'payoutConfirmed' => false]; }
    return ['state' => 'recorded', 'providerCalls' => 1, 'mayPay' => false, 'payoutConfirmed' => false];
}
