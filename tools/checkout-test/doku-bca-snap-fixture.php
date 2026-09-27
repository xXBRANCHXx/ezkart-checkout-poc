<?php
declare(strict_types=1);
if (PHP_SAPI !== 'cli') { http_response_code(404); exit; }
require_once dirname(__DIR__, 2) . '/cart/api/doku-bca-snap.php';

$input = json_decode(stream_get_contents(STDIN), true, 64, JSON_THROW_ON_ERROR);
$requests = []; $results = []; $time = $input['time'] ?? 1790484000;
try {
    if (array_key_exists('minify', $input)) {
        echo json_encode(['body' => EzDokuFinancialJson::minify($input['minify'])], JSON_THROW_ON_ERROR); exit;
    }
    $responses = $input['responses'] ?? [];
    $client = new EzDokuBcaSnapClient($input['credentials'], static function ($url, $headers, $body) use (&$responses, &$requests): array {
        $requests[] = ['url' => $url, 'headers' => $headers, 'body' => $body];
        $response = array_shift($responses);
        if (!$response || isset($response['throw'])) throw new RuntimeException('Fixture-only private diagnostic.');
        return [$response['status'] ?? 200, $response['body']];
    }, static function () use (&$time): int { return $time; });
    $binding = $input['binding'] ?? [];
    if (!array_key_exists('credentialFingerprint', $binding)) $binding['credentialFingerprint'] = $client->credentialFingerprint;
    $routeBinding = $input['routeBinding'] ?? [];
    if (!array_key_exists('credentialFingerprint', $routeBinding)) $routeBinding['credentialFingerprint'] = $client->credentialFingerprint;
    foreach ($input['actions'] ?? [] as $action) {
        try {
            if ($action[0] === 'connectionCLI') {
                require_once dirname(__DIR__) . '/commerce/doku-check-connection.php';
                ob_start(); $exit = ez_doku_connection_main($action[1], static fn() => $client); $stdout = ob_get_clean();
                $results[] = ['ok' => true, 'result' => ['exit' => $exit, 'stdout' => json_decode($stdout, true)]];
                continue;
            }
            $result = match ($action[0]) {
                'payload' => $client->paymentPayload($binding),
                'create' => $client->createAccount($binding),
                'notification' => $client->paymentNotification($action[1], $action[2], $action[3], $binding, $action[4] ?? null),
                'status' => $client->observeStatus($binding, $action[1], $action[2] ?? null),
                'debug' => $client->__debugInfo(),
                'authentication' => $client->verifyAuthentication(),
                'splitPayload' => $client->splitPayload($routeBinding),
                'splitCreate' => $client->createSplitRule($routeBinding),
            };
            $results[] = ['ok' => true, 'result' => $result];
        } catch (Throwable $error) { $results[] = ['ok' => false, 'reason' => $error instanceof EzDokuReadException ? $error->reason : get_class($error), 'error' => $error->getMessage()]; }
    }
    echo json_encode(['results' => $results, 'requests' => $requests, 'fingerprint' => $client->credentialFingerprint], JSON_THROW_ON_ERROR);
} catch (Throwable $error) {
    echo json_encode(['error' => $error->getMessage(), 'reason' => $error instanceof EzDokuReadException ? $error->reason : get_class($error), 'requests' => $requests], JSON_THROW_ON_ERROR);
}
