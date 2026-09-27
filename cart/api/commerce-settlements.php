<?php
declare(strict_types=1);
require_once __DIR__ . '/bootstrap.php';
require_once __DIR__ . '/commerce-checkout.php';

/** Reconcile saved provider sources; this function never contacts DOKU. */
function ez_reconcile_provider_settlement(array $input): array
{
    try { $result = ez_commerce_request('POST', '/internal/commerce/finance/settlement/reconcile', $input); }
    catch (EzCommerceStorageException $error) {
        if ($error->httpStatus < 500) throw $error;
        // A lost acknowledgement retries the exact source IDs. No new capture,
        // provider request, amount override or second journal is permitted.
        $result = ez_commerce_request('POST', '/internal/commerce/finance/settlement/reconcile', $input);
    }
    if (!is_array($result['recorded'] ?? null) || preg_match('/^stlm_[a-f0-9]{40}$/D', $result['recorded']['id'] ?? '') !== 1
        || !is_bool($result['settlementVerified'] ?? null) || ($result['earningsReleased'] ?? null) !== false
        || !array_key_exists('availableToWithdraw', $result) || $result['availableToWithdraw'] !== null) throw new RuntimeException('Settlement acknowledgement is invalid.');
    return $result;
}
