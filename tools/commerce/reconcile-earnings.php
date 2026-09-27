<?php
declare(strict_types=1);
if (PHP_SAPI !== 'cli') { http_response_code(404); exit; }
require_once dirname(__DIR__, 2) . '/cart/api/bootstrap.php';
require_once dirname(__DIR__, 2) . '/cart/api/commerce-checkout.php';
try {
    $input = [];
    foreach (array_slice($argv, 1) as $argument) {
        if (preg_match('/^--(environment|seller|order|limit)=(.+)$/sD', $argument, $match) !== 1 || isset($input[$match[1]])) throw new InvalidArgumentException('Arguments must be named and unique.');
        $input[$match[1]] = $match[2];
    }
    $environment = $input['environment'] ?? '';
    $deployment = ez_config('deployment_environment');
    if (!(($deployment === 'test' && $environment === 'sandbox') || ($deployment === 'beta' && $environment === 'production'))) throw new InvalidArgumentException('Choose TEST/sandbox or beta/production explicitly.');
    if (isset($input['seller']) && preg_match('/^[A-Za-z0-9][A-Za-z0-9_-]{2,95}$/D', $input['seller']) !== 1) throw new InvalidArgumentException('Store is invalid.');
    if (isset($input['order']) && (!isset($input['seller']) || preg_match('/^EZK-[SP]-[A-F0-9]{24}$/D', $input['order']) !== 1)) throw new InvalidArgumentException('An original order requires its store.');
    if (isset($input['limit']) && (preg_match('/^[1-9][0-9]{0,2}$/D', $input['limit']) !== 1 || (int) $input['limit'] > 100)) throw new InvalidArgumentException('Limit must be between 1 and 100.');
    ez_central_commerce_environment($environment);
    $payload = ['environment' => $environment, 'limit' => (int) ($input['limit'] ?? 25)];
    if (isset($input['seller'])) $payload['seller'] = $input['seller'];
    if (isset($input['order'])) $payload['orderId'] = $input['order'];
    $result = ez_commerce_request('POST', '/internal/commerce/finance/earnings/reconcile', $payload);
    if (!is_int($result['recorded'] ?? null) || !is_int($result['remaining'] ?? null) || !is_bool($result['caughtUp'] ?? null) || ($result['providerCalls'] ?? null) !== 0) throw new RuntimeException('Acknowledgement invalid.');
    echo json_encode(['ok' => true, 'recorded' => $result['recorded'], 'remaining' => $result['remaining'], 'caughtUp' => $result['caughtUp'], 'providerCalls' => 0], JSON_THROW_ON_ERROR) . "\n";
    exit($result['caughtUp'] ? 0 : 2);
} catch (Throwable $error) {
    $reason = $error instanceof InvalidArgumentException ? $error->getMessage() : 'Earnings reconciliation was not confirmed. It may have committed; check current earnings before retrying.';
    fwrite(STDERR, json_encode(['ok' => false, 'error' => $reason], JSON_THROW_ON_ERROR) . "\n");
    exit(1);
}
