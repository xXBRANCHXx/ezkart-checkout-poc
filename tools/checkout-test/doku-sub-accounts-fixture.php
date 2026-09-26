<?php
declare(strict_types=1);
if (PHP_SAPI !== 'cli') { http_response_code(404); exit; }
require_once dirname(__DIR__, 2) . '/cart/api/doku-sub-accounts.php';
require_once dirname(__DIR__, 2) . '/cart/api/doku-financial-observation.php';

$input = json_decode(stream_get_contents(STDIN), true, 64, JSON_THROW_ON_ERROR);
$requests = []; $results = []; $time = $input['time'] ?? 1790416800;
try {
    if (array_key_exists('json', $input)) {
        echo json_encode(['value' => EzDokuFinancialJson::decode($input['json'])], JSON_THROW_ON_ERROR); exit;
    }
    $responses = $input['responses'] ?? [];
    $client = new EzDokuSubAccountReader($input['credentials'], static function ($url, $headers, $body) use (&$responses, &$requests): array {
        $requests[] = ['url' => $url, 'headers' => $headers, 'body' => $body];
        $response = array_shift($responses);
        if (!$response || isset($response['throw'])) throw new RuntimeException('Fixture transport failure with private diagnostic data.');
        return [$response['status'] ?? 200, $response['body']];
    }, static function () use (&$time): int { return $time; });
    $observations = [];
    foreach ($input['actions'] ?? [] as $action) {
        if ($action[0] === 'advance') { $time += $action[1]; continue; }
        try {
            if ($action[0] === 'auditCLI') {
                require_once dirname(__DIR__) . '/commerce/observe-doku.php';
                ob_start(); $exit = ez_doku_observation_main($action[1], static fn() => $client); $stdout = ob_get_clean();
                $results[] = ['ok' => true, 'result' => ['exit' => $exit, 'stdout' => json_decode($stdout, true)]];
                continue;
            }
            $result = match ($action[0]) {
                'balances' => $client->balances(...array_slice($action, 1)),
                'history' => $client->historyPage(...array_slice($action, 1)),
                'status' => $client->transactionStatus(...array_slice($action, 1)),
                'debug' => $client->__debugInfo(),
                'observe' => ez_observe_doku_financial_window($client, ...[...array_slice($action, 1), static function ($kind, $response) use (&$observations, $input): void {
                    $observations[] = ['kind' => $kind, ...$response];
                    if (isset($input['failWriteAt']) && count($observations) === $input['failWriteAt']) throw new RuntimeException('Fixture storage failure.');
                }]),
            };
            $results[] = ['ok' => true, 'result' => $result];
        } catch (Throwable $error) { $results[] = ['ok' => false, 'error' => $error->getMessage(), 'reason' => $error instanceof EzDokuReadException ? $error->reason : get_class($error)]; }
    }
    echo json_encode(['results' => $results, 'requests' => $requests, 'observations' => $observations, 'fingerprint' => $client->credentialFingerprint], JSON_THROW_ON_ERROR);
} catch (Throwable $error) {
    echo json_encode(['error' => $error->getMessage(), 'reason' => $error instanceof EzDokuReadException ? $error->reason : get_class($error), 'requests' => $requests], JSON_THROW_ON_ERROR);
}
