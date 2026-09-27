<?php
declare(strict_types=1);
if (PHP_SAPI !== 'cli' && realpath($_SERVER['SCRIPT_FILENAME'] ?? '') === __FILE__) { http_response_code(404); exit; }
require_once __DIR__ . '/bootstrap.php';
require_once __DIR__ . '/commerce-checkout.php';

/** Reconcile these exact saved sources. Never query or send money to DOKU. */
function ez_reconcile_withdrawal_payout(string $id, array $input): array
{
    if (preg_match('/^wd_[a-f0-9]{40}$/D', $id) !== 1
        || array_diff(array_keys($input), ['environment','sellerCollectionId','platformCollectionId','statusCap'])
        || !is_int($input['statusCap'] ?? null) || $input['statusCap'] < 1 || $input['statusCap'] > 9007199254740991) throw new InvalidArgumentException('Payout scope or status boundary is invalid.');
    foreach (['sellerCollectionId','platformCollectionId'] as $key) {
        if (!is_string($input[$key] ?? null) || preg_match('/^fcol_[a-f0-9]{40}$/D', $input[$key]) !== 1) throw new InvalidArgumentException('Original collection IDs are required.');
    }
    $environment = $input['environment'] ?? null;
    $deployment = ez_config('deployment_environment');
    if (!(($deployment === 'test' && $environment === 'sandbox') || ($deployment === 'beta' && $environment === 'production'))) throw new InvalidArgumentException('Payout reconciliation accepts TEST/sandbox or beta/production only.');
    ez_central_commerce_environment($environment);
    $path = '/internal/commerce/finance/withdrawals/' . $id . '/payout/reconcile';
    try { $result = ez_commerce_request('POST', $path, $input); }
    catch (EzCommerceStorageException $error) {
        if ($error->httpStatus < 500) throw $error;
        $result = ez_commerce_request('POST', $path, $input);
    }
    $recorded = $result['recorded'] ?? null;
    if (!is_array($recorded) || preg_match('/^payout_[a-f0-9]{40}$/D', $recorded['id'] ?? '') !== 1
        || ($result['withdrawalId'] ?? null) !== $id || ($result['providerCalls'] ?? null) !== 0 || ($result['mayPay'] ?? null) !== false
        || ($recorded['source']['withdrawalId'] ?? null) !== $id
        || ($recorded['source']['sellerCollectionId'] ?? null) !== $input['sellerCollectionId']
        || ($recorded['source']['platformCollectionId'] ?? null) !== $input['platformCollectionId']
        || ($recorded['source']['statusCap'] ?? null) !== $input['statusCap']
        || !is_bool($result['replayed'] ?? null) || !is_bool($result['outcome']['reconciled'] ?? null)) throw new RuntimeException('Payout reconciliation acknowledgement is invalid.');
    return $result;
}
